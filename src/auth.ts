import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import lockfile from 'proper-lockfile';
import { sendHttpRequest, HttpError } from './http.js';
import { loadConfig } from './config.js';
import type { AuthRecord, AuthStatus, DiscoveryMetadata } from './types.js';

const DISCOVERY_URL = 'https://auth.x.ai/.well-known/openid-configuration';
const DEFAULT_SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const LOCK_OPTIONS = {
  realpath: false,
  stale: 60000,
  update: 10000,
  retries: {
    retries: 100,
    minTimeout: 100,
    maxTimeout: 500,
    factor: 1.1,
  },
};

/**
 * Validate that an OAuth URL is secure and points strictly to an authorized x.ai domain.
 */
export function validateOAuthUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid OAuth endpoint URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`OAuth endpoint must use HTTPS: ${rawUrl}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isValidHost = hostname === 'x.ai' || hostname.endsWith('.x.ai');
  if (!isValidHost) {
    throw new Error(`OAuth endpoint host must be x.ai or a subdomain of x.ai: ${parsed.hostname}`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('OAuth endpoint URL must not contain user credentials');
  }

  if (parsed.port && parsed.port !== '443') {
    throw new Error(`OAuth endpoint must use default HTTPS port 443, got port: ${parsed.port}`);
  }

  return parsed;
}

/**
 * Fetch and validate OIDC discovery metadata from x.ai.
 */
export async function getDiscoveryMetadata(): Promise<DiscoveryMetadata> {
  validateOAuthUrl(DISCOVERY_URL);
  const res = await sendHttpRequest({
    url: DISCOVERY_URL,
    method: 'GET',
    timeoutSeconds: 30,
    retries: 2,
  });

  const data = typeof res.data === 'object' && res.data !== null ? res.data : {};
  const tokenEndpoint = data.token_endpoint || 'https://auth.x.ai/oauth2/token';
  const deviceEndpoint = data.device_authorization_endpoint || 'https://auth.x.ai/oauth2/device/code';

  validateOAuthUrl(tokenEndpoint);
  validateOAuthUrl(deviceEndpoint);

  return {
    token_endpoint: tokenEndpoint,
    device_authorization_endpoint: deviceEndpoint,
  };
}

/**
 * Extract expiry timestamp from JWT payload exp claim.
 * Note: Decoding the JWT payload is only used to extract the expiry timestamp;
 * it is NOT cryptographic verification of the token signature.
 */
export function extractJwtExpiry(jwtToken: string | undefined): number | null {
  if (!jwtToken || typeof jwtToken !== 'string') return null;
  const parts = jwtToken.split('.');
  if (parts.length !== 3) return null;

  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
  } catch {
    // Return null if unparseable
  }
  return null;
}

function ensureAuthFileExists(authFilePath: string): void {
  const dir = path.dirname(authFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Best effort chmod
    }
  }

  if (!fs.existsSync(authFilePath)) {
    fs.writeFileSync(authFilePath, '', { mode: 0o600 });
  } else {
    try {
      fs.chmodSync(authFilePath, 0o600);
    } catch {
      // Best effort chmod
    }
  }
}

export function saveAuthDataAtomic(authFilePath: string, data: AuthRecord): void {
  const dir = path.dirname(authFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const randomSuffix = crypto.randomBytes(8).toString('hex');
  const tempFilePath = path.join(dir, `.auth.${Date.now()}.${randomSuffix}.tmp`);

  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(tempFilePath, content, { mode: 0o600, encoding: 'utf8' });
  fs.renameSync(tempFilePath, authFilePath);

  try {
    fs.chmodSync(authFilePath, 0o600);
  } catch {
    // Best effort
  }
}

export function readAuthData(authFilePath: string): AuthRecord | null {
  if (!fs.existsSync(authFilePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(authFilePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as AuthRecord;
  } catch {
    return null;
  }
}

/**
 * Execute OAuth Device Code login flow.
 * Outputs user_code and verification URL, polls until user authorization is completed.
 */
export async function loginWithDeviceCode(): Promise<void> {
  const config = loadConfig();
  const discovery = await getDiscoveryMetadata();

  const deviceParams = new URLSearchParams({
    client_id: config.oauthClientId,
    scope: DEFAULT_SCOPE,
  });

  const deviceRes = await sendHttpRequest({
    url: discovery.device_authorization_endpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: deviceParams.toString(),
    timeoutSeconds: 30,
    retries: 2,
  });

  const deviceData = deviceRes.data;
  if (!deviceData || !deviceData.device_code || !deviceData.user_code) {
    throw new Error('Failed to obtain device authorization code from upstream xAI');
  }

  const {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: expiresIn = 600,
    interval: pollInterval = 5,
  } = deviceData;

  const authUrl = verificationUriComplete || verificationUri;
  const expiresAtDate = new Date(Date.now() + expiresIn * 1000).toLocaleTimeString();

  console.error('\n========================================================');
  console.error('  xAI Subscription OAuth Device Login');
  console.error('========================================================');
  console.error(`1. Visit the authorization page: ${authUrl}`);
  console.error(`2. Confirm code: ${userCode}`);
  console.error(`3. Code expires at: ${expiresAtDate} (in ${expiresIn}s)`);
  console.error('\nWaiting for browser authorization (Ctrl+C to cancel)...');

  let currentInterval = Math.max(pollInterval, 3);
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, currentInterval * 1000));

    const tokenParams = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: config.oauthClientId,
      device_code: deviceCode,
    });

    let tokenRes: any;
    try {
      tokenRes = await sendHttpRequest({
        url: discovery.token_endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenParams.toString(),
        timeoutSeconds: 30,
        retries: 0,
      });
    } catch (err: any) {
      if (err instanceof HttpError && err.data && typeof err.data === 'object') {
        const oauthError = err.data.error;
        if (oauthError === 'authorization_pending') {
          continue;
        }
        if (oauthError === 'slow_down') {
          currentInterval += 5;
          continue;
        }
        if (oauthError === 'expired_token') {
          throw new Error('Device code has expired. Please run login again.');
        }
        if (oauthError === 'access_denied') {
          throw new Error('Authorization was denied by the user.');
        }
      }
      throw err;
    }

    const tokenData = tokenRes.data;
    if (tokenData && tokenData.access_token) {
      const tokenExpiresIn = tokenData.expires_in;
      let expiresAt = tokenExpiresIn ? Date.now() + tokenExpiresIn * 1000 : null;
      if (!expiresAt) {
        expiresAt = extractJwtExpiry(tokenData.access_token);
      }
      if (!expiresAt) {
        expiresAt = Date.now() + 3600 * 1000;
      }

      const record: AuthRecord = {
        version: 1,
        client_id: config.oauthClientId,
        token_endpoint: discovery.token_endpoint,
        tokens: {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
        },
        expires_at: expiresAt,
      };

      ensureAuthFileExists(config.authFile);
      const release = await lockfile.lock(config.authFile, LOCK_OPTIONS);
      try {
        saveAuthDataAtomic(config.authFile, record);
      } finally {
        await release();
      }

      console.error('\n✓ Successfully authenticated with xAI Subscription OAuth.');
      console.error(`Tokens saved to: ${config.authFile}\n`);
      return;
    }
  }

  throw new Error('Device code expired without receiving authorization. Please run login again.');
}

async function performTokenRefreshUnderLock(authData: AuthRecord, authFilePath: string): Promise<string> {
  const refreshToken = authData?.tokens?.refresh_token;
  if (!refreshToken) {
    throw new Error('No refresh token available. Run "x-search-mcp auth login" to authenticate.');
  }

  const tokenEndpoint = authData.token_endpoint || 'https://auth.x.ai/oauth2/token';
  validateOAuthUrl(tokenEndpoint);

  const refreshParams = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: authData.client_id,
    refresh_token: refreshToken,
  });

  const res = await sendHttpRequest({
    url: tokenEndpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: refreshParams.toString(),
    timeoutSeconds: 30,
    retries: 0,
    isRefresh: true, // Auto-retry strictly disabled for refresh requests
  });

  const data = res.data;
  if (!data || !data.access_token) {
    throw new Error('Token refresh response did not contain an access_token');
  }

  let expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null;
  if (!expiresAt) {
    expiresAt = extractJwtExpiry(data.access_token);
  }
  if (!expiresAt) {
    expiresAt = Date.now() + 3600 * 1000;
  }

  const updatedRecord: AuthRecord = {
    ...authData,
    tokens: {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
    },
    expires_at: expiresAt,
  };

  saveAuthDataAtomic(authFilePath, updatedRecord);
  return updatedRecord.tokens.access_token;
}

/**
 * Get valid OAuth access token, refreshing preemptively if expiring within 120s.
 * Concurrency-safe: shares auth.json across multiple agent processes using proper-lockfile.
 */
export async function getValidOAuthAccessToken(): Promise<string> {
  const config = loadConfig();
  const authFilePath = config.authFile;

  let authData = readAuthData(authFilePath);
  if (!authData || !authData.tokens || !authData.tokens.access_token) {
    throw new Error(`No OAuth tokens found in ${authFilePath}. Run "x-search-mcp auth login" first.`);
  }

  const now = Date.now();
  const timeRemaining = (authData.expires_at || 0) - now;

  if (timeRemaining > 120_000) {
    return authData.tokens.access_token;
  }

  ensureAuthFileExists(authFilePath);
  const release = await lockfile.lock(authFilePath, LOCK_OPTIONS);
  try {
    authData = readAuthData(authFilePath);
    const updatedRemaining = (authData?.expires_at || 0) - Date.now();
    if (updatedRemaining > 120_000 && authData?.tokens?.access_token) {
      return authData.tokens.access_token;
    }

    if (!authData) {
      throw new Error('Authentication data was deleted during token refresh.');
    }

    return await performTokenRefreshUnderLock(authData, authFilePath);
  } finally {
    await release();
  }
}

/**
 * Force refresh token on HTTP 401 error.
 * If another concurrent process has already rotated the token, the new token is reused.
 */
export async function forceRefreshToken(rejectedAccessToken: string): Promise<string> {
  const config = loadConfig();
  const authFilePath = config.authFile;

  ensureAuthFileExists(authFilePath);
  const release = await lockfile.lock(authFilePath, LOCK_OPTIONS);
  try {
    const authData = readAuthData(authFilePath);
    if (!authData || !authData.tokens) {
      throw new Error('OAuth authentication file is missing or corrupted.');
    }

    if (authData.tokens.access_token && authData.tokens.access_token !== rejectedAccessToken) {
      return authData.tokens.access_token;
    }

    return await performTokenRefreshUnderLock(authData, authFilePath);
  } finally {
    await release();
  }
}

/**
 * Retrieve auth status without probing quota or revealing secret tokens.
 */
export function getAuthStatus(): AuthStatus {
  const config = loadConfig();
  const authData = readAuthData(config.authFile);

  const hasApiKey = Boolean(config.apiKey);
  const hasOAuth = Boolean(authData?.tokens?.access_token);

  let oauthExpiresAt: string | null = null;
  if (hasOAuth && authData?.expires_at) {
    oauthExpiresAt = new Date(authData.expires_at).toISOString();
  }

  return {
    hasApiKey,
    apiKeyConfiguredFrom: process.env.XAI_API_KEY ? 'environment_variable' : process.env.XAI_API_KEY_FILE ? 'key_file' : null,
    hasOAuth,
    oauthExpiresAt,
    defaultAuthMode: config.authMode,
    authFile: config.authFile,
  };
}

/**
 * Logout by safely removing the local OAuth auth.json file under lock.
 * Does NOT revoke cloud authorization and does NOT modify API keys.
 */
export async function logout(): Promise<void> {
  const config = loadConfig();
  const authFilePath = config.authFile;

  if (!fs.existsSync(authFilePath)) {
    console.error('No OAuth auth file found. Already logged out.');
    return;
  }

  const release = await lockfile.lock(authFilePath, LOCK_OPTIONS);
  try {
    if (fs.existsSync(authFilePath)) {
      fs.unlinkSync(authFilePath);
    }
    console.error(`✓ Removed local OAuth token file: ${authFilePath}`);
  } finally {
    await release();
  }
}
