(function(root){
 'use strict';
 function status(product,synced,attempt,rulesBasis){
  if(attempt?.status==='failed'&&attempt.revision===product.revision)return {key:'failed',label:'同步失败',detail:attempt.error||'请重新同步',at:synced?.at};
  if(!synced)return {key:'new',label:'未同步',detail:'保存后点击“同步到新城仓库”'};
  if(synced.revision!==product.revision||!attempt?.rules_basis||attempt.rules_basis!==rulesBasis)return {key:'pending',label:'待同步更新',detail:'商品资料、图片或打印规则需要重新同步',at:synced.at};
  if(attempt?.error)return {key:'pending',label:'成本待核对',detail:attempt.error,at:synced.at};
  return {key:'synced',label:'已同步',detail:'商品资料已同步到新城仓库',at:synced.at};
 }
 root.WarehouseSyncStatus={status};if(typeof module!=='undefined')module.exports=root.WarehouseSyncStatus;
})(globalThis);

const WarehouseCostSummary={html(done){
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const costs=done.physical_costs||{},changes=costs.changes||[],same=costs.unchanged||[],skips=costs.skipped||[];
 return '<p>销售 SKU 已同步 '+esc(done.skus||0)+' 个；实物单价更新 '+changes.length+' 项，单价一致 '+same.length+' 项。</p>'+
 changes.map(c=>'<p>'+esc(c.name)+'（'+esc(c.code)+'）：'+esc(c.old??'未设置')+' → '+esc(c.next)+' 元/'+esc(c.unit)+'</p>').join('')+
 (skips.length?'<details'+(skips.some(r=>r.warning)?' open':'')+'><summary>未更新实物单价 '+skips.length+' 项：查看原因</summary>'+skips.map(r=>'<p>'+esc(r.code)+'：'+esc(r.reason)+(r.values?.length?'（'+r.values.map(v=>esc(v.sku)+'：'+esc(v.unit_cost)+' 元/'+esc(r.unit)).join('；')+'）':'')+'</p>').join('')+'</details>':'')+
 '<p>实际库存数量、盘点时间和库存关联保持不变。</p>';
}};
