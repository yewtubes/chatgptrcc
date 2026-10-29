-- Platform data for the self-hosted backend. Every row here belongs to this
-- platform: accounts are local accounts, not Roblox accounts.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT,                      -- scrypt$N$salt$hash; NULL = cannot log in with a password
  description   TEXT NOT NULL DEFAULT '',
  birthdate     TEXT,                      -- YYYY-MM-DD; drives age bracket and policy
  country_code  TEXT NOT NULL DEFAULT 'US',
  locale        TEXT NOT NULL DEFAULT 'en_us',
  is_banned     INTEGER NOT NULL DEFAULT 0,
  is_service    INTEGER NOT NULL DEFAULT 0, -- accounts used by game servers / Studio
  created_at    TEXT NOT NULL
);

-- Browser and Studio sessions. Only a SHA-256 of the token is stored.
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,              -- web | studio | oauth-access | oauth-refresh
  scope        TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT,
  user_agent   TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE oauth_codes (
  code_hash  TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id  TEXT,
  scope      TEXT,
  challenge  TEXT,
  expires_at TEXT NOT NULL
);

CREATE TABLE universes (
  id              INTEGER PRIMARY KEY,
  root_place_id   INTEGER,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  creator_type    TEXT NOT NULL DEFAULT 'User',   -- User | Group
  creator_id      INTEGER NOT NULL,
  privacy         TEXT NOT NULL DEFAULT 'Public', -- Public | Private
  avatar_type     TEXT NOT NULL DEFAULT 'MorphToR15',
  genre           TEXT NOT NULL DEFAULT 'All',
  max_players     INTEGER NOT NULL DEFAULT 10,
  visits          INTEGER NOT NULL DEFAULT 0,
  favorites       INTEGER NOT NULL DEFAULT 0,
  icon_asset_id   INTEGER,
  thumbnail_asset_id INTEGER,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE places (
  id          INTEGER PRIMARY KEY,
  universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  file_path   TEXT,                        -- place file the game server loads
  version     INTEGER NOT NULL DEFAULT 1,
  max_players INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX places_universe ON places(universe_id);

CREATE TABLE avatars (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  avatar_type TEXT NOT NULL DEFAULT 'R15',
  body_colors TEXT NOT NULL,               -- JSON {head,torso,leftArm,rightArm,leftLeg,rightLeg}: BrickColor ids
  scales      TEXT NOT NULL,               -- JSON
  assets      TEXT NOT NULL DEFAULT '[]',  -- JSON [{id, assetTypeId}]
  emotes      TEXT NOT NULL DEFAULT '[]',
  updated_at  TEXT NOT NULL
);

-- Content-addressed blobs (files under <data>/content/<sha256>).
CREATE TABLE content (
  sha256     TEXT PRIMARY KEY,
  md5        TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX content_md5 ON content(md5);

CREATE TABLE assets (
  id             INTEGER PRIMARY KEY,
  asset_type_id  INTEGER NOT NULL DEFAULT 0,
  name           TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  creator_type   TEXT NOT NULL DEFAULT 'User',
  creator_id     INTEGER NOT NULL DEFAULT 1,
  is_public      INTEGER NOT NULL DEFAULT 1,
  source         TEXT NOT NULL,            -- local | import | fallback:<service>
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE asset_versions (
  asset_id     INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  sha256       TEXT NOT NULL REFERENCES content(sha256),
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  created_at   TEXT NOT NULL,
  PRIMARY KEY (asset_id, version)
);

-- Every asset request the local store could not satisfy, and what happened.
CREATE TABLE asset_misses (
  asset_key  TEXT PRIMARY KEY,             -- "id:<n>" or "hash:<h>"
  first_at   TEXT NOT NULL,
  last_at    TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 1,
  outcome    TEXT NOT NULL,                -- missing | fallback-ok | fallback-denied | fallback-error
  detail     TEXT
);

CREATE TABLE game_servers (
  job_id           TEXT PRIMARY KEY,
  place_id         INTEGER NOT NULL,
  host             TEXT NOT NULL,
  port             INTEGER NOT NULL,       -- RakNet UDP port
  transport_port   INTEGER,                -- RbxTransport (WebTransport/QUIC) port
  cert_hash        TEXT,                   -- hex SHA-256 of the transport certificate
  max_players      INTEGER NOT NULL DEFAULT 10,
  status           TEXT NOT NULL DEFAULT 'active', -- active | closed
  source           TEXT NOT NULL,          -- registered | studio-log | env
  started_at       TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL
);
CREATE INDEX game_servers_place ON game_servers(place_id, status);

CREATE TABLE game_sessions (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id       TEXT NOT NULL,
  place_id     INTEGER NOT NULL,
  universe_id  INTEGER NOT NULL,
  joined_at    TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  left_at      TEXT
);
CREATE INDEX game_sessions_job ON game_sessions(job_id, left_at);

CREATE TABLE presence (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  presence_type  INTEGER NOT NULL DEFAULT 0, -- 0 offline, 1 online, 2 in game, 3 in studio
  place_id       INTEGER,
  universe_id    INTEGER,
  job_id         TEXT,
  last_location  TEXT NOT NULL DEFAULT '',
  last_online_at TEXT NOT NULL
);

CREATE TABLE friendships (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

-- Per-user settings the client reads and writes (e.g. localization choice).
CREATE TABLE user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
