"""Cost quotation is a price basis, never a stock receipt."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

COST_MODES = ('按实物自动计算', '固定整份成本')
PRICE_MODES = ('直接填单价', '按总价换算')


def price_number(value, label):
    if value in ('', None):
        return None
    if isinstance(value, bool):
        raise ValueError(label + '须填写非负数字')
    try:
        n = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError(label + '须填写数字')
    if not n.is_finite() or not 0 <= n <= 100000000:
        raise ValueError(label + '超出允许范围')
    if n != n.quantize(Decimal('0.00000001')):
        raise ValueError(label + '最多8位小数')
    return float(n)


def stock_price(row):
    r = dict(row)
    mode = r.get('pricing_mode') or '直接填单价'
    if mode not in PRICE_MODES:
        raise ValueError('实物计价方式无效')
    r['pricing_mode'] = mode
    r['quote_unit'] = r.get('quote_unit') or r['unit']
    if r['quote_unit'] not in ('贴', '张', '枚', '个', '件', '包', '卷', '套', '份'):
        raise ValueError('计价单位无效')
    for key, label in [('quote_qty', '计价数量'), ('quote_total', '货品总价'), ('units_per_quote', '每个计价单位含库存单位数')]:
        r[key] = price_number(r.get(key), label)
    each = r['units_per_quote'] if r['units_per_quote'] is not None else 1
    if each <= 0 or int(each) != each:
        raise ValueError('单位换算数量须为正整数')
    if mode == '按总价换算':
        r['units_per_quote'] = each
        if r['quote_unit'] == r['unit'] and each != 1:
            raise ValueError('计价单位和库存单位相同时，换算数量必须为1')
        q, total = r['quote_qty'], r['quote_total']
        if q is not None and (q <= 0 or int(q) != q):
            raise ValueError('计价数量须为正整数')
        r['cost'] = None if q is None or total is None else float((Decimal(str(total)) / (Decimal(str(q)) * Decimal(str(each)))).quantize(Decimal('0.00000001'), rounding=ROUND_HALF_UP))
    else:
        r['cost'] = price_number(r.get('cost'), '实物单位成本')
    return r
