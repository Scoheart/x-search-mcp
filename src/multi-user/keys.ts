import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';

export interface DataKeyProvider {
  generate(context: string): Promise<{ plaintext: Buffer; wrapped: string }>;
  unwrap(wrapped: string, context: string): Promise<Buffer>;
}

export interface SealedValue {
  nonce: string;
  ciphertext: string;
  tag: string;
}

export function seal(key: Buffer, plaintext: Buffer, context: string): SealedValue {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context));
  return {
    nonce: nonce.toString('base64'),
    ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function open(key: Buffer, value: SealedValue, context: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.nonce, 'base64'), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const plaintext = decipher.update(Buffer.from(value.ciphertext, 'base64'));
  try {
    return Buffer.concat([plaintext, decipher.final()]);
  } finally {
    plaintext.fill(0);
  }
}

export function readPrivateFile(file: string, maxBytes: number): Buffer {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > maxBytes || info.mode & 0o077 || info.uid !== process.getuid?.()) {
      throw new Error('The secret must be a private, user-owned file');
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function loadLocalKeyProvider(file: string): DataKeyProvider {
  const master = readPrivateFile(file, 32);
  if (master.length !== 32) {
    master.fill(0);
    throw new Error('The local wrapping key must contain 32 bytes');
  }
  return {
    async generate(context) {
      const plaintext = randomBytes(32);
      return { plaintext, wrapped: JSON.stringify(seal(master, plaintext, context)) };
    },
    async unwrap(wrapped, context) {
      return open(master, JSON.parse(wrapped) as SealedValue, context);
    },
  };
}
