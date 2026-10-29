#!/usr/bin/env python3
"""Compare full compiler and client-boundary captures, not hex previews.

Both arguments must represent the same stage (RSB1 or opcode-encoded Luau).
A matching file proves equality at those two boundaries only. It does not
establish acceptance by the Roblox VM or an intervening stage not captured.
"""
import argparse
import hashlib
import json
from pathlib import Path

def compare(server, client):
    a, b = Path(server).read_bytes(), Path(client).read_bytes()
    first = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), None)
    if first is None and len(a) != len(b):
        first = min(len(a), len(b))
    return {"equal": a == b, "server_size": len(a), "client_size": len(b),
            "server_sha256": hashlib.sha256(a).hexdigest(),
            "client_sha256": hashlib.sha256(b).hexdigest(), "first_difference": first}

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('server_capture', type=Path)
    p.add_argument('client_capture', type=Path)
    p.add_argument('--stage', choices=['rsb1', 'opcode-encoded-luau'], required=True)
    args = p.parse_args()
    result = compare(args.server_capture, args.client_capture)
    print(json.dumps({"stage": args.stage, **result}, indent=2))
    raise SystemExit(0 if result['equal'] else 1)
