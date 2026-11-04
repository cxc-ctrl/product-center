"""Reusable warehouse masters; legacy product-owned rows remain intact."""
import hashlib
import json
from warehouse_config import config, FIELDS

KEY = 'warehouse_rules'


def identity(key, row):
    return json.dumps([row['sku'], row['stock_code']] if key == 'links' else [row['code'], row['color'], row['size']] if key == 'digit_conditions' else [row['code']], ensure_ascii=False, separators=(',', ':'))


def stored(con):
    row = con.execute('SELECT value FROM settings WHERE key=?', (KEY,)).fetchone()
    return json.loads(row['value']) if row else {'revision': 0, 'config': {}, 'removed': {}}


def read(con):
    saved = stored(con)
    overrides = {key: {identity(key, r): r for r in rows} for key, rows in config(saved['config']).items()}
    pool = {key: {} for key in FIELDS}
    conflicts = set()
    for record in con.execute('SELECT payload FROM products WHERE archived=0 ORDER BY id'):
        for key, rows in config(json.loads(record['payload']).get('warehouse_config')).items():
            for row in rows:
                ident = identity(key, row)
                if ident in saved.get('removed', {}).get(key, []) or ident in overrides[key]:
                    continue
                if ident in pool[key] and pool[key][ident] != row:
                    conflicts.add('同编码资料存在差异，请在此核对后保存：' + (row.get('code') or row.get('sku')))
                pool[key].setdefault(ident, row)
    for key in FIELDS:
        pool[key].update(overrides[key])
    effective = {key: list(rows.values()) for key, rows in pool.items()}
    basis = hashlib.sha256(json.dumps([saved['revision'], effective, sorted(conflicts)], ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()
    return {'revision': saved['revision'], 'basis': basis, 'config': effective, 'issues': sorted(conflicts)}


def save(con, raw):
    from app import Problem, dumps
    before = read(con)
    if raw.get('basis') != before['basis'] or raw.get('revision') != before['revision']:
        raise Problem('规则或产品资料已更新，请重新载入后再保存。当前输入仍保留。', 409)
    try:
        clean = config(raw.get('config'))
    except ValueError as exc:
        raise Problem(str(exc)) from exc
    if not isinstance(raw.get('config'), dict) or set(raw['config']) != set(FIELDS):
        raise Problem('请提交完整的仓储打印规则。')
    present = {key: {identity(key, r) for r in rows} for key, rows in clean.items()}
    removed = {key: set(stored(con).get('removed', {}).get(key, [])) | {identity(key, r) for r in before['config'][key]} - present[key] for key in FIELDS}
    codes = {key: {r['code'] for r in clean[key]} for key in ['stocks', 'print_rules', 'digit_conditions']}
    removed_codes = {key: {r['code'] for r in before['config'][key]} - codes[key] for key in codes}
    for link in clean['links']:
        if link['stock_code'] not in codes['stocks']:
            raise Problem('库存关联的实物未建立：' + link['stock_code'])
    variants = [v for row in con.execute('SELECT payload FROM products WHERE archived=0') for v in json.loads(row['payload'])['variants']]
    for variant in variants:
        for field, key in [('print_rule_code', 'print_rules'), ('digit_condition_code', 'digit_conditions')]:
            if variant.get(field) in removed_codes[key]:
                raise Problem('规则仍被SKU引用，请先修改商品选择：' + variant['sku'])
    for row in clean['digit_conditions']:
        if row.get('print_rule_code') in removed_codes['print_rules']:
            raise Problem('打印规则仍被数字贴条件引用：' + row['code'])
    payload = {'revision': before['revision'] + 1, 'config': clean, 'removed': {key: sorted(values - present[key]) for key, values in removed.items()}}
    con.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (KEY, dumps(payload)))
    return read(con)
