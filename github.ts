import { Octokit } from "@octokit/rest";

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

interface Verification {
  verified: boolean;
  reason: "valid" | "unsigned";
  signature: string | null;
  payload: string | null;
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

interface CompareResponse {
  data: CompareData;
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
  const octokit = new Octokit({ 
    auth: ghPAT
  });

  // get first 6 of each sha
  oldSHA = oldSHA.substring(0, 6);
  newSHA = newSHA.substring(0, 6);

  console.log(`Getting diff between ${oldSHA} and ${newSHA} from ${repo} owned by ${owner}`);
  const content = await octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
    owner: owner,
    repo: repo,
    basehead: `${oldSHA}...${newSHA}`,
  })

  console.log(content);

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
