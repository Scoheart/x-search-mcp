import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createSecureContext } from 'node:tls';
const require = createRequire(import.meta.url);
// Alibaba Cloud's generated SDKs expose their client constructors through CommonJS.
const { default: KmsClient, GenerateDataKeyRequest, DecryptRequest } = require('@alicloud/kms20160120');
const { default: Credential, Config: CredentialConfig } = require('@alicloud/credentials');
const { $OpenApiUtil } = require('@alicloud/openapi-core');
function encryptionContext(context) {
    return { binding: createHash('sha256').update(context).digest('hex') };
}
function dataKey(body, expectedKeyId) {
    if (body?.keyId !== expectedKeyId || !body.plaintext || !/^[A-Za-z0-9+/]{43}=$/.test(body.plaintext)) {
        throw new Error('Unexpected KMS data key response');
    }
    return Buffer.from(body.plaintext, 'base64');
}
export function createAliyunKeyProvider({ region, keyId, roleName, endpoint, caFile }) {
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(region))
        throw new Error('Set a valid Alibaba Cloud KMS region');
    if (!/^(?:key-[a-z0-9-]{1,110}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(keyId)) {
        throw new Error('Set the concrete KMS key ID');
    }
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(roleName))
        throw new Error('Set the ECS RAM role name for KMS');
    const vpc = `kms-vpc.${region}.aliyuncs.com`;
    const host = endpoint ?? vpc;
    const dedicated = /^[a-z0-9-]{1,63}\.cryptoservice\.kms\.aliyuncs\.com$/.test(host);
    if (host !== vpc && host !== `kms.${region}.aliyuncs.com` && !dedicated) {
        throw new Error('Set a valid regional or dedicated Alibaba Cloud KMS endpoint');
    }
    if (dedicated && !caFile)
        throw new Error('Set the Alibaba Cloud KMS instance CA file for a dedicated endpoint');
    let ca;
    if (caFile) {
        try {
            ca = readFileSync(caFile, 'utf8');
            if (!ca.includes('-----BEGIN CERTIFICATE-----'))
                throw new Error('Invalid certificate');
            createSecureContext({ ca });
        }
        catch {
            throw new Error('Could not load the Alibaba Cloud KMS instance CA certificate');
        }
    }
    const credential = new Credential(new CredentialConfig({
        type: 'ecs_ram_role', roleName, disableIMDSv1: true, asyncCredentialUpdateEnabled: false,
        timeout: 3_000, connectTimeout: 2_000,
    }));
    const kms = new KmsClient(new $OpenApiUtil.Config({
        credential, regionId: region, endpoint: host, protocol: 'HTTPS', ca,
        noProxy: host, readTimeout: 5_000, connectTimeout: 3_000,
    }));
    return {
        async generate(context) {
            try {
                const { body } = await kms.generateDataKey(new GenerateDataKeyRequest({
                    keyId, numberOfBytes: 32, encryptionContext: encryptionContext(context),
                }));
                const wrapped = body?.ciphertextBlob;
                if (!wrapped || wrapped.length > 16_384)
                    throw new Error('Unexpected KMS ciphertext');
                return { plaintext: dataKey(body, keyId), wrapped };
            }
            catch {
                throw new Error('KMS could not generate a data key');
            }
        },
        async unwrap(wrapped, context) {
            try {
                const { body } = await kms.decrypt(new DecryptRequest({
                    ciphertextBlob: wrapped, encryptionContext: encryptionContext(context),
                }));
                return dataKey(body, keyId);
            }
            catch {
                throw new Error('KMS could not decrypt the data key');
            }
        },
    };
}
//# sourceMappingURL=kms.js.map