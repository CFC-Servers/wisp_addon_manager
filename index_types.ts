const { CompareDTO } = require("./github");

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

// TODO: Make a new interface for each change type?
export interface AddonChangeInfo {
  addon: InstalledAddon | DesiredAddon;
  change: "create" | "update" | "delete";
  updateInfo?: typeof CompareDTO;
  isPrivate?: boolean;
}
