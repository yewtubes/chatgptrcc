#!/usr/bin/env node
// Summarises data/logs/requests.jsonl: each endpoint called (ids folded to {id}),
// who called it (web client or Studio), how often, and the statuses returned.
//   node tools/routes_seen.js [--unrouted]
const fs = require('fs'), path = require('path');
const { DATA } = require('./backend/db.js');
const onlyUnrouted = process.argv.includes('--unrouted');
const rows = fs.readFileSync(path.join(DATA, 'logs', 'requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const seen = new Map();
for (const r of rows) {
  if (r.host === 'setup.rbxcdn.com' || (onlyUnrouted && r.route)) continue;
  const k = `${r.method} ${r.host}${r.path.replace(/\d{3,}/g, '{id}').replace(/version-[0-9a-f]+/, '{version}')}`;
  const e = seen.get(k) || { n: 0, status: new Set(), via: new Set(), routed: r.route };
  e.n++; e.status.add(r.status); e.via.add(r.via);
  seen.set(k, e);
}
for (const [k, e] of [...seen].sort()) console.log(`${String(e.n).padStart(5)}  ${[...e.via].join('+').padEnd(10)} ${[...e.status].join(',').padEnd(8)} ${e.routed ? '' : '[unrouted] '}${k}`);
