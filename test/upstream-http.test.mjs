import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

process.env.NO_PROXY = '127.0.0.1,localhost';
const { sendHttpRequest } = await import('../dist/src/http.js');

async function upstream(t, handle) {
  const server = createServer(handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  return `http://127.0.0.1:${server.address().port}/`;
}

test('upstream deadline includes response-body reads after headers arrive', async t => {
  let headersSent = false;
  const url = await upstream(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.flushHeaders();
    headersSent = true;
    const timer = setTimeout(() => response.end('{"ok":true}'), 300);
    response.once('close', () => clearTimeout(timer));
  });
  await assert.rejects(sendHttpRequest({ url, timeoutSeconds: 0.05, retries: 0 }), error => error.code === 'TIMEOUT');
  assert.equal(headersSent, true);
});

test('upstream cancellation remains attached during a response-body read', async t => {
  let notifyHeaders;
  const received = new Promise(resolve => { notifyHeaders = resolve; });
  const url = await upstream(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.flushHeaders();
    notifyHeaders();
    const timer = setTimeout(() => response.end('{"ok":true}'), 300);
    response.once('close', () => clearTimeout(timer));
  });
  const controller = new AbortController();
  const pending = sendHttpRequest({ url, signal: controller.signal, timeoutSeconds: 2, retries: 0 });
  await received;
  await delay(20);
  controller.abort();
  await assert.rejects(pending, error => error.code === 'cancelled');
});

test('upstream plaintext errors retain diagnostic bodies without exposing them as messages', async t => {
  const url = await upstream(t, (_request, response) => {
    response.writeHead(502, { 'content-type': 'text/plain' });
    response.end('private-diagnostic-body');
  });
  await assert.rejects(sendHttpRequest({ url, retries: 0 }), error => {
    assert.equal(error.status, 502);
    assert.equal(error.data, 'private-diagnostic-body');
    assert.equal(error.message.includes('private-diagnostic-body'), false);
    return true;
  });
});
