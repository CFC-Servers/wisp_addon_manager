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
export interface AddonDeleteInfo {
    addon: InstalledAddon;
}
export interface AddonCreateInfo {
    addon: DesiredAddon;
    isPrivate: boolean;
}
export interface AddonUpdateInfo {
    addon: InstalledAddon;
    updateInfo: CompareDTO;
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
export interface AddonGitInfo {
    addon: string;
    branch: string;
    commit: string;
}
