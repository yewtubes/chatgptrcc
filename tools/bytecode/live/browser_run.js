// Runs the original game page. Optional CDP breakpoints only read VM memory.
// No WebAssembly bytes, flags, instruction results or memory are changed.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('playwright');
const OUT = path.resolve(process.env.EVIDENCE_DIR || 'ci-evidence');
fs.mkdirSync(OUT, { recursive: true });
const capture = process.argv.includes('--capture');
const label = capture ? 'capture' : 'baseline';
const LOADER_OFFSET = 86082284;
const CORRUPTED_OFFSET = 86093212;
const WASM_SHA = 'd72c52618f5c153c9b17a97e644914d43918c7122d754d96f79e8323acc6a15d';
const WATCHED_CHUNK = /(?:^|\.)(?:BytecodeAuditSmall|BytecodeAuditLarge|PlayerModule|PlayerScriptsLoader|RbxCharacterSounds|Animate)(?:$|\.)/;
const wasmFile = path.resolve('webclient/live/version-75f1039cb4964863/WebClient.wasm');
if (crypto.createHash('sha256').update(fs.readFileSync(wasmFile)).digest('hex') !== WASM_SHA)
  throw new Error('Unsupported WebClient fingerprint');
const logFile = path.join(OUT, `${label}-browser.log`);
const log = (s) => { fs.appendFileSync(logFile, s + '\n'); if (/Replicator|bytecode corrupted|AUDIT_|PAGEERROR/i.test(s)) console.log(s.slice(0, 800)); };

async function attachCapture(browser) {
  const port = 9337;
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0, hits = 0, playerModuleCaptured = false, playerModuleRejected = false;
  const watchedName = (pointer) => `(() => {
    const h = new Uint8Array(memories[0].buffer), p = ${pointer};
    let end = p; while (end < h.length && h[end] && end - p < 4096) ++end;
    return ${WATCHED_CHUNK}.test(new TextDecoder().decode(h.slice(p, end)));
  })()`;
  const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(n, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async (frame, expression, session) => {
    const response = await send('Debugger.evaluateOnCallFrame', { callFrameId: frame, expression, returnByValue: true }, session);
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  };
  const unbox = (x) => x && typeof x === 'object' && 'value' in x ? x.value : x;
  const event = async ({ method, params, sessionId }) => {
    if (method === 'Target.attachedToTarget') {
      const session = params.sessionId;
      await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, session);
      await send('Debugger.enable', {}, session);
      await send('Runtime.runIfWaitingForDebugger', {}, session);
    } else if (method === 'Debugger.scriptParsed' && params.scriptLanguage === 'WebAssembly' && params.length > LOADER_OFFSET) {
      try {
        for (const offset of [LOADER_OFFSET, CORRUPTED_OFFSET]) {
          const pointer = offset === LOADER_OFFSET ? 'new DataView(memories[0].buffer).getUint32($var1.value + 24, true)' : '$var30.value';
          const result = await send('Debugger.setBreakpoint', { location: { scriptId: params.scriptId, lineNumber: 0, columnNumber: offset }, condition: watchedName(pointer) }, sessionId);
          log(`capture breakpoint ${result.breakpointId} session=${sessionId}`);
        }
      } catch (e) { log(`capture breakpoint error: ${e.message}`); }
    } else if (method === 'Debugger.paused') {
      try {
        if (hits >= 32) return;
        const frame = params.callFrames[0];
        if (frame.location.columnNumber === CORRUPTED_OFFSET) {
          const state = await evaluate(frame.callFrameId, `(() => {
            const h = new Uint8Array(memories[0].buffer), p = $var30.value;
            let end = p; while (end < h.length && h[end] && end - p < 4096) ++end;
            const d = new DataView(h.buffer);
            // Read the effective policy in the same paused loader invocation.
            // Static defaults and LocalFlags.json alone do not establish it.
            const validationPolicy = Object.fromEntries([
              ['LsbOptimizationDetail', 8106748], ['LsbImproveCompatibilityReport', 8106760],
              ['LsbOptimizeMax', 8106784], ['LsbOptimizeMin', 8106796], ['LsbValidateMin', 8106808]
            ].map(([name, address]) => [name, d.getInt32(address, true)]));
            return { chunk: new TextDecoder().decode(h.slice(p, end)), errorOffset: ${CORRUPTED_OFFSET}, local2: $var2.value, version: $var33.value, validationPolicy };
          })()`, sessionId);
          fs.appendFileSync(path.join(OUT, 'rejections.jsonl'), JSON.stringify(state) + '\n');
          if (/(?:^|\.)PlayerModule$/.test(state.chunk)) playerModuleRejected = true;
          log(`loader rejection ${JSON.stringify(state)}`);
          return;
        }
        const context = unbox(await evaluate(frame.callFrameId, '$var1', sessionId));
        if (!Number.isInteger(context) || context <= 0) throw new Error('load context was not an i32 pointer');
        const descriptor = await evaluate(frame.callFrameId, `(() => {
          const h = new Uint8Array(memories[0].buffer), d = new DataView(h.buffer), c = ${context};
          const name = d.getUint32(c + 24, true), data = d.getUint32(c + 28, true), size = d.getUint32(c + 32, true);
          let end = name; while (end < h.length && h[end] && end - name < 4096) ++end;
          return { chunk: new TextDecoder().decode(h.slice(name, end)), data, size };
        })()`, sessionId);
        if (!descriptor || !WATCHED_CHUNK.test(descriptor.chunk)) return;
        if (descriptor.size > 16 * 1024 * 1024 || descriptor.data + descriptor.size > 2147483648)
          throw new Error('capture outside diagnostic bounds');
        const n = ++hits;
        const chunks = [];
        for (let offset = 0; offset < descriptor.size; offset += 32768) {
          const bytes = await evaluate(frame.callFrameId,
            `Array.from(new Uint8Array(memories[0].buffer).slice(${descriptor.data + offset}, ${descriptor.data + Math.min(offset + 32768, descriptor.size)}))`, sessionId);
          if (!Array.isArray(bytes)) throw new Error('byte capture did not return an array');
          chunks.push(Buffer.from(bytes));
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.length !== descriptor.size) throw new Error('partial memory capture');
        const file = `receiver-${String(n).padStart(3, '0')}.bc`;
        fs.writeFileSync(path.join(OUT, file), bytes);
        const row = { file, chunk: descriptor.chunk, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), version: bytes[0], types: bytes[1] };
        fs.appendFileSync(path.join(OUT, 'receiver.jsonl'), JSON.stringify(row) + '\n');
        if (/(?:^|\.)PlayerModule$/.test(row.chunk)) playerModuleCaptured = true;
        log(`captured ${JSON.stringify(row)}`);
      } catch (e) { log(`capture error: ${e.stack || e}`); }
      finally { await send('Debugger.resume', {}, sessionId).catch(() => {}); }
    }
  };
  socket.onmessage = (message) => {
    const value = JSON.parse(message.data);
    if (value.id && pending.has(value.id)) {
      const p = pending.get(value.id); pending.delete(value.id); clearTimeout(p.timer);
      if (value.error) p.reject(new Error(JSON.stringify(value.error))); else p.resolve(value.result || {});
    } else if (value.method) event(value).catch((e) => log(`CDP event error: ${e.stack || e}`));
  };
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  return { close: () => socket.close(), count: () => hits, playerModuleDone: () => playerModuleCaptured && playerModuleRejected };
}

(async () => {
  const server = require('../../server.js');
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
      '--enable-features=WebAssemblyJSPromiseIntegration,SharedArrayBuffer', '--js-flags=--experimental-wasm-jspi',
      '--autoplay-policy=no-user-gesture-required', ...(capture ? ['--remote-debugging-port=9337'] : [])] });
  let debuggerSession;
  try {
    if (capture) debuggerSession = await attachCapture(browser);
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const base = `http://127.0.0.1:${server.address().port}`;
    const credentials = { username: capture ? 'AuditCapture' : 'AuditBaseline', password: 'local-test-password', birthdate: '2000-01-01' };
    const response = await fetch(base + '/api/local/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
    if (!response.ok) throw new Error(`local signup failed ${response.status}: ${await response.text()}`);
    const token = /RBXLocalSession=([^;]+)/.exec(response.headers.get('set-cookie'))?.[1];
    if (!token) throw new Error('local session cookie absent');
    await context.addCookies([{ name: 'RBXLocalSession', value: token, domain: 'localhost', path: '/', httpOnly: true }]);
    const page = await context.newPage();
    page.on('console', (m) => log(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => log(`PAGEERROR: ${e.stack || e}`));
    page.on('crash', () => log('PAGE CRASHED'));
    await page.goto(`http://localhost:${server.address().port}/games/start?placeId=1818`);
    if (process.env.PLAYERMODULE_TRACE_ONLY) {
      const deadline = Date.now() + 150000;
      while (Date.now() < deadline && !debuggerSession.playerModuleDone()) await page.waitForTimeout(1000);
      log(`PlayerModule trace complete=${debuggerSession.playerModuleDone()} captures=${debuggerSession.count()}`);
      await context.close();
      return;
    }
    for (let elapsed = 0; elapsed < (capture ? 150 : 90); elapsed += 10) {
      await page.waitForTimeout(10000);
      await page.screenshot({ path: path.join(OUT, `${label}.png`) }).catch((e) => log(`screenshot ${e.message}`));
    }
    await page.mouse.click(640, 360);
    const input = { start: Date.now(), key: 'KeyW' };
    await page.keyboard.down('KeyW');await page.waitForTimeout(1500);await page.keyboard.up('KeyW');
    input.end = Date.now();fs.writeFileSync(path.join(OUT, `${label}-input.json`), JSON.stringify(input));
    await page.screenshot({ path: path.join(OUT, `${label}-after-w.png`) });
    log(`read-only capture count ${debuggerSession?.count() || 0}`);
    await context.close();
  } finally { debuggerSession?.close();await browser.close();await new Promise((r) => server.close(r)); }
})().catch((e) => { log(`FATAL ${e.stack || e}`); console.error(e); process.exitCode = 1; });
