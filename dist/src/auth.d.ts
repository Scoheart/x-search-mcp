import type { AuthRecord, AuthStatus, DiscoveryMetadata } from './types.js';
/**
 * Validate that an OAuth URL is secure and points strictly to an authorized x.ai domain.
 */
export declare function validateOAuthUrl(rawUrl: string): URL;
/**
 * Fetch and validate OIDC discovery metadata from x.ai.
 */
export declare function getDiscoveryMetadata(): Promise<DiscoveryMetadata>;
/**
 * Extract expiry timestamp from JWT payload exp claim.
 * Note: Decoding the JWT payload is only used to extract the expiry timestamp;
 * it is NOT cryptographic verification of the token signature.
 */
export declare function extractJwtExpiry(jwtToken: string | undefined): number | null;
export declare function saveAuthDataAtomic(authFilePath: string, data: AuthRecord): void;
export declare function readAuthData(authFilePath: string): AuthRecord | null;
/**
 * Execute OAuth Device Code login flow.
 * Outputs user_code and verification URL, polls until user authorization is completed.
 */
export declare function loginWithDeviceCode(): Promise<void>;
/**
 * Get valid OAuth access token, refreshing preemptively if expiring within 120s.
 * Concurrency-safe: shares auth.json across multiple agent processes using proper-lockfile.
 */
export declare function getValidOAuthAccessToken(): Promise<string>;
/**
 * Force refresh token on HTTP 401 error.
 * If another concurrent process has already rotated the token, the new token is reused.
 */
export declare function forceRefreshToken(rejectedAccessToken: string): Promise<string>;
/**
 * Retrieve auth status without probing quota or revealing secret tokens.
 */
export declare function getAuthStatus(): AuthStatus;
/**
 * Logout by safely removing the local OAuth auth.json file under lock.
 * Does NOT revoke cloud authorization and does NOT modify API keys.
 */
export declare function logout(): Promise<void>;
//# sourceMappingURL=auth.d.ts.map