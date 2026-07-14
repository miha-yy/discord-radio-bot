# Discord Radio Bot

A Discord bot that joins a voice channel and plays **live radio** from a configurable list of stations — plus worldwide stations from [radio-browser.info](https://www.radio-browser.info) and **audio from YouTube** (via yt-dlp). Browse stations with paginated button lists, search by name/genre/region, keep per-server favorites, and control everything with either classic `!` text commands or **slash commands with autocomplete**. Written in **TypeScript** with full type safety.

The bot keeps an **independent voice session per server**, so a single bot instance can be playing in many servers' voice channels at the same time. Within a single server it stays in one voice channel; running `!play` again there switches the station or channel without affecting playback in other servers, and `!stop` only leaves that server's channel.

## Features

- **Live radio** from `stations.txt` (124 stations by default), with paginated lists, ▶ play buttons, and filtering by name/genre/region
- **Worldwide search** — `!radio jazz` searches ~50k stations on radio-browser.info and plays from the results
- **YouTube playback** — `!yt <link or search>` plays videos and livestreams through yt-dlp
- **YouTube queue** — a second `!yt` while YouTube is playing queues the track (up to 25); `!queue` shows/edits it, `!skip` jumps ahead, and tracks auto-advance when one ends
- **Auto-restart watchdog** — dropped live streams are restarted up to 3 times with backoff; if the stream can't be revived, the bot reports it in the text channel where playback started (including the FFmpeg error) instead of going silent
- **Now playing** — `!np` shows the current song title (ICY/Shoutcast metadata), uptime, and volume
- **Slash commands** — every command also exists as `/command`, with autocomplete for local stations (`/play`) and worldwide search (`/radio`)
- **Favorites & resume** — per-server favorites list; bare `!play` resumes the last played station
- **Volume** — `!volume 10–200` per server, applied via FFmpeg (no per-packet CPU cost)
- **Sleep timer** — `!sleep 45` stops playback after 45 minutes
- **DJ role** — optionally restrict playback control to one role (`!dj @role`)
- **24/7 mode** — `!247 on` disables the auto-leave-when-alone timeout
- **Stats** — `!top` shows the most played stations with listening hours
- **Fun commands** — `!whois cute` tags a random listener, `!ship @a @b` compatibility checks, `!rate <thing>`, `!8ball`, `!choose`, `!roll`, `!flip`
- **Auto-disconnect** — leaves after 5 minutes alone in a channel (unless 24/7 mode is on), tracked per server

## Requirements

- **Node.js** 18 or newer
- **FFmpeg** – for local development it is provided by the `ffmpeg-static` devDependency (no separate installation needed). In the production Docker image the distro FFmpeg is installed instead, because static FFmpeg builds can segfault in container environments.
- **yt-dlp** *(optional, only for `!yt`)* – installed automatically in the Docker image. For local development install it yourself (e.g. `winget install yt-dlp` on Windows, `brew install yt-dlp` on macOS) or set `YTDLP_PATH` to the binary. Without it, everything except YouTube playback works normally.

## Setup

1. **Create a Discord application and bot**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application
   - Open **Bot** → Add Bot → copy the **Token**
   - Still on the **Bot** page, under **Privileged Gateway Intents**, enable **Message Content Intent** (needed for `!` commands) and **Server Members Intent** (needed for `!whois` to pick from all members — without it the bot won't log in)
   - Under **OAuth2 → URL Generator**, enable scopes: `bot`, `applications.commands`; permissions: `Send Messages`, `Connect`, `Speak`, `Use Voice Activity`

2. **Clone / open the project and install dependencies**
   ```bash
   npm install
   ```

3. **Configure the bot token**
   - Copy `.env.example` to `.env` (or create `.env`)
   - Set `DISCORD_TOKEN` to your bot token

4. **Invite the bot**
   - Use the generated invite URL from the Developer Portal to add the bot to your server

## Commands

Every text command has a slash-command twin (`/play`, `/stations`, …) with autocomplete.

### Playback

| Command | Description |
|---------|-------------|
| `!play <number \| name \| #hashtag>` | Join your voice channel and play a station. Bare `!play` resumes the last station played on this server (falling back to the first favorite). |
| `!stop` | Stop playback and leave the voice channel. |
| `!np` | What's playing: station, current song (if the stream publishes titles), uptime, volume, sleep timer. |
| `!volume [10–200]` | Show or set this server's volume. Applied by restarting the FFmpeg pipeline, so there's no steady-state CPU cost. |
| `!sleep <minutes \| off>` | Stop playback automatically after N minutes (max 480). |
| `!skip` | Skip to the next queued YouTube track (with an empty queue: stop and leave, like the track finishing). |
| `!queue [clear \| remove <n>]` | Show the YouTube queue, clear it, or remove one entry. |

### Finding stations

| Command | Description |
|---------|-------------|
| `!stations [filter] [page]` | Paginated station list (20/page) with ▶ buttons. Optional filter, e.g. `!stations rock` or `!stations koroška 2`. |
| `!search <query>` | Search the local list by name/genre/region — returns up to 15 matches with play buttons. |
| `!radio <query>` | Search radio-browser.info (~50k worldwide stations); play results with the ▶ buttons. `/radio` autocompletes live from the API. |
| `!yt <link or search>` | Play YouTube audio — normal videos and livestreams (auto-restarted like radio). If YouTube is already playing, the track is **queued** instead; when the queue runs out, the bot leaves. See [YouTube bot check](#youtube-bot-check) if it fails on a cloud host. |

### Favorites

| Command | Description |
|---------|-------------|
| `!fav` | List this server's favorites. |
| `!fav add <station>` / `!fav remove <station>` | Manage favorites (max 25). |
| `!fav play [n]` or `!fav <n>` | Play favorite number n (default 1). |

### Server settings (require **Manage Server**)

| Command | Description |
|---------|-------------|
| `!dj [@role \| off]` | Restrict playback control (`play/stop/volume/sleep/yt/skip/queue edits/radio`) to a role. Members with Manage Server always bypass it. |
| `!247 [on \| off]` | 24/7 mode — never auto-leave an empty voice channel. |

### Fun

| Command | Description |
|---------|-------------|
| `!whois <something>` | Tags a random server member and declares them *something* — e.g. `!whois cute`. Picks from the full member list (needs the **Server Members Intent**, see Setup); the list is cached for 5 minutes. |
| `!ship @user1 @user2` | Compatibility check with a 💘 progress bar. One mention ships them with you. Seeded by the pair, so the score never changes — it's science. |
| `!rate <thing>` | Rates anything out of 10 (also seeded — consistent verdicts). Rating the bot itself is always 10/10. |
| `!8ball <question>` | The classic magic 8-ball. |
| `!choose a \| b \| c` | Picks one option (also accepts commas or spaces as separators). |
| `!roll [2d20]` / `!flip` | Dice (default d6, up to 20d1000) and coin flip. |

### Stats

| Command | Description |
|---------|-------------|
| `!top` | Most played stations across the bot, with listening hours. |

## Reliability behavior

- **Watchdog:** when a live stream drops, the bot restarts it after 2 s / 5 s / 10 s. After 60 s of stable playback the retry budget resets. If all retries fail, the bot posts a warning (with the last FFmpeg error) to the channel that started playback, then plays the next queued track — or leaves when there is none.
- **Queue staleness:** YouTube stream URLs expire after a few hours, so a queued track that waited more than an hour is re-resolved through yt-dlp just before it plays (a short gap on slow instances). Tracks that fail to resolve or start are skipped with a notice instead of stalling the queue.

## YouTube bot check

YouTube challenges requests from **datacenter IPs** (Render, AWS, …) with *“Sign in to confirm you're not a bot”*, which is why `!yt` can work sometimes and fail other times on a cloud host. The bot mitigates this in layers:

1. **Automatic retry with exempt player clients.** When the bot check hits, the bot retries once with `--extractor-args "youtube:player_client=web_embedded,android_vr,tv"` — clients that currently don't require a [PO token](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide) and usually bypass the challenge. Override the list with `YTDLP_FALLBACK_CLIENTS` if YouTube's rules change.
2. **Cookies (reliable fix).** Export YouTube cookies from a logged-in browser (any “cookies.txt” exporter extension, Netscape format) and point `YTDLP_COOKIES` at the file. On Render: add it as a **Secret File** (e.g. `/etc/secrets/cookies.txt`) and set `YTDLP_COOKIES=/etc/secrets/cookies.txt`. Use a throwaway Google account — automated use can get an account flagged. Cookies are then passed to every yt-dlp call.
3. **PO token provider (heavy-duty).** If both fail long-term, yt-dlp's recommended server-side fix is the [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) plugin; that requires switching from the standalone binary to a pip-installed yt-dlp with plugins.

`YTDLP_EXTRACTOR_ARGS` lets you tune the *first* attempt without redeploying (e.g. pin different clients).

## Persistence

Favorites, last station, volume, DJ role, 24/7 flag, and play stats live in `data/store.json` (override the directory with `DATA_DIR`). **Note:** on Render's free tier the filesystem is ephemeral — the store resets on each deploy/restart. Attach a persistent disk (paid) and point `DATA_DIR` at it, or accept that favorites/stats reset.

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

### Environment variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token (required). |
| `PORT` | Health server port (default 3000; set by Render automatically). |
| `DATA_DIR` | Directory for `store.json` (default `./data`). |
| `YTDLP_PATH` | Path to the yt-dlp binary if it's not on PATH. |
| `YTDLP_COOKIES` | Path to a Netscape-format cookies.txt for YouTube (fixes the datacenter-IP bot check; see above). |
| `YTDLP_EXTRACTOR_ARGS` | Extra `--extractor-args` for the first yt-dlp attempt. |
| `YTDLP_FALLBACK_CLIENTS` | Player clients for the bot-check retry (default `web_embedded,android_vr,tv`). |
| `YTDLP_JS_RUNTIMES` | JS runtime for yt-dlp's challenge solver (default: the bot's own node binary; `off` disables). |
| `YTDLP_TIMEOUT_MS` | Timeout per yt-dlp call (default 90000; slow cloud instances need the headroom). |

## Deploy on Render

The repo includes a **`render.yaml`** blueprint that deploys the bot as a **Docker web service** in the Frankfurt region (Render's free tier only offers web services, so the bot exposes a small HTTP health endpoint to satisfy Render's port binding and health checks).

1. Push the repo to GitHub/GitLab.
2. In the [Render dashboard](https://dashboard.render.com), choose **New → Blueprint** and select the repo — Render reads `render.yaml` automatically. (Note: a service's runtime and region are fixed at creation — to switch an existing service to Docker/Frankfurt you must delete and recreate it.)
3. When prompted, set the **`DISCORD_TOKEN`** environment variable to your bot token (it is marked `sync: false`, so it is never committed).
4. Deploy. The service is healthy once `GET /healthz` returns `200` — it reports Discord connection state and the number of active voice sessions.

**FFmpeg & yt-dlp:** the Docker image installs Debian's FFmpeg (`apt-get install ffmpeg`) and the standalone `yt-dlp` binary (for `!yt`). The `ffmpeg-static` npm binary is deliberately **not** used in production — it segfaults on Render's runtime — and is pruned from the image along with the other devDependencies.

**Debug endpoints** (useful when a station won't play in production):
- `GET /debug/stream/<number>` – fetches the station's stream URL from the server's network and reports HTTP status, content type, and bytes read (detects geo-blocks and dead streams).
- `GET /debug/ffmpeg/<number>` – runs the station through the bot's real FFmpeg transcode pipeline for 3 seconds and reports the binary used, bytes produced, stderr, and exit code/signal.

**Free-tier caveat:** Render's free web services **spin down after ~15 minutes without inbound HTTP traffic**, which takes the bot offline until the next request wakes it (and drops any live voice sessions). To keep it online 24/7 either:
- point a free uptime pinger (e.g. [UptimeRobot](https://uptimerobot.com) or [cron-job.org](https://cron-job.org)) at `https://<your-service>.onrender.com/healthz` every 5–10 minutes, or
- upgrade the service to a paid instance (set `plan: starter` in `render.yaml`), which never spins down.

## Station list

Stations are loaded from **`stations.txt`** at startup. The file must contain a single line with a `data-stations="..."` attribute whose value is HTML-entity-encoded JSON: an array of objects with at least `name` and `stream_url`. Optional fields include `hashtag`, `website_url`, `type`, `region`, `city`, `logo`, `frequencies`. Stations are sorted alphabetically by name. The bot exits on startup if the file is missing or invalid.

## Project structure

- **`src/index.ts`** – Entry point: Discord client, event wiring (messages, buttons, slash commands, autocomplete), ready handler, login
- **`src/actions.ts`** – Core command logic shared by the text and slash front-ends (play/stop/np/search/fav/volume/sleep/dj/247/top/yt/radio)
- **`src/commands.ts`** – Text (`!`) command parsing → actions
- **`src/fun.ts`** – Fun commands (whois/ship/rate/8ball/choose/roll/flip)
- **`src/slash.ts`** – Slash command definitions, registration, dispatch, and autocomplete
- **`src/interactions.ts`** – Button handlers: station ▶ buttons, radio-browser ▶ buttons, list pagination
- **`src/voice.ts`** – Voice engine: one player + connection **per guild**, play sources (station / radio-browser / YouTube), YouTube queue with auto-advance, stream watchdog with auto-restart, volume, sleep timer, alone/24-7 handling, stats hooks
- **`src/storage.ts`** – JSON persistence for per-guild settings (favorites, volume, DJ role, 24/7, last station) and play stats
- **`src/metadata.ts`** – ICY/Shoutcast metadata client for `!np` song titles
- **`src/health.ts`** – Stream probing (used by the `/debug` endpoints)
- **`src/radioBrowser.ts`** – radio-browser.info API client (search, resolve, click counting)
- **`src/youtube.ts`** – yt-dlp integration (resolve URL/search → direct audio URL)
- **`src/server.ts`** – HTTP health endpoint (`/healthz`) plus stream/FFmpeg/station debug endpoints
- **`src/stationsUI.ts`** – Station list UI: filtering, paginated content, button rows, station embeds
- **`src/radioList.ts`** – Loads and parses `stations.txt`, finds station by number/name/hashtag
- **`src/constants.ts`** – Shared constants (button IDs, page size, help text)
- **`render.yaml`** – Render Blueprint for one-click web service deployment (Docker runtime, Frankfurt region)
- **`Dockerfile`** – Production image: Node 22 + Debian FFmpeg + yt-dlp, builds TypeScript, prunes devDependencies
- **`stations.txt`** – Station list (data-stations JSON)
- **`dist/`** – Compiled JavaScript (created by `npm run build`)
- **`tsconfig.json`** – TypeScript configuration (strict mode, ESM)

## Scripts

| Script    | Description                    |
|----------|---------------------------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start`     | Run the bot (`node dist/index.js`) |
| `npm run dev`   | Build then run the bot         |
