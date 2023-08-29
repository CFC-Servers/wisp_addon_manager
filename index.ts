import * as winston from "winston";
const yaml = require("js-yaml");

import { WispInterface } from "wispjs";
import type { FilesearchResults, GitPullResult, GitCloneResult } from "wispjs";

import { getGithubFile, gitCommitDiff, CompareDTO } from "./github";
import { DesiredAddon, InstalledAddon, AddonChangeInfo } from "./index_types";
import { generateUpdateWebhook } from "./discord";
import type { ChangeMap } from "./discord";

const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "server.log" })
  ]
});

// For Dev
// const getControlFile = () => {
//   return new Promise<string>((resolve, reject) => {
//     const contents = fs.readFileSync("./control_file.txt", "utf8");
//     logger.info(`Reading control file: ${contents}`);
// 
//     if (contents === "./addons_full.yaml") {
//       // write "addons.yaml"
//       fs.writeFileSync("./control_file.txt", "./addons.yaml");
//     } else {
//       // write "addons_full.yaml"
//       fs.writeFileSync("./control_file.txt", "./addons_full.yaml");
//     }
// 
//     const controlFileContents = fs.readFileSync(contents, "utf8");
// 
//     resolve(controlFileContents);
//   });
// }

const getControlFile = async () => {
  const file = `servers/${process.env.REALM}/addons.yaml`;
  return await getGithubFile("CFC-Servers", "cfc_infra", file);
}

const convertFindKeyToPath = (key: string) => {
    // "garrysmod/addons/niknaks/.git/config"

    // ["garrysmod", "addons", "niknaks", ".git", "config"]
    const keySplit = key.split("/");

    // ["garrysmod", "addons", "niknaks", ".git"]
    keySplit.pop();

    // ["garrysmod", "addons", "niknaks"]
    keySplit.pop();

    // "/garrysmod/addons/niknaks"
    const path = "/" + keySplit.join("/");

    return path
}

const getOwnerRepoFromURL = (url: string) => {
  // "https://github.com/cfc-servers/cfc_cl_http_whitelist.git"
  
  // [ "https:", "", "github.com", "cfc-servers", "cfc_cl_http_whitelist.git" ]
  const spl = url.split("/");

  const owner = spl[3];

  // "cfc_cl_http_whitelist.git"
  let repo = spl[4]
  repo = repo.split(".git")[0];

  return [owner, repo];
}

// TODO: Only track addons that are in the addons folder?
const getTrackedAddons = async (wisp: WispInterface) => {
  const addonSearch = await wisp.socket.filesearch(`remote "origin"`);

  const installedAddons: {[key: string]: InstalledAddon} = {};
  for (const [key, value] of Object.entries(addonSearch.files)) {
    const path = convertFindKeyToPath(key);

    // Getting the url from the config file
    // "\turl = https://github.com/cfc-servers/cfc_cl_http_whitelist.git"
    let url = value.lines[7]

    // "https://github.com/cfc-servers/cfc_cl_http_whitelist.git"
    url = url.split("= ")[1];

    const [owner, repo] = getOwnerRepoFromURL(url);

    const addon: InstalledAddon = {
      path: path,
      url: url,
      owner: owner,
      repo: repo,
      branch: "unknown",
      commit: "unknown"
    }

    installedAddons[repo] = addon;
  }

  // Get Branch
  await makeAPICallInBatches(wisp, Object.values(installedAddons), async (wisp: WispInterface, addon: InstalledAddon) => {
    const branch = await getCurrentBranch(wisp, addon.path);
    addon.branch = branch
    logger.info(`Found branch ${branch} for ${addon.path}`);
  });

  // Get Commit
  await makeAPICallInBatches(wisp, Object.values(installedAddons), async (wisp: WispInterface, addon: InstalledAddon) => {
    const commit = await getCurrentCommit(wisp, addon);
    addon.commit = commit;
    logger.info(`Found commit ${commit} for ${addon.path}`);
  });

  return installedAddons;
}

const getDesiredAddons = async () => {
  const controlFile = await getControlFile();
  const doc = yaml.load(controlFile);

  const desiredAddons: {[key: string]: DesiredAddon} = {};
  for (const addon of doc.addons) {
    const url = addon.url.toLowerCase();

    const [owner, repo] = getOwnerRepoFromURL(url);

    desiredAddons[repo] = {
      url: url,
      owner: owner,
      repo: repo,
      branch: addon.branch
    };
  }

  return desiredAddons;
}

interface AddonCreate {
  addon: DesiredAddon;
  isPrivate: boolean;
}

const cloneAddons = async (wisp: WispInterface, desiredAddons: DesiredAddon[]) => {
  const failures: DesiredAddon[] = [];
  const successes: AddonCreate[] = [];

  for (const desiredAddon of desiredAddons) {
    const url = `${desiredAddon.url}.git`;
    const branch = desiredAddon.branch;

    logger.info(`Cloning ${url} to /garrysmod/addons`);
    try {
      const result: GitCloneResult = await wisp.socket.gitClone(url, "/garrysmod/addons", branch);
      const createdAddon: AddonCreate = {
        addon: desiredAddon,
        isPrivate: result.isPrivate
      }

      successes.push(createdAddon);
      logger.info(`Cloned ${url} to /garrysmod/addons\n`);
    } catch (e) {
      failures.push(desiredAddon);
      logger.error(`Failed to clone ${url}`);
      logger.error(e);
    }
  }

  return {
    failures: failures,
    successes: successes
  };
}

const deleteAddons = async(wisp: WispInterface, addons: InstalledAddon[]) => {
  await wisp.api.deleteFiles(addons.map(addon => addon.path));
  logger.info("Deleted addons successfully\n");
}

const getCurrentBranch = async(wisp: WispInterface, addon: string) => {
  const path = `${addon}/.git/HEAD`;

  // "ref: refs/heads/feature/rewrite"
  let currentRef = await wisp.api.readFile(path);
  currentRef = currentRef.split("\n")[0];

  // "refs/heads/feature/rewrite"
  currentRef = currentRef.split(" ")[1].trim();

  // "feature/rewrite"
  const currentBranch = currentRef.split("refs/heads/")[1];

  return currentBranch;
}

const makeAPICallInBatches = async (wisp: WispInterface, addons: InstalledAddon[], func: any) => {
  const BATCH_SIZE = 10;

  const makeCall = async (addon: InstalledAddon) => {
    try {
      await func(wisp, addon);
    } catch (e) {
      logger.error(e);
      return null;
    }
  }

  const processBatch = async (batch: InstalledAddon[]) => {
    return await Promise.all(batch.map(makeCall));
  };

  for (let i = 0; i < addons.length; i += BATCH_SIZE) {
    const batch = addons.slice(i, i + BATCH_SIZE);
    await processBatch(batch);
  }
}

const getCurrentCommit = async (wisp: WispInterface, addon: InstalledAddon) => {
  const branch = addon.branch;

  const path = `${addon.path}/.git/refs/heads/${branch}`;
  logger.info(`Getting commit from: ${path}`);

  let currentCommit = await wisp.api.readFile(path);
  currentCommit = currentCommit.replace(/[\r\n]+/g,"");

  return currentCommit;
}

interface AddonUpdate {
  addon: InstalledAddon;
  change: CompareDTO;
  isPrivate: boolean;
}

const updateAddons = async (wisp: WispInterface, addons: InstalledAddon[]) => {
  const changes: AddonUpdate[] = [];

  for(const addon of addons) {
    const currentCommit = addon.commit;

    // TODO: Handle pull errors
    try {
      const pullResult: GitPullResult = await wisp.socket.gitPull(addon.path);
      const newCommit = pullResult.output;
      const isPrivate = pullResult.isPrivate;

      if (currentCommit !== newCommit) {
        const change = await gitCommitDiff(addon.owner, addon.repo, currentCommit, newCommit);
        const addonUpdate: AddonUpdate = {
          addon: addon,
          change: change,
          isPrivate: isPrivate
        }

        logger.info(`Changes detected for ${addon.repo}`);
        changes.push(addonUpdate);
      } else {
        logger.info(`No changes for ${addon.repo}`);
      }
    } catch (e) {
      logger.error(`Failed to pull ${addon.repo}`);
      logger.error(e);
    }
  }

  return changes;
}

(async () => {
  const domain = process.env.DOMAIN;
  if (!domain) { throw new Error("DOMAIN environment variable not set"); }

  const uuid = process.env.UUID;
  if (!uuid) { throw new Error("UUID environment variable not set"); }

  const token = process.env.TOKEN;
  if (!token) { throw new Error("TOKEN environment variable not set"); }

  const ghPAT = process.env.GH_PAT;
  if (!ghPAT) { throw new Error("GH_PAT environment variable not set"); }

  const wisp = new WispInterface(domain, uuid, token);
  await wisp.connect(ghPAT);

  const installedAddons = await getTrackedAddons(wisp);
  const desiredAddons = await getDesiredAddons();

  const toClone = [];
  const toUpdate = [];
  const toDelete = [];

  for (const [name, desiredAddon] of Object.entries(desiredAddons)) {
    const installedAddon = installedAddons[name];

    // If we don't have it, get it
    if (!installedAddon) {
      toClone.push(desiredAddon);
      continue;
    }

    // Otherwise, we have to check if the branch is correct
    // (This will trigger a deletion _and_ a clone)
    if (installedAddon.branch === desiredAddon.branch) {
      toUpdate.push(installedAddon);
    } else {
      logger.info(`Branch mismatch for ${name}: ${installedAddon.branch} != ${desiredAddon.branch}`);
      toDelete.push(installedAddon);
      toClone.push(desiredAddon);
    }
  }

  for (const [name, installedAddon] of Object.entries(installedAddons)) {
    if (!(name in desiredAddons)) {
      toDelete.push(installedAddon);
    }
  }

  const allFailures: {[key: string]: (AddonCreate | DesiredAddon)[]} = {
    clone: [],
    delete: [],
    update: []
  };

  // TODO: How to handle branch change alerts?
  // They're marked as both Deletes and Clones, which is a bit odd
  const allChanges: ChangeMap = {
    create: [],
    update: [],
    delete: []
  };

  // Deleted Addons
  if (toDelete.length > 0) {
    await deleteAddons(wisp, toDelete);
    for (const addon of toDelete) {
      const change: AddonChangeInfo = {
        addon: addon,
        change: "delete"
      };

      allChanges.delete.push(change);
    }

  } else {
    logger.info("No addons to delete");
  }

  // New Addons
  if (toClone.length > 0) {
    const cloneResult = await cloneAddons(wisp, toClone);
    const failures = cloneResult.failures;
    const successes = cloneResult.successes;

    if (failures && failures.length > 0) {
      allFailures.clone = [...allFailures.clone, ...failures];
    }

    if (successes && successes.length > 0) {
      for (const created of successes) {
        const change: AddonChangeInfo = {
          addon: created.addon,
          change: "create",
          isPrivate: created.isPrivate
        };

        allChanges.create.push(change);
      }
    }
  } else {
    logger.info("No addons to clone");
  }

  // Updated Addons
  if (toUpdate.length > 0) {
    const updates: AddonUpdate[] = await updateAddons(wisp, toUpdate);

    for (const update of updates) {
      const changeInfo: AddonChangeInfo = {
        addon: update.addon,
        change: "update",
        updateInfo: update.change,
        isPrivate: update.isPrivate
      };

      allChanges.update.push(changeInfo);
    }
  } else {
    logger.info("No addons to update");
  }

  logger.info("Failures:");
  logger.info(JSON.stringify(allFailures, null, 2));
  logger.info("\n");

  logger.info("Finished");

  await generateUpdateWebhook(allChanges);

  process.exit(0);
})();
