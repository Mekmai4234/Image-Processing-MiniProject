"""Evaluate one mode and split using independent human GT and prediction CSV."""
import argparse
import hashlib
import json
import math
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

from dataset_tools import REASONS, read_csv, validate, write_new

PREDICTION_FIELDS = ('image_id expected_product source_mode result reason error_code config_version '
                     'orientation_ms inspection_ms storage_ms total_ms').split()


def rate(numerator, denominator):
    return {'numerator': numerator, 'denominator': denominator,
            'rate': numerator / denominator if denominator else None}


def percentile(values, quantile):
    if not values:
        return None
    values = sorted(values)
    index = (len(values) - 1) * quantile
    lo, hi = math.floor(index), math.ceil(index)
    return values[lo] + (values[hi] - values[lo]) * (index - lo)


def summarize(pairs):
    matrix = {gt: {pred: 0 for pred in REASONS} for gt in REASONS}
    operational = Counter()
    timings = {key: [] for key in ('orientation', 'inspection', 'storage', 'total')}
    for gt, pred in pairs:
        if pred['error_code']:
            operational[pred['error_code']] += 1
            continue
        matrix[gt['result']][pred['result']] += 1
        for key in timings:
            timings[key].append(float(pred[key + '_ms']))
    valid = sum(sum(row.values()) for row in matrix.values())
    fails = sum(matrix['FAIL'].values())
    passes = sum(matrix['PASS'].values())
    return {'attempts': len(pairs), 'valid_inspections': valid,
            'operational_errors': dict(operational),
            'operational_errors_by_gt': dict(Counter(gt['result'] for gt, p in pairs if p['error_code'])),
            'confusion_matrix_gt_rows_prediction_columns': matrix,
            'false_pass': rate(matrix['FAIL']['PASS'], fails),
            'false_reject': rate(matrix['PASS']['FAIL'], passes),
            'fail_recall': rate(matrix['FAIL']['FAIL'], fails),
            'review_rate': rate(sum(row['REVIEW'] for row in matrix.values()), valid),
            'gt_pass_routed_out_as_review': rate(matrix['PASS']['REVIEW'], passes),
            'timing_ms': {key: {'n': len(values), 'median': percentile(values, .5),
                                'p95': percentile(values, .95)} for key, values in timings.items()}}


def evaluate(root, manifest, catalog, provenance, predictions, run, mode, split='test'):
    audit, rows, _ = validate(root, manifest, catalog, provenance)
    if not audit['ready_for_evaluation']:
        raise ValueError('Dataset gate is not ready: fix errors/references and manually resolve near duplicates')
    if split == 'test' and not audit['split_locked']:
        raise ValueError('Final test requires split_locked=true in provenance')
    run_bytes = Path(run).read_bytes()
    metadata = json.loads(run_bytes)
    if not isinstance(metadata, dict):
        raise ValueError('Run metadata must be a JSON object')
    required = ('dataset_version', 'config_version', 'commit', 'hardware', 'resolution',
                'manifest_sha256', 'catalog_sha256', 'provenance_sha256', 'locked_at')
    if any(not metadata.get(key) for key in required) or metadata.get('config_locked') is not True:
        raise ValueError('Run metadata requires locked config, versions/hashes, commit, hardware and resolution')
    try:
        if datetime.fromisoformat(metadata['locked_at'].replace('Z', '+00:00')).utcoffset() is None:
            raise ValueError()
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError('locked_at must be an ISO-8601 timestamp with timezone') from exc
    for key in ('dataset_version', 'config_version', 'manifest_sha256', 'catalog_sha256', 'provenance_sha256'):
        if metadata[key] != audit[key]:
            raise ValueError(f'Run metadata mismatch: {key}')
    selected = {(r['image_id'], r['expected_product']): r for r in rows if r['split'] == split}
    if not selected:
        raise ValueError('Selected split has no cases')
    preds, prediction_hash = read_csv(predictions, PREDICTION_FIELDS)
    mapped = {}
    for p in preds:
        key = (p['image_id'], p['expected_product'])
        if key in mapped or key not in selected:
            raise ValueError(f'Duplicate or unexpected prediction case: {key}')
        if p['source_mode'] != mode or p['config_version'] != metadata['config_version']:
            raise ValueError('Prediction mode/config differs from this run')
        if p['error_code']:
            if p['result'] or p['reason'] or any(p[k + '_ms'] for k in ('orientation', 'inspection', 'storage', 'total')):
                raise ValueError('Operational error must not carry product result/reason or successful timing')
        else:
            if p['reason'] not in REASONS.get(p['result'], set()):
                raise ValueError('Invalid prediction result/reason')
            try:
                timing = [float(p[key + '_ms']) for key in ('orientation', 'inspection', 'storage', 'total')]
            except ValueError as exc:
                raise ValueError('Missing/invalid prediction timing') from exc
            if any(not math.isfinite(t) or t < 0 for t in timing):
                raise ValueError('Timing must be finite and nonnegative')
            if not math.isclose(sum(timing[:3]), timing[3], rel_tol=1e-6, abs_tol=.01):
                raise ValueError('total_ms must equal orientation + inspection + storage')
        mapped[key] = p
    if set(mapped) != set(selected):
        raise ValueError('Missing predictions; include operational errors explicitly')
    pairs = [(gt, mapped[key]) for key, gt in selected.items()]
    assets = json.loads(Path(provenance).read_text(encoding='utf-8-sig'))['assets']
    groups = {}
    for field in ('product_id', 'condition'):
        values = {gt['product_id'] if field == 'product_id' else assets[gt['image_id']]['condition'] for gt, _ in pairs}
        groups[field] = {value: summarize([(gt, p) for gt, p in pairs if
                                          (gt['product_id'] if field == 'product_id' else assets[gt['image_id']]['condition']) == value])
                         for value in sorted(values)}
    return {'run': metadata, 'source_mode': mode, 'split': split,
            'prediction_sha256': prediction_hash, 'run_metadata_sha256': hashlib.sha256(run_bytes).hexdigest(),
            'unit': 'one (image_id, expected_product) inspection; multi-view cases require a separate protocol',
            'denominator_policy': 'Only successful product inspections; operational errors counted separately by GT',
            'percentile_method': 'linear interpolation at (n-1)*q; null means N/A',
            'summary': summarize(pairs), 'by': groups,
            'mismatches': [{'image_id': gt['image_id'], 'expected_product': gt['expected_product'],
                            'gt_result': gt['result'], 'gt_reason': gt['reason'],
                            'predicted_result': p['result'], 'predicted_reason': p['reason'],
                            'error_code': p['error_code']}
                           for gt, p in pairs if p['error_code'] or gt['result'] != p['result'] or gt['reason'] != p['reason']]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('root', 'manifest', 'catalog', 'provenance', 'predictions', 'run', 'report'):
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--mode', choices=('simulation', 'webcam'), required=True)
    parser.add_argument('--split', choices=('development', 'validation', 'test'), default='test')
    args = vars(parser.parse_args())
    output = args.pop('report')
    try:
        result = evaluate(**args)
        write_new(output, result)
        print(json.dumps(result['summary'], ensure_ascii=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
