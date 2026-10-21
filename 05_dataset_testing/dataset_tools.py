"""Offline tools for work 05. No backend imports or runtime storage access."""
import argparse
import csv
import hashlib
import io
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path, PureWindowsPath

from PIL import Image, ImageOps

FIELDS = ('image_id filename physical_bottle_id capture_session product_id label_product '
          'expected_product angle_deg label_present position_ok visible_enough result reason '
          'split_group_id split reviewer').split()
SPLITS = ('development', 'validation', 'test')
REASONS = {'PASS': {'good'}, 'FAIL': {'wrong_label', 'misplaced_label', 'missing_label'},
           'REVIEW': {'blurred_image', 'label_not_visible', 'unknown_product',
                      'ambiguous_match', 'orientation_failed'}}
IDENTITIES = ('image_id', 'filename', 'physical_bottle_id', 'capture_session', 'split_group_id')


def read_csv(path, required):
    raw = Path(path).read_bytes()
    reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig'), newline=''))
    headers = reader.fieldnames or []
    if len(headers) != len(set(headers)) or not set(required) <= set(headers):
        raise ValueError('Missing or duplicate CSV columns: ' + ', '.join(required))
    rows = []
    for line, row in enumerate(reader, 2):
        if None in row or any(value is None for value in row.values()):
            raise ValueError(f'CSV line {line}: incorrect column count')
        rows.append({key: value.strip() for key, value in row.items()})
    if not rows:
        raise ValueError('CSV has no data rows')
    return rows, hashlib.sha256(raw).hexdigest()


def local_file(root, name):
    if (not name or '\\' in name or Path(name).is_absolute() or
            PureWindowsPath(name).is_absolute() or ':' in name or '..' in Path(name).parts):
        raise ValueError(f'Expected a relative POSIX dataset path: {name}')
    path = (root / name).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError(f'Path escapes dataset root: {name}')
    return path


def image_info(path):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        image.load()
        normalized = ImageOps.exif_transpose(image).convert('RGB')
        small = normalized.convert('L').resize((9, 8))
        pixels = list(small.get_flattened_data())
        dhash = sum((pixels[y * 9 + x] > pixels[y * 9 + x + 1]) << (y * 8 + x)
                    for y in range(8) for x in range(8))
        return {'sha256': digest, 'width': normalized.width, 'height': normalized.height,
                'dhash': f'{dhash:016x}'}


def components(rows, hashes):
    """Transitive closure, including repeated bottle OR session and derivatives."""
    parent = list(range(len(rows)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a, b):
        parent[find(b)] = find(a)

    seen = {}
    images = {}
    for index, row in enumerate(rows):
        for field in IDENTITIES:
            key = (field, row[field])
            if row[field]:
                if key in seen:
                    union(index, seen[key])
                seen[key] = index
        if row['filename'] in hashes:
            key = ('hash', hashes[row['filename']]['sha256'])
            if key in seen:
                union(index, seen[key])
            seen[key] = index
        images[row['image_id']] = index
    for index, row in enumerate(rows):
        source = row.get('source_image_id', '')
        if source in images:
            union(index, images[source])
    result = defaultdict(list)
    for index in range(len(rows)):
        result[find(index)].append(index)
    return sorted(result.values(), key=lambda group: min(rows[i]['image_id'] for i in group))


def validate(root, manifest, catalog, provenance=None):
    root = Path(root).resolve()
    rows, manifest_hash = read_csv(manifest, FIELDS)
    catalog_bytes = Path(catalog).read_bytes()
    catalog_data = json.loads(catalog_bytes)
    if not isinstance(catalog_data, dict):
        raise ValueError('Catalog must be a JSON object')
    products = catalog_data.get('products', [])
    if not isinstance(products, list) or any(not isinstance(p, dict) for p in products):
        raise ValueError('Catalog products must be an array of objects')
    for product in products:
        if not isinstance(product.get('reference_paths', []), list) or any(
                not isinstance(p, str) for p in product.get('reference_paths', [])):
            raise ValueError('reference_paths must be an array of relative paths')
    ids = [p.get('product_id') for p in products]
    errors, warnings = [], []
    if not ids or any(not isinstance(p, str) or not p for p in ids) or len(ids) != len(set(ids)):
        errors.append('Catalog needs unique nonempty product IDs')
    if (catalog_data.get('demo') is not False or
            not isinstance(catalog_data.get('config_version'), str) or not catalog_data['config_version'].strip()):
        errors.append('Real catalog needs demo=false and config_version')
    for product in products:
        size = product.get('size_ml')
        if (not product.get('brand') or type(size) not in (int, float) or
                not math.isfinite(size) or size <= 0 or not product.get('display_name')):
            errors.append(f"Catalog product {product.get('product_id')}: brand/size/display_name required")
    metadata = json.loads(Path(provenance).read_text(encoding='utf-8-sig')) if provenance else {}
    if not isinstance(metadata, dict):
        raise ValueError('Provenance must be a JSON object')
    assets = metadata.get('assets', {})
    if not metadata.get('dataset_version') or not isinstance(assets, dict):
        errors.append('Provenance requires dataset_version and assets mapping')
        assets = {}
    if any(not isinstance(asset, dict) for asset in assets.values()):
        raise ValueError('Each provenance asset must be an object')
    for asset in assets.values():
        evidence = asset.get('missing_label_evidence', {})
        if not isinstance(evidence, dict) or not isinstance(evidence.get('supporting_image_ids', []), list):
            raise ValueError('missing_label_evidence needs an object with supporting_image_ids array')
        if any(not isinstance(value, str) for value in evidence.get('supporting_image_ids', [])):
            raise ValueError('supporting_image_ids must contain string IDs')
    reviews = metadata.get('near_duplicate_reviews', [])
    if not isinstance(reviews, list) or any(not isinstance(r, dict) for r in reviews):
        raise ValueError('near_duplicate_reviews must be an array of review objects')
    hashes, cases, names, image_metadata = {}, set(), {}, {}
    for index, row in enumerate(rows, 2):
        prefix = f'line {index}'
        for field in (*IDENTITIES, 'product_id', 'expected_product', 'reviewer'):
            if not row[field]:
                errors.append(f'{prefix}: empty {field}')
        if row['reviewer'] == 'example-only':
            errors.append(f'{prefix}: example-only is not a real reviewer')
        if row['split'] not in SPLITS:
            errors.append(f'{prefix}: invalid split')
        if row['reason'] not in REASONS.get(row['result'], set()):
            errors.append(f'{prefix}: invalid result/reason')
        for field in ('label_present', 'position_ok', 'visible_enough'):
            if row[field] not in ('yes', 'no', 'unknown'):
                errors.append(f'{prefix}: invalid {field}')
        for field in ('product_id', 'expected_product', 'label_product'):
            if (field != 'label_product' or row[field]) and row[field] not in ids:
                errors.append(f'{prefix}: {field} not in catalog')
        if row['angle_deg']:
            try:
                angle = float(row['angle_deg'])
                if not math.isfinite(angle) or not 0 <= angle < 360:
                    raise ValueError()
            except ValueError:
                errors.append(f'{prefix}: invalid angle_deg')
        key = (row['image_id'], row['expected_product'])
        if key in cases:
            errors.append(f'{prefix}: duplicate evaluation case {key}')
        cases.add(key)
        filename = row['filename']
        signature = tuple(row[f] for f in ('filename', 'physical_bottle_id', 'capture_session',
                                          'product_id', 'label_product', 'angle_deg',
                                          'label_present', 'position_ok', 'visible_enough'))
        if row['image_id'] in image_metadata and image_metadata[row['image_id']] != signature:
            errors.append(f'{prefix}: inconsistent metadata for image_id')
        image_metadata[row['image_id']] = signature
        if filename in names and names[filename] != row['image_id']:
            errors.append(f'{prefix}: filename maps to multiple image IDs')
        names[filename] = row['image_id']
        if row['result'] == 'PASS' and not (
                row['label_product'] == row['expected_product'] and
                all(row[f] == 'yes' for f in ('label_present', 'position_ok', 'visible_enough'))):
            errors.append(f'{prefix}: PASS contradicts visible label/product/position')
        if row['result'] == 'FAIL':
            if row['visible_enough'] != 'yes':
                errors.append(f'{prefix}: FAIL needs visible_enough=yes (sufficient visible evidence)')
            if row['reason'] == 'wrong_label' and not (
                    row['label_present'] == 'yes' and row['label_product'] and
                    row['label_product'] != row['expected_product']):
                errors.append(f'{prefix}: wrong_label needs a known different label')
            if row['reason'] == 'misplaced_label':
                if row['label_present'] != 'yes':
                    errors.append(f'{prefix}: misplaced_label needs label_present=yes')
                if row['position_ok'] != 'no':
                    errors.append(f'{prefix}: misplaced_label needs position_ok=no')
                if row['label_product'] and row['label_product'] != row['expected_product']:
                    errors.append(f'{prefix}: label_product differs from expected_product; '
                                  'known identity mismatch takes wrong_label precedence over misplaced_label')
            if row['reason'] == 'missing_label':
                evidence = assets.get(row['image_id'], {}).get('missing_label_evidence', {})
                # This checks human evidence records, never claims to validate pixels itself.
                if not (row['label_present'] == 'no' and not row['label_product'] and
                        evidence.get('profile') and evidence.get('validation_record') and
                        evidence.get('reviewer') and evidence.get('supporting_image_ids')):
                    errors.append(f'{prefix}: missing_label needs reviewed profile/evidence records')
        if filename not in hashes:
            try:
                hashes[filename] = image_info(local_file(root, filename))
            except (OSError, ValueError, Image.DecompressionBombError) as exc:
                errors.append(f'{prefix}: unreadable/unsafe image {filename}: {exc}')
        asset = assets.get(row['image_id'], {})
        if not all(asset.get(f) for f in ('source', 'rights', 'condition')):
            errors.append(f'{prefix}: provenance source/rights/condition required')
        if asset.get('synthetic') is not False:
            errors.append(f'{prefix}: real evaluation requires synthetic=false')
        if asset.get('sha256') != hashes.get(filename, {}).get('sha256') or not asset.get('sha256'):
            errors.append(f'{prefix}: provenance SHA-256 mismatch or missing')
    by_id = {r['image_id']: r for r in rows}
    for row in rows:
        source = row.get('source_image_id', '')
        if source and source not in by_id:
            errors.append(f"Unknown source_image_id: {source}")
        evidence = assets.get(row['image_id'], {}).get('missing_label_evidence', {})
        for image_id in evidence.get('supporting_image_ids', []):
            other = by_id.get(image_id)
            if other is None or any(other[f] != row[f] for f in ('physical_bottle_id', 'capture_session', 'split')):
                errors.append(f"Invalid supporting evidence {image_id} for {row['image_id']}")
    groups = components(rows, hashes)
    for group in groups:
        if len({rows[i]['split'] for i in group}) > 1:
            errors.append('Split leakage in connected component: ' + ','.join(rows[i]['image_id'] for i in group))
        if len({rows[i]['split_group_id'] for i in group}) > 1:
            errors.append('Connected component has inconsistent split_group_id')
    duplicates, near = [], []
    reviewed_pairs = {}
    for review in reviews:
        pair = review.get('filenames', [])
        if (isinstance(pair, list) and len(pair) == 2 and all(isinstance(p, str) for p in pair)
                and review.get('decision') == 'distinct' and review.get('reviewer')
                and review.get('note') and len(review.get('sha256', [])) == 2
                and all(hashes.get(name, {}).get('sha256') == digest
                        for name, digest in zip(pair, review['sha256']))):
            reviewed_pairs[tuple(sorted(pair))] = review
    files = sorted(hashes)
    for index, first in enumerate(files):
        for second in files[index + 1:]:
            if hashes[first]['sha256'] == hashes[second]['sha256']:
                duplicates.append([first, second])
            elif (int(hashes[first]['dhash'], 16) ^ int(hashes[second]['dhash'], 16)).bit_count() <= 5:
                if (first, second) not in reviewed_pairs:
                    near.append([first, second])
    if near:
        warnings.append('Near-duplicate candidates require manual review; dHash is not proof of identity')
    reference_paths = []
    references_complete = True
    for product in products:
        if not product.get('reference_paths'):
            references_complete = False
            warnings.append(f"No references selected for {product.get('product_id')}")
        for reference in product.get('reference_paths', []):
            reference_paths.append(reference)
            try:
                info = image_info(local_file(root, reference))
                matches = [r for r in rows if hashes.get(r['filename'], {}).get('sha256') == info['sha256']]
                if not matches or any(r['split'] != 'development' for r in matches):
                    errors.append(f'Reference must trace to development: {reference}')
                if not any(r['label_product'] == product['product_id'] and
                           r['label_present'] == 'yes' and r['visible_enough'] == 'yes' for r in matches):
                    errors.append(f'Reference needs a visible matching label: {reference}')
                # Copies resized/cropped separately need a development provenance row as well.
            except (OSError, ValueError, Image.DecompressionBombError) as exc:
                errors.append(f'Invalid reference {reference}: {exc}')
    if not reference_paths:
        warnings.append('No references selected yet; not ready to hand off to detector')
    if len(groups) < 3 or set(r['split'] for r in rows) != set(SPLITS):
        errors.append('Need at least three independent groups and all three splits for evaluation')
    counts = {}
    for split in SPLITS:
        subset = [r for r in rows if r['split'] == split]
        counts[split] = {'cases': len(subset), 'images': len({r['image_id'] for r in subset}),
                         'bottles': len({r['physical_bottle_id'] for r in subset}),
                         'sessions': len({r['capture_session'] for r in subset}),
                         'groups': len({r['split_group_id'] for r in subset}),
                         'products': dict(Counter(r['product_id'] for r in subset)),
                         'results': dict(Counter(r['result'] for r in subset)),
                         'conditions': dict(Counter(assets.get(r['image_id'], {}).get('condition', 'unknown') for r in subset))}
    return {'audit_scope': 'source_manifest',
            'ready_for_evaluation': not errors and not near and bool(reference_paths) and references_complete,
            'split_locked': metadata.get('split_locked') is True,
            'errors': errors, 'warnings': warnings, 'manifest_sha256': manifest_hash,
            'catalog_sha256': hashlib.sha256(catalog_bytes).hexdigest(),
            'provenance_sha256': hashlib.sha256(Path(provenance).read_bytes()).hexdigest() if provenance else None,
            'dataset_version': metadata.get('dataset_version'), 'config_version': catalog_data.get('config_version'),
            'counts': counts, 'files': hashes, 'exact_duplicates': duplicates,
            'near_duplicate_candidates': near,
            'near_duplicate_reviews': list(reviewed_pairs.values())}, rows, groups


def split_proposal(rows, groups, seed):
    """Propose groups first; select references from the new development split later."""
    if len(groups) < 3:
        raise ValueError('Need at least 3 independent groups; collect separate bottles/sessions')
    groups = [list(g) for g in groups]
    random.Random(seed).shuffle(groups)
    # Allocate groups, not rows. Guarantee a nonempty validation and test set.
    n = len(groups)
    n_test = max(1, round(n * .2))
    n_validation = min(max(1, round(n * .2)), n - n_test - 1)
    assignments = ['test'] * n_test + ['validation'] * n_validation + ['development'] * (n - n_test - n_validation)
    result = []
    for number, (group, split) in enumerate(zip(groups, assignments), 1):
        for index in group:
            result.append(dict(rows[index], split=split, split_group_id=f'group-{number:04d}'))
    return result


def write_new(path, value):
    """Never overwrite data, config, predictions or existing reports."""
    with Path(path).open('x', encoding='utf-8', newline='') as stream:
        if isinstance(value, list):
            writer = csv.DictWriter(stream, fieldnames=list(value[0]))
            writer.writeheader()
            writer.writerows(value)
        else:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--provenance', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--propose-splits', help='Write a NEW proposal CSV; does not alter the source')
    parser.add_argument('--seed', type=int, default=5)
    args = parser.parse_args()
    try:
        report, rows, groups = validate(args.root, args.manifest, args.catalog, args.provenance)
        if args.propose_splits:
            if json.loads(Path(args.provenance).read_text(encoding='utf-8-sig')).get('split_locked') is True:
                raise ValueError('Dataset splits are locked; create a new version instead of resplitting')
            # Proposal can fix leakage only; malformed data and missing images must be fixed first.
            blocking = [e for e in report['errors'] if not e.startswith(('Split leakage', 'Connected component', 'Need at least'))]
            if blocking:
                raise ValueError('Cannot propose splits until data errors are fixed: ' + '; '.join(blocking))
            write_new(args.propose_splits, split_proposal(rows, groups, args.seed))
            report['split_proposal'] = {
                'path': args.propose_splits,
                'status': 'unvalidated',
                'references_policy': 'select_from_development_after_split',
                'requires_new_audit': True,
                'note': 'Existing references are not pinned. Apply and review the proposal, '
                        'select development references, then create a new audit and hashes. '
                        'This report and readiness describe only the source manifest.',
            }
        write_new(args.report, report)
        summary = {'audit_scope': report['audit_scope'], 'errors': len(report['errors']),
                   'warnings': len(report['warnings']),
                   'ready_for_evaluation': report['ready_for_evaluation']}
        if args.propose_splits:
            summary['split_proposal'] = report['split_proposal']
        print(json.dumps(summary, ensure_ascii=False))
        return 0 if report['ready_for_evaluation'] else 1
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
