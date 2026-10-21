"""05-owned smoke gate. Zero tests, missing dependencies or skipped tests fail."""
import argparse
import hashlib
from datetime import datetime, timezone
import importlib.metadata
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def require_counts(tests, failed=0, errors=0, skipped=0):
    if tests < 1 or failed or errors or skipped:
        raise ValueError(f'Gate failed: tests={tests}, failures={failed}, errors={errors}, skipped={skipped}')


def junit_counts(path):
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == 'testsuite' else list(root.findall('testsuite'))
    totals = {key: sum(int(s.get(key, '0')) for s in suites)
              for key in ('tests', 'failures', 'errors', 'skipped')}
    require_counts(totals['tests'], totals['failures'], totals['errors'], totals['skipped'])
    totals['test_cases'] = sum(len(s.findall('testcase')) for s in suites)
    if not totals['test_cases']:
        raise ValueError('JUnit report contains no executed test cases')
    totals['subtests'] = totals['tests'] - totals['test_cases']
    return totals


def invoke(command, cwd, env):
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=600)
    output = result.stdout + result.stderr
    print(output, end='', flush=True)
    if result.returncode:
        raise ValueError(f'Command exited {result.returncode}: {command[0]}')
    return output


def unit_gate(folder):
    suite = unittest.TestLoader().discover(str(folder), pattern='test_*.py')
    stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
    print(stream.getvalue(), end='', flush=True)
    require_counts(result.testsRun, len(result.failures) + len(result.unexpectedSuccesses),
                   len(result.errors), len(result.skipped) + len(result.expectedFailures))
    return {'tests': result.testsRun, 'failures': 0, 'errors': 0, 'skipped': 0,
            'data_kind': 'synthetic', 'scope': 'offline behavior; not real-data accuracy'}


def backend_gate(folder, env):
    report = folder / 'backend.xml'
    invoke([sys.executable, '-B', '-m', 'pytest', 'apps/backend/tests', '-q',
            '-p', 'no:cacheprovider', f'--junitxml={report}'], ROOT, env)
    return {**junit_counts(report), 'data_kind': 'synthetic',
            'scope': 'backend HTTP/TestClient, detector and temporary DB/files; no hardware'}


def frontend_gate(folder, env, npm_cli=None):
    node = shutil.which('node')
    if not node:
        raise ValueError('Node.js is required')
    version = subprocess.check_output([node, '--version'], text=True).strip()
    minimum = json.loads((ROOT / 'apps/web/package.json').read_text())['engines']['node']
    if not re.fullmatch(r'>=\d+\.\d+\.\d+', minimum):
        raise ValueError(f'Unsupported engines.node constraint; review gate: {minimum}')
    if tuple(map(int, version.lstrip('v').split('.'))) < tuple(map(int, minimum[2:].split('.'))):
        raise ValueError(f'Node {version} does not satisfy {minimum}')
    npm = [node, str(Path(npm_cli).resolve())] if npm_cli else [shutil.which('npm') or 'npm']
    report = folder / 'vitest.json'
    invoke([*npm, 'test', '--', '--reporter=json', f'--outputFile={report}'], ROOT / 'apps/web', env)
    results = json.loads(report.read_text(encoding='utf-8'))
    require_counts(results['numTotalTests'], results['numFailedTests'],
                   int(not results['success']), results['numPendingTests'] + results.get('numTodoTests', 0))
    invoke([*npm, 'run', 'build'], ROOT / 'apps/web', env)
    return {'tests': results['numTotalTests'], 'failures': 0, 'errors': 0, 'skipped': 0,
            'build': 'passed', 'node': version, 'data_kind': 'synthetic',
            'scope': 'Vitest + production build; not browser/visual/hardware acceptance'}


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', choices=('dataset', 'backend', 'frontend', 'all'), default='all')
    parser.add_argument('--report', required=True, help='New JSON report, never overwrite')
    parser.add_argument('--npm-cli', help='Optional npm-cli.js path for machines without npm on PATH')
    args = parser.parse_args()
    output = Path(args.report).resolve()
    if output.exists():
        parser.error('Report already exists; choose a new path')
    report = {'tested_at': datetime.now(timezone.utc).isoformat(), 'suite': args.suite,
              'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'worktree_dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()),
              'python': sys.version, 'platform': sys.platform, 'results': {}, 'status': 'failed'}
    report['dependencies'] = {dist.metadata['Name']: dist.version for dist in importlib.metadata.distributions()}
    source_paths = list((ROOT / '05_dataset_testing').glob('*.py'))
    for base in ('apps/backend/app', 'apps/backend/tests', 'apps/web/src', 'scripts'):
        source_paths.extend(path for path in (ROOT / base).rglob('*') if path.suffix in ('.py', '.ts', '.tsx', '.css'))
    source_paths.extend(ROOT / name for name in ('apps/web/package.json', 'apps/web/package-lock.json',
                                                '05_dataset_testing/requirements-smoke.txt', '.github/workflows/05-testing.yml'))
    report['source_files_sha256'] = {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                                     for path in sorted(set(source_paths)) if path.is_file()}
    try:
        with tempfile.TemporaryDirectory(prefix='vending-05-smoke-') as temp:
            folder = Path(temp)
            # Existing backend fixtures isolate storage themselves. Do not override
            # config defaults that config-path tests intentionally verify.
            env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1',
                       PYTHONIOENCODING='utf-8', PYTHONUTF8='1')
            if args.suite in ('dataset', 'all'):
                invoke([sys.executable, '-B', 'scripts/check_repository.py'], ROOT, env)
                report['results']['dataset'] = unit_gate(ROOT / '05_dataset_testing')
                report['results']['repository'] = unit_gate(ROOT / 'scripts')
            if args.suite in ('backend', 'all'):
                report['results']['backend'] = backend_gate(folder, env)
            if args.suite in ('frontend', 'all'):
                report['results']['frontend'] = frontend_gate(folder, env, args.npm_cli)
            report['status'] = 'passed'
    except (OSError, ValueError, KeyError, ImportError, subprocess.SubprocessError, ET.ParseError) as exc:
        report['error'] = str(exc)
        print(f'ERROR: {exc}', file=sys.stderr)
    with output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
