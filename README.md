# wisp_addon_manager
Keeps a Wisp GMod server's addons in-line with a master list of addons.

- Clones any addons that are missing
- Updates any git-controlled addons that are present
- Deletes any git-controlled addons that shouldn't be there

## Running

### With Docker (Compose)
```
# Edit .env with your settings (DOMAIN, UUID, TOKEN, GH_PAT)
docker compose up --build
```

### Locally
```
export DOMAIN=https://blah.physgun.com
export UUID=<the UUID of your Wisp server (from the URL)>
export TOKEN=<the API Token generated in the Wisp Credentials panel>
export GH_PAT=<a github token or fine-grained token with access to the repos you need>

npm i;
npm install typescript -g;
tsc;
node dist/index.js;
```
