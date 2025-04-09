import { Octokit } from "@octokit/rest";
import type { AddonRemoteGitInfo, AddonURLToAddonMap, AddonRemoteGitInfoMap }  from "./index_types.js";

export const getGithubFile = async (ghPAT: string, owner: string, repo: string, path: string) => {
  const octokit = new Octokit({ 
    auth: ghPAT
  });

  console.log(`Getting file ${path} from ${repo} owned by ${owner}`);

  const response: any = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner: owner,
    repo: repo,
    path: path,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
      "Accept": "application/vnd.github.v3.raw"
    }
  });

  const data: string = response["data"];
  return data;
}

interface MinimalCommit {
  sha: string;
  url: string;
  html_url: string;
}

interface Tree {
  sha: string;
  url: string;
}

interface CommitAuthor {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  gravatar_id: string;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: "User" | "Organization";
  site_admin: boolean;
}

interface MinimalAuthor {
  name: string;
  email: string;
  date: string;
}

interface CommitSummary {
  author: MinimalAuthor;
  committer: MinimalAuthor;
  message: string;
  tree: Tree;
  url: string;
  comment_count: number;
}

interface Commit {
  sha: string;
  node_id: string;
  commit: any;
  url: string;
  html_url: string;
  comments_url: string;
  author: CommitAuthor;
  committer: CommitAuthor;
  parents: MinimalCommit[];
}

interface File {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  patch: string;
}

interface CompareData {
  url: string;
  html_url: string;
  permalink_url: string;
  diff_url: string;
  patch_url: string;
  base_commit: Commit;
  merge_base_commit: Commit;
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  commits: Commit[];
  files: File[];
}

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
  url: string; // URl to the web page showing the diff
  commits: CommitDTO[];
}

export const gitCommitDiff = async (ghPAT: string, owner: string, repo: string, oldSHA: string, newSHA: string) => {
  const octokit = new Octokit({ auth: ghPAT })

  // get first 6 of each sha
  oldSHA = oldSHA.substring(0, 6)
  newSHA = newSHA.substring(0, 6)

  const basehead = `${oldSHA}...${newSHA}`
  const path = `/repos/${owner}/${repo}/compare/${basehead}`
  console.log(`Getting diff between ${oldSHA} and ${newSHA} from ${repo} owned by ${owner}. Path: ${path}`)

  const content = await octokit.request(`GET ${path}`, {
    owner: owner,
    repo: repo,
    basehead: basehead,
  })
  console.log(`Got response from Github for ${owner}/${repo}`)

  const compareDTO: CompareDTO = {
    url: content.data.html_url,
    commits: []
  };

  for (const commit of content.data.commits) {
    const author: AuthorDTO = {
      username: commit.author?.login || "unknown",
      avatar: commit.author?.avatar_url || "",
      url: commit.author?.html_url || ""
    }

    const dto: CommitDTO = {
      sha: commit.sha,
      message: commit.commit.message,
      url: commit.html_url,
      author: author,
      verified: commit.commit.verification?.verified || false,
      date: commit.commit?.author?.date || ""
    }

    compareDTO.commits.push(dto);
  }

  return compareDTO;
}

interface RepoCommitResponseItem {
  ref: {
    target: {
      oid: string;
    }
  }
  isPrivate: boolean;
}

export const requestHashes = async (ghPAT: string, addons: AddonURLToAddonMap) => {
  const octokit = new Octokit({ auth: ghPAT });
  const addonsList = Object.values(addons);

  let query = `query {`;

  addonsList.forEach((addon, index) => {
    query += `
      repo${index}: repository(owner: "${addon.owner}", name: "${addon.repo}") {
        isPrivate
        ref(qualifiedName: "${addon.branch}") {
          target {
            ... on Commit {
              oid
            }
          }
        }
      }
    `;
  });

  query += `}`;

  try {
    const result: AddonRemoteGitInfoMap = {};
    const response: {[index: string]: RepoCommitResponseItem} = await octokit.graphql(query);

    for (const [key, item] of Object.entries(response)) {
      const addonIndex = parseInt(key.substring(4));
      const addon = addonsList[addonIndex];

      const info: AddonRemoteGitInfo = {
        latestCommit: item.ref?.target?.oid || "UNKNOWN",
        isPrivate: item.isPrivate
      }

      result[addon.url] = info;
    }

    return result;
  } catch (error) {
    console.error('Error fetching commit hashes:', error);
    throw error;
  }
}

export const getLatestCommitHashes = async (ghPAT: string, addons: AddonURLToAddonMap) => {
    const fullResults: AddonRemoteGitInfoMap = {}
    const chunkSize = 50;

    const chunks: AddonURLToAddonMap[] = [];
    for (let i = 0; i < Object.keys(addons).length; i += chunkSize) {
      chunks.push(Object.fromEntries(Object.entries(addons).slice(i, i + chunkSize)));
    }

    let chunkNumber = 0;
    const totalChunks = chunks.length;
    for (const chunk of chunks) {
      chunkNumber = chunkNumber + 1;
      console.log(`Processing chunk ${chunkNumber} of ${totalChunks}`);

      const result = await requestHashes(ghPAT, chunk);
      Object.assign(fullResults, result);
    }

    return fullResults;
}

