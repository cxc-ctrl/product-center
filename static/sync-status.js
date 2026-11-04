(function(root){
 'use strict';
 function status(product,synced,attempt,rulesBasis){
  if(attempt?.status==='failed'&&attempt.revision===product.revision)return {key:'failed',label:'同步失败',detail:attempt.error||'请重新同步',at:synced?.at};
  if(!synced)return {key:'new',label:'未同步',detail:'保存后点击“同步到新城仓库”'};
  if(synced.revision!==product.revision||!attempt?.rules_basis||attempt.rules_basis!==rulesBasis)return {key:'pending',label:'待同步更新',detail:'商品资料、图片或打印规则需要重新同步',at:synced.at};
  return {key:'synced',label:'已同步',detail:'商品资料已同步到新城仓库',at:synced.at};
 }
 root.WarehouseSyncStatus={status};if(typeof module!=='undefined')module.exports=root.WarehouseSyncStatus;
})(globalThis);
