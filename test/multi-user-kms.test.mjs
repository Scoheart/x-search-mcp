import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const KmsClient = require('@alicloud/kms20160120').default;
const keyId = 'key-fixture';

test('Aliyun KMS requests a 32-byte data key and unwraps it with the same binding context', async t => {
  const { createAliyunKeyProvider } = await import('../dist/src/multi-user/kms.js');
  const plaintext = Buffer.alloc(32, 7);
  const wrapped = 'synthetic-kms-wrapped';
  let context;
  t.mock.method(KmsClient.prototype, 'generateDataKey', async function (request) {
    assert.equal(this._endpoint, 'kms-vpc.cn-hangzhou.aliyuncs.com');
    assert.equal(request.numberOfBytes, 32);
    assert.equal(request.keyId, keyId);
    assert.match(request.encryptionContext.binding, /^[0-9a-f]{64}$/);
    context = request.encryptionContext;
    return { body: { keyId, plaintext: plaintext.toString('base64'), ciphertextBlob: wrapped } };
  });
  t.mock.method(KmsClient.prototype, 'decrypt', async request => {
    assert.equal(request.ciphertextBlob, wrapped);
    if (request.encryptionContext.binding !== context.binding) throw new Error('Invalid context');
    return { body: { keyId, plaintext: plaintext.toString('base64') } };
  });
  const keys = createAliyunKeyProvider({ keyId, region: 'cn-hangzhou', roleName: 'fixture-role' });
  const dataKey = await keys.generate('alice-binding');
  assert.equal(dataKey.wrapped, wrapped);
  assert.deepEqual(dataKey.plaintext, plaintext);
  assert.deepEqual(await keys.unwrap(wrapped, 'alice-binding'), plaintext);
  await assert.rejects(keys.unwrap(wrapped, 'bob-binding'), /KMS could not decrypt/);
  assert.throws(() => createAliyunKeyProvider({ keyId: 'alias/mutable', region: 'cn-hangzhou', roleName: 'fixture-role' }), /KMS key ID/);
  assert.throws(() => createAliyunKeyProvider({ keyId, region: 'cn-hangzhou', roleName: 'fixture-role',
    endpoint: 'kst-test.cryptoservice.kms.aliyuncs.com' }), /KMS instance CA file/);
});

test('Aliyun KMS failures and unexpected key IDs do not return plaintext or provider error details', async t => {
  const { createAliyunKeyProvider } = await import('../dist/src/multi-user/kms.js');
  const mock = t.mock.method(KmsClient.prototype, 'generateDataKey', async () => ({
    body: { keyId, ciphertextBlob: 'synthetic-wrapped', plaintext: 'invalid-plaintext' },
  }));
  t.mock.method(KmsClient.prototype, 'decrypt', async () => ({
    body: { keyId: 'other-key', plaintext: Buffer.alloc(32, 7).toString('base64') },
  }));
  const keys = createAliyunKeyProvider({ keyId, region: 'cn-hangzhou', roleName: 'fixture-role' });
  await assert.rejects(keys.generate('alice-binding'), { message: 'KMS could not generate a data key' });
  mock.mock.mockImplementation(async () => { throw new Error('synthetic-sensitive-provider-error'); });
  await assert.rejects(keys.generate('alice-binding'), { message: 'KMS could not generate a data key' });
  await assert.rejects(keys.unwrap('synthetic-wrapped', 'alice-binding'), { message: 'KMS could not decrypt the data key' });
});
