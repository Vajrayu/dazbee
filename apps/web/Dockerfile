# syntax=docker/dockerfile:1
# The web app's image: Next.js's standalone server, traced from the repo's root, with the files it
# serves as they are (public/, with vendor/, and the build's static chunks) copied in beside it.
# Build from the repo's root: docker build -f apps/web/Dockerfile --build-arg BUILD_ID=<commit> .

FROM node:26.13.0-slim AS base
WORKDIR /repo

# The workspace's manifests and lockfile, and the CanvasKit package its install fetches the build
# into, so the install below is rebuilt only when one of them changes.
FROM base AS manifests
COPY . .
RUN find . -path ./packages/canvaskit -prune -o -type f \
      ! -name package.json ! -name pnpm-lock.yaml ! -name pnpm-workspace.yaml -exec rm {} +

FROM base AS install
COPY --from=manifests /repo ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" && \
    pnpm install --frozen-lockfile --filter @dazbee/web...

FROM install AS build
COPY packages packages
COPY apps/web apps/web
# The commit the build is of: Next's deploymentId, and what <html data-build> names.
ARG BUILD_ID=dev
ENV BUILD_ID=$BUILD_ID NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @dazbee/web build

FROM base
LABEL org.opencontainers.image.source=https://github.com/dazbee-ai/dazbee
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static apps/web/.next/static
COPY --from=build /repo/apps/web/public apps/web/public
# HOSTNAME is the address the server listens on, which Docker otherwise sets to the container's id.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --start-period=60s --start-interval=1s --timeout=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3000/login').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
ARG BUILD_ID=dev
ENV BUILD_ID=$BUILD_ID
