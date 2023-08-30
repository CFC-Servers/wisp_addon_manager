FROM node:20.5

WORKDIR /app

COPY src/package.json package.json

RUN npm i --force && npm install typescript -g 
RUN npm update wispjs

COPY src/tsconfig.json tsconfig.json
COPY src/*.ts ./

RUN tsc

RUN ls -alh /app/node_modules/wispjs/dist

CMD [ "node", "dist/index.js" ]
