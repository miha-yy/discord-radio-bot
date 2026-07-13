import type { ButtonInteraction } from 'discord.js';
import {
  RB_PLAY_PREFIX,
  STATIONS_NEXT_ID,
  STATIONS_PLAY_PREFIX,
  STATIONS_PREV_ID,
} from './constants.js';
import { loadStations } from './radioList.js';
import {
  toEntries,
  filterStations,
  buildStationsPageContent,
  buildStationsPaginationRow,
  buildStationsPlayRows,
} from './stationsUI.js';
import {
  startPlayback,
  radioPlayAction,
  type CommandContext,
  type ReplyPayload,
} from './actions.js';

export type ButtonAction = 'play' | 'prev' | 'next' | 'rbplay';

export function getButtonAction(customId: string): ButtonAction | null {
  if (customId.startsWith(STATIONS_PLAY_PREFIX)) return 'play';
  if (customId.startsWith(RB_PLAY_PREFIX)) return 'rbplay';
  if (customId === STATIONS_PREV_ID) return 'prev';
  if (customId === STATIONS_NEXT_ID) return 'next';
  return null;
}

function contextFromButton(interaction: ButtonInteraction<'cached'>): CommandContext {
  return {
    guild: interaction.guild,
    member: interaction.member,
    channelId: interaction.channelId,
    userTag: interaction.user.tag,
    reply: async (payload: string | ReplyPayload) => {
      await interaction.editReply(payload);
    },
  };
}

export async function handleStationsPlayButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  const globalIndex = parseInt(interaction.customId.slice(STATIONS_PLAY_PREFIX.length), 10);
  if (!Number.isFinite(globalIndex) || globalIndex < 1) return;

  console.log(`[COMMAND] Button: play station #${globalIndex} | Server: ${interaction.guild.name} (${interaction.guild.id}) | User: ${interaction.user.tag}`);
  await interaction.deferReply();

  const stations = await loadStations();
  if (globalIndex > stations.length) {
    await interaction.editReply(`Station #${globalIndex} is not available.`);
    return;
  }
  await startPlayback(contextFromButton(interaction), {
    kind: 'station',
    station: stations[globalIndex - 1],
  });
}

export async function handleRadioBrowserPlayButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  const uuid = interaction.customId.slice(RB_PLAY_PREFIX.length);
  await interaction.deferReply();
  await radioPlayAction(contextFromButton(interaction), uuid);
}

export async function handleStationsPagination(
  interaction: ButtonInteraction,
  direction: 'prev' | 'next'
): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  console.log(`[COMMAND] Button: stations ${direction} | Server: ${interaction.guild.name} (${interaction.guild.id}) | User: ${interaction.user.tag}`);

  const msg = interaction.message;
  if (!msg.editable) return;

  // Page and filter are re-derived from the header line the list was
  // rendered with (see buildStationsPageContent).
  const pageMatch = msg.content.match(/page\s+(\d+)\s*\/\s*(\d+)/i);
  if (!pageMatch) return;
  const filterMatch = msg.content.match(/matching\s+`(.+?)`/i);
  const filter = filterMatch?.[1] ?? '';

  const currentPage = parseInt(pageMatch[1], 10);
  const totalPages = parseInt(pageMatch[2], 10);
  const nextPage = direction === 'next'
    ? Math.min(currentPage + 1, totalPages)
    : Math.max(currentPage - 1, 1);

  await interaction.deferUpdate();

  const stations = await loadStations();
  const entries = filter ? filterStations(stations, filter) : toEntries(stations);
  const { content, totalPages: newTotal } = buildStationsPageContent(entries, nextPage, filter || undefined);
  await msg.edit({
    content,
    components: [
      ...buildStationsPlayRows(entries, nextPage),
      buildStationsPaginationRow(nextPage, newTotal),
    ],
  });
}
