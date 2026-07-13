const PROBE_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PROBE_MAX_BYTES = 16 * 1024;
const PROBE_TIMEOUT_MS = 6000;

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
