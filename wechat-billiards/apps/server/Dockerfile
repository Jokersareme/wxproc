FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps ./apps
COPY packages/core/package.json ./packages/core/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/client/package.json ./packages/client/package.json
RUN yarn install --immutable
COPY packages ./packages
COPY third_party ./third_party
COPY tsconfig.json ./
RUN yarn build:server

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
RUN npm install --omit=dev --ignore-scripts @cloudbase/node-sdk@^3.0.0
COPY --from=build /app/apps/server/dist/index.cjs ./dist/index.cjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.cjs"]
