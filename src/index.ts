import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { getCommand, handleHelp, handleStations, handlePlay, handleStop } from './commands.js';
import { getStationsButtonType, handleStationsPlayButton, handleStationsPagination } from './interactions.js';
import { loadStations } from './radioList.js';
import { STATIONS_PLAY_PREFIX } from './constants.js';
import { updateAloneState } from './voice.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const command = getCommand(content);
  const guild = message.guild;

  switch (command) {
    case 'help':
      await handleHelp(message, guild);
      break;
    case 'stations':
      try {
        await handleStations(message, content, guild);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        await message.reply(`Could not load stations: ${error.message}`);
      }
      break;
    case 'play':
      try {
        await handlePlay(message, content, guild);
      } catch (err) {
        console.error(err);
        await message.reply('Something went wrong. Make sure FFmpeg is installed and stations are loaded.');
      }
      break;
    case 'stop':
      await handleStop(message, guild);
      break;
    default:
      break;
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton() || !interaction.guild) return;

  const { customId } = interaction;
  const buttonType = getStationsButtonType(customId);

  switch (buttonType) {
    case 'play': {
      const indexStr = customId.slice(STATIONS_PLAY_PREFIX.length);
      const globalIndex = parseInt(indexStr, 10);
      if (!Number.isFinite(globalIndex) || globalIndex < 1) return;
      try {
        await handleStationsPlayButton(interaction, globalIndex);
      } catch (err) {
        console.error(err);
        await interaction.editReply(
          'Something went wrong. Make sure FFmpeg is installed and stations are loaded.'
        ).catch(() => {});
      }
      break;
    }
    case 'prev':
    case 'next':
      try {
        await handleStationsPagination(interaction, buttonType);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        await interaction.followUp({ content: `Could not load stations: ${error.message}`, ephemeral: true }).catch(() => {});
      }
      break;
    default:
      break;
  }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  // Any join/leave/move in a guild where we're playing may change whether the
  // bot is alone in its channel; re-evaluate the idle-disconnect timer.
  const guild = newState.guild ?? oldState.guild;
  if (guild) updateAloneState(guild);
});

client.once('clientReady', async () => {
  if (!client.user) return;
  try {
    const stations = await loadStations();
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Loaded ${stations.length} stations from stations.txt`);
    console.log('Commands: !help | !stations [page] | !play [station name/number] | !stop');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('Failed to load stations:', error.message);
    process.exit(1);
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
