"""Dedicated, disposable PostgreSQL17 server for native integration tests.

Ubuntu24.04/amd64 only. Downloads pinned official PGDG packages into /tmp,
verifies SHA256, and extracts them without installing a system service.
Never reuses or removes an existing data directory. Run as an unprivileged user.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import urllib.request

ROOT = Path('/tmp/metrogestion-pg17-native')
DATA = ROOT / 'data'
SOCKET = ROOT / 'socket'
RUNTIME = ROOT / 'runtime'
BIN = RUNTIME / 'usr/lib/postgresql/17/bin'
MARKER = ROOT / 'isolated-test-server.json'
PORT = 55473
PACKAGES = (
    ('pool/main/p/postgresql-17/postgresql-17_17.11-1.pgdg24.04+2_amd64.deb',
     'd5b58058a82a3f344f832aea2cc54badc4f6265c25c960752cb1f5df5d2180ee'),
    ('pool/main/p/postgresql-17/postgresql-client-17_17.11-1.pgdg24.04+2_amd64.deb',
     'b3b071b67a814a382516d6f6241b529c52f909672457e2f48083acce047b634f'),
    ('pool/main/p/postgresql-18/libpq5_18.6-1.pgdg24.04+2_amd64.deb',
     'b487c5ed2ceb9244c6a9d6ae65818ed6707c3c44a2e14488394ae4194c52c53b'),
)


def child_environment():
    return {**os.environ, 'LD_LIBRARY_PATH': str(RUNTIME / 'usr/lib/x86_64-linux-gnu')}


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True, env=child_environment())


def assert_local_directory():
    if ROOT.is_symlink() or ROOT.resolve() != ROOT:
        raise RuntimeError('The dedicated test directory must not be a symlink')
    for directory in (DATA, SOCKET, RUNTIME, ROOT / 'packages', ROOT / 'logs'):
        if directory.is_symlink():
            raise RuntimeError(f'Refusing symlink: {directory}')


def start():
    if os.geteuid() == 0:
        raise RuntimeError('Run this isolated test server as an unprivileged user')
    release = Path('/etc/os-release').read_text()
    if platform.machine() != 'x86_64' or 'ID=ubuntu\n' not in release or 'VERSION_ID="24.04"' not in release:
        raise RuntimeError('The pinned packages require Ubuntu24.04 on amd64')
    assert_local_directory()
    if DATA.exists() and any(DATA.iterdir()):
        raise RuntimeError('An existing data directory is never reused or overwritten')
    for directory in (ROOT, ROOT / 'packages', ROOT / 'logs', DATA, SOCKET):
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    for package_path, digest in PACKAGES:
        target = ROOT / 'packages' / Path(package_path).name
        if not target.exists():
            url = 'https://apt.postgresql.org/pub/repos/apt/' + package_path
            with urllib.request.urlopen(url, timeout=30) as response:
                target.write_bytes(response.read())
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise RuntimeError(f'Official package checksum mismatch: {target.name}')
        run('dpkg-deb', '-x', target, RUNTIME)
    run(BIN / 'initdb', '-D', DATA, '-L', RUNTIME / 'usr/share/postgresql/17',
        '-U', 'metrogestion_test', '--auth-local=trust', '--auth-host=reject',
        '--encoding=UTF8', '--locale=C')
    with (DATA / 'postgresql.conf').open('a') as config:
        config.write("\nlisten_addresses = ''\n")
        config.write(f"unix_socket_directories = '{SOCKET}'\nport = {PORT}\n")
        config.write("timezone = 'UTC'\njit = off\n")
    MARKER.write_text(json.dumps({'purpose': 'metrogestion-native-tests',
                                 'data_directory': str(DATA), 'uid': os.geteuid()}))
    run(BIN / 'pg_ctl', '-D', DATA, '-l', ROOT / 'logs/server.log', '-t', '30', '-w', 'start')
    run(BIN / 'psql', '-h', SOCKET, '-p', str(PORT), '-U', 'metrogestion_test',
        '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c',
        "SELECT version(),current_setting('listen_addresses'),inet_server_addr();")
    print('Dedicated PostgreSQL ready: Unix socket only, no TCP listener.')


def stop():
    assert_local_directory()
    if not MARKER.exists():
        print('No server created by this script; nothing to stop.')
        return
    marker = json.loads(MARKER.read_text())
    if marker != {'purpose': 'metrogestion-native-tests', 'data_directory': str(DATA), 'uid': os.geteuid()}:
        raise RuntimeError('Test server identity does not match this invocation')
    if not (DATA / 'postmaster.pid').exists():
        print('The dedicated test server is already stopped.')
        return
    run(BIN / 'pg_ctl', '-D', DATA, '-t', '30', '-w', '-m', 'fast', 'stop')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('start', 'stop'))
    action = parser.parse_args().action
    {'start': start, 'stop': stop}[action]()
