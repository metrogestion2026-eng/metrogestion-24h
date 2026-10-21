"""Apply only the reviewed Alpha75 delta, with source/result content checks."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
MANIFEST = json.loads((HERE / 'manifest.json').read_text())
EXPECTED_PATCH = 'be643f8a078e986a79518367ce8af8cdbd205f12d558e48903ffa74734801e20'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None

def run(*args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)

if len(MANIFEST) != 19:
    raise SystemExit('Unexpected scope')
for name, hashes in MANIFEST.items():
    if '..' in Path(name).parts or not (name.startswith('r1-alpha75/') or name.startswith('tests/') or name == '.github/workflows/check-javascript.yml'):
        raise SystemExit('Unexpected path: ' + name)
    if digest(ROOT / name) != hashes['before']:
        raise SystemExit('Source differs: ' + name)
patch = gzip.decompress((HERE / 'changes.patch.gz').read_bytes())
if hashlib.sha256(patch).hexdigest() != EXPECTED_PATCH:
    raise SystemExit('Patch digest mismatch')
run('git', 'apply', '--check', '-', input=patch)
run('git', 'apply', '-', input=patch)
for name, hashes in MANIFEST.items():
    if digest(ROOT / name) != hashes['after']:
        raise SystemExit('Output differs: ' + name)
run('git', 'add', '--', *MANIFEST)
changed = subprocess.check_output(['git', 'diff', '--cached', '--name-only'], cwd=ROOT, text=True).splitlines()
if set(changed) != set(MANIFEST):
    raise SystemExit('Staged scope differs from manifest')
print('Verified 19 exact outputs; no shared Alpha76/Alpha80 or Apps Script files changed.')
