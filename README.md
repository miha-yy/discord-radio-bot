# Discord Radio Bot

A Discord bot that joins a voice channel and plays the **BestFM** live stream from `https://live.radio.si/BestFM`.

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
   - Copy `.env.example` to `.env`
   - Set `DISCORD_TOKEN` to your bot token

4. **Invite the bot**
   - Use the generated invite URL from the Developer Portal to add the bot to your server

## Usage

- **`!play`** – Bot joins your current voice channel and starts playing BestFM.
- **`!stop`** – Bot stops playback and leaves the voice channel.

## Run

```bash
npm start
```

Make sure FFmpeg is installed (`ffmpeg -version` works in your terminal).
