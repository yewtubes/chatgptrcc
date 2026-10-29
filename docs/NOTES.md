# Roblox WASM web client: local bring-up

This repo runs Roblox's WebAssembly client (`webclient/WebClient.wasm`,
`WasmPlayer.js`, `WebFlags.json`, `WebClient.metadata.json`) in a browser,
without any Roblox web infrastructure. Some parts of the original deployment
were never shipped, so they are rebuilt here.

What works:

- The engine boots, runs its main loop and renders with WebGL2 (headless
  Chromium with SwiftShader is enough).
- Play Solo: ROBLOX World Headquarters (from Roblox/Old-Open-Source-Levels)
  loads, a local player spawns, and WASD/space/mouse controls work.
- The networked join path up to the wire: fake place-launcher response, the
  `local-relay` WebSocket transport, and a WebSocket→UDP relay. The client
  sends RakNet connection requests to `RCC_HOST:RCC_PORT`.

What does not exist here is a game server. RccService is not public, and
Roblox Studio (which runs under Wine in this container) needs a Roblox account
login before it will host anything.

## Running

```bash
tools/setup.sh                 # content files, patched wasm, luauc, Play Solo overlay
node tools/server.js           # http://localhost:8080/
```

Open http://localhost:8080/ in Chrome or Edge (JSPI and WebGL2 are needed).
Controls: WASD/arrows move, space jumps, Q/E or right-drag turns the camera,
and the mouse wheel zooms.

Headless screenshot (the result goes to `screenshots/latest.png`, with a log next to it):

```bash
node tools/run_headless.js 40
KEYS="w:3000,space:300" node tools/run_headless.js 40    # also presses keys
GLDEBUG=1 node tools/run_headless.js 30                  # WebGL call counts / shader errors
```

To play a different place, run `node tools/build_playsolo.js path/to/place.rbxl`.

Joining a real server through the relay: run `RCC_HOST=<server ip>
RCC_PORT=<udp port> node tools/server.js` and open
`/?placeId=1818&flags=FFlagDebugLocalRccServerConnection=True`.

## Pieces

| Piece | What it is |
|---|---|
| `webclient/WebClient.js` | The Emscripten JS runtime, generated from the wasm with `emcc --post-link` (`tools/build_glue.sh`) |
| `webclient/glue/rbxlib.js` | Reimplemented Roblox imports: fibers on JSPI, main-thread futex wait, synchronous asset fetch, ring buffers, host info, text input, GL buffer mapping, and stubs for the OPFS cache, RNA transport and WebView |
| `webclient/glue/em_asm.py` | The 65 EM_ASM snippets, rebuilt from their call sites (the code strings were stripped from the wasm) |
| `webclient/WasmLoader.js`, `WebClient.html` | The loader context and page that WasmPlayer.js expects, plus local dev settings |
| `tools/server.js` | Dev server: COOP/COEP, content overlay, metadata rewritten from disk, `/proxy/` for engine web requests (telemetry is answered locally), fake `gamejoin`, `/local-relay` |
| `tools/patch_wasm.js` | Two local patches to the served wasm (the original file is untouched) |
| `tools/luauc/` | Luau compiler that emits the client's bytecode format (opcodes ×227, 8-byte prefix) |
| `tools/rbxm.js` | Binary rbxm/rbxl reader and writer |
| `playsolo/PlaySolo.lua` | Play Solo bootstrap; replaces the Lua App entry script |

### Content
`tools/fetch_content.sh` builds `webclient/files/` from the public Windows
Player and Studio packages. That covers 10,752 of the 30,566 listed files,
including CoreScripts; most of the rest are Lua App test packages.
`shaders_glsles3_web.pack` is not public, so the desktop `shaders_glsl3.pack`
is used, and `rbxConvertShader` in rbxlib.js rewrites GLSL 1.50 into
GLSL ES 3.00 at `glShaderSource` time.

### Wasm patches (`tools/patch_wasm.js`)
1. The `DataModelPatchConfigurer` signature check always passes (func 116001).
   The bundled Lua App patch is the Windows package's copy, whose signature
   the web build rejects.
2. `luau_load` no longer stops at "bytecode corrupted" (func 147667). The
   client expects a footer on bytecode, which our own compiled bootstrap
   lacks. Bytecode that has a footer still loads as before.

### Play Solo
The Lua App DataModel loads `rbxasset://places/Mobile.rbxl`. The overlay
serves the chosen place under that name and puts the compiled
`PlaySolo.lua` in place of `PatchRoot.CoreScripts.LuaAppStarterScript` in
`UniversalApp.rbxm`. The bootstrap calls `Players:CreateLocalPlayer()`,
`RunService:Run()` and `player:LoadCharacter()`. Avatar assets need a login,
so the character gets a classic look from built-in meshes.

### Rebuilding WebClient.js
Rebuilding is only needed after changing `rbxlib.js` or `em_asm.py`. It needs
an Emscripten checkout with `tools/emscripten-local.patch` applied, which:
injects the EM_ASM bodies, skips native library builds in `--post-link`, and
assumes wasm features (the `target_features` section was stripped). It also
needs a config whose LLVM_ROOT holds stand-ins for `clang --version` and
`llvm-objcopy` (copy-through), plus binaryen (`npm i binaryen`). Then run:

```bash
EM_CONFIG=... tools/build_glue.sh
```

## Notes on the client
- Version 0.745.0.7451142, Emscripten pthreads build with JSPI and wasm
  exceptions, 2 GiB shared memory, no Emscripten filesystem (it has its own
  VFS).
- Lua App and in-experience CoreScripts come from the signed patch models
  `UniversalApp.rbxm` and `InExperience.rbxm`, as encoded Luau bytecode. The
  `.lua` files in `ExtraContent/scripts` are not used.
- The engine has `NetworkServer`/`ServerReplicator` code, but it does not
  expose starting a server to Lua.
