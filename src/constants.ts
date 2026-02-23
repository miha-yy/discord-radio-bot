export const STATIONS_PER_PAGE = 20;
export const STATIONS_PREV_ID = 'stations_prev';
export const STATIONS_NEXT_ID = 'stations_next';
export const STATIONS_PLAY_PREFIX = 'stations_play_';
export const BUTTONS_PER_ROW = 5;

export const HELP_TEXT = [
  '**📻 Discord Radio Bot – Help**',
  '',
  '**!stations [page]**',
  'Lists all available radio stations (20 per page). Use the page number to jump, e.g. `!stations 2`. Use the Previous/Next buttons to browse pages.',
  '',
  '**!play** _number, name, or hashtag_',
  'Joins your current voice channel and plays the chosen station. You must be in a voice channel first. Examples: `!play 1`, `!play Radio Name`, `!play #hashtag`. Use `!stations` to see the full list and numbers.',
  '',
  '**!stop**',
  'Stops playback and leaves the voice channel.',
  '',
  '**!help**',
  'Shows this message.',
].join('\n');
