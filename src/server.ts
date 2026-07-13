import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import prism from 'prism-media';
import { getActiveGuildCount, buildFfmpegArgs } from './voice.js';
import { loadStations } from './radioList.js';

const PROBE_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PROBE_MAX_BYTES = 16 * 1024;
const PROBE_TIMEOUT_MS = 6000;

/**
 * Fetch the first bytes of a stream URL from wherever the bot is hosted, to
 * diagnose region-dependent failures (geo-blocks, UA blocks) that don't
 * reproduce locally. A live radio stream never ends, so `endedEarly: true`
 * means the server sent a short "not available" body instead of audio.
 */
async function probeStream(url: string) {
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

/**
 * Run the bot's actual FFmpeg transcode pipeline against a stream for ~3
 * seconds and report what happened. This exercises the exact code path
 * !play uses (same binary, same args), so a crash here reproduces a
 * playback failure without needing Discord.
 */
async function probeFfmpeg(url: string): Promise<Record<string, unknown>> {
  let ffmpegInfo: { command?: string; version?: string } = {};
  try {
    ffmpegInfo = prism.FFmpeg.getInfo();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { error: `FFmpeg not found: ${error.message}` };
  }

  return await new Promise<Record<string, unknown>>((resolve) => {
    let bytesOut = 0;
    let stderr = '';
    let settled = false;
    const ffmpeg = new prism.FFmpeg({
      // '-t 3': transcode 3 seconds of output, then exit cleanly (code 0).
      args: [...buildFfmpegArgs(url), '-t', '3'],
    });
    const finish = (extra: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ffmpegCommand: ffmpegInfo.command,
        ffmpegVersion: ffmpegInfo.version,
        bytesOut,
        stderr: stderr.trim().slice(0, 2000) || null,
        ...extra,
      });
    };
    const timer = setTimeout(() => {
      ffmpeg.destroy();
      finish({ error: 'timed out after 15s' });
    }, 15_000);

    ffmpeg.on('data', (chunk: Buffer) => {
      bytesOut += chunk.length;
    });
    ffmpeg.on('error', () => {});
    ffmpeg.process.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    ffmpeg.process.on('close', (code, signal) => {
      // ok = produced audio and exited cleanly after its 3s of output.
      finish({ ok: code === 0 && bytesOut > 0, exitCode: code, signal });
    });
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

/**
 * Minimal HTTP server so the bot can run as a Render Web Service: Render only
 * considers a web service live once the process binds to PORT and answers
 * health checks. The endpoint also doubles as a keep-alive target for
 * external pingers (Render's free tier spins services down without traffic).
 */
export function startHealthServer(isDiscordReady: () => boolean): http.Server {
  const port = Number(process.env.PORT) || 3000;

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    if (url === '/' || url === '/healthz') {
      sendJson(res, 200, {
        status: 'ok',
        discord: isDiscordReady() ? 'connected' : 'connecting',
        activeVoiceSessions: getActiveGuildCount(),
      });
      return;
    }

    // GET /debug/stream/26 — fetch station #26's stream URL from the host's
    // network (reachability/geo-blocks). GET /debug/ffmpeg/26 — additionally
    // run it through the real FFmpeg transcode pipeline.
    const debugMatch = url.match(/^\/debug\/(stream|ffmpeg)\/(\d+)$/);
    if (debugMatch) {
      const stations = await loadStations();
      const index = parseInt(debugMatch[2], 10);
      const station = index >= 1 && index <= stations.length ? stations[index - 1] : undefined;
      if (!station) {
        sendJson(res, 404, { error: `No station #${index} (1-${stations.length})` });
        return;
      }
      const probe =
        debugMatch[1] === 'ffmpeg'
          ? await probeFfmpeg(station.stream_url)
          : await probeStream(station.stream_url);
      sendJson(res, 200, { station: station.name, url: station.stream_url, ...probe });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('Health server error:', error.message);
      if (!res.headersSent) sendJson(res, 500, { error: error.message });
      else res.end();
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Health server listening on port ${port}`);
  });

  return server;
}
