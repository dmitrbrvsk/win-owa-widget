import { writePrivateJson } from '../../mcp/privateFiles';
import { type McpAccess, type McpUiState, parseMcpAccess } from '../../shared/mcp';
import { RequestGate } from '../limits';

import { accountBinding, McpAccessStore, NO_MCP_ACCESS } from './accessStore';
import { type ReadBridge, startReadBridge } from './bridge';
import { type McpCalendarView, McpCatalog } from './catalog';

interface ControllerOptions {
    directory: string;
    cliPath: string;
    view(): McpCalendarView;
    confirm(access: McpAccess): Promise<boolean>;
}

export class McpController {
    private readonly store: McpAccessStore;
    private catalog = new McpCatalog();
    private readonly consentGate = new RequestGate(1, 3, 60_000);
    private access = { ...NO_MCP_ACCESS };
    private binding = '';
    private epoch = 0;
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
        this.access = this.store.load(this.binding);
        try {
            if (this.access.enabled) await this.restart();
        } catch {
            this.close();
            this.failed = true;
        }
    }

    state(): McpUiState {
        if (this.access.enabled && this.binding !== this.currentBinding()) this.revoke();
        const running = !!this.bridge && this.access.enabled;
        return {
            access: { ...this.access },
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

    async setAccess(raw: unknown): Promise<McpUiState> {
        const parsed = parseMcpAccess(raw);
        const next = parsed.enabled ? parsed : { ...NO_MCP_ACCESS };
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
            return this.catalog.read(tool, args, this.options.view(), this.access);
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
