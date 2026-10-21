"""Measured PNG comparison only; visual acceptance requires a human reviewer."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops, ImageDraw, ImageStat
from dataset_tools import write_new


def compare(actual, reference, masks=()):
    if Path(actual).samefile(reference):
        raise ValueError('Actual and reference must be separate files; do not compare a screenshot to itself')
    with Image.open(actual) as source, Image.open(reference) as target:
        source.load()
        target.load()
        if source.size != target.size:
            raise ValueError('Viewport dimensions differ; capture both images at the same size')
        actual_image, reference_image = source.convert('RGB'), target.convert('RGB')
    width, height = actual_image.size
    ignored = Image.new('L', (width, height), 0)
    draw = ImageDraw.Draw(ignored)
    for mask in masks:
        if not isinstance(mask, dict) or mask.get('reason') not in ('timestamp', 'id', 'animation'):
            raise ValueError('Masks must explain timestamp/id/animation regions')
        rect = mask.get('rect')
        if not isinstance(rect, list) or len(rect) != 4 or any(type(v) is not int for v in rect):
            raise ValueError('Mask rect must be integer [x,y,width,height]')
        x, y, w, h = rect
        if min(x, y) < 0 or min(w, h) < 1 or x + w > width or y + h > height:
            raise ValueError('Mask outside screenshot')
        draw.rectangle((x, y, x + w - 1, y + h - 1), fill=255)
    masked = ignored.histogram()[255]
    compared = width * height - masked
    if compared == 0:
        raise ValueError('Masks must not hide the entire screenshot')
    difference = ImageChops.difference(actual_image, reference_image)
    difference.paste((0, 0, 0), mask=ignored)
    changed = sum(1 for pixel in difference.get_flattened_data() if any(pixel))
    stats = ImageStat.Stat(difference)
    comparison = Image.new('RGB', (width * 2, height))
    comparison.paste(reference_image, (0, 0))
    comparison.paste(actual_image, (width, 0))
    return {'actual_sha256': hashlib.sha256(Path(actual).read_bytes()).hexdigest(),
            'reference_sha256': hashlib.sha256(Path(reference).read_bytes()).hexdigest(),
            'viewport': [width, height], 'masked_pixels': masked, 'compared_pixels': compared,
            'changed_pixels': changed, 'changed_fraction': changed / compared,
            'mean_absolute_rgb_difference': sum(stats.sum) / (compared * 3),
            'masks': masks, 'visual_acceptance': 'pending_human_review',
            'comparison_order': 'reference left, actual right'}, comparison, difference


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('actual', 'reference', 'report', 'side-by-side', 'diff'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--masks', help='Optional JSON array; only timestamp/id/animation regions')
    args = parser.parse_args()
    try:
        outputs = [Path(args.report).resolve(), Path(args.side_by_side).resolve(), Path(args.diff).resolve()]
        if len(set(outputs)) != 3 or any(path.exists() for path in outputs):
            raise ValueError('All output paths must be distinct NEW files')
        masks = json.loads(Path(args.masks).read_text(encoding='utf-8')) if args.masks else []
        if not isinstance(masks, list):
            raise ValueError('Masks must be an array')
        report, side, difference = compare(args.actual, args.reference, masks)
        with outputs[1].open('xb') as stream:
            side.save(stream, format='PNG')
        with outputs[2].open('xb') as stream:
            difference.save(stream, format='PNG')
        write_new(outputs[0], report)
        return 0
    except (OSError, ValueError, TypeError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
