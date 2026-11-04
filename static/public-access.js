(function(root){
 'use strict';
 let editable=false;
 const originals=new Map();
 const actions='#create-button,#import-button,#warehouse-sync-selected,#empty-trash,#backup-button,[data-restore],[data-purge],[data-anomaly-action]';
 const productAllowed='.close-dialog,[data-tab],[data-view-image],#export-product-rules,#product-open-rules,#scene-manage,[data-login]';
 function locked(el){
  if(!(el instanceof Element))return false;
  if(el.matches(actions))return true;
  if(el.closest('#variant-tools')&&!el.matches('#variant-undo'))return false;
  if(el.closest('#product-form')){
   if(el.matches('button'))return !el.matches(productAllowed);
   return el.matches('input,textarea,select')&&!el.matches('#warehouse-sku');
  }
  if(el.closest('#rules-page'))return el.matches('input,textarea,select,button')&&!el.matches('#rules-search,#rules-reload,[data-rules-tab]');
  if(el.closest('#category-dialog,#scene-dialog'))return el.matches('input,textarea,select,button')&&!el.matches('#category-close,#scene-close');
  return !!el.closest('#anomaly-settings');
 }
 function apply(){
  if(editable)return;
  document.querySelectorAll('input,textarea,select,button').forEach(el=>{
   if(!locked(el))return;
   const property=el.matches('textarea,input:not([type=checkbox]):not([type=file]):not([type=radio])')?'readOnly':'disabled';
   if(!originals.has(el))originals.set(el,{property,value:el[property]});
   if(!el[property])el[property]=true;
   el.classList.add('guest-readonly');
  });
  for(const el of originals.keys())if(!el.isConnected)originals.delete(el);
 }
 function set(value){
  editable=!!value;
  document.documentElement.classList.toggle('guest-mode',!editable);
  if(editable){for(const [el,old] of originals){if(el.isConnected){el[old.property]=old.value;el.classList.remove('guest-readonly');}}originals.clear();}
  apply();
 }
 function block(event){
  if(editable)return;
  const el=event.target.closest?.('button,input,select,textarea');
  if(el&&locked(el)&&!(event.type==='click'&&el.matches('input[readonly],textarea[readonly]'))||event.type==='submit'&&event.target.matches('#product-form,#anomaly-settings,#category-add-form,#scene-add-form')){
   event.preventDefault();event.stopImmediatePropagation();
  }
 }
 // Capture before editor handlers, including dynamic rows and drag/drop uploads.
 for(const name of ['click','input','change','beforeinput','submit'])document.addEventListener(name,block,true);
 for(const name of ['drop','dragover','dragstart','paste'])document.addEventListener(name,event=>{
  if(name==='paste'&&event.target.closest?.('#variant-tools'))return;
  if(!editable&&event.target.closest?.('#product-form,#rules-page,#category-dialog,#scene-dialog')){event.preventDefault();event.stopImmediatePropagation();}
 },true);
 const observer=new MutationObserver(apply);
 observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly']});
 root.ProductAccess={set,apply,locked,get canEdit(){return editable;}};
})(globalThis);
