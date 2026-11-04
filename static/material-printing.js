(function(root){
 'use strict';
 const keys=['print_pricing','print_per_sheet','print_laminated','print_cutting','print_cost_source','print_sheet_cost'];
 const automatic=(v,p={})=>(v.supply_mode||p.supply_defaults?.supply_mode)==='打印定制'&&v.print_cost_source!=='manual';
 function setCostSource(v,source){
  if(!['auto','manual'].includes(source))throw Error('成本来源无效');
  if(source==='manual'&&automatic(v)){v.cost=v.manual_cost??v.cost??null;v.unit_cost=v.manual_unit_cost??null;v.cost_mode='固定整份成本';}
  if(source==='auto'&&!automatic(v)){v.manual_cost=v.cost??null;v.manual_unit_cost=v.unit_cost??null;}
  v.print_cost_source=source;
 }
 function legacyEstimate(v,rule){
  const q=Number(v.pack_qty),per=Number(rule?.per_sheet);
  if(!q||!per||rule?.enabled!=='是')return {cost:null,note:'原有打印规则待补齐'};
  const sheets=Math.ceil(q/per),values=['print_cost','lamination_cost','flat_cut_cost','die_cut_cost'].map(k=>rule[k]);
  if(values.some(x=>x==null||x===''||!Number.isFinite(Number(x))||Number(x)<0))return {cost:null,sheets,note:'打印规则费用待补齐'};
  const sheetCost=values.reduce((sum,x)=>sum+Number(x),0);
  return {cost:Number((sheets*sheetCost).toFixed(8)),sheets,sheetCost,note:`${sheets}张 × ${sheetCost}元/张`};
 }
 const normalize=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
 const method=v=>v.print_pricing||(v.print_rule_code?'legacy':'material');
 function estimate(v,material,rates,quantity=1){
  if(method(v)!=='material')return {cost:null,note:'沿用原有打印规则'};
  const per=Number(v.print_per_sheet),q=Number(v.pack_qty),mat=v.material||material;
  if(!Number.isInteger(per)||per<1)return {cost:null,note:'每张可拼数量待填写'};
  if(!Number.isInteger(q)||q<1||!Number.isInteger(quantity)||quantity<1)return {cost:null,note:'每份含量待填写'};
  const sheets=Math.ceil(q*quantity/per),explanation=`${q*quantity}个 ÷ 每张${per}个，向上取整${sheets}张`;
  const pending=note=>({cost:null,sheets,note:explanation+'；'+note});
  if(!mat)return pending('请选择打印材质');
  if(v.print_sheet_cost!==''&&v.print_sheet_cost!=null){
   const sheetCost=Number(v.print_sheet_cost);
   if(!Number.isFinite(sheetCost)||sheetCost<0)return pending('单张大纸完整成本无效');
   return {cost:Number((sheets*sheetCost).toFixed(8)),sheets,sheetCost,note:`${q*quantity}个 ÷ 每张${per}个，向上取整${sheets}张 × ${sheetCost}元/张（完整成本）`};
  }
  const matches=(rates||[]).filter(r=>normalize(r.material)===normalize(mat));
  if(matches.length!==1)return pending('该材质费用待配置');
  const rate=matches[0];if(rate.enabled!=='是')return pending('该材质已停用');
  const fields=['print_cost',...(v.print_laminated?['lamination_cost']:[]),...(['flat','both'].includes(v.print_cutting)?['flat_cut_cost']:[]),...(['die','both'].includes(v.print_cutting)?['die_cut_cost']:[])];
  if(fields.some(f=>rate[f]===''||rate[f]==null||!Number.isFinite(Number(rate[f]))||Number(rate[f])<0))return pending('所选材质或加工费用待补齐');
  const sheetCost=fields.reduce((s,f)=>s+Number(rate[f]),0);
  return {cost:Number((sheets*sheetCost).toFixed(8)),sheets,sheetCost,note:`${q*quantity}个 ÷ 每张${per}个，向上取整${sheets}张 × ${sheetCost}元/张`};
 }
 const api={keys,normalize,method,estimate,automatic,setCostSource,legacyEstimate};root.MaterialPrinting=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
