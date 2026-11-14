import { parseHttpOptions } from '../http-config.js';
import { BindingStore } from './bindings.js';
import { httpsUrl } from './identity.js';
import { loadLocalKeyProvider, readPrivateFile } from './keys.js';
import { startMultiUserHttp } from './service.js';
const prefix = 'X_SEARCH_MULTI_USER_';
function readClientSecret(file) {
    try {
        const buffer = readPrivateFile(file, 4096);
        try {
            const secret = buffer.toString('utf8').trim();
            if (!secret || /\s/.test(secret) || buffer.length > 4096)
                throw new Error('Invalid secret');
            return secret;
        }
        finally {
            buffer.fill(0);
        }
    }
    catch {
        throw new Error(`${prefix}OIDC_CLIENT_SECRET_FILE must be a non-empty private file owned by the service user`);
    }
}
export function loadMultiUserOptions(args, env = process.env) {
    const dev = args.includes('--dev-local-key');
    const { host, port, path, allowedHosts, allowedOrigins, tokenFile } = parseHttpOptions(args.filter(argument => argument !== '--dev-local-key'), env);
    if (tokenFile)
        throw new Error('--token-file applies only to single-account HTTP');
    if (allowedHosts.length)
        throw new Error('Managed HTTP derives the allowed public host from X_SEARCH_MULTI_USER_PUBLIC_URL');
    if (host !== '127.0.0.1' && host !== '::1')
        throw new Error('Managed HTTP must bind to loopback');
    const required = (name) => {
        const value = env[prefix + name]?.trim();
        if (!value)
            throw new Error(`Set ${prefix}${name}`);
        return value;
    };
    const publicUrl = httpsUrl(required('PUBLIC_URL'), 'X_SEARCH_MULTI_USER_PUBLIC_URL');
    if (path !== undefined && path !== publicUrl.pathname) {
        throw new Error('Managed HTTP path must match X_SEARCH_MULTI_USER_PUBLIC_URL');
    }
    const options = {
        publicUrl: publicUrl.href,
        host, port, allowedOrigins,
        issuer: required('ISSUER'),
        jwksUri: required('JWKS_URL'),
        scope: env[prefix + 'SCOPE']?.trim() || 'openid',
        allowedSubjects: required('ALLOWED_SUBJECTS').split(',').map(subject => subject.trim()),
        settings: {
            clientId: required('OIDC_CLIENT_ID'),
            clientSecret: readClientSecret(required('OIDC_CLIENT_SECRET_FILE')),
        },
    };
    const database = required('DATABASE');
    const keys = dev
        ? { type: 'local', file: required('DEV_KEY_FILE') }
        : { type: 'kms', options: {
                region: required('KMS_REGION'),
                keyId: required('KMS_KEY_ID'),
                roleName: required('KMS_ROLE_NAME'),
                endpoint: env[prefix + 'KMS_ENDPOINT']?.trim() || undefined,
                caFile: env[prefix + 'KMS_CA_FILE']?.trim() || undefined,
            } };
    return { options, database, keys };
}
export async function startMultiUserCli(args) {
    const { options, database, keys } = loadMultiUserOptions(args);
    const provider = keys.type === 'local' ? loadLocalKeyProvider(keys.file)
        : (await import('./kms.js')).createAliyunKeyProvider(keys.options);
    const store = new BindingStore(database, provider);
    try {
        const service = await startMultiUserHttp(options, store);
        let closing;
        return { url: service.url, close: () => closing ??= service.close().finally(() => store.close()) };
    }
    catch (error) {
        store.close();
        throw error;
    }
}
//# sourceMappingURL=cli.js.map