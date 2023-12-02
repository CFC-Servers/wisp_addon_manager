FROM node:20.5

WORKDIR /app

COPY package.json package.json
COPY *.tgz .

RUN npm i --force && npm install typescript -g 
RUN npm update wispjs

COPY tsconfig.json tsconfig.json
COPY *.ts ./

RUN tsc

RUN ls -alh /app/node_modules/

CMD [ "node", "dist/docker.js" ]
