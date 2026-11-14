import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import * as app from '../dist/src/index.js';

const alice = { issuer: 'https://identity.example.test', subject: 'alice' };
const bob = { issuer: alice.issuer, subject: 'bob' };
const aliceKey = 'xai-synthetic-alice-credential-for-tests';
const bobKey = 'xai-synthetic-bob-credential-for-tests';

async function fixture(t) {
  assert.equal(typeof app.BindingStore, 'function', 'encrypted binding store is missing');
  const home = await mkdtemp(path.join(tmpdir(), 'x-search-bindings-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const wrap = path.join(home, 'wrap');
  await writeFile(wrap, randomBytes(32), { mode: 0o600 });
  return { db: path.join(home, 'credentials.sqlite'), keys: app.loadLocalKeyProvider(wrap) };
}

test('the database persists independent credentials without plaintext and supports replacement and deletion', async t => {
  const { db, keys } = await fixture(t);
  const store = new app.BindingStore(db, keys);
  try {
    await Promise.all([store.bind(alice, aliceKey), store.bind(bob, bobKey)]);
    assert.equal(await store.get(alice), aliceKey);
    assert.equal(await store.get(bob), bobKey);
    assert.equal(await store.get({ ...alice, issuer: 'https://other.example.test' }), null);
    await store.bind(alice, 'xai-synthetic-alice-replacement');
    assert.equal(await store.get(alice), 'xai-synthetic-alice-replacement');
    assert.equal(store.unbind(alice), true);
    assert.equal(await store.get(alice), null);
  } finally { store.close(); }
  const content = await readFile(db);
  for (const secret of [aliceKey, bobKey, 'xai-synthetic-alice-replacement']) {
    assert.equal(content.includes(secret), false, 'plaintext credential reached SQLite');
  }
  assert.equal((await stat(db)).mode & 0o777, 0o600);
  const reopened = new app.BindingStore(db, keys);
  try {
    assert.equal(await reopened.get(bob), bobKey);
    assert.equal(await reopened.get(alice), null);
  } finally { reopened.close(); }
});

test('copying one user’s encrypted row to a different user fails closed', async t => {
  const { db, keys } = await fixture(t);
  const store = new app.BindingStore(db, keys);
  try {
    await store.bind(alice, aliceKey);
    await store.bind(bob, bobKey);
    const direct = new DatabaseSync(db);
    try {
      const row = direct.prepare('SELECT envelope FROM bindings WHERE subject = ?').get(alice.subject);
      direct.prepare('UPDATE bindings SET envelope = ? WHERE subject = ?').run(row.envelope, bob.subject);
    } finally { direct.close(); }
    await assert.rejects(store.get(bob), /credential/i);
    assert.equal(await store.get(alice), aliceKey);
  } finally { store.close(); }
});

test('an in-flight binding cannot resurrect a deleted credential', async t => {
  const { db, keys } = await fixture(t);
  let unblock;
  const waiting = new Promise(resolve => { unblock = resolve; });
  let pause = false;
  const store = new app.BindingStore(db, {
    async generate(context) {
      if (pause) await waiting;
      return keys.generate(context);
    },
    unwrap: keys.unwrap,
  });
  try {
    await store.bind(alice, aliceKey);
    pause = true;
    const replacing = store.bind(alice, bobKey);
    store.unbind(alice);
    unblock();
    await assert.rejects(replacing, /changed/i);
    assert.equal(await store.get(alice), null);
  } finally { unblock(); store.close(); }
});
