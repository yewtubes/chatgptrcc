// Local dev server for the web client.
//   /                 -> webclient/WebClient.html
//   /<file>           -> webclient/<file> (WasmPlayer.js, WasmLoader.js, ...)
//   /engine/<path>    -> webclient/<path>, falling back to webclient/files/<path>
// Sends COOP/COEP so SharedArrayBuffer is available.
const http = require('http'), fs = require('fs'), path = require('path');
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
    try { out.push({ path: f.path, size: fs.statSync(path.join(ROOT, 'files', f.path)).size }); } catch {}
  }
  console.log(`metadata: ${out.length}/${files.length} files present`);
  return (metadataCache = JSON.stringify(out));
}

const server = http.createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p.includes('..')) return send(res, 400, 'bad path');
  if (p === '/') return serveFile(req, res, path.join(ROOT, 'WebClient.html'));
  if (p === '/engine/WebClient.metadata.json') { log(req, 200); return send(res, 200, metadata(), 'application/json'); }
  if (p === '/engine/WebClient.wasm' && fs.existsSync(path.join(ROOT, 'WebClient.patched.wasm')))
    return serveFile(req, res, path.join(ROOT, 'WebClient.patched.wasm'));
  if (p.startsWith('/engine/')) {
    const rel = p.slice('/engine/'.length);
    const direct = path.join(ROOT, rel);
    return fs.stat(direct, (err, st) => serveFile(req, res, !err && st.isFile() ? direct : path.join(ROOT, 'files', rel)));
  }
  return serveFile(req, res, path.join(ROOT, p));
});
server.listen(PORT, () => console.log(`web client on http://localhost:${PORT}/`));
module.exports = server;
