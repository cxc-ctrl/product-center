(function(root){
 'use strict';
 const MODES=['独立库存','共用库存','待关联','仅统计销售'];
 const labels={'独立库存':'独立成品','共用库存':'共用实物','待关联':'待关联实物','仅统计销售':'仅统计销售'};
 const printing=v=>['打印定制','定制订单'].includes(v?.supply_mode);
 function shortHash(text){let value=2166136261;for(const char of text)value=Math.imul(value^char.codePointAt(0),16777619)>>>0;return value.toString(16).toUpperCase().padStart(8,'0');}
 function apply(p){
  const d=p.inventory_defaults;if(!d)return p;
  const previous=p.inventory_auto||{},groups={...(previous.groups||{})},managed={},manual=new Set(previous.manual||[]),cfg=p.warehouse_config||={stocks:[],links:[],print_rules:[],digit_conditions:[]};
  cfg.links=(cfg.links||[]).filter(r=>previous.links?.[r.sku]!==r.stock_code);
  const stocks=new Map((cfg.stocks||[]).map(r=>[r.code,r])),used=new Set([...Object.values(groups),...stocks.keys()]);
  for(const v of p.variants){
   v.inventory_mode||=d.mode;
   if(v.inventory_mode!=='共用库存'){v.stock_code='';manual.delete(v.sku);}
   if(printing(v)){if(previous.links?.[v.sku])managed[v.sku]=previous.links[v.sku];continue;}
   if(v.supply_mode==='现货优先（按条件）'){if(v.stock_code===previous.links?.[v.sku])v.stock_code='';continue;}
   if(v.inventory_mode==='独立库存')v.cost_mode='固定整份成本';
   if(v.inventory_mode!=='共用库存'||!d.auto_link||!v.sku||!v.pack_qty||!v.pack_unit)continue;
   let code=v.stock_code;
   if(!code)manual.delete(v.sku);
   if(!code||code===previous.links?.[v.sku]&&!manual.has(v.sku)){
    const base=v.sku.replace(new RegExp('[-_]'+v.pack_qty+'$'),''),size=String(v.size||'').replace(/\s+/gu,'').replace(/[×*]/g,'x').toLowerCase(),material=v.material||p.material||'',signature=JSON.stringify([base,size,material,v.pack_unit]);
    code=groups[signature];
    if(!code){const stem=base.slice(0,135);code=stem+'-STOCK';if(used.has(code))code=stem+'-'+shortHash(signature)+'-STOCK';groups[signature]=code;used.add(code);}
    const design=v.batch_key?.split(':')[0],name=p.name+(design&&(p.batch_config?.count||1)>1?'-'+design+'款':'');
    if(!stocks.has(code))stocks.set(code,{code,name,size:v.size||'',unit:v.pack_unit,kind:'普通实物',cost:null,pricing_mode:'直接填单价',note:'产品中心自动建立；实际数量由仓库盘点。'});else stocks.get(code).name=name;
    v.stock_code=code;
   }else manual.add(v.sku);
   managed[v.sku]=code;cfg.links=cfg.links.filter(r=>r.sku!==v.sku);cfg.links.push({sku:v.sku,stock_code:code,mode:'固定数量',quantity:v.pack_qty,note:'按每份包装含量自动关联'});
  }
  cfg.stocks=[...stocks.values()];const excluded=new Set(p.variants.filter(v=>printing(v)||['独立库存','仅统计销售'].includes(v.inventory_mode)).map(v=>v.sku));cfg.links=cfg.links.filter(r=>!excluded.has(r.sku));
  if(!p.id){const active=new Set(cfg.links.map(l=>l.stock_code)),automatic=new Set(Object.values(groups));cfg.stocks=cfg.stocks.filter(s=>!automatic.has(s.code)||active.has(s.code));}
  const codes=new Set(p.variants.map(v=>v.sku));p.inventory_auto={groups,links:managed,manual:[...manual].filter(s=>codes.has(s)).sort()};return p;
 }
 function summary(p){const linked=(p.warehouse_config?.links||[]).filter(l=>p.inventory_auto?.links[l.sku]===l.stock_code);return {stocks:new Set(linked.map(l=>l.stock_code)).size,links:linked.length,direct:p.variants.filter(v=>!printing(v)&&v.inventory_mode==='独立库存').length};}
 const api={MODES,labels,printing,apply,summary,shortHash};root.InventoryModel=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
