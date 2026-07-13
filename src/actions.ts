import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type VoiceBasedChannel,
} from 'discord.js';
import { loadStations, findStation, type RadioStation } from './radioList.js';
import {
  toEntries,
  filterStations,
  formatStationLine,
  buildStationsPageContent,
  buildStationsPaginationRow,
  buildStationsPlayRows,
  buildPlayButtonRows,
  buildStationEmbed,
} from './stationsUI.js';
import {
  joinVoiceAndPlay,
  stopAndLeave,
  getSession,
  setSessionVolume,
  setSleepTimer,
  updateAloneState,
  sourceName,
  sourceStreamUrl,
  type PlaySource,
} from './voice.js';
import {
  getGuildSettings,
  updateGuildSettings,
  getTopStations,
  MIN_VOLUME,
  MAX_VOLUME,
} from './storage.js';
import { fetchNowPlaying } from './metadata.js';
import {
  searchRadioBrowser,
  resolveRadioBrowserStation,
  type RadioBrowserStation,
} from './radioBrowser.js';
import { resolveYouTube } from './youtube.js';
import { EMBED_COLOR, HELP_TEXT, RB_PLAY_PREFIX } from './constants.js';

/**
 * Command implementations shared by the text (`!play`) and slash (`/play`)
 * front-ends. Each front-end builds a CommandContext adapter and calls in.
 */
export interface ReplyPayload {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
}

export interface CommandContext {
  guild: Guild;
  member: GuildMember | null;
  channelId: string;
  userTag: string;
  reply: (payload: string | ReplyPayload) => Promise<void>;
}

const MAX_FAVORITES = 25;
const SLEEP_MAX_MINUTES = 480;

function logAction(ctx: CommandContext, text: string): void {
  console.log(`[COMMAND] ${text} | Server: ${ctx.guild.name} (${ctx.guild.id}) | User: ${ctx.userTag}`);
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

/** Null when the member may control playback; otherwise the refusal text. */
function checkDj(ctx: CommandContext): string | null {
  const settings = getGuildSettings(ctx.guild.id);
  if (!settings.djRoleId) return null;
  if (!ctx.member) return 'Could not verify your roles — try again.';
  if (ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) return null;
  if (ctx.member.roles.cache.has(settings.djRoleId)) return null;
  return `Playback control is limited to the <@&${settings.djRoleId}> role on this server.`;
}

function requireManageGuild(ctx: CommandContext): string | null {
  if (ctx.member?.permissions.has(PermissionFlagsBits.ManageGuild)) return null;
  return 'You need the **Manage Server** permission to change this setting.';
}

function memberVoiceChannel(ctx: CommandContext): VoiceBasedChannel | null {
  return ctx.member?.voice?.channel ?? null;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function buildPlayConfirmation(
  ctx: CommandContext,
  source: PlaySource,
  voiceChannel: VoiceBasedChannel
): ReplyPayload {
  const volume = getGuildSettings(ctx.guild.id).volume;
  const footer = `Volume ${volume}% • ${voiceChannel.name} • !np for song info`;

  if (source.kind === 'station') {
    const embed = buildStationEmbed(source.station, `📻 Now playing: ${source.station.name}`);
    embed.setFooter({ text: footer });
    return { embeds: [embed] };
  }

  if (source.kind === 'radio-browser') {
    const s = source.station;
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`📻 Now playing: ${s.name}`)
      .setFooter({ text: footer });
    const details = [
      s.country,
      s.tags ? s.tags.split(',').slice(0, 4).join(', ') : null,
      s.bitrate ? `${s.bitrate} kbps ${s.codec ?? ''}`.trim() : null,
    ].filter(Boolean);
    if (details.length) embed.setDescription(details.join(' • '));
    if (s.homepage) embed.addFields({ name: 'Website', value: s.homepage });
    if (s.favicon && /^https?:\/\//i.test(s.favicon)) embed.setThumbnail(s.favicon);
    return { embeds: [embed] };
  }

  const track = source.track;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`▶ Now playing: ${track.title}`)
    .setDescription(track.isLive ? '🔴 YouTube livestream' : 'YouTube video — I will leave the channel when it finishes.')
    .setFooter({ text: footer });
  if (track.webUrl) embed.setURL(track.webUrl);
  return { embeds: [embed] };
}

/** Common path for every "start playing X" command: DJ check, voice-channel
 * check, join, confirmation message. */
export async function startPlayback(ctx: CommandContext, source: PlaySource): Promise<void> {
  const djError = checkDj(ctx);
  if (djError) {
    await ctx.reply(djError);
    return;
  }
  const voiceChannel = memberVoiceChannel(ctx);
  if (!voiceChannel) {
    await ctx.reply('Join a voice channel first, then try again.');
    return;
  }

  const result = await joinVoiceAndPlay(ctx.guild, voiceChannel, source, ctx.channelId);
  if (!result.success) {
    await ctx.reply(result.error);
    return;
  }

  console.log(`[VOICE JOIN] Server: ${ctx.guild.name} (${ctx.guild.id}) | Channel: ${voiceChannel.name} (${voiceChannel.id}) | Source: ${sourceName(source)}`);
  await ctx.reply(buildPlayConfirmation(ctx, source, voiceChannel));
}

export async function playAction(ctx: CommandContext, query: string): Promise<void> {
  logAction(ctx, `play ${query || '(resume last)'}`);
  const stations = await loadStations();
  let station: RadioStation | undefined;

  if (query) {
    station = findStation(stations, query);
    if (!station) {
      await ctx.reply(
        `Station not found: \`${query}\`. Use \`!stations\` to browse, \`!search ${query}\` for local matches, or \`!radio ${query}\` for worldwide stations.`
      );
      return;
    }
  } else {
    // Bare !play: resume the last station, falling back to the first favorite.
    const settings = getGuildSettings(ctx.guild.id);
    const candidates = [settings.lastStation, ...settings.favorites].filter(
      (n): n is string => typeof n === 'string'
    );
    for (const name of candidates) {
      station = stations.find((s) => s.name === name);
      if (station) break;
    }
    if (!station) {
      await ctx.reply(
        'Nothing to resume yet. Usage: `!play <number>` or `!play <station name/hashtag>` — see `!stations`.'
      );
      return;
    }
  }

  await startPlayback(ctx, { kind: 'station', station });
}

export async function stopAction(ctx: CommandContext): Promise<void> {
  logAction(ctx, 'stop');
  const djError = checkDj(ctx);
  if (djError) {
    await ctx.reply(djError);
    return;
  }
  if (!stopAndLeave(ctx.guild.id)) {
    await ctx.reply('I am not in a voice channel on this server.');
    return;
  }
  await ctx.reply('Stopped and left the voice channel.');
}

export async function nowPlayingAction(ctx: CommandContext): Promise<void> {
  logAction(ctx, 'np');
  const session = getSession(ctx.guild.id);
  if (!session) {
    await ctx.reply('Nothing is playing on this server. Start something with `!play` or `!yt`.');
    return;
  }

  const name = sourceName(session.source);
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`🎶 Now playing: ${name}`);

  if (session.source.kind === 'youtube') {
    const track = session.source.track;
    embed.setDescription(track.isLive ? '🔴 YouTube livestream' : 'YouTube video');
    if (track.webUrl) embed.setURL(track.webUrl);
  } else {
    const info = await fetchNowPlaying(sourceStreamUrl(session.source));
    embed.setDescription(
      info.title ? `**${info.title}**` : '_This stream does not publish song titles._'
    );
    if (session.source.kind === 'station' && session.source.station.website_url) {
      embed.addFields({ name: 'Website', value: session.source.station.website_url });
    }
  }

  embed.addFields(
    { name: 'Uptime', value: formatDuration(Date.now() - session.startedAt), inline: true },
    { name: 'Volume', value: `${session.volume}%`, inline: true },
    { name: 'Channel', value: `<#${session.channelId}>`, inline: true }
  );
  if (session.sleepUntil) {
    embed.addFields({
      name: 'Sleep timer',
      value: `stops in ${formatDuration(session.sleepUntil - Date.now())}`,
      inline: true,
    });
  }
  await ctx.reply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// Browsing & search
// ---------------------------------------------------------------------------

export async function stationsAction(ctx: CommandContext, filter: string, page: number): Promise<void> {
  logAction(ctx, `stations${filter ? ` filter="${filter}"` : ''} (page ${page})`);
  const stations = await loadStations();
  const entries = filter ? filterStations(stations, filter) : toEntries(stations);
  if (entries.length === 0) {
    await ctx.reply(`No stations match \`${filter}\`. Try \`!radio ${filter}\` to search worldwide stations.`);
    return;
  }
  const { content, totalPages } = buildStationsPageContent(entries, page, filter || undefined);
  const safePage = Math.min(Math.max(1, page), totalPages);
  await ctx.reply({
    content,
    components: [
      ...buildStationsPlayRows(entries, safePage),
      buildStationsPaginationRow(safePage, totalPages),
    ],
  });
}

export async function searchAction(ctx: CommandContext, query: string): Promise<void> {
  logAction(ctx, `search "${query}"`);
  if (!query) {
    await ctx.reply('Usage: `!search <name / genre / region>` — e.g. `!search rock`.');
    return;
  }
  const stations = await loadStations();
  const matches = filterStations(stations, query).slice(0, 15);
  if (matches.length === 0) {
    await ctx.reply(`No local stations match \`${query}\`. Try \`!radio ${query}\` to search ~50k worldwide stations.`);
    return;
  }
  const lines = matches.map(formatStationLine);
  await ctx.reply({
    content: [`🔎 **Stations matching \`${query}\`**`, lines.join('\n')].join('\n'),
    components: buildPlayButtonRows(matches),
  });
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export async function favAction(ctx: CommandContext, args: string[]): Promise<void> {
  const sub = (args[0] ?? '').toLowerCase();
  const rest = args.slice(1).join(' ').trim();
  const settings = getGuildSettings(ctx.guild.id);
  const stations = await loadStations();

  // `!fav 2` is shorthand for `!fav play 2`.
  if (/^\d+$/.test(sub)) {
    await favPlay(ctx, parseInt(sub, 10), stations, settings.favorites);
    return;
  }

  switch (sub) {
    case '':
    case 'list': {
      logAction(ctx, 'fav list');
      if (settings.favorites.length === 0) {
        await ctx.reply('No favorites yet. Add one with `!fav add <station>`.');
        return;
      }
      const lines = settings.favorites.map((name, i) => {
        const idx = stations.findIndex((s) => s.name === name);
        return idx >= 0
          ? `${i + 1}. **${name}** (station #${idx + 1})`
          : `${i + 1}. **${name}** _(no longer in the station list)_`;
      });
      await ctx.reply(
        [`⭐ **Favorites**`, lines.join('\n'), '', 'Play one with `!fav play <n>` (or just `!fav <n>`).'].join('\n')
      );
      return;
    }
    case 'add': {
      logAction(ctx, `fav add "${rest}"`);
      const station = findStation(stations, rest);
      if (!station) {
        await ctx.reply(`Station not found: \`${rest}\`. Use \`!stations\` or \`!search\` to find it first.`);
        return;
      }
      if (settings.favorites.includes(station.name)) {
        await ctx.reply(`**${station.name}** is already a favorite.`);
        return;
      }
      if (settings.favorites.length >= MAX_FAVORITES) {
        await ctx.reply(`This server already has ${MAX_FAVORITES} favorites — remove one first.`);
        return;
      }
      updateGuildSettings(ctx.guild.id, { favorites: [...settings.favorites, station.name] });
      await ctx.reply(`⭐ Added **${station.name}** to favorites (${settings.favorites.length + 1} total).`);
      return;
    }
    case 'remove':
    case 'rm': {
      logAction(ctx, `fav remove "${rest}"`);
      let name: string | undefined;
      if (/^\d+$/.test(rest)) {
        name = settings.favorites[parseInt(rest, 10) - 1];
      } else {
        name = settings.favorites.find((f) => f.toLowerCase() === rest.toLowerCase())
          ?? settings.favorites.find((f) => f.toLowerCase().includes(rest.toLowerCase()));
      }
      if (!name) {
        await ctx.reply(`\`${rest}\` is not in the favorites list. See \`!fav\`.`);
        return;
      }
      updateGuildSettings(ctx.guild.id, {
        favorites: settings.favorites.filter((f) => f !== name),
      });
      await ctx.reply(`Removed **${name}** from favorites.`);
      return;
    }
    case 'play': {
      const n = /^\d+$/.test(rest) ? parseInt(rest, 10) : 1;
      await favPlay(ctx, n, stations, settings.favorites);
      return;
    }
    default:
      await ctx.reply('Usage: `!fav` (list), `!fav add <station>`, `!fav remove <station>`, `!fav play [n]`.');
  }
}

async function favPlay(
  ctx: CommandContext,
  n: number,
  stations: RadioStation[],
  favorites: string[]
): Promise<void> {
  logAction(ctx, `fav play ${n}`);
  if (favorites.length === 0) {
    await ctx.reply('No favorites yet. Add one with `!fav add <station>`.');
    return;
  }
  const name = favorites[n - 1];
  if (!name) {
    await ctx.reply(`There is no favorite #${n} — this server has ${favorites.length}. See \`!fav\`.`);
    return;
  }
  const station = stations.find((s) => s.name === name);
  if (!station) {
    await ctx.reply(`**${name}** is no longer in the station list. Remove it with \`!fav remove ${n}\`.`);
    return;
  }
  await startPlayback(ctx, { kind: 'station', station });
}

// ---------------------------------------------------------------------------
// Volume / sleep / settings
// ---------------------------------------------------------------------------

export async function volumeAction(ctx: CommandContext, arg: string): Promise<void> {
  const settings = getGuildSettings(ctx.guild.id);
  if (!arg) {
    await ctx.reply(`🔊 Volume is **${settings.volume}%**. Set it with \`!volume ${MIN_VOLUME}\`–\`${MAX_VOLUME}\`.`);
    return;
  }
  const value = parseInt(arg.replace('%', ''), 10);
  if (!Number.isFinite(value) || value < MIN_VOLUME || value > MAX_VOLUME) {
    await ctx.reply(`Volume must be a number between ${MIN_VOLUME} and ${MAX_VOLUME} (percent).`);
    return;
  }
  const djError = checkDj(ctx);
  if (djError) {
    await ctx.reply(djError);
    return;
  }
  logAction(ctx, `volume ${value}`);
  const applied = updateGuildSettings(ctx.guild.id, { volume: value });
  const live = setSessionVolume(ctx.guild.id, applied.volume);
  await ctx.reply(
    live
      ? `🔊 Volume set to **${applied.volume}%** (the stream restarts for a moment to apply it).`
      : `🔊 Volume set to **${applied.volume}%** — it will apply the next time something plays.`
  );
}

export async function sleepAction(ctx: CommandContext, arg: string): Promise<void> {
  const session = getSession(ctx.guild.id);
  const lower = arg.toLowerCase();

  if (!arg) {
    if (session?.sleepUntil) {
      await ctx.reply(`😴 Sleep timer: stopping in **${formatDuration(session.sleepUntil - Date.now())}**. Cancel with \`!sleep off\`.`);
    } else {
      await ctx.reply('No sleep timer set. Use `!sleep <minutes>` (max 480) to stop playback automatically.');
    }
    return;
  }

  const djError = checkDj(ctx);
  if (djError) {
    await ctx.reply(djError);
    return;
  }

  if (lower === 'off' || lower === 'cancel' || lower === 'stop') {
    logAction(ctx, 'sleep off');
    if (!session || !session.sleepUntil) {
      await ctx.reply('There is no sleep timer to cancel.');
      return;
    }
    setSleepTimer(ctx.guild.id, null);
    await ctx.reply('Sleep timer cancelled.');
    return;
  }

  const minutes = parseInt(arg, 10);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > SLEEP_MAX_MINUTES) {
    await ctx.reply(`Usage: \`!sleep <minutes>\` (1–${SLEEP_MAX_MINUTES}) or \`!sleep off\`.`);
    return;
  }
  if (!session) {
    await ctx.reply('Nothing is playing — start a station first, then set the sleep timer.');
    return;
  }
  logAction(ctx, `sleep ${minutes}`);
  setSleepTimer(ctx.guild.id, minutes);
  await ctx.reply(`😴 Sleep timer set: I will stop playing in **${minutes} min**.`);
}

export async function djAction(ctx: CommandContext, arg: string): Promise<void> {
  const settings = getGuildSettings(ctx.guild.id);

  if (!arg) {
    await ctx.reply(
      settings.djRoleId
        ? `🎧 Playback control is limited to <@&${settings.djRoleId}>. Change with \`!dj @role\` or \`!dj off\`.`
        : '🎧 No DJ role set — everyone can control playback. Set one with `!dj @role`.'
    );
    return;
  }

  const permError = requireManageGuild(ctx);
  if (permError) {
    await ctx.reply(permError);
    return;
  }

  if (arg.toLowerCase() === 'off' || arg.toLowerCase() === 'none') {
    logAction(ctx, 'dj off');
    updateGuildSettings(ctx.guild.id, { djRoleId: undefined });
    await ctx.reply('DJ role removed — everyone can control playback again.');
    return;
  }

  const mentionMatch = arg.match(/^<@&(\d+)>$/);
  const roleId = mentionMatch?.[1] ?? (/^\d+$/.test(arg) ? arg : undefined);
  const role = roleId
    ? ctx.guild.roles.cache.get(roleId)
    : ctx.guild.roles.cache.find((r) => r.name.toLowerCase() === arg.toLowerCase());
  if (!role) {
    await ctx.reply(`Could not find that role. Mention it, e.g. \`!dj @DJ\`, or use \`!dj off\`.`);
    return;
  }
  logAction(ctx, `dj set ${role.name}`);
  updateGuildSettings(ctx.guild.id, { djRoleId: role.id });
  await ctx.reply(`🎧 Playback control is now limited to **${role.name}** (admins are always allowed).`);
}

export async function alwaysOnAction(ctx: CommandContext, arg: string): Promise<void> {
  const settings = getGuildSettings(ctx.guild.id);
  const lower = arg.toLowerCase();

  if (lower !== 'on' && lower !== 'off') {
    await ctx.reply(
      settings.alwaysOn
        ? '📻 24/7 mode is **on** — I stay in the voice channel even when it is empty. Turn off with `!247 off`.'
        : '📻 24/7 mode is **off** — I leave after 5 minutes alone. Turn on with `!247 on`.'
    );
    return;
  }

  const permError = requireManageGuild(ctx);
  if (permError) {
    await ctx.reply(permError);
    return;
  }

  logAction(ctx, `247 ${lower}`);
  updateGuildSettings(ctx.guild.id, { alwaysOn: lower === 'on' });
  updateAloneState(ctx.guild);
  await ctx.reply(
    lower === 'on'
      ? '📻 24/7 mode **on** — I will keep playing even in an empty channel.'
      : '📻 24/7 mode **off** — I will leave after 5 minutes with no listeners.'
  );
}

export async function topAction(ctx: CommandContext): Promise<void> {
  logAction(ctx, 'top');
  const top = getTopStations(10);
  if (top.length === 0) {
    await ctx.reply('No listening stats yet — play something first!');
    return;
  }
  const lines = top.map((s, i) => {
    const hours = s.seconds / 3600;
    const listened = hours >= 1 ? `${hours.toFixed(1)} h` : `${Math.round(s.seconds / 60)} min`;
    return `${i + 1}. **${s.name}** — ${s.plays} play${s.plays === 1 ? '' : 's'} · ${listened} listened`;
  });
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('🏆 Most played stations')
    .setDescription(lines.join('\n'));
  await ctx.reply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// YouTube & Radio Browser
// ---------------------------------------------------------------------------

export async function youtubeAction(ctx: CommandContext, query: string): Promise<void> {
  logAction(ctx, `yt "${query}"`);
  if (!query) {
    await ctx.reply('Usage: `!yt <YouTube link or search terms>` — e.g. `!yt lofi hip hop radio`.');
    return;
  }
  // Fail fast on the cheap checks before spending up to 30 s in yt-dlp.
  const djError = checkDj(ctx);
  if (djError) {
    await ctx.reply(djError);
    return;
  }
  if (!memberVoiceChannel(ctx)) {
    await ctx.reply('Join a voice channel first, then use `!yt`.');
    return;
  }

  const resolved = await resolveYouTube(query);
  if (!resolved.success) {
    await ctx.reply(resolved.error);
    return;
  }
  await startPlayback(ctx, { kind: 'youtube', track: resolved.track });
}

function radioBrowserLine(s: RadioBrowserStation, index: number): string {
  const details = [
    s.country,
    s.tags ? s.tags.split(',').slice(0, 3).join(', ') : null,
    s.bitrate ? `${s.bitrate} kbps` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `${index + 1}. **${s.name}**${details ? ` — ${details}` : ''}`;
}

export async function radioAction(ctx: CommandContext, query: string): Promise<void> {
  logAction(ctx, `radio "${query}"`);
  if (!query) {
    await ctx.reply('Usage: `!radio <station name or genre>` — searches ~50k worldwide stations on radio-browser.info.');
    return;
  }

  let results: RadioBrowserStation[];
  try {
    results = await searchRadioBrowser(query, 5);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[radio-browser] search failed: ${error.message}`);
    await ctx.reply('The radio-browser.info directory is not reachable right now — try again in a bit.');
    return;
  }
  if (results.length === 0) {
    await ctx.reply(`No worldwide stations found for \`${query}\`.`);
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>();
  results.forEach((s, i) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${RB_PLAY_PREFIX}${s.uuid}`)
        .setLabel(`▶ ${i + 1}`)
        .setStyle(ButtonStyle.Success)
    );
  });

  await ctx.reply({
    content: [
      `🌍 **radio-browser.info results for \`${query}\`**`,
      results.map(radioBrowserLine).join('\n'),
      '',
      'Join a voice channel and press ▶ to play.',
    ].join('\n'),
    components: [row],
  });
}

/** Play a radio-browser station by UUID (play button / autocomplete pick). */
export async function radioPlayAction(ctx: CommandContext, uuid: string): Promise<void> {
  logAction(ctx, `radio play ${uuid}`);
  const station = await resolveRadioBrowserStation(uuid);
  if (!station) {
    await ctx.reply('That search result has expired — run the search again.');
    return;
  }
  await startPlayback(ctx, { kind: 'radio-browser', station });
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export async function helpAction(ctx: CommandContext): Promise<void> {
  logAction(ctx, 'help');
  await ctx.reply(HELP_TEXT);
}

/** Parse "!stations rock 2"-style args: trailing number = page, rest = filter. */
export function parseStationsArgs(raw: string): { filter: string; page: number } {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let page = 1;
  if (tokens.length > 0 && /^\d+$/.test(tokens[tokens.length - 1])) {
    page = Math.max(1, parseInt(tokens.pop() as string, 10));
  }
  return { filter: tokens.join(' '), page };
}
