"""Summarize explicit production details without guessing gloss versus matte."""
import re
import unicodedata


def infer(product):
    found = set()
    for row in product.get('variants', []):
        source = row.get('source_fields') or {}
        texts = [row.get('name', ''), row.get('material', '')]
        texts.extend(value for key, value in source.items() if any(word in key for word in ('工艺', '覆膜', '加工', '切割')))
        text = unicodedata.normalize('NFKC', '、'.join(str(value) for value in texts))
        text = re.sub(r'(?:不|无|未)(?:覆)?(?:光膜|亮膜|哑膜|啞膜|亚膜|覆膜|模切|切割)', '', text)
        laminated = row.get('print_laminated')
        printing = row.get('supply_mode') == '打印定制'
        if laminated is not False or not printing:
            gloss = bool(re.search('光膜|亮膜', text))
            matte = bool(re.search('哑膜|啞膜|亚膜', text))
            if gloss: found.add('光膜')
            if matte: found.add('哑膜')
            if not gloss and not matte and ((laminated is True and printing) or '覆膜' in text): found.add('覆膜')
        cutting = row.get('print_cutting')
        if cutting in ('die', 'both'): found.add('模切')
        if cutting in ('flat', 'both'): found.add('平板切割')
        if cutting not in ('die', 'flat', 'both'):
            if '模切' in text: found.add('模切')
            if '平板切割' in text: found.add('平板切割')
    return '、'.join(name for name in ('光膜', '哑膜', '覆膜', '模切', '平板切割') if name in found)


def process_mode(product):
    mode = product.get('process_mode') or ('manual' if product.get('process') else 'auto')
    if mode not in ('auto', 'manual'): raise ValueError('工艺填写方式无效。')
    return mode


def apply(product, raw):
    product['process_mode'] = process_mode(raw)
    if product['process_mode'] == 'auto': product['process'] = infer(product)


def present(product):
    apply(product, product)
