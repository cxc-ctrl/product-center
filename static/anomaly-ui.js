'use strict';
const AnomalyUI=(()=>{
 const manager=$('#anomaly-dialog');
 let preferences={revision:0,extra_cost:2.8,low_margin_percent:20,low_profit_amount:2,ignored:[]},rows=[],tab='active',page=1,busy=false;
 const reasons={below_cost:'售价低于商品成本',loss:'加模拟费用后亏损',low_margin:'预估利润率偏低'};
 const money=value=>value==null?'—':value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:8});
 const rate=value=>value==null?'—':value.toFixed(2)+'%';
 function calculate(){rows=ProductAnomalies.collect(state.products,preferences,(p,v)=>ProductCost.estimate(v,p,state.products,state.warehouseRules?.config).cost);}
 function refresh(value){
  if(value)preferences=value;
  calculate();
  $('#stat-anomalies').textContent=rows.filter(r=>!r.ignored&&reasons[r.type]).length.toLocaleString();
  if(manager.open)render();
 }
 function selected(){
  const search=$('#anomaly-search').value.trim().toLowerCase(),filter=$('#anomaly-filter').value;
  return rows.filter(r=>(tab==='ignored'?r.ignored:!r.ignored&&!!reasons[r.type])&&(!filter||r.type===filter)&&[r.product.name,r.variant.name,r.variant.sku,ProductionMethods.label(r.variant.supply_mode)].join(' ').toLowerCase().includes(search))
   .sort((a,b)=>(a.profit??Infinity)-(b.profit??Infinity)||a.variant.sku.localeCompare(b.variant.sku,'zh-CN'));
 }
 function render(){
  const filtered=selected(),pages=Math.max(1,Math.ceil(filtered.length/30));page=Math.min(page,pages);
  $('#anomaly-active-tab').textContent=`待处理（${rows.filter(r=>!r.ignored&&reasons[r.type]).length}）`;
  $('#anomaly-ignored-tab').textContent=`已忽略（${rows.filter(r=>r.ignored).length}）`;
  $('#anomaly-active-tab').setAttribute('aria-selected',String(tab==='active'));
  $('#anomaly-ignored-tab').setAttribute('aria-selected',String(tab==='ignored'));
  const missing=rows.filter(r=>r.type==='missing').length;
  $('#anomaly-missing').textContent=missing?`${missing}个SKU缺少可计算的成本或售价，未纳入利润判断。`:'';
  $('#anomaly-rows').innerHTML=filtered.slice((page-1)*30,page*30).map(r=>{
   const p=r.product,v=r.variant,image=(v.image_ids||[])[0]||p.images[0];
   return `<tr><td><div class="anomaly-product">${image&&imageURL(image)?previewImage(image,p.name):''}<div><strong>${escapeHTML(p.name)}</strong><span>${escapeHTML(v.name)}</span><code>${escapeHTML(v.sku)}</code></div></div></td><td>${escapeHTML(ProductionMethods.label(v.supply_mode))}</td><td>${escapeHTML(v.pack_qty??'—')}${escapeHTML(v.pack_unit||'')}/份</td><td class="anomaly-number">${money(r.cost)}</td><td class="anomaly-number">${money(r.total)}</td><td class="anomaly-number">${money(r.price)}</td><td class="anomaly-number ${r.profit<0?'anomaly-loss':''}"><strong>${money(r.profit)}</strong><small>${rate(r.margin)}</small></td><td><span class="anomaly-reason ${r.type==='normal'?'normal':''}">${escapeHTML(r.label)}</span>${r.ignored_at?`<small>忽略于${new Date(r.ignored_at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}</small>`:''}</td><td><div class="anomaly-actions"><button type="button" class="text-button" data-anomaly-edit="${escapeHTML(r.id)}">编辑商品</button><button type="button" class="text-button" data-anomaly-action="${r.ignored?'restore':'ignore'}" data-anomaly-key="${escapeHTML(r.id)}" ${busy?'disabled':''}>${r.ignored?'恢复检查':'忽略'}</button></div></td></tr>`;
  }).join('')||`<tr><td colspan="9" class="anomaly-empty">${tab==='ignored'?'暂无匹配的已忽略商品':'暂无匹配的商品异常'}</td></tr>`;
  $('#anomaly-page').textContent=`共${filtered.length}个SKU · 第${page}/${pages}页`;
  $('#anomaly-prev').disabled=page<=1;$('#anomaly-next').disabled=page>=pages;
 }
 function open(){
  tab='active';page=1;$('#anomaly-search').value='';$('#anomaly-filter').value='';
  $('#anomaly-threshold').value=preferences.low_margin_percent;$('#anomaly-amount').value=preferences.low_profit_amount;$('#anomaly-status').textContent='';
  calculate();render();manager.showModal();
 }
 async function change(payload){
  if(busy)return;busy=true;
  $('#anomaly-status').textContent='正在保存…';
  $$('#anomaly-dialog button').forEach(button=>button.disabled=true);
  $('#anomaly-threshold').disabled=true;
  $('#anomaly-amount').disabled=true;
  try{
   preferences=await api('/api/product-anomalies',{method:'POST',body:{...payload,revision:preferences.revision}});
   $('#anomaly-status').textContent=payload.action==='settings'?'阈值已保存。':payload.action==='ignore'?'已忽略，可在“已忽略”中恢复。':'已恢复检查；符合异常条件时重新显示在待处理中。';
   refresh();
  }catch(error){
   $('#anomaly-status').textContent=error.message;
   if(error.status===409){try{preferences=await api('/api/product-anomalies');refresh();}catch{}}
  }finally{
   busy=false;$$('#anomaly-dialog button').forEach(button=>button.disabled=false);$('#anomaly-threshold').disabled=false;$('#anomaly-amount').disabled=false;render();
  }
 }
 document.addEventListener('DOMContentLoaded',()=>{
  $('#anomaly-open').addEventListener('click',open);
  $('#anomaly-close').addEventListener('click',()=>{if(!busy)manager.close();});
  manager.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('#anomaly-active-tab').addEventListener('click',()=>{tab='active';page=1;$('#anomaly-filter').value='';render();});
  $('#anomaly-ignored-tab').addEventListener('click',()=>{tab='ignored';page=1;$('#anomaly-filter').value='';render();});
  for(const [selector,event] of [['#anomaly-search','input'],['#anomaly-filter','change']])$(selector).addEventListener(event,()=>{page=1;render();});
  $('#anomaly-prev').addEventListener('click',()=>{page--;render();});$('#anomaly-next').addEventListener('click',()=>{page++;render();});
  $('#anomaly-settings').addEventListener('submit',event=>{event.preventDefault();if(!event.target.reportValidity())return;void change({action:'settings',low_margin_percent:Number($('#anomaly-threshold').value),low_profit_amount:Number($('#anomaly-amount').value)});});
  $('#anomaly-rows').addEventListener('click',event=>{
   const edit=event.target.closest('[data-anomaly-edit]'),action=event.target.closest('[data-anomaly-action]');
   if(busy)return;
   if(edit){const row=rows.find(r=>r.id===edit.dataset.anomalyEdit);if(!row)return;manager.close();openProduct(row.product.id);setEditorTab('variants');return;}
   if(action){const row=rows.find(r=>r.id===action.dataset.anomalyKey);if(row)void change({action:action.dataset.anomalyAction,product_id:row.product.id,sku:row.variant.sku});}
  });
 });
 return {refresh};
})();
