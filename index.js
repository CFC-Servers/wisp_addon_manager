const axios = require("axios");
const io = require("socket.io-client");
const winston = require("winston");
const yaml = require("js-yaml");
const fs   = require("fs");

// Logger configuration
const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "server.log" })
  ]
});

// TODO: Handle errors better
class WispSocket {
  connect(url, token) {
    return new Promise((resolve, reject) => {
      this.socket = io(url, {
        extraHeaders: {
          'Authorization': `Bearer ${token}`
        }
      });

      this.socket.on("disconnect", () => {
        logger.info("Disconnected from WebSocket");
      });

      this.socket.on("error", (error) => {
        logger.error(`WebSocket error: ${error}`);
        reject();
      });

      this.socket.on("connect", () => {
        logger.info("Connected to WebSocket");
        this.socket.emit("auth", token);
      });

      this.socket.on("auth_success", () => {
        logger.info("Auth success");
        resolve();
      });
    });
  }

  filesearch(query) {
    return new Promise((resolve, reject) => {
      let done = false;

      this.socket.once("filesearch-results", (data) => {
        done = true;
        resolve(data);
      });

      this.socket.emit("filesearch-start", query);

      setTimeout(() => {
        if (!done) {
          reject();
        }
      }, 5000);
    });
  }

  gitPull(dir) {
    return new Promise((resolve, reject) => {
      const finished = (success, output) => {
        this.socket.removeAllListeners("git-pull");
        this.socket.removeAllListeners("git-error");
        this.socket.removeAllListeners("git-success");

        if (success) {
          resolve(output);
        } else {
          reject(output);
        }
      }

      this.socket.once("git-pull", (data) => {
        logger.info(`Updating ${data}`);
      });

      this.socket.once("git-success", (commit) => {
        logger.info(`Addon updated to ${commit}`);
        finished(true, commit);
      });

      this.socket.once("git-error", (data) => {
        logger.error(`Error updating addon: ${data}`);
        finished(false, "");
      });

      const data = {dir: dir, authkey: "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"};
      this.socket.emit("git-pull", data);
    });
  }

  gitClone(url, dir, branch, callback) {
    return new Promise((resolve, reject) => {
      const finished = (success) => {
        this.socket.removeAllListeners("git-clone");
        this.socket.removeAllListeners("git-error");
        this.socket.removeAllListeners("git-success");

        if (success) {
          resolve();
        } else {
          reject();
        }
      }

      this.socket.once("git-clone", (data) => {
        logger.info(`Cloning ${data}`);
      });

      this.socket.once("git-success", () => {
        logger.info("Project successfully cloned");
        finished(true);
      });

      this.socket.once("git-error", (data) => {
        logger.info(`Error cloning repo: ${data}`);
        finished(false);
      });

      const data = {dir: dir, url: url, branch: branch, authkey: "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"};
      this.socket.emit("git-clone", data);
    });
  }
}

class WispAPI {
  constructor(domain, uuid, token) {
    this.domain = domain;
    this.uuid = uuid;
    this.token = token;
  }

  makeURL(path) {
    return `${this.domain}/api/client/servers/${this.uuid}/${path}`;
  }

  async makeRequest(method, path, data) {
    const url = this.makeURL(path);
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/vnd.wisp.v1+json",
      "Authorization": `Bearer ${this.token}`
    };

    const request = async () => {
      let response;
      const requestData = { headers: headers }

      if (method == "GET") {
        if (data !== null) {
          requestData.params = data;
        }

        response = await axios.get(url, requestData);
      } else if (method == "POST") {
        response = await axios.post(url, data, requestData);
      } else if (method == "DELETE") {
        response = await axios.delete(url, requestData);
      } else if (method == "PUT") {
        response = await axios.put(url, data, requestData);
      } else {
        throw new Error(`Invalid method: ${method}`);
      }

      return response;
    }

    logger.info(`Sending ${method} request to ${url}`);
    return await request();
  }

  // Meta
  async sendCommand(command) {
    return await this.makeRequest("POST", "command", { command: command });
  }

  async getWebsocketDetails() {
    const response = await this.makeRequest("GET", "websocket");
    return response.data;
  }

  async getServerDetails() {
    return await this.makeRequest("GET", "");
  }

  async getResources() {
    return await this.makeRequest("GET", "resources");
  }

  // Filesystem
  // TODO: Handle pagination
  async getDirectoryContents(path) {
    const response = await this.makeRequest("GET", "files/directory", { path: path });
    return response.data;
  }

  async createDirectory(path) {
    return await this.makeRequest("POST", "files/directory", { path: path });
  }

  async readFile(path) {
    const response = await this.makeRequest("GET", "files/read", { path: path });
    return response.content;
  }

  async writeFile(path, content) {
    const data = { path: path, content: content };
    return await this.makeRequest("POST", "files/write", data);
  }

  async deleteFiles(paths) {
    return await this.makeRequest("POST", "files/delete", { paths: paths });
  }

  async renameFile(path, newPath) {
    const data = { path: path, to: newPath };
    return await this.makeRequest("PUT", "files/rename", data);
  }
}

class WispInterface {
  constructor(domain, uuid, token) {
    this.api = new WispAPI(domain, uuid, token);
  }

  async connect() {
    const websocketInfo = await this.api.getWebsocketDetails();
    logger.info(`Connecting to websocket at ${websocketInfo.url} - ${websocketInfo.token}`);
    this.socket = new WispSocket();
    await this.socket.connect(websocketInfo.url, websocketInfo.token);
  }
}

// TODO: Only track addons that are in the addons folder?
const getTrackedAddons = async (interface) => {
  const addonSearch = await interface.socket.filesearch("repositoryformatversion");

  const installedAddons = {};
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

    installedAddons[keySplit.slice(-1)] = path;
  }

  return installedAddons;
}

const getDesiredAddons = () => {
  const doc = yaml.load(fs.readFileSync("./addons.yaml", "utf8"));

  const desiredAddons = {};
  for (const addon of doc.addons) {
    const url = addon.url.toLowerCase();
    const name = url.split("/").slice(-1);
    desiredAddons[name] = { url: url, branch: addon.branch };
  }

  return desiredAddons;
}

const cloneAddons = async (interface, addons) => {
  for (addon of addons) {
    const url = `${addon.url}.git`;
    const branch = addon.branch;

    logger.info(`Cloning ${url} to /garrysmod/addons`);
    await interface.socket.gitClone(url, "/garrysmod/addons", branch);
    logger.info(`Cloned ${url} to /garrysmod/addons\n`);
  }
}

const deleteAddons = async(interface, addons) => {
  logger.info("Deleting:");
  logger.info(addons);
  await interface.api.deleteFiles(addons);
  logger.info("Deleted addons successfully\n");
}

const updateAddons = async (interface, addons) => {
  for(addon of addons) {
    logger.info(`Updating ${addon}`);
    await interface.socket.gitPull(addon);
    logger.info(`Updated ${addon}\n`);
  }
}

(async () => {
  const domain = "https://cfc.physgun.com";
  const uuid = "f49b767f";
  const token = "0D6nWNyXfapsTtmhgFaKHbeR2aiF8ZsLQ3I32VvIF50tLfu1";
  const interface = new WispInterface(domain, uuid, token);
  await interface.connect();

  const installedAddons = await getTrackedAddons(interface);
  console.log("installed addons");
  console.log(installedAddons);

  const desiredAddons = getDesiredAddons();
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

  console.log("Deleting:");
  console.log(toDelete);
  await deleteAddons(interface, toDelete);

  console.log("Cloning:");
  console.log(toClone);
  await cloneAddons(interface, toClone);

  console.log("Updating:");
  console.log(toUpdate);
  await updateAddons(interface, toUpdate);

})();
