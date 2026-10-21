"""Input safety tests do not require backend dependencies in dataset CI."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from probe_backend import probe


class ReadinessProbeTests(unittest.TestCase):
    def test_empty_input_is_not_replaced_with_fake_photos(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            with self.assertRaisesRegex(ValueError,'No source images'):
                probe(root,root/'output','bottle_a')
            self.assertFalse((root/'output').exists())

    def test_existing_output_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/'input.jpg').write_bytes(b'unchanged candidate')
            output=root/'output'; output.mkdir()
            sentinel=output/'keep.txt';sentinel.write_text('keep')
            with self.assertRaisesRegex(ValueError,'already exists'):
                probe(root,output,'bottle_a')
            self.assertEqual('keep',sentinel.read_text())
            self.assertEqual(b'unchanged candidate',(root/'input.jpg').read_bytes())

    def test_cli_help_and_missing_input_have_explicit_exit_codes(self):
        script=str(Path(__file__).with_name('probe_backend.py'))
        result=subprocess.run([sys.executable,'-B',script,'--help'],capture_output=True,text=True)
        self.assertEqual(0,result.returncode)
        with tempfile.TemporaryDirectory() as temp:
            result=subprocess.run([sys.executable,'-B',script,'--input-root',temp,
                '--output',str(Path(temp)/'output'),'--expected-product','bottle_a'],capture_output=True,text=True)
            self.assertEqual(2,result.returncode)
            self.assertIn('No source images',result.stderr)


if __name__=='__main__':
    unittest.main()
