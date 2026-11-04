"""Build product-owned stock metadata; never accept or produce stock balances."""
import json
import re

MODES = ('独立库存', '共用库存', '待关联', '仅统计销售')
PRINT = ('打印定制', '定制订单')


def short_hash(text):
    value = 2166136261
    for char in text:
        value = ((value ^ ord(char)) * 16777619) & 0xffffffff
    return '%08X' % value


def apply(product, raw):
    if 'inventory_defaults' not in raw:
        return product
    defaults = raw['inventory_defaults']
    if not isinstance(defaults, dict) or set(defaults) - {'mode', 'auto_link'} or defaults.get('mode') not in MODES or type(defaults.get('auto_link')) is not bool:
        raise ValueError('库存默认设置无效。')
    previous = raw.get('inventory_auto') or {}
    if not isinstance(previous, dict):
        raise ValueError('自动实物关联记录无效。')
    groups, prior_links = previous.get('groups', {}), previous.get('links', {})
    for mapping in (groups, prior_links):
        if not isinstance(mapping, dict) or len(mapping) > 2000 or any(not isinstance(k, str) or len(k) > 1000 or not isinstance(v, str) or not v or len(v) > 160 for k, v in mapping.items()):
            raise ValueError('自动实物关联记录无效。')
    manual_codes = previous.get('manual', [])
    if not isinstance(manual_codes, list) or len(manual_codes) > 1000 or any(not isinstance(s, str) or len(s) > 160 for s in manual_codes):
        raise ValueError('手动实物关联记录无效。')
    manual_codes = set(manual_codes)
    groups, managed = dict(groups), {}
    cfg = product['warehouse_config']
    cfg['links'] = [r for r in cfg['links'] if prior_links.get(r['sku']) != r['stock_code']]
    stocks = {r['code']: r for r in cfg['stocks']}
    used_codes = set(groups.values()) | set(stocks)
    for row in product['variants']:
        row['inventory_mode'] = row.get('inventory_mode') or defaults['mode']
        mode = row['inventory_mode']
        if mode != '共用库存':
            row['stock_code'] = ''
            manual_codes.discard(row['sku'])
        if row.get('supply_mode') in PRINT:
            if row['sku'] in prior_links:
                managed[row['sku']] = prior_links[row['sku']]
            continue
        if row.get('supply_mode') == '现货优先（按条件）':
            if row.get('stock_code') == prior_links.get(row['sku']):
                row['stock_code'] = ''
            continue
        if mode == '独立库存':
            row['cost_mode'] = '固定整份成本'
        if mode != '共用库存' or not defaults['auto_link'] or not row['sku'] or not row.get('pack_qty') or not row.get('pack_unit'):
            continue
        sku = row['sku']
        if not row.get('stock_code'):
            manual_codes.discard(sku)
        manual = row.get('stock_code') and (row['stock_code'] != prior_links.get(sku) or sku in manual_codes)
        if manual:
            manual_codes.add(sku)
            code = row['stock_code']
        else:
            base = re.sub(r'[-_]' + str(row['pack_qty']) + r'$', '', sku)
            size = re.sub(r'\s+', '', row.get('size', '')).replace('×', 'x').replace('*', 'x').lower()
            material = row.get('material') or product.get('material', '')
            signature = json.dumps([base, size, material, row['pack_unit']], ensure_ascii=False, separators=(',', ':'))
            code = groups.get(signature)
            if not code:
                stem = base[:135]
                code = stem + '-STOCK'
                if code in used_codes:
                    code = stem + '-' + short_hash(signature) + '-STOCK'
                groups[signature] = code
                used_codes.add(code)
            if code not in stocks:
                design = row.get('batch_key', '').split(':')[0]
                name = product['name'] + ('-' + design + '款' if design and product.get('batch_config', {}).get('count', 1) > 1 else '')
                stocks[code] = {'code': code, 'name': name, 'size': row.get('size', ''), 'unit': row['pack_unit'], 'kind': '普通实物', 'cost': None, 'pricing_mode': '直接填单价', 'note': '产品中心自动建立；实际数量由仓库盘点。'}
            else:
                design = row.get('batch_key', '').split(':')[0]
                stocks[code]['name'] = product['name'] + ('-' + design + '款' if design and product.get('batch_config', {}).get('count', 1) > 1 else '')
            row['stock_code'] = code
        managed[sku] = code
        cfg['links'] = [r for r in cfg['links'] if r['sku'] != sku]
        cfg['links'].append({'sku': sku, 'stock_code': code, 'mode': '固定数量', 'quantity': row['pack_qty'], 'note': '按每份包装含量自动关联'})
    cfg['stocks'] = list(stocks.values())
    # Remove dormant links for modes that never consume stock.
    without_stock = {v['sku'] for v in product['variants'] if v.get('supply_mode') in PRINT or v['inventory_mode'] in ('独立库存', '仅统计销售')}
    cfg['links'] = [r for r in cfg['links'] if r['sku'] not in without_stock]
    product['inventory_defaults'] = dict(defaults)
    if not raw.get('id'):
        active = {r['stock_code'] for r in cfg['links']}
        automatic = set(groups.values())
        cfg['stocks'] = [s for s in cfg['stocks'] if s['code'] not in automatic or s['code'] in active]
    product['inventory_auto'] = {'groups': groups, 'links': managed, 'manual': sorted(manual_codes & {v['sku'] for v in product['variants']})}
    return product
