import { createRemoteJWKSet, customFetch, errors, jwtVerify } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { Agent, fetch as undiciFetch } from 'undici';
import type { HttpAuthentication } from '../http-server.js';
import type { Principal } from './bindings.js';

export interface IdentityOptions {
  issuer: string;
  jwksUri: string;
  scope: string;
  allowedSubjects: readonly string[];
  identityFetch?: typeof fetch;
}

const directIdentityAgent = new Agent();
// Use Undici's matched fetch/dispatcher pair. OAuth libraries accept its Fetch API response at runtime.
const directFetch = undiciFetch as unknown as typeof fetch;

export const fetchIdentity: typeof fetch = (input, init) => {
  const options = { ...init, dispatcher: directIdentityAgent };
  return directFetch(input, options);
};

export function httpsUrl(value: string, name: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an absolute HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS URL without credentials, query, or fragment`);
  }
  return url;
}

export function createIdentity(options: IdentityOptions, resource: URL, settingsClientId: string) {
  const { issuer, scope } = options;
  httpsUrl(issuer, 'OAuth issuer');
  if (!/^[A-Za-z0-9:_./-]{1,128}$/.test(scope)) throw new Error('Set a valid MCP OAuth scope');
  const subjects = new Set(options.allowedSubjects);
  if (!subjects.size || [...subjects].some(subject => !/^[\x21-\x7e]{1,255}$/.test(subject))) {
    throw new Error('Supply an explicit list of invited OAuth subject IDs');
  }
  const keyset = createRemoteJWKSet(httpsUrl(options.jwksUri, 'OAuth JWKS URL'), {
    timeoutDuration: 5_000,
    [customFetch]: options.identityFetch ?? fetchIdentity,
  });
  const invited = (subject: unknown): subject is string => typeof subject === 'string' && subjects.has(subject);

  const verify: HttpAuthentication['verify'] = async token => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keyset, {
        issuer,
        audience: resource.pathname === '/' ? resource.origin : resource.href,
        algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub', 'exp'],
      }));
    } catch (error) {
      if (error instanceof errors.JWKSTimeout) throw new Error('OAuth signing keys are unavailable');
      if (error instanceof errors.JOSEError) return null;
      throw error;
    }
    // Accept resource access tokens for this MCP alone. Settings ID tokens have
    // their own client audience and cannot authorize MCP tool calls.
    const clientId = payload.client_id;
    if ((Array.isArray(payload.aud) && payload.aud.length !== 1)
      || typeof clientId !== 'string' || !clientId || clientId === settingsClientId
      || payload.nonce !== undefined || payload.cnf !== undefined) {
      return null;
    }
    if (payload.sub_profile === 'ai_agent' || !invited(payload.sub)) return 'forbidden';
    const scopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : [];
    if (!scopes.includes(scope)) return 'insufficient_scope';
    return { token, clientId, scopes, expiresAt: payload.exp, resource,
      extra: { issuer, subject: payload.sub } };
  };

  return { verify, invited };
}

export function principalFrom(auth: AuthInfo | undefined): Principal | undefined {
  const { issuer, subject } = auth?.extra ?? {};
  if (typeof issuer === 'string' && typeof subject === 'string') return { issuer, subject };
  return undefined;
}
