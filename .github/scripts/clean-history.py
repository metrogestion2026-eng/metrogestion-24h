"""One-use, owner-triggered cleanup. No protection changes or administrative APIs."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
REPO = 'metrogestion2026-eng/metrogestion-24h'
URL = 'https://github.com/' + REPO + '.git'
PREPARATION = 'refs/heads/security/privacidad-historial-20260920'

def run(args, cwd=None, capture=True, env=None):
    return subprocess.check_output(args, cwd=cwd, env=env).decode().strip() if capture else subprocess.check_call(args, cwd=cwd, env=env)

def git(*args, cwd=None, env=None):
    return run(['git', *args], cwd, env=env)

def heads(repo=None, env=None):
    raw = git('ls-remote', '--heads', URL, env=env) if repo is None else git('for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', cwd=repo)
    return {line.split()[1]: line.split()[0] for line in raw.splitlines()}

def validate_heads(actual, approved, expected_main, source_commit):
    expected_names = set(approved) | {PREPARATION}
    if set(actual) != expected_names:
        raise RuntimeError('Branch list changed; review the new branches before continuing')
    for name, sha in approved.items():
        if name != 'refs/heads/main' and actual[name] != sha:
            raise RuntimeError('A source branch changed; a new review is required: ' + name)
    if actual['refs/heads/main'] != expected_main or expected_main != source_commit:
        raise RuntimeError('Main changed or dispatch used a different revision; nothing will be pushed')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-main', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.expected_main):
        raise RuntimeError('Expected main must be a full commit SHA')
    if os.environ.get('GITHUB_REPOSITORY') != REPO or os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise RuntimeError('Run only from main in the intended repository')
    token = os.environ.get('GH_TOKEN', '')
    if not token:
        raise RuntimeError('Missing GitHub Actions token')
    auth_env = os.environ.copy()
    auth_env.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_COUNT='1', GIT_CONFIG_KEY_0='http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0='AUTHORIZATION: basic ' + base64.b64encode(('x-access-token:' + token).encode()).decode())
    approved = json.loads((ROOT / '.github/scripts/history-heads.json').read_text())
    before = heads(env=auth_env)
    validate_heads(before, approved, args.expected_main, os.environ.get('GITHUB_SHA'))
    destination = Path(os.environ['RUNNER_TEMP']) / 'history-clean.git'
    work = Path(os.environ['RUNNER_TEMP']) / 'history-checkout'
    git('clone', '--mirror', URL, str(destination), env=auth_env)
    if heads(destination) != before:
        raise RuntimeError('Branches changed while cloning')
    git('merge-base', '--is-ancestor', before[PREPARATION], before['refs/heads/main'], cwd=destination)
    # Source content has already been backed up privately by the operator.
    # Never upload a public Actions artifact containing the original fleet data.
    run([sys.executable, '-m', 'git_filter_repo', '--sensitive-data-removal', '--no-fetch', '--file-info-callback', str(ROOT / '.github/scripts/history-filter.py')], cwd=destination, capture=False)
    pattern = re.compile(rb'(?<![A-Z0-9])R?[0-9]{4}[ -]?[BCDFGHJKLMNPRSTVWXYZ]{3}(?![A-Z0-9])')
    objects = git('rev-list', '--objects', '--all', cwd=destination)
    forbidden = ('docs/repairs/', 'supabase/repairs/')
    for line in objects.splitlines():
        oid, _, path = line.partition(' ')
        if path.startswith(forbidden) or path == 'Manual_24H_DFM_v2_1.pdf':
            raise RuntimeError('Operational export remains in history')
        if Path(path).suffix in {'.html','.js','.mjs','.md','.sql','.json','.csv','.txt','.gs'}:
            content = subprocess.check_output(['git', 'cat-file', 'blob', oid], cwd=destination)
            if pattern.search(content):
                raise RuntimeError('Fleet plate remains in history: ' + path)
    after = heads(destination)
    if set(after) != set(before):
        raise RuntimeError('Cleanup changed branch names')
    git('worktree', 'add', str(work), 'main', cwd=destination)
    for folder in ('r1-alpha75', 'r1-alpha76', 'shared'):
        for path in (ROOT / folder).rglob('*'):
            if path.is_file() and path.read_bytes() != (work / path.relative_to(ROOT)).read_bytes():
                raise RuntimeError('Current application changed during rewrite')
    for path in work.glob('r1-alpha*/**/*.js'):
        run(['node', '--check', str(path)])
    for path in (work / 'shared').glob('**/*.js'):
        run(['node', '--check', str(path)])
    tests = list((work / 'tests').glob('security-*.test.mjs'))
    tests += [work / 'tests' / name for name in ('alpha71-manteniment-apps-script.test.mjs', 'alpha74-parada-tancament-al-asignar.test.mjs', 'alpha74-predictivo-agrupar-visita.test.mjs', 'alpha74-predictivo-dfm.test.mjs', 'history-query.test.mjs')]
    run(['node', '--test', *map(str, tests)], cwd=work, capture=False)
    run([sys.executable, 'tests/pages-public-files.test.py'], cwd=work, capture=False)
    run([sys.executable, '.github/scripts/check-public-privacy.py'], cwd=work, capture=False)
    run([sys.executable, '.github/scripts/build-pages.py', str(ROOT / '_site')], cwd=work, capture=False)
    if heads(env=auth_env) != before:
        raise RuntimeError('Remote branches changed during validation; nothing was pushed')
    if args.apply:
        leases = ['--force-with-lease=' + ref + ':' + sha for ref, sha in sorted(before.items())]
        refspecs = [ref + ':' + ref for ref in sorted(after)]
        # Atomic push: branch protection rejection leaves every branch unchanged.
        git('push', '--atomic', '--no-mirror', *leases, URL, *refspecs, cwd=destination, env=auth_env)
        if heads(env=auth_env) != after:
            raise RuntimeError('Post-push verification failed; inspect remote state')
    summary = {'applied': args.apply, 'branches': len(after), 'old_main': before['refs/heads/main'], 'new_main': after['refs/heads/main']}
    print(json.dumps(summary))
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
        f.write('## Limpieza histórica\n\n' + ('Aplicada y verificada' if args.apply else 'Simulación comprobada: ninguna rama modificada') + '\n\n```json\n' + json.dumps(summary, indent=2) + '\n```\n')

if __name__ == '__main__':
    main()
