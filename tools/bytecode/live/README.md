# Original-client live test

This harness runs only in a disposable checkout/runner. It installs pinned
Wine Staging 11.20, Studio 0.745.0.7451137, Chrome 151.0.7922.34 and the
original WebClient `version-75f1039cb4964863`. Studio's EXE and the WebClient
are fingerprint checked; Studio package sizes and MD5s are checked against
the public manifest. No Roblox account credentials are used.

Run the **Original WebClient live bytecode test** GitHub workflow, or prepare
the same prerequisites on an isolated Linux host that supports Unix sockets.
The script refuses Studio and database directories outside `.live-runtime`.
The runner modifies only its disposable VM's hosts entries and port binding
setting. It never reaches Claude's process, prefix, repository, or database.

The original compiler/schema compatibility patches are preserved. Setting
`LOCAL_RCC_AUDIT_DIR` enables an optional binary capture of the compiler's
existing result; it does not change the returned data. Sources are not dumped
by that instrumentation. The two synthetic audit scripts are recorded as
fixtures so their bytes are reproducible.

The browser performs an uninterrupted baseline join, then a separate join
with read-only CDP breakpoints at the fingerprinted loader. It writes full
received bytecode and SHA-256/size/chunk-name records and correlates them with
sender captures. No instructions, memory, return values, flags, or integrity
checks are changed by the debugger.

`ci-evidence/live-result.json` states whether the Replicator was created,
which scripts failed, whether either audit script executed, and whether full
received payloads match sender payloads. A diagnostic test can pass while
`controls_fixed` remains false. Screenshots and logs are uploaded together.
Do not infer a movement fix from a successful CI exit alone.

The initial local preparation succeeded for Wine, Studio and Chromium, but
`socket(AF_UNIX)` returned EPERM in the local tool runtime. This is why the
actual Wine launch is performed in the independent GitHub runner.
