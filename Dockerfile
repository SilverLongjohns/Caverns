FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

RUN npm ci

COPY shared/ shared/
COPY server/ server/
COPY client/ client/
COPY tsconfig.json .

RUN npm run build

FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/

RUN npm ci --omit=dev

COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/shared/src shared/src
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
