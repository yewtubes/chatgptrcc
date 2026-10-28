# WebClient bring-up notes

## Content files
`tools/fetch_content.sh` rebuilds `webclient/files/` (gitignored) from the public
Windows Player and Studio packages on setup.rbxcdn.com.

- 10,752 of the 30,566 files in `WebClient.metadata.json` are covered, including
  CoreScripts (`ExtraContent/scripts`, from Studio's `extracontent-scripts.zip`).
- Still missing:
  - `ExtraContent/Workspace/**` (19,567 Lua App packages). Not needed in-game.
  - `shaders/shaders_glsles3_web.pack`. The Windows packages only ship d3d10/d3d11/glsl3/vulkan
    packs. Without it the engine can't render; candidates are converting
    `shaders_glsl3.pack` or using a GLSL ES 3 pack from the Android build.
  - A few small items: `content/hidden/rcc`, `content/guac`, `ExtraContent/Reactions`,
    `ExtraContent/animations`.
- RccService packages are not public (403); the last RCC entry in
  DeployHistory.txt is from January 2021.

## What WasmPlayer.js expects
- `window.__wasmLoaderContext = { engineBase, server, channel, workerStubUrl }`.
- Loads `${engineBase}/WebClient.js`, then calls the global `createWebClient(Module)`
  (an Emscripten `MODULARIZE` build, `EXPORT_NAME=createWebClient`).
- Passes in `wasmMemory` (shared, `FIntWasmMemoryPages`, default 32768 pages = 2 GiB),
  `instantiateWasm`, `locateFile`, `mainScriptUrlOrBlob` (pthread worker script).
- After init it uses wasm exports via `cwrap` (`rbx_fs_*`, `init_ring_buffers`,
  `on_virtual_text_changed`, ...) and embind functions on `Module`
  (`set_wasm_host_base_url`, `set_roblox_base_url`, `set_socket_proxy`,
  `set_preloaded_flags`, `set_place_id`, ...).
- Assets are fetched lazily from `${engineBase}${path}`.
- Page elements used: `#canvas`, `#server`, `#proxyenabled`, `#loading-overlay`,
  `#status`, `#input-container`, `#input-textarea`, `#input-input`.
- Local relay mode (`FFlagDebugLocalRccServerConnection=True`) opens
  `wss://localhost/local-relay`, sends `hello from browser` then `forward <dest>`,
  waits for `forwarding`, then relays binary frames.

## What WebClient.js has to provide
- 271 imports (266 `env`, 5 `wasi_snapshot_preview1`). There are no filesystem syscalls;
  the engine has its own VFS (`rbx_fs_*`, `js_fetch_file`, `rbx_opfs_*`).
- The standard Emscripten runtime: pthreads, embind, WebGL2, html5 events,
  websocket, fetch, stack traces, time functions.
- Roblox-specific JS functions (EM_JS/EM_ASYNC_JS, bodies not in the wasm):
  `js_fetch_file`, `rbx_opfs_*`, `rbx_wasm_rna_*`, fiber functions
  (`__asyncjs__fiber_transfer_js`, ...), `__asyncjs__rbxFutexWaitMainJspi`,
  text input helpers, `schedule_main_loop`, `read_host_info_*`, `report_crash`, etc.
- 65 EM_ASM call sites (`emscripten_asm_const_*`). Their code strings were
  stripped from the wasm (the addresses point at zeroed memory), so each must be
  rebuilt from the decompiled call site.
- The wasm has no producers section. Its thread exports match a recent
  Emscripten (5.x/6.x).
