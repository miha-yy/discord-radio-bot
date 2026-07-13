import http from 'node:http';
import { getActiveGuildCount } from './voice.js';

/**
 * Minimal HTTP server so the bot can run as a Render Web Service: Render only
 * considers a web service live once the process binds to PORT and answers
 * health checks. The endpoint also doubles as a keep-alive target for
 * external pingers (Render's free tier spins services down without traffic).
 */
export function startHealthServer(isDiscordReady: () => boolean): http.Server {
  const port = Number(process.env.PORT) || 3000;

  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          discord: isDiscordReady() ? 'connected' : 'connecting',
          activeVoiceSessions: getActiveGuildCount(),
        })
      );
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Health server listening on port ${port}`);
  });

  return server;
}
