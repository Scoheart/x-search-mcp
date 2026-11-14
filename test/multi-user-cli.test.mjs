import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const bin = new URL('../bin/x-search-mcp.js', import.meta.url);
const prefix = 'X_SEARCH_MULTI_USER_';

function invoke(args, vars = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^X_(SEARCH|AI)|^XAI_/.test(name)));
  return spawnSync(process.execPath, [bin.pathname, 'http', '--multi-user', ...args], {
    env: { ...env, ...vars }, encoding: 'utf8', timeout: 3000,
  });
}

test('the managed CLI fails closed and cannot be started with a shared token file', () => {
  const help = invoke(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--multi-user/);
  const missing = invoke([], { X_SEARCH_HTTP_TOKEN: 'synthetic-global-token' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /X_SEARCH_MULTI_USER_PUBLIC_URL/);
  const incompatible = invoke(['--token-file', '/does/not/exist']);
  assert.equal(incompatible.status, 1);
  assert.match(incompatible.stderr, /--token-file.*single-account/);
  const wildcard = invoke(['--host', '0.0.0.0']);
  assert.equal(wildcard.status, 1);
  assert.match(wildcard.stderr, /loopback/);
});

test('managed configuration requires KMS or explicit dev mode and a private OIDC client secret file', async t => {
  const { loadMultiUserOptions } = await import('../dist/src/multi-user/cli.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'x-search-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const secretPath = path.join(dir, 'oidc');
  await writeFile(secretPath, 'fixture-oidc-secret\n', { mode: 0o600 });
  const env = Object.fromEntries(Object.entries({
    PUBLIC_URL: 'https://mcp.example.test/search',
    ISSUER: 'https://issuer.example.test',
    JWKS_URL: 'https://issuer.example.test/jwks',
    ALLOWED_SUBJECTS: 'alice, bob',
    DATABASE: path.join(dir, 'db.sqlite'),
    OIDC_CLIENT_ID: 'test-client',
    OIDC_CLIENT_SECRET_FILE: secretPath,
    DEV_KEY_FILE: path.join(dir, 'wrap'),
  }).map(([key, value]) => [prefix + key, value]));
  assert.throws(() => loadMultiUserOptions([], env), /KMS_REGION/);
  const loaded = loadMultiUserOptions(['--dev-local-key', '--port', '0'], env);
  assert.equal(loaded.options.port, 0);
  assert.equal(loaded.options.scope, 'openid');
  assert.deepEqual(loaded.options.allowedSubjects, ['alice', 'bob']);
  assert.equal(loaded.options.settings.clientSecret, 'fixture-oidc-secret');
  assert.throws(() => loadMultiUserOptions(['--dev-local-key', '--path', '/other'], env), /PUBLIC_URL/);
  await chmod(secretPath, 0o644);
  assert.throws(() => loadMultiUserOptions(['--dev-local-key'], env), /private.*file/);
  const link = path.join(dir, 'oidc-link');
  await chmod(secretPath, 0o600);
  await symlink(secretPath, link);
  assert.throws(() => loadMultiUserOptions(['--dev-local-key'], { ...env, [prefix + 'OIDC_CLIENT_SECRET_FILE']: link }), /private.*file/);
});
