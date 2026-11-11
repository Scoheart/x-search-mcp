import { readFileSync } from 'node:fs';
import { normalizeAllowedHost, normalizeAllowedOrigin, normalizeHttpPath } from './http-server.js';
/** CLI flags override environment defaults; an explicit token file wins over env credentials. */
export function loadHttpOptions(args, env = process.env) {
    let host = env.X_SEARCH_HTTP_HOST ?? '127.0.0.1';
    let port = env.X_SEARCH_HTTP_PORT ?? '8000';
    let path = env.X_SEARCH_HTTP_PATH ?? '/mcp';
    let tokenFile;
    const hosts = [];
    const origins = [];
    const supported = new Set(['--host', '--port', '--path', '--token-file', '--allowed-host', '--allowed-origin']);
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        const equals = argument.indexOf('=');
        const flag = equals < 0 ? argument : argument.slice(0, equals);
        if (!supported.has(flag))
            throw new Error('Unknown HTTP option; see x-search-mcp http --help');
        const value = equals < 0 ? args[++index] : argument.slice(equals + 1);
        if (value === undefined || !value || value.startsWith('--'))
            throw new Error(`${flag} requires a value`);
        switch (flag) {
            case '--host':
                host = value;
                break;
            case '--port':
                port = value;
                break;
            case '--path':
                path = value;
                break;
            case '--token-file':
                tokenFile = value;
                break;
            case '--allowed-host':
                hosts.push(value);
                break;
            case '--allowed-origin':
                origins.push(value);
                break;
        }
    }
    if (!/^\d+$/.test(port) || !Number.isInteger(Number(port)) || Number(port) > 65535) {
        throw new Error('HTTP port must be an integer between 0 and 65535');
    }
    const parseList = (value) => value?.split(',').map(item => item.trim()).filter(Boolean) ?? [];
    const allowedHosts = (hosts.length ? hosts : parseList(env.X_SEARCH_HTTP_ALLOWED_HOSTS)).map(normalizeAllowedHost);
    const allowedOrigins = (origins.length ? origins : parseList(env.X_SEARCH_HTTP_ALLOWED_ORIGINS)).map(normalizeAllowedOrigin);
    const endpoint = normalizeHttpPath(path);
    let token = env.X_SEARCH_HTTP_TOKEN?.trim();
    const file = tokenFile ?? (!token ? env.X_SEARCH_HTTP_TOKEN_FILE : undefined);
    if (file !== undefined) {
        try {
            token = readFileSync(file, 'utf8').trim();
        }
        catch (error) {
            const code = error.code ?? 'READ_ERROR';
            throw new Error(`Cannot read HTTP token file (${code})`);
        }
    }
    if (!token || /\s/.test(token)) {
        throw new Error('Set X_SEARCH_HTTP_TOKEN or a non-empty HTTP token file via --token-file / X_SEARCH_HTTP_TOKEN_FILE');
    }
    return { host, port: Number(port), path: endpoint, token, allowedHosts, allowedOrigins };
}
//# sourceMappingURL=http-config.js.map