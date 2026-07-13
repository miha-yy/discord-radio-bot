/**
 * Shoutcast/Icecast "ICY" metadata: when a client sends `Icy-MetaData: 1`,
 * the server interleaves a metadata block into the audio stream every
 * `icy-metaint` bytes. The block is one length byte L followed by L*16 bytes
 * of NUL-padded text like `StreamTitle='Artist - Title';`. We open a short
 * side-connection to the stream (separate from the FFmpeg playback pipe),
 * read just past the first metadata block, and close.
 */

const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 15_000;
/** Give up on streams that put the first metadata block absurdly far in. */
const MAX_METAINT = 512 * 1024;

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface NowPlayingInfo {
  /** Current song title (from StreamTitle), if the stream provides one. */
  title: string | null;
  /** Station-reported name (icy-name header), if any. */
  icyName: string | null;
}

const cache = new Map<string, { at: number; info: NowPlayingInfo }>();

function parseStreamTitle(meta: string): string | null {
  const match = meta.match(/StreamTitle='(.*?)';/);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

/**
 * Fetch the currently playing song title from a stream URL. Returns nulls
 * (not an error) for streams without ICY metadata (e.g. HLS) or on timeout.
 */
export async function fetchNowPlaying(streamUrl: string): Promise<NowPlayingInfo> {
  const cached = cache.get(streamUrl);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.info;

  const info = await fetchNowPlayingUncached(streamUrl);
  cache.set(streamUrl, { at: Date.now(), info });
  // Keep the cache from growing without bound across many stations.
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return info;
}

async function fetchNowPlayingUncached(streamUrl: string): Promise<NowPlayingInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(streamUrl, {
      headers: { 'Icy-MetaData': '1', 'user-agent': UA },
      signal: controller.signal,
    });
    const icyName = res.headers.get('icy-name');
    const metaint = parseInt(res.headers.get('icy-metaint') ?? '', 10);

    if (!res.ok || !res.body || !Number.isFinite(metaint) || metaint <= 0 || metaint > MAX_METAINT) {
      await res.body?.cancel().catch(() => {});
      return { title: null, icyName };
    }

    // Read audio up to the first metadata block: metaint bytes of audio,
    // 1 length byte, then length*16 bytes of metadata text.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const needAtLeast = () => {
      if (total <= metaint) return metaint + 1;
      const lengthByte = byteAt(chunks, metaint);
      return metaint + 1 + lengthByte * 16;
    };
    try {
      while (total < needAtLeast()) {
        const { done, value } = await reader.read();
        if (done) return { title: null, icyName };
        if (value) {
          chunks.push(value);
          total += value.length;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }

    const lengthByte = byteAt(chunks, metaint);
    if (lengthByte === 0) return { title: null, icyName };
    const metaBytes = sliceAcross(chunks, metaint + 1, metaint + 1 + lengthByte * 16);
    const metaText = new TextDecoder('utf-8', { fatal: false })
      .decode(metaBytes)
      .replace(/\0+$/g, '');
    return { title: parseStreamTitle(metaText), icyName };
  } catch {
    return { title: null, icyName: null };
  } finally {
    clearTimeout(timer);
  }
}

function byteAt(chunks: Uint8Array[], index: number): number {
  let offset = 0;
  for (const chunk of chunks) {
    if (index < offset + chunk.length) return chunk[index - offset];
    offset += chunk.length;
  }
  return 0;
}

function sliceAcross(chunks: Uint8Array[], start: number, end: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, end - start));
  let offset = 0;
  let written = 0;
  for (const chunk of chunks) {
    const chunkStart = Math.max(start, offset);
    const chunkEnd = Math.min(end, offset + chunk.length);
    if (chunkEnd > chunkStart) {
      out.set(chunk.subarray(chunkStart - offset, chunkEnd - offset), written);
      written += chunkEnd - chunkStart;
    }
    offset += chunk.length;
    if (offset >= end) break;
  }
  return out.subarray(0, written);
}
