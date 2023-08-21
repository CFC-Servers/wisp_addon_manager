# wisp_addon_manager
Keeps a Wisp GMod server's addons in-line with a master list of addons.

- Clones any addons that are missing
- Updates any git-controlled addons that are present
- Deletes any git-controlled addons that shouldn't be there

## Running

### With Docker (Compose)
```
docker compose up --build
```

### Locally
```
npm i;
npm install typescript -g;
tsc;
node dist/index.js;
```
