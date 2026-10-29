// Post-processes the generated WebClient.js:
// - EM_ASM lookups fall back to a logger for addresses we have no body for.
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
let js = fs.readFileSync(src, 'utf8');
const fallback = `
var rbxUnknownEmAsmSeen = {};
function rbxEmAsm(addr) {
  var f = ASM_CONSTS[addr];
  if (f) return f;
  if (!rbxUnknownEmAsmSeen[addr]) { rbxUnknownEmAsmSeen[addr] = 1; console.warn('[rbx] unknown EM_ASM', addr); }
  return () => 0;
}
`;
let n = 0;
js = js.replace(/assert\(ASM_CONSTS\.hasOwnProperty\((\w+)\)[^;]*;/g, () => (n++, ''));
js = js.replace(/ASM_CONSTS\[(\w+)\]\(/g, (m, v) => (n++, `rbxEmAsm(${v})(`));
js = js.replace(/var func = emAsmAddr \? ASM_CONSTS\[emAsmAddr\]/, (m) => (n++, 'var func = emAsmAddr ? rbxEmAsm(emAsmAddr)'));
js = js.replace('var ASM_CONSTS = {', fallback + 'var ASM_CONSTS = {');
// WasmPlayer passes a few Module properties this build does not consume.
js = js.replace(/abort\(`\\`Module\.\$\{prop\}\\` was supplied but/, (m) => (n++, m.replace('abort(', 'console.warn(')));
// Desktop GLSL -> GLSL ES conversion (see rbxConvertShader in rbxlib.js).
js = js.replace('GLctx.shaderSource(GL.shaders[shader], source);', (m) => (n++, 'GLctx.shaderSource(GL.shaders[shader], rbxConvertShader(source));'));
fs.writeFileSync(dst, js);
console.log('patched', n, 'EM_ASM sites');
