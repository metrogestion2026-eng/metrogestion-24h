"""Reject real-looking fleet plates and operational repair exports in tracked files."""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
PLATE = re.compile(rb"(?<![A-Z0-9])R?[0-9]{4}[ -]?[BCDFGHJKLMNPRSTVWXYZ]{3}(?![A-Z0-9])")
TEXT = {'.html', '.js', '.mjs', '.md', '.sql', '.json', '.csv', '.tsv', '.txt', '.gs'}

def violations(root=ROOT):
    names = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z']).decode().split('\0')
    issues = []
    for name in filter(None, names):
        p = root / name
        if not p.exists():
            continue
        if name.startswith(('docs/repairs/', 'supabase/repairs/')):
            issues.append((name, 'operational repair data belongs outside the public repository'))
        elif p.suffix.lower() in TEXT and PLATE.search(p.read_bytes()):
            issues.append((name, 'use a fictitious TEST identifier, not a fleet plate'))
    return issues

if __name__ == '__main__':
    issues = violations()
    for name, reason in issues:
        print(f'{name}: {reason}')
    print(f'Public privacy checks: {len(issues)} violations')
    sys.exit(bool(issues))
