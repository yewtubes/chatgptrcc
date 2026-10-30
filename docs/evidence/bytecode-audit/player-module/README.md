# Actual PlayerModule trace

Run [40982069580](https://github.com/yewtubes/chatgptrcc/actions/runs/40982069580)
uses the original fingerprinted WebClient and an independent Wine Studio
server. `comparison.json` records the real default PlayerModule's complete
producer/receiver equality and its first rejecting stage. `live-result.json`
explicitly records `controls_fixed: false`.

The local account name is AuditCapture. Its PlayerModule is the real module
created by Studio's default player-script setup. The original Player1 run did
not preserve a full payload, so equality to that historical run is not claimed.

Raw files retained from the run (not committed here):

- `producer.bc`: complete 639-byte DLL compiler result, before RSB1 wrapping.
- `producer.rsb1`: complete 395-byte actual returned container, including NUL.
- `producer-metadata.json`: target/options and source/bytecode/container sizes.
- `receiver.bc`: complete bytes read at the named original VM loader entry.
- `received-scripts.jsonl`: all five full captured script records.
- `rejections.jsonl`: read-only observations at the original rejection block.

Automatic approval review blocked publishing the three raw payload files as
potential proprietary script contents. This directory publishes hashes, sizes
and rejection records. The full payloads were captured and compared locally.

Reproduce from the diagnostic artifact of the linked run after building the
existing host diagnostic tool (set `CAPTURE` to its extracted directory):

```sh
local_rcc_modern/build-host/bytecode_probe decode "$CAPTURE/sender/224-5.rsb1" /tmp/player-module-decoded.bc
python3 tools/bytecode/compare_capture.py "$CAPTURE/sender/224-5.bc" "$CAPTURE/receiver-005.bc" --stage opcode-encoded-luau
python3 tools/bytecode/compare_capture.py /tmp/player-module-decoded.bc "$CAPTURE/receiver-005.bc" --stage opcode-encoded-luau
```

All three bytecode files must have SHA-256
`2b2c6621784d9188e66152ed3fc98754d7a27e837938172b5557bfaec6b2237a`.

The client accepts version 13/type 3, then rejects PlayerModule at original
file offset `86093212`, reason 3. Static control flow maps that reason to a
negative result from footer format/version identification, before Luau's
string/prototype decoding. This establishes the immediate metadata failure;
it does not establish a private-key signing requirement or show a failed
cryptographic comparison. No fabricated footer or altered integrity check was
tested. Character movement is not fixed.
