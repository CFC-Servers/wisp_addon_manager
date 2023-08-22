const axios = require('axios');
const { AddonChangeInfo } = require("./index_types");
const { CommitDTO } = require("./github");

const EMBED_COLORS = {
  update: 0x1E90FF,
  delete: 0xFF4500,
  create: 0x32CD32,
};

const generateUpdateEmbed = (addonUpdate: typeof AddonChangeInfo, maxMessageLength: number = 50) => {
  const { addonName, updateInfo } = addonUpdate;

  const embedTitle = `🚀 Updates for: **${addonName}**`;
  const embedURL = updateInfo.url;

  let commitList = updateInfo.commits.map((commit: typeof CommitDTO, index: number) => {
    let message = commit.message;
    if (message.length > maxMessageLength) {
      message = `${message.substring(0, maxMessageLength)}...`;
    }

    const shortSha = commit.sha.substring(0, 7);
    const commitLink = `[\`${shortSha}\`](${commit.url})`;
    const commitLine = `- **[**${commitLink}**]**: \`${message}\``;
    return commitLine;
  }).join('\n');

  const embedDescription = `
  ${commitList}\n
  🔗 [View Full Diff](${embedURL})
  `;

  const embed = {
    title: embedTitle,
    description: embedDescription,
    url: embedURL,
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

  const deletes = generateDeleteEmbed(addonUpdates.delete);
  const creates = generateAddedEmbed(addonUpdates.create);

  if (deletes) {
    updates.push({
      ...deletes,
      color: EMBED_COLORS.delete,
    });
  }

  if (creates) {
    updates.push({
      ...creates,
      color: EMBED_COLORS.create,
    });
  }

  // Function to send a webhook for a chunk of embeds
  const sendWebhook = async (embeds: any[]) => {
    const webhookURL = process.env.ALERT_WEBHOOK;
    console.log("Sending webhook to:", webhookURL);

    const response = await axios.post(webhookURL, {
      embeds,
    });
    return response.status === 200;
  };

  // Splitting the updates into chunks of 10
  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10);
    const success = await sendWebhook(chunk);
    // if (!success) {
    //   console.error('Failed to send webhook for chunk:', chunk);
    // }
  }
};

