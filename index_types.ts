import { CompareDTO } from "./github.js";

export interface DesiredAddon {
  url: string
  owner: string
  repo: string
  branch: string
  destination?: string
}

export interface InstalledAddon {
  path: string;
  url: string;
  owner: string;
  repo: string;
  branch: string;
  commit: string;
}


export interface AddonDeleteInfo {
  addon: InstalledAddon
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

export type AddonChangeInfo = AddonDeleteInfo | AddonCreateInfo | AddonUpdateInfo;