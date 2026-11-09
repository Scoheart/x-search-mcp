# Design Document: @scoheart/x-search-mcp

## 1. Architectural Overview

`@scoheart/x-search-mcp` is designed as a standalone, lightweight, read-only Model Context Protocol (MCP) server that exposes the `x_search` tool to AI agent runners (e.g. Claude Desktop, Cline, Cursor, Codex).

```
                      +-----------------------------+
                      |     AI Agent Client         |
                      +-----------------------------+
                                     |  (stdio JSON-RPC)
                                     v
                      +-----------------------------+
                      |       McpServer             |
                      |  - Tool: x_search           |
                      |  - Annotations (readOnly)   |
                      +-----------------------------+
                                     |
               +---------------------+---------------------+
               |                                           |
               v                                           v
    +--------------------+                       +--------------------+
    | Parameter Validator|                       | Credential Manager |
    | - Zod & Calendar   |                       | - API Key (Direct) |
    | - Mutual Exclusive |                       | - OAuth Device Code|
    +--------------------+                       | - proper-lockfile  |
               |                                 +--------------------+
               +---------------------+---------------------+
                                     |
                                     v
                      +-----------------------------+
                      |   HTTP Layer (Undici)       |
                      | - EnvHttpProxyAgent         |
                      | - Timeout & Cancellation    |
                      | - 5xx & Network Retries     |
                      | - Single 401 Force Refresh  |
                      +-----------------------------+
                                     |  (HTTPS POST)
                                     v
                      +-----------------------------+
                      |   xAI Responses API         |
                      |   https://api.x.ai/v1/      |
                      +-----------------------------+
```

## 2. Key Modules and Responsibilities

- **`src/types.ts`**: Pure TypeScript interface declarations covering parameters, results, tokens, config, and internal calls.
- **`src/config.ts`**: Environment parsing with range validations and fallback handling. Ensures sensitive secrets are never logged or exported.
- **`src/http.ts`**: Resilient HTTP client using Undici's `request` and `EnvHttpProxyAgent`. Implements exponential backoff, AbortSignal forwarding, and sanitizes upstream error responses into fixed error codes.
- **`src/auth.ts`**: OAuth 2.0 Device Authorization Grant flow with endpoint validation against `*.x.ai`. Multi-process file lock concurrency via `proper-lockfile` and atomic file swapping.
- **`src/search.ts`**: Pre-flight parameter validation, credential selection, request serialization to xAI responses API, response parsing, citation extraction, degradation detection, and internal tool call observation.
- **`src/server.ts`**: McpServer instance registration with Zod schemas and annotations. Ensures standard MCP formatting and error resilience.
- **`src/cli.ts`**: Command-line router handling stdio server, auth subcommands (`login`, `status`, `logout`), config exporter, and search diagnostics.

## 3. Concurrency & OAuth Token Management

### State Transitions

```
[Unauthenticated] ---> (loginWithDeviceCode) ---> [Authorized]
                                                        |
                                                        v
                 [Token Valid (>120s remaining)] <------+
                                |
             (time remaining <= 120s or HTTP 401)
                                |
                                v
               [Acquire proper-lockfile on auth.json]
                                |
                   +------------+------------+
                   |                         |
            (Token already            (Token still stale)
           refreshed by peer)                |
                   |                         v
                   |              [Call Token Endpoint]
                   |              (grant_type=refresh_token)
                   |                         |
                   |                         v
                   |              [Atomic File Write (0600)]
                   |                         |
                   +------------+------------+
                                |
                                v
                       [Release File Lock]
```

### File-Lock Safety

Multiple local agent instances share the same `auth.json`. To prevent concurrent token refreshes from invalidating rotating refresh tokens:
1. Lock acquired using `proper-lockfile` with 100 retries, factor 1.1, minTimeout 100ms, maxTimeout 500ms.
2. File contents re-read inside the critical section.
3. If another process refreshed the token in the interim, the fresh token is returned immediately without re-refreshing.
4. Updates written to a randomized `.tmp` file and atomically renamed with `0600` permissions.

## 4. Degraded State Determination

- If upstream returns zero citations and zero inline annotations:
  - `has_citations` is strictly set to `false`.
  - `degraded` is set to `true`.
  - `degraded_reason` is set to `"No source citations returned by upstream x_search"`.
  - A warning is appended to alert the calling agent that the answer cannot be treated as grounded evidence.

## 5. Security & Privacy Guarantees

- **No Credential Echoing**: Upstream error bodies are never returned verbatim to MCP clients. Each call still writes a local `0600` JSON log containing the request body and raw upstream response; credential fields and token-shaped strings are redacted before that write. The client receives only `log_file`.
- **Strict HTTPS and Domain Verification**: OAuth discovery and token endpoints must strictly resolve to `https://*.x.ai` on port 443 with no embedded URL credentials.
- **Redirect Isolation**: HTTP client does not automatically follow redirects with authorization headers (`maxRedirections: 0`).
