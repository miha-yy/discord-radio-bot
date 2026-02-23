import type { ButtonInteraction } from 'discord.js';
export declare function getStationsButtonType(customId: string): 'play' | 'prev' | 'next' | null;
export declare function handleStationsPlayButton(interaction: ButtonInteraction, globalIndex: number): Promise<void>;
export declare function handleStationsPagination(interaction: ButtonInteraction, direction: 'prev' | 'next'): Promise<void>;
//# sourceMappingURL=interactions.d.ts.map