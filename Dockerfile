# PayeeLock server image for Cloudflare Containers (linux/amd64).
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production PORT=4310

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY web ./web

# The Wasmer SDK caches the python/python package under ./.wasmer on first run.
RUN mkdir -p .state .wasmer

EXPOSE 4310
CMD ["node", "src/server.js"]
