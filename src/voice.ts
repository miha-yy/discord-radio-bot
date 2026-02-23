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

const player: AudioPlayer = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Play,
    maxMissedFrames: 150,
  },
});

let currentConnection: VoiceConnection | null = null;

player.on('stateChange', (oldState, newState) => {
  switch (newState.status) {
    case AudioPlayerStatus.Playing:
      if (oldState.status === AudioPlayerStatus.Idle) {
        console.log('Playing radio stream');
      }
      break;
    case AudioPlayerStatus.Idle:
      console.log('Stream stopped or error – will not auto-restart (use !play again if needed)');
      break;
    default:
      break;
  }
});

player.on('error', (err: Error) => {
  console.error('AudioPlayer error:', err.message);
});

export function getPlayer(): AudioPlayer {
  return player;
}

export function getCurrentConnection(): VoiceConnection | null {
  return currentConnection;
}

function createStreamResource(streamUrl: string) {
  const ffmpeg = new prism.FFmpeg({
    args: [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-i', streamUrl,
      '-acodec', 'libopus',
      '-f', 'opus',
      '-ar', '48000',
      '-ac', '2',
    ],
  });

  return createAudioResource(ffmpeg, {
    inputType: StreamType.OggOpus,
    inlineVolume: false,
  });
}

function playStream(connection: VoiceConnection, station: RadioStation): void {
  const resource = createStreamResource(station.stream_url);
  player.play(resource);
  connection.subscribe(player);
}

function setupVoiceDisconnectHandler(connection: VoiceConnection): void {
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
      currentConnection = null;
    }
  });
}

export async function joinVoiceAndPlayStation(
  guild: Guild,
  voiceChannel: VoiceBasedChannel,
  station: RadioStation
): Promise<{ success: true; connection: VoiceConnection } | { success: false; error: string }> {
  if (currentConnection) {
    currentConnection.destroy();
    currentConnection = null;
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    daveEncryption: false,
  });

  currentConnection = connection;

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('Voice connection failed:', error.message);
    connection.destroy();
    currentConnection = null;
    return { success: false, error: 'Failed to join the voice channel. Try again.' };
  }

  setupVoiceDisconnectHandler(connection);
  playStream(connection, station);
  return { success: true, connection };
}

export function stopAndLeave(): void {
  if (!currentConnection) return;
  const joinConfig = currentConnection.joinConfig;
  const channelId = joinConfig.channelId ?? 'unknown';
  const guildId = joinConfig.guildId ?? 'unknown';
  console.log(`[VOICE LEAVE] Server ID: ${guildId} | Channel ID: ${channelId}`);
  player.stop();
  currentConnection.destroy();
  currentConnection = null;
}
