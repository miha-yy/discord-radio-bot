import prism from 'prism-media';
import {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice';
import type { Guild, VoiceBasedChannel } from 'discord.js';
import type { RadioStation } from './radioList.js';

interface GuildVoiceSession {
  connection: VoiceConnection;
  player: AudioPlayer;
  station: RadioStation;
  channelId: string;
  aloneTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * One voice session per guild. A bot user can be connected to a single voice
 * channel within a guild, but to many guilds at the same time, so we key each
 * connection + player by guild ID rather than sharing one global connection.
 */
const sessions = new Map<string, GuildVoiceSession>();

/** Leave a voice channel after being alone (no human listeners) this long. */
const ALONE_TIMEOUT_MS = 5 * 60 * 1000;

function clearAloneTimer(session: GuildVoiceSession): void {
  if (session.aloneTimer) {
    clearTimeout(session.aloneTimer);
    session.aloneTimer = null;
  }
}

function createPlayer(guildId: string): AudioPlayer {
  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
      maxMissedFrames: 150,
    },
  });

  player.on('stateChange', (oldState, newState) => {
    switch (newState.status) {
      case AudioPlayerStatus.Playing:
        if (oldState.status !== AudioPlayerStatus.Playing) {
          console.log(`[${guildId}] Playing radio stream (was: ${oldState.status})`);
        }
        break;
      case AudioPlayerStatus.Idle: {
        const playedMs = 'resource' in oldState ? oldState.resource.playbackDuration : null;
        console.log(
          `[${guildId}] Stream stopped or error (was: ${oldState.status}, played ${playedMs ?? '?'} ms) – will not auto-restart (use !play again if needed)`
        );
        break;
      }
      default:
        break;
    }
  });

  player.on('error', (err: Error) => {
    console.error(`[${guildId}] AudioPlayer error:`, err.message);
  });

  return player;
}

export function getConnection(guildId: string): VoiceConnection | null {
  return sessions.get(guildId)?.connection ?? null;
}

export function getSession(guildId: string): GuildVoiceSession | null {
  return sessions.get(guildId) ?? null;
}

export function getActiveGuildCount(): number {
  return sessions.size;
}

function createStreamResource(guildId: string, streamUrl: string) {
  const ffmpeg = new prism.FFmpeg({
    args: [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-analyzeduration', '0',
      '-loglevel', 'error',
      // Some stations reject ffmpeg's default "Lavf/..." user agent.
      '-user_agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      '-i', streamUrl,
      '-acodec', 'libopus',
      // Cheapest encoder setting: essential on tiny cloud instances (e.g.
      // Render free tier's 0.1 vCPU) where the default (10) can't keep up
      // with real time, starving the player until it idles out.
      '-compression_level', '0',
      '-f', 'opus',
      '-ar', '48000',
      '-ac', '2',
    ],
  });

  // Surface FFmpeg's own errors (HTTP 403, geo-blocks, TLS failures, …) in the
  // logs; with '-loglevel 0' a dead stream just ended silently.
  ffmpeg.process.stderr?.on('data', (chunk: Buffer) => {
    const message = chunk.toString().trim();
    if (message) console.error(`[${guildId}] [ffmpeg] ${message}`);
  });
  // code 0 = the server ended the stream (a live stream should never end);
  // null + signal = ffmpeg was killed, usually because the player idled first.
  ffmpeg.process.on('close', (code, signal) => {
    console.log(`[${guildId}] [ffmpeg] process closed (code=${code}, signal=${signal}, stream: ${streamUrl})`);
  });

  return createAudioResource(ffmpeg, {
    inputType: StreamType.OggOpus,
    inlineVolume: false,
  });
}

function setupVoiceDisconnectHandler(guildId: string, connection: VoiceConnection): void {
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
      // Only clear the map entry if it still refers to this connection; a newer
      // !play in the same guild may have already replaced it.
      const session = sessions.get(guildId);
      if (session?.connection === connection) {
        clearAloneTimer(session);
        sessions.delete(guildId);
      }
    }
  });
}

export async function joinVoiceAndPlayStation(
  guild: Guild,
  voiceChannel: VoiceBasedChannel,
  station: RadioStation
): Promise<{ success: true; connection: VoiceConnection } | { success: false; error: string }> {
  // Replace any existing session in THIS guild (switch station or channel).
  // Sessions in other guilds are left untouched so playback continues there.
  const existing = sessions.get(guild.id);
  if (existing) {
    clearAloneTimer(existing);
    existing.player.stop();
    existing.connection.destroy();
    sessions.delete(guild.id);
  }

  const player = createPlayer(guild.id);

  let connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    daveEncryption: true,
  });

  const readyTimeoutMs = 25_000;
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, readyTimeoutMs);
      lastError = null;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[${guild.id}] Voice connection failed (attempt ${attempt}/${maxAttempts}):`, lastError.message);
      if (attempt < maxAttempts) {
        connection.destroy();
        await new Promise((r) => setTimeout(r, 1500));
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          daveEncryption: true,
        });
      }
    }
  }

  if (lastError) {
    console.error(`[${guild.id}] Voice connection failed:`, lastError.message);
    connection.destroy();
    return { success: false, error: 'Failed to join the voice channel. Try again.' };
  }

  setupVoiceDisconnectHandler(guild.id, connection);
  const resource = createStreamResource(guild.id, station.stream_url);
  player.play(resource);
  connection.subscribe(player);
  sessions.set(guild.id, {
    connection,
    player,
    station,
    channelId: voiceChannel.id,
    aloneTimer: null,
  });
  // Start the alone-countdown immediately in case the inviting user already
  // left while we were connecting.
  updateAloneState(guild);
  return { success: true, connection };
}

/**
 * Re-evaluate whether the bot is alone (no human listeners) in its channel for
 * the given guild, and start/cancel the idle-disconnect timer accordingly.
 * Safe to call on every voiceStateUpdate; a no-op when there is no session.
 */
export function updateAloneState(guild: Guild): void {
  const session = sessions.get(guild.id);
  if (!session) return;

  const channel = guild.channels.cache.get(session.channelId);
  const humanCount =
    channel && channel.isVoiceBased()
      ? channel.members.filter((m) => !m.user.bot).size
      : 0;

  if (humanCount > 0) {
    // Someone is listening — cancel any pending disconnect.
    clearAloneTimer(session);
    return;
  }

  // Bot is alone. Start the countdown if it isn't already running.
  if (!session.aloneTimer) {
    console.log(`[${guild.id}] Alone in voice channel — leaving in ${ALONE_TIMEOUT_MS / 60000} min if no one joins`);
    session.aloneTimer = setTimeout(() => {
      const current = sessions.get(guild.id);
      if (!current) return;
      // Re-check we're still alone before actually leaving.
      const ch = guild.channels.cache.get(current.channelId);
      const stillAlone =
        !ch || !ch.isVoiceBased() || ch.members.filter((m) => !m.user.bot).size === 0;
      if (stillAlone) {
        console.log(`[${guild.id}] Still alone after ${ALONE_TIMEOUT_MS / 60000} min — disconnecting`);
        stopAndLeave(guild.id);
      }
    }, ALONE_TIMEOUT_MS);
  }
}

export function stopAndLeave(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;

  clearAloneTimer(session);
  const channelId = session.connection.joinConfig.channelId ?? 'unknown';
  console.log(`[VOICE LEAVE] Server ID: ${guildId} | Channel ID: ${channelId}`);
  session.player.stop();
  session.connection.destroy();
  sessions.delete(guildId);
  return true;
}
