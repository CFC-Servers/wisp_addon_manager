const EMBED_COLORS = {
    update: 0x1E90FF,
    delete: 0xFF4500,
    create: 0x32CD32,
};
const hiddenURL = "https://github.com/404";
const generateUpdateEmbed = (addonUpdate) => {
    const { addon, updateInfo, isPrivate } = addonUpdate;
    const maxMessageLength = 50;
    updateInfo.url = `${updateInfo.url}/tree/${addon.branch}`;
    let commitList = [];
    if (isPrivate) {
        updateInfo.url = hiddenURL;
        commitList = updateInfo.commits.map((commit) => {
            commit.message = commit.message.replace(/[^ ]/g, "❚");
            commit.author.username = "unknown";
            commit.author.url = hiddenURL;
            commit.url = hiddenURL;
            commit.sha = commit.sha.replace(/[^ ]/g, "❚");
            return commit;
        });
    }
    const embedTitle = `🚀 Updates for: **\`${addon.repo}\`**`;
    const diffURL = updateInfo.url;
    const commitBody = commitList.map((commit) => {
        let message = commit.message;
        if (message.length > maxMessageLength) {
            message = `${message.substring(0, maxMessageLength)}...`;
        }
        let commitPrefix = commit.verified ? "✅" : "#️⃣";
        if (isPrivate) {
            commitPrefix = "🔒";
        }
        const timestamp = Date.parse(commit.date) / 1000;
        const timeLine = `_(<t:${timestamp}:R>)_`;
        const shortSha = commit.sha.substring(0, 6);
        const commitLink = `[\`${commitPrefix}${shortSha}\`](${commit.url})`;
        const authorLink = `[@${commit.author.username}](${commit.author.url})`;
        const commitLine = `**${authorLink} - ${commitLink}:**᲼${timeLine}`;
        const commitMessage = `\`\`\`${message}\`\`\``;
        return `${commitLine}\n${commitMessage}`;
    });
    let description = "";
    for (let i = 0; i < commitBody.length; i++) {
        const andMore = `\n_And ${commitBody.length - i} more..._`;
        const commit = commitBody[i];
        if (description.length + commit.length > (2048 - andMore.length)) {
            description += andMore;
            break;
        }
        description += `${commit}\n`;
    }
    const embed = {
        title: embedTitle,
        description: description,
        url: diffURL,
        timestamp: new Date().toISOString(),
    };
    return embed;
};
const generateDeleteEmbed = (addonUpdates) => {
    const embedTitle = `🗑️ Removed`;
    const addonList = addonUpdates.map((change) => {
        return `- [**${change.addon.repo}**](${change.addon.url})`;
    }).join('\n');
    const embed = {
        title: embedTitle,
        description: addonList,
        timestamp: new Date().toISOString(),
    };
    return embed;
};
const generateAddedEmbed = (addonUpdates) => {
    const embedTitle = `✨ New Addons`;
    const commitList = addonUpdates.map((change) => {
        const url = change.isPrivate ? hiddenURL : change.addon.url;
        const name = change.addon.repo;
        return `- [**${name}**](${url})`;
    }).join('\n');
    const embed = {
        title: embedTitle,
        description: commitList,
        timestamp: new Date().toISOString(),
    };
    return embed;
};
;
export const generateUpdateWebhook = async (addonUpdates, alertWebhook) => {
    const updates = [];
    addonUpdates.update.forEach(update => {
        updates.push({
            ...generateUpdateEmbed(update),
            color: EMBED_COLORS.update,
        });
    });
    // Function to send a webhook for a chunk of embeds
    const sendWebhook = async (embeds) => {
        if (!alertWebhook) {
            throw new Error("No webhook URL provided");
        }
        console.log("Sending webhook to:", alertWebhook);
        const response = await fetch(alertWebhook, { method: "POST", body: JSON.stringify({ embeds }) });
        return response.status === 200;
    };
    // Send Additions
    const newAndDeleted = [];
    if (addonUpdates.create.length > 0) {
        const creates = generateAddedEmbed(addonUpdates.create);
        newAndDeleted.push({ ...creates, color: EMBED_COLORS.create });
    }
    // Send Deletions
    if (addonUpdates.delete.length > 0) {
        const deletes = generateDeleteEmbed(addonUpdates.delete);
        newAndDeleted.push({ ...deletes, color: EMBED_COLORS.delete });
    }
    if (newAndDeleted.length > 0) {
        await sendWebhook(newAndDeleted);
    }
    for (let i = 0; i < updates.length; i += 10) {
        const chunk = updates.slice(i, i + 10);
        const success = await sendWebhook(chunk);
        // if (!success) {
        //   console.error('Failed to send webhook for chunk:', chunk);
        // }
    }
};