"""Build the public website from an explicit set of static app files.

Repository visibility is independent: this excludes internal files from Pages,
but does not make files already committed to a public repository private.
"""

from pathlib import Path
import re
import shutil
import sys

ROOT_FILES = {
    '.nojekyll', 'index.html', 'instalar.html', 'activar-24h.html',
    'beta-1-8-prueba.html', 'beta-1-9-prueba.html', 'beta-1-9-1.html',
    'metrogestion-2-0.html', 'v39-tablet.html',
    'manifest-24h-beta-1-9.json', 'manifest-metrogestion-2-0.json',
    'sw-24h-beta-1-9.js', 'sw-metrogestion-2-0.js', 'sw-metrogestion-core.js',
    'icono-gestion-24h-192.png', 'icono-gestion-24h-512.png', 'icono-gestion-24h.svg',
}
APP_ROOT = re.compile(r'(?:r1-(?:alpha\d+|preview)|v39-(?:login|mobile|preview)|shared)')
STATIC_SUFFIXES = {'.html', '.js', '.css', '.webmanifest', '.png', '.svg', '.ico', '.jpg', '.jpeg', '.webp', '.gif', '.woff', '.woff2', '.ttf'}
EXCLUDED_PARTS = {'google-apps-script', 'docs', 'tests', 'supabase', 'validaciones', 'node_modules'}


def publishable(relative):
    parts = relative.parts
    if len(parts) == 1:
        return relative.name in ROOT_FILES
    return (bool(APP_ROOT.fullmatch(parts[0]))
            and not any(part.startswith('.') or part in EXCLUDED_PARTS for part in parts)
            and relative.suffix.lower() in STATIC_SUFFIXES)


def build(root, destination):
    root, destination = Path(root).resolve(), Path(destination).resolve()
    if destination == root or root.is_relative_to(destination):
        raise ValueError('The destination must not contain the source repository')
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Use a new, empty output directory')
    destination.mkdir(parents=True, exist_ok=True)
    count = 0
    for source in sorted(root.rglob('*')):
        relative = source.relative_to(root)
        if not publishable(relative):
            continue
        if source.is_symlink() or any(parent.is_symlink() for parent in source.parents if parent != root):
            raise ValueError(f'Symlinks cannot be published: {relative}')
        if not source.is_file():
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        count += 1
    if not (destination / 'index.html').is_file():
        raise ValueError('The public index is missing')
    return count


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2]
    print(f'Public static files: {build(root, sys.argv[1] if len(sys.argv) > 1 else root / "_site")}')
