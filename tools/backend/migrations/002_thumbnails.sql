-- Thumbnail render jobs. Thumbnails are rendered by the Studio render worker
-- (tools/studio/render_worker.js), the way RCC renders them for Roblox; until a
-- render exists the thumbnail APIs answer state "Pending".
CREATE TABLE thumbnails (
  key          TEXT PRIMARY KEY,           -- <kind>:<targetId>:<w>x<h>:<inputHash>
  kind         TEXT NOT NULL,              -- avatar | avatar-headshot | avatar-bust | place
  target_id    INTEGER NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  input_hash   TEXT NOT NULL,              -- hash of what is rendered (avatar JSON, place version)
  input        TEXT NOT NULL,              -- JSON the renderer needs
  state        TEXT NOT NULL DEFAULT 'Pending', -- Pending | Rendering | Completed | Error
  sha256       TEXT REFERENCES content(sha256),
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  requested_at TEXT NOT NULL,
  claimed_at   TEXT,
  completed_at TEXT
);
CREATE INDEX thumbnails_state ON thumbnails(state, requested_at);
CREATE INDEX thumbnails_target ON thumbnails(kind, target_id, width, height);
