import type { AddonURLToAddonMap, AddonRemoteGitInfoMap } from "./index_types.js";
export declare const getGithubFile: (ghPAT: string, owner: string, repo: string, path: string) => Promise<string>;
interface AuthorDTO {
    username: string;
    avatar: string;
    url: string;
}
export interface CommitDTO {
    sha: string;
    message: string;
    url: string;
    author: AuthorDTO;
    verified: boolean;
    date: string;
}
export interface CompareDTO {
    url: string;
    commits: CommitDTO[];
}
export declare const gitCommitDiff: (ghPAT: string, owner: string, repo: string, oldSHA: string, newSHA: string) => Promise<CompareDTO>;
export declare const requestHashes: (ghPAT: string, addons: AddonURLToAddonMap) => Promise<AddonRemoteGitInfoMap>;
export declare const getLatestCommitHashes: (ghPAT: string, addons: AddonURLToAddonMap) => Promise<AddonRemoteGitInfoMap>;
export {};
