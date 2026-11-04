'use strict';
(()=>{
 const viewer=document.querySelector('#image-viewer'),image=viewer.querySelector('img');
 const previous=viewer.querySelector('[data-image-step="-1"]'),next=viewer.querySelector('[data-image-step="1"]');
 const caption=viewer.querySelector('#image-viewer-caption'),message=viewer.querySelector('[role="status"]');
 let ids=[],index=0,opener=null,title='';
 function render(){
  const text=`${title} · 第 ${index+1} / ${ids.length} 张`;
  caption.textContent=text;image.alt=text;image.hidden=false;message.textContent='正在加载图片…';
  image.src=imageURL(ids[index]);previous.disabled=next.disabled=ids.length<2;
 }
 function step(delta){if(ids.length>1){index=(index+delta+ids.length)%ids.length;render();}}
 function close(){viewer.close();}
 image.addEventListener('load',()=>{message.textContent='';});
 image.addEventListener('error',()=>{image.hidden=true;message.textContent='图片加载失败，请切换图片或关闭后重试。';});
 document.addEventListener('click',event=>{
  const trigger=event.target.closest('[data-view-image]');if(!trigger||!state.draft)return;
  const variant=trigger.hasAttribute('data-view-variant')?state.draft.variants[Number(trigger.dataset.viewVariant)]:null;
  const selected=variant?variant.image_ids:trigger.dataset.viewDesign?state.draft.batch_config?.design_images?.[trigger.dataset.viewDesign]:state.draft.images;
  ids=(selected||[]).filter(id=>imageURL(id));index=ids.indexOf(trigger.dataset.viewImage);if(index<0)return;
  opener=trigger;title=trigger.dataset.viewTitle||state.draft.name||'产品图片';render();viewer.showModal();
 });
 viewer.addEventListener('click',event=>{
  if(event.target===viewer||event.target.id==='image-viewer-stage'||event.target.closest('[data-image-close]'))close();
  const button=event.target.closest('[data-image-step]');if(button)step(Number(button.dataset.imageStep));
 });
 viewer.addEventListener('keydown',event=>{
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();step(event.key==='ArrowLeft'?-1:1);}
 });
 viewer.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();close();});
 viewer.addEventListener('close',()=>{image.removeAttribute('src');message.textContent='';ids=[];if(opener?.isConnected)opener.focus();});
})();
