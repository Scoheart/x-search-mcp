import { type HttpServerOptions } from './http-server.js';
/** Parse listener options without reading a single-account credential. */
export declare function parseHttpOptions(args: string[], env: NodeJS.ProcessEnv): {
    host: string;
    port: number;
    path: string | undefined;
    allowedHosts: string[];
    allowedOrigins: string[];
    tokenFile: string | undefined;
};
/** CLI flags override environment defaults; an explicit token file wins over env credentials. */
export declare function loadHttpOptions(args: string[], env?: NodeJS.ProcessEnv): HttpServerOptions;
//# sourceMappingURL=http-config.d.ts.map