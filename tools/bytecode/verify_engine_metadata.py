#!/usr/bin/env python3
"""Read-only verification of existing v1 metadata in the pinned WebClient.

This verifies supplied signatures; it cannot produce signatures or modify bytecode.
It does not emulate the loader's policy flags, parse Luau, or establish execution.
Requires blake3==1.0.8, only when a recognized v1 footer is present.
"""
import argparse
import hashlib
import json
from pathlib import Path

from wasm_profile import BUILD_SHA256, Reader

# Read-only data segment in the fingerprinted original WASM. The initializer
# copies segment 148 to linear address 5091680. The verification table is at
# 5094304, with 8257 96-bit coefficients (constant, linear and quadratic).
TABLE_SEGMENT = 148
TABLE_OFFSET = 5094304 - 5091680
TABLE_SIZE = 8257 * 12
TABLE_SHA256 = '0b6cdf37e5817b29638fe705319618df725ffd2aafc0491d768ab6f162f42c3c'
STORAGE_PREFIX = bytes.fromhex('527a104a5b3209e0')


def load_public_coefficients(wasm):
    if hashlib.sha256(wasm).hexdigest() != BUILD_SHA256:
        raise ValueError('unsupported WebClient fingerprint')
    r = Reader(wasm)
    r.take(8)
    while r.pos < len(wasm):
        tag = r.byte()
        section = Reader(r.take(r.uint()))
        if tag != 11:
            continue
        for index in range(section.uint()):
            if section.uint() != 1:
                raise ValueError('expected passive data segment')
            data = section.take(section.uint())
            if index != TABLE_SEGMENT:
                continue
            table = data[TABLE_OFFSET:TABLE_OFFSET + TABLE_SIZE]
            if hashlib.sha256(table).hexdigest() != TABLE_SHA256:
                raise ValueError('verification table fingerprint mismatch')
            return tuple(int.from_bytes(table[i:i+12], 'little')
                         for i in range(0, TABLE_SIZE, 12))
    raise ValueError('verification table absent')


def verify_existing(payload, coefficients):
    result = {'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(),
              'bytecode_version': payload[0] if payload else None,
              'status': 'missing-v1-metadata'}
    if len(payload) < 24:
        return result
    signature, footer = payload[-24:-8], payload[-24:]
    marker = int.from_bytes(footer[-4:], 'little') ^ int.from_bytes(signature[:4], 'little')
    if marker != 0x016ac432:
        return result
    report = int.from_bytes(footer[16:20], 'little') ^ int.from_bytes(signature[:4], 'little')
    result['metadata_version'] = 1
    result['report_marker_ok'] = report == 1947670640

    # Forward evaluation only. Signature bits select public coefficients;
    # there is no inversion, signing key, signature generator or output writer.
    bits = [i for i in range(128) if signature[i//8] & (128 >> (i % 8))]
    value = coefficients[0]
    for i in bits:
        value ^= coefficients[1+i]
    row = 129
    for i in range(128):
        if i in bits:
            for j in bits:
                if j > i:
                    value ^= coefficients[row+j-i-1]
        row += 127-i
    from blake3 import blake3
    actual = blake3(payload[:-24]).digest()[4:16]
    matches = value.to_bytes(12, 'little') == actual
    result['signature_matches_body'] = matches
    result['status'] = 'verified-existing-signature' if matches else 'signature-mismatch'
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('wasm', type=Path)
    p.add_argument('payload', type=Path, nargs='+')
    p.add_argument('--storage-prefix', action='store_true',
                   help='inputs are model Source bytecode with the exact 8-byte storage prefix')
    args = p.parse_args()
    coefficients = load_public_coefficients(args.wasm.read_bytes())
    rows = []
    for path in args.payload:
        payload = path.read_bytes()
        if args.storage_prefix:
            if not payload.startswith(STORAGE_PREFIX):
                p.error(str(path) + ': wrong storage prefix')
            payload = payload[len(STORAGE_PREFIX):]
        rows.append({'file': str(path), **verify_existing(payload, coefficients)})
    print(json.dumps({'static_only': True, 'policy_emulated': False,
                      'wasm_sha256': BUILD_SHA256, 'table_sha256': TABLE_SHA256,
                      'payloads': rows}, indent=2))


if __name__ == '__main__':
    main()
