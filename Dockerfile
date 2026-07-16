FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node index.html manifest.webmanifest server.mjs sw.js ./
COPY --chown=node:node assets ./assets
COPY --chown=node:node src ./src
COPY --chown=node:node server ./server
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-4173}/readyz >/dev/null || exit 1

CMD ["node", "server.mjs"]
