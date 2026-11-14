import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as oidc from 'openid-client';
import type { HttpAuthentication } from '../http-server.js';
import { BindingChangedError, validApiKey, type BindingStore, type Principal } from './bindings.js';
import { fetchIdentity, httpsUrl, type IdentityOptions } from './identity.js';
import { open, seal, type SealedValue } from './keys.js';

export interface SettingsOptions {
  clientId: string;
  clientSecret: string;
}

interface Expiring {
  expiresAt: number;
}

interface Login extends Expiring {
  state: string;
  nonce: string;
  verifier: string;
}

interface Session extends Expiring {
  user: Principal;
  csrf: string;
}

const loginCookie = '__Host-x-search-login';
const sessionCookie = '__Host-x-search-settings';
const loginSeconds = 5 * 60;
const sessionSeconds = 60 * 60;
const maxEntries = 1024;
const maxSessionsPerUser = 5;
const maxFormBytes = 4096;
const keyWritesPerMinute = 5;
const maxActiveCallbacks = 16;
const pagePath = '/settings';
const loginPath = '/settings/login';
const callbackPath = '/settings/callback';
const keyPath = '/settings/key';
const unbindPath = '/settings/unbind';
const logoutPath = '/settings/logout';
const postPaths = new Set([keyPath, unbindPath, logoutPath]);

function token(): string { return randomBytes(32).toString('base64url'); }

function cookieValue(request: IncomingMessage, name: string): string {
  const values = request.headers.cookie?.split(';').map(part => part.trim())
    .filter(part => part.startsWith(name + '=')) ?? [];
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
}

function cookie(name: string, value: string, seconds: number): string {
  return `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
}

function lookup<T extends Expiring>(entries: Map<string, T>, key: string): T | undefined {
  const entry = entries.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry;
  entries.delete(key);
  return undefined;
}

function hasRoom<T extends Expiring>(entries: Map<string, T>): boolean {
  const now = Date.now();
  for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
  return entries.size < maxEntries;
}

function readLogin(key: Buffer, value: string): Login | undefined {
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(value)) return undefined;
  try {
    const envelope = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as SealedValue;
    const plaintext = open(key, envelope, loginCookie);
    try {
      const login = JSON.parse(plaintext.toString('utf8')) as Login;
      return login.expiresAt > Date.now() ? login : undefined;
    } finally { plaintext.fill(0); }
  } catch { return undefined; }
}

function redirect(response: ServerResponse, url: string): void {
  response.writeHead(303, { Location: url });
  response.end();
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function page(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>X Search Settings</title>
<style>
  :root { color-scheme: light dark; font: 1rem system-ui, sans-serif; }
  body { margin: 3rem auto; max-width: 33rem; padding: 0 1.25rem; line-height: 1.5; }
  h1 { line-height: 1.2; } form { margin: 1rem 0; } input, button { font: inherit; }
  input[type=password] { display: block; width: 100%; box-sizing: border-box; margin: .4rem 0 1rem; padding: .5rem; }
  button { display: block; margin-top: 1rem; padding: .45rem .8rem; }
  code { overflow-wrap: anywhere; }
</style>
</head><body><main><h1>X Search Settings</h1>${body}</main></body>
</html>`);
}

function settingsPage(response: ServerResponse, session: Session | undefined, store: BindingStore): void {
  if (!session) {
    page(response, 200, `<p>Sign in with the same account you use to connect your MCP client.</p>
<p><a href="${loginPath}">Sign in</a></p>`);
    return;
  }
  const bound = store.has(session.user);
  const csrf = `<input type="hidden" name="csrf" value="${session.csrf}">`;
  page(response, 200, `<p>Account ID <code>${escapeHtml(session.user.subject)}</code></p>
<p>${bound ? 'An xAI API key is saved.' : 'No xAI API key is saved.'}</p>
<form method="post" action="${keyPath}">
${csrf}
<label for="key">xAI API key</label>
<input type="password" name="key" id="key" maxlength="512" required autocomplete="off" spellcheck="false">
<label><input type="checkbox" name="consent" value="yes" required>
I agree to store my API key encrypted on this server and use my xAI account for searches.</label>
<button type="submit">${bound ? 'Replace key' : 'Save key'}</button>
</form>
${bound ? `<form method="post" action="${unbindPath}">${csrf}<button type="submit">Remove key</button></form>` : ''}
<form method="post" action="${logoutPath}">${csrf}<button type="submit">Sign out of Settings</button></form>`);
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams | undefined> {
  const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/x-www-form-urlencoded' || Number(request.headers['content-length']) > maxFormBytes) {
    request.resume();
    return undefined;
  }
  let size = 0;
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > maxFormBytes) {
        request.resume();
        return undefined;
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks, size);
    try { return new URLSearchParams(body.toString('utf8')); }
    finally { body.fill(0); }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

export async function createSettings(
  options: SettingsOptions & IdentityOptions,
  publicOrigin: string,
  invited: (subject: unknown) => subject is string,
  store: BindingStore,
): Promise<NonNullable<HttpAuthentication['route']>> {
  const { issuer, jwksUri, clientId, clientSecret, identityFetch = fetchIdentity } = options;
  if (!clientId || !clientSecret) {
    throw new Error('Configure a separate confidential OIDC client for the settings page');
  }
  let provider: oidc.Configuration;
  try {
    provider = await oidc.discovery(httpsUrl(issuer, 'OAuth issuer'), clientId,
      { token_endpoint_auth_method: 'client_secret_basic' }, oidc.ClientSecretBasic(clientSecret), {
        timeout: 5,
        execute: [oidc.enableNonRepudiationChecks],
        [oidc.customFetch]: (url, init) => {
          const { body, ...rest } = init;
          return identityFetch(url, { ...rest, body: body instanceof Uint8Array ? Uint8Array.from(body) : body });
        },
      });
    const metadata = provider.serverMetadata();
    if (metadata.issuer !== issuer || metadata.jwks_uri !== jwksUri) {
      throw new Error('Unexpected OIDC issuer or signing keys URL');
    }
    httpsUrl(metadata.authorization_endpoint ?? '', 'OIDC authorization endpoint');
    httpsUrl(metadata.token_endpoint ?? '', 'OIDC token endpoint');
  } catch {
    throw new Error('Could not initialize the settings OIDC client. Check the issuer, discovery, and JWKS configuration.');
  }
  const callbackUrl = new URL(callbackPath, publicOrigin);
  // Unauthenticated login starts consume no slots in a shared server-side pool.
  const loginKey = randomBytes(32);
  const callbacks = new Set<string>();
  const consumed = new Map<string, Expiring>();
  const sessions = new Map<string, Session>();
  const keyWrites = new Map<string, { starts: number[]; active: boolean }>();

  return async (path, request, response) => {
    const writes = postPaths.has(path);
    if (path !== pagePath && path !== loginPath && path !== callbackPath && !writes) return false;

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    // A native form POST uses the document referrer policy to decide whether to send Origin.
    response.setHeader('Referrer-Policy', path === pagePath ? 'same-origin' : 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const method = writes ? 'POST' : 'GET';
    const sessionId = cookieValue(request, sessionCookie);
    if (request.method !== method) {
      response.setHeader('Allow', method);
      page(response, 405, '<p>Method not allowed.</p>');
    } else if (path === pagePath) {
      settingsPage(response, lookup(sessions, sessionId), store);
    } else if (path === loginPath) {
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const verifier = oidc.randomPKCECodeVerifier();
      const challenge = await oidc.calculatePKCECodeChallenge(verifier);
      const url = oidc.buildAuthorizationUrl(provider, { redirect_uri: callbackUrl.href, scope: 'openid',
        response_type: 'code', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' });
      const login: Login = { state, nonce, verifier, expiresAt: Date.now() + loginSeconds * 1000 };
      const plaintext = Buffer.from(JSON.stringify(login));
      const sealed = seal(loginKey, plaintext, loginCookie);
      plaintext.fill(0);
      const value = Buffer.from(JSON.stringify(sealed)).toString('base64url');
      response.setHeader('Set-Cookie', cookie(loginCookie, value, loginSeconds));
      redirect(response, url.href);
    } else if (path === callbackPath) {
      const pending = readLogin(loginKey, cookieValue(request, loginCookie));
      const url = new URL(callbackUrl);
      url.search = new URL(request.url ?? callbackPath, publicOrigin).search;
      const states = url.searchParams.getAll('state');
      if (!pending || states.length !== 1 || states[0] !== pending.state
        || callbacks.has(pending.state) || lookup(consumed, pending.state)) {
        page(response, 400, `<p>Sign-in could not be verified. <a href="${pagePath}">Try again</a>.</p>`);
        return true;
      }
      if (callbacks.size >= maxActiveCallbacks) {
        page(response, 503, '<p>Sign-in is busy. Try again shortly.</p>');
        return true;
      }
      if (!hasRoom(consumed)) {
        const oldest = consumed.keys().next().value;
        if (oldest) consumed.delete(oldest);
      }
      consumed.set(pending.state, { expiresAt: pending.expiresAt });
      callbacks.add(pending.state);
      const expiredLogin = cookie(loginCookie, '', 0);
      response.setHeader('Set-Cookie', expiredLogin);
      let subject: unknown;
      try {
        const response = await oidc.authorizationCodeGrant(provider, url, {
          expectedState: pending.state, expectedNonce: pending.nonce, pkceCodeVerifier: pending.verifier,
        });
        subject = response.claims()?.sub;
      } catch {
        page(response, 400, `<p>Sign-in could not be verified. <a href="${pagePath}">Try again</a>.</p>`);
        return true;
      } finally { callbacks.delete(pending.state); }
      if (!invited(subject)) {
        page(response, 403, '<p>This account is not invited to use X Search.</p>');
        return true;
      }
      sessions.delete(sessionId);
      const ownSessions = [...sessions].filter(([, session]) => session.user.subject === subject);
      if (ownSessions.length >= maxSessionsPerUser) sessions.delete(ownSessions[0][0]);
      if (!hasRoom(sessions)) {
        page(response, 503, '<p>Sign-in is busy. Try again later.</p>');
        return true;
      }
      const id = token();
      sessions.set(id, { user: { issuer, subject }, csrf: token(), expiresAt: Date.now() + sessionSeconds * 1000 });
      response.setHeader('Set-Cookie', [expiredLogin, cookie(sessionCookie, id, sessionSeconds)]);
      redirect(response, pagePath);
    } else {
      if (request.headers.origin !== publicOrigin || request.headersDistinct.origin?.length !== 1) {
        page(response, 403, '<p>Open Settings directly to make changes.</p>');
        return true;
      }
      const session = lookup(sessions, sessionId);
      if (!session) {
        page(response, 401, `<p><a href="${pagePath}">Sign in</a> to make changes.</p>`);
        return true;
      }
      const form = await readForm(request);
      if (!form) {
        page(response, 400, '<p>Invalid form.</p>');
        return true;
      }
      const csrf = form.getAll('csrf');
      if (lookup(sessions, sessionId) !== session || csrf.length !== 1 || csrf[0] !== session.csrf) {
        page(response, 403, `<p>Could not verify this form. <a href="${pagePath}">Reload Settings</a>.</p>`);
        return true;
      }
      if (path === logoutPath) {
        sessions.delete(sessionId);
        response.setHeader('Set-Cookie', cookie(sessionCookie, '', 0));
      } else if (path === unbindPath) {
        store.unbind(session.user);
      } else {
        const keys = form.getAll('key');
        const consent = form.getAll('consent');
        if (keys.length !== 1 || !validApiKey(keys[0]) || consent.length !== 1 || consent[0] !== 'yes') {
          page(response, 400, `<p>Enter your xAI API key and consent to save it. <a href="${pagePath}">Back to Settings</a>.</p>`);
          return true;
        }
        const now = Date.now();
        const rate = keyWrites.get(session.user.subject) ?? { starts: [], active: false };
        rate.starts = rate.starts.filter(start => start > now - 60_000);
        if (rate.active || rate.starts.length >= keyWritesPerMinute) {
          page(response, 429, `<p>Too many key updates. Wait a minute and <a href="${pagePath}">try again</a>.</p>`);
          return true;
        }
        rate.active = true;
        rate.starts.push(now);
        keyWrites.set(session.user.subject, rate);
        try { await store.bind(session.user, keys[0]); }
        catch (error) {
          if (error instanceof BindingChangedError) {
            page(response, 409, `<p>The saved key changed. <a href="${pagePath}">Reload Settings</a> and try again.</p>`);
          } else {
            page(response, 503, '<p>Could not save the key. Try again later.</p>');
          }
          return true;
        } finally { rate.active = false; }
      }
      redirect(response, pagePath);
    }
    return true;
  };
}
