import type { Guild, Message, VoiceBasedChannel } from 'discord.js';
import { loadStations, findStation } from './radioList.js';
import {
  buildStationsPageContent,
  buildStationsPaginationRow,
  buildStationsPlayRows,
} from './stationsUI.js';
import { getCurrentConnection, joinVoiceAndPlayStation, stopAndLeave } from './voice.js';
import { HELP_TEXT } from './constants.js';

export function getCommand(commandStr: string): 'help' | 'stations' | 'play' | 'stop' | null {
  const lower = commandStr.trim().toLowerCase();
  if (lower === '!help') return 'help';
  if (lower === '!stations' || lower.startsWith('!stations ')) return 'stations';
  if (lower === '!play' || lower.startsWith('!play ')) return 'play';
  if (lower === '!stop') return 'stop';
  return null;
}

function logCommand(command: string, guild: Guild, channelIdOrName: string, userTag: string): void {
  console.log(`[COMMAND] ${command} | Server: ${guild.name} (${guild.id}) | Channel: ${channelIdOrName} | User: ${userTag}`);
}

export async function handleHelp(message: Message, guild: Guild): Promise<void> {
  const channelName = (message.channel as { name?: string }).name ?? message.channel.id;
  logCommand('!help', guild, channelName, message.author.tag);
  await message.reply(HELP_TEXT);
}

export async function handleStations(message: Message, content: string, guild: Guild): Promise<void> {
  const pageArg = content.slice('!stations'.length).trim();
  const page = pageArg ? Math.max(1, parseInt(pageArg, 10) || 1) : 1;
  const channelName = (message.channel as { name?: string }).name ?? message.channel.id;
  logCommand(`!stations (page ${page})`, guild, channelName, message.author.tag);

  const stations = await loadStations();
  const { content: text, totalPages } = buildStationsPageContent(stations, page);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const playRows = buildStationsPlayRows(stations, safePage);
  const paginationRow = buildStationsPaginationRow(safePage, totalPages);

  await message.reply({
    content: text,
    components: [...playRows, paginationRow],
  });
}

export async function handlePlay(message: Message, content: string, guild: Guild): Promise<void> {
  const voiceChannel: VoiceBasedChannel | null = message.member?.voice?.channel ?? null;
  const query = content.slice('!play'.length).trim();

  logCommand(`!play ${query || '(no args)'}`, guild, message.channel.id, message.author.tag);

  if (!voiceChannel) {
    await message.reply('Join a voice channel first, then use `!play`.');
    return;
  }

  const stations = await loadStations();
  const station = query ? findStation(stations, query) : undefined;

  if (query && !station) {
    await message.reply(
      `Station not found: \`${query}\`. Use \`!stations\` to list and \`!play <number or name>\` to play.`
    );
    return;
  }

  if (!station) {
    await message.reply(
      'Usage: `!play <number>` or `!play <station name/hashtag>`. Use `!stations` to see the list.'
    );
    return;
  }

  const result = await joinVoiceAndPlayStation(guild, voiceChannel, station);

  if (!result.success) {
    await message.reply(result.error);
    return;
  }

  console.log(`[VOICE JOIN] Server: ${guild.name} (${guild.id}) | Channel: ${voiceChannel.name} (${voiceChannel.id}) | Station: ${station.name}`);
  await message.reply(`Joining **${voiceChannel.name}** and playing **${station.name}**.`);
}

export async function handleStop(message: Message, guild: Guild): Promise<void> {
  logCommand('!stop', guild, message.channel.id, message.author.tag);

  if (!getCurrentConnection()) {
    await message.reply('I am not in a voice channel.');
    return;
  }

  stopAndLeave();
  await message.reply('Stopped and left the voice channel.');
}
