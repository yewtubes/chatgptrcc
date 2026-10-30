# Engine metadata: verified format and effective live policy

The real PlayerModule still does not load. This investigation found a concrete
missing output stage, but did not identify a legitimate producer for that stage.
No new compiler output or fabricated metadata was sent to the client.

## Actual original-client retest

Run [41054344473](https://github.com/yewtubes/chatgptrcc/actions/runs/41054344473),
revision `c6366beb0a5707cdb8849522120e3337e092cfaa`, starts the independent
Wine 11.20 / Studio server and joins the unmodified WebClient. The only new
runtime observation reads five flag values at the already established
rejection breakpoint. It changes no flag, memory, bytecode or instruction result.

- Replicator created; the small locally compiled script executed.
- All five complete received payloads matched actual compiler captures.
- PlayerModule remained 639 bytes, SHA-256
  `2b2c6621784d9188e66152ed3fc98754d7a27e837938172b5557bfaec6b2237a`.
- PlayerModule, RbxCharacterSounds and the large probe again returned reason 3
  at original offset `86093212`: footer format identification, before parsing
  Luau strings/prototypes. No successful PlayerModule load or movement occurred.
- The original WASM hash remained
  `d72c52618f5c153c9b17a97e644914d43918c7122d754d96f79e8323acc6a15d`.

The effective values read inside the actual PlayerModule failure were:

| Field | Linear address | Value |
|---|---:|---:|
| LsbOptimizationDetail | 8106748 | 0 |
| LsbImproveCompatibilityReport | 8106760 | 1 |
| LsbOptimizeMax | 8106784 | 1 |
| LsbOptimizeMin | 8106796 | 1 |
| LsbValidateMin | 8106808 | 512 |

**Critical distinction:** the format-1 branch performs its signature comparison
only when `LsbOptimizationDetail == 1`. It is 0 in this run. Consequently this
run does **not** prove that cryptographic authentication is the remaining
runtime blocker. It proves the required footer format is absent. The older
format is separately excluded by the observed format policy. Neither downgrading
that policy nor inventing a format-1 signature was tested.

The new run's full bytecode files were compared inside its disposable runner;
the downloadable artifact contains hashes, metadata and logs, excluding `.bc`
and `.rsb1` captures. Published summaries are `policy-live-result.json` and
`policy-rejections.jsonl` alongside this file.

## What the format-1 data actually contains

Read-only analysis of the fingerprinted loader identified a forward quadratic
verification map from a supplied 128-bit footer value to a 96-bit value. That
value is compared with bytes 4 through 15 of the BLAKE3 digest of the bytecode
body, excluding its 24-byte footer. This is a signature-verification relation,
not an RSB1 checksum, opcode transform, or Luau serialization field. No signing
algorithm, signing key or method to invert the verification map was recovered
or implemented.

To check this interpretation independently, the included read-only verifier
extracts the existing public coefficient table from the exact original WASM
and evaluates **already supplied** signatures. It does not create metadata.
Table SHA-256:
`0b6cdf37e5817b29638fe705319618df725ffd2aafc0491d768ab6f162f42c3c`.

Five intact modules from this client's public `InExperience.rbxm` matched the
verification relation exactly. For each, an in-memory body-bit mutation and a
signature-bit mutation failed verification, and a truncated footer was no longer
recognized: **5 positive and 15 negative checks**. These edited copies were
never loaded into WebClient or transmitted. See `metadata-verification.json`.
The actual captured PlayerModule is reported as `missing-v1-metadata`; its last
24 ordinary Luau bytes are not reinterpreted as a valid signature.

These tests establish what authentic vendor metadata contains. They are not a
substitute for the effective live policy observation above and do not establish
that a signature comparison rejected the actual PlayerModule.

## Reproduce without publishing bytecode

Use Node 24 and Python with `blake3==1.0.8`. Download the exact original WASM
and model to a separate analysis directory:

- `https://setup.rbxcdn.com/webclient/version-75f1039cb4964863-RobloxWebClient/WebClient.wasm`
- `https://setup.rbxcdn.com/webclient/version-75f1039cb4964863-RobloxWebClient/ExtraContent/models/InExperience/InExperience.rbxm`

The model SHA-256 must be
`5db5363e4dbb07444b11f4a01915a7731f6dffbc5369120190196f92e7e0d5e0`.
From the repository root, with those files in `/tmp/robluc-metadata`, extract
only the five original Source properties locally (the format is binary type
29, not the text Source type handled by the existing model index):

```sh
node <<'JS'
const fs = require('fs'), r = require('./tools/rbxm.js');
const root = '/tmp/robluc-metadata';
const model = r.read(root + '/InExperience.rbxm'), idx = r.index(model);
const selected = new Set([23452, 34950, 35003, 35032, 35613]);
for (const chunk of model.chunks) {
  if (chunk.name !== 'PROP') continue;
  const d = chunk.data, id = d.readUInt32LE(0);
  let [name, p] = r.rdStr(d, 4);
  const type = d[p++];
  if (name !== 'Source' || type !== 29) continue;
  for (const ref of idx.classes.get(id).refs) {
    const n = d.readUInt32LE(p); p += 4;
    if (selected.has(ref)) fs.writeFileSync(`${root}/${ref}.bc`, d.subarray(p, p+n));
    p += n;
  }
  if (p !== d.length) throw Error('Source vector bounds mismatch');
}
JS
python3 tools/bytecode/verify_engine_metadata.py \
  /tmp/robluc-metadata/WebClient.wasm /tmp/robluc-metadata/*.bc --storage-prefix
```

All five results must say `verified-existing-signature` and
`report_marker_ok: true`. The explicit storage-prefix option removes the
model property's eight-byte prefix; do not add that prefix to network bytecode.
For the full actual PlayerModule retained from run 40982069580:

```sh
python3 tools/bytecode/verify_engine_metadata.py \
  /tmp/robluc-metadata/WebClient.wasm "$CAPTURE/receiver-005.bc"
```

Expect `missing-v1-metadata`, size 639 and the PlayerModule hash above.
To reproduce negative checks, import `load_public_coefficients` and
`verify_existing` from that verifier. For each extracted payload, remove its
first eight storage bytes. Flip bit 0 of body byte 100 in one in-memory copy;
flip bit 0 of byte `-19` in another; truncate the last byte in a third.
Expect `signature-mismatch`, `signature-mismatch`, and `missing-v1-metadata`,
respectively. Do not send these negative fixtures to any client.

## Producer search and next viable paths

The 34,225 ModuleScript Source properties in this exact `InExperience.rbxm`
contain no PlayerModule with its GetControls/GetCameras implementation. Five
other scripts merely reference movement-related names; none is a replacement
movement module. Reusing their signatures for different bytecode is invalid.
The pinned Studio scripts package contains the real default PlayerModule as
793-byte source, not an intact compiled network payload. Thus neither inspected
package supplies an authentic drop-in movement-module tree.

`compile_client` currently produces ordinary upstream Luau plus the verified
opcode encoding. It does not produce engine metadata. Replacing the Luau version,
changing AUX words, padding, or modifying compression cannot supply this missing
stage. Calling that output a complete original-WebClient compiler is inaccurate.
A legitimate engine metadata producer or an intact compatible vendor movement
module tree is still needed; none has been established in this checkout.
The observed disabled comparison is not permission to create fake signatures.

For immediate supported movement testing, Studio's own Test/Server & Clients
uses its managed test runtime; a private published experience uses Roblox's
managed servers/client. Neither is an independently hosted WebClient solution.
An independently owned Luau runtime can use this ordinary compiler output but
requires substantial separate engine work. No authentication policy is changed
as an alternative here.

The suggested [REA](https://github.com/morluto/rea) project is a reverse-engineering
frontend, not a Luau compiler or metadata producer. Its documented WASM inspection
route uses WABT 1.0.42, with a fixed 8 MiB complete-input limit. The original
100,515,451-byte client exceeds that limit. No tool installation or global agent
configuration was changed to repeat the existing targeted WABT analysis.
