import type { Message } from 'discord.js';
import {
  type CommandContext,
  type ReplyPayload,
  helpAction,
  stationsAction,
  playAction,
  stopAction,
  nowPlayingAction,
  searchAction,
  favAction,
  volumeAction,
  sleepAction,
  djAction,
  alwaysOnAction,
  topAction,
  youtubeAction,
  radioAction,
  parseStationsArgs,
} from './actions.js';

/**
 * Text (`!`) command front-end. Parsing happens here; the actual behavior
 * lives in actions.ts and is shared with the slash-command front-end.
 */

const COMMAND_ALIASES: Record<string, string> = {
  help: 'help',
  stations: 'stations',
  play: 'play',
  p: 'play',
  stop: 'stop',
  leave: 'stop',
  np: 'np',
  nowplaying: 'np',
  song: 'np',
  search: 'search',
  find: 'search',
  fav: 'fav',
  favs: 'fav',
  favorite: 'fav',
  favourites: 'fav',
  volume: 'volume',
  vol: 'volume',
  sleep: 'sleep',
  dj: 'dj',
  '247': '247',
  top: 'top',
  stats: 'top',
  yt: 'yt',
  youtube: 'yt',
  radio: 'radio',
};

export interface ParsedCommand {
  name: string;
  args: string;
}

export function parseCommand(content: string): ParsedCommand | null {
  const match = content.trim().match(/^!(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const name = COMMAND_ALIASES[match[1].toLowerCase()];
  if (!name) return null;
  return { name, args: (match[2] ?? '').trim() };
}

function contextFromMessage(message: Message): CommandContext | null {
  if (!message.guild) return null;
  return {
    guild: message.guild,
    member: message.member,
    channelId: message.channel.id,
    userTag: message.author.tag,
    reply: async (payload: string | ReplyPayload) => {
      await message.reply(payload);
    },
  };
}

export async function handleMessageCommand(message: Message): Promise<void> {
  const parsed = parseCommand(message.content);
  if (!parsed) return;
  const ctx = contextFromMessage(message);
  if (!ctx) return;

  try {
    switch (parsed.name) {
      case 'help':
        await helpAction(ctx);
        break;
      case 'stations': {
        const { filter, page } = parseStationsArgs(parsed.args);
        await stationsAction(ctx, filter, page);
        break;
      }
      case 'play':
        await playAction(ctx, parsed.args);
        break;
      case 'stop':
        await stopAction(ctx);
        break;
      case 'np':
        await nowPlayingAction(ctx);
        break;
      case 'search':
        await searchAction(ctx, parsed.args);
        break;
      case 'fav':
        await favAction(ctx, parsed.args.split(/\s+/).filter(Boolean));
        break;
      case 'volume':
        await volumeAction(ctx, parsed.args);
        break;
      case 'sleep':
        await sleepAction(ctx, parsed.args);
        break;
      case 'dj':
        await djAction(ctx, parsed.args);
        break;
      case '247':
        await alwaysOnAction(ctx, parsed.args);
        break;
      case 'top':
        await topAction(ctx);
        break;
      case 'yt':
        await youtubeAction(ctx, parsed.args);
        break;
      case 'radio':
        await radioAction(ctx, parsed.args);
        break;
      default:
        break;
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[COMMAND] !${parsed.name} failed:`, error);
    await message
      .reply(`Something went wrong running \`!${parsed.name}\`: ${error.message}`)
      .catch(() => {});
  }
}
