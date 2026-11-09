import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Config, AuthMode, ReasoningEffort } from './types.js';

// Load explicit env file if configured
if (process.env.X_SEARCH_ENV_FILE) {
  const envFilePath = path.resolve(process.env.X_SEARCH_ENV_FILE);
  if (fs.existsSync(envFilePath)) {
    try {
      // @ts-expect-error Node.js >=21.7 / 22+ built-in
      process.loadEnvFile(envFilePath);
    } catch (err: any) {
      throw new Error(`Failed to load environment file from ${envFilePath}: ${err.message}`);
    }
  } else {
    throw new Error(`Specified X_SEARCH_ENV_FILE does not exist: ${envFilePath}`);
  }
}

/**
 * Resolve xAI API Key from environment variable or key file.
 * Direct XAI_API_KEY has precedence over XAI_API_KEY_FILE.
 */
export function getApiKey(): string | null {
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
      } catch (err: any) {
        throw new Error(`Failed to read XAI_API_KEY_FILE at ${keyFilePath}: ${err.message}`);
      }
    }
  }

  return null;
}

function parseBoundedInt(val: string | undefined, name: string, min: number, max: number, defaultVal: number): number {
  if (val === undefined || val === null || val === '') {
    return defaultVal;
  }
  const parsed = Number.parseInt(val, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    throw new Error(`Configuration error: ${name} must be an integer between ${min} and ${max}, got: ${val}`);
  }
  return parsed;
}

function parseAuthMode(val: string | undefined): AuthMode {
  const mode = (val || 'auto') as AuthMode;
  if (!['auto', 'api_key', 'oauth'].includes(mode)) {
    throw new Error(`Configuration error: X_SEARCH_AUTH_MODE must be one of 'auto', 'api_key', 'oauth', got: ${mode}`);
  }
  return mode;
}

function parseReasoningEffort(val: string | undefined): ReasoningEffort | undefined {
  if (!val) return undefined;
  const effort = String(val).toLowerCase() as ReasoningEffort;
  if (!['low', 'medium', 'high', 'xhigh'].includes(effort)) {
    throw new Error(`Configuration error: X_SEARCH_REASONING_EFFORT must be one of 'low', 'medium', 'high', 'xhigh', got: ${val}`);
  }
  return effort;
}

export function loadConfig(): Config {
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
  };
}
