import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// Load explicit env file if configured
if (process.env.X_SEARCH_ENV_FILE) {
    const envFilePath = path.resolve(process.env.X_SEARCH_ENV_FILE);
    if (fs.existsSync(envFilePath)) {
        try {
            process.loadEnvFile(envFilePath);
        }
        catch (err) {
            throw new Error(`Failed to load environment file from ${envFilePath}: ${err.message}`);
        }
    }
    else {
        throw new Error(`Specified X_SEARCH_ENV_FILE does not exist: ${envFilePath}`);
    }
}
/**
 * Resolve xAI API Key from environment variable or key file.
 * Direct XAI_API_KEY has precedence over XAI_API_KEY_FILE.
 */
export function getApiKey() {
    if (process.env.XAI_API_KEY && process.env.XAI_API_KEY.trim()) {
        return process.env.XAI_API_KEY.trim();
    }
    if (process.env.XAI_API_KEY_FILE) {
        const keyFilePath = path.resolve(process.env.XAI_API_KEY_FILE);
        if (fs.existsSync(keyFilePath)) {
            try {
                const fileContent = fs.readFileSync(keyFilePath, 'utf8').trim();
                if (fileContent) {
                    return fileContent;
                }
            }
            catch (err) {
                throw new Error(`Failed to read XAI_API_KEY_FILE at ${keyFilePath}: ${err.message}`);
            }
        }
    }
    return null;
}
function parseBoundedInt(val, name, min, max, defaultVal) {
    if (val === undefined || val === null || val === '') {
        return defaultVal;
    }
    const parsed = Number.parseInt(val, 10);
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
        throw new Error(`Configuration error: ${name} must be an integer between ${min} and ${max}, got: ${val}`);
    }
    return parsed;
}
function parseAuthMode(val) {
    const mode = (val || 'auto');
    if (!['auto', 'api_key', 'oauth'].includes(mode)) {
        throw new Error(`Configuration error: X_SEARCH_AUTH_MODE must be one of 'auto', 'api_key', 'oauth', got: ${mode}`);
    }
    return mode;
}
function parseEnabled(val, name, defaultVal) {
    if (val === undefined || val === null || val === '')
        return defaultVal;
    const normalized = val.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(normalized))
        return true;
    if (['0', 'false', 'off', 'no'].includes(normalized))
        return false;
    throw new Error(`Configuration error: ${name} must be on or off, got: ${val}`);
}
function parseReasoningEffort(val) {
    if (!val)
        return undefined;
    const effort = String(val).toLowerCase();
    if (!['low', 'medium', 'high', 'xhigh'].includes(effort)) {
        throw new Error(`Configuration error: X_SEARCH_REASONING_EFFORT must be one of 'low', 'medium', 'high', 'xhigh', got: ${val}`);
    }
    return effort;
}
export function loadConfig() {
    const defaultAuthDir = path.join(os.homedir(), '.config', 'x-search-mcp');
    const defaultAuthFile = path.join(defaultAuthDir, 'auth.json');
    const authFile = process.env.X_SEARCH_AUTH_FILE
        ? path.resolve(process.env.X_SEARCH_AUTH_FILE)
        : defaultAuthFile;
    return {
        authMode: parseAuthMode(process.env.X_SEARCH_AUTH_MODE),
        authFile,
        authDir: path.dirname(authFile),
        oauthClientId: process.env.XAI_OAUTH_CLIENT_ID || 'b1a00492-073a-47ea-816f-4c329264a828',
        model: process.env.X_SEARCH_MODEL || 'grok-4.5',
        timeoutSeconds: parseBoundedInt(process.env.X_SEARCH_TIMEOUT_SECONDS, 'X_SEARCH_TIMEOUT_SECONDS', 5, 600, 180),
        retries: parseBoundedInt(process.env.X_SEARCH_RETRIES, 'X_SEARCH_RETRIES', 0, 3, 2),
        maxTurns: parseBoundedInt(process.env.X_SEARCH_MAX_TURNS, 'X_SEARCH_MAX_TURNS', 1, 20, 4),
        reasoningEffort: parseReasoningEffort(process.env.X_SEARCH_REASONING_EFFORT),
        apiKey: getApiKey(),
        logEnabled: parseEnabled(process.env.X_SEARCH_LOG, 'X_SEARCH_LOG', true),
        logDir: process.env.X_SEARCH_LOG_DIR
            ? path.resolve(process.env.X_SEARCH_LOG_DIR)
            : path.join(defaultAuthDir, 'logs'),
        logKeep: parseBoundedInt(process.env.X_SEARCH_LOG_KEEP, 'X_SEARCH_LOG_KEEP', 0, 10000, 100),
        logMaxBytes: parseBoundedInt(process.env.X_SEARCH_LOG_MAX_BYTES, 'X_SEARCH_LOG_MAX_BYTES', 4096, 33554432, 8388608),
    };
}
//# sourceMappingURL=config.js.map