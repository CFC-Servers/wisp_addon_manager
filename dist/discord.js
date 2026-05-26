const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_TOTAL_EMBED_SIZE = 6000;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_UPDATE_DESCRIPTION_LENGTH = 2048;
const MAX_COMMIT_MESSAGE_LENGTH = 50;
const EMBED_COLORS = {
    update: 0x1E90FF,
    delete: 0xFF4500,
    create: 0x32CD32,
};
const hiddenURL = "https://github.com/404";
const makeEmbed = (embed) => ({
    ...embed,
    timestamp: new Date().toISOString(),
});
const embedSize = (embed) => embed.title.length + embed.description.length;
const chunkEmbeds = (embeds) => {
    const chunks = [];
    for (const embed of embeds) {
        const chunk = chunks[chunks.length - 1];
        const chunkSize = chunk?.reduce((total, e) => total + embedSize(e), 0) ?? 0;
        const fits = chunk
            && chunk.length < MAX_EMBEDS_PER_MESSAGE
            && chunkSize + embedSize(embed) <= MAX_TOTAL_EMBED_SIZE;
        if (fits) {
            chunk.push(embed);
        }
        else {
            chunks.push([embed]);
        }
    }
    return chunks;
};
const getLinkForAddon = (addon) => {
    const url = `${addon.url.replace(".git", "")}/tree/${addon.branch}`;
    return `[**${addon.name}**](${url})`;
};
const formatCommit = (commit, isPrivate) => {
    const mask = (text) => text.replace(/[^ ]/g, "❚");
    let message = isPrivate ? mask(commit.message) : commit.message;
    if (message.length > MAX_COMMIT_MESSAGE_LENGTH) {
        message = `${message.substring(0, MAX_COMMIT_MESSAGE_LENGTH)}...`;
    }
    const sha = (isPrivate ? mask(commit.sha) : commit.sha).substring(0, 6);
    const prefix = isPrivate ? "🔒" : commit.verified ? "✅" : "#️⃣";
    const username = isPrivate ? "?" : commit.author.username;
    const authorURL = isPrivate ? hiddenURL : commit.author.url;
    const commitURL = isPrivate ? hiddenURL : commit.url;
    const time = `_(<t:${Date.parse(commit.date) / 1000}:R>)_`;
    const header = `**[@${username}](${authorURL}) - [\`${prefix}${sha}\`](${commitURL}):**᲼${time}`;
    return `${header}\n\`\`\`${message}\`\`\``;
};
const buildUpdateDescription = (commitLines) => {
    let description = "";
    for (let i = 0; i < commitLines.length; i++) {
        const andMore = `\n_And ${commitLines.length - i} more..._`;
        if (description.length + commitLines[i].length > MAX_UPDATE_DESCRIPTION_LENGTH - andMore.length) {
            return description + andMore;
        }
        description += `${commitLines[i]}\n`;
    }
    return description;
};
const generateUpdateEmbed = (update) => {
    const { addon, updateInfo, isPrivate = false } = update;
    const commits = updateInfo?.commits ?? [];
    return makeEmbed({
        title: `🚀 Updates for: **\`${addon.name}\`**`,
        description: buildUpdateDescription(commits.map(commit => formatCommit(commit, isPrivate))),
        url: isPrivate ? hiddenURL : updateInfo?.url,
        color: EMBED_COLORS.update,
    });
};
const generateDeleteEmbed = (deletes) => makeEmbed({
    title: "🗑️ Removed",
    description: deletes.map(({ addon }) => `- [**${addon.name}**](${addon.url})`).join("\n"),
    color: EMBED_COLORS.delete,
});
const generateAddedEmbed = (creates) => makeEmbed({
    title: "✨ New Addons",
    description: creates.map(({ addon, isPrivate }) => {
        const url = isPrivate ? hiddenURL : `${addon.url}/tree/${addon.branch}`;
        return `- [**${addon.name || addon.repo}**](${url})`;
    }).join("\n"),
    color: EMBED_COLORS.create,
});
const failureSection = (title, failures) => {
    if (failures.length === 0) {
        return null;
    }
    const list = failures.map(({ addon, error }) => `- ${getLinkForAddon(addon)}: \`${error}\``);
    return `${title}\n${list.join("\n")}`;
};
const sendWebhook = async (webhook, embeds, content) => {
    const body = JSON.stringify({ embeds, content });
    const headers = new Headers({ "Content-Type": "application/json" });
    const response = await fetch(webhook, { method: "POST", body, headers });
    if (!response.ok) {
        console.error("Failed to send webhook", response.statusText, response.status, await response.text());
    }
    else {
        console.log(`Webhook sent (${response.status}, ${embeds.length} embed(s))`);
    }
    return response.ok;
};
export const generateUpdateWebhook = async (changes, alertWebhook, serverName) => {
    const send = (embeds) => {
        if (!alertWebhook) {
            throw new Error("No webhook URL provided");
        }
        return sendWebhook(alertWebhook, embeds, `🔸 Addon Updates for: **\`${serverName}\`**`);
    };
    const summary = [];
    if (changes.create.length > 0) {
        summary.push(generateAddedEmbed(changes.create));
    }
    if (changes.delete.length > 0) {
        summary.push(generateDeleteEmbed(changes.delete));
    }
    if (summary.length > 0) {
        await send(summary);
    }
    const updates = changes.update.map(generateUpdateEmbed);
    const chunks = chunkEmbeds(updates);
    console.log(`Sending ${updates.length} update embed(s) across ${chunks.length} message(s)`);
    for (const chunk of chunks) {
        await send(chunk);
    }
};
export const generateFailureWebhook = async (failures, alertWebhook, serverName) => {
    const sections = [
        failureSection("🗑️ Failed to remove addons:", failures.delete),
        failureSection("✨ Failed to add addons:", failures.create),
        failureSection("🚀 Failed to update addons:", failures.update),
    ].filter((section) => section !== null);
    if (sections.length === 0) {
        console.log("No failures to report");
        return;
    }
    const header = `### ❌ Failures encountered while updating: **\`${serverName}\`**`;
    return sendWebhook(alertWebhook, [], [header, ...sections].join("\n\n"));
};
const splitConfigDiffIntoEmbeds = (serverName, configDiff) => {
    const firstTitle = `📜 Server Config Update: **\`${serverName}\`**`;
    const embeds = [];
    let description = "```diff\n";
    let isFirstEmbed = true;
    const flush = () => {
        embeds.push(makeEmbed({
            title: isFirstEmbed ? firstTitle : "cont.",
            description: description + "```",
        }));
        isFirstEmbed = false;
    };
    for (const line of configDiff.split("\n")) {
        const lineWithNewline = line + "\n";
        if ((description + lineWithNewline).length > MAX_DESCRIPTION_LENGTH - 3) {
            flush();
            description = "```diff\n" + lineWithNewline;
        }
        else {
            description += lineWithNewline;
        }
    }
    flush();
    return embeds;
};
export const sendServerConfigEmbed = async (webhook, serverName, configDiff) => {
    const embeds = splitConfigDiffIntoEmbeds(serverName, configDiff);
    for (const chunk of chunkEmbeds(embeds)) {
        await sendWebhook(webhook, chunk, "");
    }
};
