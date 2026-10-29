# Robluc — independent bytecode audit

This is the independent `yewtubes/chatgptrcc` checkout of
[`yewtubes/robloxwebclient`, `claude/modest-bell-uutg9v`](https://github.com/yewtubes/robloxwebclient/tree/claude/modest-bell-uutg9v),
frozen at `f09b616b710a028ae22635d3f56b98162ef8895f`.

**Findings and reproduction:** [docs/BYTECODE_AUDIT.md](docs/BYTECODE_AUDIT.md).

The compiler emits version 13/type 3, which the exact WebClient's version
checks accept. The opcode/container checks pass locally; the client has an
additional validation gate before Luau prototype loading. A fresh live join
and full transport comparison remain unverified in this environment.

This audit does not modify the original WebClient, forge signatures, disable
integrity checks, or share Claude's Wine prefix, database, or processes.
`tools/setup.sh`, `tools/patch_wasm.js`, and the older Play Solo instructions
are inherited experiments and are **not** part of this audit's test path.

## Run the verified host tests

Requires CMake 3.24+, a C++20 compiler, Git and Python 3. Dependencies are
fetched at the versions recorded in `local_rcc_modern/CMakeLists.txt`.

```sh
cmake -S local_rcc_modern -B local_rcc_modern/build-host -DCMAKE_BUILD_TYPE=Release
cmake --build local_rcc_modern/build-host --parallel 2
ctest --test-dir local_rcc_modern/build-host --output-on-failure
python3 -m unittest discover -s tools/bytecode -v
```

The GitHub workflow imports the frozen upstream history into **this repository
only**, merges the audit files, runs the host tests, and publishes the merged
snapshot after they pass. It reads the source repository and never pushes to
it. No Roblox credentials are needed for these tests.
