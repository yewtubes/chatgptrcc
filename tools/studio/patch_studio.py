# Patches RobloxStudioBeta.exe (0.745.0.7451137) so a local play-test server
# replicates scripts the way a team-test (RCC) server does.
#
# NetworkServer compiles every replicated script for clients. It uses compile
# target 2 only when configured as a team-test server ([server+0x230] == 1) and
# target 0 otherwise; with target 0 the bytecode clients get is empty (Studio's
# own clients compile the source themselves). Player clients such as the web
# client have no Luau compiler, so they need target 2. The patch removes the
# team-test check in front of `mov r14d, 2`.
#
# That alone isn't enough: when the replicator serializes a script's source
# for a peer, it fetches the bytecode for the target that peer asked for
# (0x14604e1b0, last argument: 1 = compiled target 2, 0 = target 0, which is
# empty). Studio's local play-test peers ask for 0, so the three serializer
# call sites are patched to always ask for compiled bytecode.
#
#   python3 patch_studio.py [path/to/RobloxStudioBeta.exe]   (keeps a .orig copy)
import pefile, shutil, sys, os

exe = sys.argv[1] if len(sys.argv) > 1 else '/home/user/studio/app/RobloxStudioBeta.exe'
PATCHES = [
    # (virtual address, original bytes, patched bytes, why)
    (0x1460b5a32, bytes([0x75, 0x4b]), bytes([0x90, 0x90]), 'compile replicated scripts with target 2'),
    # movzx r9d, byte ptr [r14+8]  ->  mov r9b, 1; nop; nop
    (0x145f43fab, bytes.fromhex('450fb64e08'), bytes.fromhex('41b1019090'), 'replicate compiled bytecode (1)'),
    (0x145f456e9, bytes.fromhex('450fb64e08'), bytes.fromhex('41b1019090'), 'replicate compiled bytecode (2)'),
    (0x145f47555, bytes.fromhex('450fb64e08'), bytes.fromhex('41b1019090'), 'replicate compiled bytecode (3)'),
]

pe = pefile.PE(exe, fast_load=True)
base = pe.OPTIONAL_HEADER.ImageBase
pe.close()
def off(va):
    for s in pe.sections:
        if s.VirtualAddress <= va - base < s.VirtualAddress + s.SizeOfRawData:
            return s.PointerToRawData + va - base - s.VirtualAddress
data = bytearray(open(exe, 'rb').read())
for va, orig, new, why in PATCHES:
    o = off(va)
    cur = bytes(data[o:o + len(orig)])
    if cur == new:
        print(f'{hex(va)} already patched: {why}')
        continue
    if cur != orig:
        sys.exit(f'{hex(va)}: unexpected bytes {cur.hex()} (wrong Studio version?)')
    data[o:o + len(new)] = new
    print(f'{hex(va)} patched: {why}')
if not os.path.exists(exe + '.orig'):
    shutil.copy2(exe, exe + '.orig')
open(exe, 'wb').write(data)
