(function(root){
 'use strict';
 const AUTO='按实物自动计算',FIXED='固定整份成本';
 const num=v=>v===''||v==null?null:Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
 function mode(v){return v.cost_mode||(v.cost!=null?FIXED:AUTO);}
 function unitCost(s){
  if(s.pricing_mode!=='按总价换算')return num(s.cost);
  const q=num(s.quote_qty),total=num(s.quote_total),each=num(s.units_per_quote)??1;
  return q>0&&each>0&&Number.isInteger(q)&&Number.isInteger(each)&&total!=null&&((s.quote_unit||s.unit)!==s.unit||each===1)?Number((total/(q*each)).toFixed(8)):null;
 }
 function estimate(v,draft,known,shared=null){
  if(['定制订单','工单定制'].includes(v.supply_mode||draft.supply_defaults?.supply_mode))return {cost:null,note:'工单定制按工单核算'};
  if(v.supply_mode==='打印定制'&&v.print_cost_source!=='manual'){
   if(typeof MaterialPrinting==='undefined')return {cost:null,note:'打印配置尚未加载'};
   const configs=shared?[draft.warehouse_config||{},shared]:[...known.filter(p=>!p.archived&&p.id!==draft.id),draft].map(p=>p.warehouse_config||{});
   if(MaterialPrinting.method(v)==='material'){
    const rates=new Map(configs.flatMap(c=>c.material_rates||[]).map(r=>[MaterialPrinting.normalize(r.material),r]));
    return MaterialPrinting.estimate(v,draft.material,[...rates.values()]);
   }
   return MaterialPrinting.legacyEstimate(v,configs.flatMap(c=>c.print_rules||[]).find(r=>r.code===v.print_rule_code));
  }
  if(num(v.unit_cost)!=null){const q=num(v.pack_qty),cost=q>0?Number((num(v.unit_cost)*q).toFixed(8)):null;return {cost,note:'每单位成本 × 每份含量',...(v.supply_mode==='打印定制'&&v.print_per_sheet>0&&q>0?{sheets:Math.ceil(q/v.print_per_sheet)}:{})};}
  if(mode(v)===FIXED&&num(v.cost)!=null)return {cost:num(v.cost),note:'固定整份成本'};
  if(v.supply_mode==='打印定制')return {cost:null,note:'请填写手工成本'};
  if(mode(v)===FIXED)return {cost:num(v.cost),note:'固定整份成本'};
  const configs=shared?[shared]:[...known.filter(p=>p.id!==draft.id&&!p.archived),draft].map(p=>p.warehouse_config||{});
  if(shared&&!draft.id&&!draft.inventory_defaults)configs.push(draft.warehouse_config||{});
  if(draft.inventory_defaults){const local=draft.warehouse_config||{},managed=draft.inventory_auto?.links||{};configs.unshift({links:(local.links||[]).filter(l=>managed[l.sku]===l.stock_code),stocks:local.stocks||[]});}
  const owned=draft.inventory_auto?.links?.[v.sku],links=owned?(draft.warehouse_config?.links||[]).filter(l=>l.sku===v.sku):configs.flatMap(c=>c.links||[]).filter(l=>l.sku===v.sku),stocks=new Map(configs.flatMap(c=>c.stocks||[]).map(s=>[s.code,s]));
  if(!links.length)return {cost:null,note:'仓库成本待补齐'};
  if(links.some(l=>l.mode==='按数字范围'))return {cost:null,note:'按订单实际消耗的版面计算'};
  let total=0;
  for(const l of links){const s=stocks.get(l.stock_code),cost=s?unitCost(s):null,q=num(l.quantity);if(cost==null||!q)return {cost:null,note:'仓库成本资料待补齐'};total+=cost*q;}
  return {cost:Number(total.toFixed(8)),note:'由关联实物自动计算'};
 }
 const api={AUTO,FIXED,mode,unitCost,estimate};root.ProductCost=api;
 if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
