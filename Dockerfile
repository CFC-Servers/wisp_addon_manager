FROM node:20.5

WORKDIR /app

# Install dependencies (incl. wispjs from npm) at build time
COPY package.json package-lock.json ./
RUN npm ci

# Compile the app
COPY tsconfig.json tsconfig.json
COPY src ./src
RUN npx tsc

CMD [ "node", "dist/docker.js" ]
