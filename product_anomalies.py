"""Persistent SKU review preferences, separate from product pricing and stock."""
import json
import math
import time

KEY = 'product_anomaly_preferences'
EXTRA_COST = 2.8


def read(con):
    row = con.execute('SELECT value FROM settings WHERE key=?', (KEY,)).fetchone()
    saved = json.loads(row['value']) if row else {}
    return {'revision': saved.get('revision', 0), 'extra_cost': EXTRA_COST,
            'low_margin_percent': saved.get('low_margin_percent', 20),
            'low_profit_amount': saved.get('low_profit_amount', 2),
            'ignored': saved.get('ignored', [])}


def change(con, raw, Problem):
    current = read(con)
    if type(raw.get('revision')) is not int or raw['revision'] != current['revision']:
        raise Problem('异常设置已在其他窗口更新，请重试。', 409)
    action = raw.get('action')
    if action == 'settings':
        value = raw.get('low_margin_percent')
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 100 or round(value, 2) != value:
            raise Problem('低利润率阈值须为0至100之间的数字，最多两位小数。')
        current['low_margin_percent'] = value
        amount = raw.get('low_profit_amount')
        if type(amount) not in (int, float) or not math.isfinite(amount) or not 0 <= amount <= 100000000 or round(amount, 2) != amount:
            raise Problem('低利润金额须为0至100000000之间的数字，最多两位小数。')
        current['low_profit_amount'] = amount
    elif action in ('ignore', 'restore'):
        pid, sku = raw.get('product_id'), raw.get('sku')
        if not isinstance(pid, str) or not isinstance(sku, str) or len(pid) > 100 or len(sku) > 300:
            raise Problem('产品或SKU无效。')
        key = (pid, sku)
        if action == 'ignore':
            row = con.execute('SELECT payload FROM products WHERE id=? AND archived=0', (pid,)).fetchone()
            if not row or not any(v.get('sku') == sku for v in json.loads(row['payload']).get('variants', [])):
                raise Problem('产品已删除或SKU已更新，请刷新后重试。', 409)
            if not any((item['product_id'], item['sku']) == key for item in current['ignored']):
                current['ignored'].append({'product_id': pid, 'sku': sku, 'at': int(time.time()*1000)})
        else:
            current['ignored'] = [item for item in current['ignored'] if (item['product_id'], item['sku']) != key]
    else:
        raise Problem('不支持的异常管理操作。')
    current['revision'] += 1
    con.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                (KEY, json.dumps(current, ensure_ascii=False, separators=(',', ':'), allow_nan=False)))
    return current
