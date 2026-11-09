# Implementation Plan: @scoheart/x-search-mcp

## 1. Project Specifications

- **Package Name**: `@scoheart/x-search-mcp`
- **Version**: `0.1.0`
- **Language**: TypeScript (`ES2022`, `NodeNext`)
- **Runtime**: Node.js `>=22.19.0`
- **Dependencies**:
  - `@modelcontextprotocol/server`: `2.4.0`
  - `proper-lockfile`: `4.1.2`
  - `undici`: `8.12.4`
  - `zod`: `4.6.7`
- **DevDependencies**:
  - `typescript`: `^5.8.0`
  - `@types/node`: `^22.13.0`
  - `@types/proper-lockfile`: `^4.1.4`

## 2. Directory Layout

```
.
├── .env.example
├── .gitignore
├── LICENSE
├── package.json
├── README.md
├── THIRD_PARTY_NOTICES.md
├── TOOL.md
├── tsconfig.json
├── bin/
│   ├── x-search-mcp.js
│   └── x-search-mcp.ts
├── docs/
│   ├── design.md
│   └── implementation-plan.md
├── examples/
│   ├── codex.toml
│   └── mcp.json
└── src/
    ├── auth.ts
    ├── cli.ts
    ├── config.ts
    ├── http.ts
    ├── index.ts
    ├── search.ts
    ├── server.ts
    └── types.ts
```

## 3. Implementation Checklist

- [x] TypeScript types for inputs, outputs, credentials, and internal state (`src/types.ts`).
- [x] Environment configuration loader with bounds checks and `.env` support (`src/config.ts`).
- [x] Resilient HTTP client with Undici `EnvHttpProxyAgent`, bounded retry, cancellation, and error sanitization (`src/http.ts`).
- [x] Device Code OAuth 2.0 flow with proper-lockfile concurrency and atomic token persistence (`src/auth.ts`).
- [x] Parameter validation, xAI Responses API integration, citation and tool call parser (`src/search.ts`).
- [x] McpServer registration with tool annotations and dual structured/text outputs (`src/server.ts`).
- [x] CLI entry point supporting stdio, auth, config, and direct search (`src/cli.ts`, `bin/x-search-mcp.js`).
- [x] Comprehensive documentation in Chinese (`TOOL.md`) and English (`README.md`).
- [x] Reference notices for Hermes Agent commit `fcca1740533d59d7a46ab1a3a53d3a45ef3127ff` (`THIRD_PARTY_NOTICES.md`).
- [x] Example client configuration files for MCP clients (`examples/mcp.json`, `examples/codex.toml`).

## 4. Error Taxonomy & Local Codes

| Error Code | HTTP Status | Meaning |
|---|---|---|
| `UPSTREAM_AUTH_ERROR` | 401 | Invalid or expired credentials rejected by xAI |
| `UPSTREAM_FORBIDDEN` | 403 | Missing balance or X Search subscription entitlement |
| `UPSTREAM_NOT_FOUND` | 404 | Endpoint or model not found on upstream service |
| `UPSTREAM_RATE_LIMITED` | 429 | Upstream request quota or rate limit exceeded |
| `UPSTREAM_SERVER_ERROR` | 5xx | Transient xAI infrastructure error |
| `NETWORK_ERROR` | null | Connection refused, DNS failure, or socket reset |
| `TIMEOUT` | null | Operation exceeded configured timeout limit |
| `CANCELLED` | null | Calling agent explicitly aborted the MCP request signal |
| `SEARCH_ERROR` | null | General tool execution or parsing error |
