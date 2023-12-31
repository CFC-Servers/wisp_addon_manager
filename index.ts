import YAML from "yaml";
// import lzma from "lzma-native";

import { WispInterface } from "wispjs";
import { generateUpdateWebhook, generateFailureWebhook } from "./discord.js";
import { gitCommitDiff } from "./github.js";

import type { GitPullResult, GitCloneResult } from "wispjs";
import type { CompareDTO } from "./github.js";
import type { ChangeMap, FailureMap } from "./discord.js";
import type { DesiredAddon, InstalledAddon }  from "./index_types.js";
import type { AddonDeleteInfo, AddonCreateInfo, AddonUpdateInfo  } from "./index_types.js";
import type { AddonDeleteFailure, AddonCreateFailure, AddonUpdateFailure } from "./index_types.js";
import type { AddonGitInfo } from "./index_types.js";

const logger = {
  info: console.log,
  error: console.error
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

const getNameFromPath = (path: string) => {
    // "/garrysmod/addons/niknaks"

    // ["", "garrysmod", "addons", "niknaks"]
    const spl = path.split("/");
    return spl[spl.length - 1];
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

const setGitInfo = async(wisp: WispInterface, addons: {[key: string]: InstalledAddon}) => {
  const dirToAddon: {[key: string]: InstalledAddon} = {};
  for (const [_, addon] of Object.entries(addons)) {
    const dirSpl = addon.path.split("/");
    const dir = dirSpl[dirSpl.length - 1];

    dirToAddon[dir] = addon;
  }

  const uuid = (Math.random() + 1).toString(36).substring(7);
  const nonce = `nanny-${uuid}`;
  const command = `nanny ${nonce} gitinfo`;
  const response = await wisp.socket.sendCommandNonce(`${nonce}: `, command);

  // const buf = Buffer.from(response, "base64");
  // console.log(buf);

  // @ts-ignore
  // const jsonBuf: Buffer = await lzma.decompress(buf);
  // const json = jsonBuf.toString("utf8");

  const json = response;

  const gitInfo: AddonGitInfo[] = JSON.parse(json);

  gitInfo.forEach((gitInfo) => {
    const addon = dirToAddon[gitInfo.addon];
    addon.branch = gitInfo.branch;
    addon.commit = gitInfo.commit;
  });
}

// TODO: Only track addons that are in the addons folder?
const getTrackedAddons = async (wisp: WispInterface) => {
  const addonSearch = await wisp.socket.filesearch(`remote "origin"`);

  const installedAddons: {[key: string]: InstalledAddon} = {};
  for (const [key, value] of Object.entries(addonSearch.files)) {
    const path = convertFindKeyToPath(key);
    const name = getNameFromPath(path);

    // Getting the url from the config file
    // "\turl = https://github.com/CFC-Servers/cfc_cl_http_whitelist.git"
    let url = value.lines[7]

    // "https://github.com/CFC-Servers/cfc_cl_http_whitelist.git"
    url = url.split("= ")[1];

    // "https://github.com/cfc-servers/cfc_cl_http_whitelist.git"
    url = url.toLowerCase();

    const [owner, repo] = getOwnerRepoFromURL(url);

    const addon: InstalledAddon = {
      path: path,
      name: name,
      url: url,
      owner: owner,
      repo: repo,
      branch: "unknown",
      commit: "unknown"
    }

    installedAddons[url] = addon;
  }

  await setGitInfo(wisp, installedAddons);

  return installedAddons;
}

const getDesiredAddons = async (controlFile: string) => {
  const doc: any = YAML.parse(controlFile);

  const desiredAddons: {[key: string]: DesiredAddon} = {};
  for (const addon of doc.addons) {
    const url = addon.url.toLowerCase();

    const [owner, repo] = getOwnerRepoFromURL(url);

    const desired: DesiredAddon = {
      url: url,
      owner: owner,
      repo: repo,
      branch: addon.branch
    };

    if (addon.name) {
        desired.name = addon.name;
    }

    desiredAddons[url] = desired;
  }

  return desiredAddons;
}

const cloneAddons = async (wisp: WispInterface, desiredAddons: DesiredAddon[]) => {
  const successes: AddonCreateInfo[] = [];
  const failures: AddonCreateFailure[] = [];

  for (const desiredAddon of desiredAddons) {
    const url = `${desiredAddon.url}.git`;
    const branch = desiredAddon.branch;

    const [_, name] = getOwnerRepoFromURL(url);

    console.log(`Cloning ${url} to /garrysmod/addons`);
    try {
      const result: GitCloneResult = await wisp.socket.gitClone(url, "/garrysmod/addons", branch);
      const createdAddon: AddonCreateInfo = {
        addon: desiredAddon,
        isPrivate: result.isPrivate
      }
      logger.info(`Cloned ${url} to /garrysmod/addons\n`);

      // `name` comes straight from the YAML, meaning if it exists, its different than the base name and we need to move it
      const desiredName = desiredAddon.name;

      if (desiredName) {
        logger.info(`New addon has a desired name. Renaming: ${name} -> ${desiredName}`);
        const renameResult = await wisp.api.renameFile(`/garrysmod/addons/${name}`, `/garrysmod/addons/${desiredName}`);

        logger.info(`Rename status response: ${renameResult.status} - ${renameResult.statusText}`);
      }

      successes.push(createdAddon);
    } catch (e) {
      let errorMessage = "Unknown Error";

      if (typeof e === "string") {
        errorMessage = e;
      } else if (e instanceof Error) {
        errorMessage = e.toString();
      }

      const failedUpdate: AddonCreateFailure = {
        addon: desiredAddon,
        error: errorMessage
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

interface AddonUpdate {
  addon: InstalledAddon;
  change?: CompareDTO;
  isPrivate: boolean;
}

const errorsTriggeringReclone: {[key: string]: boolean} = {
    "No merge base found": true,
    "Unknown Error. Try again later.": true
}

const updateAddon = async (ghPAT: string, wisp: WispInterface, addon: InstalledAddon) => {
  const currentCommit = addon.commit;

  let pullResult: GitPullResult;
  try {
    pullResult = await wisp.socket.gitPull(addon.path);
  } catch (e: any) {
    let errorMessage = "Unknown Error";
    if (typeof e === "string") {
      errorMessage = e;
    } else if (e instanceof Error) {
      errorMessage = e.toString();
    }

    console.log("Full error message on pull:", `${errorMessage}'`);

    const isPrimaryBranch = addon.branch == "main" || addon.branch == "master";
    const canReclone = errorsTriggeringReclone[errorMessage];

    if (canReclone) {
        if (isPrimaryBranch) {
            console.log( `'${errorMessage}' on primary branch pull. Ignoring in case it's temporary.`, addon.path, addon.branch );
            throw(e);
        } else {
            console.log( `'${errorMessage}' on nonstandared branch pull - deleting and recloning`, addon.path );

            // Delete and reclone
            await wisp.api.deleteFiles([addon.path]);
            await wisp.socket.gitClone(addon.url, "/garrysmod/addons", addon.branch);

            if (addon.name !== addon.repo) {
                console.log(`Recloned a broken repo that has a custom name: ${addon.url} wants to be at ${addon.name}`);
                await wisp.api.renameFile(`/garrysmod/addons/${addon.repo}`, `/garrysmod/addons/${addon.name}`);
            }

            pullResult = await wisp.socket.gitPull(addon.path);
        }
    } else {
        throw(e);
    }
  }

  const newCommit = pullResult.output;
  const isPrivate = pullResult.isPrivate;

  const addonUpdate: AddonUpdate = {
    addon: addon,
    isPrivate: isPrivate
  }

  if (currentCommit !== newCommit) {
    const change = await gitCommitDiff(ghPAT, addon.owner, addon.repo, currentCommit, newCommit);
    addonUpdate.change = change;

    logger.info(`Changes detected for ${addon.repo}`);
  } else {
    logger.info(`No changes for ${addon.repo}`);
  }

  return addonUpdate;
}

async function manageAddons(wisp: any, serverName: string, ghPAT: string, alertWebhook: string, failureWebhook: string, controlFile?: string) {
  console.log("Connected to Wisp - getting tracked addons");
  const installedAddons = await getTrackedAddons(wisp);

  const toClone = [];
  const toUpdate = [];
  const toDelete = [];

  if (controlFile) {
    console.log("Control file provided - getting desired addons");

    const desiredAddons = await getDesiredAddons(controlFile);

    for (const [url, desiredAddon] of Object.entries(desiredAddons)) {
      // Installed URL contains .git, Desired do not
      const installedURL = `${url}.git`;
      const installedAddon = installedAddons[installedURL];

      // If we don't have it, get it
      if (!installedAddon) {
        console.log(`Desired Addon does not appear in Installed list: ${installedURL}`);
        toClone.push(desiredAddon);
        continue;
      }

      const branchMatch = installedAddon.branch === desiredAddon.branch;

      const desiredName = desiredAddon.name;
      const installedName = installedAddon.name;
      const nameMatch = desiredName ? desiredName == installedName : true;

      // Otherwise, we have to check if the branch and dir name are correct
      // (This will trigger a deletion _and_ a clone)
      if (branchMatch && nameMatch) {
        console.log("Branch and name match, marking for update:", installedAddon.path);
        toUpdate.push(installedAddon);
      } else {
        if (!branchMatch) {
            console.log(`Branch mismatch for ${installedAddon.path}: ${installedAddon.branch} != ${desiredAddon.branch}`);
        }

        if (!nameMatch) {
            console.log(`Name mismatch for ${installedAddon.path}: ${installedAddon.name} != ${desiredAddon.name}`);
        }

        toDelete.push(installedAddon);
        toClone.push(desiredAddon);
      }
    }

    for (const [url, installedAddon] of Object.entries(installedAddons)) {
      // Installed URL contains .git, Desired do not
      const installedURL = url.replace(".git", "");

      if (!(installedURL in desiredAddons)) {
        console.log(`Installed addon is missing from desired list: ${installedURL} not in desiredAddons`);
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
      logger.info(`Deleting ${addon.path}`);

      try {
        await wisp.api.deleteFiles([addon.path]);

        const change: AddonDeleteInfo = {
          addon: addon,
        };

        allChanges.delete.push(change);
      } catch (e) {
        let errorMessage = "Unknown Error";

        if (typeof e === "string") {
          errorMessage = e;
        } else if (e instanceof Error) {
          errorMessage = e.toString();
        }

        const failure: AddonDeleteFailure = {
          addon: addon,
          error: errorMessage
        };

        allFailures.delete.push(failure);
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
      try {
        const update = await updateAddon(ghPAT, wisp, addon);

        // Ignore it if it had no changes
        if (!update.change) {
          continue;
        }

        const changeInfo: AddonUpdateInfo = {
          addon: update.addon,
          updateInfo: update.change,
          isPrivate: update.isPrivate
        };

        allChanges.update.push(changeInfo);
      } catch (e) {
        let errorMessage = "Unknown Error";
        if (typeof e === "string") {
          errorMessage = e;
        } else if (e instanceof Error) {
          errorMessage = e.toString();
        }

        const failure: AddonUpdateFailure = {
          addon: addon,
          error: errorMessage
        };

        allFailures.update.push(failure);
      }
    }
  } else {
    logger.info("No addons to update");
  }

  logger.info("Failures:");
  logger.info(JSON.stringify(allFailures, null, 2));
  logger.info("\n");

  logger.info("Finished");

  await generateUpdateWebhook(allChanges, alertWebhook, serverName);
  await generateFailureWebhook(allFailures, failureWebhook, serverName);
}

export type ManageAddonsConfig = {
  domain: string;
  uuid: string;
  serverName: string;
  token: string;
  ghPAT: string;
  alertWebhook: string;
  failureWebhook: string;
  controlFile?: string;
}

export async function ManageAddons(config: ManageAddonsConfig) {
  const {
    domain, uuid, serverName,
    token, ghPAT, alertWebhook,
    failureWebhook, controlFile
  } = config;

  const wisp = new WispInterface(domain, uuid, token);

  try {
    await wisp.connect(ghPAT);
    await manageAddons(wisp, serverName, ghPAT, alertWebhook, failureWebhook, controlFile);
    await wisp.disconnect();
  } catch (e) {
    logger.error(e);
    await wisp.disconnect();
    throw e;
  }
}
