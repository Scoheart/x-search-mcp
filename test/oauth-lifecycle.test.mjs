import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import lockfile from 'proper-lockfile';
import { EnvHttpProxyAgent, MockAgent } from 'undici';

for (const key of Object.keys(process.env)) if (key.startsWith('X_SEARCH_') || key.startsWith('XAI_')) delete process.env[key];
const app = await import('../dist/src/index.js');
const serviceToken = 'test-only-http-service-access-credential';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'x-search-oauth-lifecycle-'));
  const file = path.join(directory, 'auth.json');
  const initial = { version: 1, client_id: 'synthetic-test-client', token_endpoint: 'https://auth.x.ai/oauth2/token',
    tokens: { access_token: 'synthetic-expired-access', refresh_token: 'synthetic-refresh' }, expires_at: Date.now() - 1000 };
  await writeFile(file, JSON.stringify(initial), { mode: 0o600 });
  Object.assign(process.env, { X_SEARCH_AUTH_MODE: 'oauth', X_SEARCH_AUTH_FILE: file, X_SEARCH_LOG: 'off' });
  const agent = new MockAgent();
  agent.disableNetConnect();
  const dispatch = EnvHttpProxyAgent.prototype.dispatch;
  EnvHttpProxyAgent.prototype.dispatch = function (options, handler) { return agent.dispatch(options, handler); };
  const originalLock = lockfile.lock;
  const acquisition = deferred();
  let work = 0;
  lockfile.lock = async (...args) => {
    work++;
    acquisition.resolve();
    try {
      const release = await originalLock(...args);
      return async () => { try { await release(); } finally { work--; } };
    } catch (error) { work--; throw error; }
  };
  const held = [];
  const gates = [];
  let service;
  const waitForIdle = async () => {
    for (let attempt = 0; work && attempt < 150; attempt++) await delay(10);
    assert.equal(work, 0, 'OAuth lock operations did not settle');
  };
  t.after(async () => {
    for (const gate of gates) gate.resolve();
    for (const release of held) await release().catch(() => {});
    await service?.close();
    await waitForIdle();
    lockfile.lock = originalLock;
    EnvHttpProxyAgent.prototype.dispatch = dispatch;
    await agent.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    file, initial, acquisition, agent, gates, waitForIdle,
    async hold() {
      const release = await originalLock(file, { realpath: false, retries: 0 });
      let released = false;
      const once = async () => { if (!released) { released = true; await release(); } };
      held.push(once);
      return once;
    },
    async start() {
      service = await app.startHttp(app.createServer, { token: serviceToken, port: 0 });
      return service;
    },
  };
}

function query(service, signal) {
  return fetch(service.url, { method: 'POST', signal, headers: {
    authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: {
    name: 'x_search', arguments: { query: 'synthetic lifecycle check', auth_mode: 'oauth' },
  } }) }).then(response => response.text()).catch(() => null);
}

test('real x_search shutdown cancels queued OAuth lock work before it can refresh later', async t => {
  const state = await fixture(t);
  const release = await state.hold();
  let refreshRequests = 0;
  state.agent.get('https://auth.x.ai').intercept({ method: 'POST', path: '/oauth2/token' }).reply(() => {
    refreshRequests++;
    return { statusCode: 200, data: { access_token: 'synthetic-rotated-access', refresh_token: 'synthetic-rotated-refresh', expires_in: 3600 } };
  });
  const service = await state.start();
  const pending = query(service);
  await state.acquisition.promise;
  await service.close();
  await release();
  await delay(550); // Beyond the lock policy's maximum retry delay: no late refresh may start.
  await state.waitForIdle();
  assert.equal(refreshRequests, 0, 'Cancelled x_search performed a later OAuth refresh');
  assert.deepEqual(JSON.parse(await readFile(state.file, 'utf8')), state.initial);
  await pending;
});

test('real x_search shutdown waits for an accepted token rotation to be saved atomically', async t => {
  const state = await fixture(t);
  const accepted = deferred(), reply = deferred();
  state.gates.push(reply);
  state.agent.get('https://auth.x.ai').intercept({ method: 'POST', path: '/oauth2/token' }).reply(async () => {
    accepted.resolve();
    await reply.promise;
    return { statusCode: 200, data: { access_token: 'synthetic-rotated-access', refresh_token: 'synthetic-rotated-refresh', expires_in: 3600 } };
  });
  const service = await state.start();
  const pending = query(service);
  await accepted.promise;
  let closed = false;
  const closing = service.close().then(() => { closed = true; });
  await setImmediate();
  assert.equal(closed, false, 'HTTP close resolved while OAuth rotation was still in flight');
  reply.resolve();
  await closing;
  const saved = JSON.parse(await readFile(state.file, 'utf8'));
  assert.equal(saved.tokens.refresh_token, 'synthetic-rotated-refresh');
  await state.waitForIdle();
  await pending;
});
