import type { CommitDTO } from "./github.js";
import type { InstalledAddon, DesiredAddon } from "./index_types.js";
import type { AddonDeleteInfo, AddonCreateInfo, AddonUpdateInfo } from "./index_types.js";
import type { AddonDeleteFailure, AddonCreateFailure, AddonUpdateFailure } from "./index_types.js";

const EMBED_COLORS = {
  update: 0x1E90FF,
  delete: 0xFF4500,
  create: 0x32CD32,
};

const hiddenURL = "https://github.com/404";

const getLinkForAddon = (addon: InstalledAddon | DesiredAddon) => {
  const url = `${addon.url.replace(".git", "")}/tree/${addon.branch}`;
  return `[**${addon.repo}**](${url})`;
};

const generateUpdateEmbed = (addonUpdate: AddonUpdateInfo) => {
  const { addon, updateInfo, isPrivate } = addonUpdate;
  const maxMessageLength = 50;

  if (isPrivate) {
    updateInfo.url = hiddenURL;
  }

  const commitList: CommitDTO[] = updateInfo.commits.map((commit: CommitDTO) => {
    if (isPrivate) {
      commit.message = commit.message.replace(/[^ ]/g, "❚");

      commit.author.username = "unknown"
      commit.author.url = hiddenURL;

      commit.url = hiddenURL
      commit.sha = commit.sha.replace(/[^ ]/g, "❚");
    }

    return commit;
  });

  const embedTitle = `🚀 Updates for: **\`${addon.repo}\`**`;
  const diffURL = updateInfo.url;

  const commitBody = commitList.map((commit: CommitDTO) => {
    let message = commit.message;
    if (message.length > maxMessageLength) {
      message = `${message.substring(0, maxMessageLength)}...`;
    }

    let commitPrefix = commit.verified ? "✅" : "#️⃣";
    if (isPrivate) {
      commitPrefix = "🔒";
    }

    const timestamp = Date.parse(commit.date) / 1000
    const timeLine = `_(<t:${timestamp}:R>)_`;

    const shortSha = commit.sha.substring(0, 6);
    const commitLink = `[\`${commitPrefix}${shortSha}\`](${commit.url})`;
    const authorLink = `[@${commit.author.username}](${commit.author.url})`;

    const commitLine = `**${authorLink} - ${commitLink}:**᲼${timeLine}`;
    const commitMessage = `\`\`\`${message}\`\`\``;

    return `${commitLine}\n${commitMessage}`;
  });

  console.log("Generated commits:", commitBody.length);

  let description = "";
  for (let i = 0; i < commitBody.length; i++) {
    const andMore = `\n_And ${commitBody.length - i} more..._`;

    const commit = commitBody[i];
    if (description.length + commit.length > (2048 - andMore.length)) {
      console.log("Truncating commits:", commitBody.length - i);
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

  console.log("Generated update embed:", embed);

  return embed;
};

const generateDeleteEmbed = (addonUpdates: AddonDeleteInfo[]) => {
  const embedTitle = `🗑️ Removed`;

  const addonList = addonUpdates.map((change: AddonDeleteInfo) => {
    return `- [**${change.addon.repo}**](${change.addon.url})`;
  }).join('\n');

  const embed = {
    title: embedTitle,
    description: addonList,
    timestamp: new Date().toISOString(),
  };

  return embed;
};

const generateAddedEmbed = (addonUpdates: AddonCreateInfo[]) => {
  const embedTitle = `✨ New Addons`;

  const commitList = addonUpdates.map((change: AddonCreateInfo) => {
    const url = change.isPrivate ? hiddenURL : `${change.addon.url}/tree/${change.addon.branch}`;
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

export interface ChangeMap {
  update: AddonUpdateInfo[];
  delete: AddonDeleteInfo[];
  create:  AddonCreateInfo[];
};

export interface FailureMap {
  update: AddonUpdateFailure[];
  delete: AddonDeleteFailure[];
  create: AddonCreateFailure[];
}

export const generateUpdateWebhook = async (addonUpdates: ChangeMap, alertWebhook: string, serverName: string) => {
  const updates: any[] = [];
  addonUpdates.update.forEach(update => {
    updates.push({
      ...generateUpdateEmbed(update),
      color: EMBED_COLORS.update,
    });
  });

  // Function to send a webhook for a chunk of embeds
  const sendWebhook = async (embeds: any[]) => {
    if (!alertWebhook) { throw new Error("No webhook URL provided"); }

    console.log("Sending webhook to:", alertWebhook);
    const content = `🔸 Addon Updates for: **\`${serverName}\`**`;
    const body = JSON.stringify({ embeds: embeds, content: content });

    const headers = new Headers({
      "Content-Type": "application/json",
    });

    const response = await fetch(alertWebhook, { method: "POST", body: body, headers: headers });
    if (!response.ok) {
      console.error("Failed to send webhook", response.statusText, response.status, await response.text());
    }

    return response.ok;
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
    const success = await sendWebhook(newAndDeleted);
    if (!success) {
      console.error('Failed to send webhook for new and deleted addons:', newAndDeleted);
    }
  }

  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10);
    const success = await sendWebhook(chunk);
    if (!success) {
      console.error('Failed to send webhook for chunk:', chunk);
    }
  }
};

export const generateFailureWebhook = async (addonFailures: FailureMap, alertWebhook: string, serverName: string) => {
  const bodyHeader = `### ❌ Failures encountered while updating: **\`${serverName}\`**\n\n`;
  let body = "";

  const deletes = addonFailures.delete;
  if (deletes.length > 0) {
    body = body + `🗑️ Failed to remove addons:\n`;

    const addonList = deletes.map((change: AddonDeleteFailure) => {
      const url = getLinkForAddon(change.addon);
      return `- ${url}: \`${change.error}\``;
    });

    body = body + addonList.join('\n');
  }

  const creates = addonFailures.create;
  if (creates.length > 0) {
    body = body + `✨ Failed to add addons:\n`;

    const addonList = creates.map((change: AddonCreateFailure) => {
      const url = getLinkForAddon(change.addon);
      return `- ${url}: \`${change.error}\``;
    });

    body = body + addonList.join('\n');
  }


  const updates = addonFailures.update;
  if (updates.length > 0) {
    body = body + `🚀 Failed to update addons:\n`;

    const addonList = updates.map((change: AddonUpdateFailure) => {
      const url = getLinkForAddon(change.addon);
      return `- ${url}: \`${change.error}\``;
    });

    body = body + addonList.join('\n');
  }

  if (body.length === 0) {
    console.log("No failures to report");
    return;
  }

  body = bodyHeader + body;

  console.log("Sending failure webhook to:", alertWebhook);
  const requestBody = JSON.stringify({ content: body });

  const headers = new Headers({
    "Content-Type": "application/json",
  });

  const response = await fetch(alertWebhook, { method: "POST", body: requestBody, headers: headers });
  if (!response.ok) {
    console.error("Failed to send webhook", response.statusText, response.status, await response.text());
  }

  return response.ok;
}
