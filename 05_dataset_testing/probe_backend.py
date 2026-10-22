"""Readiness probe through real HTTP routes in temporary storage; never fabricates config/GT."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from uuid import uuid4

from dataset_tools import write_new

ROOT = Path(__file__).resolve().parents[1]


def probe(input_root, output, expected_product):
    """Run in a fresh process: backend settings are configured before imports."""
    input_root = Path(input_root).resolve()
    files = sorted(p for p in input_root.iterdir() if p.suffix.lower() in ('.jpg', '.jpeg', '.jfif', '.png'))
    if not files:
        raise ValueError('No source images; do not substitute generated images for real capture')
    output = Path(output).resolve()
    if output.exists():
        raise ValueError('Output already exists; choose a new directory')
    # Deliberately no real detector configuration is invented or installed here.
    with tempfile.TemporaryDirectory(prefix='05-readiness-') as temp:
        os.environ['STORAGE_ROOT'] = temp
        os.environ['DEFAULT_TO_DEMO'] = 'false'
        os.environ['ALLOW_DEMO_MODE'] = 'false'
        sys.path.insert(0, str(ROOT / 'apps/backend'))
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.config import settings
        from app.services.inspection_adapter import InspectionAdapter
        assert settings.STORAGE_ROOT.resolve() == Path(temp).resolve()
        output.mkdir(parents=True)
        receipts, statuses = [], []
        with TestClient(app) as client:
            health = client.get('/api/health').json()
            catalog = client.get('/api/products').json()
            if expected_product not in {p['product_id'] for p in catalog['products']}:
                raise ValueError('expected_product not present in the current server catalog')
            for index, path in enumerate(files, 1):
                payload = path.read_bytes()
                request_id = str(uuid4())
                response = client.post('/api/inspections', files={'image':(path.name,payload,'image/png' if path.suffix.lower()=='.png' else 'image/jpeg')},
                    data={'expected_product':expected_product,'source_mode':'simulation','client_request_id':request_id,'demo':'false'})
                receipt = {'protocol':'single_view','image_id':f'probe-{index:03d}',
                    'expected_product':expected_product,'source_mode':'simulation',
                    'config_version':health['config_version'],'http_status':response.status_code,
                    'input_sha256':hashlib.sha256(payload).hexdigest(),
                    'input_provenance':'user-supplied candidate; no accepted ground truth or rights confirmation',
                    'request_id':request_id,'response':response.json()}
                receipts.append(receipt)
                statuses.append(response.status_code)
            history = client.get('/api/inspections').json()
            ready = InspectionAdapter.is_detector_ready()
        report = {'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
            'scope':'actual HTTP readiness probe; not detector accuracy or accepted dataset',
            'backend_config_version':health['config_version'],'detector_ready':ready,
            'catalog':catalog,'attempts':len(files),'http_statuses':statuses,
            'history_total':history.get('total'),'temporary_storage':True,
            'physical_webcam_used':False,'ground_truth_available':False,
            'final_evaluation_performed':False}
        (output/'receipts.jsonl').write_bytes(('\n'.join(json.dumps(r,ensure_ascii=False) for r in receipts)+'\n').encode('utf-8'))
        write_new(output/'readiness.json',report)
    return report


def main():
    for stream in (sys.stdout,sys.stderr):
        if hasattr(stream,'reconfigure'):
            stream.reconfigure(encoding='utf-8',errors='replace')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-root',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--expected-product',required=True,help='Request context only, not human GT or confirmed product identity')
    args=parser.parse_args()
    try:
        report=probe(args.input_root,args.output,args.expected_product)
        print(json.dumps(report,ensure_ascii=False))
        return 0 if report['detector_ready'] else 1
    except (OSError,ValueError,ImportError) as exc:
        print(f'ERROR: {exc}',file=sys.stderr)
        return 2


if __name__=='__main__':
    sys.exit(main())
