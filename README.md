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

## Station list

Stations are loaded from **`stations.txt`** at startup. The file must contain a single line with a `data-stations="..."` attribute whose value is HTML-entity-encoded JSON: an array of objects with at least `name` and `stream_url`. Optional fields include `hashtag`, `website_url`, `type`, `region`, `city`, `logo`, `frequencies`. Stations are sorted alphabetically by name. The bot exits on startup if the file is missing or invalid.

## Project structure

- **`src/index.ts`** – Entry point: Discord client, event wiring (message + interaction), ready handler, login
- **`src/commands.ts`** – Text command parsing and handlers: `!help`, `!stations`, `!play`, `!stop`
- **`src/interactions.ts`** – Button handlers: station play buttons and stations list prev/next pagination
- **`src/voice.ts`** – Voice connections and audio: one player + connection **per guild** (keyed by guild ID), stream resource, join/leave, disconnect handling
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
