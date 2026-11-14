import type { AuthInfo } from '@modelcontextprotocol/server';
import type { Principal } from './bindings.js';
export interface IdentityOptions {
    issuer: string;
    jwksUri: string;
    scope: string;
    allowedSubjects: readonly string[];
    identityFetch?: typeof fetch;
}
export declare const fetchIdentity: typeof fetch;
export declare function httpsUrl(value: string, name: string): URL;
export declare function createIdentity(options: IdentityOptions, resource: URL, settingsClientId: string): {
    verify: (token: string) => Promise<AuthInfo | "insufficient_scope" | "forbidden" | null>;
    invited: (subject: unknown) => subject is string;
};
export declare function principalFrom(auth: AuthInfo | undefined): Principal | undefined;
//# sourceMappingURL=identity.d.ts.map