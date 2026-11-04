"""Read the final stock/printing cost tables and upsert their SKU metadata."""
import copy
import hashlib
import io
import posixpath
import xml.etree.ElementTree as E
import zipfile
from decimal import Decimal, InvalidOperation

MAX_IMPORT_BYTES = 400 * 1024 * 1024
S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def parse_cost_catalog(data, filename):
    from workbook_catalog import read_sheet, relationships, infer_category, col_number
    from warehouse_config import normalize_supply
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        entries = z.infolist()
        if len(entries) > 20000 or sum(x.file_size for x in entries) > 600 * 1024 * 1024:
            raise ValueError('表格内容过大，请拆分后导入。')
        if sum(x.file_size for x in entries if x.filename.endswith(('.xml', '.rels'))) > 64 * 1024 * 1024:
            raise ValueError('表格文本内容过大，请拆分后导入。')
        strings = [''.join(t.text or '' for t in si.iter('{' + S + '}t')) for si in E.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
        refs = relationships(z, 'xl/workbook.xml')
        sheets = list(E.fromstring(z.read('xl/workbook.xml')).find('{' + S + '}sheets'))
        groups, seen, image_paths, issues = {}, set(), set(), []
        recognized = False
        for sheet in sheets:
            ref = refs.get(sheet.get('{' + R + '}id'))
            if not ref:
                continue
            tree = E.fromstring(z.read(ref['path']))
            # Check labels before traversing drawings on unrelated legacy workbooks.
            labels = {}
            header_row = None
            for row in tree.findall('{' + S + '}sheetData/{' + S + '}row')[:12]:
                cells = {}
                for c in row.findall('{' + S + '}c'):
                    v = c.find('{' + S + '}v')
                    value = v.text if v is not None else ''
                    if c.get('t') == 's' and value:
                        value = strings[int(value)]
                    elif c.get('t') == 'inlineStr':
                        value = ''.join(t.text or '' for t in c.iter('{' + S + '}t'))
                    if value:
                        import re
                        cells[str(value).strip()] = col_number(re.sub(r'\d', '', c.get('r')))
                if {'产品分组', '规格名称', 'SKU编码', '制作方式'} <= set(cells) and any('单位成本' in k or '整份成本' in k for k in cells):
                    labels, header_row = cells, int(row.get('r'))
                    break
            if header_row is None:
                continue
            recognized = True
            rows, pictures = read_sheet(z, ref['path'], strings)
            hidden = {int(row.get('r')) for row in tree.findall('{' + S + '}sheetData/{' + S + '}row') if row.get('hidden') in ('1', 'true')}
            def money(value, label):
                try:
                    n = Decimal(str(value))
                except (InvalidOperation, ValueError):
                    raise ValueError(label + '须填写非负数字。')
                if not n.is_finite() or n < 0 or n > 100000000:
                    raise ValueError(label + '数值无效。')
                return n
            for index, cells in sorted(rows.items()):
                if index <= header_row or index in hidden:
                    continue
                def get(*keys):
                    return next((str(cells.get(labels.get(k), '')).strip() for k in keys if cells.get(labels.get(k), '') not in ('', None)), '')
                sku = get('SKU编码')
                if not sku:
                    continue
                if sku in seen:
                    raise ValueError('同一文件内SKU重复，请先核对：' + sku)
                seen.add(sku)
                group, name = get('产品分组'), get('规格名称')
                if not group or not name:
                    raise ValueError('请填写产品分组和规格名称：' + sku)
                q = money(get('每份数量'), '每份数量')
                if q < 1 or q != int(q) or q > 100000:
                    raise ValueError('每份数量须为1至100000的整数：' + sku)
                unit = get('单位', '数量单位')
                if unit not in ('贴', '张', '枚', '个', '件', '包', '卷', '套', '份'):
                    raise ValueError('数量单位无效：' + sku)
                unit_value = get('单位成本（元/贴或张）', '单位成本（元）', '每贴价格')
                pack_value = get('整份成本（元/份）', '整份成本（元）')
                if not unit_value and not pack_value:
                    raise ValueError('单位成本和整份成本至少填写一项：' + sku)
                cost = money(pack_value, '整份成本') if pack_value else money(unit_value, '单位成本') * q
                if unit_value and pack_value and abs(money(unit_value, '单位成本') * q - cost) > Decimal('.000001'):
                    raise ValueError('单位成本×每份数量与整份成本不一致，请在Excel重新计算保存：' + sku)
                supply = normalize_supply(get('制作方式'))
                if supply not in ('现货', '打印定制', '定制订单', '现货优先（按条件）'):
                    raise ValueError('制作方式无效：' + sku)
                photo_refs = list(dict.fromkeys(p['path'] for p in pictures if p['row'] is not None and p['row'] <= index <= p['last_row'] and p['col'] == 0))
                image_paths.update(photo_refs)
                variant = {'sku': sku, 'erp_code': get('ERP编码') or sku, 'name': name,
                           'size': get('尺寸（cm）', '尺寸', '规格'), 'pack_qty': int(q), 'pack_unit': unit,
                           'material': get('材质'), 'unit_cost': float(money(unit_value, '单位成本')) if unit_value else None, 'cost': float(round(cost, 8)), 'cost_mode': '固定整份成本',
                           'price': None, 'shipping': None, 'supply_mode': supply, 'inventory_mode': '待关联', 'stock_code': '',
                           'note': get('说明', '备注')[:1000], 'source_sheet': sheet.get('name'), 'source_row': index,
                           'image_refs': photo_refs, 'image_ids': [], 'source_fields': {'覆膜': get('覆膜'), '单位成本': unit_value, '成本单位': '元/' + unit}}
                if supply == '打印定制':
                    per = money(get('每张可拼数量'), '每张可拼数量')
                    if per < 1 or per != int(per) or per > 100000:
                        raise ValueError('每张可拼数量须为正整数：' + sku)
                    cut = get('切割方式') or '普通模切'
                    cuts = {'普通模切': 'die', '平板切割': 'flat', '平板及模切': 'both', '不切割': 'none'}
                    if cut not in cuts:
                        raise ValueError('切割方式无效：' + sku)
                    film = get('覆膜')
                    if film not in ('不覆膜', '光膜', '亮膜', '哑膜', '覆亮膜', '覆哑膜'):
                        raise ValueError('覆膜方式无效：' + sku)
                    variant.update(print_pricing='material', print_per_sheet=int(per), print_laminated=film != '不覆膜', print_cutting=cuts[cut])
                if group not in groups:
                    groups[group] = {'name': group, 'category': get('产品类型') or infer_category(group), 'scene': '', 'tags': [],
                                     'material': '', 'process': '', 'description': '', 'owner': '', 'status': 'published',
                                     'variants': [], 'images': [], 'image_refs': [], 'source': filename + ' / ' + group,
                                     'inventory_defaults': {'mode': '待关联', 'auto_link': False}, 'warehouse_config': {}}
                product = groups[group]
                product['variants'].append(variant)
                product['image_refs'] = list(dict.fromkeys(product['image_refs'] + photo_refs))
        if not recognized:
            return None
        if not groups:
            raise ValueError('成本表中没有可导入的SKU。')
        for product in groups.values():
            materials = {v['material'] for v in product['variants']}
            product['material'] = next(iter(materials)) if len(materials) == 1 else ''
        return {'cost_table': True, 'products': list(groups.values()), 'issues': issues, 'image_paths': sorted(image_paths),
                'fingerprint': hashlib.sha256(data).hexdigest(), 'filename': filename, 'sheets': len(sheets), 'variants': len(seen)}


def commit_cost_catalog(parsed, source_bytes):
    from app import LOCK, db, record, save_product, dumps, Problem, DATA
    import time
    with LOCK, db() as con:
        prior = con.execute('SELECT result FROM imports WHERE fingerprint=?', (parsed['fingerprint'],)).fetchone()
        if prior:
            import json
            return {**json.loads(prior['result']), 'already_imported': True}
        products = [record(r) for r in con.execute('SELECT * FROM products')]
        by_id = {p['id']: p for p in products}
        owners = {r['sku']: r['product_id'] for r in con.execute('SELECT * FROM skus')}
        count_new = count_update = 0
        touched = []
        for incoming in parsed['products']:
            ids = {owners[v['sku']] for v in incoming['variants'] if v['sku'] in owners}
            if len(ids) > 1:
                raise Problem('同一产品分组的SKU属于不同产品，请先核对：' + incoming['name'], 409)
            pid = next(iter(ids)) if ids else None
            if pid is None:
                named = [p for p in products if p['name'] == incoming['name'] and not p['archived']]
                if len(named) > 1:
                    raise Problem('产品分组有多个同名产品，请先核对：' + incoming['name'], 409)
                pid = named[0]['id'] if named else None
            raw = copy.deepcopy(by_id[pid]) if pid else copy.deepcopy(incoming)
            if pid and raw['archived']:
                raise Problem('SKU在回收站中，请先恢复产品。', 409)
            if pid:
                old_variants = {v['sku']: v for v in raw['variants']}
                raw['name'] = incoming['name']
                raw['status'] = 'published'
                for v in incoming['variants']:
                    if v['sku'] in old_variants:
                        before = old_variants[v['sku']]
                        # Cost tables do not own selling prices, historical sources,
                        # or warehouse stock associations.
                        keys = ['erp_code', 'name', 'size', 'pack_qty', 'pack_unit', 'material', 'cost', 'unit_cost', 'cost_mode',
                                'supply_mode', 'print_pricing', 'print_per_sheet', 'print_laminated', 'print_cutting', 'note']
                        before.update({k: v[k] for k in keys if k in v})
                        if v.get('image_ids'):
                            before['image_ids'] = v['image_ids']
                        before['source_fields'] = {**before.get('source_fields', {}), **v.get('source_fields', {})}
                        count_update += 1
                    else:
                        raw['variants'].append(v)
                        count_new += 1
                raw['images'] = list(dict.fromkeys(raw.get('images', []) + incoming.get('images', [])))
            else:
                count_new += len(raw['variants'])
            touched.append(save_product(con, raw, pid))
        result = {'products': len(touched), 'variants': parsed['variants'], 'images': len({i for p in touched for i in p['images']}),
                  'issues': parsed['issues'], 'already_imported': False, 'new_skus': count_new, 'updated_skus': count_update}
        con.execute('INSERT INTO imports VALUES(?,?,?,?)', (parsed['fingerprint'], parsed['filename'], dumps(result), int(time.time())))
        (DATA / 'imports' / (parsed['fingerprint'] + '.json')).write_text(dumps({'filename': parsed['filename'], 'result': result, 'products': touched}), encoding='utf-8')
        return result
