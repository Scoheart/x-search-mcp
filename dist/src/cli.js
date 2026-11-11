import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, startStdio } from './server.js';
import { startHttp } from './http-server.js';
import { loadHttpOptions } from './http-config.js';
import { loginWithDeviceCode, getAuthStatus, logout } from './auth.js';
import { executeSearch } from './search.js';
import { listCallLogs } from './call-log.js';
import { loadConfig } from './config.js';
export async function runCli(argv = process.argv.slice(2)) {
    const [command, subCommand, ...rest] = argv;
    if (command === '--help' || command === '-h' || command === 'help'
        || ((command === 'http' || command === '--http') && argv.slice(1).some(value => value === '--help' || value === '-h'))) {
        console.log(`Usage: x-search-mcp [--stdio] | http [options] | auth <login|status|logout> | config | search "<query>" | logs

Default: start the stdio MCP server. Use http (or --http) for native Streamable HTTP.

HTTP options:
  --host <address>          Bind address (default: 127.0.0.1)
  --port <number>           TCP port (default: 8000; 0 chooses an available port)
  --path <path>             MCP endpoint (default: /mcp)
  --token-file <file>       Private file containing the HTTP bearer token
  --allowed-host <hostname> Allow an additional Host hostname; repeatable, no ports
  --allowed-origin <url>    Allow an exact browser origin; repeatable

HTTP credentials: X_SEARCH_HTTP_TOKEN or X_SEARCH_HTTP_TOKEN_FILE.
Other HTTP environment defaults: X_SEARCH_HTTP_HOST, X_SEARCH_HTTP_PORT,
X_SEARCH_HTTP_PATH, X_SEARCH_HTTP_ALLOWED_HOSTS, X_SEARCH_HTTP_ALLOWED_ORIGINS.
Grok credentials remain server-side; HTTP access uses its own bearer token.`);
        return;
    }
    if (command === 'http' || command === '--http') {
        const service = await startHttp(createServer, loadHttpOptions(argv.slice(1)));
        const stop = () => {
            void service.close().catch(() => {
                console.error('Could not shut down the HTTP MCP service cleanly');
                process.exitCode = 1;
            }).finally(() => {
                process.off('SIGINT', stop);
                process.off('SIGTERM', stop);
            });
        };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
        console.error(`x-search-mcp HTTP listening at ${service.url}`);
        return;
    }
    // Default: run stdio MCP server
    if (!command || command === '--stdio') {
        await startStdio();
        return;
    }
    // auth command group
    if (command === 'auth') {
        if (subCommand === 'login') {
            await loginWithDeviceCode();
            return;
        }
        if (subCommand === 'status') {
            const status = getAuthStatus();
            console.log(JSON.stringify(status, null, 2));
            return;
        }
        if (subCommand === 'logout') {
            await logout();
            return;
        }
        console.error('Unknown auth command. Available commands:');
        console.error('  x-search-mcp auth login');
        console.error('  x-search-mcp auth status');
        console.error('  x-search-mcp auth logout');
        process.exit(1);
    }
    // config command: generates safe mcpServers configuration JSON
    if (command === 'config') {
        const config = loadConfig();
        const currentScriptPath = path.resolve(process.argv[1]);
        const envConfig = {
            X_SEARCH_AUTH_MODE: config.authMode,
            X_SEARCH_MODEL: config.model,
        };
        if (process.env.X_SEARCH_AUTH_FILE) {
            envConfig.X_SEARCH_AUTH_FILE = config.authFile;
        }
        if (process.env.XAI_OAUTH_CLIENT_ID) {
            envConfig.XAI_OAUTH_CLIENT_ID = config.oauthClientId;
        }
        if (process.env.XAI_API_KEY_FILE) {
            envConfig.XAI_API_KEY_FILE = process.env.XAI_API_KEY_FILE;
        }
        if (process.env.X_SEARCH_ENV_FILE) {
            envConfig.X_SEARCH_ENV_FILE = process.env.X_SEARCH_ENV_FILE;
        }
        const mcpConfig = {
            mcpServers: {
                'x-search': {
                    command: process.execPath,
                    args: [currentScriptPath],
                    env: envConfig,
                    timeout: 600,
                },
            },
        };
        console.log(JSON.stringify(mcpConfig, null, 2));
        return;
    }
    // search command: direct CLI query testing
    if (command === 'search') {
        const query = subCommand;
        if (!query) {
            console.error('Usage: x-search-mcp search "<query>" [--auth auto|api_key|oauth]');
            process.exit(1);
        }
        let authMode = undefined;
        for (let i = 0; i < rest.length; i++) {
            if (rest[i] === '--auth' && rest[i + 1]) {
                authMode = rest[i + 1];
                i++;
            }
        }
        try {
            const result = await executeSearch({ query, auth_mode: authMode });
            console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            console.error(JSON.stringify({
                success: false,
                log_file: err.logFile || null,
                error: {
                    code: err.code || 'SEARCH_ERROR',
                    message: err.message,
                    status: err.status || null,
                },
            }, null, 2));
            process.exit(1);
        }
        return;
    }
    if (command === 'logs') {
        const listed = await listCallLogs();
        console.log(JSON.stringify(listed, null, 2));
        return;
    }
    console.error(`Unknown command: ${command}`);
    console.error('Available commands:');
    console.error('  x-search-mcp [--stdio]           Start MCP server over stdio');
    console.error('  x-search-mcp http [options]      Start authenticated Streamable HTTP');
    console.error('  x-search-mcp auth login          Login with xAI OAuth Device Flow');
    console.error('  x-search-mcp auth status         Show credentials status (safe)');
    console.error('  x-search-mcp auth logout         Delete local OAuth token file');
    console.error('  x-search-mcp config              Print mcpServers JSON configuration');
    console.error('  x-search-mcp search "<query>"    Direct search query');
    console.error('  x-search-mcp logs                 List recent local call logs');
    process.exit(1);
}
//# sourceMappingURL=cli.js.map