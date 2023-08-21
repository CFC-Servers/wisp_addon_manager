import { io, Socket } from "socket.io-client";

interface FilesearchFile {
  results: number;
  lines: {[key: string]: string};
}

interface GitCloneData {
  dir: string;
  url: string;
  branch: string;
  authkey: string | undefined;
}

interface GitPullData {
  dir: string;
}

interface FilesearchResults {
  files: {[key: string]: FilesearchFile};
  tooMany: boolean;
}

interface ServerToClientEvents {
  "error": (message: string) => void;
  "auth_success": (message: string) => void;
  "filesearch-results": (data: any) => void;
  "git-error": (data: string) => void;
  "git-success": (message?: string) => void;
  "git-clone": (data: GitCloneData) => void;
  "git-pull": (data: GitPullData) => void;
}

interface ClientToServerEvents {
  "auth": (token: string) => void;
  "filesearch-start": (query: string) => void;
  "git-clone": (data: GitCloneData) => void;
  "git-pull": (data: GitPullData) => void;
}


export interface WispSocket {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  logger: any
}

// TODO: Handle errors better
export class WispSocket {
  constructor(logger: any) {
    this.logger = logger;
  }
    
  connect(url: string, token: string) {
    return new Promise<void>((resolve, reject) => {
      this.socket = io(url, {
        extraHeaders: {
          'Authorization': `Bearer ${token}`
        }
      });

      this.socket.on("connect", () => {
        this.logger.info("Connected to WebSocket");
        this.socket.emit("auth", token);
      });

      this.socket.on("disconnect", () => {
        this.logger.info("Disconnected from WebSocket");
      });

      this.socket.on("error", (error) => {
        this.logger.error(`WebSocket error: ${error}`);
        reject();
      });

      this.socket.on("auth_success", () => {
        this.logger.info("Auth success");
        resolve();
      });
    });
  }

  filesearch(query: string) {
    return new Promise<FilesearchResults>((resolve, reject) => {
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

  gitPull(dir: string) {
    return new Promise<string | undefined>((resolve, reject) => {
      const finished = (success: boolean, output: string | undefined) => {
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
        this.logger.info(`Updating ${data}`);
      });

      this.socket.once("git-success", (commit) => {
        this.logger.info(`Addon updated to ${commit}`);
        finished(true, commit);
      });

      this.socket.once("git-error", (data) => {
        this.logger.error(`Error updating addon: ${data}`);
        finished(false, "");
      });

      const data = {dir: dir, authkey: "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"};
      this.socket.emit("git-pull", data);
    });
  }

  gitClone(url: string, dir: string, branch: string) {
    return new Promise<void>((resolve, reject) => {
      const finished = (success: boolean) => {
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
        this.logger.info(`Cloning ${data}`);
      });

      this.socket.once("git-success", () => {
        this.logger.info("Project successfully cloned");
        finished(true);
      });

      this.socket.once("git-error", (data) => {
        this.logger.info(`Error cloning repo: ${data}`);
        finished(false);
      });

      const data = {dir: dir, url: url, branch: branch, authkey: "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"};
      this.socket.emit("git-clone", data);
    });
  }
}
