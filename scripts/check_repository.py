"""Validate the documentation scaffold and sample contract, using stdlib only."""
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES = ['01_web_ui', '02_simulation_3d', '03_image_processing',
           '04_webcam_backend_logging', '05_dataset_testing']
errors = []
for module in MODULES:
    for name in ['env.txt', 'step.txt', 'process.txt']:
        p = ROOT / module / name
        if not p.is_file():
            errors.append(f'Missing {p.relative_to(ROOT)}')
            continue
        text = p.read_text(encoding='utf-8')
        if len(text) < 900:
            errors.append(f'Guide too short: {p.relative_to(ROOT)}')
        if '\ufffd' in text or '\x00' in text:
            errors.append(f'Invalid text: {p.relative_to(ROOT)}')

required = ['README.md', 'CONTRIBUTING.md', '.env.example', '.gitignore',
            'docs/team.md', 'docs/api-contract.md', 'docs/architecture.md',
            'docs/dataset-guide.md', 'docs/storage-guide.md', 'docs/testing-plan.md',
            'docs/implementation-status.md', 'prototypes/conveyor-demo.html']
for path in required:
    if not (ROOT / path).is_file():
        errors.append(f'Missing {path}')

for path in ROOT.rglob('*.md'):
    if '.git' in path.parts or 'node_modules' in path.parts:
        continue
    text = path.read_text(encoding='utf-8')
    for link in re.findall(r'\]\(([^)]+)\)', text):
        if '://' in link or link.startswith(('#', 'mailto:')):
            continue
        target = link.split('#')[0]
        if target and not (path.parent / target).exists():
            errors.append(f'Broken link: {path.relative_to(ROOT)} -> {link}')

for path in (ROOT / 'examples').glob('inspection-*.json'):
    result = json.loads(path.read_text(encoding='utf-8'))
    if result['result'] not in ['PASS', 'FAIL', 'REVIEW']:
        errors.append(f'Invalid result in {path.name}')
    score = result['match_score']
    if score is not None and (isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 1):
        errors.append(f'Invalid score in {path.name}')
    for name in ['bbox', 'expected_bbox']:
        box = result[name]
        if box is not None and not (box['x'] >= 0 and box['y'] >= 0 and box['width'] > 0 and box['height'] > 0 and box['x'] + box['width'] <= result['image_width'] and box['y'] + box['height'] <= result['image_height']):
            errors.append(f'Invalid {name} in {path.name}')
    if not result.get('demo'):
        errors.append(f'Synthetic example must declare demo: {path.name}')

with (ROOT / 'examples/labels.csv').open(encoding='utf-8', newline='') as stream:
    reader = csv.DictReader(stream)
    for col in ['image_id', 'physical_bottle_id', 'capture_session', 'expected_product', 'result', 'split']:
        if col not in (reader.fieldnames or []):
            errors.append(f'CSV missing column: {col}')
    groups = {}
    for row in reader:
        key = (row['physical_bottle_id'], row['capture_session'])
        if key in groups and groups[key] != row['split']:
            errors.append(f'Example split leakage: {key}')
        groups[key] = row['split']

if errors:
    raise SystemExit('\n'.join(errors))
print('OK: 15 module guides, required files, Markdown links, JSON contracts and CSV groups')
