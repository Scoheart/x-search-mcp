import { request, EnvHttpProxyAgent } from 'undici';

// Global HTTP proxy agent reading standard environment variables: HTTP_PROXY, HTTPS_PROXY, NO_PROXY
const proxyAgent = new EnvHttpProxyAgent();

export class HttpError extends Error {
  code: string;
  status: number | null;
  data?: any;

  constructor(code: string, message: string, status: number | null = null, data?: any) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

/**
 * Maps HTTP status code to sanitized local error.
 * Prevents leaking any credentials that might be echoed in raw upstream response bodies.
 */
export function createSanitizedHttpError(status: number, data?: any): HttpError {
  if (status === 401) {
    return new HttpError('UPSTREAM_AUTH_ERROR', 'Authentication failed with upstream xAI API (HTTP 401)', 401, data);
  }
  if (status === 403) {
    return new HttpError(
      'UPSTREAM_FORBIDDEN',
      'Access forbidden (HTTP 403). The account may lack required API balance or X Search subscription entitlements.',
      403,
      data
    );
  }
  if (status === 404) {
    return new HttpError('UPSTREAM_NOT_FOUND', 'Requested resource not found on upstream xAI API (HTTP 404)', 404, data);
  }
  if (status === 429) {
    return new HttpError('UPSTREAM_RATE_LIMITED', 'Upstream xAI rate limit exceeded (HTTP 429)', 429, data);
  }
  if (status >= 500 && status < 600) {
    return new HttpError(
      'UPSTREAM_SERVER_ERROR',
      `Upstream xAI service encountered a server error (HTTP ${status})`,
      status,
      data
    );
  }
  return new HttpError('UPSTREAM_HTTP_ERROR', `Upstream xAI returned HTTP error ${status}`, status, data);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new HttpError('cancelled', 'Request was cancelled by client'));
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new HttpError('cancelled', 'Request was cancelled by client'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface SendHttpOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | null;
  signal?: AbortSignal;
  timeoutSeconds?: number;
  retries?: number;
  isRefresh?: boolean;
}

export interface SendHttpResponse {
  status: number;
  headers: Record<string, any>;
  data: any;
}

export async function sendHttpRequest({
  url,
  method = 'GET',
  headers = {},
  body = null,
  signal,
  timeoutSeconds = 180,
  retries = 2,
  isRefresh = false,
}: SendHttpOptions): Promise<SendHttpResponse> {
  const maxRetries = isRefresh ? 0 : retries;
  let attempt = 0;

  while (true) {
    if (signal?.aborted) {
      throw new HttpError('cancelled', 'Request was cancelled by client');
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort(new Error('TIMEOUT'));
    }, timeoutSeconds * 1000);

    const abortHandler = () => {
      timeoutController.abort(new Error('CANCELLED'));
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    let response: any;
    let timedOut = false;
    let cancelled = false;

    try {
      response = await request(url, {
        method: method as any,
        headers: {
          'User-Agent': 'x-search-mcp/0.1.0',
          ...headers,
        },
        body: body as any,
        dispatcher: proxyAgent,
        signal: timeoutController.signal,
        maxRedirections: 0,
      });
    } catch (err: any) {
      if (signal?.aborted || err?.message === 'CANCELLED') {
        cancelled = true;
      } else if (timeoutController.signal.aborted || err?.name === 'AbortError' || err?.message === 'TIMEOUT') {
        timedOut = true;
      }

      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortHandler);

      if (cancelled) {
        throw new HttpError('cancelled', 'Request was cancelled by client');
      }

      const isNetworkOrTimeout = timedOut || !err.status;
      if (isNetworkOrTimeout && attempt < maxRetries) {
        attempt++;
        const backoffMs = Math.min(1500 * attempt, 5000);
        await sleep(backoffMs, signal);
        continue;
      }

      if (timedOut) {
        throw new HttpError('TIMEOUT', `Request timed out after ${timeoutSeconds} seconds`);
      }
      throw new HttpError('NETWORK_ERROR', `Network connection error: ${err.message}`);
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortHandler);
    }

    const status = response.statusCode;

    // Retry on 5xx errors if remaining retries
    if (status >= 500 && status < 600 && attempt < maxRetries) {
      attempt++;
      await response.body.dump();
      const backoffMs = Math.min(1500 * attempt, 5000);
      await sleep(backoffMs, signal);
      continue;
    }

    let responseText = '';
    try {
      responseText = await response.body.text();
    } catch (readErr: any) {
      throw new HttpError('NETWORK_ERROR', `Failed reading response body: ${readErr.message}`);
    }

    let parsedData: any = null;
    const contentType = response.headers['content-type'] || '';
    if (typeof contentType === 'string' && (contentType.includes('application/json') || responseText.trim().startsWith('{'))) {
      try {
        parsedData = JSON.parse(responseText);
      } catch {
        // Fallback to text
      }
    }

    if (status >= 400) {
      throw createSanitizedHttpError(status, parsedData);
    }

    return {
      status,
      headers: response.headers,
      data: parsedData ?? responseText,
    };
  }
}
