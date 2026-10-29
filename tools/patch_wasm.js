// Applies local patches to WebClient.wasm and writes webclient/WebClient.patched.wasm,
// which tools/server.js serves in place of the original.
//
// A patch replaces a function body with `i32.const <v>; return`, padded with nops,
// so the body size (and every other offset in the module) stays the same.
const fs = require('fs'), path = require('path');
const W = path.resolve(__dirname, '..', 'webclient');

// Defined-function indexes (as in a binaryen dump, i.e. excluding imports).
const PATCHES = [
  // DataModelPatchConfigurer signature verification of the bundled Lua App patch.
  // The bundled UniversalApp.rbxm comes from the Windows package, whose signature
  // the web build rejects ("No signatures in the model could be verified").
  { func: 116001, ret: 1, why: 'accept bundled UniversalApp patch signature' },
];

const buf = Buffer.from(fs.readFileSync(path.join(W, 'WebClient.wasm')));
let p = 8;
const leb = () => { let r = 0, s = 0, b; do { b = buf[p++]; r |= (b & 127) << s; s += 7; } while (b & 128); return r >>> 0; };
let codeStart = -1;
while (p < buf.length) {
  const id = buf[p++], len = leb(), end = p + len;
  if (id === 10) { codeStart = p; break; }
  p = end;
}
p = codeStart;
const count = leb();
const bodies = [];
for (let i = 0; i < count; i++) { const size = leb(); bodies.push([p, size]); p += size; }

for (const pt of PATCHES) {
  const [start, size] = bodies[pt.func];
  // locals: 0 groups; i32.const v (signed LEB, small); return; nops...; end
  const code = [0x00, 0x41, pt.ret & 0x3f, 0x0f];
  if (size < code.length + 1) throw new Error(`body of ${pt.func} too small`);
  for (let i = 0; i < size; i++) buf[start + i] = i < code.length ? code[i] : 0x01;
  buf[start + size - 1] = 0x0b;
  console.log(`patched func ${pt.func} (${size} bytes): ${pt.why}`);
}
fs.writeFileSync(path.join(W, 'WebClient.patched.wasm'), buf);
console.log('wrote webclient/WebClient.patched.wasm');
