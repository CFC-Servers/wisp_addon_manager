import fs from "fs";
import * as core from "@actions/core";

import { ManageAddons } from "./index.js";

const readControlFile = (path: string) => {
    try {
        return fs.readFileSync(path, "utf8");
    }
    catch (e) {
        throw e;
    }
}

(async () => {
    try {
        const domain = core.getInput("domain");
        const uuid = core.getInput("uuid");
        const serverName = core.getInput("name");
        const token = core.getInput("token");
        const ghPAT = core.getInput("github-token");
        const alertWebhook = core.getInput("alert-webhook");
        const failureWebhook = core.getInput("failure-webhook");
        const controlFile = core.getInput("control-file");


        let controlFileContents
        if (controlFile) {
            controlFileContents = readControlFile(controlFile);
        }

        await ManageAddons({
            domain: domain,
            uuid: uuid,
            serverName: serverName,
            token: token,
            ghPAT: ghPAT,
            alertWebhook: alertWebhook,
            failureWebhook: failureWebhook,
            controlFile: controlFileContents,
        });
    }
    catch (e) {
        console.error(e);

        if (e instanceof Error) {
            core.setFailed(e.message);
        } else if (typeof e === "string") {
            core.setFailed(e);
        } else {
            core.setFailed("Unknown error");
        }
    }
});
