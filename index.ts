const winston = require("winston");
const yaml = require("js-yaml");
const fs   = require("fs");

const { WispInterface } = require("./wisp");
const { getGithubFile } = require("./github");

const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "server.log" })
  ]
});

interface DesiredAddon {
  url: string
  branch: string
  destination?: string
}

// TODO: Only track addons that are in the addons folder?
const getTrackedAddons = async (wisp: typeof WispInterface) => {
  const addonSearch = await wisp.socket.filesearch("repositoryformatversion");

  const installedAddons: {[key: string]: string} = {};
  for (const [key, value] of Object.entries(addonSearch.files)) {
    // "garrysmod/addons/niknaks/.git/config"

    // ["garrysmod", "addons", "niknaks", ".git", "config"]
    const keySplit = key.split("/");

    // ["garrysmod", "addons", "niknaks", ".git"]
    keySplit.pop();

    // ["garrysmod", "addons", "niknaks"]
    keySplit.pop();

    // "/garrysmod/addons/niknaks"
    const path = "/" + keySplit.join("/");

    installedAddons[keySplit[keySplit.length - 1]] = path;
  }

  return installedAddons;
}

const getDesiredAddons = async () => {
  const controlFile = await getGithubFile("CFC-Servers", "cfc_infra", "servers/cfc3/addons.yaml");
  const doc = yaml.load(controlFile);

  const desiredAddons: {[key: string]: DesiredAddon} = {};
  for (const addon of doc.addons) {
    const url = addon.url.toLowerCase();

    let name = url.split("/");
    name = name[name.length - 1];

    desiredAddons[name] = { url: url, branch: addon.branch };
  }

  return desiredAddons;
}

const cloneAddons = async (wisp: typeof WispInterface, addons: DesiredAddon[]) => {
  for (const addon of addons) {
    const url = `${addon.url}.git`;
    const branch = addon.branch;

    logger.info(`Cloning ${url} to /garrysmod/addons`);
    await wisp.socket.gitClone(url, "/garrysmod/addons", branch);
    logger.info(`Cloned ${url} to /garrysmod/addons\n`);
  }
}

const deleteAddons = async(wisp: typeof WispInterface, addons: string[]) => {
  logger.info("Deleting:");
  logger.info(addons);
  await wisp.api.deleteFiles(addons);
  logger.info("Deleted addons successfully\n");
}

const updateAddons = async (wisp: typeof WispInterface, addons: string[]) => {
  for(const addon of addons) {
    logger.info(`Updating ${addon}`);
    await wisp.socket.gitPull(addon);
    logger.info(`Updated ${addon}\n`);
  }
}

(async () => {
  const domain = process.env.DOMAIN;
  if (!domain) { throw new Error("DOMAIN environment variable not set"); }

  const uuid = process.env.UUID;
  if (!uuid) { throw new Error("UUID environment variable not set"); }

  const token = process.env.TOKEN;
  if (!token) { throw new Error("TOKEN environment variable not set"); }


  const wisp = new WispInterface(domain, uuid, token, logger);
  await wisp.connect();

  const installedAddons = await getTrackedAddons(wisp);
  console.log("installed addons");
  console.log(installedAddons);

  const desiredAddons = await getDesiredAddons();
  console.log("desired addons:");
  console.log(desiredAddons);

  const toClone = [];
  const toUpdate = [];
  const toDelete = [];
  for (const [name, addon] of Object.entries(desiredAddons)) {
    const installedPath = installedAddons[name];
    if (installedPath) {
      toUpdate.push(installedPath);
    } else {
      toClone.push(addon);
    }
  }

  for (const [name, path] of Object.entries(installedAddons)) {
    if (!(name in desiredAddons)) {
      toDelete.push(path);
    }
  }

  if (toDelete.length > 0) {
    logger.info("Deleting:");
    logger.info(toDelete);
    await deleteAddons(wisp, toDelete);
  } else {
    logger.info("No addons to delete");
  }

  if (toClone.length > 0) {
    logger.info("Cloning:");
    logger.info(toClone);
    await cloneAddons(wisp, toClone);
  } else {
    logger.info("No addons to clone");
  }

  if (toUpdate.length > 0) {
    logger.info("Updating:");
    logger.info(toUpdate);
    await updateAddons(wisp, toUpdate);
  } else {
    logger.info("No addons to update");
  }

  logger.info("Finished");
  process.exit(0);
})();
