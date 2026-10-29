# Independent Luau bytecode compatibility audit

Date: 2026-10-29. Source: `yewtubes/robloxwebclient`, branch
`claude/modest-bell-uutg9v`, commit `f09b616b710a028ae22635d3f56b98162ef8895f`.
Destination: `yewtubes/chatgptrcc`. Work was performed in a separate clone.

## Findings

| Question | Evidence | Conclusion and limit |
|---|---|---|
| Does 0.744 output have an unsupported version? | Compiler emits bytecode 13, types 3. Disassembly of the exact client accepts ordinary versions 3–14, types 1–3 (and a separate class-version case). | These header versions are compatible. This does not guarantee every opcode or optional feature is compatible with Roblox's fork. |
| Are opcodes/AUX words serialized correctly? | For empty, closure/table/loop, and import/vector/method-call fixtures, independently locating instruction regions and undoing only opcode multiplication reproduces plain upstream compilation byte for byte. Recovered code loads in upstream VM 0.744; closure fixture executes and returns 42. | No encoding defect reproduced for these fixtures. This is not execution in Roblox's VM. |
| Is RSB1 packaging internally sound? | Independent raw-zstd-block golden fixture, pinned zstd/XXH32, binary round trips through 1 MiB, and original local_rcc producer comparison. | Existing successful output matches the reference packaging. An RSB1 checksum is not a cryptographic script signature. |
| Did fixes change successful output? | The 369-byte sample source produces 512 bytes of encoded Luau and a 369-byte RSB1 container. Baseline and fixed RSB1 SHA-256 are identical. | Sample wire output is unchanged. No network/schema/Studio patch sites were edited. |
| Is there a further client validation requirement? | Exact loader enters a separate validation path after header checks and before string/prototype decoding; this path can emit `bytecode corrupted`. It checks for additional data and calls a format parser/validator. Signature/hash-key configuration also exists in this build. | Stock Luau bytecode alone lacks Roblox-specific authentication metadata. The existence of the gate is established statically; the precise cryptographic scheme and which sub-check rejected each historical script were not established. No forgery or bypass was attempted. |
| Does bytecode arrive unchanged? | Existing debugger evidence contains empty pre-fix results and at most 64-byte previews; join logs have errors but no full correlated sender/receiver payloads. | **Not established.** Rendering/replication and compiler logs are not substitutes for full payload equality. |
| Does the fixed code run LocalScripts in the original client? | Fresh live join could not be run here. | **Not established.** These diagnostic fixes do not claim to solve the authentication limitation. |

## Verified bugs fixed

The latest user screenshot shows
`Players.123.PlayerGui.Freecam.FreecamScript: bytecode corrupted`.
That proves the free-camera LocalScript failed to load. The saved historical
join log independently contains `Players.Player1.PlayerScripts.PlayerModule:
bytecode corrupted`, followed by `PlayerScriptsLoader` failing at line 7
(`docs/evidence/local-rcc-modern-join.log`, lines 263–266). Thus the movement
module failed in that run too; its control code could not initialize even
though the server had replicated a character. The screenshot by itself does
not establish a fresh full-payload comparison. The audit does not treat
this as evidence that physics, rendering, or WebTransport are broken.

1. **Untrusted size before validation:** `rsb1_decode` resized output from an
   unchecked 32-bit size before checking XXH32. It now verifies the container,
   enforces a caller-selectable limit (64 MiB default), and checks the zstd
   frame before allocating decoded output. A correctly checksummed 4 GiB
   size claim is rejected without that allocation.
2. **Output changed on decode failure:** the original decoder left a resized
   or partially decoded string behind when returning false. A baseline
   reproducer corrupted the sample's last byte: `accepted=0`,
   `output_preserved=0`, `output_size=512`. Decoding is now transactional.
3. **Implicit host byte order:** size and key serialization used host-endian
   `memcpy`. The protocol is now explicitly little-endian. This is a
   portability correction; x86 Windows/Linux output is unchanged.
4. **Loose frame boundaries:** the diagnostic decoder now requires one
   complete frame, matching declared decompressed size, without appended
   frames or trailing data. This tightening is for the local encoder's RSB1
   contract; it does not claim to reproduce every container Roblox accepts.
5. **Missing fixtures falsely passed:** `encoder_test` previously compiled an
   empty string when a fixture could not be opened. It now fails and has a
   CTest expected-failure regression case.

None of these changes modifies the successful compiler's opcode transform,
compile options, network serialization, schema, Studio injection profile,
WebTransport setup, database, or original WebClient.

## Exact WebClient evidence

Downloaded anonymously from the build-specific public URL:

`https://setup.rbxcdn.com/webclient/version-75f1039cb4964863-RobloxWebClient/WebClient.wasm`

- File SHA-256: `d72c52618f5c153c9b17a97e644914d43918c7122d754d96f79e8323acc6a15d`.
- Defined loader function index: `149791`; absolute function index: `150064`
  (273 imported functions).
- Original function body offset: `0x52182e1`; body length: 18,759 bytes.
- Body SHA-256: `0e0db0e3356dcef6039a898e90eb82d2757ee05f2b1e15d9a2f59537b3c93c52`.
- Its second parameter is a load-context structure. Reads at offsets 24, 28,
  32, and 36 select chunk name, data pointer, length, and environment.
- The header reads byte 0 and treats 0 as compiler-error text. Ordinary version
  bounds are 3 and 14 (packed diagnostic arguments `60129542147`); the
  compiler emits 13. Type version 3 is also in range.
- The additional validation path is reached before the Luau string table.
  Its first structural length check is 280 bytes. This is evidence that bare
  compiled Luau is insufficient, not an instruction to pad or invent data.
- The exact string `%s: bytecode corrupted` is at linear-memory address
  `1929392`. In this build the loader computes it as `4089158 - 2159766`.
  Searching only for a direct `i32.const 1929392` misses the reference.
  Similarly, the version error uses `4706977 - 1994538 = 2712439`, and the
  type-version error uses `4801330 - 2088954 = 2712376`.

Read-only disassembly used WABT 1.0.42. Selected bodies were decoded in a
separate, non-executed disassembly envelope; neither the original file nor
its execution was patched. The fingerprint utility reads the original bytes:

```sh
python3 tools/bytecode/wasm_profile.py /path/to/original/WebClient.wasm
```

It fails closed on any other file SHA-256. It reports static observations,
not a successful runtime test. Function indices in older `tools/debug_break.js`
examples refer to another build and must not be reused blindly.

## Reproduce local tests

```sh
cmake -S local_rcc_modern -B local_rcc_modern/build-host -DCMAKE_BUILD_TYPE=Release
cmake --build local_rcc_modern/build-host --parallel 2
ctest --test-dir local_rcc_modern/build-host --output-on-failure
python3 -m unittest discover -s tools/bytecode -v
local_rcc_modern/build-host/compatibility_test
local_rcc_modern/build-host/container_test
```

For existing dependency checkouts, pass `-DLUAU_DIR=... -DZSTD_DIR=...
-DXXHASH_DIR=...`. Audited dependency commits:

| Dependency | Version | Commit |
|---|---|---|
| Luau | 0.744 | `32c28089305f488f901aaf1dbf3fd1cb65fa3d11` |
| zstd | 1.5.6 | `794ea1b0afca0f020f4e57b6732332231fb23c70` |
| xxHash | 0.8.2 | `bbb27a5efb85b92a0486cf361a8635715a53f6ba` |

Fixture output evidence is in [evidence/bytecode-audit](evidence/bytecode-audit).
The successful sample RSB1 SHA-256 is
`ac19900cf40f373310190ea8a2eb5b40fcc4495c383ce49018b37c6b6066a4dc`;
its opcode-encoded Luau SHA-256 is
`2104c547ab6467f0a68e3339dcb8ee05ffd7122307bf9fd88dc1dc4ab762c794`.
The comparison in the saved evidence is **offline packaging equality**, not
server-to-client transport equality.

## Pending live test: preserve the connection and capture the boundary

The audit host had neither Studio/Wine nor a browser installed. Installing
Wine/Xvfb/MinGW failed because the package cache was not writable; Playwright's
Chromium download repeatedly returned an invalid/truncated archive. No Studio
process was launched or attached, and no original project database or running
server was accessed. No Roblox account cookies were read or used.

A reproducible live test on a suitable independent Windows/Wine host must:

1. Use a separate Studio directory, Wine prefix, database, log directory,
   HTTP port, and game-server ports. Copy the place to that prefix. Never run
   setup/restart scripts against Claude's prefix or processes.
2. Keep the existing working compiler/schema configuration and transport
   settings. Pin the exact Studio build, WebClient build, dependency commits,
   source revision and original executable hashes.
3. Capture **all** returned RSB1 bytes from the independent compiler's return
   value, including embedded NULs. Record target/options and script identity.
   Compile the exact same source offline with `bytecode_probe` as a reference;
   do not mistake that reference for an actual sender capture.
4. Set a read-only breakpoint at the fingerprinted WebClient loader entry.
   Copy exactly the load-context length from its data pointer for each of the
   seven named game scripts. Reject captures above a sensible bound. Debugger
   pauses may affect transport timing; preserve a separate uninterrupted
   baseline join log.
5. Decode the sender's RSB1 to opcode-encoded Luau, then compare that to the
   full received opcode-encoded Luau, **at the same stage**:

   ```sh
   local_rcc_modern/build-host/bytecode_probe decode sender.rsb1 sender.bc
   python3 tools/bytecode/compare_capture.py sender.bc receiver.bc --stage opcode-encoded-luau
   ```

   Save both sizes, SHA-256 values, script name, and the JSON result. The tool
   detects changed or truncated bytes beyond the old 64-byte preview.
6. Record which version/authentication/parse branch returns the error. A
   distinct error string is useful; do not infer the exact failed check from
   `bytecode corrupted` alone. Capture another uninterrupted join after any
   verified change to ensure rendering and replication are preserved.

If full captures match and the authentication gate rejects the local payload,
that establishes the limitation for that script/build. A version number
change, opcode guess, extra eight-byte prefix from the separate Play Solo
format, new backend endpoint, or blank padding does not supply authenticated
Roblox bytecode. No such changes are made by this audit.

## Supported alternatives

- **Studio's own Test / Test Here / Server & Clients:** supported local
  development paths with Studio-managed client/server simulations. This is
  the closest supported option for testing these scripts locally; this audit
  did not re-test those modes.
- **A private published Roblox experience with Roblox's managed runtime:**
  supported for testing through the Roblox application. It does not provide
  an independently hosted RCC/WebClient stack.
- **An independently owned Luau runtime:** upstream Luau supports separate
  compilation and VM embedding; the pinned reference VM tests demonstrate
  that compiler/VM pairing. Replacing Roblox engine APIs, networking and
  rendering would be a substantial separate project, not a compatibility
  switch for the original WebClient.

No supported public API or local compiler option was found in the inspected
sources/documentation that issues Roblox-authenticated network bytecode for
an independently hosted server. This is a scoped finding, not proof that no
private/internal mechanism exists.

Sources inspected:

- [Luau 0.744 Bytecode.h](https://github.com/luau-lang/luau/blob/32c28089305f488f901aaf1dbf3fd1cb65fa3d11/Common/include/Luau/Bytecode.h)
- [Luau 0.744 lvmload.cpp](https://github.com/luau-lang/luau/blob/32c28089305f488f901aaf1dbf3fd1cb65fa3d11/VM/src/lvmload.cpp)
- [Original local_rcc producer](https://github.com/abcsnoob/local_rcc/blob/5b4aee3669ebafe67e96f66c39e98e76e743ee88/src/entry.cpp)
- [Roblox Studio testing modes](https://create.roblox.com/docs/studio/testing-modes)
- [Roblox Support: Testing in Studio](https://en.help.roblox.com/hc/en-us/articles/203313870-Testing-in-Studio)
- [Luau project / embedding overview](https://github.com/luau-lang/luau)
