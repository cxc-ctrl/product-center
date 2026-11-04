"""Read product metadata from Excel/CSV. Inventory balances are never imported."""
import csv
import hashlib
import io
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def text(value):
    return str(value or '').strip()


def header(value):
    return re.sub(r'\s+', '', text(value)).lower().replace('：', '')


def number(value):
    try:
        result = float(text(value))
        return result if 0 <= result < 100000000 and result == result else None
    except (ValueError, TypeError):
        return None


def quantity(value):
    match = re.fullmatch(r'\s*(\d+)(?:\.0+)?\s*(张/份|贴|张|枚|个|件|包|卷|套)?\s*', text(value))
    if not match:
        return None, ''
    n = int(match[1])
    return (n if 0 < n <= 100000 else None), (match[2] or '').replace('张/份', '张')


def excel_sheets(data):
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        if len(package.infolist()) > 2000 or sum(i.file_size for i in package.infolist()) > 100 * 1024 * 1024:
            raise ValueError('表格内容过大，请拆分后导入。')
        strings = []
        if 'xl/sharedStrings.xml' in package.namelist():
            for si in ET.fromstring(package.read('xl/sharedStrings.xml')):
                strings.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['s'])))
        rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(package.read('xl/_rels/workbook.xml.rels'))}
        workbook = ET.fromstring(package.read('xl/workbook.xml'))
        for sheet in workbook.find('s:sheets', NS):
            target = rels[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            path = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            if not path.startswith('xl/'):
                raise ValueError('工作表路径无效。')
            root = ET.fromstring(package.read(path))
            rows = {}
            for row in root.findall('s:sheetData/s:row', NS):
                cells = {}
                for cell in row.findall('s:c', NS):
                    address = cell.get('r', '')
                    col = re.sub(r'\d', '', address)
                    v = cell.find('s:v', NS)
                    if cell.get('t') == 's' and v is not None:
                        value = strings[int(v.text)]
                    elif cell.get('t') == 'inlineStr':
                        value = ''.join(t.text or '' for t in cell.iter('{%s}t' % NS['s']))
                    else:
                        value = v.text if v is not None else ''
                    if text(value):
                        cells[col] = text(value)
                if cells:
                    rows[int(row.get('r'))] = cells
            # Expand only explicit merged ranges. Blank, unmerged cells stay unknown.
            for merge in root.findall('s:mergeCells/s:mergeCell', NS):
                match = re.fullmatch(r'([A-Z]+)(\d+):([A-Z]+)(\d+)', merge.get('ref', ''))
                if match and match[1] == match[3]:
                    col, first, last = match[1], int(match[2]), int(match[4])
                    source = rows.get(first, {}).get(col)
                    if source and last - first <= 20000:
                        for idx in range(first + 1, last + 1):
                            if idx in rows:
                                rows[idx].setdefault(col, source)
            yield sheet.get('name', '未命名产品'), sorted(rows.items())


def parse_catalog(data, filename, allow_large=False):
    if filename.lower().endswith('.xlsx'):
        from cost_catalog import parse_cost_catalog
        cost = parse_cost_catalog(data, filename)
        if cost is not None:return cost
        from warehouse_config import parse_v2
        v2=parse_v2(data,filename)
        if v2 is not None:return v2
        from workbook_catalog import parse_workbook
        return parse_workbook(data, filename, allow_large=allow_large)
    elif filename.lower().endswith('.csv'):
        decoded = None
        for encoding in ('utf-8-sig', 'gb18030'):
            try:
                decoded = data.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if decoded is None:
            raise ValueError('CSV编码无法识别，请保存为UTF-8。')
        records = list(csv.reader(io.StringIO(decoded)))
        sheets = [(filename.rsplit('.', 1)[0], [(i + 1, {str(c): v for c, v in enumerate(row) if v.strip()}) for i, row in enumerate(records)])]
    else:
        raise ValueError('请选择.xlsx或.csv文件。')
    groups, issues, seen = [], [], set()
    for sheet_name, rows in sheets:
        found = None
        for idx, cells in rows[:12]:
            labels = {header(v): c for c, v in cells.items()}
            if any(h in labels for h in ('sku编码', '商家编码', 'erp编码')) and any(h in labels for h in ('规格名称', '简称', '面单信息', '产品名称')):
                found = idx, labels
                break
        if not found:
            issues.append({'sheet': sheet_name, 'row': None, 'message': '未识别到产品表头，已保留原文件，暂未导入此页。'})
            continue
        first, labels = found

        def get(cells, *names):
            for name in names:
                value = cells.get(labels.get(header(name)), '')
                if value:
                    return text(value)
            return ''

        variants = []
        for row_number, cells in rows:
            if row_number <= first:
                continue
            name = get(cells, '规格名称', '简称', '面单信息', '产品名称')
            sku = get(cells, 'SKU编码', '商家编码')
            erp = get(cells, 'ERP编码')
            if not name:
                continue
            # Older sheets use ERP编码 as the sellable SKU. Keep its original value.
            if not sku and not any(k in labels for k in ('sku编码', '商家编码')):
                if erp and erp != '定制编码':
                    sku = erp
            if sku in seen and sku:
                issues.append({'sheet': sheet_name, 'row': row_number, 'message': 'SKU重复：' + sku + '；该行保留为待补编码规格。'})
                sku = ''
            if sku:
                seen.add(sku)
            raw_qty = get(cells, '每款SKU数量', '每SKU数量', '每份含量', '每份数量', '包装数量', '数量')
            qty, detected_unit = quantity(raw_qty)
            unit = get(cells, '数量单位') or detected_unit
            # A name with “500贴” identifies a packaging unit, never a stock balance.
            suffix = re.search(r'\d+\s*(贴|枚|张|个|件|包|卷|套)(?:[）)]|$)', name)
            if not unit and suffix:
                unit = suffix[1]
            mode = get(cells, '库存方式')
            variants.append({
                'sku': sku, 'name': name, 'erp_code': erp,
                'size': get(cells, '尺寸', '规格'), 'pack_qty': qty,
                'pack_unit': unit, 'cost': number(get(cells, '成本', '纸张成本')),
                'price': number(get(cells, '淘宝售价', '淘宝标价')),
                'shipping': number(get(cells, '快递费')),
                'material': get(cells, '材质'),
                'inventory_mode': mode if mode in ('独立库存', '共用库存', '待关联', '仅统计销售') else '',
                'stock_code': get(cells, '共用库存编码'),
                'note': get(cells, '备注'), 'source_row': row_number, 'source_sheet': sheet_name,
            })
            from material_printing import read_columns
            variants[-1].update(read_columns(lambda *keys:get(cells,*keys)))
        if not variants:
            issues.append({'sheet': sheet_name, 'row': None, 'message': '没有可识别的产品规格。'})
            continue
        materials = Counter(v['material'] for v in variants if v['material'])
        category = '杯套' if '杯套' in sheet_name else '卡片' if '卡' in sheet_name else '贴纸'
        scene = '烘焙包装' if any(t in sheet_name for t in ('烘焙', '面包', '饼干', '蛋挞', '桃酥', '贝果')) else '饮品包装' if any(t in sheet_name for t in ('茶', '饮品', '冰粉', '咖啡', '牛奶', '酸奶', '杯套', '果汁', '椰', '冰浆', '烧仙草')) else ''
        groups.append({'name': sheet_name, 'category': category, 'scene': scene,
                       'tags': [], 'material': materials.most_common(1)[0][0] if materials else '',
                       'process': '', 'description': '', 'owner': '', 'status': 'draft',
                       'variants': variants, 'images': [], 'source': filename + ' / ' + sheet_name})
    if not groups:
        raise ValueError('未找到可导入的产品资料。请检查表头是否包含SKU编码和规格名称。')
    return {'products': groups, 'issues': issues, 'fingerprint': hashlib.sha256(data).hexdigest(),
            'filename': filename, 'sheets': len(sheets), 'variants': sum(len(p['variants']) for p in groups)}
