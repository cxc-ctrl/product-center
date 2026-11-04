(function(root){
 'use strict';
 const key=(productId,sku)=>JSON.stringify([productId,sku]);
 const number=value=>value==null||value===''||typeof value==='boolean'?null:Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
 function assess(cost,price,threshold=20,extra=2.8,profitThreshold=2){
  cost=number(cost);price=number(price);
  if(cost==null||price==null)return {type:'missing',label:'成本或售价待补齐',cost,price,profit:null,margin:null,total:null};
  const total=Number((cost+extra).toFixed(8)),profit=Number((price-total).toFixed(8)),margin=price>0?profit/price*100:null;
  const type=price<cost-1e-8?'below_cost':profit<-1e-8?'loss':margin!=null&&margin<threshold-1e-8&&profit<profitThreshold-1e-8?'low_margin':'normal';
  return {cost,price,total,profit,margin,type,label:{below_cost:'售价低于商品成本',loss:'加模拟费用后亏损',low_margin:'预估利润率偏低',normal:'当前无异常'}[type]};
 }
 function collect(products,preferences,costOf){
  const ignored=new Map((preferences.ignored||[]).map(item=>[key(item.product_id,item.sku),item]));
  return products.filter(p=>!p.archived).flatMap(product=>product.variants.filter(variant=>!['定制订单','工单定制'].includes(variant.supply_mode||product.supply_defaults?.supply_mode)).map(variant=>{
   const id=key(product.id,variant.sku),estimate=costOf(product,variant);
   return {id,product,variant,...assess(estimate,variant.price,preferences.low_margin_percent,2.8,preferences.low_profit_amount),ignored:ignored.has(id),ignored_at:ignored.get(id)?.at};
  }));
 }
 const api={key,assess,collect};root.ProductAnomalies=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
