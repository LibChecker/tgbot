"""Focused importer regression checks against the actual locked portable ZIP."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import zipfile
from io import BytesIO
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('importer', Path(__file__).resolve().parents[1] / 'scripts/generate_libchecker_bundle.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ArtifactTest(unittest.TestCase):
    def test_unpublished_manifest_only_skips_default_bootstrap_404(self):
        lock = json.loads(m.DEFAULT_LOCK.read_text())
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'lock.json'
            for source, url, status, explicit, skip in [
                ('data/bootstrap-portable-v5.zip', m.DEFAULT_MANIFEST, 404, None, True),
                ('https://example.test/release.zip', m.DEFAULT_MANIFEST, 404, None, False),
                ('data/bootstrap-portable-v5.zip', 'https://example.test/manifest.json', 404, None, False),
                ('data/bootstrap-portable-v5.zip', m.DEFAULT_MANIFEST, 503, None, False),
                ('data/bootstrap-portable-v5.zip', m.DEFAULT_MANIFEST, 403, None, False),
                ('data/bootstrap-portable-v5.zip', m.DEFAULT_MANIFEST, 404, 'custom.zip', False),
            ]:
                path.write_text(json.dumps({**lock, 'source': source}))
                before = path.read_bytes()
                error = m.urllib.error.HTTPError(url, status, 'test', {}, None)
                with patch.object(m.urllib.request, 'urlopen', side_effect=error):
                    if skip:
                        m.update_lock(url, explicit, path)
                    else:
                        with self.assertRaises(m.urllib.error.HTTPError):
                            m.update_lock(url, explicit, path)
                self.assertEqual(path.read_bytes(), before)

    def test_same_version_only_compares_consumed_artifact_and_shared_metadata(self):
        lock = json.loads(m.DEFAULT_LOCK.read_text())
        data = m.load_archive(lock, m.DEFAULT_LOCK, m.CACHE_DIR, offline=True)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); path = root / 'lock.json'; manifest_path = root / 'manifest.json'
            manifest = copy.deepcopy(lock['manifest'])
            manifest['artifacts']['android']['sha256'] = 'a' * 64
            manifest['artifacts']['legacy']['sha256'] = 'b' * 64
            manifest_path.write_text(json.dumps(manifest)); path.write_text(json.dumps(lock))
            with patch.object(m, 'load_archive', return_value=data):
                m.update_lock(str(manifest_path), lock['source'], path)
            self.assertEqual(json.loads(path.read_text())['manifest'], manifest)
            for changed in ('portable', 'sourceRevision'):
                candidate = copy.deepcopy(manifest)
                if changed == 'portable':
                    candidate['artifacts']['portable']['sha256'] = 'c' * 64
                else:
                    candidate['sourceRevision'] = 'd' * 40
                manifest_path.write_text(json.dumps(candidate))
                before = path.read_bytes()
                with self.assertRaisesRegex(ValueError, 'immutable'):
                    m.update_lock(str(manifest_path), lock['source'], path)
                self.assertEqual(path.read_bytes(), before)

    def test_locked_archive_and_offline_cache(self):
        lock = json.loads(m.DEFAULT_LOCK.read_text())
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / 'cache'
            data = m.load_archive(lock, m.DEFAULT_LOCK, m.CACHE_DIR, offline=True)
            m.atomic_write(cache / (lock['manifest']['artifacts']['portable']['sha256'] + '.zip'), data)
            remote = {**lock, 'source': 'https://example.invalid/' + lock['manifest']['artifacts']['portable']['path']}
            with patch.object(m.urllib.request, 'urlopen', side_effect=AssertionError('network forbidden')):
                self.assertEqual(m.load_archive(remote, m.DEFAULT_LOCK, cache, offline=True), data)
                with self.assertRaisesRegex(ValueError, 'cache miss'):
                    m.load_archive(remote, m.DEFAULT_LOCK, Path(tmp) / 'empty', offline=True)
            cached = next(cache.glob('*.zip'))
            cached.write_bytes(data[:-1])
            with self.assertRaisesRegex(ValueError, 'size mismatch'):
                m.load_archive(lock, m.DEFAULT_LOCK, cache)
            bad = bytearray(data); bad[-1] ^= 1
            with self.assertRaisesRegex(ValueError, 'sha256 mismatch'):
                m.verify_archive_bytes(bad, lock['manifest']['artifacts']['portable'])
            mismatched = copy.deepcopy(lock); mismatched['manifest']['dataVersion'] += 1
            with self.assertRaisesRegex(ValueError, 'metadata mismatch'):
                m.convert_archive(data, mismatched)

    def test_generated_cache_requires_converter_lock_and_output_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'generated'; cache = Path(tmp) / 'cache'
            lock = json.loads(m.DEFAULT_LOCK.read_text())
            data = m.load_archive(lock, m.DEFAULT_LOCK, m.CACHE_DIR, offline=True)
            m.atomic_write(cache / (lock['manifest']['artifacts']['portable']['sha256'] + '.zip'), data)
            m.generate(output_dir=output, cache_dir=cache, offline=True)
            receipt = output / 'libchecker-generation.json'
            initial = json.loads(receipt.read_text())
            with patch.object(m, 'convert_archive', side_effect=AssertionError('should use verified output')):
                m.generate(output_dir=output, cache_dir=cache, offline=True)
            (output / m.OUTPUTS[0]).write_text('corrupt')
            m.generate(output_dir=output, cache_dir=cache, offline=True)
            self.assertEqual(initial, json.loads(receipt.read_text()))
            with patch.object(m, 'convert_archive', wraps=m.convert_archive) as convert:
                corrupt = {**initial, 'identity': 'old converter or lock'}
                receipt.write_text(json.dumps(corrupt))
                m.generate(output_dir=output, cache_dir=cache, offline=True)
                self.assertEqual(convert.call_count, 1)

    def test_candidate_failure_preserves_lock_and_bootstrap(self):
        lock = json.loads(m.DEFAULT_LOCK.read_text())
        data = m.load_archive(lock, m.DEFAULT_LOCK, m.CACHE_DIR, offline=True)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); lock_path = root / 'rules.lock.json'
            lock_path.write_text(json.dumps(lock))
            before = lock_path.read_bytes()
            manifest = copy.deepcopy(lock['manifest']); manifest['dataVersion'] += 1
            manifest_path = root / 'manifest.json'; manifest_path.write_text(json.dumps(manifest))
            with patch.object(m, 'load_archive', return_value=data):
                with self.assertRaisesRegex(ValueError, 'metadata mismatch'):
                    m.update_lock(str(manifest_path), 'data/bootstrap-portable-v5.zip', lock_path)
            self.assertEqual(lock_path.read_bytes(), before)
            manifest['dataVersion'] -= 2; manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'increase dataVersion'):
                m.update_lock(str(manifest_path), 'data/bootstrap-portable-v5.zip', lock_path)

    def test_published_transition_reports_diff_and_removes_bootstrap(self):
        lock = json.loads(m.DEFAULT_LOCK.read_text())
        data = m.load_archive(lock, m.DEFAULT_LOCK, m.CACHE_DIR, offline=True)
        lock['source'] = 'data/bootstrap-portable-v5.zip'
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); lock_path = root / 'rules.lock.json'
            lock_path.write_text(json.dumps(lock))
            bootstrap = root / lock['source']; bootstrap.parent.mkdir(parents=True); bootstrap.write_bytes(data)
            manifest = root / 'manifest.json'; manifest.write_text(json.dumps(lock['manifest']))
            report = root / 'report.md'
            source = 'https://example.invalid/' + lock['manifest']['artifacts']['portable']['path']
            with patch.object(m, 'load_archive', return_value=data):
                m.update_lock(str(manifest), source, lock_path, report)
            self.assertFalse(bootstrap.exists())
            self.assertEqual(json.loads(lock_path.read_text())['source'], source)
            self.assertIn('| All rules | 0 | 0 | 0 |', report.read_text())
            self.assertIn('| SVG icons | 0 | 0 | 0 |', report.read_text())
            self.assertIn('| Matcher details | 0 | 0 | 0 |', report.read_text())
            self.assertIn(lock['manifest']['sourceRevision'], report.read_text())

    def test_invalid_regex(self):
        lock = json.loads(m.DEFAULT_LOCK.read_text())
        data = m.load_archive(lock, m.DEFAULT_LOCK, m.CACHE_DIR, offline=True)
        files = m.archive_files(data)
        core = json.loads(files['core.json'])
        regex = next(row for row in core['rules'] if row['isRegexRule'])
        regex['name'] = '['
        files['core.json'] = json.dumps(core).encode()
        stream = BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            for name, value in files.items():
                archive.writestr(name, value)
        with self.assertRaises(m.re.error):
            m.convert_archive(stream.getvalue(), lock)

    def test_matcher_details_are_not_collapsed_by_uuid_or_legacy_key(self):
        lock = json.loads(m.DEFAULT_LOCK.read_text())
        data = m.load_archive(lock, m.DEFAULT_LOCK, m.CACHE_DIR, offline=True)
        files = m.archive_files(data)
        source = json.loads(files['core.json'])['rules']
        # These legacy aliases share a UUID/key but may later acquire distinct details.
        aliases = [r for r in source if r['regexName'] == 'regex_ali_security']
        first, second = aliases[:2]
        detail = json.loads(files[second['detailPath']])
        detail['data'][0]['data']['description'] = 'Per-matcher override'
        files[second['detailPath']] = json.dumps(detail).encode()
        stream = BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            for name, value in files.items():
                archive.writestr(name, value)
        rules, details, _ = m.convert_archive(stream.getvalue(), lock)
        by_name = {(r['type'], r['name']): r for r in rules}
        first_key = f"{first['type']}::regex/{first['regexName']}"
        second_key = by_name[(second['type'], second['name'])]['detailKey']
        self.assertNotEqual(first_key, second_key)
        self.assertEqual(details[first_key]['uuid'], details[second_key]['uuid'])
        self.assertNotEqual(details[first_key]['locales'], details[second_key]['locales'])

    def test_locale_variants_are_preserved(self):
        keys = ['zh-CN', 'zh-TW', 'zh-Hans', 'en', 'en-US']
        detail = m.normalize_detail({'uuid': 'example', 'data': [
            {'locale': key, 'data': {'label': key, 'description': key + ' description'}} for key in keys]})
        self.assertEqual(list(detail['locales']), keys)
        for key in keys:
            self.assertEqual(detail['locales'][key]['description'], key + ' description')

    def test_reader_paths_and_svg_safety(self):
        lock = json.loads(m.DEFAULT_LOCK.read_text())
        for key, value in [('source', '../escape.zip'), ('lockVersion', 2)]:
            with self.assertRaises(ValueError):
                m.validate_lock({**lock, key: value})
        newer = copy.deepcopy(lock); newer['manifest']['minimumReader']['portable'] = 6
        with self.assertRaisesRegex(ValueError, 'incompatible'):
            m.validate_lock(newer)
        for body in ['<script/>', '<path onclick="x"/>', '<path fill="url(https://example.com/x)"/>', '<path fill="url(#missing)"/>', '<defs><clipPath id="c"><path clip-path="url(#c)"/></clipPath></defs>', '<path fill="URL(https://example.com/x)"/>']:
            with self.assertRaises(ValueError):
                m.validate_svg(('<svg xmlns="http://www.w3.org/2000/svg">' + body + '</svg>').encode())
        safe = b'<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient><clipPath id="c"><path d="M0 0"/></clipPath></defs><path fill="url(#g)" clip-path="url(#c)" d="M0 0"/></svg>'
        self.assertEqual(m.validate_svg(safe), safe.decode())


if __name__ == '__main__':
    unittest.main()
