"""Import a hash-locked Rules v5 portable release. No floating source downloads."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from pathlib import Path, PurePosixPath

PACKAGE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_LOCK = PACKAGE_DIR / 'rules.lock.json'
DEFAULT_MANIFEST = 'https://raw.githubusercontent.com/LibChecker/LibChecker-Rules/rules-data/manifest.json'
OUTPUT_DIR = PACKAGE_DIR / 'src/generated'
CACHE_DIR = PACKAGE_DIR / '.cache/rules'
TYPES = {0, 1, 2, 3, 4, 9}
METADATA_FIELDS = ('schemaVersion', 'dataVersion', 'sourceRevision', 'compilerRevision',
                   'contentSha256', 'ruleCount', 'minimumReader')
OUTPUTS = ('libchecker-rules-core.js', 'libchecker-rules-detail.js', 'libchecker-sdk-icons.js')
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f'duplicate JSON key: {key}')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temp = Path(stream.name)
        stream.write(data)
    try:
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def valid_path(path):
    return (isinstance(path, str) and bool(path) and '\\' not in path
            and '\x00' not in path and not path.startswith('/') and all(p not in ('', '.', '..') for p in path.split('/')))


def validate_lock(lock):
    require(lock.get('lockVersion') == 1, 'unsupported lockVersion')
    manifest = lock['manifest']
    require(manifest['schemaVersion'] == 5, 'unsupported schemaVersion')
    require(type(manifest['dataVersion']) is int and manifest['dataVersion'] > 0, 'invalid dataVersion')
    require(type(manifest['ruleCount']) is int and manifest['ruleCount'] > 0, 'invalid ruleCount')
    require(re.fullmatch(r'[0-9a-f]{40}', manifest['sourceRevision']), 'invalid sourceRevision')
    for key in ('compilerRevision', 'contentSha256'):
        require(re.fullmatch(r'[0-9a-f]{64}', manifest[key]), f'invalid {key}')
    require(type(manifest['minimumReader']['portable']) is int
            and 0 < manifest['minimumReader']['portable'] <= 5, 'incompatible portable reader')
    artifact = manifest['artifacts']['portable']
    require(artifact['schemaVersion'] == 5 and type(artifact['minimumReaderVersion']) is int
            and 0 < artifact['minimumReaderVersion'] <= 5,
            'incompatible portable artifact')
    require(valid_path(artifact['path']), 'unsafe artifact path')
    require(re.fullmatch(r'[0-9a-f]{64}', artifact['sha256']), 'invalid artifact sha256')
    require(type(artifact['size']) is int and 0 < artifact['size'] <= MAX_ARCHIVE, 'invalid artifact size')
    source = lock['source']
    parsed = urllib.parse.urlsplit(source)
    if parsed.scheme:
        require(parsed.scheme == 'https' and parsed.hostname and not parsed.username
                and not parsed.password and not parsed.query and not parsed.fragment, 'source must be HTTPS without credentials/query')
        require(parsed.path.endswith('/' + artifact['path']), 'source must name the manifest artifact path')
    else:
        require(valid_path(source), 'local source must be relative to the lock')
    return artifact


def verify_archive_bytes(data, artifact):
    require(len(data) == artifact['size'], 'artifact size mismatch')
    require(sha256(data) == artifact['sha256'], 'artifact sha256 mismatch')
    return data


def load_archive(lock, lock_path, cache_dir, offline=False):
    artifact = validate_lock(lock)
    cached = cache_dir / (artifact['sha256'] + '.zip')
    if cached.exists():
        return verify_archive_bytes(cached.read_bytes(), artifact)
    source = lock['source']
    if source.startswith('https://'):
        require(not offline, 'offline cache miss for locked artifact')
        with urllib.request.urlopen(source, timeout=60) as response:
            require(urllib.parse.urlsplit(response.url).scheme == 'https', 'insecure artifact redirect')
            data = response.read(artifact['size'] + 1)
    else:
        data = (lock_path.parent / source).read_bytes()
    verify_archive_bytes(data, artifact)
    atomic_write(cached, data)
    return data


def archive_files(data):
    with zipfile.ZipFile(BytesIO(data)) as archive:
        infos = archive.infolist()
        require(len(infos) <= 10000, 'too many ZIP entries')
        require(sum(i.file_size for i in infos) <= MAX_EXPANDED, 'expanded ZIP too large')
        result = {}
        for info in infos:
            require(valid_path(info.filename) and not info.is_dir(), 'unsafe ZIP entry')
            require(info.filename not in result, 'duplicate ZIP entry')
            require((info.external_attr >> 16) & 0o170000 != 0o120000, 'ZIP symlink forbidden')
            result[info.filename] = archive.read(info)
    return result


def validate_svg(data):
    require(len(data) <= 256 * 1024 and b'<!' not in data, 'SVG size/DTD/entity rejected')
    root = ET.fromstring(data)
    tags = {'svg', 'g', 'path', 'defs', 'clipPath', 'linearGradient', 'radialGradient', 'stop'}
    attrs = {'width', 'height', 'viewBox', 'fill', 'stroke', 'id', 'd', 'transform', 'clip-path',
             'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-width',
             'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'x1', 'x2', 'y1', 'y2',
             'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform', 'offset',
             'stop-color', 'stop-opacity', 'clipPathUnits', 'spreadMethod'}
    ids, refs = {}, []
    def visit(node, depth):
        require(depth <= 32, 'SVG depth exceeded')
        require(not (node.text or '').strip() and not (node.tail or '').strip(), 'SVG text forbidden')
        require(node.tag.startswith('{http://www.w3.org/2000/svg}'), 'foreign SVG namespace')
        tag = node.tag.split('}', 1)[1]
        require(tag in tags, f'forbidden SVG element: {tag}')
        for key, value in node.attrib.items():
            require(key in attrs, f'forbidden SVG attribute: {key}')
            if key == 'id':
                require(re.fullmatch(r'[A-Za-z_][\w.-]*', value) and value not in ids, 'invalid SVG id')
                ids[value] = tag
            require(not any(c in value for c in ('<', '>', '&', '\\')), 'unsafe SVG value')
            if 'url' in value.lower():
                match = re.fullmatch(r'url\(#([A-Za-z_][\w.-]*)\)', value)
                require(match is not None and key in ('fill', 'stroke', 'clip-path'), 'external SVG reference')
                refs.append((key, match[1]))
            require(not any(token in value.lower() for token in ('javascript:', 'https:', 'http:', 'file:', '//', 'data:', '@import')), 'external SVG value')
        for child in node:
            visit(child, depth + 1)
    require(root.tag == '{http://www.w3.org/2000/svg}svg', 'missing SVG root')
    require(sum(1 for _ in root.iter()) <= 4096, 'too many SVG elements')
    visit(root, 1)
    for key, target in refs:
        require(target in ids and ids[target] in ({'clipPath'} if key == 'clip-path' else {'linearGradient', 'radialGradient'}), 'invalid local SVG reference')
    # References inside definitions can create cycles; producer output never needs them.
    for node in root.iter():
        if node.tag.endswith(('}clipPath', '}linearGradient', '}radialGradient')):
            require(not any('url' in value.lower() for child in node.iter() for value in child.attrib.values()), 'recursive SVG definition')
    return data.decode('utf-8')


def normalize_detail(payload):
    locales = {}
    for entry in payload['data']:
        locale = entry['locale']
        require(isinstance(locale, str) and locale, 'invalid detail locale')
        values = entry['data']
        detail = {target: values[source] for source, target in (
            ('label', 'label'), ('dev_team', 'team'), ('description', 'description'),
            ('source_link', 'source'), ('rule_contributors', 'contributors')) if values.get(source)}
        if detail:
            require(locale not in locales, 'duplicate detail locale')
            locales[locale] = detail
    return {'uuid': payload['uuid'], 'locales': locales}


def convert_archive(data, lock):
    files = archive_files(data)
    metadata = read_json(files['metadata.json'])
    require(all(metadata.get(k) == lock['manifest'][k] for k in METADATA_FIELDS), 'archive metadata mismatch')
    core = read_json(files['core.json'])
    require(core['schemaVersion'] == 5 and len(core['rules']) == metadata['ruleCount'], 'core schema/count mismatch')
    icons = {}
    for name, value in files.items():
        if name.startswith('icons/') and name.endswith('.svg'):
            require(re.fullmatch(r'icons/ic_lib_[a-z0-9_]+\.svg', name), 'invalid library icon ID')
            icons[PurePosixPath(name).stem] = validate_svg(value)
    for path in (PACKAGE_DIR / 'assets').glob('*.svg'):
        icons[path.stem] = validate_svg(path.read_bytes())
    require(all(name in icons for name in ('ic_sdk_placeholder', 'ic_lib_kotlin', 'ic_lib_jetpack_compose', 'ic_gradle')), 'required icons missing')
    rules, details, names, ids = [], {}, set(), set()
    for item in sorted(core['rules'], key=lambda row: (row['priority'], row['id'])):
        require(type(item['id']) is int and item['id'] > 0 and item['id'] not in ids, 'invalid rule id')
        ids.add(item['id'])
        require(type(item['priority']) is int and item['priority'] >= 0, 'invalid rule priority')
        require((item['type'], item['name']) not in names, 'duplicate rule name')
        names.add((item['type'], item['name']))
        require(type(item['isRegexRule']) is bool and type(item['isSimpleColorIcon']) is bool, 'invalid rule flags')
        require(isinstance(item['label'], str) and isinstance(item['name'], str) and item['name'], 'invalid rule name/label')
        require(type(item['type']) is int and item['type'] in range(10), 'invalid rule type')
        icon = item['iconId'] or 'ic_sdk_placeholder'
        require(icon in icons, f'missing icon: {icon}')
        detail_path = item['detailPath']
        detail = None
        if detail_path is not None:
            require(detail_path == f"details/{item['uuid']}/{item['id']}.json", 'invalid detail path')
            payload = read_json(files[detail_path])
            require(payload['uuid'] == item['uuid'], 'detail UUID mismatch')
            detail = normalize_detail(payload)
        if item['isRegexRule']:
            pattern = item['name']
            require(len(pattern) <= 1024 and not any(ord(c) > 65535 or c in '\n\r\x85\u2028\u2029' for c in pattern), 'unsupported regex literal')
            require(not re.search(r'\\(?:[A-Za-ce-z0-9])', pattern)
                    and not re.search(r'\(\?(?!:)|[*+?}]\+', pattern), 'unsupported portable regex')
            re.compile(pattern, re.ASCII)
        if item['type'] not in TYPES:
            continue
        require(type(item['iconIndex']) is int, 'invalid legacy icon index')
        rule = {key: item[key] for key in ('name', 'label', 'type', 'iconIndex', 'isRegexRule', 'regexName')}
        rule.update(iconName=icon, singleColorIcon=item['isSimpleColorIcon'])
        key = f"{item['type']}::regex/{item['regexName']}" if item['isRegexRule'] and item['regexName'] else f"{item['type']}::{item['name']}"
        if detail:
            if key in details and details[key] != detail:
                key = f"{key}::{item['id']}"
                rule['detailKey'] = key
            if item.get('legacyPath'):
                detail['path'] = item['legacyPath']
            details[key] = detail
        rules.append(rule)
    # Validate every generated pattern in the actual consumer runtime before writing outputs.
    subprocess.run([os.environ.get('NODE', 'node'), '--input-type=module', '-e',
        "let s='';for await(const c of process.stdin)s+=c;for(const r of JSON.parse(s))if(r.isRegexRule)new RegExp('^(?:'+r.name+')$','u');"],
        input=json.dumps(rules), text=True, check=True)
    return rules, details, icons


def generate(lock_path=DEFAULT_LOCK, output_dir=OUTPUT_DIR, cache_dir=CACHE_DIR, offline=False, refresh=False):
    lock_bytes = lock_path.read_bytes()
    lock = read_json(lock_bytes)
    data = load_archive(lock, lock_path, cache_dir, offline)
    identity = sha256(lock_bytes + Path(__file__).read_bytes() + b''.join(
        path.read_bytes() for path in sorted((PACKAGE_DIR / 'assets').glob('*.svg'))))
    receipt_path = output_dir / 'libchecker-generation.json'
    if not refresh and receipt_path.exists():
        receipt = read_json(receipt_path.read_bytes())
        if receipt.get('identity') == identity and all(
            (output_dir / name).exists() and sha256((output_dir / name).read_bytes()) == receipt.get('outputs', {}).get(name)
            for name in OUTPUTS):
            print('LibChecker locked artifact and generated cache verified.')
            return
    rules, details, icons = convert_archive(data, lock)
    version = lock['manifest']['artifacts']['portable']['sha256']
    output_dir.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name, symbol, value in zip(OUTPUTS, ('LIBCHECKER_RULES_CORE', 'LIBCHECKER_RULE_DETAILS', 'LIBCHECKER_SDK_ICON_SVGS'), (rules, details, icons)):
        body = '// Generated from hash-verified Rules v5 portable artifact.\n'
        if name == OUTPUTS[0]:
            body += f'export const LIBCHECKER_DATA_VERSION = {lock["manifest"]["dataVersion"]};\n'
            body += f'export const LIBCHECKER_ASSET_VERSION = "{version}";\n'
        body += f'export const {symbol} = {json.dumps(value, ensure_ascii=False, separators=(",", ":"))};\n'
        encoded = body.encode('utf-8')
        atomic_write(output_dir / name, encoded)
        hashes[name] = sha256(encoded)
    atomic_write(receipt_path, json.dumps({'identity': identity, 'outputs': hashes}).encode())
    print(f'Generated {len(rules)} rules, {len(details)} details, {len(icons)} icons; dataVersion {lock["manifest"]["dataVersion"]}.')


def update_report(previous_lock, previous_data, candidate, data):
    before_files = archive_files(previous_data) if previous_data else {}
    after_files = archive_files(data)
    before_rules = {r['id']: r for r in read_json(before_files.get('core.json', b'{"rules":[]}'))['rules']}
    after_rules = {r['id']: r for r in read_json(after_files['core.json'])['rules']}
    def changes(before, after):
        return (len(after.keys() - before.keys()), len(before.keys() - after.keys()),
                sum(before[key] != after[key] for key in before.keys() & after.keys()))
    old = previous_lock['manifest'] if previous_lock else {}
    new = candidate['manifest']
    lines = ['Update the pinned Rules v5 portable release.', '', '| Identity | Before | After |',
             '| --- | --- | --- |']
    for key in ('dataVersion', 'sourceRevision', 'compilerRevision', 'ruleCount'):
        lines.append(f"| {key} | `{old.get(key, 'none')}` | `{new[key]}` |")
    lines += ['', '| Data | Added | Removed | Changed |', '| --- | ---: | ---: | ---: |']
    for label, before, after in [
        ('All rules', before_rules, after_rules),
        ('Supported rules (0/1/2/3/4/9)', {k:v for k,v in before_rules.items() if v['type'] in TYPES},
         {k:v for k,v in after_rules.items() if v['type'] in TYPES}),
        ('SVG icons', {k:v for k,v in before_files.items() if k.startswith('icons/') and k.endswith('.svg')},
         {k:v for k,v in after_files.items() if k.startswith('icons/') and k.endswith('.svg')}),
        ('Matcher details', {k:v for k,v in before_files.items() if k.startswith('details/')},
         {k:v for k,v in after_files.items() if k.startswith('details/')})]:
        added, removed, changed = changes(before, after)
        lines.append(f'| {label} | {added} | {removed} | {changed} |')
    artifact = new['artifacts']['portable']
    lines += ['', f"Portable SHA-256: `{artifact['sha256']}` ({artifact['size']} bytes).",
              '', 'Validated manifest/ZIP identity, reader compatibility, SHA-256, byte size, regex patterns and SVG assets.',
              'No deployment or Telegram/KV changes. Stable icon IDs and the three generated ESM contracts are retained.']
    if previous_lock and previous_lock['source'] == 'data/bootstrap-portable-v5.zip' and candidate['source'].startswith('https://'):
        lines += ['', 'The first published release replaces and removes the vendored bootstrap ZIP in this PR.']
    return '\n'.join(lines) + '\n'


def update_lock(manifest_source, source, lock_path, report_path=None):
    if manifest_source.startswith('https://'):
        try:
            with urllib.request.urlopen(manifest_source, timeout=60) as response:
                require(response.url.startswith('https://'), 'insecure manifest redirect')
                raw = response.read(1024 * 1024 + 1)
        except urllib.error.HTTPError as error:
            if (error.code == 404 and manifest_source == DEFAULT_MANIFEST and source is None
                    and lock_path.exists()
                    and read_json(lock_path.read_bytes()).get('source') == 'data/bootstrap-portable-v5.zip'):
                print('Rules manifest is not published yet; retaining the verified bootstrap lock.')
                return
            raise
        require(len(raw) <= 1024 * 1024, 'manifest too large')
    else:
        raw = Path(manifest_source).read_bytes()
    manifest = read_json(raw)
    if source is None:
        require(manifest_source.startswith('https://'), 'local manifest requires --source')
        source = urllib.parse.urljoin(manifest_source, manifest['artifacts']['portable']['path'])
    candidate = {'lockVersion': 1, 'source': source, 'manifest': manifest}
    validate_lock(candidate)
    previous_lock = read_json(lock_path.read_bytes()) if lock_path.exists() else None
    if previous_lock:
        previous = previous_lock['manifest']
        require(manifest['dataVersion'] > previous['dataVersion'] or
                (manifest['dataVersion'] == previous['dataVersion']
                 and all(manifest[key] == previous[key] for key in METADATA_FIELDS)
                 and manifest['artifacts']['portable'] == previous['artifacts']['portable']),
                'updates must increase dataVersion; published versions are immutable')
    data = load_archive(candidate, lock_path, CACHE_DIR)
    convert_archive(data, candidate)
    previous_data = load_archive(previous_lock, lock_path, CACHE_DIR) if previous_lock else None
    report = update_report(previous_lock, previous_data, candidate, data)
    if report_path:
        atomic_write(report_path, report.encode())
    print(report)
    atomic_write(lock_path, (json.dumps(candidate, indent=2) + '\n').encode())
    if source.startswith('https://') and previous_lock and previous_lock['source'] == 'data/bootstrap-portable-v5.zip':
        (lock_path.parent / previous_lock['source']).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lock', type=Path, default=DEFAULT_LOCK)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--manifest', nargs='?', const=DEFAULT_MANIFEST, help='explicit manifest file or HTTPS URL to update the lock')
    parser.add_argument('--source', help='immutable HTTPS artifact URL or lock-relative bootstrap ZIP')
    parser.add_argument('--matching-fixtures', action='store_true')
    parser.add_argument('--report', type=Path, help='write the update diff as a Markdown PR body')
    parser.add_argument('--refresh', action='store_true', help='reconvert the locked release, never select latest')
    args = parser.parse_args()
    try:
        lock_path = args.lock.resolve()
        if args.manifest:
            require(not args.offline, '--manifest requires online mode')
            update_lock(args.manifest, args.source, lock_path, args.report)
        else:
            require(args.source is None, '--source requires --manifest')
        if args.matching_fixtures:
            lock = read_json(lock_path.read_bytes())
            data = load_archive(lock, lock_path, CACHE_DIR, args.offline)
            print(archive_files(data)['matching-fixtures.json'].decode())
            return
        generate(lock_path, offline=args.offline, refresh=args.refresh)
    except (ValueError, KeyError, OSError, re.error, ET.ParseError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Rules import failed: {error}\n')


if __name__ == '__main__':
    main()
