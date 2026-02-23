import { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import type { RadioStation } from './radioList.js';
export declare function buildStationsPageContent(stations: RadioStation[], page: number): {
    content: string;
    totalPages: number;
};
export declare function buildStationsPaginationRow(page: number, totalPages: number): ActionRowBuilder<ButtonBuilder>;
export declare function buildStationsPlayRows(stations: RadioStation[], page: number): ActionRowBuilder<ButtonBuilder>[];
//# sourceMappingURL=stationsUI.d.ts.map