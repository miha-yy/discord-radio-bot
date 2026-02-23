import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {
  BUTTONS_PER_ROW,
  STATIONS_NEXT_ID,
  STATIONS_PER_PAGE,
  STATIONS_PREV_ID,
  STATIONS_PLAY_PREFIX,
} from './constants.js';
import type { RadioStation } from './radioList.js';

export function buildStationsPageContent(
  stations: RadioStation[],
  page: number
): { content: string; totalPages: number } {
  const totalPages = Math.ceil(stations.length / STATIONS_PER_PAGE) || 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * STATIONS_PER_PAGE;
  const slice = stations.slice(start, start + STATIONS_PER_PAGE);
  const lines = slice.map(
    (s, i) => `${start + i + 1}. **${s.name}** \`${s.hashtag ?? start + i + 1}\``
  );
  const content = [
    `📻 **Stations (page ${safePage}/${totalPages})**`,
    lines.join('\n'),
    '',
    'Use `!play <number>` or `!play <name/hashtag>` to play.',
  ].join('\n');
  return { content, totalPages };
}

export function buildStationsPaginationRow(page: number, totalPages: number): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(STATIONS_PREV_ID)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(STATIONS_NEXT_ID)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages)
  );
  return row;
}

export function buildStationsPlayRows(
  stations: RadioStation[],
  page: number
): ActionRowBuilder<ButtonBuilder>[] {
  const totalPages = Math.ceil(stations.length / STATIONS_PER_PAGE) || 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * STATIONS_PER_PAGE;
  const slice = stations.slice(start, start + STATIONS_PER_PAGE);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let r = 0; r < slice.length; r += BUTTONS_PER_ROW) {
    const rowStations = slice.slice(r, r + BUTTONS_PER_ROW);
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let i = 0; i < rowStations.length; i++) {
      const globalIndex = start + r + i + 1;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${STATIONS_PLAY_PREFIX}${globalIndex}`)
          .setLabel(`▶ ${globalIndex}`)
          .setStyle(ButtonStyle.Success)
      );
    }
    rows.push(row);
  }
  return rows;
}
