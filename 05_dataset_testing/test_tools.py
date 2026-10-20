"""Isolated synthetic fixtures test tools, never measure detector accuracy."""
import csv
import json
import random
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from dataset_tools import FIELDS, components, image_info, read_csv, split_proposal, validate, write_new
from evaluate import PREDICTION_FIELDS, evaluate, summarize


class ToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = self.root / 'labels.csv'
        self.catalog = self.root / 'catalog.json'
        self.provenance = self.root / 'provenance.json'
        self.rows, assets = [], {}
        for i, split in enumerate(('development', 'validation', 'test', 'test', 'test', 'test')):
            rng = random.Random(i)
            image = Image.new('RGB', (32, 32))
            image.putdata([tuple(rng.randrange(256) for _ in range(3)) for _ in range(32 * 32)])
            image.save(self.root / f'{i}.png')
            row = dict(zip(FIELDS, [f'i{i}', f'{i}.png', f'b{i}', f's{i}', 'a', 'a', 'a', '',
                                    'yes', 'yes', 'yes', 'PASS', 'good', f'g{i}', split, 'human']))
            self.rows.append(row)
            assets[f'i{i}'] = {'source': 'synthetic unit test only', 'rights': 'test',
                               'condition': 'normal', 'synthetic': False,
                               'sha256': image_info(self.root / f'{i}.png')['sha256']}
        # Test-only records exercise the gate, not real dataset claims.
        self.metadata = {'dataset_version': 'unit-test', 'split_locked': True, 'assets': assets}
        self.product = {'demo': False, 'config_version': 'test-config', 'products': [
            {'product_id': 'a', 'display_name': 'test', 'brand': 'test', 'size_ml': 1,
             'reference_paths': ['0.png']}]}
        self.save()

    def save(self):
        self.manifest.write_text('', encoding='utf-8')
        with self.manifest.open('w', encoding='utf-8', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(self.rows[0]))
            writer.writeheader()
            writer.writerows(self.rows)
        self.catalog.write_text(json.dumps(self.product), encoding='utf-8')
        self.provenance.write_text(json.dumps(self.metadata), encoding='utf-8')

    def audit(self):
        return validate(self.root, self.manifest, self.catalog, self.provenance)[0]

    def test_valid_data_and_counts(self):
        report = self.audit()
        self.assertTrue(report['ready_for_evaluation'], report)
        self.assertEqual(report['counts']['test']['images'], 4)

    def test_or_transitive_leakage(self):
        self.rows[1]['physical_bottle_id'] = self.rows[0]['physical_bottle_id']
        self.rows[2]['capture_session'] = self.rows[1]['capture_session']
        self.save()
        report, rows, groups = validate(self.root, self.manifest, self.catalog, self.provenance)
        self.assertTrue(any(set(g) == {0, 1, 2} for g in groups))
        self.assertIn('Split leakage', ' '.join(report['errors']))

    def test_expected_product_variants_are_cases_not_new_images(self):
        self.product['products'].append({'product_id': 'b', 'brand': 'test', 'size_ml': 1,
                                         'display_name': 'b', 'reference_paths': []})
        self.rows.append(dict(self.rows[2], expected_product='b', result='FAIL', reason='wrong_label'))
        self.save()
        report = self.audit()
        self.assertEqual([], report['errors'])
        self.assertEqual(5, report['counts']['test']['cases'])
        self.assertEqual(4, report['counts']['test']['images'])

    def test_duplicate_case_rejected(self):
        self.rows.append(dict(self.rows[2]))
        self.save()
        self.assertIn('duplicate evaluation case', ' '.join(self.audit()['errors']))

    def test_path_traversal_and_invalid_image(self):
        for filename in ('../outside.png', 'C:/outside.png', '\\\\host\\file.png', 'missing.png'):
            with self.subTest(filename=filename):
                self.rows[0]['filename'] = filename
                self.save()
                self.assertIn('unreadable/unsafe', ' '.join(self.audit()['errors']))
        self.rows[0]['filename'] = '0.png'
        (self.root / '0.png').write_bytes(b'not an image')
        self.save()
        self.assertIn('unreadable/unsafe', ' '.join(self.audit()['errors']))

    def test_hash_duplicate_across_splits(self):
        (self.root / '1.png').write_bytes((self.root / '0.png').read_bytes())
        self.metadata['assets']['i1']['sha256'] = self.metadata['assets']['i0']['sha256']
        self.save()
        report = self.audit()
        self.assertIn(['0.png', '1.png'], report['exact_duplicates'])
        self.assertIn('Split leakage', ' '.join(report['errors']))

    def test_derivative_connects_and_unknown_source_rejected(self):
        for row in self.rows:
            row['source_image_id'] = ''
        self.rows[2]['source_image_id'] = 'i0'
        self.save()
        self.assertIn('Split leakage', ' '.join(self.audit()['errors']))
        self.rows[2]['source_image_id'] = 'not-found'
        self.save()
        self.assertIn('Unknown source', ' '.join(self.audit()['errors']))

    def test_manifest_semantics(self):
        for changes, message in [({'angle_deg': 'NaN'}, 'angle_deg'),
                                 ({'label_product': ''}, 'PASS contradicts'),
                                 ({'result': 'FAIL', 'reason': 'missing_label', 'label_product': '',
                                   'label_present': 'no'}, 'missing_label needs'),
                                 ({'result': 'FAIL', 'reason': 'wrong_label'}, 'known different'),
                                 ({'result': 'FAIL', 'reason': 'misplaced_label'}, 'position_ok=no'),
                                 ({'reviewer': ''}, 'empty reviewer')]:
            with self.subTest(changes=changes):
                original = dict(self.rows[2])
                self.rows[2].update(changes)
                self.save()
                self.assertIn(message, ' '.join(self.audit()['errors']))
                self.rows[2] = original

    def test_provenance_and_reference_required(self):
        self.metadata['assets']['i0']['sha256'] = 'wrong'
        self.product['products'][0]['reference_paths'] = ['2.png']
        self.save()
        errors = ' '.join(self.audit()['errors'])
        self.assertIn('SHA-256 mismatch', errors)
        self.assertIn('Reference must trace', errors)

    def test_misplaced_label_rejects_absent_or_unknown_label(self):
        for present in ('no', 'unknown'):
            with self.subTest(label_present=present):
                self.rows[2].update(result='FAIL', reason='misplaced_label', position_ok='no',
                                    label_present=present, label_product='', visible_enough='yes')
                self.save()
                before = self.manifest.read_bytes()
                report = self.audit()
                self.assertFalse(report['ready_for_evaluation'])
                self.assertTrue(any('line 4' in error and 'label_present=yes' in error
                                    for error in report['errors']), report['errors'])
                self.assertEqual(before, self.manifest.read_bytes())

    def test_misplaced_label_requires_visibility_and_wrong_position(self):
        self.rows[2].update(result='FAIL', reason='misplaced_label', position_ok='no')
        for field, invalid in (('visible_enough', 'no'), ('visible_enough', 'unknown'),
                               ('position_ok', 'yes'), ('position_ok', 'unknown')):
            with self.subTest(field=field, invalid=invalid):
                self.rows[2].update(visible_enough='yes', position_ok='no')
                self.rows[2][field] = invalid
                self.save()
                report = self.audit()
                self.assertFalse(report['ready_for_evaluation'])
                self.assertTrue(any('line 4' in error and field in error for error in report['errors']))

    def test_misplaced_label_valid_case_is_accepted(self):
        self.rows[2].update(result='FAIL', reason='misplaced_label', position_ok='no',
                            label_present='yes', visible_enough='yes')
        self.save()
        report = self.audit()
        self.assertEqual([], report['errors'])
        self.assertTrue(report['ready_for_evaluation'])

    def test_cli_and_evaluation_reject_contradictory_misplaced_label(self):
        run, predictions = self.prediction_run()
        self.eval(run, predictions)  # Prepare otherwise-valid prediction input.
        for present in ('no', 'unknown'):
            with self.subTest(label_present=present):
                self.rows[2].update(result='FAIL', reason='misplaced_label', position_ok='no',
                                    label_present=present, label_product='', visible_enough='yes')
                self.save()
                before = self.manifest.read_bytes()
                audit_path = self.root / f'audit-{present}.json'
                command = [sys.executable, '-B', str(Path(__file__).with_name('dataset_tools.py')),
                           '--root', str(self.root), '--manifest', str(self.manifest),
                           '--catalog', str(self.catalog), '--provenance', str(self.provenance),
                           '--report', str(audit_path)]
                result = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(1, result.returncode, result.stderr)
                self.assertFalse(json.loads(result.stdout)['ready_for_evaluation'])
                self.assertTrue(any('label_present' in error for error in
                                    json.loads(audit_path.read_text())['errors']))
                with self.assertRaisesRegex(ValueError, 'Dataset gate is not ready'):
                    self.eval(run, predictions)
                output = self.root / f'evaluation-{present}.json'
                command = [sys.executable, '-B', str(Path(__file__).with_name('evaluate.py')),
                           '--root', str(self.root), '--manifest', str(self.manifest),
                           '--catalog', str(self.catalog), '--provenance', str(self.provenance),
                           '--predictions', str(self.root / 'pred.csv'), '--run', str(run),
                           '--mode', 'webcam', '--report', str(output)]
                result = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(2, result.returncode, result.stdout)
                self.assertIn('Dataset gate is not ready', result.stderr)
                self.assertFalse(output.exists())
                self.assertEqual(before, self.manifest.read_bytes())

    def test_near_duplicates_need_human_review(self):
        Image.new('RGB', (32, 32), 'red').save(self.root / '0.png')
        Image.new('RGB', (32, 32), 'blue').save(self.root / '1.png')
        for i in (0, 1):
            self.metadata['assets'][f'i{i}']['sha256'] = image_info(self.root / f'{i}.png')['sha256']
        self.save()
        self.assertFalse(self.audit()['ready_for_evaluation'])
        self.metadata['near_duplicate_reviews'] = [{'filenames': ['0.png', '1.png'],
            'sha256': [self.metadata['assets'][f'i{i}']['sha256'] for i in (0, 1)],
            'decision': 'distinct', 'reviewer': 'human', 'note': 'Different source captures'}]
        self.save()
        self.assertTrue(self.audit()['ready_for_evaluation'])

    def test_split_is_reproducible_and_keeps_groups(self):
        self.rows[1]['capture_session'] = self.rows[0]['capture_session']
        groups = components(self.rows, {})
        proposal = split_proposal(self.rows, groups, 5)
        self.assertEqual(proposal, split_proposal(self.rows, groups, 5))
        assigned = {r['image_id']: r for r in proposal}
        self.assertEqual(assigned['i0']['split'], assigned['i1']['split'])
        self.assertEqual(set(r['split'] for r in proposal), {'development', 'validation', 'test'})
        with self.assertRaises(ValueError):
            split_proposal(self.rows, [list(range(6))], 5)

    def test_split_proposal_requires_new_references_and_audit(self):
        self.metadata['split_locked'] = False
        self.save()
        original = self.audit()
        self.assertTrue(original['ready_for_evaluation'])
        before = {p: p.read_bytes() for p in (self.manifest, self.catalog, self.provenance)}
        proposal_path, report_path = self.root / 'proposal.csv', self.root / 'source-audit.json'
        command = [sys.executable, '-B', str(Path(__file__).with_name('dataset_tools.py')),
                   '--root', str(self.root), '--manifest', str(self.manifest),
                   '--catalog', str(self.catalog), '--provenance', str(self.provenance),
                   '--report', str(report_path), '--propose-splits', str(proposal_path), '--seed', '5']
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual('source_manifest', output['audit_scope'])
        self.assertEqual('unvalidated', output['split_proposal']['status'])
        self.assertTrue(output['split_proposal']['requires_new_audit'])
        source_report = json.loads(report_path.read_text())
        self.assertEqual(output['split_proposal'], source_report['split_proposal'])
        self.assertEqual(original['manifest_sha256'], source_report['manifest_sha256'])
        for path, content in before.items():
            self.assertEqual(content, path.read_bytes())

        proposed, _ = read_csv(proposal_path, FIELDS)
        self.assertNotEqual('development', next(r['split'] for r in proposed if r['filename'] == '0.png'))
        self.rows = proposed
        self.save()
        stale_references = self.audit()
        self.assertFalse(stale_references['ready_for_evaluation'])
        self.assertIn('Reference must trace to development: 0.png', stale_references['errors'])

        reference = next(r['filename'] for r in self.rows if r['split'] == 'development')
        self.product['products'][0]['reference_paths'] = [reference]
        self.save()
        fresh = self.audit()
        self.assertTrue(fresh['ready_for_evaluation'], fresh['errors'])
        self.assertNotEqual(source_report['manifest_sha256'], fresh['manifest_sha256'])
        self.assertNotEqual(source_report['catalog_sha256'], fresh['catalog_sha256'])
        final_path = self.root / 'final-audit.json'
        write_new(final_path, fresh)
        final = json.loads(final_path.read_text())
        self.assertTrue(final['ready_for_evaluation'])
        for product in self.product['products']:
            for ref in product['reference_paths']:
                self.assertTrue(all(r['split'] == 'development' for r in self.rows if r['filename'] == ref))

    def test_cli_can_propose_before_selecting_references(self):
        self.metadata['split_locked'] = False
        self.product['products'][0]['reference_paths'] = []
        self.save()
        proposal_path = self.root / 'proposal.csv'
        command = [sys.executable, '-B', str(Path(__file__).with_name('dataset_tools.py')),
                   '--root', str(self.root), '--manifest', str(self.manifest),
                   '--catalog', str(self.catalog), '--provenance', str(self.provenance),
                   '--report', str(self.root / 'source-audit.json'),
                   '--propose-splits', str(proposal_path)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(1, result.returncode, result.stderr)
        output = json.loads(result.stdout)
        self.assertFalse(output['ready_for_evaluation'])
        self.assertEqual('unvalidated', output['split_proposal']['status'])
        self.assertTrue(proposal_path.is_file())
        proposed, _ = read_csv(proposal_path, FIELDS)
        self.assertEqual(6, len(proposed))
        self.assertEqual([], self.product['products'][0]['reference_paths'])

    def test_csv_and_output_never_overwrites(self):
        path = self.root / 'bad.csv'
        path.write_text('a,a\nx,y\n', encoding='utf-8')
        with self.assertRaises(ValueError):
            read_csv(path, ['a'])
        path.write_text('a,b\nx\n', encoding='utf-8')
        with self.assertRaises(ValueError):
            read_csv(path, ['a', 'b'])
        with self.assertRaises(FileExistsError):
            write_new(path, {'changed': True})

    def prediction_run(self):
        report = self.audit()
        metadata = {key: report[key] for key in ('dataset_version', 'config_version', 'manifest_sha256', 'catalog_sha256', 'provenance_sha256')}
        metadata.update(commit='test-only', hardware='test', resolution='32x32',
                        config_locked=True, locked_at='2026-10-19T00:00:00Z')
        run = self.root / 'run.json'
        run.write_text(json.dumps(metadata), encoding='utf-8')
        predictions = [dict(zip(PREDICTION_FIELDS, [f'i{i}', 'a', 'webcam', 'PASS', 'good', '',
                                                  'test-config', '0', '10', '2', '12'])) for i in range(2, 6)]
        return run, predictions

    def eval(self, run, predictions):
        path = self.root / 'pred.csv'
        with path.open('w', encoding='utf-8', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=PREDICTION_FIELDS)
            writer.writeheader()
            writer.writerows(predictions)
        return evaluate(self.root, self.manifest, self.catalog, self.provenance, path, run, 'webcam')

    def test_evaluation_known_outcomes_and_denominators(self):
        self.rows[3].update(result='FAIL', reason='misplaced_label', position_ok='no')
        self.save()
        run, predictions = self.prediction_run()
        predictions[0].update(result='REVIEW', reason='ambiguous_match')
        predictions[2].update(result='', reason='', error_code='503', orientation_ms='',
                              inspection_ms='', storage_ms='', total_ms='')
        summary = self.eval(run, predictions)['summary']
        self.assertEqual({'numerator': 1, 'denominator': 1, 'rate': 1}, summary['false_pass'])
        self.assertEqual(2, summary['false_reject']['denominator'])
        self.assertEqual(1 / 3, summary['review_rate']['rate'])
        self.assertEqual(3, summary['timing_ms']['total']['n'])
        self.assertEqual(12, summary['timing_ms']['total']['p95'])
        self.assertEqual({'503': 1}, summary['operational_errors'])

    def test_empty_denominators_are_na(self):
        summary = summarize([])
        self.assertIsNone(summary['false_pass']['rate'])
        self.assertIsNone(summary['timing_ms']['total']['p95'])

    def test_evaluation_rejects_incomplete_duplicate_invalid_and_config_changes(self):
        run, predictions = self.prediction_run()
        for mutated in (predictions[:-1], predictions + [predictions[0]],
                        [dict(predictions[0], inspection_ms='NaN')] + predictions[1:],
                        [dict(predictions[0], total_ms='999')] + predictions[1:],
                        [dict(predictions[0], error_code='503')] + predictions[1:],
                        [dict(predictions[0], source_mode='simulation')] + predictions[1:]):
            with self.subTest(mutated=mutated), self.assertRaises(ValueError):
                self.eval(run, mutated)
        self.rows[0]['reviewer'] = 'different'
        self.save()
        with self.assertRaisesRegex(ValueError, 'manifest_sha256'):
            self.eval(run, predictions)

    def test_cli_report_and_nonzero_on_bad_data(self):
        command = [sys.executable, '-B', str(Path(__file__).with_name('dataset_tools.py')),
                   '--root', str(self.root), '--manifest', str(self.manifest),
                   '--catalog', str(self.catalog), '--provenance', str(self.provenance),
                   '--report', str(self.root / 'audit.json')]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr + result.stdout)
        self.assertTrue(json.loads((self.root / 'audit.json').read_text())['ready_for_evaluation'])
        (self.root / '0.png').unlink()
        command[-1] = str(self.root / 'bad-audit.json')
        self.assertEqual(1, subprocess.run(command, capture_output=True).returncode)
        self.assertEqual(2, subprocess.run(command, capture_output=True).returncode)

    def test_final_test_requires_frozen_split_and_timezone(self):
        self.metadata['split_locked'] = False
        self.save()
        run, predictions = self.prediction_run()
        with self.assertRaisesRegex(ValueError, 'split_locked'):
            self.eval(run, predictions)
        self.metadata['split_locked'] = True
        self.save()
        run, predictions = self.prediction_run()
        metadata = json.loads(run.read_text())
        metadata['locked_at'] = '2026-10-19'
        run.write_text(json.dumps(metadata))
        with self.assertRaisesRegex(ValueError, 'locked_at'):
            self.eval(run, predictions)

    def test_cli_evaluation_writes_report(self):
        run, predictions = self.prediction_run()
        self.eval(run, predictions)
        command = [sys.executable, '-B', str(Path(__file__).with_name('evaluate.py')),
                   '--root', str(self.root), '--manifest', str(self.manifest),
                   '--catalog', str(self.catalog), '--provenance', str(self.provenance),
                   '--predictions', str(self.root / 'pred.csv'), '--run', str(run),
                   '--mode', 'webcam', '--report', str(self.root / 'evaluation.json')]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        output = json.loads((self.root / 'evaluation.json').read_text())
        self.assertEqual(4, output['summary']['valid_inspections'])
        self.assertEqual(2, subprocess.run(command, capture_output=True).returncode)

    def test_malformed_json_shapes_are_rejected(self):
        for data in ([], {'products': [None]}, {'products': [{'reference_paths': None}]}):
            with self.subTest(data=data):
                self.catalog.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    self.audit()
        self.save()
        for data in ([], {'dataset_version': 'x', 'assets': {'i0': None}},
                     {'dataset_version': 'x', 'assets': {}, 'near_duplicate_reviews': [None]}):
            with self.subTest(data=data):
                self.provenance.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    self.audit()

    def test_cli_cannot_resplit_locked_dataset(self):
        command = [sys.executable, '-B', str(Path(__file__).with_name('dataset_tools.py')),
                   '--root', str(self.root), '--manifest', str(self.manifest),
                   '--catalog', str(self.catalog), '--provenance', str(self.provenance),
                   '--report', str(self.root / 'audit.json'),
                   '--propose-splits', str(self.root / 'proposal.csv')]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(2, result.returncode)
        self.assertIn('locked', result.stderr)
        self.assertFalse((self.root / 'proposal.csv').exists())


if __name__ == '__main__':
    unittest.main()
