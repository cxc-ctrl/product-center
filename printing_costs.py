"""Automatic print references with separately retained manual costs."""
import math
from material_printing import resolve


def automatic(row):
    return row.get('supply_mode') == '打印定制' and row.get('print_cost_source', 'auto') != 'manual'


def estimate(row, config):
    try:
        if (row.get('print_pricing') or ('legacy' if row.get('print_rule_code') else 'material')) == 'legacy':
            rule = next(r for r in config.get('print_rules', []) if r['code'] == row.get('print_rule_code'))
        else:
            rule = resolve(row, config.get('material_rates', []))
        per, quantity = rule.get('per_sheet'), row.get('pack_qty')
        if not per or not quantity or rule.get('enabled') != '是': return None
        values = [rule.get(k) for k in ('print_cost', 'lamination_cost', 'flat_cut_cost', 'die_cut_cost')]
        if any(v is None or type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in values): return None
        cost = round(math.ceil(quantity / per) * sum(values), 8)
        return cost if cost <= 100000000 else None
    except (ValueError, KeyError, StopIteration, TypeError):
        return None


def apply_variant(row, config):
    if not automatic(row): return
    row.setdefault('manual_cost', row.get('cost'))
    row.setdefault('manual_unit_cost', row.get('unit_cost'))
    row['print_cost_source'] = 'auto'
    row['cost'] = estimate(row, config)
    row['unit_cost'] = None
    row['cost_mode'] = '固定整份成本'


def project(products, config):
    for product in products:
        for row in product.get('variants', []): apply_variant(row, config)

