-- Separate staging OAuth TEST dataset. Existing fixture/pilot tables and rows are untouched.
-- Same projection schema as 0001/0002, isolated from the fixture namespace.
CREATE TABLE staging_auth_game_state (
 id TEXT PRIMARY KEY CHECK(id='staging-strava-test-v1'),
 revision INTEGER NOT NULL CHECK(revision>=0),
 document TEXT NOT NULL CHECK(json_valid(document))
);
CREATE TABLE staging_auth_transaction_guard (id INTEGER PRIMARY KEY CHECK(id=1), valid INTEGER NOT NULL CHECK(valid=1));
CREATE TABLE staging_auth_participants (
 id TEXT PRIMARY KEY CHECK(id IN ('slot-a','slot-b')),
 generation INTEGER NOT NULL CHECK(generation>=0),
 connected INTEGER NOT NULL CHECK(connected IN (0,1)),
 deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
 initial_reconciled INTEGER NOT NULL CHECK(initial_reconciled IN (0,1)),
 stale INTEGER NOT NULL CHECK(stale IN (0,1)),
 scopes TEXT NOT NULL CHECK(json_valid(scopes)), synced_at TEXT,
 CHECK(NOT (connected=1 AND deleted=1))
);
CREATE TABLE staging_auth_activities (
 participant_id TEXT NOT NULL REFERENCES staging_auth_participants(id),
 activity_id TEXT NOT NULL CHECK(length(activity_id)>0),
 start_utc TEXT NOT NULL CHECK(start_utc LIKE '%Z' AND julianday(start_utc) IS NOT NULL), distance_meters REAL NOT NULL CHECK(distance_meters>=0),
 valid_meters REAL NOT NULL CHECK(valid_meters>=0), sport_type TEXT,
 manual INTEGER NOT NULL CHECK(manual IN (0,1)), private INTEGER NOT NULL CHECK(private IN (0,1)),
 PRIMARY KEY(participant_id, activity_id)
);
CREATE TABLE staging_auth_rewards (id TEXT PRIMARY KEY CHECK(length(id)>0));
CREATE TABLE staging_auth_invitations (
 hash TEXT PRIMARY KEY CHECK(length(hash)=64 AND hash NOT GLOB '*[^0-9a-f]*'),
 participant_id TEXT NOT NULL REFERENCES staging_auth_participants(id), generation INTEGER NOT NULL CHECK(generation>=0),
 expires_at REAL NOT NULL, status TEXT NOT NULL CHECK(status IN ('issued','reserved','used','revoked'))
);
CREATE TABLE staging_auth_oauth_attempts (
 state_hash TEXT PRIMARY KEY CHECK(length(state_hash)=64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
 invitation_hash TEXT NOT NULL REFERENCES staging_auth_invitations(hash),
 participant_id TEXT NOT NULL REFERENCES staging_auth_participants(id), generation INTEGER NOT NULL CHECK(generation>=0),
 session_hash TEXT NOT NULL CHECK(length(session_hash)=64 AND session_hash NOT GLOB '*[^0-9a-f]*'),
 expires_at REAL NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','invalidated','expired','cancelled','failed','completed'))
);

INSERT INTO staging_auth_participants VALUES('slot-a',0,0,0,0,0,'[]',NULL);
INSERT INTO staging_auth_participants VALUES('slot-b',0,0,0,0,0,'[]',NULL);

CREATE TABLE staging_auth_oauth_credentials (
 participant_id TEXT PRIMARY KEY REFERENCES staging_auth_participants(id),
 generation INTEGER NOT NULL CHECK(generation>=0), version INTEGER NOT NULL CHECK(version>0),
 key_version TEXT NOT NULL, nonce TEXT NOT NULL CHECK(length(nonce)=16),
 ciphertext TEXT NOT NULL CHECK(length(ciphertext)>20), UNIQUE(key_version,nonce)
);
CREATE TABLE staging_auth_oauth_sessions (
 hash TEXT PRIMARY KEY CHECK(length(hash)=64 AND hash NOT GLOB '*[^0-9a-f]*'),
 expires_at REAL NOT NULL
);
