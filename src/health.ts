import { loadStations } from './radioList.js';

const PROBE_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PROBE_MAX_BYTES = 16 * 1024;
const PROBE_TIMEOUT_MS = 6000;

const SWEEP_CONCURRENCY = 5;
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MIN = 6 * 60;

export interface StreamProbeResult {
  ok: boolean;
  status?: number;
  contentType?: string | null;
  icyName?: string | null;
  bytesRead: number;
  endedEarly?: boolean;
  error?: string;
  elapsedMs: number;
}

/**
 * Fetch the first bytes of a stream URL from wherever the bot is hosted, to
 * diagnose region-dependent failures (geo-blocks, UA blocks) that don't
 * reproduce locally. A live radio stream never ends, so `endedEarly: true`
 * means the server sent a short "not available" body instead of audio.
 */
export async function probeStream(url: string): Promise<StreamProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  let bytesRead = 0;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': PROBE_UA },
      signal: controller.signal,
    });
    let endedEarly = false;
    if (res.body) {
      const reader = res.body.getReader();
      try {
        while (bytesRead < PROBE_MAX_BYTES) {
          const { done, value } = await reader.read();
          if (done) {
            endedEarly = true;
            break;
          }
          bytesRead += value?.length ?? 0;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    return {
      ok: res.ok && !endedEarly,
      status: res.status,
      contentType: res.headers.get('content-type'),
      icyName: res.headers.get('icy-name'),
      bytesRead,
      endedEarly,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      ok: false,
      error: error.name === 'AbortError' ? `timed out after ${PROBE_TIMEOUT_MS}ms` : error.message,
      bytesRead,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Stations that failed the most recent sweep, keyed by station name. */
const unhealthy = new Map<string, string>();
let lastSweepAt: number | null = null;
let sweepRunning = false;

export function isStationUnhealthy(name: string): boolean {
  return unhealthy.has(name);
}

export function getUnhealthyReason(name: string): string | undefined {
  return unhealthy.get(name);
}

export function getHealthSummary(): {
  lastSweepAt: number | null;
  unhealthyCount: number;
  unhealthy: Record<string, string>;
} {
  return {
    lastSweepAt,
    unhealthyCount: unhealthy.size,
    unhealthy: Object.fromEntries(unhealthy),
  };
}

async function sweepOnce(): Promise<void> {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const stations = await loadStations();
    console.log(`[health] Sweeping ${stations.length} stations…`);
    const queue = [...stations];
    const results = new Map<string, string>();

    async function worker(): Promise<void> {
      for (;;) {
        const station = queue.shift();
        if (!station) return;
        const probe = await probeStream(station.stream_url);
        if (!probe.ok) {
          const reason = probe.error
            ?? (probe.endedEarly ? 'stream ended immediately' : `HTTP ${probe.status}`);
          results.set(station.name, reason);
        }
      }
    }

    await Promise.all(Array.from({ length: SWEEP_CONCURRENCY }, () => worker()));

    unhealthy.clear();
    for (const [name, reason] of results) unhealthy.set(name, reason);
    lastSweepAt = Date.now();
    console.log(
      `[health] Sweep done: ${unhealthy.size}/${stations.length} stations unreachable` +
        (unhealthy.size ? ` (${[...unhealthy.keys()].slice(0, 10).join(', ')}${unhealthy.size > 10 ? ', …' : ''})` : '')
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[health] Sweep failed: ${error.message}`);
  } finally {
    sweepRunning = false;
  }
}

/**
 * Start the periodic station health sweep. Interval comes from
 * STATION_HEALTH_INTERVAL_MIN (minutes, default 360; `0` or `off` disables).
 * The first sweep runs a couple of minutes after startup so it never delays
 * the bot coming online.
 */
export function startStationHealthSweep(): void {
  const raw = (process.env.STATION_HEALTH_INTERVAL_MIN ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'off' || raw === 'false') {
    console.log('[health] Station health sweep disabled');
    return;
  }
  const intervalMin = parseInt(raw, 10) > 0 ? parseInt(raw, 10) : DEFAULT_SWEEP_INTERVAL_MIN;

  setTimeout(() => void sweepOnce(), FIRST_SWEEP_DELAY_MS);
  setInterval(() => void sweepOnce(), intervalMin * 60 * 1000);
  console.log(`[health] Station health sweep every ${intervalMin} min (first in 2 min)`);
}
