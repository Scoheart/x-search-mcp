import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { open, seal, type DataKeyProvider, type SealedValue } from './keys.js';

export interface Principal {
  issuer: string;
  subject: string;
}

interface BindingRow {
  revision: string;
  envelope: string | null;
}

interface CredentialEnvelope {
  version: 1;
  wrapped: string;
  value: SealedValue;
}

export class BindingChangedError extends Error {
  constructor() { super('The credential binding changed. Reload the settings page and try again.'); }
}

function contextFor(user: Principal, revision: string): string {
  return JSON.stringify(['x-search-mcp', 'xai-api-key', user.issuer, user.subject, revision]);
}

export function validApiKey(value: string): boolean {
  return /^[!-~]{1,512}$/.test(value);
}

export class BindingStore {
  private readonly db: DatabaseSync;

  constructor(file: string, private readonly keys: DataKeyProvider) {
    const directory = statSync(dirname(file));
    if (!directory.isDirectory() || directory.mode & 0o077 || directory.uid !== process.getuid?.()) {
      throw new Error('The credential database requires a private, user-owned directory');
    }
    const fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.mode & 0o077 || info.uid !== process.getuid?.()) {
        throw new Error('The credential database must be a private, user-owned file');
      }
    } finally { closeSync(fd); }

    this.db = new DatabaseSync(file);
    try {
      this.db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS bindings (
          issuer TEXT NOT NULL,
          subject TEXT NOT NULL,
          revision TEXT NOT NULL,
          envelope TEXT,
          PRIMARY KEY (issuer, subject)
        ) STRICT;
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private row(user: Principal): BindingRow | undefined {
    return this.db.prepare('SELECT revision, envelope FROM bindings WHERE issuer = ? AND subject = ?')
      .get(user.issuer, user.subject) as BindingRow | undefined;
  }

  has(user: Principal): boolean { return Boolean(this.row(user)?.envelope); }

  async bind(user: Principal, apiKey: string): Promise<void> {
    if (!validApiKey(apiKey)) throw new Error('Enter a valid xAI API key');
    const previous = this.row(user)?.revision ?? null;
    const revision = randomUUID();
    const context = contextFor(user, revision);
    let envelope: CredentialEnvelope;
    try {
      const { plaintext, wrapped } = await this.keys.generate(context);
      const secret = Buffer.from(apiKey);
      try {
        envelope = { version: 1, wrapped, value: seal(plaintext, secret, context) };
      } finally {
        plaintext.fill(0);
        secret.fill(0);
      }
    } catch {
      throw new Error('Could not encrypt the credential');
    }
    const saved = this.db.prepare(`
      INSERT INTO bindings (issuer, subject, revision, envelope)
      SELECT ?, ?, ?, ?
      WHERE (SELECT revision FROM bindings WHERE issuer = ? AND subject = ?) IS ?
      ON CONFLICT (issuer, subject) DO UPDATE SET revision = excluded.revision, envelope = excluded.envelope
    `).run(user.issuer, user.subject, revision, JSON.stringify(envelope), user.issuer, user.subject, previous);
    if (!saved.changes) throw new BindingChangedError();
  }

  async get(user: Principal): Promise<string | null> {
    const row = this.row(user);
    if (!row?.envelope) return null;
    const context = contextFor(user, row.revision);
    let apiKey: string;
    try {
      const envelope = JSON.parse(row.envelope) as CredentialEnvelope;
      if (envelope.version !== 1) throw new Error('Unsupported credential format');
      const dataKey = await this.keys.unwrap(envelope.wrapped, context);
      try {
        const secret = open(dataKey, envelope.value, context);
        try { apiKey = secret.toString('utf8'); } finally { secret.fill(0); }
      } finally { dataKey.fill(0); }
    } catch {
      throw new Error('Could not decrypt the credential');
    }
    // An unbind or replacement can complete during the asynchronous KMS read.
    return this.row(user)?.revision === row.revision ? apiKey : null;
  }

  unbind(user: Principal): boolean {
    const wasBound = this.has(user);
    // Retain only the revision so an older in-flight bind cannot restore it.
    this.db.prepare(`
      INSERT INTO bindings (issuer, subject, revision, envelope) VALUES (?, ?, ?, NULL)
      ON CONFLICT (issuer, subject) DO UPDATE SET revision = excluded.revision, envelope = NULL
    `).run(user.issuer, user.subject, randomUUID());
    return wasBound;
  }

  close(): void { this.db.close(); }
}
