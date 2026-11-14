import { type DataKeyProvider } from './keys.js';
export interface Principal {
    issuer: string;
    subject: string;
}
export declare class BindingChangedError extends Error {
    constructor();
}
export declare function validApiKey(value: string): boolean;
export declare class BindingStore {
    private readonly keys;
    private readonly db;
    constructor(file: string, keys: DataKeyProvider);
    private row;
    has(user: Principal): boolean;
    bind(user: Principal, apiKey: string): Promise<void>;
    get(user: Principal): Promise<string | null>;
    unbind(user: Principal): boolean;
    close(): void;
}
//# sourceMappingURL=bindings.d.ts.map