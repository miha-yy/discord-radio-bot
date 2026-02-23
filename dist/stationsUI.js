import { ActionRowBuilder, ButtonBuilder, ButtonStyle, } from 'discord.js';
import { BUTTONS_PER_ROW, STATIONS_NEXT_ID, STATIONS_PER_PAGE, STATIONS_PREV_ID, STATIONS_PLAY_PREFIX, } from './constants.js';
export function buildStationsPageContent(stations, page) {
    const totalPages = Math.ceil(stations.length / STATIONS_PER_PAGE) || 1;
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * STATIONS_PER_PAGE;
    const slice = stations.slice(start, start + STATIONS_PER_PAGE);
    const lines = slice.map((s, i) => `${start + i + 1}. **${s.name}** \`${s.hashtag ?? start + i + 1}\``);
    const content = [
        `📻 **Stations (page ${safePage}/${totalPages})**`,
        lines.join('\n'),
        '',
        'Use `!play <number>` or `!play <name/hashtag>` to play.',
    ].join('\n');
    return { content, totalPages };
}
export function buildStationsPaginationRow(page, totalPages) {
    const row = new ActionRowBuilder();
    row.addComponents(new ButtonBuilder()
        .setCustomId(STATIONS_PREV_ID)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1), new ButtonBuilder()
        .setCustomId(STATIONS_NEXT_ID)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages));
    return row;
}
export function buildStationsPlayRows(stations, page) {
    const totalPages = Math.ceil(stations.length / STATIONS_PER_PAGE) || 1;
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * STATIONS_PER_PAGE;
    const slice = stations.slice(start, start + STATIONS_PER_PAGE);
    const rows = [];
    for (let r = 0; r < slice.length; r += BUTTONS_PER_ROW) {
        const rowStations = slice.slice(r, r + BUTTONS_PER_ROW);
        const row = new ActionRowBuilder();
        for (let i = 0; i < rowStations.length; i++) {
            const globalIndex = start + r + i + 1;
            row.addComponents(new ButtonBuilder()
                .setCustomId(`${STATIONS_PLAY_PREFIX}${globalIndex}`)
                .setLabel(`▶ ${globalIndex}`)
                .setStyle(ButtonStyle.Success));
        }
        rows.push(row);
    }
    return rows;
}
//# sourceMappingURL=stationsUI.js.map