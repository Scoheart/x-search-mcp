# @scoheart/x-search-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Independent Model Context Protocol (MCP) server providing real-time `x_search` capabilities using xAI's responses API, inspired by Nous Research's Hermes Agent.

## Quick Start

### Installation

```bash
git clone https://github.com/Scoheart/x-search-mcp.git
cd x-search-mcp
npm install
npm run build
```

### Authentication

Choose between direct API Key or Subscription OAuth:

```bash
# 1. Using API Key
export XAI_API_KEY="xai-your-api-key"

# 2. Or using Grok Subscription via Device Code OAuth
node bin/x-search-mcp.js auth login
```

### Run Server

```bash
# stdio MCP server for agent clients (Claude Desktop, Cursor, Cline, etc.)
node bin/x-search-mcp.js
```

See [TOOL.md](./TOOL.md) for full Chinese documentation, parameters, and configuration options.

## License

[MIT](./LICENSE) © Scoheart  
See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for third-party notices (Hermes Agent).
