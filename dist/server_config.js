import { createTwoFilesPatch } from "diff";
import { sendServerConfigEmbed } from "./discord.js";
const getDiff = (oldText, newText) => {
    const options = { ignoreWhitespace: true, stripTrailingCr: true };
    return createTwoFilesPatch("old.cfg", "new.cfg", oldText, newText, undefined, undefined, options);
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
    await updateServerConfigFile(wisp, config);
    return sendServerConfigEmbed(webhook, serverName, diff);
};
