# x-search-mcp

[![npm version](https://img.shields.io/npm/v/@scoheart/x-search-mcp)](https://www.npmjs.com/package/@scoheart/x-search-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A read-only MCP server for searching X through the xAI Responses API. Its `x_search` tool supports account and date filters and returns source links when xAI provides them.

[中文使用手册](./TOOL.md)

| If you want to… | Use | xAI credentials |
| --- | --- | --- |
| Search from Codex, Pi, or another local MCP client | [Local stdio](#connect-a-local-mcp-client) | Your API key or eligible Grok subscription |
| Use one account from several devices | [Single-account HTTP](#single-account-http) | One API key or eligible Grok subscription on the server |
| Let invited users share a URL and use their own xAI accounts | [Multi-user HTTP](#multi-user-http) | Each user binds an API key and uses their own xAI API quota |

## Quick start

Requires Node.js **22.19.0 or later**.

```sh
npm install --global @scoheart/x-search-mcp
```

Save your xAI API key in a private file and set `XAI_API_KEY_FILE`, or supply it through `XAI_API_KEY`. Then run a search from the terminal.

```sh
export XAI_API_KEY_FILE=/absolute/path/to/xai-api-key
x-search-mcp search "What did @SpaceX post about Starship this week?"
```

For a personal Grok subscription, sign in with the device code and explicitly select OAuth for the test. X Search access depends on your account's subscription entitlements.

```sh
x-search-mcp auth login
x-search-mcp auth status
x-search-mcp search "What did @SpaceX post about Starship this week?" --auth oauth
```

`X_SEARCH_AUTH_MODE=oauth` selects subscription credentials for local stdio or single-account HTTP. The default `auto` mode uses a configured API key first, then looks for a local OAuth login. See the [authentication and configuration reference](./TOOL.md#凭证配置).

## Connect a local MCP client

Run the command for your client after installing the package. The client launches `x-search-mcp` over stdio.

```sh
codex mcp add x-search -- x-search-mcp --stdio
# Or with Pi
pi mcp add x-search -- x-search-mcp --stdio
```

In your client, ask it to use `x_search` and include links to the source posts. If the client launches in a separate environment, put `XAI_API_KEY_FILE` or `X_SEARCH_AUTH_MODE=oauth` in the server's environment configuration. Use the absolute executable path if your client cannot find `x-search-mcp`.

See the [Codex TOML](./examples/codex.toml) and [generic MCP JSON](./examples/mcp.json) examples for running the package with `npx` from the client.

## Run over HTTP

Both modes use the official MCP SDK with Streamable HTTP.

### Single-account HTTP

Configure xAI credentials on the host that runs the service. Save a long, randomly generated MCP bearer token in a separate private file and start the server.

```sh
x-search-mcp http --token-file /absolute/path/to/mcp-token
```

Connect to `http://127.0.0.1:8000/mcp` with `Authorization: Bearer <MCP token>`. All callers use the host's configured xAI account. For remote access, keep the server on loopback, terminate HTTPS at a reverse proxy, and pass its hostname with `--allowed-host mcp.example.com`. See `x-search-mcp http --help` and the [HTTP configuration reference](./TOOL.md#http-服务配置).

### Multi-user HTTP

Deploy behind HTTPS with an MCP OAuth issuer and Alibaba Cloud KMS. Each invited user signs in to the same `/mcp` URL, opens `/settings` with the same identity, and binds their xAI API key. The server stores each binding encrypted and uses it for that user's searches. The settings page supports replacing and removing keys.

```sh
x-search-mcp http --multi-user --port 8000
```

See the [multi-user deployment guide](./docs/multi-user.md) for issuer setup, KMS permissions, reverse-proxy configuration, and Codex and Pi login commands. Grok subscription login is available in the personal modes.

## Results and logs

- `x_search` accepts a query, optional X account filters, and a date range. See the [tool parameters](./TOOL.md#工具参数规范-x_search).
- Results include the answer, citations, and available usage information. A result marked `degraded: true` lacks source links.
- By default, stdio and single-account HTTP save local call logs under `~/.config/x-search-mcp/logs/`. Multi-user HTTP disables those logs.

## Development

```sh
git clone https://github.com/Scoheart/x-search-mcp.git
cd x-search-mcp
npm ci
npm test
npm pack
```

`npm test` compiles the TypeScript and runs the tests. `npm pack` builds an installable tarball.

## License

[MIT](./LICENSE) © Scoheart. The implementation was inspired by Nous Research's Hermes Agent. See [third-party notices](./THIRD_PARTY_NOTICES.md).
