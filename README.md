# Discord Radio Bot

A Discord bot that joins a voice channel and plays **live radio** from a configurable list of many stations. Browse stations by name or hashtag, use paginated lists with buttons, and play by number, name, or hashtag. Written in **TypeScript** with full type safety.

The bot keeps an **independent voice session per server**, so a single bot instance can be playing in many servers' voice channels at the same time. Within a single server it stays in one voice channel; running `!play` again there switches the station or channel without affecting playback in other servers, and `!stop` only leaves that server's channel.

To avoid streaming to nobody, the bot **auto-disconnects from a server's voice channel after being alone (no human listeners) for 5 minutes**. The countdown is cancelled if someone (re)joins the channel before it elapses. This is tracked per server, so an idle channel in one server won't affect playback in another.

## Requirements

- **Node.js** 18 or newer
- **FFmpeg** is provided by the `ffmpeg-static` dependency (no separate installation needed; used to decode streams and send Opus to Discord)

## Setup

1. **Create a Discord application and bot**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application
   - Open **Bot** → Add Bot → copy the **Token**
   - Under **OAuth2 → URL Generator**, enable scopes: `bot`; permissions: `Send Messages`, `Connect`, `Speak`, `Use Voice Activity`

2. **Clone / open the project and install dependencies**
   ```bash
   npm install
   ```

3. **Configure the bot token**
   - Copy `.env.example` to `.env` (or create `.env`)
   - Set `DISCORD_TOKEN` to your bot token

4. **Invite the bot**
   - Use the generated invite URL from the Developer Portal to add the bot to your server

## Usage

- **`!stations [page]`** – Lists all available radio stations (20 per page). Use a page number to jump (e.g. `!stations 2`). Use the **Previous** / **Next** buttons to browse. Each page has **▶** buttons to play a station by its number.
- **`!play <number | name | hashtag>`** – Bot joins your current voice channel and plays the chosen station. You must be in a voice channel first. Examples: `!play 1`, `!play BestFM`, `!play #bestfm`.
- **`!stop`** – Bot stops playback and leaves the voice channel.
- **`!help`** – Shows command help.

## Run

**Build and run (recommended):**
```bash
npm run build
npm start
```

**Or build and run in one step:**
```bash
npm run dev
```

## Deploy on Render

The repo includes a **`render.yaml`** blueprint that deploys the bot as a **Web Service** (Render's free tier only offers web services, so the bot exposes a small HTTP health endpoint to satisfy Render's port binding and health checks).

1. Push the repo to GitHub/GitLab.
2. In the [Render dashboard](https://dashboard.render.com), choose **New → Blueprint** and select the repo — Render reads `render.yaml` automatically. (Alternatively create a **Web Service** manually with build command `npm ci --include=dev && npm run build` and start command `npm start`.)
3. When prompted, set the **`DISCORD_TOKEN`** environment variable to your bot token (it is marked `sync: false`, so it is never committed).
4. Deploy. The service is healthy once `GET /healthz` returns `200` — it reports Discord connection state and the number of active voice sessions.

**FFmpeg:** nothing to install — the `ffmpeg-static` npm dependency downloads a Linux FFmpeg binary during `npm install` on Render, and `prism-media` picks it up automatically.

**Free-tier caveat:** Render's free web services **spin down after ~15 minutes without inbound HTTP traffic**, which takes the bot offline until the next request wakes it (and drops any live voice sessions). To keep it online 24/7 either:
- point a free uptime pinger (e.g. [UptimeRobot](https://uptimerobot.com) or [cron-job.org](https://cron-job.org)) at `https://<your-service>.onrender.com/healthz` every 5–10 minutes, or
- upgrade the service to a paid instance (set `plan: starter` in `render.yaml`), which never spins down.

## Station list

Stations are loaded from **`stations.txt`** at startup. The file must contain a single line with a `data-stations="..."` attribute whose value is HTML-entity-encoded JSON: an array of objects with at least `name` and `stream_url`. Optional fields include `hashtag`, `website_url`, `type`, `region`, `city`, `logo`, `frequencies`. Stations are sorted alphabetically by name. The bot exits on startup if the file is missing or invalid.

## Project structure

- **`src/index.ts`** – Entry point: Discord client, event wiring (message + interaction), ready handler, login
- **`src/commands.ts`** – Text command parsing and handlers: `!help`, `!stations`, `!play`, `!stop`
- **`src/interactions.ts`** – Button handlers: station play buttons and stations list prev/next pagination
- **`src/voice.ts`** – Voice connections and audio: one player + connection **per guild** (keyed by guild ID), stream resource, join/leave, disconnect handling
- **`src/server.ts`** – HTTP health endpoint (`/healthz`) for hosting platforms like Render that require port binding and health checks
- **`render.yaml`** – Render Blueprint for one-click web service deployment
- **`src/stationsUI.ts`** – Station list UI: paginated content and button rows (Previous/Next, play-by-number)
- **`src/constants.ts`** – Shared constants (station IDs, page size, help text)
- **`src/radioList.ts`** – Loads and parses `stations.txt`, finds station by number/name/hashtag
- **`stations.txt`** – Station list (data-stations JSON)
- **`dist/`** – Compiled JavaScript (created by `npm run build`)
- **`tsconfig.json`** – TypeScript configuration (strict mode, ESM)

## Scripts

| Script    | Description                    |
|----------|---------------------------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start`     | Run the bot (`node dist/index.js`) |
| `npm run dev`   | Build then run the bot         |
