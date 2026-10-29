#!/usr/bin/env python3
"""Read-only identification of the exact audited WebClient loader.

This reports static facts. It does not execute bytecode or certify a join.
Function numbers from other builds are deliberately not accepted.
"""
import argparse
import hashlib
import json
from pathlib import Path

BUILD_SHA256 = 'd72c52618f5c153c9b17a97e644914d43918c7122d754d96f79e8323acc6a15d'
LOADER_SHA256 = '0e0db0e3356dcef6039a898e90eb82d2757ee05f2b1e15d9a2f59537b3c93c52'
LOADER_DEFINED_INDEX = 149791

class Reader:
    def __init__(self, data): self.data, self.pos = data, 0
    def byte(self):
        if self.pos >= len(self.data): raise ValueError('truncated input')
        v = self.data[self.pos]; self.pos += 1; return v
    def uint(self):
        value = 0
        for shift in range(0, 35, 7):
            v = self.byte(); value |= (v & 127) << shift
            if v < 128: return value
        raise ValueError('oversized ULEB128')
    def take(self, n):
        end = self.pos + n
        if end > len(self.data): raise ValueError('truncated input')
        v = self.data[self.pos:end]; self.pos = end; return v

def bodies(data):
    r = Reader(data)
    if r.take(8) != b'\0asm\x01\0\0\0': raise ValueError('not WebAssembly v1')
    while r.pos < len(data):
        tag = r.byte(); size = r.uint(); end = r.pos + size
        if end > len(data): raise ValueError('truncated section')
        if tag == 10:
            count = r.uint()
            for index in range(count):
                size = r.uint(); offset = r.pos
                body = r.take(size)
                if r.pos > end: raise ValueError('body exceeds code section')
                yield index, offset, body
            if r.pos != end: raise ValueError('trailing code-section data')
            return
        r.pos = end
    raise ValueError('missing code section')

def profile(path):
    data = Path(path).read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    if sha != BUILD_SHA256: raise ValueError('unsupported WebClient SHA-256: ' + sha)
    for index, offset, body in bodies(data):
        if index != LOADER_DEFINED_INDEX: continue
        if hashlib.sha256(body).hexdigest() != LOADER_SHA256: raise ValueError('loader fingerprint mismatch')
        r = Reader(body)
        for _ in range(r.uint()):
            r.uint(); r.byte() # local count and value type, all scalar in this loader
        return {"webclient_sha256": sha, "static_only": True,
                "loader_defined_index": index, "loader_function_index": index + 273,
                "loader_body_offset": offset, "loader_first_instruction": offset + r.pos,
                "loader_body_size": len(body), "loader_sha256": LOADER_SHA256,
                "bytecode_version_range": [3, 14], "type_version_range": [1, 3],
                "notes": "Ranges and validation gate were established from disassembly; fingerprints identify that evidence, not a live runtime result."}
    raise ValueError('loader function absent')

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('wasm', type=Path)
    try: print(json.dumps(profile(p.parse_args().wasm), indent=2))
    except (OSError, ValueError) as e: p.exit(1, str(e) + '\n')
