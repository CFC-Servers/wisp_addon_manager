const { Octokit } = require("@octokit/rest");

export const getGithubFile = async (owner: string, repo: string, path: string) => {
  const octokit = new Octokit({ 
    auth: process.env.GH_PAT
  });

  console.log(`Getting file ${path} from ${repo} owned by ${owner}`);

  const content = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner: owner,
    repo: repo,
    path: path,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
      "Accept": "application/vnd.github.v3.raw"
    }
  })

  return content.data;
}
