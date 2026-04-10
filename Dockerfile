FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY roomgrid/package.json roomgrid/

RUN npm ci

COPY shared/ shared/
COPY server/ server/
COPY client/ client/
COPY roomgrid/ roomgrid/
COPY tsconfig.json .

RUN npm run build

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY roomgrid/package.json roomgrid/

RUN npm ci --omit=dev

COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/shared/src shared/src
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/roomgrid/dist roomgrid/dist
COPY --from=build /app/roomgrid/src/data roomgrid/src/data
COPY --from=build /app/roomgrid/package.json roomgrid/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

EXPOSE 8080

CMD ["node", "server/dist/index.js"]
