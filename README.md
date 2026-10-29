# Robluc bytecode compatibility audit

Independent audit of `yewtubes/robloxwebclient`, branch `claude/modest-bell-uutg9v`, frozen at `f09b616b710a028ae22635d3f56b98162ef8895f`.

This repository investigates local Luau compilation, opcode encoding, RSB1 packaging, and byte preservation. The original Roblox WebClient must remain unchanged, and authentication/signature protections must remain enabled.

The audit does not share Claude's working directory, Wine prefix, database, or processes. Findings, regression tests, and reproduction instructions will be committed here.
