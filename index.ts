import YAML from "yaml"

import { WispInterface } from "@cfc-servers/wispjs"
import { generateUpdateWebhook, generateFailureWebhook } from "./discord.js"
import { gitCommitDiff, getLatestCommitHashes } from "./github.js"

import type { CompareDTO } from "./github.js"
import type { ChangeMap, FailureMap } from "./discord.js"
import type { AddonRemoteGitInfoMap, AddonURLToAddonMap, DesiredAddon, InstalledAddon }  from "./index_types.js"
import type { AddonDeleteInfo, AddonCreateInfo, AddonUpdateInfo  } from "./index_types.js"
import type { AddonDeleteFailure, AddonCreateFailure, AddonUpdateFailure } from "./index_types.js"
import type { AddonGitInfo } from "./index_types.js"

const logger = {
  info: console.log,
  error: console.error
}

const convertFindKeyToPath = (key: string) => {
    // "garrysmod/addons/niknaks/.git/config"

    // ["garrysmod", "addons", "niknaks", ".git", "config"]
    const keySplit = key.split("/")

    // ["garrysmod", "addons", "niknaks", ".git"]
    keySplit.pop()

    // ["garrysmod", "addons", "niknaks"]
    keySplit.pop()

    // "/garrysmod/addons/niknaks"
    const path = "/" + keySplit.join("/")

    return path
}

const getNameFromPath = (path: string) => {
    // "/garrysmod/addons/niknaks"

    // ["", "garrysmod", "addons", "niknaks"]
    const spl = path.split("/")

    // "niknaks"
    return spl[spl.length - 1]
}

const getOwnerRepoFromURL = (url: string) => {
  // "https://github.com/cfc-servers/cfc_cl_http_whitelist.git"
  
  // [ "https:", "", "github.com", "cfc-servers", "cfc_cl_http_whitelist.git" ]
  const spl = url.split("/")

  // "cfc-servers"
  const owner = spl[3]

  // "cfc_cl_http_whitelist.git"
  let repo = spl[4]

  // "cfc_cl_http_whitelist"
  repo = repo.split(".git")[0]

  // [ "cfc-servers", "cfc_cl_http_whitelist" ]
  return [owner, repo]
}

const setCurrentGitInfo = async(wisp: WispInterface, addons: AddonURLToAddonMap) => {
  const dirToAddon: {[dir: string]: InstalledAddon} = {}
  for (const [_, addon] of Object.entries(addons)) {
    const dirSpl = addon.path.split("/")
    const dir = dirSpl[dirSpl.length - 1]

    dirToAddon[dir] = addon
  }

  const uuid = (Math.random() + 1).toString(36).substring(7)
  const nonce = `nanny-${uuid}`
  const command = `nanny ${nonce} gitinfo`
  const response = await wisp.socket.sendCommandNonce(`${nonce}: `, command)

  const gitInfo: AddonGitInfo[] = JSON.parse(response)

  gitInfo.forEach((gitInfo) => {
    const addon = dirToAddon[gitInfo.addon]
    addon.branch = gitInfo.branch
    addon.commit = gitInfo.commit
  })
}

// TODO: Only track addons that are in the addons folder?
const getTrackedAddons = async (wisp: WispInterface) => {
  const addonSearch = await wisp.socket.filesearch(`remote "origin"`)

  const installedAddons: {[key: string]: InstalledAddon} = {}
  for (const [key, value] of Object.entries(addonSearch.files)) {
    const path = convertFindKeyToPath(key)
    const name = getNameFromPath(path)

    // Getting the url from the config file
    // "\turl = https://github.com/CFC-Servers/cfc_cl_http_whitelist.git"
    let url = value.lines[7]

    // "https://github.com/CFC-Servers/cfc_cl_http_whitelist.git"
    url = url.split("= ")[1]

    // "https://github.com/cfc-servers/cfc_cl_http_whitelist.git"
    url = url.toLowerCase()

    const [owner, repo] = getOwnerRepoFromURL(url)

    const addon: InstalledAddon = {
      path: path,
      name: name,
      url: url,
      owner: owner,
      repo: repo,
      branch: "unknown",
      commit: "unknown"
    }

    installedAddons[url] = addon
  }

  // Sets addon.commit and addon.branch
  await setCurrentGitInfo(wisp, installedAddons)

  return installedAddons
}

const getDesiredAddons = async (controlFile: string) => {
  const doc: any = YAML.parse(controlFile)

  const desiredAddons: {[key: string]: DesiredAddon} = {}
  for (const addon of doc.addons) {
    const url = addon.url.toLowerCase()

    const [owner, repo] = getOwnerRepoFromURL(url)

    const desired: DesiredAddon = {
      url: url,
      owner: owner,
      repo: repo,
      branch: addon.branch
    }

    if (addon.name) {
        desired.name = addon.name
    }

    desiredAddons[url] = desired
  }

  return desiredAddons
}

const cloneAddons = async (wisp: WispInterface, desiredAddons: DesiredAddon[]) => {
  const successes: AddonCreateInfo[] = []
  const failures: AddonCreateFailure[] = []

  const addonClones = desiredAddons.map((addon) => {
    const url = `${addon.url}.git`
    const branch = addon.branch

    console.log(`Cloning ${url} to /garrysmod/addons`)
    return wisp.socket.gitClone(url, "/garrysmod/addons", branch)
  });

  const results = await Promise.allSettled(addonClones)

  for (const [index, result] of results.entries()) {
    const desiredAddon = desiredAddons[index]
    const url = desiredAddon.url

    if (result.status == "fulfilled") {
      const value = result.value
      const isPrivate = value.isPrivate

      const createdAddon: AddonCreateInfo = {
        addon: desiredAddon,
        isPrivate: isPrivate
      }
      logger.info(`Cloned ${url} to /garrysmod/addons\n`)

      // `name` comes straight from the YAML, meaning if it exists, its different than the base name and we need to move it
      const [_, name] = getOwnerRepoFromURL(url)
      const desiredName = desiredAddon.name

      if (desiredName) {
        logger.info(`New addon has a desired name. Renaming: ${name} -> ${desiredName}`)
        await wisp.api.Filesystem.RenameFile(`/garrysmod/addons/${name}`, `/garrysmod/addons/${desiredName}`)
      }

      successes.push(createdAddon)
    } else {
      const reason = result.reason

      const failedUpdate: AddonCreateFailure = {
        addon: desiredAddon,
        error: reason
      }

      failures.push(failedUpdate)
      logger.error(`Failed to clone ${url}`)
      logger.error(reason)
    }
  }

  return {
    failures: failures,
    successes: successes
  }
}

interface AddonUpdate {
  addon: InstalledAddon
  change?: CompareDTO
  isPrivate: boolean
}

/*
 * If the error message is in this list, we should reclone the addon
 */
const errorsTriggeringReclone: {[key: string]: boolean} = {
    "No merge base found": true,
    "Unknown Error. Try again later.": true
}

const updateAddon = async (wisp: WispInterface, addon: InstalledAddon) => {
  let pullResult
  try {
    pullResult = await wisp.socket.gitPull(addon.path)
    console.log("Got pull result:", pullResult)
  } catch (e: any) {
    let errorMessage = "Unknown Error"
    if (typeof e === "string") {
      errorMessage = e
    } else if (e instanceof Error) {
      errorMessage = e.toString()
    }

    console.log("Full error message on pull:", `${errorMessage}'`)

    const isPrimaryBranch = addon.branch == "main" || addon.branch == "master"
    const canReclone = errorsTriggeringReclone[errorMessage]

    if (canReclone) {
        if (isPrimaryBranch) {
            console.log( `'${errorMessage}' on primary branch pull. Ignoring in case it's temporary.`, addon.path, addon.branch )
            throw(e)
        } else {
            console.log( `'${errorMessage}' on nonstandared branch pull - deleting and recloning`, addon.path )

            // Delete and reclone
            await wisp.api.Filesystem.DeleteFiles([addon.path])
            await wisp.socket.gitClone(addon.url, "/garrysmod/addons", addon.branch)

            if (addon.name !== addon.repo) {
                console.log(`Recloned a broken repo that has a custom name: ${addon.url} wants to be at ${addon.name}`)
                await wisp.api.Filesystem.RenameFile(`/garrysmod/addons/${addon.repo}`, `/garrysmod/addons/${addon.name}`)
            }

            pullResult = await wisp.socket.gitPull(addon.path)
        }
    } else {
        throw(e)
    }
  }

  const addonUpdate: AddonUpdate = {
    addon: addon,
    isPrivate: pullResult.isPrivate
  }

  return { update: addonUpdate, newCommit: pullResult.output }
}

const processControlFile = async (controlFile: string, toClone: DesiredAddon[], toUpdate: InstalledAddon[], toDelete: InstalledAddon[], installedAddons: AddonURLToAddonMap) => {
  const desiredAddons = await getDesiredAddons(controlFile)
  
  for (const [url, desiredAddon] of Object.entries(desiredAddons)) {
    // Installed URL contains .git, Desired do not
    const installedURL = `${url}.git`
    const installedAddon = installedAddons[installedURL]
  
    // If we don't have it, get it
    if (!installedAddon) {
      console.log(`Desired Addon does not appear in Installed list: ${installedURL}`)
      toClone.push(desiredAddon)
      continue
    }
  
    const branchMatch = installedAddon.branch === desiredAddon.branch
  
    const desiredName = desiredAddon.name
    const installedName = installedAddon.name
    const nameMatch = desiredName ? desiredName == installedName : true
  
    // Otherwise, we have to check if the branch and dir name are correct
    // (This will trigger a deletion _and_ a clone)
    if (branchMatch && nameMatch) {
      toUpdate.push(installedAddon)
    } else {
      if (!branchMatch) {
          console.log(`Branch mismatch for ${installedAddon.path}: ${installedAddon.branch} != ${desiredAddon.branch}`)
      }
  
      if (!nameMatch) {
          console.log(`Name mismatch for ${installedAddon.path}: ${installedAddon.name} != ${desiredAddon.name}`)
      }
  
      toDelete.push(installedAddon)
      toClone.push(desiredAddon)
    }
  }
  
  for (const [url, installedAddon] of Object.entries(installedAddons)) {
    // Installed URL contains .git, Desired do not
    const installedURL = url.replace(".git", "")
  
    if (!(installedURL in desiredAddons)) {
      console.log(`Installed addon is missing from desired list: ${installedURL} not in desiredAddons`)
      toDelete.push(installedAddon)
    }
  }
}

const handleDeleteQueue = async (wisp: WispInterface, toDelete: InstalledAddon[], allChanges: ChangeMap, allFailures: FailureMap) => {
  for (const addon of toDelete) {
    logger.info(`Deleting ${addon.path}`)

    try {
      await wisp.api.Filesystem.DeleteFiles([addon.path])

      const change: AddonDeleteInfo = {
        addon: addon,
      }

      allChanges.delete.push(change)
    } catch (e) {
      let errorMessage = "Unknown Error"

      if (typeof e === "string") {
        errorMessage = e
      } else if (e instanceof Error) {
        errorMessage = e.toString()
      }

      const failure: AddonDeleteFailure = {
        addon: addon,
        error: errorMessage
      }

      allFailures.delete.push(failure)
      logger.error(`Failed to delete ${addon.repo}`)
      logger.error(e)
    }
  }
}

const handleCloneQueue = async (wisp: WispInterface, toClone: DesiredAddon[], allChanges: ChangeMap, allFailures: FailureMap) => {
  const cloneResult = await cloneAddons(wisp, toClone)
  const failures = cloneResult.failures
  const successes = cloneResult.successes

  if (failures && failures.length > 0) {
    allFailures.create = [...allFailures.create, ...failures]
  }

  if (successes && successes.length > 0) {
    for (const created of successes) {
      const change: AddonCreateInfo = {
        addon: created.addon,
        isPrivate: created.isPrivate
      }

      allChanges.create.push(change)
    }
  }
}

const handleUpdateQueue = async(wisp: WispInterface, ghPAT: string, toUpdate: InstalledAddon[], allChanges: ChangeMap, allFailures: FailureMap) => {
  const addonUpdates = toUpdate.map((addon) => updateAddon(wisp, addon))
  const results = await Promise.allSettled(addonUpdates)
  console.log("Handled all updates in the queue")

  for (const [index, result] of results.entries()) {
      if (result.status == "fulfilled") {
          const struct = result.value
          const update = struct.update
          const addon = update.addon
          const currentCommit = addon.commit
          const newCommit = struct.newCommit

          let change

          console.log(`Checking for changes in ${addon.repo}, commit ${currentCommit} -> ${newCommit}`)
          if (currentCommit === newCommit) {
            logger.info(`No changes for ${addon.repo}`)
          } else {
            try {
                logger.info(`Changes detected for ${addon.repo} - getting diff`)
                change = await gitCommitDiff(ghPAT, addon.owner, addon.repo, currentCommit, newCommit)
            } catch(e: any) {
                logger.error(`Failed to retrieve git diff: ${e}`)
            }
          }

          const changeInfo: AddonUpdateInfo = {
            addon: update.addon,
            updateInfo: change,
            isPrivate: update.isPrivate
          }

          allChanges.update.push(changeInfo)
      } else {
          const addon = toUpdate[index]
          const errorMessage = result.reason

          const failure: AddonUpdateFailure = {
            addon: addon,
            error: errorMessage
          }

          allFailures.update.push(failure)
      }
  }
}

// Filters the given update queue to only include addons that /need/ an update
// (If its commit [as described by the gmod server] does not match the latest commit fetched from Git)
const filterUpdateQueue = (toUpdate: InstalledAddon[], remoteGitInfo: AddonRemoteGitInfoMap) => {
  return toUpdate.filter((addon: InstalledAddon) => {
    const remoteInfo = remoteGitInfo[addon.url]
    return addon.commit !== remoteInfo.latestCommit
  })
}

// If the desired branch doesn't exist, or isn't accessible by the checker, we should remove them and alert
const findBadBranches = (toUpdate: InstalledAddon[], remoteGitInfo: AddonRemoteGitInfoMap) => {
    return toUpdate.filter((addon: InstalledAddon) => {
        const remoteInfo = remoteGitInfo[addon.url]
        const latestCommit = remoteInfo.latestCommit

        return latestCommit === "UNKNOWN"
    })
}

async function manageAddons(wisp: any, serverName: string, ghPAT: string, alertWebhook: string, failureWebhook: string, controlFile?: string) {
  console.log("Connected to Wisp - getting tracked addons")
  const installedAddons = await getTrackedAddons(wisp)

  console.log("Received addons. Getting Remote git info")
  const remoteGitInfo: AddonRemoteGitInfoMap = await getLatestCommitHashes(ghPAT, installedAddons)

  const toClone: DesiredAddon[] = []
  const toUpdate: InstalledAddon[] = []
  const toDelete: InstalledAddon[] = []

  if (controlFile) {
    console.log("Control file provided - getting desired addons")
    await processControlFile(controlFile, toClone, toUpdate, toDelete, installedAddons)
  } else {
    console.log("No control file provided - updating all existing addons")
    for (const [_, installedAddon] of Object.entries(installedAddons)) {
      toUpdate.push(installedAddon)
    }
  }

  const allFailures: FailureMap = {
    create: [],
    update: [],
    delete: []
  }

  const allChanges: ChangeMap = {
    create: [],
    update: [],
    delete: []
  }

  // Deleted Addons
  if (toDelete.length > 0) {
    await handleDeleteQueue(wisp, toDelete, allChanges, allFailures)
  } else {
    logger.info("No addons to delete")
  }

  // New Addons
  if (toClone.length > 0) {
    await handleCloneQueue(wisp, toClone, allChanges, allFailures)
  } else {
    logger.info("No addons to clone")
  }


  // Updated Addons
  if (toUpdate.length > 0) {
    // This is a list of addons whose desired/current branch doesn't exist
    const badBranches = findBadBranches(toUpdate, remoteGitInfo)

    for (const addon of badBranches) {
        logger.info(`Bad branch detected for ${addon.repo}`)
        const failure: AddonUpdateFailure = {
          addon: addon,
          error: `Branch does not exist or is not accessible: '${addon.branch}'`
        }

        allFailures.update.push(failure)
    }

    // Remove the bad branches
    let filtered = toUpdate.filter((addon) => !badBranches.includes(addon))

    // Filter out addons that don't need an update
    filtered = filterUpdateQueue(filtered, remoteGitInfo)

    await handleUpdateQueue(wisp, ghPAT, filtered, allChanges, allFailures)
  } else {
    logger.info("No addons to update")
  }

  logger.info("Failures:")
  logger.info(JSON.stringify(allFailures, null, 2))
  logger.info("\n")

  logger.info("Finished")

  await generateUpdateWebhook(allChanges, alertWebhook, serverName)
  await generateFailureWebhook(allFailures, failureWebhook, serverName)
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
  } = config

  const wisp = new WispInterface(domain, uuid, token)

  try {
    await wisp.connect(ghPAT)
    await manageAddons(wisp, serverName, ghPAT, alertWebhook, failureWebhook, controlFile)
    await wisp.disconnect()
  } catch (e) {
    logger.error(e)
    await wisp.disconnect()
    throw e
  }
}
