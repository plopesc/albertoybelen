import { lstatSync } from 'node:fs';
export function assertPrivateFiles(directory, filename) {
  const dir = lstatSync(directory), file = lstatSync(filename);
  if (!dir.isDirectory() || !file.isFile() || (dir.mode & 0o077) || (file.mode & 0o077)) throw new Error('Private directory/file permissions required; symbolic links not allowed');
}
