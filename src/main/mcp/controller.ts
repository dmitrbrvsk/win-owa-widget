import { writePrivateJson } from '../../mcp/privateFiles';
import { type McpAccess, type McpUiState, parseMcpAccess } from '../../shared/mcp';
import { type SyncState } from '../../shared/types';
import { RequestGate } from '../limits';

import { accountBinding, McpAccessStore, NO_MCP_ACCESS } from './accessStore';
import { type ReadBridge, startReadBridge } from './bridge';
import { type McpCalendarView, McpCatalog } from './catalog';

interface ControllerOptions {
    directory: string;
    cliPath: string;
    view(): McpCalendarView;
    confirm(access: McpAccess, label?: string): Promise<boolean>;
    sources?(): McpSource[];
}

interface McpSource {
    id: string;
    owner: string;
    label: string;
    revision: number;
    sync: SyncState;
}

function sourceBinding(source: McpSource) {
    return accountBinding(JSON.stringify([source.id, source.owner]), false);
}

export class McpController {
    private readonly store: McpAccessStore;
    private catalog = new McpCatalog();
    private readonly consentGate = new RequestGate(1, 3, 60_000);
    private access = { ...NO_MCP_ACCESS };
    private scopes = new Map<string, McpAccess>();
    private binding = '';
    private epoch = 0;
    private scopedConsentEpoch = 0;
    private bridge?: ReadBridge;
    private failed = false;

    constructor(private readonly options: ControllerOptions) {
        this.store = new McpAccessStore(options.directory);
    }

    private currentBinding(): string {
        const view = this.options.view();
        return accountBinding(view.account, view.demo);
    }

    async initialize(): Promise<void> {
        this.close();
        this.binding = this.currentBinding();
        if (this.options.sources) {
            this.scopes = this.store.loadScopes(
                new Map(
                    this.options
                        .sources()
                        .map((source) => [
                            sourceBinding(source),
                            accountBinding(source.owner, false),
                        ]),
                ),
            );
            this.updateScopedAccess();
        } else {
            this.access = this.store.load(this.binding);
        }
        try {
            if (this.access.enabled) await this.restart();
        } catch {
            this.close();
            this.failed = true;
        }
    }

    state(id?: string): McpUiState {
        if (this.access.enabled && this.binding !== this.currentBinding()) this.revoke();
        const running = !!this.bridge && this.access.enabled;
        const source = this.options.sources?.().find((entry) => entry.id === id);
        const access = this.options.sources
            ? ((source && this.scopes.get(sourceBinding(source))) ?? NO_MCP_ACCESS)
            : this.access;
        return {
            access: { ...access },
            running,
            configuration: running
                ? JSON.stringify(
                      {
                          mcpServers: {
                              'owa-widget': {
                                  command: 'node',
                                  args: [
                                      this.options.cliPath,
                                      '--connection-file',
                                      this.store.connectionFile,
                                  ],
                              },
                          },
                      },
                      null,
                      2,
                  )
                : '',
            ...(this.failed ? { error: 'unavailable' as const } : {}),
            demo: this.options.view().demo,
        };
    }

    async setAccess(raw: unknown, id?: string, check?: () => void): Promise<McpUiState> {
        const parsed = parseMcpAccess(raw);
        const next = parsed.enabled ? parsed : { ...NO_MCP_ACCESS };
        if (this.options.sources) return this.setScope(id, next, check);
        const binding = this.currentBinding();
        const { epoch } = this;
        const { revision } = this.options.view();
        const widening =
            next.enabled &&
            (!this.access.enabled || (next.allowTitles && !this.access.allowTitles));
        if (widening) {
            const release = this.consentGate.enter();
            try {
                const approved = await this.options.confirm(next);
                if (
                    epoch !== this.epoch ||
                    binding !== this.currentBinding() ||
                    revision !== this.options.view().revision
                )
                    throw new Error('MCP permission request expired');
                if (!approved) return this.state();
            } finally {
                release();
            }
        }
        // Disabling or narrowing never waits behind an outstanding approval or server startup.
        this.close();
        this.binding = binding;
        try {
            this.store.save(binding, next);
            this.access = { ...next };
            this.failed = false;
            if (next.enabled) await this.restart();
        } catch {
            this.close();
            this.failed = true;
            throw new Error('MCP permissions could not be saved');
        }
        return this.state();
    }

    private async setScope(id: string | undefined, next: McpAccess, check?: () => void) {
        const source = this.options.sources?.().find((entry) => entry.id === id);
        if (!source) throw new Error('Аккаунт не найден');
        const key = sourceBinding(source);
        const previous = this.scopes.get(key) ?? NO_MCP_ACCESS;
        if (previous.enabled === next.enabled && previous.allowTitles === next.allowTitles) {
            if (!next.enabled) this.scopedConsentEpoch += 1;
            return this.state(id);
        }
        if (next.enabled && (!previous.enabled || (next.allowTitles && !previous.allowTitles))) {
            const release = this.consentGate.enter();
            const { epoch, scopedConsentEpoch } = this;
            try {
                if (!(await this.options.confirm(next, source.label))) return this.state(id);
                check?.();
                const current = this.options.sources?.().find((entry) => entry.id === id);
                if (
                    epoch !== this.epoch ||
                    scopedConsentEpoch !== this.scopedConsentEpoch ||
                    !current ||
                    sourceBinding(current) !== key ||
                    current.revision !== source.revision
                )
                    throw new Error('MCP permission request expired');
            } finally {
                release();
            }
        }
        if (next.enabled) this.scopes.set(key, next);
        else this.scopes.delete(key);
        await this.applyScopes();
        return this.state(id);
    }

    async removeSource(id: string, owner: string) {
        const key = accountBinding(JSON.stringify([id, owner]), false);
        if (this.scopes.delete(key)) await this.applyScopes();
    }

    private updateScopedAccess() {
        this.access = {
            enabled: this.scopes.size > 0,
            allowTitles: [...this.scopes.values()].some((access) => access.allowTitles),
        };
    }

    private async applyScopes() {
        this.close();
        try {
            this.store.saveScopes(this.scopes);
            this.updateScopedAccess();
            this.failed = false;
            if (this.access.enabled) await this.restart();
        } catch {
            this.close();
            this.scopes.clear();
            this.failed = true;
            throw new Error('MCP permissions could not be saved');
        }
    }

    private calendarView(): McpCalendarView {
        const view = this.options.view();
        if (!this.options.sources) return view;
        const allowed = this.options
            .sources()
            .filter((source) => this.scopes.has(sourceBinding(source)));
        const ids = new Set(allowed.map((entry) => entry.id));
        const titleAccounts = new Set(
            allowed
                .filter((source) => this.scopes.get(sourceBinding(source))?.allowTitles)
                .map((entry) => entry.id),
        );
        const error = allowed.find((source) => source.sync.phase === 'error');
        const last = allowed.map(({ sync }) => sync.lastSuccess);
        let phase: SyncState['phase'] = 'idle';
        if (error) phase = 'error';
        else if (allowed.some(({ sync }) => sync.phase === 'syncing')) phase = 'syncing';
        else if (allowed.length && allowed.every(({ sync }) => sync.phase === 'ok')) phase = 'ok';
        return {
            ...view,
            events: view.events.filter((event) => event.accountId && ids.has(event.accountId)),
            titleAccounts,
            sync: {
                phase,
                lastSuccess: last.every(Boolean) ? last.toSorted()[0] : undefined,
                errorKind: error?.sync.errorKind,
            },
        };
    }

    /** Account changes revoke immediately, including while a confirmation/startup is pending. */
    revoke(): void {
        this.close();
        this.binding = this.currentBinding();
        try {
            this.store.save(this.binding, NO_MCP_ACCESS);
        } catch {
            this.failed = true;
        }
    }

    /** App shutdown removes the ephemeral key, while the user's saved permission survives restart. */
    close(): void {
        this.epoch += 1;
        this.bridge?.close();
        this.bridge = undefined;
        this.access = { ...NO_MCP_ACCESS };
        this.catalog = new McpCatalog();
        try {
            this.store.removeConnection();
        } catch {
            this.failed = true;
        }
    }

    private async restart(): Promise<void> {
        const { epoch } = this;
        const { binding } = this;
        const bridge = await startReadBridge((tool, args) => {
            if (epoch !== this.epoch || !this.access.enabled || binding !== this.currentBinding())
                throw new Error('MCP access revoked');
            return this.catalog.read(tool, args, this.calendarView(), this.access);
        });
        if (epoch !== this.epoch || binding !== this.currentBinding()) {
            bridge.close();
            return;
        }
        try {
            writePrivateJson(this.store.connectionFile, bridge.connection);
            this.bridge = bridge;
        } catch {
            bridge.close();
            throw new Error('MCP connection unavailable');
        }
    }
}
