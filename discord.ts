const axios = require('axios');
const { AddonChangeInfo } = require("./index_types");
const { CommitDTO } = require("./github");

const EMBED_COLORS = {
  update: 0x1E90FF,
  delete: 0xFF4500,
  create: 0x32CD32,
};

const generateUpdateEmbed = (addonUpdate: typeof AddonChangeInfo) => {
  const { addonName, updateInfo } = addonUpdate;
  const maxMessageLength = 50;

  const embedTitle = `🚀 Updates for: **\`${addonName}\`**`;
  const diffURL = updateInfo.url;

  let commitList = updateInfo.commits.map((commit: typeof CommitDTO, index: number) => {
    let message = commit.message;
    if (message.length > maxMessageLength) {
      message = `${message.substring(0, maxMessageLength)}...`;
    }

    const shortSha = commit.sha.substring(0, 6);
    const verified = commit.verified ? "✅" : "#️⃣";
    const commitLink = `[\`${verified}${shortSha}\`](${commit.url})`;
    const authorLink = `[@${commit.author.username}](${commit.author.url})`;

    const timestamp = Date.parse(commit.date) / 1000
    const timeLine = `_(<t:${timestamp}:R>)_`;

    const commitLine = `**${authorLink} - ${commitLink}:**᲼${timeLine}`;
    const commitMessage = `\`\`\`${message}\`\`\``;

    return `${commitLine}\n${commitMessage}`;
  });

  let description = "";
  for (let i = 0; i < commitList.length; i++) {
    const andMore = `\n_And ${commitList.length - i} more..._`;

    const commit = commitList[i];
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

const generateDeleteEmbed = (addonUpdates: typeof AddonChangeInfo) => {
  const embedTitle = `🗑️ Removed`;

  let commitList = addonUpdates.map((change: typeof AddonChangeInfo, index: number) => {
    return `- **${change.addonName}**`;
  }).join('\n');

  const embedDescription = ` ${commitList} `;

  const embed = {
    title: embedTitle,
    description: embedDescription,
    timestamp: new Date().toISOString(),
  };

  return embed;
};

const generateAddedEmbed = (addonUpdates: typeof AddonChangeInfo[]) => {
  const embedTitle = `✨ New Addons`;

  let commitList = addonUpdates.map((change: typeof AddonChangeInfo, index: number) => {
    const url = change.addonName;
    const name = url.split("/").pop();

    return `- [**${name}**](${url})`;
  }).join('\n');

  const embedDescription = ` ${commitList} `;

  const embed = {
    title: embedTitle,
    description: embedDescription,
    timestamp: new Date().toISOString(),
  };

  return embed;
};

type ChangeType = "update" | "delete" | "create";
type ChangeMap = {
  [key in ChangeType]: typeof AddonChangeInfo[];
};

export const generateUpdateWebhook = async (addonUpdates: ChangeMap) => {
  const updates: any[] = [];
  addonUpdates.update.forEach(update => {
    updates.push({
      ...generateUpdateEmbed(update),
      color: EMBED_COLORS.update,
    });
  });

  // Function to send a webhook for a chunk of embeds
  const sendWebhook = async (embeds: any[]) => {
    const webhookURL = process.env.ALERT_WEBHOOK;
    console.log("Sending webhook to:", webhookURL);

    const response = await axios.post(webhookURL, {
      embeds,
    });
    return response.status === 200;
  };

  // Send Additions
  const creates = generateAddedEmbed(addonUpdates.create);
  if (creates) {
    await sendWebhook([{ ...creates, color: EMBED_COLORS.create }]);
  }

  // Send Deletions
  const deletes = generateDeleteEmbed(addonUpdates.delete);
  if (deletes) {
    await sendWebhook([{ ...deletes, color: EMBED_COLORS.delete }]);
  }

  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10);
    const success = await sendWebhook(chunk);
    // if (!success) {
    //   console.error('Failed to send webhook for chunk:', chunk);
    // }
  }
};

