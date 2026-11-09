export declare class HttpError extends Error {
    code: string;
    status: number | null;
    data?: any;
    constructor(code: string, message: string, status?: number | null, data?: any);
}
/**
 * Maps HTTP status code to sanitized local error.
 * Prevents leaking any credentials that might be echoed in raw upstream response bodies.
 */
export declare function createSanitizedHttpError(status: number, data?: any): HttpError;
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
export declare function sendHttpRequest({ url, method, headers, body, signal, timeoutSeconds, retries, isRefresh, }: SendHttpOptions): Promise<SendHttpResponse>;
//# sourceMappingURL=http.d.ts.map