import http from 'node:http';
import worker from './worker.js';
await worker.scheduled({ scheduledTime: Date.parse('2026-11-02T12:00:00Z') });
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const response = await worker.fetch(new Request(`http://localhost:8787${incoming.url}`, { method: incoming.method, headers: incoming.headers }));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(await response.text());
  } catch { outgoing.writeHead(500, { 'Cache-Control': 'no-store' }); outgoing.end('Local prototype error'); }
});
server.listen(8787, '127.0.0.1', () => console.log('Fixture API: http://127.0.0.1:8787/api/progress (loopback only)'));
