(function(root){
 'use strict';
 const MODES=['现货','打印定制','现货优先（按条件）','定制订单'];
 const aliases={'仓库囤货':'现货','数码打印':'打印定制','工单定制':'定制订单','按条件处理（现货优先）':'现货优先（按条件）','数字贴按条件处理（现货优先）':'现货优先（按条件）'};
 const canonical=value=>aliases[value]||value||'';
 const label=value=>({'现货':'仓库囤货','打印定制':'数码打印','定制订单':'工单定制','现货优先（按条件）':'按条件处理（现货优先）'}[canonical(value)]||value||'待填写');
 function applyAll(product,value){
  const mode=canonical(value);if(mode&&!MODES.includes(mode))throw Error('制作方式无效');
  product.supply_defaults||={};product.supply_defaults.supply_mode=mode;
  for(const row of product.variants||[])row.supply_mode=mode;
 }
 function modes(product){
  const fallback=product.supply_defaults?.supply_mode||'';
  return [...new Set((product.variants?.length?product.variants.map(v=>v.supply_mode||fallback):[fallback]).map(canonical))];
 }
 const matches=(product,filter)=>!filter||modes(product).includes(filter==='pending'?'':canonical(filter));
 const searchText=product=>modes(product).flatMap(mode=>[mode,label(mode),...Object.keys(aliases).filter(a=>aliases[a]===mode)]).join(' ');
 const api={MODES,canonical,label,modes,matches,searchText,applyAll};root.ProductionMethods=api;
 if(typeof module!=='undefined')module.exports=api;
})(globalThis);
