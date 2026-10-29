import unittest
from wasm_profile import Reader, bodies

class ReaderTests(unittest.TestCase):
    def test_leb_and_truncation(self):
        self.assertEqual(Reader(b'\xe5\x8e\x26').uint(),624485)
        with self.assertRaises(ValueError): Reader(b'\x80').uint()
        with self.assertRaises(ValueError): Reader(b'abc').take(4)
    def test_code_offsets(self):
        data=b'\0asm\x01\0\0\0\x0a\x04\x01\x02\x00\x0b'
        self.assertEqual(list(bodies(data)),[(0,12,b'\x00\x0b')])
        with self.assertRaises(ValueError): list(bodies(data[:-1]))

if __name__=='__main__':unittest.main()
