"""Check evidence records without converting smoke tests to real-data acceptance."""
import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime
from pathlib import Path
import re
import sys

from dataset_tools import local_file, read_csv, write_new

FIELDS = ('case_id status owner test_date commit tester data_kind evidence evidence_sha256 notes').split()
KINDS = {'synthetic', 'real', 'browser', 'hardware', 'visual'}
ACCEPTANCE_KINDS = {'real', 'browser', 'hardware', 'visual'}


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


def summarize_evidence(checklist, root):
    rows, digest = read_csv(checklist, FIELDS)
    errors = validate_evidence(checklist, root)
    passed_kinds = {row['data_kind'] for row in rows if row['status'] == 'passed'}
    pending = [row['case_id'] for row in rows if row['status'] != 'passed']
    return {'checklist_sha256': digest, 'records_consistent': not errors,
            'ready_for_acceptance': not errors and not pending and ACCEPTANCE_KINDS <= passed_kinds,
            'status_counts': dict(Counter(row['status'] for row in rows)),
            'by_data_kind': {kind: dict(Counter(row['status'] for row in rows if row['data_kind'] == kind))
                             for kind in sorted(KINDS)},
            'missing_passed_evidence_kinds': sorted(ACCEPTANCE_KINDS - passed_kinds),
            'pending_case_ids': pending, 'errors': errors,
            'note': 'Record consistency is not system acceptance. Human review is still required; '
                    'synthetic tests cannot replace real, hardware or visual evidence.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checklist', required=True)
    parser.add_argument('--root', default=str(Path(__file__).resolve().parent))
    parser.add_argument('--summary', help='Optional NEW JSON status report; never overwrite')
    parser.add_argument('--require-complete', action='store_true',
                        help='Fail unless all cases pass and real/browser/hardware/visual evidence exists')
    args = parser.parse_args()
    try:
        summary = summarize_evidence(args.checklist, args.root)
        if args.summary:
            write_new(args.summary, summary)
        errors = summary['errors']
        if args.require_complete and not summary['ready_for_acceptance']:
            errors = [*errors, 'Acceptance incomplete: pending/failed cases or missing real/browser/hardware/visual evidence']
    except (OSError, ValueError) as exc:
        errors = [str(exc)]
    print('\n'.join(errors) if errors else 'OK: evidence records consistent; untested cases remain untested')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
