const SavedSync=(()=>{
 async function run(id){
  state.busy=true;utilityBusy=true;updateSaveButton();
  openUtility('已保存，正在同步到现货仓库','<p>正在核对商品、图片和制作规则，请稍候。</p>');
  $('#utility-close').disabled=true;
  let preview,done,completed=false,failure=null;
  try{
   preview=await api('/api/warehouse-sync/preview',{method:'POST',body:{ids:[id]}});
   $('#utility-content').innerHTML='<p>商品已保存，正在同步 '+preview.skus+' 个销售 SKU 及图片，请稍候。</p>';
   done=await api('/api/warehouse-sync/commit',{method:'POST',body:{token:preview.token}});
   completed=true;
  }catch(error){failure=error;}
  try{await loadProducts();}catch(error){toast('商品已保存；列表刷新失败，请刷新页面查看最新状态。',true);}
  state.busy=false;utilityBusy=false;$('#utility-close').disabled=false;updateSaveButton();
  if(failure){
   openUtility('商品已保存，同步未完成','<p>'+escapeHTML(failure.message)+'</p><p>产品中心的资料已保存。重试将重新核对仓库资料，已同步的 SKU 不会重复建档。</p>',[
    {label:'稍后处理',action:closeUtility},
    {label:'返回商品',action:()=>{closeUtility();openProduct(id);}},
    {label:'重试同步',class:'primary',action:()=>void run(id)}
   ]);
  }
  if(completed){
   const issues=preview.association_issues||[];
   const warnings=(done.physical_costs?.skipped||[]).some(r=>r.warning);
   openUtility(warnings?'已保存并同步，部分成本需核对':'已保存并同步到现货仓库',WarehouseCostSummary.html(done)+(issues.length?'<p>以下规格需核对库存关联：</p>'+issues.map(r=>'<p>'+escapeHTML(r.codes.join('、'))+'：'+escapeHTML(r.reason)+'</p>').join(''):''),[{label:'知道了',action:closeUtility}]);
  }
  return completed;
 }
 return {run};
})();
