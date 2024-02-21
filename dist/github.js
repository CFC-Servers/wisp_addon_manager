import { Octokit } from "@octokit/rest";
export const getGithubFile = async (ghPAT, owner, repo, path) => {
    const octokit = new Octokit({
        auth: ghPAT
    });
    console.log(`Getting file ${path} from ${repo} owned by ${owner}`);
    const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: owner,
        repo: repo,
        path: path,
        headers: {
            "X-GitHub-Api-Version": "2022-11-28",
            "Accept": "application/vnd.github.v3.raw"
        }
    });
    const data = response["data"];
    return data;
};
export const gitCommitDiff = async (ghPAT, owner, repo, oldSHA, newSHA) => {
    const octokit = new Octokit({ auth: ghPAT });
    // get first 6 of each sha
    oldSHA = oldSHA.substring(0, 6);
    newSHA = newSHA.substring(0, 6);
    const basehead = `${oldSHA}...${newSHA}`;
    const path = `/repos/${owner}/${repo}/compare/${basehead}`;
    console.log(`Getting diff between ${oldSHA} and ${newSHA} from ${repo} owned by ${owner}. Path: ${path}`);
    const content = await octokit.request(`GET ${path}`, {
        owner: owner,
        repo: repo,
        basehead: basehead,
    });
    console.log(`Got response from Github for ${owner}/${repo}`);
    const compareDTO = {
        url: content.data.html_url,
        commits: []
    };
    for (const commit of content.data.commits) {
        const author = {
            username: commit.author?.login || "unknown",
            avatar: commit.author?.avatar_url || "",
            url: commit.author?.html_url || ""
        };
        const dto = {
            sha: commit.sha,
            message: commit.commit.message,
            url: commit.html_url,
            author: author,
            verified: commit.commit.verification?.verified || false,
            date: commit.commit?.author?.date || ""
        };
        compareDTO.commits.push(dto);
    }
    return compareDTO;
};
export const getLatestCommitHashes = async (ghPAT, addons) => {
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
        const result = {};
        const response = await octokit.graphql(query);
        for (const [key, item] of Object.entries(response)) {
            const addonIndex = parseInt(key.substring(4));
            const addon = addonsList[addonIndex];
            const info = {
                latestCommit: item.ref?.target?.oid || "UNKNOWN",
                isPrivate: item.isPrivate
            };
            result[addon.url] = info;
        }
        return result;
    }
    catch (error) {
        console.error('Error fetching commit hashes:', error);
        throw error;
    }
};
