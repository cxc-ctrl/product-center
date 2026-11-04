"""Authenticated, previewed product metadata sync to the fixed warehouse endpoint."""
import hashlib
import json
import os
import secrets
import time
import urllib.request
import urllib.error
from warehouse_config import bundle
PLANS={}

def remote(body):
 from app import Problem
 url=os.environ.get('PRODUCT_CENTER_WAREHOUSE_URL','http://122.51.235.103:8003').rstrip('/')
 # This is a server-admin setting, never taken from a browser request.
 request=urllib.request.Request(url+'/api/warehouse',data=json.dumps(body,ensure_ascii=False).encode(),headers={'Content-Type':'application/json','Origin':url,'X-Warehouse-Sync-Token':os.environ.get('WAREHOUSE_SYNC_TOKEN','')},method='POST')
 try:
  with urllib.request.urlopen(request,timeout=45) as r:return json.load(r)
 except urllib.error.HTTPError as e:
  try:message=json.load(e).get('error','仓库拒绝同步')
  except Exception:message='仓库暂时无法接收同步'
  raise Problem(message,409)
 except (urllib.error.URLError,TimeoutError):raise Problem('连接新城仓库失败，请稍后重新预览。已保存的商品资料不受影响。',502)

def chunks(body):
 for at in range(0,len(body['variants']),20):
  variants=body['variants'][at:at+20];skus={v['sku'] for v in variants};cfg=body['warehouse_config'];links=[r for r in cfg['links'] if r['sku'] in skus];stockids={r['stock_code'] for r in links};conditionids={v.get('digit_condition_code') for v in variants};conditions=[c for c in cfg['digit_conditions'] if c['code'] in conditionids];ruleids={v.get('print_rule_code') for v in variants}|{c['print_rule_code'] for c in conditions}
  yield {'version':body.get('version',2),**({'digit_rules_owner':'warehouse'} if body.get('digit_rules_owner')=='warehouse' else {}),'variants':variants,'warehouse_config':{'stocks':[r for r in cfg['stocks'] if r['code'] in stockids],'links':links,'print_rules':[r for r in cfg['print_rules'] if r['code'] in ruleids],'digit_conditions':conditions}}

def handle_sync(handler,path,raw):
 from app import db,LOCK,Problem
 try:
  return _handle_sync(handler,path,raw)
 except (Problem,ValueError) as error:
  plan=PLANS.get(raw.get('token'),{})
  with LOCK,db() as con:
   ids=raw.get('ids',[]) if path.endswith('/preview') else [p[0] for p in plan.get('products',[])]
   for pid in ids if isinstance(ids,list) else []:
    if not isinstance(pid,str):continue
    row=con.execute('SELECT revision FROM products WHERE id=? AND archived=0',(pid,)).fetchone()
    if row:
     con.execute("INSERT INTO warehouse_sync_states VALUES(?,?,'failed',?,?,'') ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,error=excluded.error,at=excluded.at,rules_basis=''",(pid,row['revision'],str(getattr(error,'message',error))[:500],int(time.time()*1000)))
  raise


def _handle_sync(handler,path,raw):
 from app import Problem,db,record,LOCK
 if path.endswith('/preview'):
  with db() as con:
   products=handler.selected_products(con,raw);known=[record(r) for r in con.execute('SELECT * FROM products WHERE archived=0')]
   from shared_rules import read
   shared=read(con)
  if shared['issues']:raise Problem(shared['issues'][0])
  try:body=bundle(products,known,shared['config'])
  except ValueError as e:raise Problem(str(e))
  from warehouse_media import attach
  with LOCK,db() as con:attach(con,body,products)
  from warehouse_config import config
  selected_ids={p['id'] for p in products};used={key:{r['code'] for r in body['warehouse_config'][key]} for key in ['stocks','print_rules','digit_conditions']}
  dependencies=[(p['id'],p['revision']) for p in known if p['id'] not in selected_ids and any(any(r['code'] in used[key] for r in config(p.get('warehouse_config'))[key]) for key in used)]
  batch=[];summary={'new_skus':0,'existing_skus':0,'stocks':0,'rules':0};cost_changes={};auto_stocks=set();auto_linked=set();association_issues=[]
  for part in chunks(body):
   preview=remote({'action':'product_center_sync_preview','request_id':secrets.token_hex(16),'bundle':part})['syncPreview']
   batch.append({'body':part,'basis':preview['basis']})
   auto_stocks.update(preview.get('auto_stocks',[]));auto_linked.update(preview.get('auto_linked_skus',[]));association_issues.extend(preview.get('association_issues',[]))
   for key in summary:summary[key]+=preview[key]
   for change in preview.get('cost_changes',[]):cost_changes[change['code']]=change
  token=secrets.token_urlsafe(24)
  with LOCK:
   for key in list(PLANS):
    if time.time()-PLANS[key]['at']>1200:del PLANS[key]
   if len(PLANS)>=10:raise Problem('同步预览过多，请稍后重试',429)
   PLANS[token]={'at':time.time(),'products':[(p['id'],p['revision']) for p in products],'dependencies':dependencies,'rules_basis':shared['basis'],'batches':batch,'next':0,'busy':False}
  summary['stocks']=len({s['code'] for s in body['warehouse_config']['stocks']}|auto_stocks);summary['rules']=len(body['warehouse_config']['print_rules'])
  return {'token':token,**summary,'auto_stocks':len(auto_stocks),'auto_linked_skus':len(auto_linked),'association_issues':association_issues,'products':len(products),'skus':len(body['variants']),'image_skus':sum(bool(v.get('images')) for v in body['variants']),'cost_changes':list(cost_changes.values()),'direct_skus':sum(v.get('inventory_mode')=='独立库存' for v in body['variants']),'shared_skus':sum(v.get('inventory_mode')=='共用库存' for v in body['variants'])}
 if not path.endswith('/commit'):raise Problem('同步地址不存在',404)
 token=raw.get('token')
 with LOCK:
  plan=PLANS.get(token)
  if not plan or plan.get('kind')=='costs' or time.time()-plan['at']>1200:raise Problem('预览已过期，请重新预览',409)
  if plan['busy']:raise Problem('正在同步，请等待完成',409)
  plan['busy']=True
 try:
  with db() as con:
   from shared_rules import read
   if read(con)['basis']!=plan['rules_basis']:raise Problem('仓储打印规则已更新，请重新预览同步。',409)
   for pid,revision in plan['products']+plan.get('dependencies',[]):
    r=con.execute('SELECT revision,archived FROM products WHERE id=?',(pid,)).fetchone()
    if not r or r['archived'] or r['revision']!=revision:raise Problem('商品资料已更新，请重新预览。此前已同步批次保持不变。',409)
  while plan['next']<len(plan['batches']):
   with db() as con:
    if read(con)['basis']!=plan['rules_basis']:raise Problem('仓储打印规则已更新，请重新预览剩余批次。',409)
    for pid,revision in plan['products']+plan.get('dependencies',[]):
     current=con.execute('SELECT revision,archived FROM products WHERE id=?',(pid,)).fetchone()
     if not current or current['archived'] or current['revision']!=revision:raise Problem('商品资料已更新，请重新预览剩余批次。此前已同步批次保持不变。',409)
   i=plan['next'];part=plan['batches'][i]
   # Preview again before each batch because earlier batches may share physical stock.
   if i:part['basis']=remote({'action':'product_center_sync_preview','request_id':secrets.token_hex(16),'bundle':part['body']})['syncPreview']['basis']
   payload={'action':'product_center_sync','request_id':'pc-sync-'+hashlib.sha256((token+':'+str(i)).encode()).hexdigest(),'bundle':part['body'],'expected_basis':part['basis']}
   remote(payload);plan['next']+=1
  with LOCK,db() as con:
   for pid,revision in plan['products']:
    now=int(time.time()*1000)
    con.execute('INSERT INTO warehouse_syncs VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,at=excluded.at',(pid,revision,now))
    con.execute("INSERT INTO warehouse_sync_states VALUES(?,?,'synced','',?,?) ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,error='',at=excluded.at,rules_basis=excluded.rules_basis",(pid,revision,now,plan['rules_basis']))
  return {'ok':True,'products':len(plan['products']),'completed_batches':plan['next']}
 finally:plan['busy']=False


def handle_costs(handler,path,raw):
 from app import Problem,db,record,LOCK,save_product
 if path.endswith('/preview'):
  with db() as con:
   selected=handler.selected_products(con,raw)
   known=[record(r) for r in con.execute('SELECT * FROM products WHERE archived=0')]
   from shared_rules import read, stored
   shared=read(con);central_codes={r['code'] for r in stored(con)['config'].get('stocks',[])}
  from warehouse_config import config
  codes=set()
  for p in selected:
   c=config(p.get('warehouse_config'));codes.update(r['code'] for r in c['stocks']);codes.update(r['stock_code'] for r in c['links'])
  skus={v['sku'] for p in selected for v in p['variants']}
  codes.update(r['stock_code'] for r in shared['config']['links'] if r['sku'] in skus)
  if not codes:raise Problem('这些产品尚未建立实物资料或库存关联。')
  rows=[];bases=[]
  ordered=sorted(codes)
  for at in range(0,len(ordered),2000):
   part=ordered[at:at+2000];answer=remote({'action':'product_center_costs','request_id':secrets.token_hex(16),'codes':part})['stockCosts'];rows.extend(answer['rows']);bases.append((part,answer['basis']))
  remote_rows={r['code']:r for r in rows};changes=[];owners={}
  for p in known:
   for index,s in enumerate(config(p.get('warehouse_config'))['stocks']):
    if s['code'] in central_codes:continue
    r=remote_rows.get(s['code'])
    if not r or r['cost'] is None or r['cost']==s['cost']:continue
    if r['unit']!=s['unit']:raise Problem('库存单位不同，请先核对：'+s['code'],409)
    changes.append({'product_id':p['id'],'index':index,'code':s['code'],'name':s['name'],'unit':s['unit'],'old':s['cost'],'next':r['cost']});owners[p['id']]=p['revision']
  for index,s in enumerate(shared['config']['stocks']):
   r=remote_rows.get(s['code'])
   if s['code'] not in central_codes or not r or r['cost'] is None or r['cost']==s['cost']:continue
   if r['unit']!=s['unit']:raise Problem('库存单位不同，请先核对：'+s['code'],409)
   changes.append({'product_id':'@rules','index':index,'code':s['code'],'name':s['name'],'unit':s['unit'],'old':s['cost'],'next':r['cost']})
  token=secrets.token_urlsafe(24)
  with LOCK:
   for key in list(PLANS):
    if time.time()-PLANS[key]['at']>1200:del PLANS[key]
   if len(PLANS)>=10:raise Problem('预览过多，请稍后重试',429)
   PLANS[token]={'kind':'costs','at':time.time(),'changes':changes,'owners':owners,'bases':bases,'rules_basis':shared['basis'],'busy':False}
  return {'token':token,'changes':changes,'missing':sum(code not in remote_rows or remote_rows[code]['cost'] is None for code in codes)}
 if not path.endswith('/commit'):raise Problem('成本核对地址不存在',404)
 token=raw.get('token')
 with LOCK:
  plan=PLANS.get(token)
  if not plan or plan.get('kind')!='costs' or time.time()-plan['at']>1200:raise Problem('成本预览已过期，请重新预览',409)
  if plan['busy']:raise Problem('正在保存，请稍候',409)
  plan['busy']=True
 try:
  for codes,basis in plan['bases']:
   if remote({'action':'product_center_costs','request_id':secrets.token_hex(16),'codes':codes})['stockCosts']['basis']!=basis:raise Problem('仓库成本或盘点记录已变化，请重新预览。',409)
  with LOCK,db() as con:
   from shared_rules import read, save
   shared=read(con)
   if shared['basis']!=plan['rules_basis']:raise Problem('仓储规则已变化，请重新预览成本。',409)
   products={}
   for pid,revision in plan['owners'].items():
    r=con.execute('SELECT * FROM products WHERE id=?',(pid,)).fetchone()
    if not r or r['archived'] or r['revision']!=revision:raise Problem('前端资料已更新，请重新预览成本。',409)
    products[pid]=record(r)
   for change in plan['changes']:
    row=shared['config']['stocks'][change['index']] if change['product_id']=='@rules' else products[change['product_id']]['warehouse_config']['stocks'][change['index']]
    if row['code']!=change['code']:raise Problem('实物资料已变化，请重新预览。',409)
    row.update(cost=change['next'],pricing_mode='直接填单价',quote_qty=None,quote_total=None,units_per_quote=None,quote_unit=row['unit'])
   for pid,p in products.items():save_product(con,p,pid)
   if any(c['product_id']=='@rules' for c in plan['changes']):save(con,{'revision':shared['revision'],'basis':read(con)['basis'],'config':shared['config']})
  with LOCK:PLANS.pop(token,None)
  return {'ok':True,'count':len(plan['changes'])}
 finally:plan['busy']=False
