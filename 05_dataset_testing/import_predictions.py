"""Convert preserved HTTP receipts to evaluator input; never infer predictions from GT."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
from uuid import UUID

from dataset_tools import REASONS, write_new


def normalize(receipt):
    if not isinstance(receipt, dict) or receipt.get('protocol') != 'single_view':
        raise ValueError('Only explicit single_view receipts are supported; multi-view needs a separate protocol')
    if not isinstance(receipt.get('image_id'), str) or not receipt['image_id'].strip():
        raise ValueError('Receipt needs the main image_id')
    response = receipt.get('response')
    if not isinstance(response, dict):
        raise ValueError('Receipt needs a preserved response object')
    row = {'image_id': receipt['image_id']}
    for field in ('expected_product', 'source_mode', 'config_version'):
        value = receipt.get(field)
        if not isinstance(value, str) or not value:
            raise ValueError(f'Receipt context requires {field}')
        row[field] = value
    if row['source_mode'] not in ('simulation', 'webcam'):
        raise ValueError('Invalid receipt mode')
    if 'error' in response:
        error = response['error']
        if not isinstance(error, dict) or not isinstance(error.get('code'), str) or not error['code']:
            raise ValueError('Operational error needs a code')
        if 'result' in response or 'reason' in response or 'timing_ms' in response:
            raise ValueError('Operational errors cannot carry product decisions or successful timing')
        return dict(row, result='', reason='', error_code=error['code'],
                    orientation_ms='', inspection_ms='', storage_ms='', total_ms='')
    if response.get('demo') is not False:
        raise ValueError('Real evaluation rejects DEMO or responses without explicit demo=false')
    if any(response.get(field) != row[field] for field in ('expected_product', 'source_mode', 'config_version')):
        raise ValueError('Receipt context differs from response product/mode/config')
    for field in ('inspection_id', 'client_request_id'):
        try:
            if str(UUID(response[field])) != response[field]:
                raise ValueError()
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise ValueError(f'Response needs canonical {field}') from exc
    evidence = response.get('evidence')
    if not isinstance(evidence, dict) or evidence.get('kind') != 'single_view':
        raise ValueError('Multi-view results must not be counted as independent single-view cases')
    if (evidence.get('supporting_images') != [] or evidence.get('supporting_angles_deg') != []
            or evidence.get('verified_coverage') is not False
            or evidence.get('required_view_profile') is not None):
        raise ValueError('Single-view receipt needs empty supporting images/angles and verified_coverage=false')
    result, reason = response.get('result'), response.get('reason')
    if reason not in REASONS.get(result, set()):
        raise ValueError('Invalid result/reason')
    values = response.get('timing_ms')
    if not isinstance(values, dict):
        raise ValueError('Timings must be an object with measured values')
    timing = [values.get(key) for key in ('orientation', 'inspection', 'storage', 'total')]
    if any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in timing):
        raise ValueError('Timings must be measured finite nonnegative numbers')
    if not math.isclose(sum(timing[:3]), timing[3], abs_tol=.01, rel_tol=1e-6):
        raise ValueError('Total timing differs from component sum')
    # storage_status=failed does not alter the original product prediction.
    return dict(row, result=result, reason=reason, error_code='',
                **{key + '_ms': values[key] for key in ('orientation', 'inspection', 'storage', 'total')})


def import_receipts(path):
    rows, cases, inspections = [], set(), set()
    for line, value in enumerate(Path(path).read_text(encoding='utf-8-sig').splitlines(), 1):
        if not value.strip():
            continue
        try:
            receipt = json.loads(value)
            row = normalize(receipt)
            key = row['image_id'], row['expected_product']
            if key in cases:
                raise ValueError('Duplicate case; split files by mode and run')
            cases.add(key)
            inspection = receipt['response'].get('inspection_id')
            if inspection:
                if inspection in inspections:
                    raise ValueError('Same inspection ID reused for different images/cases')
                inspections.add(inspection)
            rows.append(row)
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError(f'line {line}: {exc}') from exc
    if not rows:
        raise ValueError('No HTTP receipts supplied')
    if len({(r['source_mode'], r['config_version']) for r in rows}) != 1:
        raise ValueError('A prediction file must contain one mode and config version')
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipts', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        rows = import_receipts(args.receipts)
        write_new(args.output, rows)
        print(json.dumps({'cases': len(rows), 'receipts_sha256': hashlib.sha256(Path(args.receipts).read_bytes()).hexdigest(),
                          'note': 'Imported predictions are not an accuracy report; run evaluate.py with audited GT'}))
        return 0
    except (OSError, ValueError, TypeError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
