// Independent reviewed pins. Updating SQL requires explicit review of these fingerprints.
export const MIGRATION_PINS=Object.freeze([
  {name:'0001_local_game.sql',sha256:'53bbef142bba945d89cc7fe4fa79124aabcbed9cc82672d47d84dca3474a5ec2'},
  {name:'0002_oauth_vault.sql',sha256:'114d6310d4f1847957712b172d6092f0ac5ecd9c7be3257da75487b0c81d6e43'},
  {name:'0003_staging_auth_test.sql',sha256:'5651bb41bbb92905b0263c914114856cc9a2d8cdf482403b85cda90e45f056cc'},
].map(Object.freeze));
export const FIXTURE_TABLES=Object.freeze(['game_state','transaction_guard','participants','activities','rewards','invitations','oauth_attempts','oauth_credentials','oauth_sessions']);
export const STAGE_TABLES=Object.freeze(FIXTURE_TABLES.map(name=>'staging_auth_'+name));
export const HISTORY_SQL='CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);';
// Read only: unlike `d1 migrations list`, never creates the history table.
// D1 remote rejects the old 11-term compound SELECT. VALUES has no compound-SELECT
// term limit; only three UNION branches remain, with the same fixed result columns.
export const STAGING_D1_READ_QUERY="WITH fixture_counts(name,value) AS (VALUES "+FIXTURE_TABLES.map(name=>`('${name}',(SELECT COUNT(*) FROM ${name}))`).join(',')+") SELECT 'migration' AS kind,name,id AS value FROM d1_migrations UNION ALL SELECT 'rows',name,value FROM fixture_counts UNION ALL SELECT 'schema-table',name,0 FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'";
export const BACKUP_ID=/^[a-f0-9]{24}$/;
export const MAX_BACKUP_BYTES=64*1024*1024;
