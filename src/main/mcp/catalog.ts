// Reads a snapshot only: no Exchange client, network access or calendar write operations.
import { randomUUID } from 'node:crypto';

import { type McpAccess } from '../../shared/mcp';

import { type CatalogRequest, catalogRequest } from './catalogArguments';
import {
    type CatalogEntry,
    catalogEntry,
    catalogMetadata,
    catalogTitle,
    type McpCalendarView,
    type McpPayload,
    projectMeeting,
} from './catalogProjection';

export { type McpCalendarView, type McpPayload } from './catalogProjection';

const DISABLED: McpAccess = { enabled: false, allowTitles: false };
const MAX_IDS = 5000;
type ListRequest = Extract<CatalogRequest, { period: unknown }>;

export class McpCatalog {
    private revision = -1;
    private account = '';
    private readonly ids = new Map<string, string>();
    private readonly rawIds = new Map<string, string>();

    read(
        tool: string,
        args: unknown,
        view: McpCalendarView,
        access: McpAccess = DISABLED,
    ): McpPayload {
        if (access.enabled !== true) {
            this.clearIds();
            throw new Error('MCP access is disabled');
        }
        const titles = access.allowTitles === true && !view.privacyMode;
        this.reconcileIds(view);
        const request = catalogRequest(tool, args, titles);
        const metadata = catalogMetadata(view, titles);
        switch (request.tool) {
            case 'get_status':
                return { metadata, loadedMeetings: view.events.length };
            case 'get_meeting':
                return { metadata, meeting: this.meeting(request.id, view, titles) };
            default:
                return { metadata, ...this.list(request, view, titles) };
        }
    }

    private clearIds() {
        this.ids.clear();
        this.rawIds.clear();
    }

    private reconcileIds(view: McpCalendarView) {
        if (this.revision !== view.revision || this.account !== view.account) {
            this.revision = view.revision;
            this.account = view.account;
            this.clearIds();
        }
        // An expired entry cannot stay accessible through an old ID or accumulate a mapping.
        const present = new Set(view.events.map((event) => event.id));
        for (const [rawId, id] of this.ids) {
            if (!present.has(rawId)) {
                this.ids.delete(rawId);
                this.rawIds.delete(id);
            }
        }
    }

    private opaqueId(rawId: string): string {
        const existing = this.ids.get(rawId);
        if (existing) return existing;
        if (this.ids.size >= MAX_IDS) throw new Error('Calendar result limit reached');
        const id = randomUUID();
        this.ids.set(rawId, id);
        this.rawIds.set(id, rawId);
        return id;
    }

    private meeting(id: string, view: McpCalendarView, titles: boolean): McpPayload {
        const rawId = this.rawIds.get(id);
        const event =
            rawId === undefined ? undefined : view.events.find((item) => item.id === rawId);
        const entry = event ? catalogEntry(event) : null;
        if (!entry) throw new Error('Meeting unavailable; list meetings again');
        return projectMeeting(entry, id, titles);
    }

    private list(request: ListRequest, view: McpCalendarView, titles: boolean): McpPayload {
        const matches: CatalogEntry[] = [];
        for (const event of view.events) {
            const entry = catalogEntry(event);
            if (!entry || entry.start >= request.period.to || entry.end <= request.period.from)
                continue;
            // Search only the subject that can be returned, never hidden or truncated text.
            if (request.query && !catalogTitle(event).toLowerCase().includes(request.query))
                continue;
            matches.push(entry);
        }
        matches.sort((a, b) => a.start - b.start || a.end - b.end);
        return {
            requestedPeriod: { start: request.period.start, end: request.period.end },
            meetings: matches
                .slice(0, request.limit)
                .map((entry) => projectMeeting(entry, this.opaqueId(entry.event.id), titles)),
            hasMore: matches.length > request.limit,
        };
    }
}
