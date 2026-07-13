# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:22-slim

# Real (dynamically linked) FFmpeg from Debian: the static ffmpeg-static npm
# binary segfaults on Render's runtime, so production uses the distro build.
# yt-dlp (powers !yt) is pip-installed into a venv rather than using the
# standalone binary: the PyInstaller binary unpacks a whole Python runtime on
# EVERY invocation, which costs 10+ seconds on small cloud instances (0.1
# vCPU) and causes "!yt timed out" errors. A pip install also allows yt-dlp
# plugins (e.g. a PO token provider) later.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-venv \
 && python3 -m venv /opt/yt-dlp \
 && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade yt-dlp \
 && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/* /root/.cache

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# ffmpeg-static is devOptional (dev dependency + optional peer of
# prism-media), which --omit=dev alone does not reliably exclude; remove it
# explicitly so prism-media falls through to the distro ffmpeg on PATH.
RUN npm ci --omit=dev && rm -rf node_modules/ffmpeg-static

COPY --from=build /app/dist ./dist
COPY stations.txt ./

# Writable home for favorites/settings/stats (data/store.json). Note: on
# hosts with an ephemeral filesystem this resets on each deploy unless
# DATA_DIR points at a persistent disk.
RUN mkdir -p /app/data && chown node:node /app/data

USER node
CMD ["node", "dist/index.js"]
