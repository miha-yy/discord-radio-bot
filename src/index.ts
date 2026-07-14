import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { handleMessageCommand } from './commands.js';
import {
  getButtonAction,
  handleStationsPlayButton,
  handleRadioBrowserPlayButton,
  handleStationsPagination,
} from './interactions.js';
import { loadStations } from './radioList.js';
import { updateAloneState } from './voice.js';
import { startHealthServer } from './server.js';
import { initStorage } from './storage.js';
import { registerSlashCommands, handleChatInputCommand, handleAutocomplete } from './slash.js';

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
  await handleMessageCommand(message);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleChatInputCommand(interaction);
    return;
  }
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction);
    return;
  }
  if (!interaction.isButton() || !interaction.guild) return;

  const action = getButtonAction(interaction.customId);
  try {
    switch (action) {
      case 'play':
        await handleStationsPlayButton(interaction);
        break;
      case 'rbplay':
        await handleRadioBrowserPlayButton(interaction);
        break;
      case 'prev':
      case 'next':
        await handleStationsPagination(interaction, action);
        break;
      default:
        break;
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[BUTTON] ${interaction.customId} failed:`, error);
    const message = `Something went wrong: ${error.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
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
    console.log('Text commands: !help | !stations | !play | !stop | !np | !search | !radio | !yt | !queue | !skip | !fav | !volume | !sleep | !dj | !247 | !top');
    console.log('Fun commands: !whois | !ship | !rate | !8ball | !choose | !roll | !flip');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('Failed to load stations:', error.message);
    process.exit(1);
  }

  try {
    await registerSlashCommands(client as Client<true>);
  } catch (err) {
    // Slash registration failing (e.g. missing applications.commands scope)
    // should not take the bot down — text commands still work.
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('Failed to register slash commands:', error.message);
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN. Set it in .env or environment.');
  process.exit(1);
}

await initStorage();

// Bind to PORT before logging in so Render's health check passes even while
// the Discord connection is still being established.
startHealthServer(() => client.isReady());

client.login(token).catch((err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error('Login failed:', error);
  process.exit(1);
});
