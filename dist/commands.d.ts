import type { Guild, Message } from 'discord.js';
export declare function getCommand(commandStr: string): 'help' | 'stations' | 'play' | 'stop' | null;
export declare function handleHelp(message: Message, guild: Guild): Promise<void>;
export declare function handleStations(message: Message, content: string, guild: Guild): Promise<void>;
export declare function handlePlay(message: Message, content: string, guild: Guild): Promise<void>;
export declare function handleStop(message: Message, guild: Guild): Promise<void>;
//# sourceMappingURL=commands.d.ts.map