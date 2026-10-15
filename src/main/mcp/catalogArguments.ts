import { MCP_TOOL_NAMES } from '../../shared/mcp';
import { parseIsoInstant } from '../../shared/validate';

const MAX_PERIOD_MS = 31 * 86_400_000;
const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export interface CatalogPeriod {
    from: number;
    to: number;
    start: string;
    end: string;
}

export type CatalogRequest =
    | { tool: 'get_status' }
    | { tool: 'get_meeting'; id: string }
    | {
          tool: 'list_meetings' | 'search_meetings';
          period: CatalogPeriod;
          limit: number;
          query: string;
      };

function argumentRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid MCP arguments');
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new Error('Invalid MCP arguments');
    return value as Record<string, unknown>;
}

function checkKeys(args: Record<string, unknown>, allowed: readonly string[]) {
    for (const key of Reflect.ownKeys(args)) {
        const descriptor = Object.getOwnPropertyDescriptor(args, key);
        if (
            typeof key !== 'string' ||
            !allowed.includes(key) ||
            !descriptor ||
            !('value' in descriptor)
        )
            throw new Error('Unexpected MCP argument');
    }
}

function meetingId(value: unknown): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid meeting id');
    return value.toLowerCase();
}

function period(args: Record<string, unknown>): CatalogPeriod {
    const from = parseIsoInstant(args.start);
    const to = parseIsoInstant(args.end);
    if (from === null || to === null) throw new Error('Invalid meeting period');
    if (to <= from || to - from > MAX_PERIOD_MS) throw new Error('Use a period of at most 31 days');
    return { from, to, start: new Date(from).toISOString(), end: new Date(to).toISOString() };
}

function resultLimit(args: Record<string, unknown>): number {
    if (!Object.hasOwn(args, 'limit')) return 50;
    const value = args.limit;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100)
        throw new Error('Use a limit between 1 and 100');
    return value;
}

function searchQuery(value: unknown): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > 100 || !value.trim())
        throw new Error('Use a query of 1 to 100 characters');
    return value.trim().toLowerCase();
}

/** Arguments cannot request extra fields or broaden the four read-only operations. */
export function catalogRequest(tool: string, raw: unknown, titles: boolean): CatalogRequest {
    const operation = MCP_TOOL_NAMES.find((name) => name === tool);
    if (!operation) throw new Error('Invalid MCP operation');
    if (operation === 'search_meetings' && !titles)
        throw new Error('Title search is disabled by permissions or privacy mode');
    const args = argumentRecord(raw);
    if (operation === 'get_status') {
        checkKeys(args, []);
        return { tool: operation };
    }
    if (operation === 'get_meeting') {
        checkKeys(args, ['id']);
        return { tool: operation, id: meetingId(args.id) };
    }
    checkKeys(
        args,
        operation === 'search_meetings'
            ? ['start', 'end', 'limit', 'query']
            : ['start', 'end', 'limit'],
    );
    return {
        tool: operation,
        period: period(args),
        limit: resultLimit(args),
        query: operation === 'search_meetings' ? searchQuery(args.query) : '',
    };
}
