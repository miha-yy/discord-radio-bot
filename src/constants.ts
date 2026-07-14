export const STATIONS_PER_PAGE = 20;
export const STATIONS_PREV_ID = 'stations_prev';
export const STATIONS_NEXT_ID = 'stations_next';
export const STATIONS_PLAY_PREFIX = 'stations_play_';
/** Play button for a radio-browser.info search result: rb_play_<uuid>. */
export const RB_PLAY_PREFIX = 'rb_play_';
export const BUTTONS_PER_ROW = 5;

export const EMBED_COLOR = 0x5865f2;

export const HELP_TEXT = [
  '**📻 Discord Radio Bot – Help**',
  'Every command also exists as a slash command (`/play`, `/stations`, …) with autocomplete.',
  '',
  '**Playback**',
  '`!play <number | name | #hashtag>` – join your voice channel and play a station. Bare `!play` resumes the last station played on this server.',
  '`!stop` – stop playback and leave the voice channel.',
  '`!np` – what is playing right now (station + current song, uptime, volume).',
  '`!skip` – skip to the next queued YouTube track.',
  '`!queue [clear | remove <n>]` – show or edit the YouTube queue.',
  '`!volume [10–200]` – show or set playback volume for this server.',
  '`!sleep <minutes | off>` – stop playback automatically after N minutes (max 480).',
  '',
  '**Finding stations**',
  '`!stations [filter] [page]` – browse the station list (20 per page, ▶ buttons to play). A filter narrows by name/genre/region, e.g. `!stations rock`.',
  '`!search <query>` – search the local station list and get play buttons.',
  '`!radio <query>` – search radio-browser.info (~50k worldwide stations) and play from the results.',
  '`!yt <link or search>` – play audio from YouTube (videos and livestreams). Using it again while YouTube plays queues the track.',
  '',
  '**Favorites**',
  '`!fav` – list this server’s favorite stations.',
  '`!fav add <station>` / `!fav remove <station>` – manage favorites.',
  '`!fav play [n]` – play favorite number n (default 1).',
  '',
  '**Server settings** (need the *Manage Server* permission)',
  '`!dj [@role | off]` – restrict playback control to a DJ role.',
  '`!247 [on | off]` – 24/7 mode: never auto-leave an empty voice channel.',
  '',
  '**Fun**',
  '`!whois <something>` – I decide which member is *something*, e.g. `!whois cute`.',
  '`!ship @a @b` – compatibility check (one mention = ship them with you).',
  '`!rate <thing>` – I rate anything out of 10.',
  '`!8ball <question>` – ask the magic 8-ball.',
  '`!choose a | b | c` – I settle the argument.',
  '`!roll [2d20]` / `!flip` – dice and coin flip.',
  '',
  '**Stats**',
  '`!top` – most played stations on this bot.',
].join('\n');
