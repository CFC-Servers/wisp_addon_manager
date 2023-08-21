FROM node:20.5

WORKDIR /app

COPY package*.json ./

RUN npm install && npm install typescript -g

COPY tsconfig.json tsconfig.json

COPY *.ts ./
COPY addons.yaml addons.yaml

RUN tsc
CMD [ "node", "dist/index.js" ]