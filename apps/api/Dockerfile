FROM node:22-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY apps/api ./apps/api
COPY packages ./packages
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN npm run build:packages && npm run build --workspace @pcr/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /workspace
COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/packages ./packages
USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/index.js"]
