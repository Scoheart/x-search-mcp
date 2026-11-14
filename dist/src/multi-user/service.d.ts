import { type RunningHttpServer } from '../http-server.js';
import type { BindingStore } from './bindings.js';
import { type IdentityOptions } from './identity.js';
import { type SettingsOptions } from './settings.js';
export interface MultiUserOptions extends IdentityOptions {
    publicUrl: string;
    host?: '127.0.0.1' | '::1';
    port?: number;
    allowedOrigins?: string[];
    settings: SettingsOptions;
}
export declare function startMultiUserHttp(options: MultiUserOptions, store: BindingStore): Promise<RunningHttpServer>;
//# sourceMappingURL=service.d.ts.map