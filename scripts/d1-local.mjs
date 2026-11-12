import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const operation = process.argv[2];
const commands = {
  migrate: ['d1', 'migrations', 'apply', 'DB', '--local'],
  dev: ['dev', '--local', '--test-scheduled'],
};
if (process.argv.length !== 3 || !commands[operation]) throw new Error('Only migrate or dev are allowed; no additional arguments');
const environment = { ...process.env, CLOUDFLARE_SEND_METRICS: 'false', WRANGLER_LOG_PATH: '.local/wrangler.log' };
for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CLOUDFLARE_ACCOUNT_ID']) delete environment[name];
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...commands[operation], '--config', 'wrangler.local.jsonc', '--persist-to', '.local/d1'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit', env: environment,
});
process.exit(result.status ?? 1);
