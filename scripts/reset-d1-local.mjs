import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
if (process.argv.length !== 3 || process.argv[2] !== 'local-fixtures') throw new Error('Requires explicit local-fixtures confirmation; stop local dev first');
// Fixed worktree-local path. No account, database ID or arbitrary path accepted.
rmSync(fileURLToPath(new URL('../.local/d1', import.meta.url)), {recursive:true,force:true});
console.log('Local fixture files removed. Apply local migrations again. No remote resources accessed.');
