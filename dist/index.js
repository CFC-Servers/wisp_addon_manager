import YAML from "yaml";
import { WispInterface } from "wispjs";
import { generateUpdateWebhook, generateFailureWebhook } from "./discord.js";
import { gitCommitDiff, getLatestCommitHashes } from "./github.js";
import { updateServerConfig } from "./server_config.js";
const logger = {
    info: console.log,
    error: console.error
};
const getOwnerRepoFromURL = (url) => {
    // "https://github.com/cfc-servers/cfc_cl_http_whitelist.git"
    // [ "https:", "", "github.com", "cfc-servers", "cfc_cl_http_whitelist.git" ]
    const spl = url.split("/");
    // "cfc-servers"
    const owner = spl[3];
    // "cfc_cl_http_whitelist.git"
    let repo = spl[4];
    // "cfc_cl_http_whitelist"
    repo = repo.split(".git")[0];
    // [ "cfc-servers", "cfc_cl_http_whitelist" ]
    return [owner, repo];
};
/* Tells the server to build a new gitinfo */
const buildCurrentGitInfo = async (wisp) => {
    try {
        // Tell the server to build the new gitinfo file (if it's up)
        const uuid = (Math.random() + 1).toString(36).substring(7);
        const nonce = `nanny-${uuid}`;
        const command = `nanny ${nonce} gitinfo`;
        await wisp.socket.sendCommandNonce(`${nonce}: `, command);
        logger.info("Server has generated new git info - Reading the file now");
    }
    catch (e) {
        logger.error("Failed to generate current git info (Is the server down?) - Reading the file instead");
        logger.error(e);
    }
};
/* Reads the current gitinfo file from the server's filesystem */
const readCurrentGitInfo = async (wisp) => {
    return await wisp.api.Filesystem.ReadFile("/garrysmod/data/cfc/nanny_gitinfo.json");
};
// TODO: Parse this file with zod or similar
const getTrackedAddons = async (wisp) => {
    const installedAddons = {};
    await buildCurrentGitInfo(wisp);
    const infoFileContents = await readCurrentGitInfo(wisp);
    const serverGitInfoFile = JSON.parse(infoFileContents);
    const generatedAt = serverGitInfoFile.generatedAt;
    const currentTimestamp = Math.floor(new Date().getTime() / 1000);
    logger.info(`Generated at: ${generatedAt}, Current Time: ${currentTimestamp} - Addon Data is ${currentTimestamp - generatedAt} seconds old`);
    // Create the map
    const serverInstalledAddons = serverGitInfoFile.installedAddons;
    for (const installedAddon of serverInstalledAddons) {
        installedAddons[installedAddon.url] = installedAddon;
    }
    return installedAddons;
};
const getDesiredAddons = async (controlFile) => {
    const doc = YAML.parse(controlFile);
    const desiredAddons = {};
    for (const addon of doc.addons) {
        const url = addon.url.toLowerCase();
        const [owner, repo] = getOwnerRepoFromURL(url);
        const desired = {
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
};
const cloneAddons = async (wisp, desiredAddons) => {
    const successes = [];
    const failures = [];
    const addonClones = desiredAddons.map((addon) => {
        const url = `${addon.url}.git`;
        const branch = addon.branch;
        logger.info(`Cloning ${url} to /garrysmod/addons`);
        return wisp.socket.gitClone(url, "/garrysmod/addons", branch);
    });
    const results = await Promise.allSettled(addonClones);
    for (const [index, result] of results.entries()) {
        const desiredAddon = desiredAddons[index];
        const url = desiredAddon.url;
        if (result.status == "fulfilled") {
            const value = result.value;
            const isPrivate = value.isPrivate;
            const createdAddon = {
                addon: desiredAddon,
                isPrivate: isPrivate
            };
            logger.info(`Cloned ${url} to /garrysmod/addons\n`);
            // `name` comes straight from the YAML, meaning if it exists, its different than the base name and we need to move it
            const [_, name] = getOwnerRepoFromURL(url);
            const desiredName = desiredAddon.name;
            if (desiredName) {
                logger.info(`New addon has a desired name. Renaming: ${name} -> ${desiredName}`);
                await wisp.api.Filesystem.RenameFile(`/garrysmod/addons/${name}`, `/garrysmod/addons/${desiredName}`);
            }
            successes.push(createdAddon);
        }
        else {
            const reason = result.reason;
            const failedUpdate = {
                addon: desiredAddon,
                error: reason
            };
            failures.push(failedUpdate);
            logger.error(`Failed to clone ${url}`);
            logger.error(reason);
        }
    }
    return {
        failures: failures,
        successes: successes
    };
};
/*
 * If the error message is in this list, we should reclone the addon
 */
const errorsTriggeringReclone = {
    "No merge base found": true,
    "Unknown Error. Try again later.": true
};
const updateAddon = async (wisp, addon) => {
    let pullResult;
    try {
        pullResult = await wisp.socket.gitPull(addon.path);
        logger.info("Got pull result:", pullResult);
    }
    catch (e) {
        let errorMessage = "Unknown Error";
        if (typeof e === "string") {
            errorMessage = e;
        }
        else if (e instanceof Error) {
            errorMessage = e.toString();
        }
        logger.info("Full error message on pull:", `${errorMessage}'`);
        const isPrimaryBranch = addon.branch == "main" || addon.branch == "master";
        const canReclone = errorsTriggeringReclone[errorMessage];
        if (canReclone) {
            if (isPrimaryBranch) {
                logger.info(`'${errorMessage}' on primary branch pull. Ignoring in case it's temporary.`, addon.path, addon.branch);
                throw (e);
            }
            else {
                logger.info(`'${errorMessage}' on nonstandared branch pull - deleting and recloning`, addon.path);
                // Delete and reclone
                await wisp.api.Filesystem.DeleteFiles([addon.path]);
                await wisp.socket.gitClone(addon.url, "/garrysmod/addons", addon.branch);
                if (addon.name !== addon.repo) {
                    logger.info(`Recloned a broken repo that has a custom name: ${addon.url} wants to be at ${addon.name}`);
                    await wisp.api.Filesystem.RenameFile(`/garrysmod/addons/${addon.repo}`, `/garrysmod/addons/${addon.name}`);
                }
                pullResult = await wisp.socket.gitPull(addon.path);
            }
        }
        else {
            throw (e);
        }
    }
    const addonUpdate = {
        addon: addon,
        isPrivate: pullResult.isPrivate
    };
    return { update: addonUpdate, newCommit: pullResult.output };
};
const processControlFile = async (controlFile, toClone, toUpdate, toDelete, installedAddons) => {
    const desiredAddons = await getDesiredAddons(controlFile);
    for (const [url, desiredAddon] of Object.entries(desiredAddons)) {
        // Installed URL contains .git, Desired do not
        const installedURL = `${url}.git`;
        const installedAddon = installedAddons[installedURL];
        // If we don't have it, get it
        if (!installedAddon) {
            logger.info(`Desired Addon does not appear in Installed list: ${installedURL}`);
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
            toUpdate.push(installedAddon);
        }
        else {
            if (!branchMatch) {
                logger.info(`Branch mismatch for ${installedAddon.path}: ${installedAddon.branch} != ${desiredAddon.branch}`);
            }
            if (!nameMatch) {
                logger.info(`Name mismatch for ${installedAddon.path}: ${installedAddon.name} != ${desiredAddon.name}`);
            }
            toDelete.push(installedAddon);
            toClone.push(desiredAddon);
        }
    }
    for (const [url, installedAddon] of Object.entries(installedAddons)) {
        // Installed URL contains .git, Desired do not
        const installedURL = url.replace(".git", "");
        if (!(installedURL in desiredAddons)) {
            logger.info(`Installed addon is missing from desired list: ${installedURL} not in desiredAddons`);
            toDelete.push(installedAddon);
        }
    }
};
const handleDeleteQueue = async (wisp, toDelete, allChanges, allFailures) => {
    for (const addon of toDelete) {
        logger.info(`Deleting ${addon.path}`);
        try {
            await wisp.api.Filesystem.DeleteFiles([addon.path]);
            const change = {
                addon: addon,
            };
            allChanges.delete.push(change);
        }
        catch (e) {
            let errorMessage = "Unknown Error";
            if (typeof e === "string") {
                errorMessage = e;
            }
            else if (e instanceof Error) {
                errorMessage = e.toString();
            }
            const failure = {
                addon: addon,
                error: errorMessage
            };
            allFailures.delete.push(failure);
            logger.error(`Failed to delete ${addon.repo}`);
            logger.error(e);
        }
    }
};
const handleCloneQueue = async (wisp, toClone, allChanges, allFailures) => {
    const cloneResult = await cloneAddons(wisp, toClone);
    const failures = cloneResult.failures;
    const successes = cloneResult.successes;
    if (failures && failures.length > 0) {
        allFailures.create = [...allFailures.create, ...failures];
    }
    if (successes && successes.length > 0) {
        for (const created of successes) {
            const change = {
                addon: created.addon,
                isPrivate: created.isPrivate
            };
            allChanges.create.push(change);
        }
    }
};
const handleUpdateQueue = async (wisp, ghPAT, toUpdate, allChanges, allFailures) => {
    const addonUpdates = toUpdate.map((addon) => updateAddon(wisp, addon));
    const results = await Promise.allSettled(addonUpdates);
    logger.info("Handled all updates in the queue");
    for (const [index, result] of results.entries()) {
        if (result.status == "fulfilled") {
            const struct = result.value;
            const update = struct.update;
            const addon = update.addon;
            const currentCommit = addon.commit;
            const newCommit = struct.newCommit;
            let change;
            logger.info(`Checking for changes in ${addon.repo}, commit ${currentCommit} -> ${newCommit}`);
            if (currentCommit === newCommit) {
                logger.info(`No changes for ${addon.repo}`);
            }
            else {
                try {
                    logger.info(`Changes detected for ${addon.repo} - getting diff`);
                    change = await gitCommitDiff(ghPAT, addon.owner, addon.repo, currentCommit, newCommit);
                }
                catch (e) {
                    logger.error(`Failed to retrieve git diff: ${e}`);
                }
            }
            const changeInfo = {
                addon: update.addon,
                updateInfo: change,
                isPrivate: update.isPrivate
            };
            allChanges.update.push(changeInfo);
        }
        else {
            const addon = toUpdate[index];
            const errorMessage = result.reason;
            const failure = {
                addon: addon,
                error: errorMessage
            };
            allFailures.update.push(failure);
        }
    }
};
// Filters the given update queue to only include addons that /need/ an update
// (If its commit [as described by the gmod server] does not match the latest commit fetched from Git)
const filterUpdateQueue = (toUpdate, remoteGitInfo) => {
    return toUpdate.filter((addon) => {
        const remoteInfo = remoteGitInfo[addon.url];
        return addon.commit !== remoteInfo.latestCommit;
    });
};
// If the desired branch doesn't exist, or isn't accessible by the checker, we should remove them and alert
const findBadBranches = (toUpdate, remoteGitInfo) => {
    return toUpdate.filter((addon) => {
        const remoteInfo = remoteGitInfo[addon.url];
        const latestCommit = remoteInfo.latestCommit;
        return latestCommit === "UNKNOWN";
    });
};
async function manageAddons(wisp, serverName, ghPAT, alertWebhook, failureWebhook, controlFile) {
    logger.info("Connected to Wisp - getting tracked addons");
    const installedAddons = await getTrackedAddons(wisp);
    logger.info("Received addons. Getting Remote git info");
    const remoteGitInfo = await getLatestCommitHashes(ghPAT, installedAddons);
    const toClone = [];
    const toUpdate = [];
    const toDelete = [];
    if (controlFile) {
        logger.info("Control file provided - getting desired addons");
        await processControlFile(controlFile, toClone, toUpdate, toDelete, installedAddons);
    }
    else {
        logger.info("No control file provided - updating all existing addons");
        for (const [_, installedAddon] of Object.entries(installedAddons)) {
            toUpdate.push(installedAddon);
        }
    }
    const allFailures = {
        create: [],
        update: [],
        delete: []
    };
    const allChanges = {
        create: [],
        update: [],
        delete: []
    };
    // Deleted Addons
    if (toDelete.length > 0) {
        await handleDeleteQueue(wisp, toDelete, allChanges, allFailures);
    }
    else {
        logger.info("No addons to delete");
    }
    // New Addons
    if (toClone.length > 0) {
        await handleCloneQueue(wisp, toClone, allChanges, allFailures);
    }
    else {
        logger.info("No addons to clone");
    }
    // Updated Addons
    if (toUpdate.length > 0) {
        // This is a list of addons whose desired/current branch doesn't exist
        const badBranches = findBadBranches(toUpdate, remoteGitInfo);
        for (const addon of badBranches) {
            logger.info(`Bad branch detected for ${addon.repo}`);
            const failure = {
                addon: addon,
                error: `Branch does not exist or is not accessible: '${addon.branch}'`
            };
            allFailures.update.push(failure);
        }
        // Remove the bad branches
        let filtered = toUpdate.filter((addon) => !badBranches.includes(addon));
        // Filter out addons that don't need an update
        filtered = filterUpdateQueue(filtered, remoteGitInfo);
        await handleUpdateQueue(wisp, ghPAT, filtered, allChanges, allFailures);
    }
    else {
        logger.info("No addons to update");
    }
    logger.info("Failures:");
    logger.info(JSON.stringify(allFailures, null, 2));
    logger.info("\n");
    logger.info("Finished");
    await generateUpdateWebhook(allChanges, alertWebhook, serverName);
    await generateFailureWebhook(allFailures, failureWebhook, serverName);
}
export async function ManageAddons(config) {
    const { domain, uuid, serverName, token, ghPAT, alertWebhook, failureWebhook, controlFile, serverConfig } = config;
    const wisp = new WispInterface(domain, uuid, token, ghPAT);
    try {
        await manageAddons(wisp, serverName, ghPAT, alertWebhook, failureWebhook, controlFile);
        await buildCurrentGitInfo(wisp); // Update the gitinfo file now that we're done
        await updateServerConfig(wisp, failureWebhook, serverName, serverConfig);
        logger.info("manageAddons done, disconnecting from Wisp...");
        await wisp.disconnect();
        logger.info("Disconnected from Wisp - done!");
    }
    catch (e) {
        logger.error(e);
        logger.info("manageAddons errored, disconnecting from Wisp...");
        await wisp.disconnect();
        logger.info("Disconnected from Wisp - done!");
        throw e;
    }
}
