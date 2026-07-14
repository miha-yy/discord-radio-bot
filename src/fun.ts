import type { Guild, GuildMember } from 'discord.js';
import { logAction, type CommandContext } from './actions.js';

/**
 * Fun/social commands: !whois, !ship, !rate, !8ball, !choose, !roll, !flip.
 * Pure text — no playback interaction, no DJ gating. !ship and !rate are
 * deterministic (seeded by the input) so repeat calls give the same verdict
 * instead of a new dice roll every time.
 */

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** FNV-1a. Stable per input, so ratings read as facts rather than dice. */
function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// !whois
// ---------------------------------------------------------------------------

const WHOIS_TEMPLATES = [
  '🔮 The spirits are certain: {user} is {thing}.',
  '📡 I scanned the whole server and {user} is clearly {thing}.',
  '🎯 It has been decided: {user} is {thing}.',
  '🧠 According to my calculations, {user} is {thing}. No further questions.',
  '⚖️ The council has voted: {user} is {thing}.',
];

/** Cache the fetched member list briefly — fetching all members is a gateway
 * round-trip and !whois tends to get spammed. */
const MEMBER_POOL_TTL_MS = 5 * 60 * 1000;
const memberPools = new Map<string, { at: number; members: GuildMember[] }>();

/**
 * All human members of the guild. Needs the Server Members privileged intent
 * (Developer Portal → Bot → Privileged Gateway Intents); without it the fetch
 * times out and we return [] so the caller can fall back to voice/cache.
 * Failures are cached too, so a missing intent costs one 10 s wait per guild
 * per TTL instead of on every call.
 */
async function fetchMemberPool(guild: Guild): Promise<GuildMember[]> {
  const cached = memberPools.get(guild.id);
  if (cached && Date.now() - cached.at < MEMBER_POOL_TTL_MS) return cached.members;
  let humans: GuildMember[] = [];
  if (guild.memberCount <= 10_000) {
    try {
      const fetched = await guild.members.fetch({ time: 10_000 });
      humans = [...fetched.filter((m) => !m.user.bot).values()];
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[whois] Cannot fetch the member list (is the Server Members intent enabled?): ${error.message}`);
    }
  }
  memberPools.set(guild.id, { at: Date.now(), members: humans });
  return humans;
}

/** The whole server when the Server Members intent is available; otherwise
 * people in voice channels (always cached via voice states), then whatever
 * members we have seen. */
async function whoisCandidates(guild: Guild): Promise<GuildMember[]> {
  const everyone = await fetchMemberPool(guild);
  if (everyone.length > 0) return everyone;

  const inVoice = new Map<string, GuildMember>();
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isVoiceBased()) continue;
    for (const member of channel.members.values()) {
      if (!member.user.bot) inVoice.set(member.id, member);
    }
  }
  if (inVoice.size > 0) return [...inVoice.values()];
  return [...guild.members.cache.filter((m) => !m.user.bot).values()];
}

export async function whoisAction(ctx: CommandContext, query: string): Promise<void> {
  logAction(ctx, `whois "${query}"`);
  if (!query) {
    await ctx.reply('Usage: `!whois <something>` — e.g. `!whois cute`. I will find the right person.');
    return;
  }
  const candidates = await whoisCandidates(ctx.guild);
  if (candidates.length === 0) {
    await ctx.reply('I could not find anyone to judge — join a voice channel and try again.');
    return;
  }
  const chosen = pick(candidates);
  await ctx.reply(
    pick(WHOIS_TEMPLATES)
      .replace('{user}', `<@${chosen.id}>`)
      .replace('{thing}', `**${query.slice(0, 1500)}**`)
  );
}

// ---------------------------------------------------------------------------
// !ship
// ---------------------------------------------------------------------------

async function memberName(guild: Guild, id: string): Promise<string | null> {
  const cached = guild.members.cache.get(id);
  if (cached) return cached.displayName;
  try {
    return (await guild.members.fetch(id)).displayName;
  } catch {
    return null;
  }
}

export async function shipAction(ctx: CommandContext, raw: string): Promise<void> {
  logAction(ctx, `ship "${raw}"`);
  const ids = [...raw.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]);
  const firstId = ids.length === 1 ? ctx.member?.id : ids[0];
  const secondId = ids.length === 1 ? ids[0] : ids[1];
  if (!firstId || !secondId) {
    await ctx.reply('Usage: `!ship @user1 @user2` — or `!ship @user` to ship them with yourself.');
    return;
  }
  if (firstId === secondId) {
    await ctx.reply(`💯 <@${firstId}> × <@${firstId}> — self-love is the best love. **100%**`);
    return;
  }

  // Sorted so the score is the same no matter who asks in which order.
  const score = hashString([firstId, secondId].sort().join('+')) % 101;
  const [nameA, nameB] = await Promise.all([memberName(ctx.guild, firstId), memberName(ctx.guild, secondId)]);
  const shipName =
    nameA && nameB
      ? ` = **${nameA.slice(0, Math.ceil(nameA.length / 2))}${nameB.slice(Math.floor(nameB.length / 2))}**`
      : '';
  const filled = Math.round(score / 10);
  const bar = `\`[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}]\``;
  const verdict =
    score >= 90 ? '💍 Book the venue.'
    : score >= 70 ? '💘 There is definitely something there.'
    : score >= 50 ? '💞 Worth a shot!'
    : score >= 30 ? '🤷 Could work… with a lot of effort.'
    : score >= 10 ? '😬 Better as friends.'
    : '💔 The stars said no.';
  await ctx.reply(`💗 <@${firstId}> × <@${secondId}>${shipName}\n${bar} **${score}%** — ${verdict}`);
}

// ---------------------------------------------------------------------------
// !rate
// ---------------------------------------------------------------------------

export async function rateAction(ctx: CommandContext, thing: string): Promise<void> {
  logAction(ctx, `rate "${thing}"`);
  if (!thing) {
    await ctx.reply('Usage: `!rate <anything>` — e.g. `!rate kebab`.');
    return;
  }
  const botId = ctx.guild.client.user?.id;
  if (botId && new RegExp(`<@!?${botId}>`).test(thing)) {
    await ctx.reply('**10/10.** Flawless. No notes. 😌');
    return;
  }
  const score = (hashString(thing.trim().toLowerCase()) % 101) / 10;
  const verdict =
    score >= 9 ? 'Elite tier. 🏆'
    : score >= 7 ? 'Genuinely great. ✨'
    : score >= 5 ? 'Solid. Respectable. 👍'
    : score >= 3 ? 'It has… potential. 😐'
    : 'Rough. I am so sorry. 💀';
  await ctx.reply(`📊 I rate **${thing.slice(0, 1500)}** a **${score.toFixed(1)}/10**. ${verdict}`);
}

// ---------------------------------------------------------------------------
// !8ball
// ---------------------------------------------------------------------------

const EIGHT_BALL_ANSWERS = [
  'It is certain.',
  'Without a doubt.',
  'Yes — definitely.',
  'You may rely on it.',
  'Most likely.',
  'Outlook good.',
  'Yes.',
  'Signs point to yes.',
  'Reply hazy, try again.',
  'Ask again later.',
  'Better not tell you now.',
  'Cannot predict now.',
  'Concentrate and ask again.',
  "Don't count on it.",
  'My reply is no.',
  'My sources say no.',
  'Outlook not so good.',
  'Very doubtful.',
];

export async function eightBallAction(ctx: CommandContext, question: string): Promise<void> {
  logAction(ctx, `8ball "${question}"`);
  if (!question) {
    await ctx.reply('Usage: `!8ball <question>` — ask me a yes/no question.');
    return;
  }
  await ctx.reply(`🎱 ${pick(EIGHT_BALL_ANSWERS)}`);
}

// ---------------------------------------------------------------------------
// !choose
// ---------------------------------------------------------------------------

export async function chooseAction(ctx: CommandContext, raw: string): Promise<void> {
  logAction(ctx, `choose "${raw}"`);
  let options = raw.split('|').map((s) => s.trim()).filter(Boolean);
  if (options.length < 2) options = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (options.length < 2) options = raw.split(/\s+/).filter(Boolean);
  if (options.length < 2) {
    await ctx.reply('Give me at least two options: `!choose pizza | kebab | burek`.');
    return;
  }
  const prefix = pick(['🤔 Tough one…', '⚖️ I have weighed all the options.', '🎲 Fate says:', '🧠 Easy.']);
  await ctx.reply(`${prefix} I choose **${pick(options).slice(0, 1500)}**!`);
}

// ---------------------------------------------------------------------------
// !roll / !flip
// ---------------------------------------------------------------------------

export async function rollAction(ctx: CommandContext, arg: string): Promise<void> {
  logAction(ctx, `roll "${arg}"`);
  const match = (arg.trim() || 'd6').toLowerCase().match(/^(?:(\d{0,2})d)?(\d{1,4})$/);
  if (!match) {
    await ctx.reply('Usage: `!roll` (d6), `!roll 20` (d20), or `!roll 2d20`.');
    return;
  }
  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2], 10);
  if (count < 1 || count > 20 || sides < 2 || sides > 1000) {
    await ctx.reply('I can roll 1–20 dice with 2–1000 sides, e.g. `!roll 2d20`.');
    return;
  }
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0);
  await ctx.reply(
    count === 1
      ? `🎲 You rolled **${total}** (d${sides})`
      : `🎲 ${count}d${sides}: ${rolls.join(' + ')} = **${total}**`
  );
}

export async function flipAction(ctx: CommandContext): Promise<void> {
  logAction(ctx, 'flip');
  await ctx.reply(`🪙 It landed on… **${pick(['Heads', 'Tails'])}**!`);
}
