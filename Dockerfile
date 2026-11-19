# Edge agent and kiosk page of a Faculty screen. Multi-architecture (amd64 and arm64: a mini-PC or a Raspberry Pi):
#   docker buildx build --platform linux/amd64,linux/arm64 -t smartcampus/faculty-screen .
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable

# Dependencies first, so a change in the sources does not reinstall them. The shared protocol packages are vendored
# (see scripts/sync-protocol.sh), which is why the image builds without the CentralServer checkout.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY vendor ./vendor
COPY apps/agent/package.json apps/agent/
COPY apps/display/package.json apps/display/
COPY packages/local-contract/package.json packages/local-contract/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm build && pnpm --filter @smartcampus/faculty-agent deploy --prod --legacy /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    DISPLAY_PORT=3000 \
    DISPLAY_BIND=0.0.0.0 \
    DISPLAY_DIST=/app/display
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /app/apps/display/dist ./display
# The identity key lives in /data (a volume), readable by this user only, and never in the image.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.DISPLAY_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
