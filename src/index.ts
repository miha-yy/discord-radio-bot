import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  type Guild,
  type VoiceBasedChannel,
} from 'discord.js';
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

const STREAM_URL = 'https://live.radio.si/BestFM';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

const player: AudioPlayer = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Play,
    maxMissedFrames: 150,
  },
});

let currentConnection: VoiceConnection | null = null;

function createStreamResource() {
  const ffmpeg = new prism.FFmpeg({
    args: [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-i', STREAM_URL,
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

function playStream(connection: VoiceConnection): void {
  const resource = createStreamResource();
  player.play(resource);
  connection.subscribe(player);
}

player.on('stateChange', (oldState, newState) => {
  if (oldState.status === AudioPlayerStatus.Idle && newState.status === AudioPlayerStatus.Playing) {
    console.log('Playing BestFM stream');
  }
  if (newState.status === AudioPlayerStatus.Idle) {
    console.log('Stream stopped or error – will not auto-restart (use !play again if needed)');
  }
});

player.on('error', (err: Error) => {
  console.error('AudioPlayer error:', err.message);
});

client.once('clientReady', () => {
  if (!client.user) return;
  console.log(`Logged in as ${client.user.tag}`);
  console.log('Commands: !play (join and play), !stop (stop and leave)');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim().toLowerCase();
  const guild: Guild = message.guild;

  if (content === '!play') {
    const voiceChannel: VoiceBasedChannel | null = message.member?.voice?.channel ?? null;
    if (!voiceChannel) {
      await message.reply('Join a voice channel first, then use `!play`.');
      return;
    }

    try {
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
        await message.reply('Failed to join the voice channel. Try again.');
        return;
      }

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

      playStream(connection);
      await message.reply(`Joining **${voiceChannel.name}** and playing BestFM.`);
    } catch (err) {
      console.error(err);
      await message.reply('Something went wrong. Make sure FFmpeg is installed and the stream URL is reachable.');
    }
    return;
  }

  if (content === '!stop') {
    if (!currentConnection) {
      await message.reply('I am not in a voice channel.');
      return;
    }
    player.stop();
    currentConnection.destroy();
    currentConnection = null;
    await message.reply('Stopped and left the voice channel.');
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN. Set it in .env or environment.');
  process.exit(1);
}

client.login(token).catch((err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error('Login failed:', error);
  process.exit(1);
});
