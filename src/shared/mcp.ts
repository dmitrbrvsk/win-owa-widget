export interface McpAccess {
    enabled: boolean;
    allowTitles: boolean;
}
export interface McpUiState {
    access: McpAccess;
    running: boolean;
    configuration: string;
    error?: 'unavailable';
    demo?: boolean;
}
export interface McpApi {
    getMcpState(): Promise<McpUiState>;
    /** Widening access requires native consent; reductions apply immediately. */
    setMcpAccess(access: McpAccess): Promise<McpUiState>;
}

export const MCP_TOOL_NAMES = [
    'get_status',
    'list_meetings',
    'get_meeting',
    'search_meetings',
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export function parseMcpAccess(raw: unknown): McpAccess {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('Недопустимые разрешения MCP');
    const r = raw as Record<string, unknown>;
    if (
        typeof r.enabled !== 'boolean' ||
        typeof r.allowTitles !== 'boolean' ||
        Object.keys(r).some((k) => k !== 'enabled' && k !== 'allowTitles')
    )
        throw new Error('Недопустимые разрешения MCP');
    return { enabled: r.enabled, allowTitles: r.allowTitles };
}
