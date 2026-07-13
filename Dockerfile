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
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# ffmpeg-static is devOptional (dev dependency + optional peer of
# prism-media), which --omit=dev alone does not reliably exclude; remove it
# explicitly so prism-media falls through to the distro ffmpeg on PATH.
RUN npm ci --omit=dev && rm -rf node_modules/ffmpeg-static

COPY --from=build /app/dist ./dist
COPY stations.txt ./

USER node
CMD ["node", "dist/index.js"]
