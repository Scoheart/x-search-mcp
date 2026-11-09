export type AuthMode = 'auto' | 'api_key' | 'oauth';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface Config {
  authMode: AuthMode;
  authFile: string;
  authDir: string;
  oauthClientId: string;
  model: string;
  timeoutSeconds: number;
  retries: number;
  maxTurns: number;
  reasoningEffort?: ReasoningEffort;
  apiKey: string | null;
  logEnabled: boolean;
  logDir: string;
  logKeep: number;
  logMaxBytes: number;
}

export interface XSearchInput {
  query: string;
  allowed_x_handles?: string[];
  excluded_x_handles?: string[];
  from_date?: string;
  to_date?: string;
  enable_image_understanding?: boolean;
  enable_video_understanding?: boolean;
  auth_mode?: AuthMode;
}

export interface InlineCitation {
  url: string;
  title: string | null;
  start_index: number | null;
  end_index: number | null;
}

export interface ServerSideCall {
  call_id: string | null;
  name: string | null;
  arguments: any;
}

export interface CallLogAttempt {
  http_status: number | null;
  raw_response: unknown;
  raw_response_truncated?: boolean;
  raw_response_bytes?: number;
  error: { code: string; message: string; status: number | null } | null;
}

export interface CallLogEntry {
  started_at: string;
  elapsed_ms: number;
  endpoint: string;
  model: string;
  query: string;
  credential_source: 'api_key' | 'oauth' | null;
  billing_mode: 'api_metered' | 'subscription_oauth' | null;
  request: unknown;
  attempts: CallLogAttempt[];
  outcome: 'success' | 'error';
  error: { code: string; message: string; status: number | null } | null;
}

export interface XSearchResult {
  success: boolean;
  provider: 'xai';
  tool: 'x_search';
  model: string;
  query: string;
  credential_source: 'api_key' | 'oauth';
  billing_mode: 'api_metered' | 'subscription_oauth';
  answer: string;
  citations: string[];
  inline_citations: InlineCitation[];
  has_citations: boolean;
  degraded: boolean;
  degraded_reason: string | null;
  search_execution: 'observed' | 'unreported';
  server_side_calls: ServerSideCall[];
  response_status: string;
  incomplete_details: any;
  usage: any;
  warnings: string[];
  log_file: string | null;
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
}

export interface AuthRecord {
  version: number;
  client_id: string;
  token_endpoint: string;
  tokens: AuthTokens;
  expires_at: number;
}

export interface AuthStatus {
  hasApiKey: boolean;
  apiKeyConfiguredFrom: 'environment_variable' | 'key_file' | null;
  hasOAuth: boolean;
  oauthExpiresAt: string | null;
  defaultAuthMode: AuthMode;
  authFile: string;
}

export interface DiscoveryMetadata {
  token_endpoint: string;
  device_authorization_endpoint: string;
}
