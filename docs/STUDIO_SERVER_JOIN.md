# Roblox's web client joining a Studio server: findings

Working log for running Roblox's own, unmodified web client (page, WasmLoader,
WasmPlayer, WebClient.js, WebClient.wasm 0.745.0.7451145) against Roblox Studio
0.745.0.7451137 as the game server under Wine. Keep this file current; it is the
record that survives context loss.

## Status (2026-10-29)

| Step | State |
|---|---|
| Studio server starts with Baseplate / Grow a Garden | works (`tools/studio/run_server.sh`) |
| Real web client boots from the local server | works (`/games/start?placeId=1818`) |
| Join through our backend (`tools/backend.js`) | works |
| WebTransport handshake to Studio's RbxTransport | works when Studio and Chrome are on separate cores |
| Replicator created, world and character replicate | works |
| Game client scripts run (LocalScripts, Animate, PlayerModule) | **broken: the client receives 0-byte bytecode** |

## How to reproduce the working connection

```bash
tools/studio/setup_env.sh                       # after a container restart: /etc/hosts, Xvfb, studio backend
tools/studio/run_server.sh /home/user/studio/prefix/drive_c/places/Baseplate.rbxl 53640
RCC_HOST=127.0.0.1 RCC_PORT=53640 taskset -c 2,3 node tools/run_headless.js 75 'games/start?placeId=1818' screenshots/real-join.png
```

- `run_server.sh` pins Studio to `STUDIO_CPUS` (default `0,1`) and sets
  `LP_NUM_THREADS=1`. Studio's server window renders through llvmpipe; unpinned
  it takes ~250% CPU on 4 cores and Chrome's QUIC handshake misses its 4 s idle
  timeout (netlog: server ACKs Initial, no TLS reply). Run Chrome on the other
  cores (`taskset -c 2,3`).
- The backend reads the RbxTransport port from the newest Studio log
  (`Started RbxTransport network server 0.0.0.0|PORT`; the port is random,
  `-rbxTransportPort` breaks the server) and the certificate's SHA-256 with
  `tools/studio/wt_cert_hash.py`.
- Join script: `NetStackPort`, `NetStackTokenValue` (base64 "local_test"),
  `GameFqdn`, `NetStackConfig` = `{"certHashes":["<base64 sha256>"]}`.
  The engine form-decodes that value before it reaches WebClient.js (`atob`), so
  a `+` arrives as a space ("InvalidCharacterError"). The backend sends `+` as
  `%2B`. A hash without `+` worked before that fix, which made it look flaky.
- Logs of a good run: `screenshots/real-join.log` (Replicator created,
  then `CreatorError: Error: <script>` for every game script).

## Studio binary patches (`tools/studio/patch_studio.py`)

Original kept as `/home/user/studio/app/RobloxStudioBeta.exe.orig`
(sha256 781b36ed…). Applied:

1. `0x1460b5a32` `75 4b` → `90 90`: script registration compiles with target 2
   even when the server is not in team-test mode. Confirmed effective:
   with `DFLogTeamTest=7` the log shows `[DFLog::TeamTest] Compiling script: …`.
2. Three `movzx r9d, byte [r14+8]` → `mov r9b,1` at 0x145f43fab / 0x145f456e9 /
   0x145f47555 (the property serializer's calls to getBytecode 0x14604e1b0).
   **No effect: gdb shows those sites and getBytecode are never reached during
   a join.** These were a wrong guess. They should be reverted once the real
   path is known; they are harmless for now.

## Script bytecode: what is known

- Failing scripts (Baseplate.rbxl as uploaded, which is not an empty Baseplate:
  it has GUIs and Lighting.Inject):
  `Players.Player1.PlayerScripts.{LocalScript, PlayerScriptsLoader, RbxCharacterSounds}`,
  `Lighting.Inject`, `Players.Player1.PlayerGui.Freecam.FreecamScript`,
  `Players.Player1.PlayerGui.SelectUI.Frame.LocalScript`, `Workspace.Player1.Animate`.
- Client side: the engine's script loader (function 105853 in 7451142) gets
  `size == 0` for each of them (`tools/debug_break.js`, `FUNC=105853 SIZE=13`),
  then treats ≤8 bytes as error bytecode and logs `Error: <chunkname>`.
- The web client has no Luau compiler, so it needs compiled bytecode from the server.
- Server side, during one join (gdb attached to the Studio process, image base
  0x140000000, no ASLR under Wine):
  - registration `0x1460b5830` fires 6 times (the per-player script clones);
  - getBytecode `0x14604e1b0`, its lookup `0x1460b0380` and fetch `0x1460b0480`
    are never called.
  So the property serializer that would call getBytecode is not the path that
  sends these scripts.
- Registry layout (NetworkServer): map at `+0xf40` keyed by script → {id, target};
  entries in vector `+0xf20..+0xf28` (40 bytes each: [+0] source/bytecode
  string, [+0x10]/[+0x18] bytecode for target 0/2, [+0x21]/[+0x22] ready flags);
  a second hash table at `+0x1038/+0x1058` (`0x1460b03d0`, keyed by a 64-bit value,
  likely a content hash) with 9 callers elsewhere. This might be a hash →
  bytecode cache for a separate request path.
- Team-test mode: `[NetworkServer+0x230]` (1 = team test, set by
  `0x1460ade90`; 2 = cloud edit). Local Studio servers leave it 0.
- Relevant flags: `CompileLuauLazily`, `UseScriptReplicationTarget` (lazy
  per-target compile in fetch), `AddClientBytecodeCompileTimeToRCCInstanceTracking`,
  `LoadRawBytecodeWithHashKey`, client `DebugBypassTeamTestSignatureVerification`
  and the string "Bytecode Auth Check missing or wrong version.".

## Version check

- Live metadata (`WebClient.metadata.json`, upload `version-75f1039cb4964863`)
  is only a list of 2862 `{path,size}` content files (86.7 MB: textures, fonts,
  avatar rbxm, LuaPackages, `shaders/shaders_glsles3_web.pack`). It carries no
  version or protocol data and no game-script bytecode; all files are mirrored
  in `webclient/live/<upload>/` by `tools/fetch_webclient.sh`.
- `client-version.json`: 0.745.0.7451145. Studio: 0.745.0.7451137. Same release
  (0.745), different build numbers. The replication handshake and instance
  replication agree in practice; the script bytecode format is not yet verified.

## Next steps

1. Find the code that actually writes the script source/bytecode for a peer
   (break on the 9 callers of `0x1460b03d0`, and on writes of
   ProtectedString-typed properties), then compare with Studio's own client
   joining the same server (`-task StartClient`), which works.
2. Check whether the client asks for bytecode by hash on a separate
   request (the `+0x1038` cache) that the browser never sends or gets no answer for.
