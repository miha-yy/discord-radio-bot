import { type VoiceConnection, type AudioPlayer } from '@discordjs/voice';
import type { Guild, VoiceBasedChannel } from 'discord.js';
import type { RadioStation } from './radioList.js';
export declare function getPlayer(): AudioPlayer;
export declare function getCurrentConnection(): VoiceConnection | null;
export declare function joinVoiceAndPlayStation(guild: Guild, voiceChannel: VoiceBasedChannel, station: RadioStation): Promise<{
    success: true;
    connection: VoiceConnection;
} | {
    success: false;
    error: string;
}>;
export declare function stopAndLeave(): void;
//# sourceMappingURL=voice.d.ts.map