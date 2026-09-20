import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('build_pages', Path(__file__).resolve().parents[1] / '.github/scripts/build-pages.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PublicBuildTest(unittest.TestCase):
    def test_app_is_copied_and_internal_content_is_excluded(self):
        with tempfile.TemporaryDirectory() as temp:
            root, destination = Path(temp) / 'repo', Path(temp) / 'site'
            included = ['index.html', 'r1-alpha75/src/app.js', 'r1-alpha76/index.html', 'shared/icon.svg']
            excluded = ['docs/repair.json', 'tests/fixture.js', 'supabase/functions/handler.js',
                        'r1-alpha75/google-apps-script/private.js', 'r1-alpha76/.env',
                        'r1-alpha76/export.json', 'r1-alpha76/tests/fixture.js', 'README.md']
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


if __name__ == '__main__':
    unittest.main()
