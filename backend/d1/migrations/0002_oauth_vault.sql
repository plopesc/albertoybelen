CREATE TABLE oauth_credentials (
 participant_id TEXT PRIMARY KEY REFERENCES participants(id),
 generation INTEGER NOT NULL CHECK(generation>=0), version INTEGER NOT NULL CHECK(version>0),
 key_version TEXT NOT NULL, nonce TEXT NOT NULL CHECK(length(nonce)=16),
 ciphertext TEXT NOT NULL CHECK(length(ciphertext)>20), UNIQUE(key_version,nonce)
);
CREATE TABLE oauth_sessions (
 hash TEXT PRIMARY KEY CHECK(length(hash)=64 AND hash NOT GLOB '*[^0-9a-f]*'),
 expires_at REAL NOT NULL
);
