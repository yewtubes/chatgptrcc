// Persistent platform database (SQLite through Node's built-in node:sqlite, no
// dependencies). Location: $DATA_DIR/platform.db (default <repo>/data/).
// Migrations in ./migrations/NNN_*.sql run once each, in order.
const fs = require('fs'), path = require('path');

// node:sqlite prints an ExperimentalWarning on load; it is stable enough for this.
const emit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...a));
const { DatabaseSync } = require('node:sqlite');
process.emitWarning = emit;

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const SEED = path.join(ROOT, 'config', 'seed.json');

const now = () => new Date().toISOString();

let db = null;
function open() {
  if (db) return db;
  fs.mkdirSync(DATA, { recursive: true });
  db = new DatabaseSync(path.join(DATA, 'platform.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  seed(db);
  return db;
}

function migrate(d) {
  d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(d.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const dir = path.join(__dirname, 'migrations');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    d.exec('BEGIN');
    try {
      d.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      d.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(f, now());
      d.exec('COMMIT');
      console.log(`db: applied migration ${f}`);
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
  }
}

// config/seed.json: the platform's initial users, universes and places. Only
// rows whose id is not in the database yet are inserted, so edits made later
// through the API or tools/admin.js are kept.
function seed(d) {
  let s;
  try { s = JSON.parse(fs.readFileSync(SEED, 'utf8')); } catch { return; }
  const t = now();
  for (const u of s.users || []) {
    if (d.prepare('SELECT 1 FROM users WHERE id = ?').get(u.id)) continue;
    d.prepare(`INSERT INTO users (id, name, display_name, description, birthdate, is_service, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(u.id, u.name, u.displayName || u.name, u.description || '', u.birthdate || null, u.isService ? 1 : 0, t);
    console.log(`db: seeded user ${u.id} ${u.name}`);
  }
  for (const g of s.universes || []) {
    if (d.prepare('SELECT 1 FROM universes WHERE id = ?').get(g.id)) continue;
    d.prepare(`INSERT INTO universes (id, root_place_id, name, description, creator_type, creator_id, max_players, genre, avatar_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(g.id, g.rootPlaceId, g.name, g.description || '', g.creatorType || 'User', g.creatorId,
      g.maxPlayers || 10, g.genre || 'All', g.avatarType || 'MorphToR15', t, t);
    for (const p of g.places || []) {
      d.prepare(`INSERT OR IGNORE INTO places (id, universe_id, name, description, file_path, max_players, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, g.id, p.name || g.name, p.description || g.description || '', p.file || null, p.maxPlayers || null, t, t);
    }
    console.log(`db: seeded universe ${g.id} ${g.name}`);
  }
}

module.exports = { open, now, DATA, ROOT };
