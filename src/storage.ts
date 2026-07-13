import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface GuildSettings {
  /** Favorite station names (as they appear in stations.txt). */
  favorites: string[];
  /** Name of the last station played in this guild (used by bare `!play`). */
  lastStation?: string;
  /** Playback volume in percent (10–200, default 100). */
  volume: number;
  /** Role required to control playback; unset = everyone may. */
  djRoleId?: string;
  /** 24/7 mode: when true the bot never auto-leaves an empty channel. */
  alwaysOn: boolean;
}

export interface StationStats {
  plays: number;
  seconds: number;
}

interface StoreData {
  guilds: Record<string, GuildSettings>;
  stats: Record<string, StationStats>;
}

export const DEFAULT_VOLUME = 100;
export const MIN_VOLUME = 10;
export const MAX_VOLUME = 200;

const SAVE_DEBOUNCE_MS = 2000;

const dataDir = process.env.DATA_DIR ?? join(__dirname, '..', 'data');
const storePath = join(dataDir, 'store.json');

let store: StoreData = { guilds: {}, stats: {} };
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
let dirtyWhileSaving = false;

function defaultGuildSettings(): GuildSettings {
  return { favorites: [], volume: DEFAULT_VOLUME, alwaysOn: false };
}

/**
 * Load the store from disk. Missing or corrupt files start a fresh store —
 * settings/stats are conveniences, never a reason to refuse to boot. (On
 * hosts with an ephemeral disk, e.g. Render's free tier, the store resets on
 * each deploy unless DATA_DIR points at a persistent disk.)
 */
export async function initStorage(): Promise<void> {
  try {
    const raw = await readFile(storePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    store = {
      guilds: parsed.guilds ?? {},
      stats: parsed.stats ?? {},
    };
    console.log(`[storage] Loaded store from ${storePath}`);
  } catch {
    store = { guilds: {}, stats: {} };
    console.log(`[storage] No existing store at ${storePath} — starting fresh`);
  }
}

async function saveNow(): Promise<void> {
  if (saving) {
    dirtyWhileSaving = true;
    return;
  }
  saving = true;
  try {
    await mkdir(dataDir, { recursive: true });
    const tmpPath = `${storePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
    await rename(tmpPath, storePath);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[storage] Failed to save store: ${error.message}`);
  } finally {
    saving = false;
    if (dirtyWhileSaving) {
      dirtyWhileSaving = false;
      scheduleSave();
    }
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveNow();
  }, SAVE_DEBOUNCE_MS);
}

export function getGuildSettings(guildId: string): GuildSettings {
  return store.guilds[guildId] ?? defaultGuildSettings();
}

export function updateGuildSettings(
  guildId: string,
  patch: Partial<GuildSettings>
): GuildSettings {
  const current = store.guilds[guildId] ?? defaultGuildSettings();
  const next: GuildSettings = { ...current, ...patch };
  if (next.volume !== undefined) {
    next.volume = Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, Math.round(next.volume)));
  }
  store.guilds[guildId] = next;
  scheduleSave();
  return next;
}

export function recordPlay(stationName: string): void {
  const entry = store.stats[stationName] ?? { plays: 0, seconds: 0 };
  entry.plays += 1;
  store.stats[stationName] = entry;
  scheduleSave();
}

export function recordListening(stationName: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const entry = store.stats[stationName] ?? { plays: 0, seconds: 0 };
  entry.seconds += Math.round(seconds);
  store.stats[stationName] = entry;
  scheduleSave();
}

export function getTopStations(
  limit: number
): Array<{ name: string; plays: number; seconds: number }> {
  return Object.entries(store.stats)
    .map(([name, s]) => ({ name, plays: s.plays, seconds: s.seconds }))
    .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
    .slice(0, limit);
}
