FROM node:22-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN npm run build:packages && npm run build --workspace @pcr/integration-worker
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /workspace
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/integration-worker/package.json ./apps/integration-worker/package.json
COPY --from=build /workspace/apps/integration-worker/dist ./apps/integration-worker/dist
CMD ["node", "apps/integration-worker/dist/index.js"]
