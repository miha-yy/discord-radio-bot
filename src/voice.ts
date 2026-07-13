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
import { sendRadioBrowserClick, type RadioBrowserStation } from './radioBrowser.js';
import type { YouTubeTrack } from './youtube.js';
import {
  getGuildSettings,
  updateGuildSettings,
  recordPlay,
  recordListening,
  DEFAULT_VOLUME,
} from './storage.js';

/** What a guild is currently playing: a stations.txt station, a station found
 * via radio-browser.info, or a YouTube video/livestream resolved by yt-dlp. */
export type PlaySource =
  | { kind: 'station'; station: RadioStation }
  | { kind: 'radio-browser'; station: RadioBrowserStation }
  | { kind: 'youtube'; track: YouTubeTrack };

export function sourceName(source: PlaySource): string {
  return source.kind === 'youtube' ? source.track.title : source.station.name;
}

export function sourceStreamUrl(source: PlaySource): string {
  if (source.kind === 'youtube') return source.track.streamUrl;
  return source.kind === 'station' ? source.station.stream_url : source.station.streamUrl;
}

/** Live sources (radio, YouTube livestreams) get auto-restarted when they
 * drop; a normal YouTube video ending is just the track finishing. */
export function sourceIsLive(source: PlaySource): boolean {
  return source.kind === 'youtube' ? source.track.isLive : true;
}

export interface GuildVoiceSession {
  connection: VoiceConnection;
  player: AudioPlayer;
  source: PlaySource;
  guild: Guild;
  channelId: string;
  /** Text channel that started playback; used for drop/finish notifications. */
  notifyChannelId: string | null;
  volume: number;
  startedAt: number;
  aloneTimer: ReturnType<typeof setTimeout> | null;
  sleepTimer: ReturnType<typeof setTimeout> | null;
  sleepUntil: number | null;
  restartAttempts: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  stableTimer: ReturnType<typeof setTimeout> | null;
  /** Set while we deliberately stop/swap the stream so the watchdog does not
   * mistake it for a dropped stream. */
  expectIdle: boolean;
  /** Last few FFmpeg stderr lines, for user-facing failure messages. */
  lastStderr: string;
}

/**
 * One voice session per guild. A bot user can be connected to a single voice
 * channel within a guild, but to many guilds at the same time, so we key each
 * connection + player by guild ID rather than sharing one global connection.
 */
const sessions = new Map<string, GuildVoiceSession>();

/** Leave a voice channel after being alone (no human listeners) this long. */
const ALONE_TIMEOUT_MS = 5 * 60 * 1000;

/** Auto-restart a dropped live stream this many times before giving up. */
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAYS_MS = [2000, 5000, 10000];
/** Consider a stream healthy again after playing this long, resetting the
 * restart budget so a hiccup hours later gets a fresh set of retries. */
const STABLE_AFTER_MS = 60 * 1000;

function clearAloneTimer(session: GuildVoiceSession): void {
  if (session.aloneTimer) {
    clearTimeout(session.aloneTimer);
    session.aloneTimer = null;
  }
}

function clearSessionTimers(session: GuildVoiceSession): void {
  clearAloneTimer(session);
  for (const key of ['sleepTimer', 'restartTimer', 'stableTimer'] as const) {
    const timer = session[key];
    if (timer) clearTimeout(timer);
    session[key] = null;
  }
  session.sleepUntil = null;
}

/** Send a message to the text channel that started playback, if we can. */
function notify(session: GuildVoiceSession, message: string): void {
  if (!session.notifyChannelId) return;
  const channel = session.guild.channels.cache.get(session.notifyChannelId);
  if (channel && channel.isTextBased()) {
    channel.send(message).catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[${session.guild.id}] Failed to notify channel: ${error.message}`);
    });
  }
}

/** Fold finished listening time into the per-station stats. */
function recordSessionStats(session: GuildVoiceSession): void {
  if (session.source.kind === 'youtube') return;
  const seconds = (Date.now() - session.startedAt) / 1000;
  recordListening(sourceName(session.source), seconds);
}

function createPlayer(guildId: string): AudioPlayer {
  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
      maxMissedFrames: 150,
    },
  });

  player.on('stateChange', (oldState, newState) => {
    // Only act if this player still belongs to the guild's current session
    // (a newer !play may have replaced it).
    const session = sessions.get(guildId);
    const isCurrent = session?.player === player;

    switch (newState.status) {
      case AudioPlayerStatus.Playing:
        if (oldState.status !== AudioPlayerStatus.Playing) {
          console.log(`[${guildId}] Playing stream (was: ${oldState.status})`);
          if (isCurrent && session) {
            session.expectIdle = false;
            if (session.stableTimer) clearTimeout(session.stableTimer);
            session.stableTimer = setTimeout(() => {
              const current = sessions.get(guildId);
              if (current === session) current.restartAttempts = 0;
            }, STABLE_AFTER_MS);
          }
        }
        break;
      case AudioPlayerStatus.Idle: {
        const playedMs = 'resource' in oldState ? oldState.resource.playbackDuration : null;
        console.log(
          `[${guildId}] Stream ended (was: ${oldState.status}, played ${playedMs ?? '?'} ms)`
        );
        if (isCurrent && session && !session.expectIdle) {
          handleStreamDrop(session);
        }
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

/**
 * The stream ended without us stopping it. For live sources, retry with
 * backoff and tell the text channel if we give up; a non-live YouTube video
 * ending is normal — announce it and leave.
 */
function handleStreamDrop(session: GuildVoiceSession): void {
  const guildId = session.guild.id;
  const name = sourceName(session.source);

  if (!sourceIsLive(session.source)) {
    console.log(`[${guildId}] Finished playing "${name}"`);
    notify(session, `Finished playing **${name}**. Leaving the voice channel — use \`!play\` or \`!yt\` to start something new.`);
    stopAndLeave(guildId);
    return;
  }

  session.restartAttempts += 1;
  if (session.restartAttempts > MAX_RESTART_ATTEMPTS) {
    console.error(`[${guildId}] Stream for "${name}" dropped; giving up after ${MAX_RESTART_ATTEMPTS} restarts`);
    const stderrHint = session.lastStderr ? `\n\`\`\`${session.lastStderr.slice(-300)}\`\`\`` : '';
    notify(
      session,
      `⚠️ The stream for **${name}** keeps dropping and could not be restarted ` +
        `(the station may be down or geo-blocked). Use \`!play\` to try again.${stderrHint}`
    );
    stopAndLeave(guildId);
    return;
  }

  const delay = RESTART_DELAYS_MS[Math.min(session.restartAttempts - 1, RESTART_DELAYS_MS.length - 1)];
  console.log(`[${guildId}] Stream for "${name}" dropped — restart ${session.restartAttempts}/${MAX_RESTART_ATTEMPTS} in ${delay} ms`);
  session.restartTimer = setTimeout(() => {
    const current = sessions.get(guildId);
    if (current !== session) return;
    session.restartTimer = null;
    try {
      session.player.play(createStreamResource(session));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[${guildId}] Restart failed: ${error.message}`);
      handleStreamDrop(session);
    }
  }, delay);
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

export function buildFfmpegArgs(streamUrl: string, volumePercent: number = DEFAULT_VOLUME): string[] {
  const args = [
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
  ];
  // Volume is applied in FFmpeg (not inlineVolume) so steady-state playback
  // stays cheap; changing volume restarts the pipeline with new args.
  if (volumePercent !== 100) {
    args.push('-af', `volume=${(volumePercent / 100).toFixed(2)}`);
  }
  args.push('-f', 'opus', '-ar', '48000', '-ac', '2');
  return args;
}

function createStreamResource(session: GuildVoiceSession) {
  const guildId = session.guild.id;
  const streamUrl = sourceStreamUrl(session.source);
  const ffmpeg = new prism.FFmpeg({
    args: buildFfmpegArgs(streamUrl, session.volume),
  });

  // Surface FFmpeg's own errors (HTTP 403, geo-blocks, TLS failures, …) in
  // the logs and keep the tail for user-facing failure messages.
  ffmpeg.process.stderr?.on('data', (chunk: Buffer) => {
    const message = chunk.toString().trim();
    if (message) {
      console.error(`[${guildId}] [ffmpeg] ${message}`);
      session.lastStderr = `${session.lastStderr}\n${message}`.slice(-500);
    }
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
        recordSessionStats(session);
        clearSessionTimers(session);
        sessions.delete(guildId);
      }
    }
  });
}

export async function joinVoiceAndPlay(
  guild: Guild,
  voiceChannel: VoiceBasedChannel,
  source: PlaySource,
  notifyChannelId: string | null = null
): Promise<{ success: true; connection: VoiceConnection } | { success: false; error: string }> {
  // Replace any existing session in THIS guild (switch station or channel).
  // Sessions in other guilds are left untouched so playback continues there.
  const existing = sessions.get(guild.id);
  if (existing) {
    recordSessionStats(existing);
    clearSessionTimers(existing);
    existing.expectIdle = true;
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

  const settings = getGuildSettings(guild.id);
  const session: GuildVoiceSession = {
    connection,
    player,
    source,
    guild,
    channelId: voiceChannel.id,
    notifyChannelId,
    volume: settings.volume,
    startedAt: Date.now(),
    aloneTimer: null,
    sleepTimer: null,
    sleepUntil: null,
    restartAttempts: 0,
    restartTimer: null,
    stableTimer: null,
    expectIdle: false,
    lastStderr: '',
  };
  sessions.set(guild.id, session);

  player.play(createStreamResource(session));
  connection.subscribe(player);

  if (source.kind === 'station') {
    recordPlay(source.station.name);
    updateGuildSettings(guild.id, { lastStation: source.station.name });
  } else if (source.kind === 'radio-browser') {
    recordPlay(source.station.name);
    sendRadioBrowserClick(source.station.uuid);
  }

  // Start the alone-countdown immediately in case the inviting user already
  // left while we were connecting.
  updateAloneState(guild);
  return { success: true, connection };
}

/** Back-compat wrapper for playing a stations.txt station. */
export async function joinVoiceAndPlayStation(
  guild: Guild,
  voiceChannel: VoiceBasedChannel,
  station: RadioStation,
  notifyChannelId: string | null = null
): Promise<{ success: true; connection: VoiceConnection } | { success: false; error: string }> {
  return joinVoiceAndPlay(guild, voiceChannel, { kind: 'station', station }, notifyChannelId);
}

/**
 * Change playback volume for the guild's current session by restarting the
 * FFmpeg pipeline with a volume filter. Returns false when nothing plays.
 * (The persisted per-guild setting is updated by the caller.)
 */
export function setSessionVolume(guildId: string, volumePercent: number): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;
  session.volume = volumePercent;
  session.expectIdle = true;
  session.player.play(createStreamResource(session));
  return true;
}

/** Arm (minutes > 0) or cancel (null) the guild's sleep timer. */
export function setSleepTimer(guildId: string, minutes: number | null): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;

  if (session.sleepTimer) {
    clearTimeout(session.sleepTimer);
    session.sleepTimer = null;
    session.sleepUntil = null;
  }
  if (minutes === null) return true;

  session.sleepUntil = Date.now() + minutes * 60 * 1000;
  session.sleepTimer = setTimeout(() => {
    const current = sessions.get(guildId);
    if (current !== session) return;
    console.log(`[${guildId}] Sleep timer elapsed — stopping playback`);
    notify(session, `😴 Sleep timer: stopping **${sourceName(session.source)}** and leaving the voice channel. Good night!`);
    stopAndLeave(guildId);
  }, minutes * 60 * 1000);
  return true;
}

/**
 * Re-evaluate whether the bot is alone (no human listeners) in its channel for
 * the given guild, and start/cancel the idle-disconnect timer accordingly.
 * Safe to call on every voiceStateUpdate; a no-op when there is no session.
 */
export function updateAloneState(guild: Guild): void {
  const session = sessions.get(guild.id);
  if (!session) return;

  // 24/7 mode: never leave just because the channel is empty.
  if (getGuildSettings(guild.id).alwaysOn) {
    clearAloneTimer(session);
    return;
  }

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

  recordSessionStats(session);
  clearSessionTimers(session);
  const channelId = session.connection.joinConfig.channelId ?? 'unknown';
  console.log(`[VOICE LEAVE] Server ID: ${guildId} | Channel ID: ${channelId}`);
  session.expectIdle = true;
  session.player.stop();
  session.connection.destroy();
  sessions.delete(guildId);
  return true;
}
