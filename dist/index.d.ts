export type ManageAddonsConfig = {
    domain: string;
    uuid: string;
    serverName: string;
    token: string;
    ghPAT: string;
    alertWebhook: string;
    failureWebhook: string;
    controlFile?: string;
    serverConfig?: string;
};
export declare function ManageAddons(config: ManageAddonsConfig): Promise<void>;
