/**
 * Client for the free community radio directory at radio-browser.info
 * (~50k stations worldwide, no API key). Used by `!radio` / `/radio` to
 * search and play stations beyond the local stations.txt list.
 */

const API_BASE = 'https://all.api.radio-browser.info/json';
// The API asks clients to identify themselves with a descriptive User-Agent.
const UA = 'discord-radio-bot/1.0 (+https://github.com)';

const DEFAULT_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;

export interface RadioBrowserStation {
  uuid: string;
  name: string;
  streamUrl: string;
  favicon: string | null;
  homepage: string | null;
  country: string | null;
  tags: string | null;
  codec: string | null;
  bitrate: number | null;
}

interface ApiStation {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved?: string;
  favicon?: string;
  homepage?: string;
  country?: string;
  tags?: string;
  codec?: string;
  bitrate?: number;
}

/**
 * Recently returned stations, keyed by UUID, so play buttons and slash
 * autocomplete picks can resolve a UUID without a second API round-trip.
 */
const stationCache = new Map<string, { at: number; station: RadioBrowserStation }>();

function cacheStation(station: RadioBrowserStation): void {
  stationCache.delete(station.uuid);
  stationCache.set(station.uuid, { at: Date.now(), station });
  while (stationCache.size > CACHE_MAX) {
    const oldest = stationCache.keys().next().value;
    if (oldest === undefined) break;
    stationCache.delete(oldest);
  }
}

export function getCachedRadioBrowserStation(uuid: string): RadioBrowserStation | null {
  const entry = stationCache.get(uuid);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    stationCache.delete(uuid);
    return null;
  }
  return entry.station;
}

function toStation(api: ApiStation): RadioBrowserStation | null {
  const streamUrl = api.url_resolved || api.url;
  if (!api.stationuuid || !api.name || !streamUrl) return null;
  return {
    uuid: api.stationuuid,
    name: api.name.trim(),
    streamUrl,
    favicon: api.favicon || null,
    homepage: api.homepage || null,
    country: api.country || null,
    tags: api.tags || null,
    codec: api.codec || null,
    bitrate: api.bitrate ?? null,
  };
}

async function apiSearch(
  params: Record<string, string>,
  timeoutMs: number
): Promise<RadioBrowserStation[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = new URLSearchParams({
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
      ...params,
    });
    const res = await fetch(`${API_BASE}/stations/search?${query}`, {
      headers: { 'user-agent': UA },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`radio-browser API returned HTTP ${res.status}`);
    const data = (await res.json()) as ApiStation[];
    const stations = data.map(toStation).filter((s): s is RadioBrowserStation => s !== null);
    stations.forEach(cacheStation);
    return stations;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search worldwide stations by name, falling back to a tag search (genre
 * words like "jazz" often match tags rather than station names).
 */
export async function searchRadioBrowser(
  query: string,
  limit = 5,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<RadioBrowserStation[]> {
  const q = query.trim();
  if (!q) return [];
  const byName = await apiSearch({ name: q, limit: String(limit) }, timeoutMs);
  if (byName.length > 0) return byName;
  return apiSearch({ tag: q.toLowerCase(), limit: String(limit) }, timeoutMs);
}

/**
 * Look up a station by UUID: cache first, then the API. Returns null when
 * the UUID is unknown (e.g. a play button clicked long after the search).
 */
export async function resolveRadioBrowserStation(
  uuid: string
): Promise<RadioBrowserStation | null> {
  const cached = getCachedRadioBrowserStation(uuid);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/stations/byuuid/${encodeURIComponent(uuid)}`, {
      headers: { 'user-agent': UA },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ApiStation[];
    const station = data.length ? toStation(data[0]) : null;
    if (station) cacheStation(station);
    return station;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tell the directory a station was played (their API asks players to send a
 * click per listen — it powers the popularity ranking). Fire-and-forget.
 */
export function sendRadioBrowserClick(uuid: string): void {
  fetch(`${API_BASE}/url/${encodeURIComponent(uuid)}`, {
    headers: { 'user-agent': UA },
  }).catch(() => {});
}
