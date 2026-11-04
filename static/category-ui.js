'use strict';
const CategoryUI=(()=>{
  const manager=$('#category-dialog');
  let catalog=null,busy=false;
  const setStatus=text=>$('#category-status').textContent=text;
  function renderList(){
    $('#category-list').innerHTML=catalog.categories.map((c,index)=>`<tr><td>${escapeHTML(c.name)}</td><td>${c.count}${c.trash_count?` <small>回收站 ${c.trash_count}</small>`:''}</td><td><button type="button" class="text-button" data-category-rename="${index}" aria-label="修改${escapeHTML(c.name)}">修改名称</button><button type="button" class="text-button danger" data-category-delete="${index}" aria-label="删除${escapeHTML(c.name)}">删除</button></td></tr>`).join('')||'<tr><td colspan="3">还没有产品类型，可以在上方新增。</td></tr>';
    $('#category-unclassified').textContent=`未分类产品 ${catalog.unclassified} 个。类型按在用产品数量排序。`;
  }
  async function open(){
    if(busy)return;
    try{catalog=await api('/api/categories');renderList();setStatus('');$('#category-new-name').value='';if(!manager.open)manager.showModal();}
    catch(error){toast(error.message,true);}
  }
  async function change(payload,button,done){
    if(busy)return;busy=true;utilityBusy=true;button.disabled=true;$('#utility-close').disabled=true;setStatus('正在保存…');
    try{
      const previous=$('#filter-category').value;
      catalog=await api('/api/categories',{method:'POST',body:{...payload,basis:catalog.basis}});
      state.categoryCatalog=catalog;await loadProducts();
      if(previous===payload.name&&payload.action!=='create'){$('#filter-category').value=payload.action==='rename'?payload.new_name:payload.target||'';render();}
      renderList();setStatus(`已保存${catalog.affected?`，同步更新 ${catalog.affected} 个产品`:''}。`);
      done?.();
    }catch(error){
      setStatus(error.message);toast(error.message,true);
      if(error.status===409){try{catalog=await api('/api/categories');renderList();}catch{}}
    }finally{busy=false;utilityBusy=false;button.disabled=false;$('#utility-close').disabled=false;}
  }
  function edit(index,remove=false){
    const item=catalog.categories[index],name=item.name;
    const total=item.count+item.trash_count;
    const content=remove?`<p>删除“${escapeHTML(name)}”后，${total} 个关联产品（含回收站）会移到你选择的类型。</p><label class="field">产品移至<select id="category-target"><option value="">未分类</option>${catalog.categories.filter(c=>c.name!==name).map(c=>`<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('')}</select></label><p class="muted">产品资料、图片和销售规格都会保留。</p>`:`<label class="field">类型名称<input id="category-rename-name" maxlength="80" value="${escapeHTML(name)}"></label><p class="muted">保存后同步更新 ${total} 个关联产品，包含回收站中的产品。</p>`;
    openUtility(remove?'删除产品类型':'修改产品类型',content,[{label:'取消',action:closeUtility},{label:remove?'删除并移动产品':'保存名称',class:'primary',action:button=>void change(remove?{action:'delete',name,target:$('#category-target').value}:{action:'rename',name,new_name:$('#category-rename-name').value.trim()},button,()=>{utilityBusy=false;closeUtility();})}]);
  }
  async function quickAdd(){
    if(busy)return;
    try{catalog=await api('/api/categories');}catch(error){toast(error.message,true);return;}
    openUtility('新增产品类型','<label class="field">类型名称<input id="category-quick-name" maxlength="80" placeholder="例如：香卡"></label>',[{label:'取消',action:closeUtility},{label:'新增并选用',class:'primary',action:button=>{const name=$('#category-quick-name').value.trim();void change({action:'create',name},button,()=>{$('[name="category"]',$('#product-form')).value=name;if(state.draft){state.draft.category=name;setDirty();}utilityBusy=false;closeUtility();toast('产品类型已新增并选用。');});}}]);
  }
  $('#category-manage').addEventListener('click',()=>void open());
  $('#category-close').addEventListener('click',()=>{if(!busy)manager.close();});
  manager.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('#category-add-form').addEventListener('submit',event=>{event.preventDefault();void change({action:'create',name:$('#category-new-name').value.trim()},$('button',event.target),()=>{$('#category-new-name').value='';});});
  $('#category-list').addEventListener('click',event=>{if(busy)return;const rename=event.target.closest('[data-category-rename]'),remove=event.target.closest('[data-category-delete]');if(rename||remove)edit(Number((rename||remove).dataset[rename?'categoryRename':'categoryDelete']),!!remove);});
  $('#category-quick-add').addEventListener('click',()=>void quickAdd());
  return {open};
})();
