export interface DataKeyProvider {
    generate(context: string): Promise<{
        plaintext: Buffer;
        wrapped: string;
    }>;
    unwrap(wrapped: string, context: string): Promise<Buffer>;
}
export interface SealedValue {
    nonce: string;
    ciphertext: string;
    tag: string;
}
export declare function seal(key: Buffer, plaintext: Buffer, context: string): SealedValue;
export declare function open(key: Buffer, value: SealedValue, context: string): Buffer;
export declare function readPrivateFile(file: string, maxBytes: number): Buffer;
export declare function loadLocalKeyProvider(file: string): DataKeyProvider;
//# sourceMappingURL=keys.d.ts.map