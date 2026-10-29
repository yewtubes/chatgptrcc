// Boots the web client in headless Chromium, records the console and takes a
// screenshot.  Usage: node tools/run_headless.js [seconds] [query] [out.png]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const secs = +(process.argv[2] || 60);
const query = process.argv[3] || '';
const shot = process.argv[4] || path.resolve(__dirname, '..', 'screenshots', 'latest.png');
const logFile = shot.replace(/\.png$/, '.log');
fs.mkdirSync(path.dirname(shot), { recursive: true });

(async () => {
  const server = require('./server.js');
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
      '--enable-features=WebAssemblyJSPromiseIntegration,SharedArrayBuffer',
      '--js-flags=--experimental-wasm-jspi', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  fs.writeFileSync(logFile, '');
  const t0 = Date.now();
  const w = (s) => fs.appendFileSync(logFile, `[${((Date.now() - t0) / 1000).toFixed(1)}] ${s}\n`);
  let lines = 0;
  if (process.env.GLDEBUG) await page.addInitScript(() => {
    const P = WebGL2RenderingContext.prototype, stats = (window.__glStats = {});
    for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'clear', 'useProgram', 'texImage2D', 'texSubImage2D', 'compressedTexImage2D', 'bindFramebuffer']) {
      const o = P[k];
      P[k] = function (...a) { stats[k] = (stats[k] || 0) + 1; return o.apply(this, a); };
    }
    const cs = P.compileShader;
    P.compileShader = function (sh) {
      cs.call(this, sh);
      stats.compiled = (stats.compiled || 0) + 1;
      if (!this.getShaderParameter(sh, this.COMPILE_STATUS) && (stats.compileFail = (stats.compileFail || 0) + 1) <= 3)
        console.error('[gl] compile failed:', this.getShaderInfoLog(sh), '\n', this.getShaderSource(sh));
    };
    const lp = P.linkProgram;
    P.linkProgram = function (pr) {
      lp.call(this, pr);
      if (!this.getProgramParameter(pr, this.LINK_STATUS) && (stats.linkFail = (stats.linkFail || 0) + 1) <= 3)
        console.error('[gl] link failed:', this.getProgramInfoLog(pr));
    };
    setInterval(() => console.log('[gl] stats ' + JSON.stringify(stats)), 5000);
  });
  page.on('console', (m) => {
    const t = m.text();
    if (/\[MAIN\] heartbeat/.test(t)) return;
    w(`${m.type()}: ${t}`);
    if (++lines < 400 || /error|abort|crash|exception/i.test(t)) console.log(`${m.type()}: ${t.slice(0, 400)}`);
  });
  page.on('pageerror', (e) => { w(`PAGEERROR: ${e.stack || e}`); console.log('PAGEERROR', String(e.stack || e).slice(0, 1500)); });
  page.on('crash', () => { w('PAGE CRASHED'); console.log('PAGE CRASHED'); });
  page.on('worker', (wk) => wk.on('console', (m) => w(`worker ${m.type()}: ${m.text()}`)));
  await page.goto(`http://localhost:${server.address().port}/${query}`);
  const step = 10;
  for (let s = 0; s < secs; s += step) {
    await page.waitForTimeout(step * 1000);
    await page.screenshot({ path: shot }).catch((e) => console.log('screenshot failed', e.message));
  }
  console.log('screenshot:', shot, 'log:', logFile);
  await browser.close();
  server.close();
})();
