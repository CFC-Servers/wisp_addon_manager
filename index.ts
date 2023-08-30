import YAML from "yaml";

import { WispInterface } from "wispjs";
import { generateUpdateWebhook } from "./discord.js";
import { gitCommitDiff } from "./github.js";

import type { GitPullResult, GitCloneResult } from "wispjs";
import type { CompareDTO } from "./github.js";
import type { ChangeMap, FailureMap } from "./discord.js";
import type { DesiredAddon, InstalledAddon, AddonDeleteInfo, AddonCreateInfo, AddonUpdateInfo  } from "./index_types.js";

const logger = {
  info: (msg: string) => {
    console.log(msg);
  },
  error: (msg: any) => {
    console.error(msg);
  }
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

const getDesiredAddons = async (controlFile: string) => {
  const doc: any = YAML.parse(controlFile);

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


const cloneAddons = async (wisp: WispInterface, desiredAddons: DesiredAddon[]) => {
  const failures: AddonCreateInfo[] = [];
  const successes: AddonCreateInfo[] = [];

  for (const desiredAddon of desiredAddons) {
    const url = `${desiredAddon.url}.git`;
    const branch = desiredAddon.branch;

    logger.info(`Cloning ${url} to /garrysmod/addons`);
    try {
      const result: GitCloneResult = await wisp.socket.gitClone(url, "/garrysmod/addons", branch);
      const createdAddon: AddonCreateInfo = {
        addon: desiredAddon,
        isPrivate: result.isPrivate
      }

      successes.push(createdAddon);
      logger.info(`Cloned ${url} to /garrysmod/addons\n`);
    } catch (e) {
      const failedUpdate: AddonCreateInfo = {
        addon: desiredAddon,
        isPrivate: false
      }
      failures.push(failedUpdate);
      logger.error(`Failed to clone ${url}`);
      logger.error(e);
    }
  }

  return {
    failures: failures,
    successes: successes
  };
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

const updateAddon = async (wisp: WispInterface, addon: InstalledAddon) => {
  const currentCommit = addon.commit;

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
      return addonUpdate;
    } else {
      logger.info(`No changes for ${addon.repo}`);
    }
  } catch (e) {
    logger.error(`Failed to pull ${addon.repo}`);
    logger.error(e);
  }
}

export async function ManageAddons(domain: string, uuid: string, token: string, ghPAT: string, alertWebhook: string, controlFile?: string) {
  const wisp = new WispInterface(domain, uuid, token);
  await wisp.connect(ghPAT);

  console.log("Connected to Wisp - getting tracked addons");
  const installedAddons = await getTrackedAddons(wisp);

  const toClone = [];
  const toUpdate = [];
  const toDelete = [];

  if (controlFile) {
    console.log("Control file provided - getting desired addons");

    const desiredAddons = await getDesiredAddons(controlFile);
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
  } else {
    console.log("No control file provided - updating all existing addons");
    for (const [_, installedAddon] of Object.entries(installedAddons)) {
      toUpdate.push(installedAddon);
    }
  }

  const allFailures: FailureMap = {
    create: [],
    update: [],
    delete: []
  };

  const allChanges: ChangeMap = {
    create: [],
    update: [],
    delete: []
  };

  // Deleted Addons
  if (toDelete.length > 0) {
    for (const addon of toDelete) {
      logger.info(`Deleting ${addon.repo}`);

      try {
        await wisp.api.deleteFiles([addon.path]);

        const change: AddonDeleteInfo = {
          addon: addon,
        };

        allChanges.delete.push(change);

      } catch (e) {
        allFailures.delete.push(addon);
        logger.error(`Failed to delete ${addon.repo}`);
        logger.error(e);
      }
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
      allFailures.create = [...allFailures.create, ...failures];
    }

    if (successes && successes.length > 0) {
      for (const created of successes) {
        const change: AddonCreateInfo = {
          addon: created.addon,
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
    for (const addon of toUpdate) {
      const update = await updateAddon(wisp, addon);

      if (update) {
        const changeInfo: AddonUpdateInfo = {
          addon: update.addon,
          updateInfo: update.change,
          isPrivate: update.isPrivate
        };

        allChanges.update.push(changeInfo);
      } else {
        allFailures.update.push(addon);
      }
    }
  } else {
    logger.info("No addons to update");
  }

  logger.info("Failures:");
  logger.info(JSON.stringify(allFailures, null, 2));
  logger.info("\n");

  logger.info("Finished");

  await generateUpdateWebhook(allChanges, alertWebhook);
}