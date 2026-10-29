// Builds webclient/overlay/ (served before webclient/files/):
//  - ExtraContent/models/UniversalApp/UniversalApp.rbxm with the Lua App entry
//    point (CoreScripts.LuaAppStarterScript) replaced by playsolo/PlaySolo.lua
//  - ExtraContent/places/Mobile.rbxl = the place to play (default: World HQ)
// Usage: node tools/build_playsolo.js [place.rbxl]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const R = require('./rbxm.js');
const ROOT = path.resolve(__dirname, '..');
const W = path.join(ROOT, 'webclient');
const OV = path.join(W, 'overlay');
const place = process.argv[2] || path.join(ROOT, 'places', 'WorldHQ.rbxl');

// 1. compile the bootstrap
const bc = path.join(OV, 'PlaySolo.bin');
fs.mkdirSync(OV, { recursive: true });
execFileSync(path.join(ROOT, 'tools/luauc/luauc'), [path.join(ROOT, 'playsolo/PlaySolo.lua'), bc]);
const bytecode = fs.readFileSync(bc);
fs.unlinkSync(bc);

// 2. Build the Lua App patch from the in-experience patch, so the 2026 in-game
// CoreScripts (StarterScript, chat, topbar, ...) and their CorePackages are
// present. The engine starts PatchRoot.CoreScripts.LuaAppStarterScript; a
// test-only module is renamed to that and given the bootstrap's bytecode.
const src = path.join(W, 'files/ExtraContent/models/InExperience/InExperience.rbxm');
const HOST = 'PatchRoot.CoreScripts.CoreScripts/jest.config';
const m = R.read(src);
const idx = R.index(m);
let target = null;
for (const o of idx.inst.values()) if (R.fullName(idx, o.ref) === HOST) target = o;
if (!target) throw new Error(HOST + ' not found');
const cls = idx.classes.get(target.classId);
const pos = cls.refs.indexOf(target.ref);
function setProp(name, value) {
  for (const c of m.chunks) {
    if (c.name !== 'PROP' || c.data.readUInt32LE(0) !== cls.id) continue;
    const [prop, p0] = R.rdStr(c.data, 4);
    if (prop !== name) continue;
    const type = c.data[p0];
    let p = p0 + 1;
    const vals = [];
    for (let i = 0; i < cls.refs.length; i++) {
      const n = c.data.readUInt32LE(p);
      vals.push(c.data.subarray(p + 4, p + 4 + n));
      p += 4 + n;
    }
    vals[pos] = value;
    const parts = [c.data.subarray(0, p0), Buffer.from([type])];
    for (const v of vals) { const l = Buffer.alloc(4); l.writeUInt32LE(v.length); parts.push(l, v); }
    c.data = Buffer.concat([...parts, c.data.subarray(p)]);
    return;
  }
  throw new Error('property ' + name + ' not found');
}
setProp('Name', Buffer.from('LuaAppStarterScript'));
setProp('Source', bytecode);
console.log(`${HOST} -> LuaAppStarterScript (${bytecode.length} bytes of bytecode)`);
const outModel = path.join(OV, 'ExtraContent/models/UniversalApp/UniversalApp.rbxm');
fs.mkdirSync(path.dirname(outModel), { recursive: true });
R.write(m, outModel);

// 3. the place
const outPlace = path.join(OV, 'ExtraContent/places/Mobile.rbxl');
fs.mkdirSync(path.dirname(outPlace), { recursive: true });
fs.copyFileSync(place, outPlace);
console.log(`place: ${place} -> ${path.relative(ROOT, outPlace)}`);
