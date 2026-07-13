import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * YouTube playback is resolved through the yt-dlp binary (no fragile npm
 * wrapper): we ask it for the video title and a direct bestaudio URL, then
 * feed that URL into the exact same FFmpeg pipeline the radio stations use.
 * yt-dlp must be on PATH (or set YTDLP_PATH); the Dockerfile installs it.
 *
 * Bot checks: YouTube challenges datacenter IPs (cloud hosts like Render)
 * with "Sign in to confirm you're not a bot". Mitigations, in order:
 *  1. YTDLP_COOKIES (path to an exported cookies.txt) is passed to every
 *     call — the documented, most reliable fix for servers.
 *  2. On a bot-check error we retry once with player clients that currently
 *     don't require a PO token (web_embedded, android_vr, tv), which are
 *     usually exempt from the check.
 * YTDLP_EXTRACTOR_ARGS overrides the extractor args of the first attempt,
 * YTDLP_FALLBACK_CLIENTS the client list of the retry.
 */

// Generous default: on tiny cloud instances (Render free tier's 0.1 vCPU)
// yt-dlp startup + YouTube round-trips + JS challenge solving can take tens
// of seconds. Override with YTDLP_TIMEOUT_MS.
const RESOLVE_TIMEOUT_MS = (() => {
  const env = parseInt(process.env.YTDLP_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(env) && env >= 5000 ? env : 90_000;
})();

const FALLBACK_CLIENTS = process.env.YTDLP_FALLBACK_CLIENTS ?? 'web_embedded,android_vr,tv';

/**
 * yt-dlp not only reads --cookies files, it saves rotated cookies back to
 * them on exit — and crashes (PYI unhandled OSError) when the file is
 * read-only, which is exactly how Render mounts secret files. So the
 * YTDLP_COOKIES file is copied once per process to a writable temp file
 * (normalizing Windows line endings while at it); yt-dlp then reads and
 * rotates the copy across calls.
 */
let preparedCookiesPath: string | null | undefined;

async function prepareCookiesFile(): Promise<string | null> {
  if (preparedCookiesPath !== undefined) return preparedCookiesPath;
  const src = process.env.YTDLP_COOKIES;
  if (!src) {
    preparedCookiesPath = null;
    return null;
  }
  try {
    const raw = await readFile(src, 'utf-8');
    const dest = join(tmpdir(), `radio-bot-cookies-${process.pid}.txt`);
    await writeFile(dest, raw.replace(/\r\n?/g, '\n'), { encoding: 'utf-8', mode: 0o600 });
    console.log(`[yt-dlp] Copied cookies from ${src} to writable ${dest}`);
    preparedCookiesPath = dest;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[yt-dlp] Cannot read YTDLP_COOKIES file (${src}): ${error.message} — continuing without cookies`);
    preparedCookiesPath = null;
  }
  return preparedCookiesPath;
}

/**
 * yt-dlp needs a JavaScript runtime to solve YouTube's "n" challenge but only
 * enables deno by default; we are a Node app, so hand it the exact node
 * binary we are running on. Override with YTDLP_JS_RUNTIMES (`off` disables).
 */
function jsRuntimesArg(): string | null {
  const env = process.env.YTDLP_JS_RUNTIMES;
  if (env === 'off') return null;
  return env ?? `node:${process.execPath}`;
}

export interface YouTubeTrack {
  title: string;
  streamUrl: string;
  /** Live streams get radio-style auto-restart; normal videos just end. */
  isLive: boolean;
  webUrl: string | null;
}

export type YouTubeResolveResult =
  | { success: true; track: YouTubeTrack }
  | { success: false; error: string };

function ytDlpBinary(): string {
  return process.env.YTDLP_PATH ?? 'yt-dlp';
}

function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

export function isBotCheckError(stderr: string): boolean {
  return /sign in to confirm|confirm you.?re not a bot|use --cookies/i.test(stderr);
}

interface YtDlpRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Filled for failures that should be shown to the user as-is. */
  fatalError?: string;
}

function runYtDlp(args: string[]): Promise<YtDlpRun> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: YtDlpRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(ytDlpBinary(), args, { windowsHide: true });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      resolve({ ok: false, stdout: '', stderr: '', fatalError: `Could not start yt-dlp: ${error.message}` });
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        stdout,
        stderr,
        fatalError: `YouTube lookup timed out after ${Math.round(RESOLVE_TIMEOUT_MS / 1000)}s. Try again.`,
      });
    }, RESOLVE_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        finish({
          ok: false,
          stdout,
          stderr,
          fatalError:
            'YouTube support needs the `yt-dlp` binary, which is not installed on this host. ' +
            'Install it (e.g. `winget install yt-dlp` / `apt install yt-dlp`) or set YTDLP_PATH.',
        });
      } else {
        finish({ ok: false, stdout, stderr, fatalError: `yt-dlp failed to start: ${err.message}` });
      }
    });

    child.on('close', (code) => {
      finish({ ok: code === 0, stdout, stderr });
    });
  });
}

function buildArgs(target: string, cookiesPath: string | null, extractorArgs?: string): string[] {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '-f', 'bestaudio/best',
    '--print', 'title',
    '--print', 'is_live',
    '--print', 'webpage_url',
    '--print', 'urls',
  ];
  const jsRuntimes = jsRuntimesArg();
  if (jsRuntimes) {
    args.push('--js-runtimes', jsRuntimes);
  }
  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  }
  if (extractorArgs) {
    args.push('--extractor-args', extractorArgs);
  }
  args.push('--', target);
  return args;
}

function lastErrorLine(stderr: string): string | undefined {
  return stderr
    .split('\n')
    .reverse()
    .find((l) => l.includes('ERROR'))
    ?.replace(/^ERROR:\s*/i, '')
    .trim();
}

function parseOutput(stdout: string, query: string): YouTubeResolveResult {
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 4) {
    return {
      success: false,
      error: looksLikeUrl(query)
        ? 'yt-dlp returned no playable stream for that link.'
        : `No YouTube results for \`${query}\`.`,
    };
  }
  const [title, isLiveRaw, webUrl, streamUrl] = lines;
  return {
    success: true,
    track: {
      title,
      streamUrl,
      isLive: isLiveRaw.toLowerCase() === 'true',
      webUrl: looksLikeUrl(webUrl) ? webUrl : null,
    },
  };
}

/**
 * Resolve a YouTube URL or free-text search query to a playable audio URL.
 * Free text is resolved via yt-dlp's `ytsearch1:` (top search result).
 */
export async function resolveYouTube(input: string): Promise<YouTubeResolveResult> {
  const query = input.trim();
  if (!query) return { success: false, error: 'Give me a YouTube link or a search query.' };

  const target = looksLikeUrl(query) ? query : `ytsearch1:${query}`;
  const cookiesPath = await prepareCookiesFile();

  const first = await runYtDlp(buildArgs(target, cookiesPath, process.env.YTDLP_EXTRACTOR_ARGS));
  if (first.fatalError) return { success: false, error: first.fatalError };
  if (first.ok) return parseOutput(first.stdout, query);
  console.error(`[yt-dlp] Failed (stderr tail): ${first.stderr.trim().slice(-800)}`);

  // YouTube's datacenter-IP bot check: retry once with player clients that
  // currently don't require a PO token and usually bypass the challenge.
  if (isBotCheckError(first.stderr)) {
    console.warn(`[yt-dlp] Bot check hit — retrying with player_client=${FALLBACK_CLIENTS}`);
    const retry = await runYtDlp(buildArgs(target, cookiesPath, `youtube:player_client=${FALLBACK_CLIENTS}`));
    if (retry.fatalError) return { success: false, error: retry.fatalError };
    if (retry.ok) return parseOutput(retry.stdout, query);
    console.error(`[yt-dlp] Fallback clients also failed (stderr tail): ${retry.stderr.trim().slice(-800)}`);
    return {
      success: false,
      error:
        "YouTube is blocking this server's IP (“confirm you're not a bot”) and the fallback clients " +
        'also failed. The reliable fix is giving the bot YouTube cookies — see the “YouTube bot check” ' +
        'section of the README (YTDLP_COOKIES).',
    };
  }

  // The PyInstaller binary reports internal crashes as "[PYI-n:ERROR]", which
  // is meaningless to users — the real traceback was logged above.
  const errorLine = lastErrorLine(first.stderr);
  if (!errorLine || /PYI-\d+:ERROR/.test(errorLine)) {
    return { success: false, error: 'yt-dlp crashed unexpectedly — check the server logs for the traceback.' };
  }
  return { success: false, error: `YouTube: ${errorLine.slice(0, 300)}` };
}
