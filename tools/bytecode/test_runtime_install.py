import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('prepare_runtime', Path(__file__).parent/'live/prepare_runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeInstallTests(unittest.TestCase):
    def test_windows_plugin_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root/'plugins.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('\\', b'')
                z.writestr('\\Qt5\\platforms\\', b'')
                z.writestr('Qt5\\platforms\\qwindows.dll', b'plugin\0bytes')
            runtime.unzip(archive, root/'Plugins')
            self.assertEqual((root/'Plugins/Qt5/platforms/qwindows.dll').read_bytes(), b'plugin\0bytes')
            self.assertFalse(any('\\' in f.name for f in (root/'Plugins').rglob('*')))

    def test_backslash_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root/'bad.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('..\\escaped.dll', b'bad')
            with self.assertRaises(ValueError):
                runtime.unzip(archive, root/'Plugins')
            self.assertFalse((root/'escaped.dll').exists())


if __name__ == '__main__':
    unittest.main()
