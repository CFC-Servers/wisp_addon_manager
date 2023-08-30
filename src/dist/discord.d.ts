import type { AddonDeleteInfo, AddonCreateInfo, AddonUpdateInfo, InstalledAddon } from "./index_types.js";
export interface ChangeMap {
    update: AddonUpdateInfo[];
    delete: AddonDeleteInfo[];
    create: AddonCreateInfo[];
}
export interface FailureMap {
    update: InstalledAddon[];
    delete: InstalledAddon[];
    create: AddonCreateInfo[];
}
export declare const generateUpdateWebhook: (addonUpdates: ChangeMap, alertWebhook: string) => Promise<void>;
