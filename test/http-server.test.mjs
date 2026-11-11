import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/server';
import * as app from '../dist/src/index.js';

process.env.X_SEARCH_LOG = 'off';

const token = 'local-test-http-access-token-0123456789';
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'http-test', version: '1.0.0' },
} };

async function start(t, options = {}, factory = app.createServer) {
  assert.equal(typeof app.startHttp, 'function', 'native HTTP startup is missing');
  const service = await app.startHttp(factory, { token, port: 0, ...options });
  t.after(() => service.close());
  return service;
}

function call(url, body = initialize, headers = {}) {
  // node:http deliberately preserves the supplied Host; fetch may replace it.
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25', authorization: `Bearer ${token}`, ...headers,
    } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode,
        headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])),
      })));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

async function rpc(response) {
  const text = await response.text();
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    return JSON.parse(text.split('\n').find(line => line.startsWith('data:')).slice(5));
  }
  return JSON.parse(text);
}

test('HTTP requires a non-empty service credential before binding a listener', async () => {
  assert.equal(typeof app.startHttp, 'function', 'native HTTP startup is missing');
  await assert.rejects(app.startHttp(app.createServer, { token: '', port: 0 }), /token|credential/i);
});

test('HTTP rejects missing or wrong authorization before MCP dispatch', async t => {
  const service = await start(t);
  for (const authorization of ['', 'Bearer incorrect', `Basic ${token}`, `Bearer ${token} extra`]) {
    const response = await call(service.url, initialize, { authorization });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /^Bearer/);
    assert.equal((await response.text()).includes(token), false);
  }
  const accepted = await call(service.url);
  assert.equal(accepted.status, 200);
  assert.equal((await rpc(accepted)).result.serverInfo.name, 'x-search-mcp');
});

test('HTTP serves the configured MCP route and constrains request bodies', async t => {
  const service = await start(t, { path: '/tools/mcp', maxRequestBodyBytes: 1024 });
  const missing = await call(new URL('/mcp', service.url));
  assert.equal(missing.status, 404);
  await missing.text();
  const accepted = await call(service.url);
  assert.equal(accepted.status, 200);
  await accepted.text();
  const oversized = await call(service.url, { ...initialize, padding: 'x'.repeat(2048) });
  assert.equal(oversized.status, 413);
  await oversized.text();
});

test('HTTP blocks untrusted Host and Origin and supports explicit proxy allowlists', async t => {
  const service = await start(t, { allowedHosts: ['mcp.example.test'], allowedOrigins: ['https://app.example.test'] });
  for (const headers of [{ host: 'attacker.example.test' }, { origin: 'https://attacker.example.test' },
    { origin: 'http://app.example.test' }, { origin: 'https://app.example.test:8443' }]) {
    const response = await call(service.url, initialize, headers);
    assert.equal(response.status, 403);
    await response.text();
  }
  const accepted = await call(service.url, initialize, { host: 'mcp.example.test', origin: 'https://app.example.test' });
  assert.equal(accepted.status, 200);
  await accepted.text();
});

test('HTTP can serve concurrent SDK clients without sharing a connected singleton', async t => {
  const service = await start(t);
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  const clients = [new Client({ name: 'one', version: '1.0.0' }), new Client({ name: 'two', version: '1.0.0' })];
  t.after(() => Promise.all(clients.map(client => client.close())));
  await Promise.all(clients.map(client => client.connect(new StreamableHTTPClientTransport(new URL(service.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }))));
  const results = await Promise.all(clients.flatMap(client => [client.listTools(), client.listTools()]));
  for (const result of results) assert.deepEqual(result.tools.map(tool => tool.name), ['x_search']);
  const invalid = await clients[0].callTool({ name: 'x_search', arguments: { query: ' ' } });
  assert.equal(invalid.isError, true);
});

test('HTTP serves the 2026 protocol through the current SDK negotiation path', async t => {
  const service = await start(t);
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  const client = new Client({ name: 'modern-client', version: '1.0.0' }, {
    versionNegotiation: { mode: { pin: '2026-07-28' } },
  });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(service.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  assert.equal(client.getProtocolEra(), 'modern');
  assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['x_search']);
});

test('HTTP preflight permits explicit origins and requested MCP metadata headers', async t => {
  const service = await start(t, { allowedOrigins: ['https://app.example.test'] });
  const response = await fetch(service.url, { method: 'OPTIONS', headers: {
    origin: 'https://app.example.test', 'access-control-request-method': 'POST',
    'access-control-request-headers': 'authorization, mcp-client-info, mcp-protocol-version',
  } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.test');
  assert.match(response.headers.get('access-control-allow-headers').toLowerCase(), /mcp-client-info/);
});

function waitingFactory(started, aborted) {
  return () => {
    const server = new McpServer({ name: 'waiting-test', version: '1.0.0' });
    server.registerTool('wait', { description: 'Wait until the HTTP caller cancels' }, async context => {
      started();
      await new Promise(resolve => {
        const signal = context.mcpReq.signal;
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', resolve, { once: true });
      });
      aborted();
      return { content: [{ type: 'text', text: 'cancelled' }] };
    });
    return server;
  };
}

async function beforeDeadline(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('HTTP work did not abort')), 1500);
    })]);
  } finally { clearTimeout(timer); }
}

test('HTTP client disconnect cancels the active tool exchange', async t => {
  let begin, abort;
  const began = new Promise(resolve => { begin = resolve; });
  const aborted = new Promise(resolve => { abort = resolve; });
  const service = await start(t, {}, waitingFactory(begin, abort));
  const req = request(service.url, { method: 'POST', headers: {
    'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-11-25', authorization: `Bearer ${token}`,
  } });
  req.on('error', () => {});
  req.end(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'wait', arguments: {} } }));
  await beforeDeadline(began);
  req.destroy();
  await beforeDeadline(aborted);
});

test('HTTP shutdown aborts active tools and is safe to repeat', async t => {
  let begin, abort;
  const began = new Promise(resolve => { begin = resolve; });
  const aborted = new Promise(resolve => { abort = resolve; });
  const service = await start(t, {}, waitingFactory(begin, abort));
  const pending = call(service.url, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'wait', arguments: {} } }).catch(() => null);
  await beforeDeadline(began);
  await beforeDeadline(service.close());
  await beforeDeadline(aborted);
  await pending;
  await service.close();
});
