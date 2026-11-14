import type { HttpAuthentication } from '../http-server.js';
import { type BindingStore } from './bindings.js';
import { type IdentityOptions } from './identity.js';
export interface SettingsOptions {
    clientId: string;
    clientSecret: string;
}
export declare function createSettings(options: SettingsOptions & IdentityOptions, publicOrigin: string, invited: (subject: unknown) => subject is string, store: BindingStore): Promise<NonNullable<HttpAuthentication['route']>>;
//# sourceMappingURL=settings.d.ts.map