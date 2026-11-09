import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStdio } from './server.js';
import { loginWithDeviceCode, getAuthStatus, logout } from './auth.js';
import { executeSearch } from './search.js';
import { listCallLogs } from './call-log.js';
import { loadConfig } from './config.js';
export async function runCli(argv = process.argv.slice(2)) {
    const [command, subCommand, ...rest] = argv;
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
    console.error('  x-search-mcp auth login          Login with xAI OAuth Device Flow');
    console.error('  x-search-mcp auth status         Show credentials status (safe)');
    console.error('  x-search-mcp auth logout         Delete local OAuth token file');
    console.error('  x-search-mcp config              Print mcpServers JSON configuration');
    console.error('  x-search-mcp search "<query>"    Direct search query');
    console.error('  x-search-mcp logs                 List recent local call logs');
    process.exit(1);
}
//# sourceMappingURL=cli.js.map