from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from import_predictions import import_receipts, normalize


def receipt():
    return {'protocol': 'single_view', 'image_id': 'i1', 'expected_product': 'a',
            'source_mode': 'webcam', 'config_version': 'real-v1', 'response': {
                'demo': False, 'inspection_id': '00000000-0000-4000-8000-000000000001',
                'client_request_id': '10000000-0000-4000-8000-000000000001',
                'expected_product': 'a', 'source_mode': 'webcam', 'config_version': 'real-v1',
                'result': 'FAIL', 'reason': 'wrong_label', 'storage_status': 'failed',
                'evidence': {'kind': 'single_view'},
                'timing_ms': {'orientation': 0, 'inspection': 12, 'storage': 3, 'total': 15}}}


class PredictionImportTests(unittest.TestCase):
    def test_product_result_survives_storage_failure(self):
        result = normalize(receipt())
        self.assertEqual(('FAIL', 'wrong_label', ''), (result['result'], result['reason'], result['error_code']))
        self.assertEqual(15, result['total_ms'])

    def test_demo_invalid_timing_and_context_are_rejected(self):
        for key, value in (('demo', True), ('demo', None), ('config_version', 'other'),
                           ('client_request_id', 'bad'), ('timing_ms', {'total': float('nan')})):
            with self.subTest(key=key):
                item = receipt()
                item['response'][key] = value
                with self.assertRaises(ValueError):
                    normalize(item)

    def test_operational_error_has_no_product_result(self):
        item = receipt()
        item['response'] = {'error': {'code': 'inspection_unavailable', 'message': '503'}}
        result = normalize(item)
        self.assertEqual('', result['result'])
        self.assertEqual('', result['total_ms'])
        self.assertEqual('inspection_unavailable', result['error_code'])
        item['response']['result'] = 'FAIL'
        with self.assertRaises(ValueError):
            normalize(item)

    def test_multiview_receipts_are_not_singleview_metrics(self):
        item = receipt()
        item['protocol'] = 'multi_view'
        with self.assertRaises(ValueError):
            normalize(item)
        item['protocol'] = 'single_view'
        item['response']['evidence']['kind'] = 'multi_view'
        with self.assertRaises(ValueError):
            normalize(item)

    def test_duplicate_and_empty_receipts_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'http.jsonl'
            path.write_text(json.dumps(receipt()) + '\n')
            self.assertEqual(1, len(import_receipts(path)))
            path.write_text((json.dumps(receipt()) + '\n') * 2)
            with self.assertRaisesRegex(ValueError, 'Duplicate case'):
                import_receipts(path)
            other = deepcopy(receipt())
            other['image_id'] = 'i2'
            path.write_text(json.dumps(receipt()) + '\n' + json.dumps(other))
            with self.assertRaisesRegex(ValueError, 'inspection ID reused'):
                import_receipts(path)
            path.write_text('')
            with self.assertRaisesRegex(ValueError, 'No HTTP receipts'):
                import_receipts(path)
