'use strict';
const SceneUI=(()=>{
  const manager=$('#scene-dialog');
  let catalog=null,busy=false;
  const setStatus=text=>$('#scene-status').textContent=text;
  function renderList(){
    $('#scene-list').innerHTML=catalog.scenes.map((c,index)=>`<tr><td>${escapeHTML(c.name)}</td><td>${c.count}${c.trash_count?` <small>回收站 ${c.trash_count}</small>`:''}</td><td><button type="button" class="text-button" data-scene-rename="${index}" aria-label="修改${escapeHTML(c.name)}">修改名称</button><button type="button" class="text-button danger" data-scene-delete="${index}" aria-label="删除${escapeHTML(c.name)}">删除</button></td></tr>`).join('')||'<tr><td colspan="3">还没有使用场景，可以在上方新增。</td></tr>';
    $('#scene-unclassified').textContent=`未设置产品 ${catalog.unclassified} 个。场景按在用产品数量排序。`;
  }
  async function open(){
    if(busy)return;
    try{catalog=await api('/api/scenes');renderList();setStatus('');$('#scene-new-name').value='';if(!manager.open)manager.showModal();}
    catch(error){toast(error.message,true);}
  }
  async function change(payload,button,done){
    if(busy)return;busy=true;utilityBusy=true;button.disabled=true;$('#utility-close').disabled=true;setStatus('正在保存…');
    try{
      const previous=$('#filter-scene').value,chosen=$('[name=scene]',$('#product-form')).value,editing=state.draft;
      catalog=await api('/api/scenes',{method:'POST',body:{...payload,basis:catalog.basis}});
      state.sceneCatalog=catalog;
      if(editing){
        const update=catalog.updates?.find(u=>u.id===editing.id);
        if(update&&editing.revision===update.previous_revision)editing.revision=update.revision;
        const selected=chosen===payload.name&&payload.action!=='create'?(payload.action==='rename'?payload.new_name:payload.target||''):chosen;
        editing.scene=selected;
        await loadProducts();
        const select=$('[name=scene]',$('#product-form'));
        if(![...select.options].some(o=>o.value===selected))select.add(new Option(selected,selected));
        select.value=selected;
      }else await loadProducts();
      if(previous===payload.name&&payload.action!=='create'){$('#filter-scene').value=payload.action==='rename'?payload.new_name:payload.target||'';render();}
      renderList();setStatus(`已保存${catalog.affected?`，同步更新 ${catalog.affected} 个产品`:''}。`);
      done?.();
    }catch(error){
      setStatus(error.message);toast(error.message,true);
      if(error.status===409){try{catalog=await api('/api/scenes');renderList();}catch{}}
    }finally{busy=false;utilityBusy=false;button.disabled=false;$('#utility-close').disabled=false;}
  }
  function edit(index,remove=false){
    const item=catalog.scenes[index],name=item.name;
    const total=item.count+item.trash_count;
    const content=remove?`<p>删除“${escapeHTML(name)}”后，${total} 个关联产品（含回收站）会移到你选择的场景。</p><label class="field">产品移至<select id="scene-target"><option value="">未设置</option>${catalog.scenes.filter(c=>c.name!==name).map(c=>`<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('')}</select></label><p class="muted">产品资料、图片和销售规格都会保留。</p>`:`<label class="field">场景名称<input id="scene-rename-name" maxlength="80" value="${escapeHTML(name)}"></label><p class="muted">保存后同步更新 ${total} 个关联产品，包含回收站中的产品。</p>`;
    openUtility(remove?'删除使用场景':'修改使用场景',content,[{label:'取消',action:closeUtility},{label:remove?'删除并移动产品':'保存名称',class:'primary',action:button=>void change(remove?{action:'delete',name,target:$('#scene-target').value}:{action:'rename',name,new_name:$('#scene-rename-name').value.trim()},button,()=>{utilityBusy=false;closeUtility();})}]);
  }
  async function quickAdd(){
    if(busy)return;
    try{catalog=await api('/api/scenes');}catch(error){toast(error.message,true);return;}
    openUtility('新增使用场景','<label class="field">场景名称<input id="scene-quick-name" maxlength="80" placeholder="例如：节日包装"></label>',[{label:'取消',action:closeUtility},{label:'新增并选用',class:'primary',action:button=>{const name=$('#scene-quick-name').value.trim();void change({action:'create',name},button,()=>{$('[name="scene"]',$('#product-form')).value=name;if(state.draft){state.draft.scene=name;setDirty();}utilityBusy=false;closeUtility();toast('使用场景已新增并选用。');});}}]);
  }
  $('#scene-manage').addEventListener('click',()=>void open());
  $('#scene-filter-manage').addEventListener('click',()=>void open());
  $('#scene-close').addEventListener('click',()=>{if(!busy)manager.close();});
  manager.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('#scene-add-form').addEventListener('submit',event=>{event.preventDefault();void change({action:'create',name:$('#scene-new-name').value.trim()},$('button',event.target),()=>{$('#scene-new-name').value='';});});
  $('#scene-list').addEventListener('click',event=>{if(busy)return;const rename=event.target.closest('[data-scene-rename]'),remove=event.target.closest('[data-scene-delete]');if(rename||remove)edit(Number((rename||remove).dataset[rename?'sceneRename':'sceneDelete']),!!remove);});
  $('#scene-quick-add').addEventListener('click',()=>void quickAdd());
  return {open};
})();
