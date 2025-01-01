import { createTwoFilesPatch } from "diff"
import { sendServerConfigEmbed } from "./discord.js"
import type { WispInterface } from "wispjs"

const getDiff = (oldText: string, newText: string) => {
  return createTwoFilesPatch("old.txt", "new.txt", oldText, newText)
}

const getCurrentServerConfig = async (wisp: WispInterface) => {
    return wisp.api.Filesystem.ReadFile("garrysmod/cfg/server.cfg")
}

const updateServerConfigFile = async (wisp: WispInterface, config: string) => {
    return wisp.api.Filesystem.WriteFile("garrysmod/cfg/server.cfg", config)
}

export const updateServerConfig = async (wisp: WispInterface, webhook: string, serverName: string, config?: string) => {
    if (!config || config == "") return

    const currentConfig = await getCurrentServerConfig(wisp)
    const diff = getDiff(currentConfig, config)
    console.log("diff", diff)

    await updateServerConfigFile(wisp, config)

    return sendServerConfigEmbed(webhook, serverName, diff)
}
