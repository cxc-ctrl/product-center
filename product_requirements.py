"""Completeness gate for manual editor saves; import staging remains supported."""
from decimal import Decimal, ROUND_HALF_UP


def pack_cost(rate, quantity):
    if rate is None or quantity is None:
        return None
    result = (Decimal(str(rate)) * Decimal(str(quantity))).quantize(Decimal('0.00000001'), rounding=ROUND_HALF_UP)
    if result > 100000000:
        raise ValueError('每单位成本乘以每份含量不能超过100000000元。')
    return float(result)


def issues(product):
    rows = product.get('variants', [])
    if not rows:
        return [{'row': 0, 'field': 'name', 'message': '请至少填写一条完整的销售规格。'}]
    errors = []
    def missing(index, field, label):
        errors.append({'row': index, 'field': field, 'message': f'第{index + 1}行：请填写{label}。'})
    for i, row in enumerate(rows):
        for field, label in [('name', '规格名称'), ('sku', 'SKU编码'), ('size', '尺寸'), ('pack_unit', '含量单位'), ('material', '材质')]:
            if not str(row.get(field) or '').strip():
                missing(i, field, label)
        if not row.get('pack_qty'):
            missing(i, 'pack_qty', '每份含量')
        # Existing fixed or automatically calculated costs are also valid costs.
        mode = row.get('supply_mode') or product.get('supply_defaults', {}).get('supply_mode')
        if mode != '定制订单' and row.get('unit_cost') is None and row.get('cost') is None:
            if mode == '打印定制' and row.get('print_cost_source', 'auto') != 'manual':
                missing(i, 'material', '可计算成本的材质及加工费用')
            else:missing(i, 'unit_cost', '每单位成本')
        if row.get('price') is None:
            missing(i, 'price', '销售价')
        if mode == '打印定制' and not row.get('print_per_sheet'):
            missing(i, 'print_per_sheet', '每张可拼数量')
    return errors


def require_complete(raw, con, validate, Problem):
    product = validate(raw, con)
    # Automatic stock costs can be complete without storing a fixed pack price.
    checked = {**product, 'variants': [dict(v) for v in product['variants']]}
    from shared_rules import read
    config = read(con)['config']
    own = product.get('warehouse_config', {})
    stocks = {s['code']: s for s in [*config.get('stocks', []), *own.get('stocks', [])]}
    for row in checked['variants']:
        if row.get('supply_mode') == '打印定制' or row.get('cost_mode') != '按实物自动计算' or row.get('cost') is not None:
            continue
        links = [r for r in own.get('links', []) if r['sku'] == row['sku']] or [r for r in config.get('links', []) if r['sku'] == row['sku']]
        if links and all(r['mode'] == '固定数量' and r.get('quantity') and stocks.get(r['stock_code'], {}).get('cost') is not None for r in links):
            row['cost'] = sum(Decimal(str(stocks[r['stock_code']]['cost'])) * Decimal(str(r['quantity'])) for r in links)
    errors = issues(checked)
    if errors:
        raise Problem(errors[0]['message'], 400, issues=errors)
    return product
