# @scoheart/x-search-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Independent Model Context Protocol (MCP) server providing real-time `x_search` capabilities using xAI's responses API, inspired by Nous Research's Hermes Agent.

## Quick Start

### Installation

Requires Node.js **22.19.0 or later**.

Run the package directly with `npx`.

```bash
npx --yes @scoheart/x-search-mcp@0.2.0 auth login
npx --yes @scoheart/x-search-mcp@0.2.0 auth status
```

You can also install a locally built npm tarball.

```bash
npm install --global ./scoheart-x-search-mcp-0.2.0.tgz
x-search-mcp auth status
```

To build from source:

```bash
git clone https://github.com/Scoheart/x-search-mcp.git
cd x-search-mcp
npm ci
npm run build
# Build a distributable .tgz; prepack compiles the current source automatically.
npm pack
```

### Authentication

Choose between direct API Key or Subscription OAuth:

```bash
# 1. Using API Key
export XAI_API_KEY="xai-your-api-key"

# 2. Or using Grok Subscription via Device Code OAuth (source checkout)
node bin/x-search-mcp.js auth login
```

### Run Server

```bash
# stdio MCP server for agent clients (Claude Desktop, Cursor, Cline, etc.)
node bin/x-search-mcp.js
```

For an npm-installed package, use `x-search-mcp` in place of `node bin/x-search-mcp.js`.

### Native Streamable HTTP (0.2.0)

The server uses the official MCP SDK directly; it can serve both the 2026 protocol and stateless 2025-era Streamable HTTP clients. Default stdio startup remains available.

Run from a built source checkout:

```bash
export X_SEARCH_AUTH_MODE=oauth
export X_SEARCH_HTTP_TOKEN="$(openssl rand -hex 32)"
node bin/x-search-mcp.js http --port 8000
```

For an installed 0.2.0 package, use `x-search-mcp http` (or `x-search-mcp --http`). The default endpoint is `http://127.0.0.1:8000/mcp`. Each client supplies `Authorization: Bearer <the value of X_SEARCH_HTTP_TOKEN>`.

For a persistent credential, use `--token-file /path/to/private/http-token` or `X_SEARCH_HTTP_TOKEN_FILE` instead of an inline token. The file contains only the bearer token and should be private (`0600`). It is read at startup. An explicit `--token-file` overrides environment credentials; otherwise `X_SEARCH_HTTP_TOKEN` takes precedence over `X_SEARCH_HTTP_TOKEN_FILE`.

HTTP access uses its own credential. Grok subscription OAuth is completed on the server machine using `auth login`; its credential file and search logs remain there. All authorized callers use that service's configured Grok account. HTTP access currently supports clients with configured bearer headers, rather than an OAuth sign-in/discovery service.

For an HTTPS reverse proxy, keep the listener on loopback and explicitly allow the proxy's public Host hostname:

```bash
x-search-mcp http --token-file /path/to/private/http-token \
  --allowed-host mcp.example.com
```

Point the client at `https://mcp.example.com/mcp`. Configure proxy timeouts for long searches (the default upstream timeout is 180 seconds). If a browser client calls the service directly, add its exact origin, for example `--allowed-origin https://app.example.com`; preflight is enabled only for explicitly allowed origins. Host allowlist entries have no scheme or port. Origin allowlist entries include scheme and port and have no path.

`--host`, `--port`, `--path`, `--allowed-host` and `--allowed-origin` configure deployment; the two allowlist flags are repeatable. `SIGINT`/`SIGTERM` stop the listener and cancel active work, including OAuth lock waiters. An already submitted OAuth refresh is allowed to finish its atomic credential save before shutdown completes: aborting that exchange could lose an upstream-rotated refresh token. This phase has its own 30-second deadline. See `x-search-mcp http --help` and [TOOL.md](./TOOL.md) for environment defaults.

### MCP Client Configuration

Add this server to Pi's `~/.pi/agent/mcp.json` or another client that accepts `mcpServers`.

```json
{
  "mcpServers": {
    "x-search": {
      "command": "npx",
      "args": ["--yes", "@scoheart/x-search-mcp@0.2.0"],
      "env": {
        "X_SEARCH_AUTH_MODE": "oauth",
        "X_SEARCH_MODEL": "grok-4.5"
      },
      "timeout": 600
    }
  }
}
```

For a globally installed tarball, use `"command": "x-search-mcp"` and `"args": []`. The client must have Node/npm on its `PATH`; otherwise use the executable's absolute path. Restart or reload the client after changing its configuration. Pi sessions started with `--no-mcp` do not connect to MCP servers.

OAuth credentials and call logs stay in `~/.config/x-search-mcp/`; they are not included in the npm package. OAuth login does not guarantee X Search entitlement, and responses without source URLs are marked `degraded: true`.

See [TOOL.md](./TOOL.md) for full Chinese documentation, parameters, and configuration options.

## License

[MIT](./LICENSE) © Scoheart  
See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for third-party notices (Hermes Agent).
