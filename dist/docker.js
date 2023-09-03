import fs from 'fs';
import { ManageAddons } from "./index.js";
(async function () {
    // We're using the process env to get config values for this example, but you can do this however you want.
    // The domain of your Wisp server. i.e.:
    // - example.panel.gg
    // - selfhosted.mydomain.com
    const domain = process.env.WISP_DOMAIN;
    if (!domain) {
        throw new Error("No Wisp Domain provided");
    }
    // The UUID of your wisp server.
    // If your server is https://example.panel.gg/servers/1234, then the UUID is 1234
    const uuid = process.env.WISP_UUID;
    if (!uuid) {
        throw new Error("No Wisp UUID provided");
    }
    // Any human-friendly name for the server you're updating (used in the Discord messages)
    const serverName = process.env.SERVER_NAME || "GMod Server: " + uuid;
    // A Wisp API token for your server (of course, the user that owns this token needs access to the server you're updating)
    // You can generate one at https://example.panel.gg/account/security
    const token = process.env.WISP_TOKEN;
    if (!token) {
        throw new Error("No Wisp Token provided");
    }
    // A GitHub Personal Access Token with the `repo` scope for any private repos you're using
    // You need one for public repos too because we have to use the Github API anyway
    // You can generate one at: https://github.com/settings/tokens
    const ghPAT = process.env.GITHUB_PAT;
    if (!ghPAT) {
        throw new Error("No GitHub PAT provided");
    }
    // A Discord Webhook URL (the full URL including https://) for the channel you want to send update messages to
    const alertWebhook = process.env.DISCORD_ALERT_WEBHOOK;
    if (!alertWebhook) {
        throw new Error("No Discord Alert Webhook provided");
    }
    // A full Discord Webhook URL for failure messages specifically
    const failureWebhook = process.env.DISCORD_FAILURE_WEBHOOK;
    if (!failureWebhook) {
        throw new Error("No Discord Failure Webhook provided");
    }
    // OPTIONAL (read more in the Control File section):
    // The raw YAML contents of your control file
    // If you don't provide this, the script will just update all addons in the addons folder
    // You can pull this from a URL or hard-code it somewhere if you want (a local file or something perhaps)
    const useControlFile = process.env.USE_CONTROL_FILE;
    let controlFile;
    if (useControlFile && useControlFile == "1") {
        try {
            controlFile = fs.readFileSync("/app/control.yaml", 'utf8');
        }
        catch (e) {
            console.error("Failed to read control file from /app/control.yaml");
        }
    }
    if (!controlFile) {
        console.error("No control file provided - will not perform a full management run!");
    }
    try {
        await ManageAddons(domain, uuid, serverName, token, ghPAT, alertWebhook, failureWebhook, controlFile);
        console.log("Addon Manager completed successfully!");
    }
    catch (e) {
        console.error("Addon Manager did not complete successfully!");
        console.error(e);
    }
    process.exit(0);
})();
