import { type McpApi, type McpUiState } from '../shared/mcp';

// Browser demos never start a transport or pretend that calendar access has been granted.
const unavailable = async (): Promise<McpUiState> => ({
    access: { enabled: false, allowTitles: false },
    running: false,
    configuration: '',
    error: 'unavailable',
    demo: true,
});

export function mockMcpApi(): McpApi {
    return { getMcpState: unavailable, setMcpAccess: unavailable };
}
