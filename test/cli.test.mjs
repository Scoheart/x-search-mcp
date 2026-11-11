import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const entry = fileURLToPath(new URL('../bin/x-search-mcp.js', import.meta.url));
const token = 'cli-test-service-credential-0123456789';
function environment(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('X_SEARCH_') && !key.startsWith('XAI_')));
  return { ...env, X_SEARCH_LOG: 'off', ...extra };
}

test('CLI help describes HTTP startup and succeeds without starting a transport', () => {
  const result = spawnSync(process.execPath, [entry, '--help'], { env: environment(), encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /http/);
  assert.match(result.stdout, /token-file/);
});

test('CLI rejects malformed HTTP options and missing or empty token files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'x-search-cli-options-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const empty = path.join(directory, 'empty-token');
  await writeFile(empty, '', { mode: 0o600 });
  const cases = [
    [['--port', '80garbage'], /port/i], [['--port', '-1'], /port/i], [['--port', '65536'], /port/i],
    [['--path', '//mcp'], /path/i], [['--path', '/mcp?token=ignored'], /path/i],
    [['--allowed-host', '*'], /host/i], [['--allowed-origin', '*'], /origin/i],
    [['--unknown'], /unknown/i], [['--token-file', empty], /token|credential/i],
    [['--token-file', path.join(directory, 'missing')], /token|file|ENOENT/i],
  ];
  for (const [args, expected] of cases) {
    const result = spawnSync(process.execPath, [entry, 'http', ...args], {
      env: environment({ X_SEARCH_HTTP_TOKEN: token }), encoding: 'utf8', timeout: 3000,
    });
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, expected);
    assert.equal((result.stdout + result.stderr).includes(token), false);
  }
});

for (const mode of ['http', '--http']) {
  test(`CLI ${mode} starts with a private token file and shuts down on SIGTERM`, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'x-search-cli-http-'));
    const file = path.join(directory, 'http-token');
    await writeFile(file, token + '\n', { mode: 0o600 });
    const child = spawn(process.execPath, [entry, mode, '--port', '0', '--token-file', file], {
      env: environment(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostic = '', stdout = '';
    child.stderr.on('data', data => { diagnostic += data; });
    child.stdout.on('data', data => { stdout += data; });
    let exited;
    const exit = new Promise(resolve => child.once('exit', code => { exited = code; resolve(code); }));
    t.after(async () => {
      if (child.exitCode === null) child.kill('SIGKILL');
      await exit;
      await rm(directory, { recursive: true, force: true });
    });
    let endpoint;
    for (let attempt = 0; attempt < 60; attempt++) {
      endpoint = /HTTP listening at (http:\/\/\S+)/.exec(diagnostic)?.[1];
      if (endpoint || exited !== undefined) break;
      await delay(25);
    }
    assert.ok(endpoint, diagnostic);
    const response = await fetch(endpoint, { method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`, 'mcp-protocol-version': '2025-11-25',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    assert.equal(response.status, 200);
    const text = await response.text();
    const payload = response.headers.get('content-type')?.includes('text/event-stream')
      ? JSON.parse(text.split('\n').find(line => line.startsWith('data:')).slice(5))
      : JSON.parse(text);
    assert.equal(payload.result.tools[0].name, 'x_search');
    child.kill('SIGTERM');
    assert.equal(await Promise.race([exit, delay(2000).then(() => 'timeout')]), 0);
    assert.equal(stdout, '');
    assert.equal(diagnostic.includes(token), false);
  });
}

for (const args of [[], ['--stdio']]) {
  test(`CLI ${args.join(' ') || 'default'} retains stdio discovery`, async t => {
    const client = new Client({ name: 'stdio-regression', version: '1.0.0' });
    t.after(() => client.close());
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry, ...args], env: environment() }));
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['x_search']);
  });
}
