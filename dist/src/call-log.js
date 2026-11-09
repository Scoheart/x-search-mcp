import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
const SENSITIVE_KEYS = new Set([
    'authorization',
    'proxy-authorization',
    'access_token',
    'refresh_token',
    'id_token',
    'api_key',
    'apikey',
    'token',
    'secret',
    'password',
    'client_secret',
]);
const BEARER = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const XAI_KEY = /xai-[A-Za-z0-9_-]{16,}/g;
/**
 * Remove credential-shaped values before a call log is written.
 * Post text is preserved; only known secret keys and token formats are replaced.
 */
export function redactForLog(value, seen = new WeakSet()) {
    if (typeof value === 'string') {
        return value.replace(BEARER, 'Bearer [redacted]').replace(XAI_KEY, 'xai-[redacted]');
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (seen.has(value)) {
        return '[circular]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => redactForLog(item, seen));
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        output[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[redacted]' : redactForLog(item, seen);
    }
    return output;
}
export function boundForLog(value, maxBytes) {
    let json;
    try {
        json = JSON.stringify(value);
    }
    catch {
        json = JSON.stringify(String(value));
    }
    const bytes = Buffer.byteLength(json);
    if (bytes <= maxBytes) {
        return { value, truncated: false, bytes };
    }
    const preview = Buffer.from(json).subarray(0, Math.min(maxBytes, 65536)).toString('utf8');
    return {
        value: { truncated: true, bytes, preview },
        truncated: true,
        bytes,
    };
}
function stamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace('.', '');
}
async function pruneCallLogs(dir, keep) {
    if (keep <= 0)
        return;
    const names = (await fs.promises.readdir(dir)).filter((name) => /^call-.*\.json$/.test(name));
    if (names.length <= keep)
        return;
    const ranked = await Promise.all(names.map(async (name) => {
        const full = path.join(dir, name);
        const stat = await fs.promises.stat(full);
        return { full, mtime: stat.mtimeMs };
    }));
    ranked.sort((left, right) => right.mtime - left.mtime);
    await Promise.all(ranked.slice(keep).map((item) => fs.promises.rm(item.full, { force: true })));
}
/**
 * Persist one search call, including the raw upstream body.
 * Returns the log path, or null when logging is disabled or the write fails.
 * A write failure must not replace the original search error.
 */
export async function writeCallLog(entry) {
    const config = loadConfig();
    if (!config.logEnabled)
        return null;
    const redactedAttempts = entry.attempts.map((attempt) => {
        const bounded = boundForLog(redactForLog(attempt.raw_response), config.logMaxBytes);
        return {
            ...attempt,
            raw_response: bounded.value,
            raw_response_truncated: bounded.truncated,
            raw_response_bytes: bounded.bytes,
        };
    });
    const record = {
        schema_version: 1,
        id: `call-${stamp()}-${crypto.randomBytes(3).toString('hex')}`,
        started_at: entry.started_at,
        completed_at: new Date().toISOString(),
        elapsed_ms: entry.elapsed_ms,
        endpoint: entry.endpoint,
        model: entry.model,
        query: entry.query,
        credential_source: entry.credential_source,
        billing_mode: entry.billing_mode,
        request: redactForLog(entry.request),
        attempts: redactedAttempts,
        raw_response: redactedAttempts.length > 0 ? redactedAttempts[redactedAttempts.length - 1].raw_response : null,
        outcome: entry.outcome,
        error: entry.error,
    };
    const dir = config.logDir;
    const filename = `${record.id}.json`;
    const destination = path.join(dir, filename);
    const temporary = path.join(dir, `.${filename}.${process.pid}.tmp`);
    try {
        await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
        await fs.promises.chmod(dir, 0o700);
        await fs.promises.writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
        await fs.promises.chmod(temporary, 0o600);
        await fs.promises.rename(temporary, destination);
        await fs.promises.chmod(destination, 0o600);
        await pruneCallLogs(dir, config.logKeep);
        return destination;
    }
    catch (err) {
        console.error(`x-search-mcp call_log_error=${err?.message || 'failed to write call log'}`);
        await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
        return null;
    }
}
export async function listCallLogs(limit = 20) {
    const config = loadConfig();
    const bounded = Math.max(1, Math.min(limit, 100));
    let names = [];
    try {
        names = (await fs.promises.readdir(config.logDir)).filter((name) => /^call-.*\.json$/.test(name));
    }
    catch (err) {
        if (err?.code !== 'ENOENT')
            throw err;
    }
    const ranked = await Promise.all(names.map(async (name) => {
        const full = path.join(config.logDir, name);
        const stat = await fs.promises.stat(full);
        return { file: full, bytes: stat.size, mtimeMs: stat.mtimeMs, mtime: stat.mtime.toISOString() };
    }));
    ranked.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return {
        enabled: config.logEnabled,
        directory: config.logDir,
        keep: config.logKeep,
        files: ranked.slice(0, bounded).map(({ file, bytes, mtime }) => ({ file, bytes, mtime })),
    };
}
//# sourceMappingURL=call-log.js.map