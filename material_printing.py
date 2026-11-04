"""Material rates and layout inputs compile to the existing warehouse contract."""
import hashlib
import json
import unicodedata

PRINT_FIELDS = ('print_pricing','print_per_sheet','print_laminated','print_cutting','print_cost_source','print_sheet_cost')
CUTTING = ('none','flat','die','both')


def material_key(value):
    return ''.join(unicodedata.normalize('NFKC',value or '').split()).casefold()


def rate_code(material):
    return 'MAT-'+hashlib.sha256(material_key(material).encode()).hexdigest()[:16].upper()


def clean_inputs(raw):
    result={}
    if not any(key in raw for key in PRINT_FIELDS):return result
    method=raw.get('print_pricing') or ('legacy' if raw.get('print_rule_code') else 'material')
    if method not in ('material','legacy'):raise ValueError('打印计价方式无效。')
    per=raw.get('print_per_sheet')
    if per in ('',None):per=None
    else:
        if isinstance(per,bool):raise ValueError('每张可拼数量须为正整数。')
        try:value=float(per)
        except (ValueError,TypeError):raise ValueError('每张可拼数量须为正整数。')
        if not 1<=value<=100000 or not value.is_integer():raise ValueError('每张可拼数量须为1至100000的整数。')
        per=int(value)
    laminated=raw.get('print_laminated',False)
    cutting=raw.get('print_cutting') or 'none'
    if type(laminated) is not bool or cutting not in CUTTING:raise ValueError('打印加工选项无效。')
    cost_source=raw.get('print_cost_source') or 'auto'
    if cost_source not in ('auto','manual'):raise ValueError('打印成本来源无效。')
    from pricing import price_number
    sheet_cost=price_number(raw.get('print_sheet_cost'),'每张大纸完整成本')
    result=dict(print_pricing=method,print_per_sheet=per,print_laminated=laminated,print_cutting=cutting,print_cost_source=cost_source)
    if 'print_sheet_cost' in raw:result['print_sheet_cost']=sheet_cost
    return result


def read_columns(get):
    """Recognize optional columns in the user's older product worksheets too."""
    result={}
    cost_source=get('成本来源','打印成本来源')
    if cost_source:
        sources={'按打印方案自动计算':'auto','自动成本':'auto','自动':'auto','auto':'auto','手动成本':'manual','手动':'manual','manual':'manual'}
        if cost_source not in sources:raise ValueError('成本来源请填写自动成本或手动成本')
        result['print_cost_source']=sources[cost_source]
    supply=get('供货方式')
    from warehouse_config import normalize_supply
    supply=normalize_supply(supply)
    if supply:
        if supply not in ('现货','打印定制','定制订单','现货优先（按条件）'):raise ValueError('供货方式无效：'+supply)
        result['supply_mode']=supply
    for field,label in [('print_rule_code','打印规则编码'),('digit_condition_code','数字贴条件编码')]:
        value=get(label)
        if value:result[field]=value
    per=get('每张可拼数量','每张可拼数量（个/张）','可拼数量','可拼数量（个/张）','每张可印个数')
    if per:
        lam=get('是否覆膜') or '否';cut=get('切割方式') or '不切割'
        if lam not in ('是','否') or cut not in ('不切割','平板切割','普通模切','平板及模切'):raise ValueError('覆膜或切割选项无效')
        result.update(clean_inputs({'print_pricing':'material','print_per_sheet':per,'print_laminated':lam=='是','print_cutting':{'不切割':'none','平板切割':'flat','普通模切':'die','平板及模切':'both'}[cut]}))
    return result


def resolve(variant,rates,allow_incomplete=False):
    """Do not derive a selling price or modify a stored product here."""
    material=variant.get('material','')
    per=variant.get('print_per_sheet')
    if not material_key(material):raise ValueError('请选择打印材质：'+variant['sku'])
    from pricing import price_number
    sheet_cost=price_number(variant.get('print_sheet_cost'),'每张大纸完整成本')
    if not per and not (allow_incomplete and sheet_cost is not None):raise ValueError('请填写每张可拼数量：'+variant['sku'])
    if sheet_cost is not None:
        size=variant.get('size','').strip()
        signature=json.dumps([material_key(material),size,per,variant.get('print_laminated',False),variant.get('print_cutting','none'),sheet_cost],ensure_ascii=False,separators=(',',':'))
        code='AUTO-SHEET-'+hashlib.sha256(signature.encode()).hexdigest()[:20].upper()
        return {'code':code,'name':material+(' · '+size if size else '')+' · '+('每张'+str(per)+'个' if per else '可拼数量待填')+' · 单张完整成本'+str(sheet_cost)+'元','material':material,'per_sheet':per,'print_cost':sheet_cost,'lamination_cost':0,'flat_cut_cost':0,'die_cut_cost':0,'enabled':'是','note':'每张大纸完整成本，已含本商品加工；不再重复叠加通用加工费。可拼数量未填时成本待配置。'}
    matching=[r for r in rates if material_key(r['material'])==material_key(material)]
    if len(matching)!=1:raise ValueError('打印材质费用未配置或重复：'+material)
    rate=matching[0]
    if rate['enabled']!='是':raise ValueError('打印材质已停用：'+material)
    cut=variant.get('print_cutting','none');lam=variant.get('print_laminated',False)
    signature=json.dumps([material_key(material),per,lam,cut],ensure_ascii=False,separators=(',',':'))
    code='AUTO-MAT-'+hashlib.sha256(signature.encode()).hexdigest()[:20].upper()
    return {'code':code,'name':material+'－'+('覆膜' if lam else '不覆膜')+'－'+{'none':'不切割','flat':'平板切割','die':'普通模切','both':'平板及模切'}[cut]+' · 每张'+str(per)+'个','material':material,'per_sheet':per,
      'print_cost':rate.get('print_cost'),'lamination_cost':rate.get('lamination_cost') if lam else 0,
      'flat_cut_cost':rate.get('flat_cut_cost') if cut in ('flat','both') else 0,
      'die_cut_cost':rate.get('die_cut_cost') if cut in ('die','both') else 0,
      'enabled':'是','note':'按材质费用自动配置；销售价人工设置。'}
