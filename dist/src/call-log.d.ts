import type { CallLogEntry } from './types.js';
/**
 * Remove credential-shaped values before a call log is written.
 * Post text is preserved; only known secret keys and token formats are replaced.
 */
export declare function redactForLog(value: unknown, seen?: WeakSet<object>): unknown;
export declare function boundForLog(value: unknown, maxBytes: number): {
    value: unknown;
    truncated: boolean;
    bytes: number;
};
/**
 * Persist one search call, including the raw upstream body.
 * Returns the log path, or null when logging is disabled or the write fails.
 * A write failure must not replace the original search error.
 */
export declare function writeCallLog(entry: CallLogEntry): Promise<string | null>;
export declare function listCallLogs(limit?: number): Promise<{
    enabled: boolean;
    directory: string;
    keep: number;
    files: Array<{
        file: string;
        bytes: number;
        mtime: string;
    }>;
}>;
//# sourceMappingURL=call-log.d.ts.map