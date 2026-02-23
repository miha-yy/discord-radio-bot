import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface RadioStation {
  name: string;
  stream_url: string;
  website_url?: string;
  type?: string;
  logo?: string;
  region?: string;
  city?: string;
  hashtag?: string;
  frequencies?: string[];
}

let stationsCache: RadioStation[] | null = null;

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

export async function loadStations(stationsPath?: string): Promise<RadioStation[]> {
  if (stationsCache) return stationsCache;

  const path = stationsPath ?? join(__dirname, '..', 'stations.txt');
  const raw = await readFile(path, 'utf-8');

  const match = raw.match(/data-stations="(.+)"\s*$/);
  if (!match) {
    throw new Error('stations.txt: expected data-stations="..." attribute');
  }

  const decoded = decodeHtmlEntities(match[1]);
  const parsed = JSON.parse(decoded) as RadioStation[];

  if (!Array.isArray(parsed) || parsed.some((s) => !s.name || !s.stream_url)) {
    throw new Error('stations.txt: invalid station list (need name and stream_url)');
  }

  parsed.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  stationsCache = parsed;
  return stationsCache;
}

export function getStationsCache(): RadioStation[] | null {
  return stationsCache;
}

export function findStation(
  stations: RadioStation[],
  query: string
): RadioStation | undefined {
  if (!query || !query.trim()) return undefined;
  const q = query.trim().toLowerCase();

  const byIndex = /^\d+$/.test(q);
  if (byIndex) {
    const idx = parseInt(q, 10);
    if (idx >= 1 && idx <= stations.length) return stations[idx - 1];
    return undefined;
  }

  return stations.find(
    (s) =>
      s.hashtag?.toLowerCase() === q ||
      s.name.toLowerCase().includes(q) ||
      s.name.toLowerCase() === q
  );
}
