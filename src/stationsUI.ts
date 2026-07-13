import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import {
  BUTTONS_PER_ROW,
  EMBED_COLOR,
  STATIONS_NEXT_ID,
  STATIONS_PER_PAGE,
  STATIONS_PREV_ID,
  STATIONS_PLAY_PREFIX,
} from './constants.js';
import type { RadioStation } from './radioList.js';
import { isStationUnhealthy } from './health.js';

/** A station plus its 1-based position in the FULL list. Filtered views keep
 * the global number so `!play <number>` and play buttons stay stable. */
export interface StationEntry {
  station: RadioStation;
  globalIndex: number;
}

export function toEntries(stations: RadioStation[]): StationEntry[] {
  return stations.map((station, i) => ({ station, globalIndex: i + 1 }));
}

/** Case-insensitive filter over name/hashtag/region/city/type. */
export function filterStations(stations: RadioStation[], filter: string): StationEntry[] {
  const q = filter.trim().toLowerCase().replace(/^#/, '');
  if (!q) return toEntries(stations);
  return toEntries(stations).filter(({ station: s }) =>
    s.name.toLowerCase().includes(q) ||
    s.hashtag?.toLowerCase().includes(q) ||
    s.region?.toLowerCase().includes(q) ||
    s.city?.toLowerCase().includes(q) ||
    s.type?.toLowerCase().includes(q)
  );
}

export function formatStationLine({ station: s, globalIndex }: StationEntry): string {
  const marker = isStationUnhealthy(s.name) ? ' ⚠️' : '';
  return `${globalIndex}. **${s.name}** \`${s.hashtag ?? globalIndex}\`${marker}`;
}

export function buildStationsPageContent(
  entries: StationEntry[],
  page: number,
  filter?: string
): { content: string; totalPages: number } {
  const totalPages = Math.ceil(entries.length / STATIONS_PER_PAGE) || 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * STATIONS_PER_PAGE;
  const slice = entries.slice(start, start + STATIONS_PER_PAGE);
  const lines = slice.map(formatStationLine);
  const anyUnhealthy = slice.some(({ station }) => isStationUnhealthy(station.name));
  // The pagination buttons re-derive page and filter from this header line —
  // keep the `matching \`...\`` and `page X/Y` formats in sync with
  // interactions.ts.
  const header = filter
    ? `📻 **Stations matching \`${filter}\` (page ${safePage}/${totalPages})**`
    : `📻 **Stations (page ${safePage}/${totalPages})**`;
  const content = [
    header,
    lines.join('\n') || '_No stations match._',
    '',
    'Use `!play <number>` or `!play <name/hashtag>` to play.' +
      (anyUnhealthy ? ' ⚠️ = stream was unreachable at the last health check.' : ''),
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
  entries: StationEntry[],
  page: number
): ActionRowBuilder<ButtonBuilder>[] {
  const totalPages = Math.ceil(entries.length / STATIONS_PER_PAGE) || 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * STATIONS_PER_PAGE;
  const slice = entries.slice(start, start + STATIONS_PER_PAGE);
  return buildPlayButtonRows(slice);
}

/** Rows of ▶ buttons (5 per row) that play by global station number. */
export function buildPlayButtonRows(entries: StationEntry[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let r = 0; r < entries.length; r += BUTTONS_PER_ROW) {
    const rowEntries = entries.slice(r, r + BUTTONS_PER_ROW);
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const { globalIndex } of rowEntries) {
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

/** Rich embed for a stations.txt station (used by play confirmations / !np). */
export function buildStationEmbed(station: RadioStation, title: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);
  const details: string[] = [];
  if (station.type) details.push(station.type);
  if (station.region || station.city) {
    details.push([station.city, station.region].filter(Boolean).join(', '));
  }
  if (station.frequencies?.length) details.push(station.frequencies.join(', '));
  if (details.length) embed.setDescription(details.join(' • '));
  if (station.website_url) {
    embed.addFields({ name: 'Website', value: station.website_url, inline: false });
  }
  // Logos in stations.txt are usually bare filenames; only absolute URLs can
  // be used as an embed thumbnail.
  if (station.logo && /^https?:\/\//i.test(station.logo)) {
    embed.setThumbnail(station.logo);
  }
  return embed;
}
