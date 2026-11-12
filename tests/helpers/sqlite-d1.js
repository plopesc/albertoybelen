import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function sqliteD1(path = ':memory:', migrate = true) {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys=ON');
  if (migrate) for (const name of readdirSync(new URL('../../backend/d1/migrations/', import.meta.url)).sort()) sqlite.exec(readFileSync(new URL(`../../backend/d1/migrations/${name}`, import.meta.url), 'utf8'));
  const db = {
    sqlite,
    prepare(sql) {
      const prepared = sqlite.prepare(sql);
      return { bind(...values) { return {
        first: async () => prepared.get(...values) ?? null,
        all: async () => ({ results: prepared.all(...values) }),
        run: async () => prepared.run(...values),
        execute: () => prepared.run(...values),
      }; } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
    close() { sqlite.close(); },
  };
  return db;
}
