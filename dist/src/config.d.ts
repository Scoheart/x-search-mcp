import type { Config } from './types.js';
/**
 * Resolve xAI API Key from environment variable or key file.
 * Direct XAI_API_KEY has precedence over XAI_API_KEY_FILE.
 */
export declare function getApiKey(): string | null;
export declare function loadConfig(): Config;
//# sourceMappingURL=config.d.ts.map