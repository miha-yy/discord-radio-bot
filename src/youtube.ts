import { spawn } from 'node:child_process';

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

const RESOLVE_TIMEOUT_MS = 30_000;

const FALLBACK_CLIENTS = process.env.YTDLP_FALLBACK_CLIENTS ?? 'web_embedded,android_vr,tv';

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
      finish({ ok: false, stdout, stderr, fatalError: 'YouTube lookup timed out after 30s. Try again.' });
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

function buildArgs(target: string, extractorArgs?: string): string[] {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '-f', 'bestaudio/best',
    '--print', 'title',
    '--print', 'is_live',
    '--print', 'webpage_url',
    '--print', 'urls',
  ];
  if (process.env.YTDLP_COOKIES) {
    args.push('--cookies', process.env.YTDLP_COOKIES);
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

  const first = await runYtDlp(buildArgs(target, process.env.YTDLP_EXTRACTOR_ARGS));
  if (first.fatalError) return { success: false, error: first.fatalError };
  if (first.ok) return parseOutput(first.stdout, query);

  // YouTube's datacenter-IP bot check: retry once with player clients that
  // currently don't require a PO token and usually bypass the challenge.
  if (isBotCheckError(first.stderr)) {
    console.warn(`[yt-dlp] Bot check hit — retrying with player_client=${FALLBACK_CLIENTS}`);
    const retry = await runYtDlp(buildArgs(target, `youtube:player_client=${FALLBACK_CLIENTS}`));
    if (retry.fatalError) return { success: false, error: retry.fatalError };
    if (retry.ok) return parseOutput(retry.stdout, query);
    console.error(`[yt-dlp] Fallback clients also failed: ${lastErrorLine(retry.stderr) ?? 'unknown error'}`);
    return {
      success: false,
      error:
        "YouTube is blocking this server's IP (“confirm you're not a bot”) and the fallback clients " +
        'also failed. The reliable fix is giving the bot YouTube cookies — see the “YouTube bot check” ' +
        'section of the README (YTDLP_COOKIES).',
    };
  }

  const errorLine = lastErrorLine(first.stderr);
  return {
    success: false,
    error: errorLine ? `YouTube: ${errorLine.slice(0, 300)}` : 'yt-dlp failed.',
  };
}
