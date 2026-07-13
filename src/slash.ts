import {
  SlashCommandBuilder,
  type Client,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type ApplicationCommandOptionChoiceData,
} from 'discord.js';
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
  radioPlayAction,
} from './actions.js';
import { loadStations } from './radioList.js';
import { filterStations, toEntries } from './stationsUI.js';
import { searchRadioBrowser } from './radioBrowser.js';
import { getGuildSettings, MIN_VOLUME, MAX_VOLUME } from './storage.js';

/**
 * Slash-command front-end. Same behavior as the `!` text commands (both call
 * into actions.ts); slash adds autocomplete for station and radio search.
 */

function commandBuilders() {
  return [
    new SlashCommandBuilder().setName('help').setDescription('Show all commands'),
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a radio station in your voice channel')
      .addStringOption((o) =>
        o
          .setName('station')
          .setDescription('Station number, name, or hashtag (empty = resume last)')
          .setAutocomplete(true)
      ),
    new SlashCommandBuilder().setName('stop').setDescription('Stop playback and leave the voice channel'),
    new SlashCommandBuilder().setName('np').setDescription('Show the current station and song'),
    new SlashCommandBuilder()
      .setName('stations')
      .setDescription('Browse the station list')
      .addStringOption((o) => o.setName('filter').setDescription('Filter by name, genre, or region'))
      .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),
    new SlashCommandBuilder()
      .setName('search')
      .setDescription('Search the local station list')
      .addStringOption((o) => o.setName('query').setDescription('Name, genre, or region').setRequired(true)),
    new SlashCommandBuilder()
      .setName('fav')
      .setDescription('Favorite stations for this server')
      .addSubcommand((s) => s.setName('list').setDescription('List favorites'))
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Add a station to favorites')
          .addStringOption((o) =>
            o.setName('station').setDescription('Station number, name, or hashtag').setRequired(true).setAutocomplete(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a station from favorites')
          .addStringOption((o) =>
            o.setName('station').setDescription('Favorite to remove').setRequired(true).setAutocomplete(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName('play')
          .setDescription('Play a favorite')
          .addIntegerOption((o) => o.setName('number').setDescription('Favorite number (default 1)').setMinValue(1))
      ),
    new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Show or set playback volume')
      .addIntegerOption((o) =>
        o.setName('level').setDescription(`Volume percent (${MIN_VOLUME}–${MAX_VOLUME})`).setMinValue(MIN_VOLUME).setMaxValue(MAX_VOLUME)
      ),
    new SlashCommandBuilder()
      .setName('sleep')
      .setDescription('Stop playback automatically after N minutes')
      .addIntegerOption((o) =>
        o.setName('minutes').setDescription('Minutes until stop (0 = cancel the timer)').setMinValue(0).setMaxValue(480)
      ),
    new SlashCommandBuilder()
      .setName('dj')
      .setDescription('Restrict playback control to a role (Manage Server only)')
      .addRoleOption((o) => o.setName('role').setDescription('The DJ role'))
      .addBooleanOption((o) => o.setName('off').setDescription('Remove the DJ restriction')),
    new SlashCommandBuilder()
      .setName('247')
      .setDescription('24/7 mode: keep playing in an empty channel (Manage Server only)')
      .addStringOption((o) =>
        o
          .setName('mode')
          .setDescription('Turn 24/7 mode on or off (empty = show current)')
          .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
      ),
    new SlashCommandBuilder().setName('top').setDescription('Most played stations'),
    new SlashCommandBuilder()
      .setName('yt')
      .setDescription('Play audio from YouTube')
      .addStringOption((o) =>
        o.setName('query').setDescription('YouTube link or search terms').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('radio')
      .setDescription('Search ~50k worldwide stations (radio-browser.info)')
      .addStringOption((o) =>
        o.setName('query').setDescription('Station name or genre').setRequired(true).setAutocomplete(true)
      ),
  ];
}

export async function registerSlashCommands(client: Client<true>): Promise<void> {
  const builders = commandBuilders();
  await client.application.commands.set(builders.map((b) => b.toJSON()));
  console.log(`Registered ${builders.length} slash commands`);
}

function contextFromInteraction(interaction: ChatInputCommandInteraction<'cached'>): CommandContext {
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

export async function handleChatInputCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: 'This bot only works inside a server.', ephemeral: true }).catch(() => {});
    return;
  }

  // Everything gets deferred: joining voice, yt-dlp, and directory searches
  // can all take longer than the 3 s interaction deadline.
  await interaction.deferReply();
  const ctx = contextFromInteraction(interaction);

  try {
    switch (interaction.commandName) {
      case 'help':
        await helpAction(ctx);
        break;
      case 'play':
        await playAction(ctx, interaction.options.getString('station') ?? '');
        break;
      case 'stop':
        await stopAction(ctx);
        break;
      case 'np':
        await nowPlayingAction(ctx);
        break;
      case 'stations':
        await stationsAction(
          ctx,
          interaction.options.getString('filter') ?? '',
          interaction.options.getInteger('page') ?? 1
        );
        break;
      case 'search':
        await searchAction(ctx, interaction.options.getString('query', true));
        break;
      case 'fav': {
        const sub = interaction.options.getSubcommand();
        if (sub === 'list') await favAction(ctx, []);
        else if (sub === 'add') await favAction(ctx, ['add', interaction.options.getString('station', true)]);
        else if (sub === 'remove') await favAction(ctx, ['remove', interaction.options.getString('station', true)]);
        else await favAction(ctx, ['play', String(interaction.options.getInteger('number') ?? 1)]);
        break;
      }
      case 'volume': {
        const level = interaction.options.getInteger('level');
        await volumeAction(ctx, level === null ? '' : String(level));
        break;
      }
      case 'sleep': {
        const minutes = interaction.options.getInteger('minutes');
        await sleepAction(ctx, minutes === null ? '' : minutes === 0 ? 'off' : String(minutes));
        break;
      }
      case 'dj': {
        const role = interaction.options.getRole('role');
        const off = interaction.options.getBoolean('off') ?? false;
        await djAction(ctx, role ? `<@&${role.id}>` : off ? 'off' : '');
        break;
      }
      case '247':
        await alwaysOnAction(ctx, interaction.options.getString('mode') ?? '');
        break;
      case 'top':
        await topAction(ctx);
        break;
      case 'yt':
        await youtubeAction(ctx, interaction.options.getString('query', true));
        break;
      case 'radio': {
        const query = interaction.options.getString('query', true);
        // Autocomplete picks come back as rb:<uuid> and play directly.
        if (query.startsWith('rb:')) await radioPlayAction(ctx, query.slice(3));
        else await radioAction(ctx, query);
        break;
      }
      default:
        await ctx.reply('Unknown command.');
        break;
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[SLASH] /${interaction.commandName} failed:`, error);
    await interaction.editReply(`Something went wrong: ${error.message}`).catch(() => {});
  }
}

async function stationChoices(input: string): Promise<ApplicationCommandOptionChoiceData<string>[]> {
  const stations = await loadStations();
  const entries = input.trim() ? filterStations(stations, input) : toEntries(stations);
  return entries.slice(0, 25).map(({ station, globalIndex }) => ({
    name: `${globalIndex}. ${station.name}${station.type ? ` — ${station.type}` : ''}`.slice(0, 100),
    value: String(globalIndex),
  }));
}

async function radioChoices(input: string): Promise<ApplicationCommandOptionChoiceData<string>[]> {
  if (input.trim().length < 2) return [];
  // Autocomplete must answer within 3 s — keep the API call on a short leash.
  const results = await searchRadioBrowser(input, 25, 2200);
  return results.map((s) => ({
    name: `${s.name}${s.country ? ` (${s.country})` : ''}`.slice(0, 100),
    value: `rb:${s.uuid}`,
  }));
}

export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const focused = interaction.options.getFocused(true);
    const input = String(focused.value);
    let choices: ApplicationCommandOptionChoiceData<string>[] = [];

    if (interaction.commandName === 'play') {
      choices = await stationChoices(input);
    } else if (interaction.commandName === 'radio') {
      choices = await radioChoices(input);
    } else if (interaction.commandName === 'fav') {
      const sub = interaction.options.getSubcommand(false);
      if (sub === 'add') {
        choices = await stationChoices(input);
      } else if (sub === 'remove' && interaction.guildId) {
        choices = getGuildSettings(interaction.guildId)
          .favorites.filter((name) => name.toLowerCase().includes(input.trim().toLowerCase()))
          .slice(0, 25)
          .map((name) => ({ name: name.slice(0, 100), value: name.slice(0, 100) }));
      }
    }

    await interaction.respond(choices.slice(0, 25));
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[SLASH] autocomplete for /${interaction.commandName} failed:`, error.message);
    await interaction.respond([]).catch(() => {});
  }
}
