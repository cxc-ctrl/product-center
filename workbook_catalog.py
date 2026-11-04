"""Read Excel text and anchored pictures, including parallel product tables."""
import hashlib
import io
from pathlib import Path
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile

from catalog_import import number, quantity, text

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'xdr': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
CODE = ('sku编码', '商家编码', 'erp编码', '编码', '货号')
NAMES = ('规格名称', '简称', '面单信息', '产品名称', '品名', '名称')
PICTURES = ('图片', '产品图片', '产品图', '主图', '效果图', '实物图')


def normalized(value):
    return re.sub(r'\s+', '', text(value)).lower().replace('：', '')


def col_number(value):
    result = 0
    for char in value:
        result = result * 26 + ord(char) - 64
    return result - 1


def col_name(value):
    result = ''
    value += 1
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(65 + remainder) + result
    return result


def resolve(source, target):
    path = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.dirname(source) + '/' + target)
    if not path.startswith('xl/') or '/../' in path:
        raise ValueError('表格中的附件路径无效。')
    return path


def relationships(package, source):
    path = posixpath.dirname(source) + '/_rels/' + posixpath.basename(source) + '.rels'
    if path not in package.namelist():
        return {}
    return {r.get('Id'): {'path': resolve(source, r.get('Target', '')), 'type': r.get('Type', '')}
            for r in ET.fromstring(package.read(path)) if r.get('TargetMode') != 'External'}


def read_sheet(package, path, strings):
    root = ET.fromstring(package.read(path))
    rows = {}
    for element in root.findall('s:sheetData/s:row', NS):
        row = {}
        for cell in element.findall('s:c', NS):
            column = col_number(re.sub(r'\d', '', cell.get('r', 'A1')))
            value = cell.find('s:v', NS)
            if cell.get('t') == 's' and value is not None:
                result = strings[int(value.text)]
            elif cell.get('t') == 'inlineStr':
                result = ''.join(t.text or '' for t in cell.iter('{' + NS['s'] + '}t'))
            else:
                result = value.text if value is not None else ''
            if text(result):
                row[column] = text(result)
        if row:
            rows[int(element.get('r'))] = row
    merges = []
    for item in root.findall('s:mergeCells/s:mergeCell', NS):
        match = re.fullmatch(r'([A-Z]+)(\d+):([A-Z]+)(\d+)', item.get('ref', ''))
        if not match:
            continue
        first_col, first_row, last_col, last_row = col_number(match[1]), int(match[2]), col_number(match[3]), int(match[4])
        merges.append((first_col, first_row, last_col, last_row))
        if first_col == last_col and last_row - first_row <= 50000:
            source = rows.get(first_row, {}).get(first_col)
            if source:
                for row_number in range(first_row + 1, last_row + 1):
                    if row_number in rows:
                        rows[row_number].setdefault(first_col, source)
    pictures = []
    for reference in relationships(package, path).values():
        if not reference['type'].endswith('/drawing'):
            continue
        drawing = reference['path']
        refs = relationships(package, drawing)
        for anchor in ET.fromstring(package.read(drawing)):
            start = anchor.find('xdr:from', NS)
            row = int(start.find('xdr:row', NS).text) + 1 if start is not None else None
            col = int(start.find('xdr:col', NS).text) if start is not None else None
            for blip in anchor.findall('.//a:blip', NS):
                image = refs.get(blip.get('{' + NS['r'] + '}embed'))
                if not image or not image['type'].endswith('/image'):
                    continue
                last_row = row
                for a, b, c, d in merges:
                    if col is not None and a <= col <= c and b <= row <= d:
                        row, last_row = b, d
                        break
                pictures.append({'path': image['path'], 'row': row, 'last_row': last_row, 'col': col})
    return rows, pictures


def find_blocks(cells, following):
    labels = {c: normalized(v) for c, v in cells.items()}
    codes = sorted(c for c, v in labels.items() if v in CODE)
    names = sorted(c for c, v in labels.items() if v in NAMES)
    inferred = False
    if not codes and names and any(v in PICTURES for v in labels.values()) and not cells.get(0):
        examples = [r.get(0) for r in following[:15] if r.get(0)]
        if len(examples) >= 2 and all(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/\-]{2,}', value) for value in examples):
            labels[0] = '编码'
            codes = [0]
            inferred = True
    if not names or not codes:
        return []
    boundaries = [0]
    for previous, current in zip(names, names[1:]):
        candidates = [c for c in codes if previous < c <= current]
        if candidates:
            boundaries.append(min(candidates))
    boundaries = sorted(set(boundaries))
    boundaries.append(max(cells) + 1)
    result = []
    for first, last in zip(boundaries, boundaries[1:]):
        part = {v: c for c, v in labels.items() if first <= c < last}
        if any(k in part for k in CODE) and any(k in part for k in NAMES):
            result.append({'first': first, 'last': last, 'labels': part, 'inferred_code': inferred})
    return result


def infer_category(name):
    for token, category in (('杯套', '杯套'), ('贺卡', '卡片'), ('卡片', '卡片'), ('保存卡', '卡片'), ('对联', '对联'), ('胸章', '胸章'), ('牙签旗', '牙签旗'), ('礼盒', '包装'), ('小盒子', '包装')):
        if token in name:
            return category
    return '贴纸'


def parse_workbook(data, filename, allow_large=False):
    source = io.BytesIO(data) if isinstance(data, bytes) else Path(data)
    fingerprint = hashlib.sha256(data).hexdigest() if isinstance(data, bytes) else None
    products, issues, seen = [], [], set()
    referenced_images = set()
    with zipfile.ZipFile(source) as package:
        entries = package.infolist()
        text_size = sum(i.file_size for i in entries if i.filename.lower().endswith(('.xml', '.rels')))
        if len(entries) > 25000 or text_size > 64 * 1024 * 1024 or (not allow_large and sum(i.file_size for i in entries) > 160 * 1024 * 1024):
            raise ValueError('表格内容过大，请拆分后导入。')
        strings = [''.join(t.text or '' for t in si.iter('{' + NS['s'] + '}t')) for si in ET.fromstring(package.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in package.namelist() else []
        workbook_path = 'xl/workbook.xml'
        workbook = ET.fromstring(package.read(workbook_path))
        refs = relationships(package, workbook_path)
        sheet_count = 0
        for sheet in workbook.find('s:sheets', NS):
            sheet_count += 1
            name = sheet.get('name', '未命名产品')
            reference = refs.get(sheet.get('{' + NS['r'] + '}id'))
            if not reference:
                issues.append({'sheet': name, 'row': None, 'message': '未找到工作表内容。'})
                continue
            rows, pictures = read_sheet(package, reference['path'], strings)
            ordered = sorted(rows.items())
            active = []
            variants = []
            photo_columns = set()
            for position, (row_number, cells) in enumerate(ordered):
                detected = find_blocks(cells, [r for _, r in ordered[position + 1:position + 16]])
                if detected:
                    active = detected
                    for block in active:
                        photo_columns.update(c for label, c in block['labels'].items() if label in PICTURES)
                        if block['inferred_code']:
                            issues.append({'sheet': name, 'row': row_number, 'message': '原表编码列表头为空，按现有编码识别，请核对。'})
                    continue
                if not active:
                    continue
                for block in active:
                    labels = block['labels']

                    def get(*keys):
                        for key in keys:
                            value = cells.get(labels.get(normalized(key)), '')
                            if value:
                                return text(value)
                        return ''

                    variant_name = get(*NAMES)
                    sku = get('sku编码', '商家编码', '编码', '货号')
                    erp = get('erp编码')
                    if not sku and not any(k in labels for k in ('sku编码', '商家编码')):
                        sku = erp if erp != '定制编码' else ''
                    if not variant_name and not sku:
                        continue
                    if not variant_name:
                        variant_name = name + ' · ' + sku
                        issues.append({'sheet': name, 'row': row_number, 'message': '规格名称为空，临时按工作表名和编码显示。'})
                    notes = [get('备注')]
                    original_sku = sku
                    if sku and sku in seen:
                        issues.append({'sheet': name, 'row': row_number, 'message': 'SKU重复：' + sku + '；保留该行，编码待补齐。'})
                        notes.append('原表SKU重复：' + sku)
                        sku = ''
                    if sku:
                        seen.add(sku)
                    raw_qty = get('每款SKU数量', '每SKU数量', '每份含量', '每份数量', '包装数量', '数量')
                    qty, unit = quantity(raw_qty)
                    unit = get('数量单位') or unit
                    suffix = re.search(r'(\d+)\s*(贴|枚|张|个|件|包|卷|套)(?:[）)]|$)', variant_name)
                    if not unit and suffix:
                        unit = suffix[2]
                    if suffix and qty and int(suffix[1]) != qty:
                        notes.append('原表规格名称中的含量与数量列不一致，请核对')
                        issues.append({'sheet': name, 'row': row_number, 'message': '规格名称含量与数量列不一致，已保留原值待核对。'})
                    source_fields = {text(cells.get(c, '')) and key: text(cells.get(c, '')) for key, c in labels.items() if cells.get(c)}
                    source_fields = {k: v for k, v in source_fields.items() if k}
                    if original_sku:
                        source_fields['原始编码'] = original_sku
                    photo_refs = list(dict.fromkeys(p['path'] for p in pictures if p['row'] is not None and p['row'] <= row_number <= p['last_row'] and p['col'] is not None and block['first'] <= p['col'] < block['last']))
                    mode = get('库存方式')
                    variants.append({'sku': sku, 'name': variant_name, 'erp_code': erp, 'size': get('尺寸', '规格'),
                                     'pack_qty': qty, 'pack_unit': unit, 'cost': number(get('成本', '纸张成本')),
                                     'price': number(get('售价', '淘宝售价', '淘宝标价')), 'shipping': number(get('快递费')),
                                     'material': get('材质'), 'inventory_mode': mode if mode in ('独立库存', '共用库存', '待关联', '仅统计销售') else '',
                                     'stock_code': get('共用库存编码'), 'note': '；'.join(v for v in notes if v),
                                     'source_row': row_number, 'source_col': col_name(block['first']), 'source_sheet': name,
                                     'source_fields': source_fields, 'image_refs': photo_refs, 'image_ids': []})
                    from material_printing import read_columns
                    variants[-1].update(read_columns(get))
            if not variants:
                issues.append({'sheet': name, 'row': None, 'message': '未识别到产品规格，图片及原资料需要核对。'})
                continue
            # Cover pictures from explicit image columns come first; keep other drawings as well.
            pictures.sort(key=lambda p: (p['col'] not in photo_columns, p['row'] or 0, p['col'] or 0))
            photo_refs = list(dict.fromkeys(p['path'] for p in pictures))
            referenced_images.update(photo_refs)
            materials = {v['material'] for v in variants}
            material = next(iter(materials)) if len(materials) == 1 else ''
            scene = '饮品包装' if any(token in name for token in ('奶茶', '饮品', '咖啡', '冰粉', '牛奶', '酸奶', '豆浆', '果茶', '冰沙', '杯套')) else '烘焙包装' if any(token in name for token in ('烘焙', '面包', '饼干', '蛋挞', '桃酥', '贝果', '糕点', '月饼')) else ''
            products.append({'name': name, 'category': infer_category(name), 'scene': scene, 'tags': [], 'material': material,
                             'process': '', 'description': '', 'owner': '', 'status': 'draft', 'variants': variants,
                             'images': [], 'image_refs': photo_refs, 'source': filename + ' / ' + name})
        if not products:
            raise ValueError('未识别到产品，请检查编码和规格名称表头。')
        return {'products': products, 'issues': issues, 'fingerprint': fingerprint, 'filename': filename,
                'sheets': sheet_count, 'variants': sum(len(p['variants']) for p in products),
                'image_paths': sorted(referenced_images)}
