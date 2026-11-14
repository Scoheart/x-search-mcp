# @scoheart/x-search-mcp 工具接入与使用说明

本工具是一个独立运行的 Node.js/TypeScript MCP 服务，提供只读工具 `x_search`，支持通过 xAI Responses API 对 X（原 Twitter）实时动态与历史发帖进行检索。本服务实现参考 Nous Research 的 Hermes Agent（commit `fcca1740533d59d7a46ab1a3a53d3a45ef3127ff`），但作为独立 MCP 包提供，无需安装或运行 Hermes。

---

## 核心特性

- **标准 MCP 协议**：基于 `@modelcontextprotocol/server`，默认运行在 `stdio` 模式，输出标准 JSON-RPC。
- **只读与安全性**：仅提供 `x_search` 检索工具，无发帖、点赞、关注或私信写操作；错误信息经由本地脱敏，不回显 upstream token/key。
- **双认证模式**：支持按量付费 API Key 与 Grok 订阅 OAuth（设备码登录）；支持多进程并发共享令牌并带文件锁（`proper-lockfile`）。
- **来源与降级感知**：提取结构化 citations 与正文 inline_citations。若上游无有效引用来源，自动标记 `degraded: true`。
- **原生双传输**：默认 stdio；`http` / `--http` 使用官方 SDK 的无状态 Streamable HTTP，兼容 2026 与 2025 两代协议。

---

## 约束与边界说明（重要）

1. **非官方项目**：本项目为独立开源 MCP 实现，并非 xAI 或 Nous Research / Hermes 官方 MCP。
2. **传输与访问范围**。默认 stdio 供本机子进程接入。单账号 HTTP 默认监听 `127.0.0.1:8000/mcp`，客户端使用独立 Bearer 密钥。多人 HTTP 通过身份服务进行 MCP OAuth 登录，每人绑定自己的 xAI API Key。公网接入通过 HTTPS 反向代理配置。 [多人部署说明](./docs/multi-user.md)
3. **公共 OAuth Client ID 说明**：默认内置的公开客户端 ID 来自 Hermes Agent（`b1a00492-073a-47ea-816f-4c329264a828`）。在浏览器授权确认页面中可能会显示该客户端标识名称。如需使用专属客户端，可通过 `XAI_OAUTH_CLIENT_ID` 环境变量配置。
4. **OAuth 成功不等于搜索可用**：OAuth 设备码登录成功仅代表获得 xAI 账号凭证，实际搜索能力及并发额度由 xAI 云端及订阅权益决定；登录成功不保证账号一定具备 X Search 权限。
5. **无引用不可作为确证**：当结果标记为 `has_citations: false` / `degraded: true` 时，表示上游未返回任何经过验证的 URL 引用，该回答不可作为来源充分的 X 检索事实依据。
6. **计费与回退规则**：
   - API Key 模式下按调用量付费（api_metered）。
   - 显式 `oauth` 模式下仅使用订阅令牌，**绝不回退**到付费 API Key，避免产生非预期账单。
   - `auto` 模式优先使用 API Key（如果配置），无 Key 时使用本地保存的 OAuth。
7. **重试消耗**。stdio 和单账号 HTTP 遇到网络波动或 5xx 错误时可执行有限次数退避重试，可能重复消耗上游额度。多人 HTTP 每次搜索只发起一次上游请求。
8. **过滤作用域限制**：xAI 接口的 `allowed_x_handles`、`excluded_x_handles`、`from_date` 和 `to_date` 过滤主要作用于关键词与语义搜索阶段，并不严格保证限制上游服务端内部的级联线程抓取（thread fetch）。

---

## npm 安装与打包

需要 Node.js 22.19.0 或更高版本。可以用 `npx` 直接运行。

```bash
npx --yes @scoheart/x-search-mcp@0.3.0 auth login
npx --yes @scoheart/x-search-mcp@0.3.0 auth status
```

也可以在源码仓库运行 `npm ci` 和 `npm pack` 生成安装包。`prepack` 会先编译当前源码，安装端无需 TypeScript 或开发依赖。

```bash
npm install --global ./scoheart-x-search-mcp-0.3.0.tgz
x-search-mcp auth status
```

包通过 `files` 白名单包含代码、示例和文档；OAuth 凭据和调用日志存放在用户配置目录，不随包分发。

## 凭证配置

### 方式 1：API Key（按量计费）

直接设置环境变量或指向私有文件：
```bash
export XAI_API_KEY="xai-xxxxxxxxxxxxxxxxxxxx"
# 或
export XAI_API_KEY_FILE="/path/to/private/xai-key.txt"
```

### 方式 2：Grok 订阅 OAuth（设备码流程）

无需购买 API Key，使用包含 X Search 权益的 xAI 账号直接在终端完成登录：

```bash
# 执行设备码登录
x-search-mcp auth login
```

终端将输出授权网址与用户确认码：
```text
1. Visit the authorization page: https://auth.x.ai/oauth2/device/code
2. Confirm code: ABCD-EFGH
3. Code expires at: 20:30:00
Waiting for browser authorization...
```
在浏览器中打开链接、输入确认码并批准后，令牌将原子写入本地配置文件：
- 默认路径：`~/.config/x-search-mcp/auth.json`（权限 `0600`，目录权限 `0700`）
- 自定义路径：可通过 `X_SEARCH_AUTH_FILE` 覆盖。

### 凭证状态与注销

```bash
# 查看凭证配置状态（不探测额度、不泄露密钥内容）
x-search-mcp auth status

# 清除本地 OAuth 令牌文件（不影响云端授权及 API Key）
x-search-mcp auth logout
```

---

## CLI 命令一览

| 命令 | 说明 |
|---|---|
| `x-search-mcp` 或 `x-search-mcp --stdio` | 默认启动 MCP stdio 服务（供 Agent 客户端调用） |
| `x-search-mcp http [options]` 或 `x-search-mcp --http [options]` | 启动单账号 Streamable HTTP，使用独立访问密钥 |
| `x-search-mcp http --multi-user` | 启动受邀多用户模式，各自绑定 xAI API Key，配置见 [多人部署说明](./docs/multi-user.md) |
| `x-search-mcp --help` / `x-search-mcp http --help` | 查看命令与 HTTP 参数 |
| `x-search-mcp auth login` | 发起 OAuth 设备码登录并在终端交互 |
| `x-search-mcp auth status` | 安全输出当前认证模式、Key/OAuth 就绪状态 |
| `x-search-mcp auth logout` | 在文件锁保护下安全删除本地 OAuth 凭据 |
| `x-search-mcp config` | 打印安全的标准 `mcpServers` JSON 配置（不导出密钥） |
| `x-search-mcp search "<query>"` | 直接在命令行测试搜索并输出结构化 JSON |
| `x-search-mcp logs` | 列出最近的本地调用日志路径 |

---

## 环境变量参考

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `XAI_API_KEY` | - | xAI API Key（优先级高于文件） |
| `XAI_API_KEY_FILE` | - | 存放 API Key 的私有文件路径 |
| `X_SEARCH_AUTH_MODE` | `auto` | 认证模式：`auto`、`api_key`、`oauth` |
| `X_SEARCH_AUTH_FILE` | `~/.config/x-search-mcp/auth.json` | 本地 OAuth 凭证文件路径 |
| `XAI_OAUTH_CLIENT_ID` | `b1a00492-073a-47ea-816f-4c329264a828` | OAuth 公开客户端 ID |
| `X_SEARCH_MODEL` | `grok-4.5` | 搜索调用模型 |
| `X_SEARCH_TIMEOUT_SECONDS` | `180` | 请求超时时间（秒，范围 5–600） |
| `X_SEARCH_RETRIES` | `2` | stdio 和单账号 HTTP 的失败重试次数（网络/5xx，范围 0–3） |
| `X_SEARCH_MAX_TURNS` | `4` | 内部搜索轮数（范围 1–20） |
| `X_SEARCH_REASONING_EFFORT`| - | 思考深度：`low` / `medium` / `high` / `xhigh` |
| `X_SEARCH_ENV_FILE` | - | 显式指定 `.env` 文件（通过 `process.loadEnvFile` 加载） |
| `X_SEARCH_LOG` | `on` | stdio 和单账号 HTTP 是否保存调用日志（`on` / `off`） |
| `X_SEARCH_LOG_DIR` | `~/.config/x-search-mcp/logs` | 调用日志目录 |
| `X_SEARCH_LOG_KEEP` | `100` | 保留最近多少份日志；`0` 表示不清理 |
| `X_SEARCH_LOG_MAX_BYTES` | `8388608` | 单次原始响应写入上限；超出后截断并标记 |
| `HTTP_PROXY` / `HTTPS_PROXY` | - | 标准 HTTP/HTTPS 代理配置 |

### HTTP 服务配置

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `X_SEARCH_HTTP_TOKEN` | - | HTTP MCP 的独立 Bearer 密钥；不输出到日志 |
| `X_SEARCH_HTTP_TOKEN_FILE` | - | 仅包含 HTTP 密钥的私有文件，启动时读取 |
| `X_SEARCH_HTTP_HOST` | `127.0.0.1` | 监听地址；远端接入通常由本机 HTTPS 反代转发 |
| `X_SEARCH_HTTP_PORT` | `8000` | TCP 端口；`0` 自动分配 |
| `X_SEARCH_HTTP_PATH` | `/mcp` | 规范化 URL 路径，不含查询参数或片段 |
| `X_SEARCH_HTTP_ALLOWED_HOSTS` | - | 额外允许的 Host 主机名，逗号分隔，不含协议或端口 |
| `X_SEARCH_HTTP_ALLOWED_ORIGINS` | - | 明确允许的浏览器 Origin，逗号分隔，匹配协议、主机和端口 |

同名 CLI 参数覆盖环境默认值。`--allowed-host` 与 `--allowed-origin` 可重复；提供这类参数时使用命令行列表。显式 `--token-file` 优先，否则非空 `X_SEARCH_HTTP_TOKEN` 优先于环境 token 文件。空密钥、非法路径、非法端口或不可读文件会阻止启动。

HTTP 请求体默认上限为 1 MiB。`SIGINT`/`SIGTERM` 停止服务并取消活动请求；上游超时和客户端取消持续覆盖响应体读取阶段。

退出会取消尚在等待 OAuth 文件锁的请求。已经发出的刷新请求可能轮换 refresh token，因此服务会等待它完成原子保存，再完成退出；该阶段受独立的 30 秒刷新超时约束。取消后不会继续发起搜索。

---

## 调用日志

stdio 和单账号 HTTP 默认在本地记录发给 xAI 的请求体和上游原始响应，并在工具结果中提供 `log_file` 路径。多人 HTTP 关闭调用日志。

- 默认目录：`~/.config/x-search-mcp/logs/`
- 文件权限：`0600`，目录权限：`0700`
- 字段：`request`、`attempts[].raw_response`、顶层 `raw_response`（最后一次尝试）
- 凭证处理：不记录 `Authorization`；`access_token`、`api_key` 等字段以及 `Bearer` / `xai-` 形态的字符串会替换成 `[redacted]`
- 失败调用也会写日志。HTTP 错误正文只进本地文件，不回传给 MCP 客户端
- 查看最近日志：`x-search-mcp logs`

日志写入失败不会让搜索失败；结果的 `warnings` 会说明日志没写上。

## Agent 接入配置

### 单账号 HTTP

源码构建后执行：

```bash
export X_SEARCH_AUTH_MODE=oauth
export X_SEARCH_HTTP_TOKEN="$(openssl rand -hex 32)"
node bin/x-search-mcp.js http --port 8000
```

安装后可直接使用 `x-search-mcp http`。客户端选择 **Streamable HTTP**，填写 `http://127.0.0.1:8000/mcp`，请求头设为 `Authorization: Bearer <X_SEARCH_HTTP_TOKEN 的值>`。未带正确密钥返回 401。来源 Host 或 Origin 未获允许时返回 403。

服务使用同一份本机 Grok 凭证和调用日志；MCP 无状态表示不保存连接会话，不会清除 OAuth 登录。新旧协议都由同一个工具工厂处理，不需要网关子进程。

若经域名代理，配置 `--allowed-host mcp.example.com`，让客户端连接 `https://mcp.example.com/mcp`。浏览器跨站调用还需显式 `--allowed-origin https://app.example.com`；非浏览器客户端可以不发送 Origin。HTTP 密钥与 Grok 凭证、npm 发布 token 分开管理。

### 1. 通用 mcpServers JSON（Claude Desktop / Cline / Cursor 等）

在目标 Agent 的配置文件中添加：

```json
{
  "mcpServers": {
    "x-search": {
      "command": "npx",
      "args": ["--yes", "@scoheart/x-search-mcp@0.3.0"],
      "env": {
        "X_SEARCH_AUTH_MODE": "auto",
        "X_SEARCH_MODEL": "grok-4.5"
      },
      "timeout": 600
    }
  }
}
```

> 若安装的是本地 tarball，可改用 `"command": "x-search-mcp"`、`"args": []`，并确保客户端的 `PATH` 包含安装目录。也可以运行 `x-search-mcp config` 生成当前可执行入口的绝对路径配置。修改配置后请重启或重新加载 Agent 会话。Pi 使用 `--no-mcp` 启动时不会连接 MCP 服务。

### 2. Codex 配置 (`~/.codex/config.toml`)

```toml
[mcp_servers.x-search]
command = "npx"
args = ["--yes", "@scoheart/x-search-mcp@0.3.0"]
tool_timeout_sec = 600

[mcp_servers.x-search.env]
X_SEARCH_AUTH_MODE = "auto"
X_SEARCH_MODEL = "grok-4.5"
```

---

## 工具参数规范 (`x_search`)

```typescript
interface XSearchInput {
  query: string;                           // 必填，检索语句（trim 后非空，最大 16000 字符）
  allowed_x_handles?: string[];            // 可选，白名单账号（最多 10 个，无需 @，与 excluded 互斥）
  excluded_x_handles?: string[];           // 可选，黑名单账号（最多 10 个，无需 @，与 allowed 互斥）
  from_date?: string;                      // 可选，开始日期 YYYY-MM-DD（不能晚于当天 UTC，需严格早于 to_date）
  to_date?: string;                        // 可选，结束日期 YYYY-MM-DD（不包含当天）
  enable_image_understanding?: boolean;    // 可选，是否启用推文配图理解
  enable_video_understanding?: boolean;    // 可选，是否启用推文视频理解
  auth_mode?: 'auto' | 'api_key' | 'oauth';// 可选，单次调用的认证覆盖模式
}
```

### 返回结构示例

```json
{
  "success": true,
  "provider": "xai",
  "tool": "x_search",
  "model": "grok-4.5",
  "query": "OpenAI Sora news",
  "credential_source": "oauth",
  "billing_mode": "subscription_oauth",
  "answer": "最新动态包括...",
  "citations": [
    "https://x.com/OpenAI/status/123456789"
  ],
  "inline_citations": [
    {
      "url": "https://x.com/OpenAI/status/123456789",
      "title": "OpenAI on X",
      "start_index": 12,
      "end_index": 35
    }
  ],
  "has_citations": true,
  "degraded": false,
  "degraded_reason": null,
  "search_execution": "observed",
  "server_side_calls": [
    {
      "call_id": "xs_123456",
      "name": "x_keyword_search",
      "arguments": { "query": "OpenAI Sora" }
    }
  ],
  "response_status": "completed",
  "incomplete_details": null,
  "usage": {
    "prompt_tokens": 800,
    "completion_tokens": 350
  },
  "log_file": "/Users/username/.config/x-search-mcp/logs/call-20260814T120000000Z-ab12cd.json",
  "warnings": [
    "OAuth subscription search availability and quota are determined upstream by xAI; successful login does not guarantee search availability."
  ]
}
```
