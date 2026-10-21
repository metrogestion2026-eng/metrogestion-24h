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
# VERSION is not in the Pages artifact used to reconstruct the code baseline.
# Its exact hf24 repository content was independently read at commit 3337d499.
VERSION = 'r1-alpha75/VERSION'
VERSION_BEFORE = '85970cc42f5441ed78f5031aac6991bb14825902429f62f6fb732c3cd592c389'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None

def run(*args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)

if len(MANIFEST) != 19:
    raise SystemExit('Unexpected scope')
errors = []
for name, hashes in MANIFEST.items():
    if '..' in Path(name).parts or not (name.startswith('r1-alpha75/') or name.startswith('tests/') or name == '.github/workflows/check-javascript.yml'):
        raise SystemExit('Unexpected path: ' + name)
    expected = VERSION_BEFORE if name == VERSION else hashes['before']
    actual = digest(ROOT / name)
    if actual != expected:
        errors.append(f'{name}: expected {expected}, actual {actual}')
if errors:
    raise SystemExit('Sources differ:\n' + '\n'.join(errors))
patch = gzip.decompress((HERE / 'changes.patch.gz').read_bytes())
if hashlib.sha256(patch).hexdigest() != EXPECTED_PATCH:
    raise SystemExit('Patch digest mismatch')
# Adapt only the literal source VERSION line, never product code or test results.
old = b'-r1.0.0-alpha.75.23-hf23\n+r1.0.0-alpha.75.23-hf25\n'
new = b'-r1.0.0-alpha.75.23-hf24\n+r1.0.0-alpha.75.23-hf25\n'
if patch.count(old) != 1:
    raise SystemExit('VERSION delta is not unique')
patch = patch.replace(old, new)
# difflib emits /dev/null without Git's new-file metadata. Add that metadata
# only for the three paths whose source was independently verified absent.
created = [name for name, hashes in MANIFEST.items() if hashes['before'] is None]
if len(created) != 3:
    raise SystemExit('Unexpected number of new files')
for name in created:
    header = f'diff --git a/{name} b/{name}\n--- /dev/null\n'.encode()
    if patch.count(header) != 1:
        raise SystemExit('New-file header is not unique: ' + name)
    patch = patch.replace(header, f'diff --git a/{name} b/{name}\nnew file mode 100644\n--- /dev/null\n'.encode())
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
