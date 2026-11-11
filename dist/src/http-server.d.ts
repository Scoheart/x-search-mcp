import { type McpServerFactory } from '@modelcontextprotocol/server';
export interface HttpServerOptions {
    token: string;
    host?: string;
    port?: number;
    path?: string;
    allowedHosts?: string[];
    allowedOrigins?: string[];
    maxRequestBodyBytes?: number;
}
export interface RunningHttpServer {
    url: string;
    close(): Promise<void>;
}
export declare function normalizeHttpPath(value: string): string;
export declare function normalizeAllowedHost(value: string): string;
export declare function normalizeAllowedOrigin(value: string): string;
/** Owns one listener and the SDK's stateless per-request handler. */
export declare function startHttp(factory: McpServerFactory, options: HttpServerOptions): Promise<RunningHttpServer>;
//# sourceMappingURL=http-server.d.ts.map