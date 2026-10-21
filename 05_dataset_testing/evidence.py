"""Check evidence records without converting smoke tests to real-data acceptance."""
import argparse
import hashlib
from datetime import datetime
from pathlib import Path
import re
import sys

from dataset_tools import local_file, read_csv

FIELDS = ('case_id status owner test_date commit tester data_kind evidence evidence_sha256 notes').split()
KINDS = {'synthetic', 'real', 'browser', 'hardware', 'visual'}


def validate_evidence(checklist, root):
    rows, _ = read_csv(checklist, FIELDS)
    root = Path(root).resolve()
    errors, seen = [], set()
    for line, row in enumerate(rows, 2):
        prefix = f'line {line} ({row["case_id"]})'
        if not row['case_id'] or row['case_id'] in seen:
            errors.append(f'{prefix}: missing/duplicate case ID')
        seen.add(row['case_id'])
        if not row['owner'] or row['data_kind'] not in KINDS:
            errors.append(f'{prefix}: owner and explicit data_kind required')
        if row['status'] not in ('not_tested', 'blocked', 'passed', 'failed'):
            errors.append(f'{prefix}: invalid status')
        if row['status'] == 'blocked' and not row['notes']:
            errors.append(f'{prefix}: blocked case needs a reason')
        if row['status'] not in ('passed', 'failed'):
            continue
        if not row['tester'] or not re.fullmatch('[0-9a-f]{40}', row['commit']):
            errors.append(f'{prefix}: tester and full tested commit required')
        try:
            stamp = datetime.fromisoformat(row['test_date'].replace('Z', '+00:00'))
            if stamp.utcoffset() is None:
                raise ValueError()
        except ValueError:
            errors.append(f'{prefix}: test_date needs ISO timestamp with timezone')
        try:
            path = local_file(root, row['evidence'])
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if digest != row['evidence_sha256']:
                errors.append(f'{prefix}: evidence SHA-256 mismatch')
        except (OSError, ValueError) as exc:
            errors.append(f'{prefix}: evidence unavailable: {exc}')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checklist', required=True)
    parser.add_argument('--root', default=str(Path(__file__).resolve().parent))
    args = parser.parse_args()
    try:
        errors = validate_evidence(args.checklist, args.root)
    except (OSError, ValueError) as exc:
        errors = [str(exc)]
    print('\n'.join(errors) if errors else 'OK: evidence records consistent; untested cases remain untested')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
