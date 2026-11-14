import type { DataKeyProvider } from './keys.js';
export interface AliyunKmsOptions {
    region: string;
    keyId: string;
    roleName: string;
    endpoint?: string;
    caFile?: string;
}
export declare function createAliyunKeyProvider({ region, keyId, roleName, endpoint, caFile }: AliyunKmsOptions): DataKeyProvider;
//# sourceMappingURL=kms.d.ts.map