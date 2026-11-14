import { startHttp, normalizeHttpPath } from '../http-server.js';
import { HttpError } from '../http.js';
import { createSearchServer } from '../server.js';
import { executeSearch } from '../search.js';
import { createIdentity, httpsUrl, principalFrom } from './identity.js';
import { createSettings } from './settings.js';
const metadataRoot = '/.well-known/oauth-protected-resource';
const searchLimit = 30;
const simultaneousLimit = 2;
export async function startMultiUserHttp(options, store) {
    const resource = httpsUrl(options.publicUrl, 'MCP public URL');
    const endpoint = normalizeHttpPath(resource.pathname);
    if (endpoint.startsWith('/.well-known/') || endpoint === '/settings' || endpoint.startsWith('/settings/')) {
        throw new Error('The MCP endpoint conflicts with an authorization or settings route');
    }
    const host = options.host ?? '127.0.0.1';
    if (host !== '127.0.0.1' && host !== '::1')
        throw new Error('Managed HTTP must listen on loopback behind HTTPS');
    const metadataPath = endpoint === '/' ? metadataRoot : metadataRoot + endpoint;
    const metadataUrl = new URL(metadataPath, resource).href;
    const settingsUrl = new URL('/settings', resource).href;
    const resourceId = endpoint === '/' ? resource.origin : resource.href;
    if (options.settings.clientId === resourceId)
        throw new Error('The settings client ID must differ from the MCP resource URL');
    const identity = createIdentity(options, resource, options.settings.clientId);
    const settingsRoute = await createSettings({ ...options, ...options.settings }, resource.origin, identity.invited, store);
    const rates = new Map();
    const metadata = JSON.stringify({
        resource: resourceId,
        authorization_servers: [options.issuer],
        scopes_supported: [options.scope],
        bearer_methods_supported: ['header'],
    });
    return startHttp(context => {
        const user = principalFrom(context.authInfo);
        return createSearchServer(async (params, request) => {
            if (!user)
                throw new HttpError('MCP_AUTH_REQUIRED', 'Sign in to this MCP server.', 401);
            const now = Date.now();
            const rate = rates.get(user.subject) ?? { starts: [], active: 0 };
            rate.starts = rate.starts.filter(start => start > now - 60_000);
            if (rate.starts.length >= searchLimit || rate.active >= simultaneousLimit) {
                throw new HttpError('MCP_SEARCH_LIMIT', 'Too many searches. Wait and try again.', 429);
            }
            rates.set(user.subject, rate);
            rate.starts.push(now);
            rate.active++;
            try {
                return await executeSearch(params, {
                    signal: request.mcpReq.signal,
                    resolveApiKey: async () => {
                        let key;
                        try {
                            key = await store.get(user);
                        }
                        catch {
                            throw new HttpError('XAI_KEY_UNAVAILABLE', 'Could not access your saved xAI API key.', 503);
                        }
                        if (!key)
                            throw new HttpError('XAI_KEY_REQUIRED', 'Bind your xAI API key in Settings.', 409);
                        return key;
                    },
                });
            }
            finally {
                rate.active--;
            }
        }, settingsUrl);
    }, {
        host, port: options.port, path: endpoint, allowedHosts: [resource.hostname],
        allowedOrigins: [resource.origin, ...(options.allowedOrigins ?? [])],
        authentication: {
            resourceMetadataUrl: metadataUrl,
            scope: options.scope,
            verify: identity.verify,
            async route(path, request, response) {
                if (path !== metadataRoot && path !== metadataPath) {
                    return settingsRoute(path, request, response);
                }
                if (request.method !== 'GET') {
                    response.writeHead(405, { Allow: 'GET', 'Cache-Control': 'no-store' });
                    response.end();
                    return true;
                }
                response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                response.end(metadata);
                return true;
            },
        },
    });
}
//# sourceMappingURL=service.js.map