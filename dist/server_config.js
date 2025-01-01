import { createTwoFilesPatch } from "diff";
import { sendServerConfigEmbed } from "./discord.js";
const getDiff = (oldText, newText) => {
    return createTwoFilesPatch("old.txt", "new.txt", oldText, newText);
};
const getCurrentServerConfig = async (wisp) => {
    return wisp.api.Filesystem.ReadFile("garrysmod/cfg/server.cfg");
};
const updateServerConfigFile = async (wisp, config) => {
    return wisp.api.Filesystem.WriteFile("garrysmod/cfg/server.cfg", config);
};
export const updateServerConfig = async (wisp, webhook, serverName, config) => {
    if (!config || config == "")
        return;
    const currentConfig = await getCurrentServerConfig(wisp);
    const diff = getDiff(currentConfig, config);
    console.log("diff", diff);
    await updateServerConfigFile(wisp, config);
    return sendServerConfigEmbed(webhook, serverName, diff);
};
