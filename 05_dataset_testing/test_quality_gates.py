import csv
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys

from evidence import FIELDS, validate_evidence, summarize_evidence
from run_checks import junit_counts, require_counts


class QualityGateTests(unittest.TestCase):
    def test_empty_failed_or_skipped_suite_is_not_green(self):
        for counts in ((0,), (5, 1), (5, 0, 1), (5, 0, 0, 5), (5, 0, 0, 1)):
            with self.subTest(counts=counts), self.assertRaises(ValueError):
                require_counts(*counts)
        require_counts(5)

    def test_junit_counts_are_checked(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'results.xml'
            path.write_text('<testsuites><testsuite tests="3" failures="0" errors="0" skipped="0">'
                            '<testcase/><testcase/><testcase/></testsuite></testsuites>')
            self.assertEqual(3, junit_counts(path)['tests'])
            path.write_text('<testsuites><testsuite tests="3" skipped="3"/></testsuites>')
            with self.assertRaises(ValueError):
                junit_counts(path)
            path.write_text('<testsuites><testsuite tests="3" failures="0" errors="0" skipped="0"/></testsuites>')
            with self.assertRaisesRegex(ValueError, 'no executed test cases'):
                junit_counts(path)

    def test_passed_evidence_requires_traceability(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            evidence = root / 'result.json'
            evidence.write_text(json.dumps({'status': 'passed', 'data_kind': 'synthetic'}))
            path = root / 'cases.csv'
            row = dict.fromkeys(FIELDS, '')
            row.update(case_id='05-SYN-1', status='passed', owner='05',
                       data_kind='synthetic', test_date='2026-10-21T00:00:00Z',
                       commit='a' * 40, tester='05 automation', evidence='result.json',
                       evidence_sha256=hashlib.sha256(evidence.read_bytes()).hexdigest())

            def save():
                with path.open('w', newline='') as stream:
                    writer = csv.DictWriter(stream, fieldnames=FIELDS)
                    writer.writeheader()
                    writer.writerow(row)

            save()
            self.assertEqual([], validate_evidence(path, root))
            evidence.write_text('changed')
            self.assertIn('SHA-256 mismatch', '\n'.join(validate_evidence(path, root)))
            row.update(evidence='../outside', commit='', tester='')
            save()
            errors = '\n'.join(validate_evidence(path, root))
            self.assertIn('tester and full tested commit', errors)
            self.assertIn('evidence unavailable', errors)

    def test_checked_in_cases_and_pilot_are_honest_and_independent(self):
        root = Path(__file__).resolve().parent
        self.assertEqual([], validate_evidence(root / 'integration-checklist.csv', root))
        with (root / 'templates/pilot-plan.csv').open(encoding='utf-8', newline='') as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(36, len(rows))
        self.assertEqual(180, sum(int(row['target_images']) for row in rows))
        for product in ('bottle_a', 'bottle_b'):
            selected = [r for r in rows if r['product_id'] == product]
            self.assertEqual({'development', 'validation', 'test'}, {r['split'] for r in selected})
            self.assertEqual(3, len({r['planned_group'] for r in selected}))
        for field in ('planned_bottle_id', 'planned_session'):
            split_by_id = {}
            for row in rows:
                self.assertEqual(split_by_id.setdefault(row[field], row['split']), row['split'])
                self.assertEqual('not_started', row['status'])

    def evidence_fixture(self, root, kinds):
        evidence = root / 'result.json'
        evidence.write_text('{"fixture": true}', encoding='utf-8')
        path = root / 'cases.csv'
        rows = []
        for index, kind in enumerate(kinds):
            row = dict.fromkeys(FIELDS, '')
            row.update(case_id=f'case-{index}', status='passed', owner='05', data_kind=kind,
                       test_date='2026-10-21T00:00:00Z', commit='a' * 40, tester='fixture only',
                       evidence='result.json', evidence_sha256=hashlib.sha256(evidence.read_bytes()).hexdigest())
            rows.append(row)
        with path.open('w', newline='', encoding='utf-8') as stream:
            writer = csv.DictWriter(stream, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        return path

    def test_consistent_synthetic_records_are_not_real_acceptance(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = self.evidence_fixture(root, ['synthetic'])
            report = summarize_evidence(path, root)
            self.assertTrue(report['records_consistent'])
            self.assertFalse(report['ready_for_acceptance'])
            self.assertEqual({'passed': 1}, report['status_counts'])
            self.assertEqual(['browser', 'hardware', 'real', 'visual'], report['missing_passed_evidence_kinds'])

    def test_all_kinds_and_cases_required_with_valid_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = self.evidence_fixture(root, ['real', 'hardware', 'browser', 'visual'])
            self.assertTrue(summarize_evidence(path, root)['ready_for_acceptance'])
            with path.open(encoding='utf-8', newline='') as stream:
                rows = list(csv.DictReader(stream))
            rows[0].update(status='blocked', notes='No real photos')
            with path.open('w', encoding='utf-8', newline='') as stream:
                writer = csv.DictWriter(stream, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerows(rows)
            report = summarize_evidence(path, root)
            self.assertTrue(report['records_consistent'])
            self.assertFalse(report['ready_for_acceptance'])
            self.assertEqual(['case-0'], report['pending_case_ids'])
            (root / 'result.json').write_text('changed', encoding='utf-8')
            report = summarize_evidence(path, root)
            self.assertFalse(report['records_consistent'])
            self.assertFalse(report['ready_for_acceptance'])

    def test_cli_record_check_and_strict_acceptance_are_distinct(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = self.evidence_fixture(root, ['synthetic'])
            report = root / 'summary.json'
            command = [sys.executable, '-B', str(Path(__file__).with_name('evidence.py')),
                       '--root', str(root), '--checklist', str(path), '--summary', str(report)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertFalse(json.loads(report.read_text())['ready_for_acceptance'])
            command[-1] = str(root / 'strict-summary.json')
            result = subprocess.run([*command, '--require-complete'], capture_output=True, text=True)
            self.assertEqual(1, result.returncode, result.stderr)
            self.assertIn('Acceptance incomplete', result.stdout)
            self.assertFalse(json.loads((root / 'strict-summary.json').read_text())['ready_for_acceptance'])
