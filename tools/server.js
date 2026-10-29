// Local dev server for the web client.
//   /                 -> webclient/WebClient.html
//   /<file>           -> webclient/<file> (WasmPlayer.js, WasmLoader.js, ...)
//   /engine/<path>    -> webclient/<path>, falling back to webclient/files/<path>
// Sends COOP/COEP so SharedArrayBuffer is available.
const http = require('http'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', 'webclient');
const PORT = +process.env.PORT || 8080;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json',
  '.png': 'image/png', '.ttf': 'font/ttf', '.otf': 'font/otf' };

function send(res, code, body, type = 'text/plain') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}
function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { log(req, 404); return send(res, 404, 'not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
    log(req, 200);
  });
}
function log(req, code) {
  if (code !== 200 || process.env.VERBOSE) console.log(code, req.method, req.url);
}
// WebClient.metadata.json lists the web build's own content files; ours come from
// other platforms' packages, so sizes differ and some files are missing. Serve a
// version that matches what is on disk (the engine sizes its read buffers from it).
let metadataCache = null;
function metadata() {
  if (metadataCache) return metadataCache;
  const files = JSON.parse(fs.readFileSync(path.join(ROOT, 'WebClient.metadata.json'), 'utf8'));
  const out = [];
  for (const f of files) {
    for (const dir of ['overlay', 'files']) {
      try { out.push({ path: f.path, size: fs.statSync(path.join(ROOT, dir, f.path)).size }); break; } catch {}
    }
  }
  console.log(`metadata: ${out.length}/${files.length} files present`);
  return (metadataCache = JSON.stringify(out));
}

// /proxy/<url>: forwards the engine's web requests (it uses this form when its
// CORS proxy is enabled). curl is used because it honours HTTPS_PROXY.
const PROXY_HOSTS = /(^|\.)(roblox\.com|rbxcdn\.com)$/;
function proxy(req, res, rest) {
  let target = rest.replace(/^(https?):\/(?!\/)/, '$1://');
  if (!/^https?:\/\//.test(target)) target = 'https://' + target;
  // Drop the engine's own ?auth= parameter without re-encoding the rest of the
  // query (CDN URLs carry signed tokens).
  target = target.replace(/([?&])auth=[^&]*(&|$)/, (m, a, b) => (b ? a : '')).replace(/[?&]$/, '');
  let u;
  try { u = new URL(target); } catch { return send(res, 400, 'bad url'); }
  if (!PROXY_HOSTS.test(u.hostname)) return send(res, 403, 'host not allowed');
  // Local game server: answer the place launcher with a join script that points
  // at RCC_HOST:RCC_PORT (reached through /local-relay).
  if (u.hostname === 'gamejoin.roblox.com' && /^\/v1\/join-game/.test(u.pathname)) {
    const host = process.env.RCC_HOST || '127.0.0.1', port = +(process.env.RCC_PORT || 53640);
    const placeId = +(process.env.PLACE_ID || 1818);
    const session = JSON.stringify({ SessionId: crypto.randomUUID(), GameId: '00000000-0000-0000-0000-000000000001', PlaceId: placeId });
    const joinScript = {
      ClientPort: 0, MachineAddress: host, ServerPort: port,
      ServerConnections: [{ Address: host, Port: port }], UdmuxEndpoints: [], DirectServerReturn: true,
      TokenGenAlgorithm: 0, PepperId: 0, TokenValue: '', PingUrl: '', PingInterval: 0,
      UserName: 'Player1', DisplayName: 'Player1', SeleniumTestMode: false, UserId: 1,
      RobloxLocale: 'en_us', GameLocale: 'en_us', SuperSafeChat: false, FlexibleChatEnabled: false,
      CharacterAppearance: '', ClientTicket: '', GameId: '00000000-0000-0000-0000-000000000001', PlaceId: placeId,
      BaseUrl: 'https://www.roblox.com/', ChatStyle: 'ClassicAndBubble', CreatorId: 1, CreatorTypeEnum: 'User',
      MembershipType: 'None', AccountAge: 365, CookieStoreFirstTimePlayKey: '', CookieStoreFiveMinutePlayKey: '',
      CookieStoreEnabled: false, IsUnknownOrUnder13: false, GameChatType: 'AllUsers', SessionId: session,
      AnalyticsSessionId: '', DataCenterId: 0, UniverseId: 1, FollowUserId: 0, characterAppearanceId: 1,
      CountryCode: 'US', RandomSeed1: '', ClientPublicKeyData: '',
    };
    console.log(`gamejoin: join script -> ${host}:${port}`);
    return send(res, 200, JSON.stringify({ jobId: '00000000-0000-0000-0000-000000000001', status: 2, statusData: null,
      joinScriptUrl: null, authenticationUrl: null, authenticationTicket: null, message: null, joinScript, queuePosition: 0 }), 'application/json');
  }
  // Telemetry stays local.
  if (/^(ephemeralcounters\.api|ecsv2|client-telemetry|metrics|lms|tracing)\.roblox\.com$/.test(u.hostname) ||
      /experience-signals-ingest|\/pbe$|otel|analytics|telemetry/.test(u.pathname)) {
    return send(res, 200, '{}', 'application/json');
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const args = ['-sS', '-L', '--compressed', '-m', '30', '-X', req.method, '-D', '-', '-o', '-', target];
    for (const h of ['content-type', 'accept', 'roblox-place-id', 'x-csrf-token']) if (req.headers[h]) args.push('-H', `${h}: ${req.headers[h]}`);
    if (chunks.length) args.push('--data-binary', '@-');
    const c = spawn('curl', args);
    const out = [];
    c.stdout.on('data', (d) => out.push(d));
    c.on('close', () => {
      let buf = Buffer.concat(out);
      // curl -D - writes header blocks (one per redirect) before the body
      let status = 502, type = 'application/octet-stream';
      for (;;) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0 || !/^HTTP\//.test(buf.toString('latin1', 0, 5))) break;
        const head = buf.toString('latin1', 0, end);
        status = +head.split(' ')[1] || status;
        const ct = /\ncontent-type:\s*([^\r\n]+)/i.exec(head);
        if (ct) type = ct[1];
        buf = buf.subarray(end + 4);
      }
      if (process.env.VERBOSE || status >= 400) console.log('proxy', status, req.method, u.href.slice(0, 160));
      res.writeHead(status, { 'Content-Type': type });
      res.end(buf);
    });
    if (chunks.length) c.stdin.end(Buffer.concat(chunks)); else c.stdin.end();
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p.includes('..')) return send(res, 400, 'bad path');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', '*'); return send(res, 204, ''); }
  if (req.url.startsWith('/proxy/')) return proxy(req, res, req.url.slice('/proxy/'.length));
  if (p === '/') return serveFile(req, res, path.join(ROOT, 'WebClient.html'));
  if (p === '/engine/WebClient.metadata.json') { log(req, 200); return send(res, 200, metadata(), 'application/json'); }
  if (p === '/engine/WebClient.wasm' && fs.existsSync(path.join(ROOT, 'WebClient.patched.wasm')))
    return serveFile(req, res, path.join(ROOT, 'WebClient.patched.wasm'));
  if (p.startsWith('/engine/')) {
    const rel = p.slice('/engine/'.length);
    const candidates = [path.join(ROOT, rel), path.join(ROOT, 'overlay', rel), path.join(ROOT, 'files', rel)];
    const hit = candidates.find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    return serveFile(req, res, hit || candidates[2]);
  }
  return serveFile(req, res, path.join(ROOT, p));
});
// RCC_HOST/RCC_PORT override where "forward <host>:<port>" goes (e.g. a Studio
// test server on another machine).
require('./relay.js').attach(server, '/local-relay', {
  resolve: (h, p) => [process.env.RCC_HOST || h, +(process.env.RCC_PORT || p)],
});
server.listen(PORT, () => console.log(`web client on http://localhost:${PORT}/`));
module.exports = server;
