import tempfile
import unittest
from pathlib import Path
from compare_capture import compare

class CaptureTests(unittest.TestCase):
    def test_full_binary_comparison(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = Path(d)/'server', Path(d)/'client'
            a.write_bytes(bytes(range(256))*256)
            b.write_bytes(a.read_bytes())
            self.assertTrue(compare(a,b)['equal'])
            # Corruption beyond the old debugger's 64-byte preview must be seen.
            changed=bytearray(b.read_bytes()); changed[4096]^=1;b.write_bytes(changed)
            result=compare(a,b)
            self.assertFalse(result['equal']);self.assertEqual(result['first_difference'],4096)
            b.write_bytes(a.read_bytes()[:-1]);self.assertEqual(compare(a,b)['first_difference'],65535)

if __name__=='__main__':unittest.main()
