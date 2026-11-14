import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type AuthInfo, type McpServerFactory } from '@modelcontextprotocol/server';
export interface HttpServerOptions {
    token?: string;
    authentication?: HttpAuthentication;
    host?: string;
    port?: number;
    path?: string;
    allowedHosts?: string[];
    allowedOrigins?: string[];
    maxRequestBodyBytes?: number;
}
export interface HttpAuthentication {
    resourceMetadataUrl: string;
    scope: string;
    verify(token: string): Promise<AuthInfo | 'insufficient_scope' | 'forbidden' | null>;
    route?(path: string, request: IncomingMessage, response: ServerResponse): Promise<boolean>;
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