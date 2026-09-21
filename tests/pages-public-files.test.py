import importlib.util
from html.parser import HTMLParser
from pathlib import Path
import re
import tempfile
import unittest
from urllib.parse import unquote, urlsplit

SPEC = importlib.util.spec_from_file_location('build_pages', Path(__file__).resolve().parents[1] / '.github/scripts/build-pages.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PublicBuildTest(unittest.TestCase):
    def test_app_is_copied_and_internal_content_is_excluded(self):
        with tempfile.TemporaryDirectory() as temp:
            root, destination = Path(temp) / 'repo', Path(temp) / 'site'
            included = ['index.html', 'r1-alpha75/src/app.js', 'r1-alpha76/index.html',
                        'shared/icon.svg', 'shared/history-query.mjs']
            excluded = ['docs/repair.json', 'tests/fixture.js', 'supabase/functions/handler.js',
                        'r1-alpha75/google-apps-script/private.js', 'r1-alpha76/.env',
                        'r1-alpha76/export.json', 'r1-alpha76/tests/fixture.js',
                        'r1-alpha75/google-apps-script/private.mjs', 'tests/private.mjs',
                        'supabase/functions/private.mjs', 'README.md']
            for name in included + excluded:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('fixture')
            self.assertEqual(MODULE.build(root, destination), len(included))
            self.assertEqual(sorted(str(p.relative_to(destination)) for p in destination.rglob('*') if p.is_file()), sorted(included))

    def test_symlink_cannot_publish_an_internal_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'repo'
            (root / 'r1-alpha76').mkdir(parents=True)
            (root / 'index.html').write_text('index')
            (root / 'internal.txt').write_text('private fixture')
            (root / 'r1-alpha76/leak.js').symlink_to(root / 'internal.txt')
            with self.assertRaises(ValueError):
                MODULE.build(root, Path(temp) / 'site')

    def test_legacy_pages_are_replaced_but_imported_modules_remain(self):
        with tempfile.TemporaryDirectory() as temp:
            root, destination = Path(temp) / 'repo', Path(temp) / 'site'
            pages = ['index.html', 'beta-1-8-prueba.html', 'r1-alpha17/index.html', 'v39-preview/metrogestion-2-0.html']
            for name in pages + ['r1-alpha17/src/supabase.js', 'r1-alpha76/index.html']:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('sensitive legacy fixture')
            MODULE.build(root, destination)
            for name in pages:
                content = (destination / name).read_text()
                self.assertNotIn('sensitive legacy fixture', content)
                self.assertIn('r1-alpha76/', content)
            self.assertEqual((destination / 'r1-alpha17/src/supabase.js').read_text(), 'sensitive legacy fixture')
            self.assertEqual((destination / 'r1-alpha76/index.html').read_text(), 'sensitive legacy fixture')

    def test_current_app_module_dependencies_are_published(self):
        class ModuleScripts(HTMLParser):
            def __init__(self):
                super().__init__()
                self.sources = []

            def handle_starttag(self, tag, attributes):
                attrs = dict(attributes)
                if tag == 'script' and attrs.get('type') == 'module' and attrs.get('src'):
                    self.sources.append(attrs['src'])

        # Static imports/re-exports and literal dynamic imports. Query strings
        # identify cache versions, not different files in the Pages artifact.
        imports = re.compile(r'''\b(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\s*\(\s*)['"]([^'"]+)['"]''')
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / 'site'
            MODULE.build(root, destination)
            checked = set()

            def visit(importer, specifier):
                url = urlsplit(specifier)
                if url.scheme or url.netloc:
                    return
                target = (destination / unquote(url.path).lstrip('/') if url.path.startswith('/')
                          else importer.parent / unquote(url.path)).resolve()
                self.assertTrue(target.is_relative_to(destination), f'Import outside public site: {specifier}')
                self.assertTrue(target.is_file(), f'Missing public dependency: {importer.relative_to(destination)} -> {specifier}')
                if target in checked:
                    return
                checked.add(target)
                for dependency in imports.findall(target.read_text()):
                    visit(target, dependency)

            for app in sorted(MODULE.CURRENT_APPS):
                entry = destination / app / 'index.html'
                parser = ModuleScripts()
                parser.feed(entry.read_text())
                self.assertTrue(parser.sources, f'No module entries in {app}')
                for source in parser.sources:
                    visit(entry, source)
            self.assertIn(destination / 'shared/history-query.mjs', checked)


if __name__ == '__main__':
    unittest.main()
