"""Self-hosted product center, Python 3.10+, SQLite and disk uploads."""
import argparse
import base64
import csv
from contextlib import closing, contextmanager
from datetime import datetime, timezone, timedelta
import getpass
import hashlib
import hmac
import io
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import tempfile
import threading
import time
import urllib.parse
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from catalog_import import parse_catalog
from image_processing import compress_image, make_thumbnail, MAX_IMAGE_BYTES, MAX_INPUT_BYTES

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('PRODUCT_CENTER_DATA', str(ROOT / 'data'))).resolve()
STATIC = ROOT / 'static'
MAX_UPLOAD = 20 * 1024 * 1024
UNITS = ('贴', '张', '枚', '个', '件', '包', '卷', '套', '份')
MODES = ('', '独立库存', '共用库存', '待关联', '仅统计销售')
STATUSES = ('draft', 'ready', 'published', 'paused')
LOCK = threading.RLock()
PREVIEWS = {}
LOGIN_ATTEMPTS = {}
AUTH_REQUIRED = False
PUBLIC_HOST = ''
VERSION = '1.11.8'
MAX_PRODUCT_IMAGES = 200
IMAGE_PROCESSING = threading.BoundedSemaphore(1)


def china_stamp(pattern):
    return datetime.now(timezone(timedelta(hours=8))).strftime(pattern)


class Problem(Exception):
    def __init__(self, message, status=400, **extra):
        self.message, self.status, self.extra = message, status, extra


@contextmanager
def db():
    connection = sqlite3.connect(DATA / 'products.sqlite3', timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys=ON')
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize():
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / 'uploads').mkdir(exist_ok=True)
    (DATA / 'imports').mkdir(exist_ok=True)
    (DATA / 'thumbnails').mkdir(exist_ok=True)
    with db() as con:
        con.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
            archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS skus (
            sku TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS images (
            id TEXT PRIMARY KEY, filename TEXT NOT NULL, original TEXT NOT NULL,
            mime TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS imports (fingerprint TEXT PRIMARY KEY, filename TEXT, result TEXT, created_at INTEGER);
        CREATE TABLE IF NOT EXISTS warehouse_syncs (product_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, product_id TEXT, action TEXT, revision INTEGER, at INTEGER, payload TEXT);
        ''')
        from warehouse_media import initialize as initialize_sync
        initialize_sync(con)


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def clipped(value, label, limit=300):
    if not isinstance(value, str) or len(value.strip()) > limit:
        raise Problem(label + '格式无效或过长。')
    return value.strip()


def amount(value, label):
    if value in ('', None):
        return None
    if isinstance(value, bool):
        raise Problem(label + '需要填写非负数字。')
    try:
        n = float(value)
    except (ValueError, TypeError):
        raise Problem(label + '需要填写非负数字。')
    if not 0 <= n <= 100000000:
        raise Problem(label + '需要填写有效的非负数字。')
    return n


def validate(raw, con):
    if not isinstance(raw, dict):
        raise Problem('产品资料格式无效。')
    result = {}
    for key, label, limit in [('name', '产品名称', 160), ('category', '产品类型', 80), ('scene', '使用场景', 80),
                              ('material', '材质', 160), ('process', '工艺', 160), ('owner', '负责人', 80),
                              ('description', '产品介绍', 20000), ('source', '资料来源', 500)]:
        result[key] = clipped(raw.get(key, ''), label, limit)
    from product_categories import category_value
    result['category'] = category_value(con, result['category'], Problem)
    from product_scenes import scene_value
    result['scene'] = scene_value(con,result['scene'],Problem)
    if not result['name']:
        raise Problem('请填写产品名称。')
    result['status'] = raw.get('status', 'draft')
    if result['status'] not in STATUSES:
        raise Problem('产品状态无效。')
    tags = raw.get('tags', [])
    if not isinstance(tags, list) or len(tags) > 30:
        raise Problem('每个产品最多填写30个标签。')
    result['tags'] = list(dict.fromkeys(clipped(t, '标签', 40) for t in tags if t))
    images = raw.get('images', [])
    if not isinstance(images, list) or len(images) > MAX_PRODUCT_IMAGES:
        raise Problem('每个产品最多保存%d张图片。' % MAX_PRODUCT_IMAGES)
    result['images'] = list(dict.fromkeys(clipped(i, '图片编号', 80) for i in images))
    for image in result['images']:
        if not con.execute('SELECT 1 FROM images WHERE id=?', (image,)).fetchone():
            raise Problem('图片尚未上传成功，请重新上传。')
    variants = raw.get('variants', [])
    if not isinstance(variants, list) or len(variants) > 1000:
        raise Problem('每个产品最多1000个规格。')
    from warehouse_config import config, SUPPLY_MODES, normalize_supply
    if 'supply_defaults' in raw:
        defaults = raw['supply_defaults']
        from material_printing import PRINT_FIELDS, clean_inputs
        if not isinstance(defaults, dict) or set(defaults) - {'supply_mode', 'print_rule_code', 'digit_condition_code', *PRINT_FIELDS}:
            raise Problem('产品默认供货设置无效。')
        clean = {key: clipped(defaults.get(key, ''), '供货规则', 160) for key in ['supply_mode', 'print_rule_code', 'digit_condition_code']}
        clean['supply_mode'] = normalize_supply(clean['supply_mode'])
        if clean['supply_mode'] not in SUPPLY_MODES:
            raise Problem('默认供货方式无效。')
        try:clean.update(clean_inputs(defaults))
        except ValueError as error:raise Problem(str(error))
        result['supply_defaults'] = clean
    from pricing import COST_MODES
    try: result['warehouse_config'] = config(raw.get('warehouse_config'))
    except ValueError as error: raise Problem(str(error))
    result['variants'] = []
    seen = set()
    for idx, raw_variant in enumerate(variants):
        if not isinstance(raw_variant, dict):
            raise Problem('规格格式无效。')
        variant = {}
        for key, limit in [('sku', 160), ('name', 300), ('erp_code', 200), ('size', 160), ('pack_unit', 20),
                           ('material', 160), ('inventory_mode', 30), ('stock_code', 160), ('note', 1000), ('source_sheet', 160), ('source_col', 16), ('supply_mode', 30), ('print_rule_code', 160), ('digit_condition_code', 160)]:
            variant[key] = clipped(raw_variant.get(key, ''), '第%d个规格的%s' % (idx + 1, key), limit)
        if '\n' in variant['sku'] or '\r' in variant['sku']:
            raise Problem('SKU编码不能包含换行。')
        if variant['sku'] and variant['sku'] in seen:
            raise Problem('规格中SKU编码重复：' + variant['sku'])
        seen.add(variant['sku'])
        if variant['pack_unit'] and variant['pack_unit'] not in UNITS:
            raise Problem('数量单位请选择：' + '、'.join(UNITS))
        n = amount(raw_variant.get('pack_qty'), '包装含量')
        if n is not None and (not n.is_integer() or not 1 <= n <= 100000):
            raise Problem('包装含量需要填写1至100000的整数。')
        variant['pack_qty'] = int(n) if n is not None else None
        for key in ('cost', 'price', 'shipping', 'unit_cost'):
            variant[key] = amount(raw_variant.get(key), {'cost': '成本', 'price': '售价', 'shipping': '运费', 'unit_cost': '每单位成本'}[key])
        variant['cost_mode'] = raw_variant.get('cost_mode') or ('固定整份成本' if variant['cost'] is not None else '按实物自动计算')
        if variant['cost_mode'] not in COST_MODES: raise Problem('成本方式无效。')
        print_auto = normalize_supply(variant['supply_mode'] or result.get('supply_defaults', {}).get('supply_mode')) == '打印定制' and raw_variant.get('print_cost_source', 'auto') != 'manual'
        if variant['unit_cost'] is not None and not print_auto and normalize_supply(variant['supply_mode'] or result.get('supply_defaults', {}).get('supply_mode')) != '定制订单':
            from product_requirements import pack_cost
            try: variant['cost'] = pack_cost(variant['unit_cost'], variant['pack_qty'])
            except ValueError as error: raise Problem('第%d行：%s' % (idx + 1, error))
            variant['cost_mode'] = '固定整份成本'
        elif variant['cost_mode'] == '按实物自动计算': variant['cost'] = None
        variant['supply_mode'] = normalize_supply(variant['supply_mode'])
        if variant['supply_mode'] not in SUPPLY_MODES:
            raise Problem('供货方式无效。')
        from material_printing import clean_inputs
        try:variant.update(clean_inputs(raw_variant))
        except ValueError as error:raise Problem(str(error))
        for key in ('manual_cost', 'manual_unit_cost'):
            if key in raw_variant:variant[key] = amount(raw_variant[key], '保留的手工成本')
        if variant['inventory_mode'] not in MODES:
            raise Problem('库存方式无效。')
        if variant['inventory_mode'] != '共用库存' and variant['stock_code']:
            raise Problem('只有共用库存需要填写实物库存编码。')
        variant['source_row'] = raw_variant.get('source_row') if isinstance(raw_variant.get('source_row'), int) else None
        image_ids = raw_variant.get('image_ids', [])
        if not isinstance(image_ids, list) or len(image_ids) > 30 or any(i not in result['images'] for i in image_ids):
            raise Problem('规格图片需要先上传并保存在产品图片中。')
        variant['image_ids'] = list(dict.fromkeys(image_ids))
        fields = raw_variant.get('source_fields', {})
        if not isinstance(fields, dict) or len(fields) > 60:
            raise Problem('原表资料字段无效。')
        variant['source_fields'] = {clipped(k, '原表字段名', 120): clipped(v, '原表字段值', 3000) for k, v in fields.items()}
        if raw_variant.get('batch_key'):
            from batch_config import AUTO_FIELDS
            key = raw_variant['batch_key']
            overrides = raw_variant.get('batch_overrides', [])
            if not isinstance(key, str) or not re.fullmatch(r'[A-Z]{1,3}:[1-9][0-9]{0,5}', key) or not isinstance(overrides, list) or any(not isinstance(f, str) or f not in AUTO_FIELDS for f in overrides):
                raise Problem('批量规格同步记录无效。')
            variant.update(batch_key=key, batch_overrides=list(dict.fromkeys(overrides)))
        result['variants'].append(variant)
    if raw.get('batch_config') is not None:
        from batch_config import validate_batch
        try:
            result['batch_config'] = validate_batch(raw['batch_config'], result['name'], result['images'])
        except ValueError as error:
            raise Problem(str(error))
        keys = [v['batch_key'] for v in result['variants'] if v.get('batch_key')]
        if len(keys) != len(set(keys)):
            raise Problem('批量规格标识重复。')
    try:
        from product_inventory import apply as apply_inventory
        result = apply_inventory(result, raw)
        result['warehouse_config'] = config(result['warehouse_config'])
    except ValueError as error:
        raise Problem(str(error))
    from product_process import apply as apply_process
    try: apply_process(result, raw)
    except ValueError as error: raise Problem(str(error))
    from printing_costs import automatic, project
    if any(automatic(v) for v in result['variants']):
        from shared_rules import read as read_rules
        project([result], read_rules(con)['config'])
    return result


def record(row):
    value = json.loads(row['payload'])
    from product_process import present as present_process
    present_process(value)
    value.update(id=row['id'], revision=row['revision'], archived=bool(row['archived']), created_at=row['created_at'], updated_at=row['updated_at'])
    return value


def save_product(con, raw, product_id=None):
    product = validate(raw, con)
    now = int(time.time() * 1000)
    old = con.execute('SELECT * FROM products WHERE id=?', (product_id,)).fetchone() if product_id else None
    if product_id and not old:
        raise Problem('产品不存在。', 404)
    if old and raw.get('revision') != old['revision']:
        raise Problem('这款产品刚被更新，请先保留你的填写内容，再重新打开最新资料。', 409)
    if old and old['archived']:
        raise Problem('请先从回收站恢复产品。', 409)
    product_id = product_id or uuid.uuid4().hex
    for variant in product['variants']:
        if variant['sku']:
            existing = con.execute('SELECT product_id FROM skus WHERE sku=?', (variant['sku'],)).fetchone()
            if existing and existing['product_id'] != product_id:
                raise Problem('SKU编码已被其他产品使用：' + variant['sku'], 409)
    revision = old['revision'] + 1 if old else 1
    if old:
        con.execute('UPDATE products SET payload=?,revision=?,updated_at=? WHERE id=?', (dumps(product), revision, now, product_id))
        con.execute('DELETE FROM skus WHERE product_id=?', (product_id,))
    else:
        con.execute('INSERT INTO products(id,payload,created_at,updated_at) VALUES(?,?,?,?)', (product_id, dumps(product), now, now))
    con.executemany('INSERT INTO skus(sku,product_id) VALUES(?,?)', [(v['sku'], product_id) for v in product['variants'] if v['sku']])
    con.execute('INSERT INTO events(product_id,action,revision,at,payload) VALUES(?,?,?,?,?)', (product_id, 'update' if old else 'create', revision, now, dumps(product)))
    return record(con.execute('SELECT * FROM products WHERE id=?', (product_id,)).fetchone())


def ensure_thumbnail(image_id, data):
    target = DATA / 'thumbnails' / (image_id + '.webp')
    with LOCK:
        if not target.is_file():
            preview = make_thumbnail(data)
            temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
            temporary.write_bytes(preview.data)
            temporary.replace(target)
    return target


def persist_image(con, image, original):
    if len(image.data) > MAX_IMAGE_BYTES:
        raise Problem('图片压缩后仍超过200KB，请换一张图片。')
    image_id = hashlib.sha256(image.data).hexdigest()
    filename = image_id + image.extension
    target = DATA / 'uploads' / filename
    if not target.exists():
        temporary = target.with_suffix('.tmp')
        temporary.write_bytes(image.data)
        temporary.replace(target)
    ensure_thumbnail(image_id, image.data)
    con.execute('INSERT OR IGNORE INTO images VALUES(?,?,?,?,?,?)',
                (image_id, filename, original[:200], image.mime, len(image.data), int(time.time())))
    return {'id': image_id, 'name': original[:200], 'url': '/media/' + filename, 'thumbnail_url': '/thumbs/' + image_id + '.webp',
            'bytes': len(image.data), 'compression': image.details()}


def attach_workbook_images(parsed, content):
    mapping = {}
    compressed = []
    with zipfile.ZipFile(io.BytesIO(content)) as package:
        for path in parsed.get('image_paths', []):
            if path not in package.namelist():
                parsed['issues'].append({'sheet': '', 'row': None, 'message': '图片文件缺失：' + path})
                continue
            entry = package.getinfo(path)
            if entry.file_size > MAX_INPUT_BYTES:
                raise Problem('表格中的单张原图超过15MB，请先缩小图片。')
            try:
                with IMAGE_PROCESSING:
                    image = compress_image(package.read(path))
            except ValueError as error:
                raise Problem('表格图片无法处理：' + str(error))
            with LOCK, db() as con:
                result = persist_image(con, image, Path(path).name)
            mapping[path] = result['id']
            compressed.append(result)
    for product in parsed['products']:
        product['images'] = list(dict.fromkeys(mapping[r] for r in product.get('image_refs', []) if r in mapping))
        if len(product['images']) > MAX_PRODUCT_IMAGES:
            raise Problem('一个产品的图片超过200张，请拆分产品后导入。')
        for variant in product['variants']:
            variant['image_ids'] = list(dict.fromkeys(mapping[r] for r in variant.get('image_refs', []) if r in mapping))
    parsed['compressed_images'] = compressed
    return parsed


def commit_import(parsed, source_bytes):
    if parsed.get('cost_table'):
        from cost_catalog import commit_cost_catalog
        return commit_cost_catalog(parsed, source_bytes)
    with LOCK, db() as con:
        prior = con.execute('SELECT result FROM imports WHERE fingerprint=?', (parsed['fingerprint'],)).fetchone()
        if prior:
            return {**json.loads(prior['result']), 'already_imported': True}
        products = []
        for p in parsed['products']:
            product = json.loads(dumps(p))
            for variant in product['variants']:
                if variant['sku'] and con.execute('SELECT 1 FROM skus WHERE sku=?', (variant['sku'],)).fetchone():
                    if parsed.get('contract_version') == 2:
                        raise Problem('SKU已存在，本次V2导入未写入，请先核对：'+variant['sku'],409)
                    parsed['issues'].append({'sheet': p['name'], 'row': variant.get('source_row'), 'message': 'SKU已存在：' + variant['sku'] + '，此行暂留空编码。'})
                    variant['sku'] = ''
            products.append(save_product(con, product))
        image_count = len({image for p in products for image in p['images']})
        result = {'products': len(products), 'variants': parsed['variants'], 'images': image_count, 'issues': parsed['issues'], 'already_imported': False}
        if parsed['filename'].lower().endswith('.xlsx'):
            provenance = {'filename': parsed['filename'], 'sha256': parsed['fingerprint'], 'source_bytes': parsed.get('source_bytes', len(source_bytes)),
                          'products': products, 'issues': parsed['issues'], 'images': parsed.get('compressed_images', [])}
            (DATA / 'imports' / (parsed['fingerprint'] + '.json')).write_text(dumps(provenance), encoding='utf-8')
        else:
            (DATA / 'imports' / (parsed['fingerprint'] + '.csv')).write_bytes(source_bytes)
        con.execute('INSERT INTO imports VALUES(?,?,?,?)', (parsed['fingerprint'], parsed['filename'], dumps(result), int(time.time())))
        return result


def csv_bytes(headers, rows):
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(headers)
    for row in rows:
        safe = []
        for value in row:
            if value is None:
                value = ''
            if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@', '\t', '\r')):
                value = "'" + value
            safe.append(value)
        writer.writerow(safe)
    return output.getvalue().encode('utf-8-sig')


def warehouse_rows(products):
    rows, issues = [], []
    for p in products:
        if not p['variants'] and p.get('supply_defaults', {}).get('supply_mode') == '定制订单':
            continue
        if not p['variants']:
            issues.append({'product': p['name'], 'sku': '', 'message': '尚未添加销售规格'})
        for v in p['variants']:
            if (v.get('supply_mode') or p.get('supply_defaults', {}).get('supply_mode')) == '定制订单':
                continue
            missing = []
            if not v['sku']: missing.append('SKU编码')
            if not v['name']: missing.append('规格名称')
            if not v['pack_qty']: missing.append('包装含量')
            if not v['pack_unit']: missing.append('数量单位')
            if not v['inventory_mode']: missing.append('库存方式')
            if v['inventory_mode'] == '共用库存' and not v['stock_code']: missing.append('实物库存编码')
            if missing:
                issues.append({'product': p['name'], 'sku': v['sku'] or v['name'], 'message': '缺少' + '、'.join(missing)})
                continue
            rows.append([v['erp_code'], v['sku'], v['name'], v['size'], v['pack_qty'], v['pack_unit'], v['cost'],
                         v['material'] or p['material'], p['category'], v['inventory_mode'], v['stock_code'], v['note']])
    # Match the warehouse's shared-stock identity rules before writing a file.
    shared = {}
    for row in rows:
        if row[9] != '共用库存': continue
        key = row[10]
        design = re.sub(r'[-－—_\s]*\d+\s*(贴|枚|张|个|件|包)$', '', row[2]).replace(' ', '') if re.search(r'\d+\s*(贴|枚|张|个|件|包)$', row[2]) else None
        identity = (re.sub(r'厘米|cm|\s', '', row[3].lower()).replace('x', '×').replace('*', '×'), row[7].replace(' ', ''), row[5], design)
        if key in shared and shared[key] != identity:
            prior = shared[key]
            if prior[:3] != identity[:3] or (prior[3] and design and prior[3] != design):
                issues.append({'product': '', 'sku': row[1], 'message': '共用库存' + key + '的尺寸、材质、单位或款式不一致'})
        prior = shared.get(key)
        shared[key] = identity if not prior or (not prior[3] and design) else prior
    return rows, issues


WAREHOUSE_HEADERS = ['ERP编码', 'SKU编码', '规格名称', '尺寸', '每款SKU数量', '数量单位', '成本', '材质', '品类', '库存方式', '共用库存编码', '备注']


def purge_trash(con, items, *, empty=False):
    """Delete only the reviewed trash snapshot and images unused by any remaining product."""
    if not isinstance(items, list) or len(items) > 10000:
        raise Problem('回收站清单无效，请刷新后重试。')
    expected = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not re.fullmatch(r'[a-f0-9]{32}', item['id']) or type(item.get('revision')) is not int or item['id'] in expected:
            raise Problem('回收站清单无效，请刷新后重试。')
        expected[item['id']] = item['revision']
    rows = {r['id']: r for r in con.execute('SELECT * FROM products WHERE archived=1')}
    if empty and {k: r['revision'] for k, r in rows.items()} != expected:
        raise Problem('回收站内容已变化，请刷新后重新确认清空。', 409)
    for product_id, revision in expected.items():
        if product_id not in rows or rows[product_id]['revision'] != revision:
            raise Problem('产品已恢复、删除或更新，请刷新后再操作。', 409)
    candidates = {image for product_id in expected for image in json.loads(rows[product_id]['payload'])['images']}
    for product_id in expected:
        con.execute('DELETE FROM events WHERE product_id=?', (product_id,))
        con.execute('DELETE FROM products WHERE id=?', (product_id,))
    used = {image for r in con.execute('SELECT payload FROM products') for image in json.loads(r['payload'])['images']}
    files = []
    for image_id in candidates - used:
        row = con.execute('SELECT filename FROM images WHERE id=?', (image_id,)).fetchone()
        if row:
            if not re.fullmatch(r'[a-f0-9]{64}\.(?:png|jpg|gif|webp)', row['filename']):
                raise Problem('图片记录异常，删除未完成。', 409)
            files.extend([(DATA / 'uploads' / row['filename']), (DATA / 'thumbnails' / (image_id + '.webp'))])
            con.execute('DELETE FROM images WHERE id=?', (image_id,))
    return {'deleted': len(expected), 'removed_images': len(files) // 2}, files


def remove_purged_files(files):
    failures = 0
    for file in files:
        try:
            file.unlink(missing_ok=True)
        except OSError:
            failures += 1
    return failures


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 310000).hex()
    return salt + ':' + digest


class Handler(BaseHTTPRequestHandler):
    server_version = 'ProductCenter'

    def log_message(self, fmt, *args):
        # Never put session cookies, request payloads or upload filenames in logs.
        print(time.strftime('%H:%M:%S'), self.command, self.path.split('?')[0], args[1] if len(args) > 1 else '', flush=True)

    def send(self, body, status=200, mime='application/json; charset=utf-8', filename=None, extra_headers=None):
        if isinstance(body, (dict, list)):
            body = dumps(body).encode()
        if isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Cache-Control', 'private, max-age=604800, immutable' if self.path.startswith(('/media/', '/thumbs/', '/warehouse-media/')) else 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if filename:
            self.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + urllib.parse.quote(filename))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, maximum=MAX_UPLOAD):
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise Problem('请求长度无效。')
        if length <= 0 or length > maximum:
            raise Problem('文件或资料过大，上限为%dMB。' % (maximum // 1024 // 1024), 413)
        return self.rfile.read(length)

    def json_body(self):
        try:
            return json.loads(self.read_body(3 * 1024 * 1024))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise Problem('资料格式无效。')

    def authenticated(self):
        if not AUTH_REQUIRED:
            return True
        cookies = dict(x.strip().split('=', 1) for x in self.headers.get('Cookie', '').split(';') if '=' in x)
        token = cookies.get('product_session', '')
        with db() as con:
            return bool(token and con.execute('SELECT 1 FROM sessions WHERE token_hash=? AND expires>?', (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone())

    def guard(self, mutation=False):
        hostname = urllib.parse.urlsplit('http://' + self.headers.get('Host', '')).hostname
        if hostname not in {'127.0.0.1', 'localhost', '::1', PUBLIC_HOST}:
            raise Problem('访问地址无效。', 403)
        if mutation:
            origin = self.headers.get('Origin')
            if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get('Host'):
                raise Problem('请从当前网页提交。', 403)
            if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                raise Problem('请从当前网页提交。', 403)

    def do_GET(self):
        self.handle_request(False)

    def do_POST(self):
        self.handle_request(True)

    def handle_request(self, mutation):
        try:
            self.guard(mutation)
            path = urllib.parse.urlsplit(self.path).path
            if path == '/api/health':
                return self.send({'ok': True, 'version': VERSION})
            if path == '/api/session':
                authenticated = self.authenticated()
                return self.send({'authenticated': authenticated, 'can_edit': authenticated, 'public_browsing': True, 'local': not AUTH_REQUIRED, 'version': VERSION,
                                  'image_limit_bytes': MAX_IMAGE_BYTES, 'product_image_limit': MAX_PRODUCT_IMAGES})
            if path == '/api/login' and mutation:
                return self.login()
            if path.startswith('/warehouse-media/') and not mutation:
                from warehouse_media import serve
                return serve(self, path)
            if path.startswith(('/api/', '/media/', '/thumbs/')):
                from public_access import public_request
                if not public_request(path, mutation) and not self.authenticated():
                    raise Problem('当前为只读浏览，请登录后再进行管理操作。', 401)
                return self.api(path, mutation)
            if mutation:
                raise Problem('地址不存在。', 404)
            file = STATIC / ('index.html' if path == '/' else path.lstrip('/'))
            if not file.resolve().is_relative_to(STATIC.resolve()) or not file.is_file():
                raise Problem('页面不存在。', 404)
            return self.send(file.read_bytes(), mime=mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
        except Problem as exc:
            self.send({'error': exc.message, **exc.extra}, status=exc.status)
        except (ValueError, KeyError, TypeError, zipfile.BadZipFile, ETParseError) as exc:
            self.send({'error': '文件或资料无法识别，请检查格式。'}, status=400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            print('Request failed:', type(exc).__name__, file=sys.stderr, flush=True)
            self.send({'error': '保存未完成，请稍后重试。原有资料仍保留。'}, status=500)

    def login(self):
        payload = self.json_body()
        addr = self.client_address[0]
        now = time.time()
        attempts = [t for t in LOGIN_ATTEMPTS.get(addr, []) if now - t < 300]
        if len(attempts) >= 10:
            raise Problem('尝试次数过多，请5分钟后重试。', 429)
        with db() as con:
            saved = con.execute("SELECT value FROM settings WHERE key='password'").fetchone()
            entered = payload.get('password', '')
            if not saved or not isinstance(entered, str) or len(entered) > 256 or not hmac.compare_digest(password_hash(entered, saved['value'].split(':')[0]), saved['value']):
                LOGIN_ATTEMPTS[addr] = attempts + [now]
                raise Problem('管理密码不正确。', 401)
            token = secrets.token_urlsafe(36)
            con.execute('DELETE FROM sessions WHERE expires<?', (int(now),))
            con.execute('INSERT INTO sessions VALUES(?,?)', (hashlib.sha256(token.encode()).hexdigest(), int(now) + 7 * 86400))
        LOGIN_ATTEMPTS.pop(addr, None)
        secure = '; Secure' if os.environ.get('PRODUCT_CENTER_PUBLIC_URL', '').startswith('https://') else ''
        return self.send({'ok': True}, extra_headers={'Set-Cookie': 'product_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800' + secure})

    def selected_products(self, con, payload):
        ids = payload.get('ids')
        if not isinstance(ids, list) or not ids or len(ids) > 10000 or any(not isinstance(i, str) for i in ids):
            raise Problem('请至少选择一个产品。')
        ids = set(ids)
        result = [record(r) for r in con.execute('SELECT * FROM products WHERE archived=0') if r['id'] in ids]
        from printing_costs import project
        from shared_rules import read as read_rules
        project(result, read_rules(con)['config'])
        if len(result) != len(ids):
            raise Problem('部分产品已删除或不存在，请刷新列表。', 409)
        return result

    def api(self, path, mutation):
        if path == '/api/product-anomalies':
            from product_anomalies import read, change
            if mutation:
                raw = self.json_body()
                with LOCK, db() as con:
                    result = change(con, raw, Problem)
            else:
                with db() as con:
                    result = read(con)
            return self.send(result)
        if path == '/api/scenes':
            from product_scenes import read, change
            if mutation:
                raw = self.json_body()
                with LOCK, db() as con:
                    result = change(con, raw, Problem)
            else:
                with db() as con:
                    result = read(con)
            return self.send(result)
        if path == '/api/categories':
            from product_categories import read, change
            if mutation:
                raw = self.json_body()
                with LOCK, db() as con:
                    result = change(con, raw, Problem)
            else:
                with db() as con:
                    result = read(con)
            return self.send(result)
        if path == '/api/warehouse-rules':
            from shared_rules import read, save
            if mutation:
                raw = self.json_body()
                with LOCK, db() as con:
                    result = save(con, raw)
            else:
                with db() as con:
                    result = read(con)
            return self.send(result)
        if path.startswith('/api/warehouse-costs/') and mutation:
            from warehouse_sync import handle_costs
            return self.send(handle_costs(self, path, self.json_body()))
        if path.startswith('/api/warehouse-sync/') and mutation:
            from warehouse_sync import handle_sync
            return self.send(handle_sync(self, path, self.json_body()))
        if path == '/api/product-initials' and mutation:
            from pypinyin import Style, lazy_pinyin
            name = clipped(self.json_body().get('name', ''), '产品名称', 160)
            converted = ''.join(lazy_pinyin(name, style=Style.FIRST_LETTER)).upper()
            return self.send({'initials': re.sub(r'[^A-Z0-9]', '', converted), 'unrecognized': ''.join(c for c in converted if '\u3400' <= c <= '\u9fff')})
        if path == '/api/logout' and mutation:
            cookies = self.headers.get('Cookie', '')
            match = re.search(r'(?:^|;\s*)product_session=([^;]+)', cookies)
            if match:
                with db() as con:
                    con.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(match[1].encode()).hexdigest(),))
            return self.send({'ok': True}, extra_headers={'Set-Cookie': 'product_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})
        if path == '/api/products' and not mutation:
            with db() as con:
                products = [record(r) for r in con.execute('SELECT * FROM products ORDER BY updated_at DESC,id')]
                images = {r['id']: {'id': r['id'], 'name': r['original'], 'url': '/media/' + r['filename'], 'thumbnail_url': '/thumbs/' + r['id'] + '.webp', 'bytes': r['bytes']} for r in con.execute('SELECT * FROM images')}
            with db() as con:
                synced={r['product_id']:{'revision':r['revision'],'at':r['at']} for r in con.execute('SELECT * FROM warehouse_syncs')}
                sync_states={r['product_id']:dict(r) for r in con.execute('SELECT * FROM warehouse_sync_states')}
                from shared_rules import read
                shared = read(con)
                from printing_costs import project
                project(products, shared['config'])
                from product_categories import read as read_categories
                categories = read_categories(con)
                from product_scenes import read as read_scenes
                scenes = read_scenes(con)
                from product_anomalies import read as read_anomaly_settings
                anomalies = read_anomaly_settings(con)
            return self.send({'products': products, 'images': images, 'warehouse_syncs': synced, 'warehouse_sync_states':sync_states, 'warehouse_rules': shared, 'category_catalog': categories, 'scene_catalog':scenes, 'anomaly_settings':anomalies})
        if path == '/api/products' and mutation:
            raw = self.json_body()
            with LOCK, db() as con:
                from product_requirements import require_complete
                require_complete(raw, con, validate, Problem)
                result = save_product(con, raw)
            return self.send({'product': result}, status=201)
        if path == '/api/trash/empty' and mutation:
            raw = self.json_body()
            if raw.get('confirm') is not True:
                raise Problem('请先确认清空回收站。')
            with LOCK:
                with db() as con:
                    result, files = purge_trash(con, raw.get('items'), empty=True)
                result['file_cleanup_errors'] = remove_purged_files(files)
            return self.send(result)
        match = re.fullmatch(r'/api/products/([a-f0-9]{32})(/archive|/trash|/restore|/purge)?', path)
        if match and mutation:
            raw = self.json_body()
            if match[2] == '/purge':
                if raw.get('confirm') is not True:
                    raise Problem('请先确认彻底删除。')
                with LOCK:
                    with db() as con:
                        result, files = purge_trash(con, [{'id': match[1], 'revision': raw.get('revision')}])
                    result['file_cleanup_errors'] = remove_purged_files(files)
                return self.send(result)
            with LOCK, db() as con:
                if match[2]:
                    row = con.execute('SELECT * FROM products WHERE id=?', (match[1],)).fetchone()
                    if not row: raise Problem('产品不存在。', 404)
                    if raw.get('revision') != row['revision']: raise Problem('资料已更新，请刷新后再操作。', 409)
                    archived = raw.get('archived') if match[2] == '/archive' else match[2] == '/trash'
                    if not isinstance(archived, bool): raise Problem('删除状态无效。')
                    con.execute('UPDATE products SET archived=?,revision=revision+1,updated_at=? WHERE id=?', (int(archived), int(time.time() * 1000), match[1]))
                    con.execute('INSERT INTO events(product_id,action,revision,at) VALUES(?,?,?,?)', (match[1], 'trash' if archived else 'restore', row['revision'] + 1, int(time.time() * 1000)))
                    result = record(con.execute('SELECT * FROM products WHERE id=?', (match[1],)).fetchone())
                else:
                    from product_requirements import require_complete
                    require_complete(raw, con, validate, Problem)
                    result = save_product(con, raw, match[1])
            return self.send({'product': result})
        if path == '/api/images' and mutation:
            data = self.read_body(MAX_INPUT_BYTES)
            try:
                with IMAGE_PROCESSING:
                    image = compress_image(data)
            except ValueError as error:
                raise Problem(str(error))
            original = urllib.parse.unquote(self.headers.get('X-File-Name', '产品图片'))[:200]
            with LOCK, db() as con:
                result = persist_image(con, image, original)
            return self.send({'image': result}, status=201)
        thumb = re.fullmatch(r'/thumbs/([a-f0-9]{64})\.webp', path)
        if thumb and not mutation:
            with db() as con:
                row = con.execute('SELECT * FROM images WHERE id=?', (thumb[1],)).fetchone()
            if not row:
                raise Problem('图片不存在。', 404)
            target = DATA / 'thumbnails' / (thumb[1] + '.webp')
            if not target.is_file():
                original = DATA / 'uploads' / row['filename']
                if not original.is_file():
                    raise Problem('图片不存在。', 404)
                target = ensure_thumbnail(thumb[1], original.read_bytes())
            return self.send(target.read_bytes(), mime='image/webp')
        match = re.fullmatch(r'/media/([a-f0-9]{64}\.(?:png|jpg|gif|webp))', path)
        if match and not mutation:
            with db() as con:
                row = con.execute('SELECT * FROM images WHERE filename=?', (match[1],)).fetchone()
            if not row or not (DATA / 'uploads' / match[1]).is_file(): raise Problem('图片不存在。', 404)
            return self.send((DATA / 'uploads' / match[1]).read_bytes(), mime=row['mime'])
        if path == '/api/import/preview' and mutation:
            from cost_catalog import MAX_IMPORT_BYTES
            content = self.read_body(MAX_IMPORT_BYTES)
            filename = urllib.parse.unquote(self.headers.get('X-File-Name', '产品表.xlsx'))
            if self.headers.get('X-Import-Mode') == 'upsert':
                import metadata_import
                try:
                    parsed = metadata_import.parse(content, filename)
                    if filename.lower().endswith('.xlsx'):
                        parsed = attach_workbook_images(parsed, content)
                    with db() as con:
                        prepared = metadata_import.plan(con, parsed)
                except ValueError as exc:
                    raise Problem(str(exc))
                token = secrets.token_urlsafe(24)
                with LOCK:
                    for key in list(PREVIEWS):
                        if time.time()-PREVIEWS[key]['at']>1200: del PREVIEWS[key]
                    if len(PREVIEWS)>=5: raise Problem('待导入文件过多，请先完成或稍后重试。',429)
                    PREVIEWS[token]={'parsed':parsed,'bytes':content,'at':time.time(),'basis':prepared['basis']}
                return self.send({'token':token,'bulk':True,'products':len(prepared['targets']),
                    'variants':parsed['variants'],'images':len({i for p in parsed['products'] for i in p['images']}),
                    'sheets':parsed['sheets'],'already_imported':False,'names':[t['raw']['name'] for t in prepared['targets']][:12],**prepared['summary']})
            try:
                parsed = parse_catalog(content, filename)
            except ValueError as exc:
                raise Problem(str(exc))
            if filename.lower().endswith('.xlsx'):
                parsed = attach_workbook_images(parsed, content)
            token = secrets.token_urlsafe(24)
            with LOCK:
                for key in list(PREVIEWS):
                    if time.time() - PREVIEWS[key]['at'] > 1200: del PREVIEWS[key]
                if len(PREVIEWS) >= 5: raise Problem('待导入文件过多，请完成或稍后重试。', 429)
                PREVIEWS[token] = {'parsed': parsed, 'bytes': content, 'at': time.time()}
            with db() as con:
                prior = con.execute('SELECT 1 FROM imports WHERE fingerprint=?', (parsed['fingerprint'],)).fetchone()
            return self.send({'token': token, 'cost_table':bool(parsed.get('cost_table')), 'products': len(parsed['products']), 'variants': parsed['variants'],
                              'images': len({i for p in parsed['products'] for i in p['images']}),
                              'sheets': parsed['sheets'], 'issues': parsed['issues'], 'already_imported': bool(prior), 'names': [p['name'] for p in parsed['products']][:12]})
        if path == '/api/import/commit' and mutation:
            token = self.json_body().get('token')
            with LOCK:
                pending = PREVIEWS.get(token)
                if not pending or time.time() - pending['at'] > 1200: raise Problem('导入预览已过期，请重新选择文件。', 409)
                if pending['parsed'].get('bulk'):
                    import metadata_import
                    with db() as con:
                        result=metadata_import.commit(con,pending['parsed'],pending['basis'])
                        con.execute('INSERT OR REPLACE INTO imports VALUES(?,?,?,?)',(pending['parsed']['fingerprint'],pending['parsed']['filename'],dumps(result),int(time.time())))
                else:
                    result = commit_import(pending['parsed'], pending['bytes'])
                PREVIEWS.pop(token, None)
            return self.send(result)
        if path == '/api/export/warehouse' and mutation:
            payload = self.json_body()
            with db() as con:
                products = self.selected_products(con, payload)
            rows, issues = warehouse_rows(products)
            if issues:
                raise Problem('部分规格尚未配置完整，请补齐后导出。', 409, issues=issues[:200], total_issues=len(issues), valid_rows=len(rows))
            if not rows: raise Problem('没有可导出的常规SKU；工单定制走独立流程，不参与ERP/普通建档导出。')
            return self.send(csv_bytes(WAREHOUSE_HEADERS, rows), mime='text/csv; charset=utf-8', filename='新品仓库建档_' + china_stamp('%Y%m%d') + '.csv')
        if path == '/api/export/website' and mutation:
            payload = self.json_body()
            with db() as con:
                products = self.selected_products(con, payload)
                images = {r['id']: dict(r) for r in con.execute('SELECT * FROM images')}
            output = io.BytesIO()
            headers = ['产品编号', '产品名称', '产品类型', '使用场景', '标签', '产品介绍', '材质', '工艺', 'SKU编码', '规格名称', '尺寸', '包装含量', '数量单位', '售价', '封面路径', '全部图片路径']
            rows, included = [], set()
            for p in products:
                paths = ['images/' + images[i]['filename'] for i in p['images'] if i in images]
                included.update(i for i in p['images'] if i in images)
                for v in p['variants'] or [{}]:
                    variant_paths = ['images/' + images[i]['filename'] for i in v.get('image_ids', []) if i in images]
                    cover = variant_paths[0] if variant_paths else paths[0] if paths else ''
                    rows.append([p['id'], p['name'], p['category'], p['scene'], '、'.join(p['tags']), p['description'], v.get('material') or p['material'], p['process'], v.get('sku'), v.get('name'), v.get('size'), v.get('pack_qty'), v.get('pack_unit'), v.get('price'), cover, '|'.join(variant_paths or paths)])
            with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('products.csv', csv_bytes(headers, rows))
                for image_id in included:
                    row = images[image_id]
                    archive.write(DATA / 'uploads' / row['filename'], 'images/' + row['filename'])
                archive.writestr('导入说明.txt', '这是通用网站商品资料包，每行一个销售规格。图片路径相对于本压缩包。\n不包含内部成本、运费、负责人和供应资料。\n目标网站如有专用导入格式，需要按该网站模板映射字段并上传图片。\n产品状态未用于自动上架；导入到目标网站后请核对发布状态。\n')
            return self.send(output.getvalue(), mime='application/zip', filename='网站产品资料_' + china_stamp('%Y%m%d') + '.zip')
        if path == '/api/backup' and mutation:
            output = io.BytesIO()
            with LOCK, tempfile.TemporaryDirectory() as temporary:
                target = Path(temporary) / 'products.sqlite3'
                with db() as source, closing(sqlite3.connect(target)) as dest:
                    source.backup(dest)
                    dest.execute('DELETE FROM sessions')
                    dest.commit()
                with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
                    archive.write(target, 'products.sqlite3')
                    for folder in ('uploads', 'imports', 'thumbnails'):
                        for file in (DATA / folder).iterdir():
                            if file.is_file() and file.suffix != '.tmp': archive.write(file, folder + '/' + file.name)
                    archive.writestr('恢复说明.txt', '完整备份包含产品资料、压缩后的图片、导入记录及管理密码摘要，不包含登录会话。Excel原表请另外保管。\n先停止产品中心服务，再将本压缩包内容恢复至数据目录，保留原备份。\n重启后继续使用原管理密码。备份包含内部成本，请妥善保存。\n')
            return self.send(output.getvalue(), mime='application/zip', filename='产品中心完整备份_' + china_stamp('%Y%m%d_%H%M') + '.zip')
        raise Problem('地址不存在。', 404)


# Kept explicit so malformed XML is a client error, not a server traceback.
from xml.etree.ElementTree import ParseError as ETParseError


def main():
    global AUTH_REQUIRED, PUBLIC_HOST
    parser = argparse.ArgumentParser(description='产品中心')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8002)
    parser.add_argument('--import-file')
    parser.add_argument('--set-password', action='store_true')
    args = parser.parse_args()
    initialize()
    if args.set_password:
        password = getpass.getpass('设置管理密码（至少8位）：')
        if len(password) < 8 or len(password) > 256:
            raise SystemExit('密码长度需要8至256位。')
        if password != getpass.getpass('再次输入：'):
            raise SystemExit('两次密码不一致。')
        with db() as con:
            con.execute("INSERT OR REPLACE INTO settings VALUES('password',?)", (password_hash(password),))
            con.execute('DELETE FROM sessions')
        print('管理密码已设置。')
        return
    if args.import_file:
        path = Path(args.import_file)
        content = path.read_bytes()
        if len(content) > MAX_UPLOAD: raise SystemExit('导入文件超过20MB。')
        print(dumps(commit_import(parse_catalog(content, path.name), content)))
        return
    AUTH_REQUIRED = args.host not in ('127.0.0.1', 'localhost', '::1') or os.environ.get('PRODUCT_CENTER_REQUIRE_AUTH') == '1'
    PUBLIC_HOST = urllib.parse.urlsplit(os.environ.get('PRODUCT_CENTER_PUBLIC_URL', '')).hostname or ''
    with db() as con:
        if AUTH_REQUIRED and not con.execute("SELECT 1 FROM settings WHERE key='password'").fetchone():
            raise SystemExit('对外开放前请先运行 python app.py --set-password 设置管理密码。')
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print('产品中心已启动：http://127.0.0.1:%d' % args.port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
