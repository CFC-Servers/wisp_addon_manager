# wisp_addon_manager
A Javascript module that keeps a Wisp GMod server's addons in-line with a master list of addons.

- Clones any addons that are missing
- Updates any git-controlled addons that are present
- Deletes any git-controlled addons that shouldn't be there

# Instructions

You can import this Module into your own JS project, or run it as-is with Docker.

You can also use the [GitHub Action](https://github.com/CFC-Servers/wisp_addon_manager_action) to run it on an interval, or more easily use the Control File feature.

## Using the JS Module

### Installation
```
npm i CFC-Servers/wisp_addon_manager
```

### Usage Example
```js
import { ManageAddons } from "wisp_addon_manager";

(async function() {
  // We're using the process env to get config values for this example, but you can do this however you want.

  // The domain of your Wisp server. i.e.:
  // - example.panel.gg
  // - selfhosted.mydomain.com
  const domain  = process.env.WISP_DOMAIN;
  if (!domain) { throw new Error("No Wisp Domain provided"); }

  // The UUID of your wisp server.
  // If your server is https://example.panel.gg/servers/1234, then the UUID is 1234
  const uuid = process.env.WISP_UUID;
  if (!uuid) { throw new Error("No Wisp UUID provided"); }

  // Any human-friendly name for the server you're updating (used in the Discord messages)
  const serverName = "DarkRP 1";

  // A Wisp API token for your server (of course, the user that owns this token needs access to the server you're updating)
  // You can generate one at https://example.panel.gg/account/security
  const token = process.env.WISP_TOKEN;
  if (!token) { throw new Error("No Wisp Token provided"); }

  // A GitHub Personal Access Token with the `repo` scope for any private repos you're using
  // You need one for public repos too because we have to use the Github API anyway
  // You can generate one at: https://github.com/settings/tokens
  const ghPAT = process.env.GITHUB_PAT;
  if (!ghPAT) { throw new Error("No GitHub PAT provided"); }

  // A Discord Webhook URL (the full URL including https://) for the channel you want to send update messages to
  const alertWebhook = process.env.DISCORD_ALERT_WEBHOOK;
  if (!alertWebhook) { throw new Error("No Discord Alert Webhook provided"); }

  // A full Discord Webhook URL for failure messages specifically
  const failureWebhook = process.env.DISCORD_FAILURE_WEBHOOK;
  if (!failureWebhook) { throw new Error("No Discord Failure Webhook provided"); }

  // WARNING: Not well tested yet
  // OPTIONAL (read more in the Control File section):
  // The raw YAML contents of your control file
  // If you don't provide this, the script will just update all addons in the addons folder
  // You can pull this from a URL or hard-code it somewhere if you want (a local file or something perhaps)
  const controlFile = process.env.CONTROL_FILE;
  if (!controlFile) {
    console.log("No control file provided - will only update existing addons");
  }

  try {
    const config = {
      domain,
      uuid,
      serverName,
      token,
      ghPAT,
      alertWebhook,
      failureWebhook,
      controlFile
    };

    await ManageAddons(config);
    console.log("Addon Manager completed successfully!");
  } catch (e) {
    console.error("Addon Manager did not complete successfully!");
    console.error(e);
  }
})();
```

---

## Running in Docker

### Requirements:
Docker + Docker Compose

### Env/Config
Copy the env file over:
```
cp .env_example .env
```

Then, open `.env` and fill out all of the appropriate fields.

If you'd like to use the Control File, be sure to read the Control File section of the README and update the empty `control.yaml` in here.

### Running
#### From terminal:
```
docker compose up --build
```

#### From Docker Desktop:
Er.. not really sure about this one. Shoot us a message or make a PR if you've used Docker Compose on Windows / Docker Desktop!


---

## The "Control File"
By default, this module will simply find all git-tracked addons in your server and run a `git-pull` on them.
Then, it'll post Discord messages with any changes.

If you want to _seriously_ manage your addons, consider a Control File.

### Explanation
If you include a Control File, you can take advantage of all of the features this module has to offer.
In summary, it will:
- **Update** all existing git-tracked addons
- **Delete** any addons that are **not** present in the Control File
- **Clone** any addons that are present in the Control File, but not on the server
- **Delete** and **reclone** any addons that are **on the wrong branch**

This lets you completely control the current status of your addons from a single config file.

At CFC Servers, we maintain a repository with all of our Control Files for each server. This lets us control our servers with a great degree of power and flexibility.

### Format
The Control File is simply a YAML file in the following format:
```yaml
# Git-controlled addon format:
#
# - url: The plain github URL of the project (String) ( e.g. https://github.com/CFC-Servers/example_project )
#   branch: The branch name to track (String)
addons:
  - url: https://github.com/CFC-Servers/gm_express
    branch: feature/include-http-failures-in-retries

  - url: https://github.com/cfc-servers/cfc_err_forwarder
    branch: lua

  - url: https://github.com/cfc-Servers/cfc_cl_http_whitelist
    branch: main

  - url: https://github.com/CFC-Servers/cfc_cl_http_whitelist_configs
    branch: master
```

Addons will be cloned to the lowercased repo name.
So, `https://github.com/Stooberton/ACF-3` would be cloned to `/garrysmod/addons/acf-3`
