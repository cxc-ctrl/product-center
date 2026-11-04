"""Preview and atomically merge nonblank SKU metadata. Never import stock balances."""
import copy
import csv
import hashlib
import io
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from catalog_import import excel_sheets, header, quantity

ALIASES = {
 'sku': ('SKU编码','商家编码'), 'name': ('规格名称','商品名称','面单信息','简称'),
 'parent': ('产品名称','产品分组'), 'erp_code': ('ERP商品编码',),
 'category': ('品类','产品类型'), 'size': ('尺寸','尺寸（cm）','规格'),
 'pack_qty': ('每SKU数量','每款SKU数量','每份含量','每份数量','数量'), 'pack_unit': ('数量单位','单位'),
 'unit_cost': ('每单位成本','单位成本（元/贴或张）','现货单位成本（元/数量单位）','现货单位成本','每贴成本','单位成本（元/贴、张）','单位成本（元）','每贴价格'),
 'cost': ('固定整份成本（元）','整份货品成本（元）','整份成本（元/份）','整份成本（元）','成本'),
 'cost_mode': ('成本方式',), 'price': ('参考售价（元）','参考售价'),
 'material': ('材质',), 'supply_mode': ('供货方式','制作方式'), 'note': ('备注',),
 'print_per_sheet': ('每张可拼数量','每张可拼数量（个/张）'),
 'print_laminated': ('是否覆膜',), 'print_cutting': ('切割方式',),
 'print_cost_source': ('成本来源','打印成本来源'),
 'print_rule_code': ('打印规则编码',), 'status': ('产品状态',),
 'scene': ('使用场景',), 'description': ('产品介绍',), 'process': ('工艺',),
}
LABELS={k:v[0] for k,v in ALIASES.items()}
LABELS.update(image_ids='规格图片',source_fields='原表补充资料')
STATUSES={'已上架':'published','草稿':'draft','资料就绪':'ready','已停用':'paused'}


def parse(data, filename):
 from app import Problem
 rows=[];issues=[];image_paths=set();pictures={};formulas={}
 if filename.lower().endswith('.xlsx'):
  from cost_catalog import parse_cost_catalog
  cost=parse_cost_catalog(data,filename)
  if cost is not None:
   # Reuse the other chat's validated, image-aware 400MB cost-table format,
   # then use the same preview/blank-preserving transaction as ordinary imports.
   for parent in cost['products']:
    for v in parent['variants']:
     inputs={k:str(v[k]) for k in ('name','erp_code','size','pack_qty','pack_unit','material','cost','unit_cost','cost_mode','supply_mode','note') if v.get(k) not in ('',None)}
     inputs['parent']=parent['name']
     if v.get('print_pricing')=='material':
      inputs.update(print_per_sheet=str(v['print_per_sheet']),print_laminated='是' if v['print_laminated'] else '否',print_cutting={'none':'不切割','flat':'平板切割','die':'普通模切','both':'平板及模切'}[v['print_cutting']])
     rows.append({'sku':v['sku'],'inputs':inputs,'sheet':v['source_sheet'],'row':v['source_row'],'extra':v.get('source_fields',{}),'default_status':parent['status'],'default_category':parent['category']})
     products_refs={'name':parent['name'],'images':[],'image_refs':v.get('image_refs',[]),'variants':[{'sku':v['sku'],'image_ids':[],'image_refs':v.get('image_refs',[])}]}
     cost.setdefault('_metadata_products',[]).append(products_refs)
   return {'bulk':True,'rows':rows,'products':cost['_metadata_products'],'image_paths':cost['image_paths'],'issues':cost['issues'],
           'filename':filename,'fingerprint':cost['fingerprint'],'sheets':cost['sheets'],'variants':len(rows),'cost_table_adapter':True}
  sheets=list(excel_sheets(data))
  from workbook_catalog import read_sheet, relationships, NS
  with zipfile.ZipFile(io.BytesIO(data)) as package:
   strings=[''.join(t.text or '' for t in si.iter('{'+NS['s']+'}t')) for si in ET.fromstring(package.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in package.namelist() else []
   refs=relationships(package,'xl/workbook.xml')
   for sheet in ET.fromstring(package.read('xl/workbook.xml')).find('s:sheets',NS):
    path=refs[sheet.get('{'+NS['r']+'}id')]['path'];name=sheet.get('name')
    _,pictures[name]=read_sheet(package,path,strings)
    root=ET.fromstring(package.read(path))
    formulas[name]={c.get('r') for c in root.findall('.//s:c',NS) if c.find('s:f',NS) is not None}
 elif filename.lower().endswith('.csv'):
  for enc in ('utf-8-sig','gb18030'):
   try:decoded=data.decode(enc);break
   except UnicodeDecodeError:continue
  else:raise Problem('CSV编码无法识别，请另存为UTF-8。')
  sheets=[(filename.rsplit('.',1)[0],[(i+1,{str(j):v for j,v in enumerate(row) if v.strip()}) for i,row in enumerate(csv.reader(io.StringIO(decoded)))])]
 else:raise Problem('请选择.xlsx或.csv文件。')
 seen=set();products=[]
 for sheet,cells in sheets:
  if any(name=='商品资料' for name,_ in sheets) and sheet!='商品资料':continue
  if sheet in ('材质费用','实物资料','库存关联','打印规则','数字贴条件','填写说明'):continue
  found=None
  for idx,values in cells[:15]:
   labels={header(v):col for col,v in values.items()}
   if any(header(s) in labels for s in ('SKU编码','商家编码','ERP编码')):
    if len(labels)!=len(values):raise Problem('表头有重复列名，请先整理：'+sheet)
    found=(idx,labels);break
  if not found:continue
  first,labels=found
  cols={key:next((labels[header(s)] for s in names if header(s) in labels),None) for key,names in ALIASES.items()}
  if cols['sku'] is None:cols['sku']=labels.get(header('ERP编码'))
  elif header('ERP编码') in labels:cols['erp_code']=labels[header('ERP编码')]
  if any(header(s) in labels for s in ('库存数量','实际库存','初始库存')):
   issues.append({'sheet':sheet,'row':first,'message':'库存数量列不会导入；实际库存由仓库维护。'})
  if any(header(s) in labels for s in ('淘宝售价','拼多多售价','快递费')):
   issues.append({'sheet':sheet,'row':first,'message':'平台售价、快递费仅保留在原表；参考售价请单独填写，系统不自动选价。'})
  from workbook_catalog import col_number
  for idx,values in cells:
   if idx<=first:continue
   sku=(values.get(cols['sku']) or '').strip()
   if not sku:
    if any(values.get(c) for c in cols.values() if c is not None):raise Problem(f'{sheet}第{idx}行缺少SKU编码。')
    continue
   if sku in seen:raise Problem('表格中SKU重复，本次没有写入：'+sku)
   seen.add(sku)
   inputs={key:values[col].strip() for key,col in cols.items() if col is not None and values.get(col,'').strip()}
   inputs.pop('sku',None)
   # A template's auto-generated cost-mode formula must not clear an existing cost.
   if str(cols['cost_mode'])+str(idx) in formulas.get(sheet,set()):inputs.pop('cost_mode',None)
   if any(v in ('#VALUE!','#REF!','#DIV/0!','#N/A','#NUM!','#NAME?') for v in inputs.values()):raise Problem(f'{sheet}第{idx}行包含公式错误，请先修正。')
   refs=[]
   image_col=labels.get(header('图片'))
   for pic in pictures.get(sheet,[]):
    if pic['row'] is not None and pic['row']<=idx<=pic['last_row'] and (image_col is None or pic['col']==col_number(image_col)):
     refs.append(pic['path']);image_paths.add(pic['path'])
   extra={name:values[col].strip() for name,col in labels.items() if values.get(col,'').strip() and name in [header(s) for s in ('淘宝售价','拼多多售价','快递费','创建时间')]}
   rows.append({'sku':sku,'inputs':inputs,'sheet':sheet,'row':idx,'extra':extra})
   products.append({'name':inputs.get('parent') or inputs.get('name') or sku,'images':[],'image_refs':refs,
                    'variants':[{'sku':sku,'image_ids':[],'image_refs':refs}]})
 if not rows:raise Problem('没有识别到SKU资料，请使用包含“SKU编码”列的表格。')
 if len(rows)>10000:raise Problem('每次最多导入10000行，请拆分表格。')
 return {'bulk':True,'rows':rows,'products':products,'image_paths':sorted(image_paths),'issues':issues,
         'filename':filename,'fingerprint':hashlib.sha256(data).hexdigest(),'sheets':len(sheets),'variants':len(rows)}


def plan(con, parsed):
 from app import record,validate,Problem,dumps,amount
 from warehouse_config import normalize_supply
 from material_printing import material_key,clean_inputs
 existing=[record(r) for r in con.execute('SELECT * FROM products ORDER BY id')]
 owners={v['sku']:p for p in existing for v in p['variants'] if v['sku']}
 named_targets={}
 for source in parsed['rows']:
  parent=source['inputs'].get('parent');owner=owners.get(source['sku'])
  if parent and owner:
   if parent in named_targets and named_targets[parent]['id']!=owner['id']:raise Problem('同一产品名称下的SKU原属多个产品，不会自动合并，请分别整理：'+parent,409)
   named_targets[parent]=owner
 basis=hashlib.sha256(dumps([(p['id'],p['revision'],p['archived']) for p in existing]).encode()).hexdigest()
 from shared_rules import read
 rates=read(con);basis=hashlib.sha256((basis+rates['basis']).encode()).hexdigest()
 material_names={material_key(r['material']):r['material'] for r in rates['config']['material_rates']}
 for p in existing:
  for value in [p.get('material'),*[v.get('material') for v in p['variants']]]:
   if value:material_names.setdefault(material_key(value),value)
 targets={};changes=[];parent_claims={};counts={'new_skus':0,'updated_skus':0,'unchanged_skus':0};warnings=list(parsed['issues'])
 for source,pictures in zip(parsed['rows'],parsed['products']):
  sku=source['sku'];inputs=source['inputs'];owner=owners.get(sku)
  if owner and owner['archived']:raise Problem('SKU在回收站中，请先恢复：'+sku,409)
  parent=inputs.get('parent')
  if owner:key=owner['id']
  else:
   if not parent or not inputs.get('name'):raise Problem('新增SKU须填写产品名称和规格名称：'+sku)
   matching=[named_targets[parent]] if parent in named_targets else [p for p in existing if not p['archived'] and p['name']==parent]
   if len(matching)>1:raise Problem('产品名称重复，请先核对：'+parent,409)
   key=matching[0]['id'] if matching else 'new:'+parent;owner=matching[0] if matching else None
  if key not in targets:
   targets[key]={'id':owner['id'] if owner else None,'before':owner,'raw':copy.deepcopy(owner or {'name':parent,'category':source.get('default_category',''),'scene':'','material':'','process':'','description':'','owner':'','status':source.get('default_status','draft'),'tags':[],'images':[],'variants':[],'source':parsed['filename'],'inventory_defaults':{'mode':'待关联','auto_link':False}})}
  target=targets[key];product=target['raw'];before=next((v for v in product['variants'] if v['sku']==sku),None)
  variant=copy.deepcopy(before or {'sku':sku,'name':inputs.get('name',''),'image_ids':[],'inventory_mode':'待关联','stock_code':''})
  original=copy.deepcopy(variant)
  if source.get('extra'):
   variant['source_fields']={**variant.get('source_fields',{}),**source['extra']}
  for field in ('parent','category','status','scene','description','process'):
   if field not in inputs:continue
   value=STATUSES.get(inputs[field],inputs[field]) if field=='status' else inputs[field]
   identity=(key,field)
   if identity in parent_claims and parent_claims[identity]!=value:raise Problem('同一产品的'+LABELS[field]+'填写不一致：'+sku)
   parent_claims[identity]=value;product['name' if field=='parent' else field]=value
   if field=='process':product['process_mode']='manual'
  for field in ('name','erp_code','size','pack_unit','cost_mode','material','supply_mode','note','print_rule_code'):
   if field in inputs:variant[field]=normalize_supply(inputs[field]) if field=='supply_mode' else inputs[field]
  if 'material' in inputs:
   value=unicodedata.normalize('NFKC',inputs['material']);variant['material']=material_names.get(material_key(value),re.sub(r'\s+','',value))
  if 'pack_qty' in inputs:
   q,unit=quantity(inputs['pack_qty'])
   if q is None:raise Problem('每份含量需要正整数，可写70贴：'+sku)
   variant['pack_qty']=q
   if 'pack_unit' not in inputs and unit:variant['pack_unit']=unit
  for field in ('cost','price'):
   if field in inputs:variant[field]=amount(inputs[field],LABELS[field])
  if 'cost' in inputs and 'cost_mode' not in inputs:variant['cost_mode']='固定整份成本'
  if 'cost' in inputs and 'unit_cost' not in inputs:variant['unit_cost']=None
  if 'unit_cost' in inputs:
   unit_cost=amount(inputs['unit_cost'],'单位成本');qty=variant.get('pack_qty')
   if not qty:raise Problem('单位成本需要填写每份数量：'+sku)
   from product_requirements import pack_cost
   try:computed=pack_cost(unit_cost,qty)
   except ValueError as error:raise Problem(str(error))
   if 'cost' in inputs and abs(computed-variant['cost'])>0.00000001:raise Problem('单位成本×每份数量与整份成本不同，请核对：'+sku)
   variant.update(unit_cost=unit_cost,cost=computed,cost_mode='固定整份成本')
  if 'pack_qty' in inputs and variant.get('unit_cost') is not None:
   from product_requirements import pack_cost
   try:variant['cost']=pack_cost(variant['unit_cost'],variant['pack_qty'])
   except ValueError as error:raise Problem(str(error))
  if 'print_cost_source' in inputs:
   sources={'按打印方案自动计算':'auto','自动成本':'auto','自动':'auto','auto':'auto','手动成本':'manual','手动':'manual','manual':'manual'}
   if inputs['print_cost_source'] not in sources:raise Problem('成本来源请填写自动成本或手动成本：'+sku)
   variant['print_cost_source']=sources[inputs['print_cost_source']]
  printing=any(field in inputs for field in ('print_per_sheet','print_laminated','print_cutting'))
  if printing:
   raw={k:variant.get(k) for k in ('print_pricing','print_per_sheet','print_laminated','print_cutting','print_cost_source') if k in variant};raw['print_pricing']='material'
   if 'print_per_sheet' in inputs:raw['print_per_sheet']=inputs['print_per_sheet']
   if 'print_laminated' in inputs:
    if inputs['print_laminated'] not in ('是','否'):raise Problem('是否覆膜请填是或否：'+sku)
    raw['print_laminated']=inputs['print_laminated']=='是'
   if 'print_cutting' in inputs:
    cuts={'不切割':'none','平板切割':'flat','普通模切':'die','平板及模切':'both'}
    if inputs['print_cutting'] not in cuts:raise Problem('切割方式无效：'+sku)
    raw['print_cutting']=cuts[inputs['print_cutting']]
   variant.update(clean_inputs(raw))
  if pictures.get('images'):
   product['images']=list(dict.fromkeys(product['images']+pictures['images']))
   variant['image_ids']=pictures['variants'][0]['image_ids']
  if before and before.get('batch_key'):
   from batch_config import AUTO_FIELDS
   variant['batch_overrides']=sorted(set(before.get('batch_overrides',[]))|{f for f in AUTO_FIELDS if before.get(f)!=variant.get(f)})
  if before:product['variants'][product['variants'].index(before)]=variant
  else:product['variants'].append(variant)
  diffs=[{'field':LABELS.get(k,k),'before':original.get(k),'after':v} for k,v in variant.items() if v!=original.get(k)]
  if not before:counts['new_skus']+=1
  else:counts['updated_skus' if diffs else 'unchanged_skus']+=1
  if diffs:changes.append({'sku':sku,'new':not bool(before),'fields':diffs})
 for target in targets.values():
  before=target['before'];raw=target['raw'];clean=validate(raw,con)
  target['changed']=not before or clean!=validate(before,con)
  if before and target['changed']:
   for field in ('name','category','status','scene','description','process'):
    if clean.get(field)!=before.get(field):changes.append({'sku':'产品：'+before['name'],'new':False,'fields':[{'field':'产品名称' if field=='name' else field,'before':before.get(field),'after':clean.get(field)}]})
 return {'basis':basis,'targets':list(targets.values()),'summary':{**counts,'new_products':sum(not t['id'] for t in targets.values()),
         'updated_products':sum(bool(t['id']) and t['changed'] for t in targets.values()),'changes':changes[:100],
         'total_changes':len(changes),'issues':warnings}}


def commit(con,parsed,expected_basis):
 from app import Problem,save_product
 prepared=plan(con,parsed)
 if prepared['basis']!=expected_basis:raise Problem('产品资料或规则已变化，请重新选择文件预览。没有写入本次修改。',409)
 products=[save_product(con,t['raw'],t['id']) for t in prepared['targets'] if t['changed']]
 return {'products':len(products),'variants':len(parsed['rows']),'images':len({i for p in parsed['products'] for i in p.get('images',[])}),
         **prepared['summary'],'already_imported':False,'bulk':True}
