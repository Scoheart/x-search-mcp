import { timingSafeEqual } from 'node:crypto';
import { createServer as createNodeServer } from 'node:http';
import { isIP } from 'node:net';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';
export function normalizeHttpPath(value) {
    if (!value.startsWith('/') || value.startsWith('//') || /[?#\\\s]/.test(value)
        || new URL(value, 'http://localhost').pathname !== value) {
        throw new Error('HTTP path must be a normalized URL path such as /mcp');
    }
    return value;
}
export function normalizeAllowedHost(value) {
    let parsed;
    try {
        parsed = new URL(`http://${value}`);
    }
    catch {
        throw new Error('Allowed HTTP hosts must be hostnames without ports or paths');
    }
    if (parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash
        || value.includes('*') || value.includes('://') || !parsed.hostname) {
        throw new Error('Allowed HTTP hosts must be hostnames without ports or paths');
    }
    return parsed.hostname;
}
export function normalizeAllowedOrigin(value) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new Error('Allowed HTTP origins must be http:// or https:// origins');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
        || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.hostname.includes('*')) {
        throw new Error('Allowed HTTP origins must be http:// or https:// origins without paths');
    }
    return parsed.origin;
}
function json(response, status, message) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: message }));
}
/** Owns one listener and the SDK's stateless per-request handler. */
export async function startHttp(factory, options) {
    const authentication = options.authentication;
    if (authentication && options.token !== undefined) {
        throw new Error('Select one HTTP authentication mode');
    }
    if (!authentication && (typeof options.token !== 'string' || !options.token.trim() || /\s/.test(options.token))) {
        throw new Error('A non-empty HTTP bearer token without whitespace is required');
    }
    const host = options.host ?? '127.0.0.1';
    if (!host || host !== host.trim() || /[\s/\\?#]/.test(host))
        throw new Error('Invalid HTTP bind host');
    const port = options.port ?? 8000;
    if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new Error('HTTP port must be an integer between 0 and 65535');
    const endpointPath = normalizeHttpPath(options.path ?? '/mcp');
    const maxBody = options.maxRequestBodyBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(maxBody) || maxBody <= 0)
        throw new Error('HTTP request body limit must be a positive integer');
    const loopback = ['localhost', '127.0.0.1', '[::1]'];
    const boundHost = isIP(host) === 6 ? `[${host}]` : host;
    const specificBind = ['0.0.0.0', '::'].includes(host) ? [] : [normalizeAllowedHost(boundHost)];
    const allowedHosts = [...new Set([...loopback, ...specificBind, ...(options.allowedHosts ?? []).map(normalizeAllowedHost)])];
    const allowedOrigins = (options.allowedOrigins ?? []).map(normalizeAllowedOrigin);
    const validateHost = hostHeaderValidation(allowedHosts);
    const validateOrigin = originValidation(allowedOrigins.length ? allowedOrigins.map(value => new URL(value).hostname) : loopback);
    const expectedToken = Buffer.from(options.token ?? '');
    const products = new Set();
    const creating = new Set();
    let stopping = false;
    const ownedFactory = context => {
        if (stopping)
            throw new Error('HTTP MCP service is closing');
        const pending = Promise.resolve().then(() => factory(context)).then(async (product) => {
            const core = product instanceof McpServer ? product.server : product;
            const originalClose = core.close.bind(core);
            let closed;
            core.close = () => {
                closed ??= Promise.resolve().then(originalClose).finally(() => { products.delete(product); });
                return closed;
            };
            products.add(product);
            if (stopping) {
                await product.close();
                throw new Error('HTTP MCP service is closing');
            }
            return product;
        });
        creating.add(pending);
        void pending.then(() => { creating.delete(pending); }, () => { creating.delete(pending); });
        return pending;
    };
    const handler = createMcpHandler(ownedFactory, { legacy: 'stateless', maxRequestBodySize: maxBody });
    const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: maxBody });
    const requests = new Set();
    async function handleRequest(request, response) {
        if (!validateHost(request, response) || !validateOrigin(request, response))
            return;
        const origin = request.headers.origin;
        if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
            json(response, 403, 'Origin is not allowed');
            return;
        }
        let pathname;
        try {
            pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        }
        catch {
            json(response, 400, 'Invalid request URL');
            return;
        }
        if (origin && allowedOrigins.includes(origin)) {
            response.setHeader('Access-Control-Allow-Origin', origin);
            response.setHeader('Vary', 'Origin');
            response.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version, MCP-Session-Id, WWW-Authenticate');
        }
        if (pathname !== endpointPath) {
            if (!await authentication?.route?.(pathname, request, response))
                json(response, 404, 'Not found');
            return;
        }
        if (request.method === 'OPTIONS' && origin && allowedOrigins.includes(origin)) {
            if (request.headers['access-control-request-method'] !== 'POST') {
                response.setHeader('Allow', 'POST, OPTIONS');
                json(response, 405, 'Only MCP POST preflight requests are supported');
                return;
            }
            const requestedHeaders = (request.headers['access-control-request-headers'] ?? '').split(',')
                .map(value => value.trim().toLowerCase()).filter(Boolean);
            const baseHeaders = new Set(['authorization', 'content-type', 'accept', 'last-event-id']);
            if (requestedHeaders.some(value => !/^[a-z0-9-]+$/.test(value) || (!baseHeaders.has(value) && !value.startsWith('mcp-')))) {
                json(response, 403, 'Requested browser headers are not allowed');
                return;
            }
            response.writeHead(204, {
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': requestedHeaders.join(', ') || 'Authorization, Content-Type, Accept, MCP-Protocol-Version',
                'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
                'Cache-Control': 'no-store',
            });
            response.end();
            return;
        }
        const authorization = request.headers.authorization;
        const supplied = typeof authorization === 'string' && request.headersDistinct.authorization?.length === 1
            ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : undefined;
        if (authentication) {
            const verdict = supplied ? await authentication.verify(supplied) : null;
            if (response.destroyed || stopping)
                return;
            if (verdict === 'forbidden') {
                json(response, 403, 'This user is not invited to use this service');
                return;
            }
            if (verdict === null || verdict === 'insufficient_scope') {
                const error = verdict === 'insufficient_scope' ? ', error="insufficient_scope"' : supplied ? ', error="invalid_token"' : '';
                response.setHeader('WWW-Authenticate', `Bearer resource_metadata="${authentication.resourceMetadataUrl}", scope="${authentication.scope}"${error}`);
                json(response, verdict === 'insufficient_scope' ? 403 : 401, 'Valid MCP bearer credentials are required');
                return;
            }
            request.auth = verdict;
        }
        else {
            const candidate = Buffer.from(supplied ?? '');
            if (candidate.length !== expectedToken.length || !timingSafeEqual(candidate, expectedToken)) {
                response.setHeader('WWW-Authenticate', 'Bearer realm="x-search-mcp"');
                json(response, 401, 'Valid MCP bearer credentials are required');
                return;
            }
        }
        await nodeHandler(request, response);
    }
    const listener = createNodeServer((request, response) => {
        const task = handleRequest(request, response).catch(() => {
            if (response.destroyed)
                return;
            if (response.headersSent)
                response.destroy();
            else
                json(response, 500, 'MCP HTTP request failed');
        });
        requests.add(task);
        void task.then(() => { requests.delete(task); });
    });
    try {
        await new Promise((resolve, reject) => {
            listener.once('error', reject);
            listener.listen(port, host, () => { listener.removeListener('error', reject); resolve(); });
        });
    }
    catch (error) {
        await handler.close();
        throw error;
    }
    const address = listener.address();
    if (!address || typeof address === 'string')
        throw new Error('HTTP listener did not expose a TCP address');
    let closing;
    return {
        url: `http://${boundHost}:${address.port}${endpointPath}`,
        close() {
            closing ??= (async () => {
                stopping = true;
                const stopped = new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
                listener.closeAllConnections();
                await Promise.allSettled([...creating]);
                // The SDK's legacy leg starts per-request teardown without awaiting it.
                // Drain every owned product as well as the modern handler's exchanges.
                await Promise.all([handler.close(), ...[...products].map(product => product.close()), stopped]);
                await Promise.allSettled([...requests]);
            })();
            return closing;
        },
    };
}
//# sourceMappingURL=http-server.js.map