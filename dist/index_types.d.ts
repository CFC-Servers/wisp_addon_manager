import { CompareDTO } from "./github.js";
export interface DesiredAddon {
    url: string;
    owner: string;
    repo: string;
    branch: string;
    name?: string;
}
export interface InstalledAddon {
    path: string;
    name: string;
    url: string;
    owner: string;
    repo: string;
    branch: string;
    commit: string;
}
export type AddonURLToAddonMap = {
    [url: string]: InstalledAddon;
};
export interface AddonDeleteInfo {
    addon: InstalledAddon;
}
export interface AddonCreateInfo {
    addon: DesiredAddon;
    isPrivate: boolean;
}
export interface AddonUpdateInfo {
    addon: InstalledAddon;
    updateInfo: CompareDTO | undefined;
    isPrivate?: boolean;
}
export interface AddonDeleteFailure {
    addon: InstalledAddon;
    error: string;
}
export interface AddonCreateFailure {
    addon: DesiredAddon;
    error: string;
}
export interface AddonUpdateFailure {
    addon: InstalledAddon;
    error: string;
}
export interface ServerGitInfoFile {
    generatedAt: number;
    installedAddons: InstalledAddon[];
}
export interface AddonRemoteGitInfo {
    latestCommit: string;
    isPrivate: boolean;
}
export type AddonRemoteGitInfoMap = {
    [url: string]: AddonRemoteGitInfo;
};
