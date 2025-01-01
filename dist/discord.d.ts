import type { AddonDeleteInfo, AddonCreateInfo, AddonUpdateInfo } from "./index_types.js";
import type { AddonDeleteFailure, AddonCreateFailure, AddonUpdateFailure } from "./index_types.js";
export interface ChangeMap {
    update: AddonUpdateInfo[];
    delete: AddonDeleteInfo[];
    create: AddonCreateInfo[];
}
export interface FailureMap {
    update: AddonUpdateFailure[];
    delete: AddonDeleteFailure[];
    create: AddonCreateFailure[];
}
export declare const generateUpdateWebhook: (addonUpdates: ChangeMap, alertWebhook: string, serverName: string) => Promise<void>;
export declare const generateFailureWebhook: (addonFailures: FailureMap, alertWebhook: string, serverName: string) => Promise<boolean | undefined>;
export declare const sendServerConfigEmbed: (webhook: string, serverName: string, configDiff: string) => Promise<void>;
