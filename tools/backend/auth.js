// Local accounts and sessions. Passwords are scrypt-hashed, session tokens are
// random and stored as SHA-256 only. Tokens are this platform's own: they are
// never Roblox cookies, and Roblox cookies sent by a client are not accepted.
const crypto = require('crypto');
const { open, now } = require('./db.js');
const { cookies } = require('./http.js');

const WEB_COOKIE = 'RBXLocalSession';
// Studio expects a .ROBLOSECURITY cookie after login; ours carries a local token
// with this prefix so it can't be mistaken for (or replayed as) a Roblox cookie.
const STUDIO_PREFIX = '_|LOCAL-PLATFORM-SESSION|_';
const DAY = 86400e3;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${h.toString('base64')}`;
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  const [kind, n, salt, h] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 32, { N: +n, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, Buffer.from(h, 'base64'));
}

const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;
function validateNewUser({ username, password, displayName }) {
  if (!NAME_RE.test(username || '')) return 'Usernames are 3-20 letters, digits or underscores.';
  if (/^_|_$/.test(username) || (username.match(/_/g) || []).length > 1) return 'Usernames can contain one underscore, not at either end.';
  if (!password || password.length < 8) return 'Passwords need at least 8 characters.';
  if (displayName && !/^[\p{L}\p{N}_ ]{3,20}$/u.test(displayName)) return 'Display names are 3-20 letters, digits, spaces or underscores.';
  if (open().prepare('SELECT 1 FROM users WHERE name = ?').get(username)) return 'That username is taken.';
  return null;
}
function createUser({ username, password, displayName, birthdate }) {
  const r = open().prepare(`INSERT INTO users (name, display_name, password_hash, birthdate, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(username, displayName || username, password ? hashPassword(password) : null, birthdate || null, now());
  return getUser(Number(r.lastInsertRowid));
}
function getUser(id) {
  return open().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}
function getUserByName(name) {
  return open().prepare('SELECT * FROM users WHERE name = ?').get(name) || null;
}

function createSession(userId, kind, { days = 30, scope = null, userAgent = null } = {}) {
  const t = token();
  open().prepare(`INSERT INTO sessions (token_hash, user_id, kind, scope, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(sha(t), userId, kind, scope, now(), new Date(Date.now() + days * DAY).toISOString(), userAgent);
  return t;
}
function sessionFor(t, kinds) {
  if (!t) return null;
  const s = open().prepare(`SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?`).get(sha(t), now());
  if (!s || (kinds && !kinds.includes(s.kind))) return null;
  open().prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now(), s.token_hash);
  return s;
}
function revokeSession(t) {
  open().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
}

// The signed-in user for a request:
//  - browser: the RBXLocalSession cookie (same-origin /proxy/ requests carry it)
//  - Studio: .ROBLOSECURITY holding one of our studio tokens
//  - OAuth bearer tokens issued by our /oauth/v1/token
function userFromRequest(req) {
  const c = cookies(req);
  let s = sessionFor(c[WEB_COOKIE], ['web']);
  const sec = c['.ROBLOSECURITY'];
  if (!s && sec && sec.startsWith(STUDIO_PREFIX)) s = sessionFor(sec.slice(STUDIO_PREFIX.length), ['studio']);
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!s && bearer) s = sessionFor(bearer[1], ['oauth-access']);
  if (!s) return null;
  const u = getUser(s.user_id);
  return u && !u.is_banned ? u : null;
}

function webCookie(t, maxAgeDays = 30) {
  return `${WEB_COOKIE}=${t}; Path=/; Max-Age=${maxAgeDays * 86400}; HttpOnly; SameSite=Lax`;
}

// Age bracket as Roblox reports it: 0 = 13 or over, 1 = under 13.
function ageOf(u) {
  if (!u.birthdate) return null;
  const b = new Date(u.birthdate), n = new Date();
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--;
  return a;
}
const isUnder13 = (u) => { const a = ageOf(u); return a === null || a < 13; };

module.exports = {
  WEB_COOKIE, STUDIO_PREFIX, hashPassword, checkPassword, validateNewUser, createUser, getUser, getUserByName,
  createSession, sessionFor, revokeSession, userFromRequest, webCookie, ageOf, isUnder13, sha, token,
};
