import type { ButtonInteraction, VoiceBasedChannel } from 'discord.js';
import {
  STATIONS_NEXT_ID,
  STATIONS_PLAY_PREFIX,
  STATIONS_PREV_ID,
} from './constants.js';
import { loadStations } from './radioList.js';
import {
  buildStationsPageContent,
  buildStationsPaginationRow,
  buildStationsPlayRows,
} from './stationsUI.js';
import { joinVoiceAndPlayStation } from './voice.js';

export function getStationsButtonType(customId: string): 'play' | 'prev' | 'next' | null {
  if (customId.startsWith(STATIONS_PLAY_PREFIX)) return 'play';
  if (customId === STATIONS_PREV_ID) return 'prev';
  if (customId === STATIONS_NEXT_ID) return 'next';
  return null;
}

export async function handleStationsPlayButton(
  interaction: ButtonInteraction,
  globalIndex: number
): Promise<void> {
  const guild = interaction.guild!;
  const userTag = interaction.user?.tag ?? 'unknown';

  console.log(`[COMMAND] Button: play station #${globalIndex} | Server: ${guild.name} (${guild.id}) | User: ${userTag}`);

  const voiceChannel =
    interaction.member && 'voice' in interaction.member
      ? (interaction.member.voice?.channel as VoiceBasedChannel | undefined) ?? null
      : null;

  if (!voiceChannel) {
    await interaction.reply({
      content: 'Join a voice channel first, then click the play button.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const stations = await loadStations();
  if (globalIndex > stations.length) {
    await interaction.editReply(`Station #${globalIndex} is not available.`);
    return;
  }

  const station = stations[globalIndex - 1];
  const result = await joinVoiceAndPlayStation(guild, voiceChannel, station);

  if (!result.success) {
    await interaction.editReply(result.error);
    return;
  }

  console.log(`[VOICE JOIN] Server: ${guild.name} (${guild.id}) | Channel: ${voiceChannel.name} (${voiceChannel.id}) | Station: ${station.name}`);
  await interaction.editReply(
    `Joining **${voiceChannel.name}** and playing **${station.name}**.`
  );
}

export async function handleStationsPagination(
  interaction: ButtonInteraction,
  direction: 'prev' | 'next'
): Promise<void> {
  const guild = interaction.guild!;
  const navLabel = direction === 'next' ? 'next' : 'prev';
  console.log(`[COMMAND] Button: stations ${navLabel} | Server: ${guild.name} (${guild.id}) | User: ${interaction.user?.tag ?? 'unknown'}`);

  const msg = interaction.message;
  if (!msg.editable) return;

  const match = msg.content.match(/page\s+(\d+)\s*\/\s*(\d+)/i);
  if (!match) return;

  const currentPage = parseInt(match[1], 10);
  const totalPages = parseInt(match[2], 10);
  const nextPage = direction === 'next'
    ? Math.min(currentPage + 1, totalPages)
    : Math.max(currentPage - 1, 1);

  await interaction.deferUpdate();

  const stations = await loadStations();
  const { content } = buildStationsPageContent(stations, nextPage);
  const playRows = buildStationsPlayRows(stations, nextPage);
  const paginationRow = buildStationsPaginationRow(nextPage, totalPages);
  await msg.edit({
    content,
    components: [...playRows, paginationRow],
  });
}
