import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';

export function validateDdevProject(project, mounted, siteName) {
  const name = /^name:\s*([^\n#]+)/m.exec(project)?.[1].trim().replace(/^['"]|['"]$/g, '');
  if (project !== mounted || name !== 'albertoybelen' || (siteName && siteName !== 'albertoybelen')) throw new Error('Expected existing albertoybelen DDEV project; no changes made');
}
export function assertDdevProject() {
  try {
    validateDdevProject(readFileSync('/var/www/html/.ddev/config.yaml','utf8'), readFileSync('/mnt/ddev_config/config.yaml','utf8'), process.env.DDEV_SITENAME);
  } catch { throw new Error('Expected existing albertoybelen DDEV project; no changes made'); }
}
/** Probe loopback only. Never kill, replace or reuse a listening service. */
export async function assertPortsFree(ports) {
  const held = [];
  try {
    for (const port of ports) {
      const server = createServer();
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen({host:'127.0.0.1',port,exclusive:true}, resolve); });
      held.push(server);
    }
  } catch { throw new Error('Required local port occupied; stop and identify its owner manually'); }
  finally { await Promise.all(held.map(server => new Promise(resolve => server.close(resolve)))); }
}
