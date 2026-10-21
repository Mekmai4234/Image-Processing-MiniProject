from pathlib import Path
import tempfile
import unittest

from PIL import Image
from compare_screenshots import compare


class ScreenshotComparisonTests(unittest.TestCase):
    def test_measurements_masks_and_human_acceptance(self):
        with tempfile.TemporaryDirectory() as temp:
            a, b = Path(temp) / 'a.png', Path(temp) / 'b.png'
            Image.new('RGB', (10, 10), 'black').save(a)
            image = Image.new('RGB', (10, 10), 'black')
            image.putpixel((0, 0), (255, 255, 255))
            image.save(b)
            report, side, diff = compare(a, b)
            self.assertEqual(1, report['changed_pixels'])
            self.assertEqual(.01, report['changed_fraction'])
            self.assertEqual(2.55, report['mean_absolute_rgb_difference'])
            self.assertEqual('pending_human_review', report['visual_acceptance'])
            self.assertEqual((20, 10), side.size)
            report, _, _ = compare(a, b, [{'rect': [0, 0, 1, 1], 'reason': 'timestamp'}])
            self.assertEqual(0, report['changed_pixels'])
            self.assertEqual(99, report['compared_pixels'])
            with self.assertRaises(ValueError):
                compare(a, b, [{'rect': [0, 0, 10, 10], 'reason': 'animation'}])
            with self.assertRaises(ValueError):
                compare(a, b, [{'rect': [0, 0, 1, 1], 'reason': 'hide broken UI'}])

    def test_different_viewports_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            a, b = Path(temp) / 'a.png', Path(temp) / 'b.png'
            Image.new('RGB', (10, 10)).save(a)
            Image.new('RGB', (20, 10)).save(b)
            with self.assertRaisesRegex(ValueError, 'Viewport'):
                compare(a, b)
