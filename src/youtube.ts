import { spawn } from 'node:child_process';

/**
 * YouTube playback is resolved through the yt-dlp binary (no fragile npm
 * wrapper): we ask it for the video title and a direct bestaudio URL, then
 * feed that URL into the exact same FFmpeg pipeline the radio stations use.
 * yt-dlp must be on PATH (or set YTDLP_PATH); the Dockerfile installs it.
 */

const RESOLVE_TIMEOUT_MS = 30_000;

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

/**
 * Resolve a YouTube URL or free-text search query to a playable audio URL.
 * Free text is resolved via yt-dlp's `ytsearch1:` (top search result).
 */
export async function resolveYouTube(input: string): Promise<YouTubeResolveResult> {
  const query = input.trim();
  if (!query) return { success: false, error: 'Give me a YouTube link or a search query.' };

  const target = looksLikeUrl(query) ? query : `ytsearch1:${query}`;
  const args = [
    '--no-playlist',
    '--no-warnings',
    '-f', 'bestaudio/best',
    '--print', 'title',
    '--print', 'is_live',
    '--print', 'webpage_url',
    '--print', 'urls',
    '--',
    target,
  ];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: YouTubeResolveResult) => {
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
      resolve({ success: false, error: `Could not start yt-dlp: ${error.message}` });
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      finish({ success: false, error: 'YouTube lookup timed out after 30s. Try again.' });
    }, RESOLVE_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        finish({
          success: false,
          error:
            'YouTube support needs the `yt-dlp` binary, which is not installed on this host. ' +
            'Install it (e.g. `winget install yt-dlp` / `apt install yt-dlp`) or set YTDLP_PATH.',
        });
      } else {
        finish({ success: false, error: `yt-dlp failed to start: ${err.message}` });
      }
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const errorLine = stderr
          .split('\n')
          .reverse()
          .find((l) => l.includes('ERROR'))
          ?.replace(/^ERROR:\s*/i, '')
          .trim();
        finish({
          success: false,
          error: errorLine
            ? `YouTube: ${errorLine.slice(0, 300)}`
            : `yt-dlp exited with code ${code}.`,
        });
        return;
      }

      const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length < 4) {
        finish({
          success: false,
          error: looksLikeUrl(query)
            ? 'yt-dlp returned no playable stream for that link.'
            : `No YouTube results for \`${query}\`.`,
        });
        return;
      }

      const [title, isLiveRaw, webUrl, streamUrl] = lines;
      finish({
        success: true,
        track: {
          title,
          streamUrl,
          isLive: isLiveRaw.toLowerCase() === 'true',
          webUrl: looksLikeUrl(webUrl) ? webUrl : null,
        },
      });
    });
  });
}
