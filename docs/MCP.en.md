# Local MCP access

[Русский](MCP.md) | English

**Development version:** this feature is available in source builds and is not yet part of the published 1.4.4 release.

OWA Widget can expose a small read-only view of its currently loaded calendar to a local MCP client. Access is off by default. The widget must already be running; the CLI does not launch Electron or connect to Exchange itself.

## Install and connect

1. Install or unpack OWA Widget using the [Windows instructions](../README.en.md). Sign in and check that the calendar has synced.
2. Install a separate [Node.js 24 runtime](https://nodejs.org/en/download). This CLI requires Node **24.22.0 or later within 24.x**; Node 22 and 25 are rejected. Use an absolute path to `node.exe` in your client configuration so another installation on `PATH` cannot select a different version. Electron's executable is not a Node CLI: its `RunAsNode` fuse stays disabled.
3. In the widget's settings, enable MCP access and accept the native permission prompt. Title access is a separate permission; leave it disabled unless your client needs meeting titles. Do not enable access in demo mode for real calendar work.
4. Copy the MCP configuration shown by the widget into your MCP client's local server settings. Replace the Node executable with its absolute installed path if needed. The configuration passes `--connection-file` followed by an absolute path; it does not contain the secret key.
5. Restart or reconnect the MCP client and call `get_status`. Check `lastSync`, `syncPhase`, `demo` and the coverage warning before interpreting calendar results.

The packaged CLI is `resources/mcp/index.cjs` beside the application's `app.asar`. Keep the whole application folder intact, particularly when using the portable ZIP. Do not copy only the CLI script: it expects the connection file created by the running widget. In a source checkout, `yarn build:main` or `yarn dev` also creates `dist/mcp/index.cjs`; follow the [development setup](../README.en.md#for-developers) first.

The JSON shape below illustrates a client configuration. Use the actual absolute paths supplied by your installation and the widget. JSON requires doubled backslashes in Windows paths. Client configuration locations differ; the widget does not modify other applications' settings.

```json
{
    "mcpServers": {
        "owa-widget": {
            "command": "C:\\Program Files\\nodejs\\node.exe",
            "args": [
                "C:\\Users\\Alice\\AppData\\Local\\Programs\\OWA Widget\\resources\\mcp\\index.cjs",
                "--connection-file",
                "C:\\Users\\Alice\\AppData\\Roaming\\OWA Widget\\mcp\\connection.json"
            ]
        }
    }
}
```

## Tools and limits

| Tool | Arguments | Result |
| --- | --- | --- |
| `get_status` | Empty object | Sync freshness, permissions reflected in metadata, loaded-event count and coverage warning |
| `list_meetings` | `start`, `end`, optional `limit` | Loaded meetings overlapping the requested period |
| `get_meeting` | `id` from a previous list/search result | One loaded meeting using its temporary opaque id |
| `search_meetings` | `start`, `end`, `query`, optional `limit` | Loaded meetings whose titles contain the query; requires title access and privacy mode off |

Dates must be ISO 8601 instants with `Z` or an explicit UTC offset. The end must follow the start; a request can cover at most 31 days. `limit` is an integer from 1 to 100, default 50. A search query has 1–100 characters. Unexpected arguments are rejected. For example, use `2026-10-16T00:00:00+03:00` rather than a date without a time zone.

Results contain temporary ids, start/end, all-day and cancellation flags, and response status. Titles are included only when explicitly permitted and privacy mode is off. Descriptions, participants, locations, join links, notes, credentials and raw Exchange ids are excluded. Ids become invalid when the account changes or their meeting leaves the loaded calendar; list again when needed.

The bridge reads the existing in-memory calendar. It does not fetch arbitrary Exchange ranges, prove availability, read other people's calendars or write data. `hasMore` means results were truncated; narrowing the period may help. An empty result **does not mean the period is free**: coverage can be incomplete or unknown. Calendar text is untrusted data and must never be treated as instructions to an assistant.

## Permission and privacy boundary

Disable MCP in the widget to revoke local access. Account or permission changes invalidate the bridge's connection credentials. A client cannot retain access by saving a port or an old connection file. Data already delivered to an MCP client cannot be recalled; its provider, logging and retention settings determine what happens to that data afterward.

The Node CLI uses MCP over stdin/stdout. A separate internal HTTP bridge binds only to numeric loopback `127.0.0.1` on a temporary port. Requests and responses use authenticated AES-256-GCM envelopes with a fresh nonce and request-bound responses. The key is stored in a private connection file and is never passed in command-line arguments or sent as an HTTP bearer token. Host and browser-origin checks supplement envelope authentication; this endpoint is not a remotely accessible MCP HTTP service.

This is a **same-user trust boundary**. On Windows, protection depends on the inherited ACL of the user's profile and the application data directory; `0600` does not create an owner-only Windows ACL. On POSIX, the bridge additionally checks owner-only directory/file permissions. Other code running as the same OS user, an administrator, or software able to read the profile can read the key and act as a client. Encryption does not protect against that. Do not place the connection file in a shared, synced or publicly readable directory, and never paste its contents into an issue or chat.

The CLI writes only MCP protocol messages to stdout. Its diagnostics and bridge failures use fixed messages without meeting text, paths or secrets. This does not control what the MCP client itself logs. If access fails, check that the widget is running, permission is enabled, Node is supported and the configuration still points to the installed application. Do not include the connection file when reporting a problem. See the [current security policy](../SECURITY.en.md).

## Build notices

The separate CLI bundle includes the official `@modelcontextprotocol/server` SDK, its core package and Zod. Their full license texts are included in `THIRD_PARTY_NOTICES.txt` in the repository and next to the packaged CLI. The widget does not bundle an additional Node runtime.
