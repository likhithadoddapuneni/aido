# One image, three commands: the API (default), the background worker, and the migrator.
#   docker run aidooi-api                       → API
#   docker run aidooi-api node dist/worker.js   → worker
#   docker run aidooi-api node dist/migrate.js  → apply migrations, then exit

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @aidooi/api build

# Native add-ons cannot be bundled, so they are installed on their own, for this exact platform.
FROM node:24-alpine AS native
WORKDIR /native
COPY --from=build /repo/apps/api/package.json /tmp/api-package.json
RUN ARGON2=$(node -p "require('/tmp/api-package.json').dependencies['@node-rs/argon2']") \
 && npm install --omit=dev --no-audit --no-fund --no-package-lock "@node-rs/argon2@${ARGON2}"

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=native /native/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/migrations ./migrations
# Run as an unprivileged user; nothing in the app needs to write to disk.
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
