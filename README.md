# Discord Radio Bot

A Discord bot that joins a voice channel and plays the **BestFM** live stream from `https://live.radio.si/BestFM`. Written in **TypeScript** with full type safety.

## Requirements

- **Node.js** 18 or newer
- **FFmpeg** installed and on your PATH (used to decode the stream and send Opus to Discord)

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

- **`!play`** – Bot joins your current voice channel and starts playing BestFM.
- **`!stop`** – Bot stops playback and leaves the voice channel.

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

Make sure FFmpeg is installed (`ffmpeg -version` works in your terminal).

## Project structure

- **`src/index.ts`** – Bot entry point (TypeScript source)
- **`dist/`** – Compiled JavaScript (created by `npm run build`)
- **`tsconfig.json`** – TypeScript configuration (strict mode, ESM)

## Scripts

| Script    | Description                    |
|----------|---------------------------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start`     | Run the bot (`node dist/index.js`) |
| `npm run dev`   | Build then run the bot         |
