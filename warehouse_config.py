"""Product master contract V2. Stock balances and historic costs are never exported."""
import hashlib
import json
import math
from pricing import stock_price, COST_MODES

SUPPLY_MODES = ('', '现货', '打印定制', '现货优先（按条件）', '定制订单')

def normalize_supply(value):
 return {'仓库囤货':'现货','数码打印':'打印定制','工单定制':'定制订单','按条件处理（现货优先）':'现货优先（按条件）','数字贴按条件处理（现货优先）':'现货优先（按条件）'}.get(value,value)
UNITS = ('贴', '张', '枚', '个', '件', '包', '卷', '套', '份')
FIELDS = {
 'stocks': [('code','实物编码'),('name','实物名称'),('unit','库存单位'),('size','尺寸'),('cost','单位货品成本（元）'),('kind','实物类型'),('color','颜色'),('digit_size','数字尺寸（cm）'),('start','版面起号'),('end','版面止号'),('each','每号个数'),('note','备注')],
 'links': [('sku','SKU编码'),('stock_code','实物编码'),('mode','扣减方式'),('quantity','每份消耗数量'),('note','备注')],
 'print_rules': [('code','打印规则编码'),('name','打印产品名称'),('material','材质'),('per_sheet','可拼数量（个/张）'),('print_cost','材料及打印费（元/张）'),('lamination_cost','覆膜费（元/张）'),('flat_cut_cost','平板切割费（元/张）'),('die_cut_cost','普通模切费（元/张）'),('enabled','启用'),('note','备注')],
 'digit_conditions': [('code','条件编码'),('color','颜色'),('size','数字尺寸（cm）'),('start','现货起号'),('end','现货止号'),('out_of_range','超范围处理'),('shortage','库存不足处理'),('print_rule_code','打印规则编码'),('note','备注')],
}
SHEETS={'stocks':'实物资料','links':'库存关联','print_rules':'打印规则','digit_conditions':'数字贴条件'}
FIELDS['stocks'] += [('pricing_mode','计价方式'),('quote_qty','计价数量'),('quote_unit','计价单位'),('quote_total','货品总价（元）'),('units_per_quote','每个计价单位含库存单位数')]
FIELDS['material_rates']=[('code','材质内部编码'),('material','材质'),('print_cost','材料及打印费（元/张）'),('lamination_cost','覆膜费（元/张）'),('flat_cut_cost','平板切割费（元/张）'),('die_cut_cost','普通模切费（元/张）'),('enabled','启用'),('note','备注')]
SHEETS['material_rates']='材质费用'
NUMBERS={'stocks':{'cost','digit_size','start','end','each','quote_qty','quote_total','units_per_quote'},'links':{'quantity'},'print_rules':{'per_sheet','print_cost','lamination_cost','flat_cut_cost','die_cut_cost'},'digit_conditions':{'size','start','end'}}
INTEGERS={'per_sheet','start','end','each'}
NUMBERS['material_rates']={'print_cost','lamination_cost','flat_cut_cost','die_cut_cost'}

def number(v,label,integer=False):
 if v in ('',None):return None
 if isinstance(v,bool):raise ValueError(label+'须填写非负数字')
 try:n=float(v)
 except (ValueError,TypeError):raise ValueError(label+'须填写数字')
 if not math.isfinite(n) or not 0<=n<=100000000 or (integer and not n.is_integer()):raise ValueError(label+'格式无效')
 return int(n) if integer else n

def config(raw,maximum=20000):
 if raw is None:raw={}
 if not isinstance(raw,dict):raise ValueError('仓库与打印配置格式无效')
 result={}
 for key,fields in FIELDS.items():
  rows=raw.get(key,[])
  if not isinstance(rows,list) or len(rows)>maximum:raise ValueError(SHEETS[key]+'记录过多，请按产品分批整理')
  clean=[];seen=set()
  for row in rows:
   if not isinstance(row,dict):raise ValueError(SHEETS[key]+'行格式无效')
   if key=='material_rates' and any(v not in ('',None) for v in row.values()):
    from material_printing import rate_code
    row=dict(row,code=rate_code(row.get('material')) if isinstance(row.get('material'),str) else '',enabled=row.get('enabled') or '是')
   r={}
   for f,label in fields:
    v=row.get(f)
    if f in NUMBERS[key]:r[f]=number(v,label,f in INTEGERS)
    else:
     if v is None:v=''
     if not isinstance(v,str) or len(v)> (1000 if f=='note' else 300 if f=='name' else 160):raise ValueError(label+'格式或长度无效')
     r[f]=v.strip()
   if not any(v not in ('',None) for v in r.values()):continue
   if key!='links' and not r['code']:raise ValueError(SHEETS[key]+'请填写编码')
   if key=='stocks':
    if not r['name'] or r['unit'] not in UNITS or r['kind'] not in ('普通实物','数字贴版面'):raise ValueError('实物请填写名称、库存单位和实物类型')
    if r['kind']=='数字贴版面' and (not r['color'] or not r['digit_size'] or not r['start'] or r['end'] is None or r['end']<r['start'] or not r['each']):raise ValueError('数字版面须填写颜色、数字尺寸、起止号和每号个数')
    r=stock_price(r)
   if key=='links':
    if not r['sku'] or not r['stock_code'] or r['mode'] not in ('固定数量','按数字范围'):raise ValueError('库存关联须填写SKU、实物编码和扣减方式')
    if r['mode']=='固定数量' and (not r['quantity'] or r['quantity']%1):raise ValueError('每份消耗数量须为正整数')
    if r['mode']=='按数字范围':r['quantity']=None
   if key=='print_rules':
    if not r['name'] or not r['material'] or r['enabled'] not in ('是','否'):raise ValueError('打印规则须填写名称、材质和启用状态')
    if r['per_sheet']==0:raise ValueError('可拼数量须大于0，未知留空')
   if key=='material_rates':
    if not r['material'] or r['enabled'] not in ('是','否'):raise ValueError('材质费用须填写材质和启用状态')
    if any(r[f] is not None and r[f]!=round(r[f],4) for f in NUMBERS[key]):raise ValueError('材质每张费用最多保留4位小数')
   if key=='digit_conditions':
    if not r['color'] or not r['size'] or not r['start'] or r['end'] is None or r['end']<r['start']:raise ValueError('数字贴条件须填写颜色、尺寸和现货起止号')
    if r['out_of_range'] not in ('建议整单打印','人工核对') or r['shortage'] not in ('建议整单打印','人工核对'):raise ValueError('数字贴处理方式请选择建议整单打印或人工核对')
   identity=(r['sku'],r['stock_code']) if key=='links' else (r['code'],r['color'],r['size']) if key=='digit_conditions' else r['code']
   if identity in seen:raise ValueError(SHEETS[key]+'存在重复编码或关联：'+str(identity))
   seen.add(identity);clean.append(r)
  result[key]=clean
 return result

def bundle(products,known=None,shared=None):
 """Include referenced master rows; omit all unrelated product/stock data."""
 pool={key:{} for key in FIELDS};variants=[]
 for p in ([{'warehouse_config':shared}] if shared is not None else (known or products)):
  for key,rows in config(p.get('warehouse_config')).items():
   for r in rows:
    identity=(r['code'],r['color'],r['size']) if key=='digit_conditions' else (r['sku'],r['stock_code']) if key=='links' else r['code']
    if identity in pool[key] and pool[key][identity]!=r:raise ValueError(SHEETS[key]+'同编码配置不同：'+str(identity))
    pool[key][identity]=r
 for p in products:
  if not p.get('variants'):raise ValueError('请先建立销售规格，再同步到仓库：'+p['name'])
  for v in p['variants']:
   from printing_costs import apply_variant
   v=dict(v)
   apply_variant(v,{'material_rates':list(pool['material_rates'].values()),'print_rules':list(pool['print_rules'].values())})
   if not v.get('sku') or not v.get('name') or not v.get('pack_qty') or v.get('pack_unit') not in UNITS or v.get('supply_mode') not in SUPPLY_MODES[1:]:raise ValueError('同步前请补齐SKU、名称、每份数量、单位和供货方式：'+(v.get('sku') or p['name']))
   variants.append({k:v.get(k) for k in ['sku','name','erp_code','size','pack_qty','pack_unit','cost','price','material','note','supply_mode','print_rule_code','digit_condition_code','inventory_mode','stock_code','print_pricing','print_per_sheet','print_laminated','print_cutting','print_sheet_cost']}|{'material':v.get('material') or p.get('material',''),'cost_mode':v.get('cost_mode') or ('固定整份成本' if v.get('cost') is not None else '按实物自动计算'),'category':p.get('category',''),'product_id':p['id'],'revision':p['revision'],'inventory_group':v.get('batch_key','').split(':')[0]})
 for v in variants:
  if v['supply_mode'] in ('定制订单','现货优先（按条件）'):
   v['print_rule_code']='';v['digit_condition_code']=''
   if v['supply_mode']=='现货优先（按条件）':v['inventory_mode']='待关联';v['stock_code']=''
   continue
  if v.get('print_pricing')=='material' and v['supply_mode']!='现货':
   from material_printing import resolve
   generated=resolve(v,list(pool['material_rates'].values()),allow_incomplete=True)
   pool['print_rules'][generated['code']]=generated;v['print_rule_code']=generated['code']
 # Product setup owns its generated associations; shared masters still own prices.
 for p in products:
  if p.get('inventory_defaults'):
   managed=p.get('inventory_auto',{}).get('links',{})
   pool['links']={k:r for k,r in pool['links'].items() if r['sku'] not in managed}
   for r in config(p.get('warehouse_config'))['links']:
    if r['sku'] in managed:pool['links'][(r['sku'],r['stock_code'])]=r
 excluded={v['sku'] for v in variants if v.get('supply_mode') in ('打印定制','定制订单','现货优先（按条件）') or v.get('inventory_mode') in ('独立库存','仅统计销售')}
 pool['links']={k:r for k,r in pool['links'].items() if r['sku'] not in excluded}
 codes={v['sku'] for v in variants};links=[r for r in pool['links'].values() if r['sku'] in codes];stocks={r['stock_code'] for r in links};conditions={v.get('digit_condition_code') for v in variants};conditions_rows=[r for r in pool['digit_conditions'].values() if r['code'] in conditions];rules={v.get('print_rule_code') for v in variants}|{r['print_rule_code'] for r in conditions_rows}
 body={'version':3,'digit_rules_owner':'warehouse','variants':variants,'warehouse_config':{'stocks':[r for r in pool['stocks'].values() if r['code'] in stocks],'links':links,'print_rules':[r for r in pool['print_rules'].values() if r['code'] in rules],'digit_conditions':conditions_rows}}
 for code in stocks:
  if code not in pool['stocks']:raise ValueError('实物资料未建立：'+code)
 for code in rules-{'',None}:
  if code not in pool['print_rules']:raise ValueError('打印规则未建立：'+code)
 return body

def parse_v2(data,filename):
 if not filename.lower().endswith('.xlsx'):return None
 from catalog_import import excel_sheets
 sheets=dict(excel_sheets(data))
 if '商品资料' not in sheets:return None
 def records(name):
  rows=sheets.get(name,[])
  if not rows:return []
  headers={k:v for k,v in rows[0][1].items()}
  return [{h:cells.get(k,'') for k,h in headers.items()} for _,cells in rows[1:] if any(cells.get(k,'') for k,h in headers.items() if h!='单张合计（元）')]
 rows=records('商品资料')
 if not rows:return None
 if '供货方式' not in rows[0]:return None
 cfg=config({key:[{f:r.get(label,'') for f,label in fields} for r in records(SHEETS[key])] for key,fields in FIELDS.items()},maximum=100000)
 groups={};seen=set()
 inventory_labels={'独立成品':'独立库存','共用实物':'共用库存','待关联实物':'待关联','独立库存':'独立库存','共用库存':'共用库存','待关联':'待关联','仅统计销售':'仅统计销售'}
 status_labels={'已上架':'published','草稿':'draft','资料就绪':'ready','已停用':'paused','待完善':'ready','已下架':'paused'}
 v4=any('库存方式' in r for r in rows)
 for r in rows:
  sku=r.get('SKU编码','').strip();name=r.get('规格名称','').strip();parent=r.get('产品名称','').strip() or r.get('ERP编码','').strip() or name
  if not sku or sku in seen or not name:raise ValueError('商品资料SKU缺少、重复或名称缺少：'+sku)
  seen.add(sku)
  if parent not in groups:groups[parent]={'name':parent,'category':r.get('品类',''),'scene':'','material':r.get('材质',''),'process':'','owner':'','description':'','source':filename,'status':'draft','tags':[],'images':[],'variants':[]}
  mode=r.get('成本方式') or ('按实物自动计算' if '成本方式' in r else '固定整份成本' if r.get('整份货品成本（元）','')!='' else '按实物自动计算')
  if mode not in COST_MODES:raise ValueError('成本方式无效：'+sku)
  groups[parent]['variants'].append({'sku':sku,'name':name,'erp_code':r.get('ERP编码',''),'size':r.get('尺寸',''),'pack_qty':number(r.get('每SKU数量'),'每SKU数量',True),'pack_unit':r.get('数量单位',''),'cost':number(r.get('整份货品成本（元）'),'整份货品成本'),'price':number(r.get('参考售价（元）'),'参考售价'),'shipping':None,'material':r.get('材质',''),'inventory_mode':'待关联','stock_code':'','note':r.get('备注',''),'image_ids':[],'supply_mode':normalize_supply(r.get('供货方式','')),'print_rule_code':r.get('打印规则编码',''),'digit_condition_code':r.get('数字贴条件编码','')})
  groups[parent]['variants'][-1]['cost_mode']=mode
  groups[parent]['variants'][-1]['cost']=number(r.get('固定整份成本（元）',r.get('整份货品成本（元）')),'固定整份成本') if mode=='固定整份成本' else None
  if '每张可拼数量' in r:
   from material_printing import clean_inputs
   laminate=r.get('是否覆膜','') or '否';cut=r.get('切割方式','') or '不切割'
   if laminate not in ('是','否') or cut not in ('不切割','平板切割','普通模切','平板及模切'):raise ValueError('覆膜或切割选项无效：'+sku)
   groups[parent]['variants'][-1].update(clean_inputs({'print_pricing':'material','print_per_sheet':r.get('每张可拼数量'),'print_laminated':laminate=='是','print_cutting':{'不切割':'none','平板切割':'flat','普通模切':'die','平板及模切':'both'}[cut]}))
  if v4:
   label=(r.get('库存方式') or '待关联实物').strip()
   if label not in inventory_labels:raise ValueError('库存方式无效：'+sku)
   variant=groups[parent]['variants'][-1]
   variant['inventory_mode']=inventory_labels[label]
   variant['stock_code']=r.get('实物库存编码','').strip()
   if variant['stock_code'] and variant['inventory_mode']!='共用库存':raise ValueError('只有共用实物需要填写实物库存编码：'+sku)
   own_links=[l for l in cfg['links'] if l['sku']==sku]
   if variant['supply_mode'] in ('打印定制','定制订单'):
    if own_links or variant['stock_code']:raise ValueError('打印或定制商品不要配置库存关联：'+sku)
   elif variant['inventory_mode']=='共用库存':
    if not own_links:raise ValueError('共用实物请在库存关联中填写扣减规则：'+sku)
    if variant['stock_code'] and {l['stock_code'] for l in own_links}!={variant['stock_code']}:raise ValueError('实物库存编码与库存关联不一致：'+sku)
   elif variant['inventory_mode'] in ('独立库存','仅统计销售'):
    if own_links:raise ValueError('独立成品或仅统计销售不要配置实物关联：'+sku)
    if variant['inventory_mode']=='独立库存' and mode!='固定整份成本':raise ValueError('独立成品请选择固定整份成本：'+sku)
   if variant['supply_mode']=='现货优先（按条件）' and variant['inventory_mode'] in ('独立库存','仅统计销售'):raise ValueError('条件现货须关联实物：'+sku)
   status=status_labels.get((r.get('产品状态') or '已上架').strip())
   if not status:raise ValueError('产品状态无效：'+sku)
   if len(groups[parent]['variants'])>1 and groups[parent]['status']!=status:raise ValueError('同一产品的状态须一致：'+parent)
   groups[parent]['status']=status
   # Spreadsheet associations are explicit and may include several materials.
   # Keep them editable without rebuilding them from packaging quantities.
   groups[parent]['inventory_defaults']={'mode':variant['inventory_mode'],'auto_link':False}
 assigned={key:set() for key in FIELDS if key!='links'}
 for p in groups.values():
  ids={v['sku'] for v in p['variants']};links=[r for r in cfg['links'] if r['sku'] in ids];stockids={r['stock_code'] for r in links};conditionids={v['digit_condition_code'] for v in p['variants']};conditions=[r for r in cfg['digit_conditions'] if r['code'] in conditionids];ruleids={v['print_rule_code'] for v in p['variants']}|{r['print_rule_code'] for r in conditions}
  from material_printing import material_key
  materials={material_key(v.get('material') or p.get('material')) for v in p['variants']}
  relevant={'stocks':[r for r in cfg['stocks'] if r['code'] in stockids],'print_rules':[r for r in cfg['print_rules'] if r['code'] in ruleids],'digit_conditions':conditions,'material_rates':[r for r in cfg['material_rates'] if material_key(r['material']) in materials]}
  p['warehouse_config']={'links':links}
  for key,entries in relevant.items():
   take=[]
   for entry in entries:
    identity=(entry['code'],entry['color'],entry['size']) if key=='digit_conditions' else entry['code']
    if identity not in assigned[key]:take.append(entry);assigned[key].add(identity)
   p['warehouse_config'][key]=take
 used={r['stock_code'] for r in cfg['links']};known={r['code'] for r in cfg['stocks']}
 if used-known or any(r['sku'] not in seen for r in cfg['links']):raise ValueError('库存关联引用了未建立的SKU或实物')
 return {'products':list(groups.values()),'issues':[],'fingerprint':hashlib.sha256(data).hexdigest(),'filename':filename,'sheets':len(sheets),'variants':len(rows),'contract_version':2}
