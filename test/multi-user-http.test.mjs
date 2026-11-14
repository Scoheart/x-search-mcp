import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { EnvHttpProxyAgent, MockAgent } from 'undici';
import * as app from '../dist/src/index.js';
import { fetchIdentity } from '../dist/src/multi-user/identity.js';

const issuer = 'https://issuer.example.test';
const publicUrl = 'https://mcp.example.test/mcp';
const aliceKey = 'xai-synthetic-alice-search-key';
const bobKey = 'xai-synthetic-bob-search-key';
const secret = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(secret.publicKey), kid: 'test-signing-key', alg: 'RS256' };
const jwksUri = issuer + '/jwks';
const clientId = 'settings-test';
const clientSecret = 'synthetic-settings-client-secret';
const publicOrigin = new URL(publicUrl).origin;

test('the default identity fetch uses the matching network dispatcher', async t => {
  const listener = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"fixture":true}');
  });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    listener.closeAllConnections();
    return new Promise(resolve => listener.close(resolve));
  });
  const response = await fetchIdentity(`http://127.0.0.1:${listener.address().port}`, { redirect: 'manual' });
  assert.deepEqual(await response.json(), { fixture: true });
});

async function token(sub, options = {}) {
  return new SignJWT({ scope: options.scope ?? 'x-search', client_id: 'sdk-test', ...options.claims })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(options.issuer ?? issuer).setSubject(sub)
    .setAudience(options.aud ?? publicUrl).setIssuedAt()
    .setExpirationTime(options.exp ?? '10m').sign(secret.privateKey);
}

async function setup(t) {
  assert.equal(typeof app.startMultiUserHttp, 'function', 'managed HTTP startup is missing');
  const dir = await mkdtemp(path.join(tmpdir(), 'x-search-users-'));
  const wrap = path.join(dir, 'wrap');
  await writeFile(wrap, randomBytes(32), { mode: 0o600 });
  const store = new app.BindingStore(path.join(dir, 'store.sqlite'), app.loadLocalKeyProvider(wrap));
  const old = { ...process.env };
  process.env.XAI_API_KEY = 'xai-synthetic-global-fallback-must-never-be-used';
  process.env.X_SEARCH_LOG = 'on';
  process.env.X_SEARCH_LOG_DIR = path.join(dir, 'logs');
  process.env.X_SEARCH_RETRIES = '2';
  const agent = new MockAgent();
  agent.disableNetConnect();
  const dispatch = EnvHttpProxyAgent.prototype.dispatch;
  EnvHttpProxyAgent.prototype.dispatch = function (options, handler) { return agent.dispatch(options, handler); };
  let service;
  t.after(async () => {
    await service?.close();
    store.close();
    EnvHttpProxyAgent.prototype.dispatch = dispatch;
    for (const key of ['XAI_API_KEY', 'X_SEARCH_LOG', 'X_SEARCH_LOG_DIR', 'X_SEARCH_RETRIES']) {
      if (key in old) process.env[key] = old[key];
      else delete process.env[key];
    }
    await agent.close();
    await rm(dir, { recursive: true, force: true });
  });
  const options = {
    publicUrl, issuer, jwksUri, scope: 'x-search', allowedSubjects: ['alice', 'bob'],
    settings: { clientId, clientSecret },
    identityFetch: async (url, init) => {
      switch (String(url)) {
        case jwksUri: return Response.json({ keys: [jwk] });
        case issuer + '/.well-known/openid-configuration': return Response.json({
          issuer, jwks_uri: jwksUri, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token',
          code_challenge_methods_supported: ['S256'], id_token_signing_alg_values_supported: ['RS256'],
          response_types_supported: ['code'], subject_types_supported: ['public'],
        });
        case issuer + '/token': {
          const params = new URLSearchParams(init.body);
          const basic = new Headers(init.headers).get('authorization');
          assert.match(basic, /^Basic /);
          const pair = Buffer.from(basic.slice(6), 'base64').toString('utf8').split(':').map(decodeURIComponent);
          assert.deepEqual(pair, [clientId, clientSecret]);
          assert.equal(params.get('grant_type'), 'authorization_code');
          assert.equal(params.get('redirect_uri'), publicOrigin + '/settings/callback');
          const code = params.get('code');
          const attempt = exchanges.get(code);
          assert.ok(attempt);
          exchanges.delete(code);
          assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), attempt.challenge);
          const idToken = await new SignJWT({ nonce: attempt.nonce })
            .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
            .setIssuer(issuer).setSubject(attempt.subject).setAudience(clientId).setIssuedAt()
            .setExpirationTime('10m').sign((attempt.signingKey ?? secret).privateKey);
          return Response.json({ access_token: 'oidc-access-token', refresh_token: 'oidc-refresh-token', token_type: 'Bearer', id_token: idToken });
        }
        default: throw new Error('Unexpected identity fixture URL');
      }
    },
    port: 0,
  };
  const exchanges = new Map();
  service = await app.startMultiUserHttp(options, store);
  return { dir, agent, store, url: service.url, exchanges };
}

function discovery(url, jwt, extra = {}) {
  return fetch(url, { method: 'POST', headers: {
    authorization: jwt ? `Bearer ${jwt}` : '', 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...extra,
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
}

test('public metadata identifies the resource and each HTTP request requires a valid invited subject', async t => {
  const { url } = await setup(t);
  const meta = await fetch(new URL('/.well-known/oauth-protected-resource/mcp', url));
  assert.equal(meta.status, 200);
  assert.deepEqual(await meta.json(), {
    resource: publicUrl, authorization_servers: [issuer],
    scopes_supported: ['x-search'], bearer_methods_supported: ['header'],
  });
  for (const [jwt, status] of [
    [undefined, 401], ['static-shared-token', 401],
    [await token('alice', { aud: 'https://other.example.test/mcp' }), 401],
    [await token('alice', { aud: [clientId, publicUrl], claims: { client_id: clientId, nonce: 'oidc-nonce' } }), 401],
    [await token('alice', { claims: { client_id: clientId } }), 401],
    [await token('alice', { claims: { cnf: { jkt: 'requires-proof-of-possession' } } }), 401],
    [await token('alice', { issuer: 'https://other.example.test' }), 401],
    [await token('alice', { exp: Math.floor(Date.now() / 1000) - 60 }), 401],
    [await token('alice', { scope: 'openid' }), 403], [await token('charlie'), 403],
  ]) {
    const response = await discovery(url, jwt);
    assert.equal(response.status, status);
    if (status === 401) assert.match(response.headers.get('www-authenticate'), /resource_metadata="https:\/\/mcp\.example\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
    await response.arrayBuffer();
  }
  const accepted = await discovery(url, await token('alice'), { 'x-user-id': 'bob' });
  assert.equal(accepted.status, 200);
  await accepted.arrayBuffer();
});

test('two HTTP MCP clients use only their own xAI key and an unbound user never falls back', async t => {
  const { url, agent, store, dir } = await setup(t);
  await Promise.all([store.bind({ issuer, subject: 'alice' }, aliceKey), store.bind({ issuer, subject: 'bob' }, bobKey)]);
  const users = ['alice', 'bob'];
  const connections = await Promise.all(users.map(async (user, index) => {
    const client = new Client({ name: user, version: '1' }, index === 1 ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : undefined);
    t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: {
      headers: { Authorization: `Bearer ${await token(user)}`, 'x-user-id': users[1-index] },
    } }));
    return client;
  }));
  const pool = agent.get('https://api.x.ai');
  for (const [user, key] of [['alice', aliceKey], ['bob', bobKey]]) {
    pool.intercept({ path: '/v1/responses', method: 'POST', headers: { authorization: `Bearer ${key}` },
      body: body => body.includes(`search by ${user}`) }).reply(200, {
      status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `result for ${user}` }] }],
    }, { headers: { 'content-type': 'application/json' } });
  }
  const results = await Promise.all(connections.map((client, index) => client.callTool({
    name: 'x_search', arguments: { query: `search by ${users[index]}` },
  })));
  for (let i = 0; i < users.length; i++) {
    assert.equal(results[i].isError, undefined, JSON.stringify(results[i]));
    assert.equal(results[i].structuredContent.answer, `result for ${users[i]}`);
    assert.equal(results[i].structuredContent.log_file, null);
    for (const secret of [aliceKey, bobKey]) assert.equal(JSON.stringify(results[i]).includes(secret), false);
  }
  pool.intercept({ path: '/v1/responses', method: 'POST', headers: { authorization: `Bearer ${aliceKey}` } }).reply(200, {
    status: 'failed', error: { message: `Upstream rejected ${aliceKey}` },
  }, { headers: { 'content-type': 'application/json' } });
  const upstreamFailure = await connections[0].callTool({ name: 'x_search', arguments: { query: 'upstream failure' } });
  assert.equal(upstreamFailure.isError, true);
  assert.equal(upstreamFailure.structuredContent.error.code, 'UPSTREAM_SERVER_ERROR');
  assert.equal(JSON.stringify(upstreamFailure).includes(aliceKey), false);
  pool.intercept({ path: '/v1/responses', method: 'POST', headers: { authorization: `Bearer ${aliceKey}` } }).reply(503, () => {
    store.unbind({ issuer, subject: 'alice' });
    return { message: 'Service unavailable' };
  }, { headers: { 'content-type': 'application/json' } });
  const noRetry = await connections[0].callTool({ name: 'x_search', arguments: { query: 'unbind during upstream error' } });
  assert.equal(noRetry.structuredContent.error.code, 'UPSTREAM_SERVER_ERROR');
  assert.equal(await store.get({ issuer, subject: 'alice' }), null);
  agent.assertNoPendingInterceptors();
  store.unbind({ issuer, subject: 'bob' });
  const denied = await connections[1].callTool({ name: 'x_search', arguments: { query: 'after unbinding' } });
  assert.equal(denied.isError, true);
  assert.equal(denied.structuredContent.error.code, 'XAI_KEY_REQUIRED');
  assert.equal(denied.structuredContent.settings_url, 'https://mcp.example.test/settings');
  assert.equal((await readdir(dir)).includes('logs'), false);
});

test('browser settings binds only the OIDC subject, requires consent and CSRF, and supports replacement and deletion', async t => {
  const { url, exchanges, store } = await setup(t);
  const route = (pathname, init) => fetch(new URL(pathname, url), { redirect: 'manual', ...init });
  async function login(subject, { signingKey, wrongNonce = false } = {}) {
    const redirect = await route('/settings/login');
    assert.equal(redirect.status, 303);
    const authorize = new URL(redirect.headers.get('location'));
    const transient = redirect.headers.getSetCookie()[0];
    assert.match(transient, /^__Host-.*; Path=\/; .*HttpOnly; Secure; SameSite=Lax/);
    assert.equal(authorize.origin, issuer);
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorize.searchParams.get('scope'), 'openid');
    const state = authorize.searchParams.get('state');
    const nonce = authorize.searchParams.get('nonce');
    assert.ok(state && nonce);
    const code = randomBytes(12).toString('hex');
    exchanges.set(code, { subject, nonce: wrongNonce ? 'wrong-nonce' : nonce,
      challenge: authorize.searchParams.get('code_challenge'), signingKey });
    const callback = '/settings/callback?' + new URLSearchParams({ state, code });
    const unbound = await route(callback);
    assert.equal(unbound.status, 400);
    await unbound.arrayBuffer();
    assert.ok(exchanges.has(code));
    const headers = { cookie: transient.split(';')[0] };
    const response = await route(callback, { headers });
    const replay = await route(callback, { headers });
    assert.equal(replay.status, 400);
    await replay.arrayBuffer();
    return response;
  }
  const rejected = await login('charlie');
  assert.equal(rejected.status, 403);
  await rejected.arrayBuffer();
  const forged = await login('alice', { signingKey: await generateKeyPair('RS256') });
  assert.equal(forged.status, 400);
  await forged.arrayBuffer();
  const mismatched = await login('alice', { wrongNonce: true });
  assert.equal(mismatched.status, 400);
  await mismatched.arrayBuffer();
  const alice = await login('alice');
  const bob = await login('bob');
  assert.equal(alice.status, 303);
  assert.equal(bob.status, 303);
  function session(response) {
    const cookie = response.headers.getSetCookie().find(value => /^__Host-.*; Max-Age=[1-9]/.test(value));
    assert.ok(cookie);
    return cookie.split(';')[0];
  }
  async function csrf(cookie) {
    const page = await route('/settings', { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('cache-control'), /no-store/);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const html = await page.text();
    assert.ok(!html.includes(aliceKey) && !html.includes(bobKey) && !html.includes('oidc-refresh-token'));
    const token = /name="csrf" value="([A-Za-z0-9_-]+)"/.exec(html)?.[1];
    assert.ok(token);
    return token;
  }
  async function submit(cookie, csrfToken, pathname, values = {}, origin = publicOrigin) {
    const response = await route(pathname, { method: 'POST', headers: { cookie, origin },
      body: new URLSearchParams({ csrf: csrfToken, ...values }) });
    await response.arrayBuffer();
    return response.status;
  }
  const aliceCookie = session(alice);
  const bobCookie = session(bob);
  const aliceCsrf = await csrf(aliceCookie);
  const bobCsrf = await csrf(bobCookie);
  assert.equal(await submit(aliceCookie, aliceCsrf, '/settings/key', { key: aliceKey }), 400);
  assert.equal(await submit(bobCookie, aliceCsrf, '/settings/key', { key: bobKey, consent: 'yes' }), 403);
  assert.equal(await submit(aliceCookie, aliceCsrf, '/settings/key', { key: aliceKey, consent: 'yes' }, 'https://attacker.example.test'), 403);
  assert.equal(await submit(aliceCookie, aliceCsrf, '/settings/key', { key: aliceKey, consent: 'yes', subject: 'bob' }), 303);
  assert.equal(await submit(bobCookie, bobCsrf, '/settings/key', { key: bobKey, consent: 'yes' }), 303);
  assert.equal(await store.get({ issuer, subject: 'alice' }), aliceKey);
  assert.equal(await store.get({ issuer, subject: 'bob' }), bobKey);
  assert.equal(await submit(aliceCookie, aliceCsrf, '/settings/key', { key: 'alice-replacement', consent: 'yes' }), 303);
  assert.equal(await store.get({ issuer, subject: 'alice' }), 'alice-replacement');
  assert.equal(await submit(aliceCookie, aliceCsrf, '/settings/unbind', { subject: 'bob' }), 303);
  assert.equal(await store.get({ issuer, subject: 'alice' }), null);
  assert.equal(await store.get({ issuer, subject: 'bob' }), bobKey);
  for (let i = 0; i < 3; i++) {
    assert.equal(await submit(aliceCookie, aliceCsrf, '/settings/key', { key: aliceKey, consent: 'yes' }), 303);
  }
  assert.equal(await submit(aliceCookie, aliceCsrf, '/settings/key', { key: aliceKey, consent: 'yes' }), 429);
  assert.equal(await submit(bobCookie, bobCsrf, '/settings/key', { key: bobKey, consent: 'yes' }), 303);
  assert.equal(await submit(aliceCookie, aliceCsrf, '/settings/unbind'), 303);
  assert.equal(await submit(bobCookie, bobCsrf, '/settings/logout'), 303);
  assert.equal(await submit(bobCookie, bobCsrf, '/settings/unbind'), 401);
});
