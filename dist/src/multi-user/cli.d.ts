import type { RunningHttpServer } from '../http-server.js';
import { type MultiUserOptions } from './service.js';
export declare function loadMultiUserOptions(args: string[], env?: NodeJS.ProcessEnv): {
    options: MultiUserOptions;
    database: string;
    keys: {
        readonly type: "local";
        readonly file: string;
        readonly options?: undefined;
    } | {
        readonly type: "kms";
        readonly options: {
            readonly region: string;
            readonly keyId: string;
            readonly roleName: string;
            readonly endpoint: string | undefined;
            readonly caFile: string | undefined;
        };
        readonly file?: undefined;
    };
};
export declare function startMultiUserCli(args: string[]): Promise<RunningHttpServer>;
//# sourceMappingURL=cli.d.ts.map