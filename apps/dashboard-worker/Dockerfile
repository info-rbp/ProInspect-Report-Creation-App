FROM node:22-alpine AS build
WORKDIR /workspace
COPY package.json tsconfig.base.json tsconfig.json ./
COPY apps/dashboard-worker ./apps/dashboard-worker
COPY packages ./packages
RUN npm install --ignore-scripts --no-audit --no-fund
RUN npm run build:packages && npm run build --workspace @pcr/dashboard-worker

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /workspace
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/dashboard-worker/package.json ./apps/dashboard-worker/package.json
COPY --from=build /workspace/apps/dashboard-worker/dist ./apps/dashboard-worker/dist
COPY --from=build /workspace/packages ./packages
USER node
EXPOSE 8080
CMD ["node", "apps/dashboard-worker/dist/index.js"]
