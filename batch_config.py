"""Validate the persisted batch-generation rules without rewriting manual edits."""
import re
import math

AUTO_FIELDS = ('name', 'sku', 'size', 'pack_qty', 'pack_unit', 'image_ids', 'cost', 'unit_cost', 'price')


def validate_batch(raw, name, images):
    if not isinstance(raw, dict):
        raise ValueError('批量新建规则无效。')
    count = raw.get('count')
    quantities = raw.get('quantities')
    if type(count) is not int or not 1 <= count <= 200:
        raise ValueError('款数需要填写1至200的整数。')
    if not isinstance(quantities, list) or not quantities or len(quantities) > 50 or any(type(q) is not int or not 1 <= q <= 100000 for q in quantities) or len(set(quantities)) != len(quantities) or count * len(quantities) > 1000:
        raise ValueError('数量规格无效或生成数量超过1000行。')
    result = {'name': name, 'count': count, 'quantities': quantities, 'auto_initials': raw.get('auto_initials', True)}
    if type(result['auto_initials']) is not bool:
        raise ValueError('首拼同步设置无效。')
    if 'omit_single_design' in raw:
        if type(raw['omit_single_design']) is not bool:
            raise ValueError('单款命名设置无效。')
        result['omit_single_design'] = raw['omit_single_design']
    for key, limit in [('prefix1', 32), ('prefix2', 32), ('initials', 80)]:
        value = raw.get(key)
        if not isinstance(value, str) or not re.fullmatch(r'[A-Z0-9]{1,%d}' % limit, value):
            raise ValueError('SKU前缀和首拼只支持大写字母、数字。')
        result[key] = value
    if raw.get('unit') not in ('贴', '张', '枚', '个', '件', '包', '卷', '套', '份') or not isinstance(raw.get('size', ''), str) or len(raw.get('size', '')) > 160:
        raise ValueError('批量数量单位或尺寸无效。')
    result.update(unit=raw['unit'], size=raw.get('size', ''))
    if 'row_defaults' in raw:
        defaults = raw['row_defaults']
        if not isinstance(defaults, dict) or any(k not in ('cost', 'unit_cost', 'price') or (v is not None and (type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 100000000)) for k, v in defaults.items()):
            raise ValueError('首行成本或售价无效。')
        result['row_defaults'] = defaults
    designs = raw.get('design_images', {})
    names = raw.get('design_names', {})
    if not isinstance(names, dict) or len(names) > 200 or any(not isinstance(key, str) or not re.fullmatch(r'[A-Z]{1,3}', key) or not isinstance(value, str) or len(value) > 80 for key, value in names.items()):
        raise ValueError('款式或口味名称无效，最多80字。')
    if 'design_names' in raw:
        result['design_names'] = {key: value.strip() for key, value in names.items() if value.strip()}
    excluded = raw.get('excluded_keys', [])
    if not isinstance(designs, dict) or len(designs) > 200:
        raise ValueError('款式图片配置无效。')
    for key, values in designs.items():
        if not isinstance(key, str) or not re.fullmatch(r'[A-Z]{1,3}', key) or not isinstance(values, list) or len(values) > 30 or any(not isinstance(i, str) or i not in images for i in values):
            raise ValueError('款式图片需要先上传到本产品。')
    if not isinstance(excluded, list) or len(excluded) > 1000 or any(not isinstance(k, str) or not re.fullmatch(r'[A-Z]{1,3}:[1-9][0-9]{0,5}', k) for k in excluded):
        raise ValueError('批量移除记录无效。')
    result.update(design_images=designs, excluded_keys=list(dict.fromkeys(excluded)))
    return result
