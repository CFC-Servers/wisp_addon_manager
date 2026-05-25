FROM node:20.5

WORKDIR /app

COPY package.json package.json
COPY tsconfig.json tsconfig.json
COPY src ./src

# node_modules (incl. the local wispjs symlink, @types/node, and the project's
# own typescript) is bind-mounted at runtime via docker-compose, so use the
# project-local tsc to compile, then run.
CMD [ "sh", "-c", "node_modules/.bin/tsc && node dist/docker.js" ]
