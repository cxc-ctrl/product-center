'use strict';
const BatchUI=(()=>{
  let cache={},problem='',pending=null,timer=null,initialTimer=null,request=0,initialBusy=false,pendingDesign='',dragging=null,uploadBusy=false,optionalRules=null;
  const panel=()=>$('#batch-builder');
  const field=key=>$('[data-batch-field="'+key+'"]',panel());
  const value=key=>field(key).value;
  const rules=()=>state.draft?(state.draft.batch_config||optionalRules):null;
  function config(){const current=rules();return {...current,name:value('name'),count:Number(value('count')),prefix1:value('prefix1'),prefix2:value('prefix2'),initials:value('initials'),auto_initials:field('auto_initials').checked,quantities:value('quantities'),unit:value('unit')};}
  function blocked(){return !!state.draft?.batch_config&&(!!problem||!!pending||initialBusy);}
  function status(){
    if(!rules())return;
    const errors=BatchModel.issues(state.draft.variants,state.products,state.draft.id);
    $('#batch-message').textContent=initialBusy?'正在生成产品首拼…':problem||pending?.message||errors.slice(0,3).join('；')||`已生成${state.draft.variants.filter(v=>v.batch_key).length}条销售规格。橙色输入框为单独修改，点击旁边的↺可恢复统一规则。`;
    if(optionalRules&&!state.draft.batch_config)$('#batch-message').textContent=(problem||'填写数量规格后自动生成；单款默认1款。')+' 保存前请补齐下方销售规格。';
    $('#batch-message').classList.toggle('batch-warning',!!problem||!!pending||errors.length>0);
    $('#batch-apply-removal').hidden=!pending;
    $('#batch-restore-rows').hidden=!rules().excluded_keys?.length;
    updateSaveButton();
  }
  function remember(){for(const row of state.draft.variants)if(row.batch_key)cache[row.batch_key]=structuredClone(row);}
  function sync(allowRemoval=false){
    if(!rules())return;
    if(initialBusy){status();return;}
    try{
      const cfg=BatchModel.normalize(config());remember();
      const previous=state.draft.variants.filter(row=>row.batch_key||row.name||row.sku||row.size||row.pack_qty||row.image_ids?.length||row.cost!=null||row.price!=null||row.note||row.material||row.erp_code||row.shipping!=null);
      if(state.warehouseSyncs?.[state.draft.id]&&cfg.name!==state.draft.name){const changing=previous.some(v=>v.batch_key&&!(v.batch_overrides||[]).includes('sku'));for(const v of previous)BatchModel.markOverride(v,'sku');if(changing)toast('产品更名已保留原SKU，避免仓库重复建档；换码可直接修改SKU。');}
      const rows=BatchModel.generate(cfg,previous,cache),keys=new Set(rows.map(v=>v.batch_key));
      const removed=state.draft.variants.filter(v=>v.batch_key&&!keys.has(v.batch_key));
      if(removed.length&&!allowRemoval){pending={message:`此次调整将移除${removed.length}条规格；确认后应用，当前已填写内容仍保留。`};problem='';status();return;}
      state.draft.batch_config=cfg;optionalRules=null;state.draft.name=cfg.name;state.draft.variants=rows;if(typeof WarehouseUI!=='undefined')WarehouseUI.inherit(rows);pending=null;problem='';
      $('[name="name"]',$('#product-form')).value=cfg.name;
      for(const key of ['prefix1','prefix2','initials'])field(key).value=cfg[key];
      localStorage.setItem('product-center-batch-prefix',JSON.stringify([cfg.prefix1,cfg.prefix2]));
      setDirty();renderVariants();renderDesigns();WarehouseUI.renderDefaults();status();
    }catch(error){problem=error.message;pending=null;status();}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>sync(),180);}
  function initials(){
    clearTimeout(initialTimer);const version=++request;
    if(!rules()||!field('auto_initials').checked){initialBusy=false;schedule();return;}
    const name=value('name').trim();if(!name){initialBusy=false;field('initials').value='';schedule();return;}
    initialBusy=true;status();
    initialTimer=setTimeout(async()=>{
      try{const result=await api('/api/product-initials',{method:'POST',body:{name}});if(version!==request||!rules()||!field('auto_initials').checked)return;field('initials').value=result.initials;initialBusy=false;if(result.unrecognized){problem='有无法识别的文字，请核对并手动填写产品首拼';status();return;}sync();}
      catch(error){if(version===request){initialBusy=false;problem='首拼生成失败，可手动填写后继续：'+error.message;status();}}
    },220);
  }
  function renderDesigns(){
    if(!rules())return;const cfg=rules();
    $('#batch-designs').innerHTML=Array.from({length:cfg.count},(_,i)=>{
      const design=BatchModel.letter(i),image=cfg.design_images?.[design]?.[0],label=BatchModel.designName(cfg,design);
      return `<div class="batch-style-card"><button type="button" class="batch-design" data-batch-design="${design}" draggable="${!!image}" ${image?`data-view-image="${escapeHTML(image)}" data-view-design="${design}" data-view-title="${escapeHTML(cfg.name+' · '+label)}"`:''} title="${image?'点击放大；可拖到其他款式交换图片':'点击选图或拖入图片'}" aria-label="${escapeHTML(label)}${image?'图片预览':'添加图片'}">${image?previewImage(image,label):icon('image-plus')}</button><label class="batch-style-name">款式 / 口味<input data-design-name="${design}" aria-label="${design}款的款式或口味名称" maxlength="80" placeholder="${design}款" value="${escapeHTML(cfg.design_names?.[design]||'')}"></label><button type="button" class="text-button batch-change-photo" data-edit-design="${design}">${image?'更换图片':'添加图片'}</button></div>`;
    }).join('');
    $('#batch-image-pool').innerHTML=state.draft.images.map((id,index)=>`<div class="batch-pool-card"><button type="button" class="batch-pool-image" data-batch-image="${escapeHTML(id)}" data-view-image="${escapeHTML(id)}" data-view-title="${escapeHTML(cfg.name+' · 图片素材')}" draggable="true" aria-label="图片素材${index+1}预览">${previewImage(id,'图片素材'+(index+1))}<small>图片 ${index+1}</small></button><button type="button" class="text-button" data-assign-image="${escapeHTML(id)}">分配款式</button></div>`).join('');
    $('#batch-pool-wrap').hidden=!state.draft.images.length;
    const ready=!!state.draft.batch_config;
    $$('[data-batch-design],[data-batch-image],[data-design-name],[data-edit-design],[data-assign-image]',panel()).forEach(button=>button.disabled=!ready);
    $('#batch-upload-images').disabled=!ready||uploadBusy||!!state.uploads;
    $('#batch-upload-status').textContent=uploadBusy?'正在压缩并上传图片…':'支持一次选择或拖入多张图片，按顺序填入空款式；每张≤200KB，自动生成缩略图。';
  }
  function load(keepOptional=false){
    clearTimeout(timer);clearTimeout(initialTimer);request++;cache={};problem='';pending=null;initialBusy=false;
    if(!keepOptional)optionalRules=null;
    if(!rules()&&(!state.draft.id||!state.draft.variants.length))optionalRules=defaultRules();
    const cfg=rules();panel().hidden=false;
    if(!cfg){panel().innerHTML='<details class="batch-rule-details"><summary>按款式批量生成（可选）</summary><p class="muted">单款可直接填写下面的规格；多款、多种包装数量可自动生成。保存前须补齐下方销售规格。</p><button type="button" class="button secondary small" id="batch-enable">设置款式与规格</button></details>';return;}
    // Preserve independent prices entered before first-row synchronization existed.
    if(!cfg.row_defaults){cfg.row_defaults={cost:state.draft.variants[0]?.cost??null,price:state.draft.variants[0]?.price??null};for(const row of state.draft.variants)for(const key of ['cost','unit_cost','price'])if((row[key]??null)!==cfg.row_defaults[key])BatchModel.markOverride(row,key);}
    BatchModel.inferDesignNames(cfg,state.draft.variants);remember();
    const input=(key,label,extra='')=>`<label class="field">${label}<input data-batch-field="${key}" value="${escapeHTML(cfg[key]??'')}" ${extra}></label>`;
    panel().innerHTML=`<div class="batch-heading"><div><h3>按款式批量生成</h3><details class="batch-edit-help"><summary>编辑说明</summary><p>逐行修改仅影响当前规格；需要统一修改时，请使用表头输入框或“批量设置”。</p></details></div><button type="button" class="text-button" id="batch-restore-rows" hidden>恢复已移除规格</button></div><details class="batch-rule-details" open><summary>生成规则 <small>点击收起 / 展开</small></summary><div class="batch-rule-grid">${input('name','产品名称 *','maxlength="160" placeholder="例如：万圣节贴纸"')}${input('count','款数 *','type="number" min="1" max="200" step="1"')}${input('quantities','数量规格 *','placeholder="例如：48,240"')}<label class="field">数量单位<select data-batch-field="unit">${['贴','张','枚','个','件','包','卷','套','份'].map(u=>`<option ${cfg.unit===u?'selected':''}>${u}</option>`).join('')}</select></label>${input('prefix1','SKU第一层 *','maxlength="32" placeholder="ALXH"')}${input('prefix2','SKU第二层 *','maxlength="32" placeholder="GY"')}${input('initials','产品大写首拼 *','maxlength="80" placeholder="自动生成，可手动修改"')}</div><label class="batch-auto"><input type="checkbox" data-batch-field="auto_initials" ${cfg.auto_initials!==false?'checked':''}>首拼自动跟随产品名称（多音字可手动修正）</label></details><details class="batch-supply-details"><summary>供货与规则 <small>点击设置</small></summary><section class="product-supply-settings warehouse-section"></section></details><div class="batch-feedback"><span id="batch-message" role="status"></span><button type="button" class="button secondary small" id="batch-apply-removal" hidden>确认调整规格</button></div><div class="batch-upload-zone" id="batch-image-drop"><button type="button" class="button secondary small" id="batch-upload-images">批量上传图片</button><span id="batch-upload-status"></span></div><details id="batch-style-images" class="batch-style-images"><summary>款式名称与图片 <small>填写口味名称、查看大图或换图</small></summary><div class="batch-design-title">填写“百合、枸杞”等名称，本款所有数量规格一起更新；留空使用A款、B款。点击图片放大，换图用下方按钮。</div><div id="batch-designs" class="batch-designs"></div><details id="batch-pool-wrap" class="batch-pool-wrap" hidden><summary>已上传的图片素材（点击放大，可拖到款式）</summary><div id="batch-image-pool" class="batch-image-pool"></div></details></details>`;
    renderDesigns();status();
    if(optionalRules&&cfg.name)initials();
  }
  function defaultRules(){
    let prefixes=['ALXH','GY'];try{const saved=JSON.parse(localStorage.getItem('product-center-batch-prefix'));if(Array.isArray(saved)&&saved.length===2)prefixes=saved;}catch{}
    const name=$('[name="name"]',$('#product-form')).value.trim();
    return {name,count:1,prefix1:prefixes[0],prefix2:prefixes[1],initials:'',auto_initials:true,quantities:[],unit:'贴',size:'',row_defaults:{cost:null,price:null},design_images:{},excluded_keys:[],omit_single_design:true};
  }
  function enable(){
    optionalRules=defaultRules();
    load(true);if(typeof WarehouseUI!=='undefined')WarehouseUI.renderDefaults();initials();field('quantities').focus();
  }
  function applyDesignImage(design,ids){
    state.draft.batch_config.design_images[design]=ids;
    for(const row of state.draft.variants)if(row.batch_key?.split(':')[0]===design){row.image_ids=[...ids];row.batch_overrides=(row.batch_overrides||[]).filter(f=>f!=='image_ids');}
    remember();setDirty();renderVariants();renderDesigns();status();
  }
  async function uploadBatch(files){
    if(!state.draft?.batch_config){toast('先填写数量规格，生成后即可分配款式图片。',true);return;}
    if(!files.length||uploadBusy||state.uploads||state.busy||utilityBusy)return;
    const draft=state.draft;uploadBusy=true;renderDesigns();
    try{
      const ids=await uploadFiles(files);if(state.draft!==draft)return;if(ids?.length)$('#batch-style-images').open=true;
      const cfg=draft.batch_config,before=structuredClone(cfg.design_images||{});
      const remaining=BatchModel.fillImages(cfg,ids||[]);
      for(const [design,images] of Object.entries(cfg.design_images))if(JSON.stringify(before[design])!==JSON.stringify(images))applyDesignImage(design,images);
      if(remaining.length){$('#batch-pool-wrap').open=true;toast('空款式已填满，其余图片保留在素材区，可拖到对应款式。');}
    }catch(error){toast(error.message,true);}finally{uploadBusy=false;if(state.draft===draft)renderDesigns();}
  }
  function clearDrag(){dragging=null;$$('.batch-drop-target',panel()).forEach(node=>node.classList.remove('batch-drop-target'));}
  function moveImage(source,target){
    if(!state.draft?.batch_config||uploadBusy||state.uploads||state.busy||utilityBusy)return;
    const cfg=state.draft.batch_config,valid=Array.from({length:cfg.count},(_,i)=>BatchModel.letter(i));
    if(!valid.includes(target))return;
    if(source.design&&valid.includes(source.design)){
      if(source.design===target)return;
      BatchModel.swapImages(cfg,source.design,target);
      applyDesignImage(source.design,cfg.design_images[source.design]||[]);applyDesignImage(target,cfg.design_images[target]||[]);
    }else if(source.image&&state.draft.images.includes(source.image))applyDesignImage(target,[source.image]);
  }
  function choosePoolImage(id){
    if(!state.draft?.batch_config)return;
    if(uploadBusy||state.uploads||state.busy||utilityBusy)return;
    openUtility('将图片分配到款式',`<p>选择这张图片对应的款式，同款的所有数量规格会一起更新。</p><div class="batch-designs">${Array.from({length:state.draft.batch_config.count},(_,i)=>{const design=BatchModel.letter(i);return `<button type="button" class="batch-design" data-pool-target="${design}">${escapeHTML(BatchModel.designName(state.draft.batch_config,design))}</button>`;}).join('')}</div>`,[{label:'取消',action:closeUtility}]);
    $$('[data-pool-target]',$('#utility-content')).forEach(button=>button.addEventListener('click',()=>{applyDesignImage(button.dataset.poolTarget,[id]);closeUtility();}));
  }
  function setVariantImage(row,ids,share){
    if(row.batch_key&&share){applyDesignImage(row.batch_key.split(':')[0],ids);return;}
    row.image_ids=ids;BatchModel.markOverride(row,'image_ids');setDirty();renderVariants();status();
  }
  function chooseDesign(design){
    if(!state.draft?.batch_config)return;
    if(uploadBusy||state.uploads||state.busy||utilityBusy)return;
    pendingDesign=design;
    const label=BatchModel.designName(state.draft.batch_config,design);
    openUtility('设置'+label+'图片',`<p>选中的图片会应用到${escapeHTML(label)}全部数量规格。也可以直接上传一张新图，自动压缩并生成缩略图。</p><button type="button" id="batch-upload-design" class="button primary small">上传新图片</button><div class="variant-photo-picker">${state.draft.images.map(id=>`<button type="button" data-design-image="${id}" aria-label="选择产品图片">${previewImage(id,'产品图片')}</button>`).join('')}</div>`,[{label:'清除本款图片',action:()=>{applyDesignImage(design,[]);closeUtility();}},{label:'取消',action:closeUtility}]);
    $('#batch-upload-design').addEventListener('click',()=>$('#batch-design-file').click());
    $$('[data-design-image]',$('#utility-content')).forEach(button=>button.addEventListener('click',()=>{applyDesignImage(design,[button.dataset.designImage]);closeUtility();}));
  }
  function rowEdited(row,fieldName,target){
    if(!row.batch_key)return;
    BatchModel.markOverride(row,fieldName);
    const control=target?.parentElement;if(BatchModel.AUTO_FIELDS.includes(fieldName)){control?.classList.toggle('batch-overridden',true);const reset=control?.querySelector('[data-batch-reset]');if(reset)reset.disabled=false;}
    // Header controls own bulk edits; each row remains an explicit override.
    if(BatchModel.SHARED_FIELDS.includes(fieldName))remember();
    if(['pack_qty','pack_unit'].includes(fieldName)){
      remember();state.draft.variants=BatchModel.generate(state.draft.batch_config,state.draft.variants,cache);
      const updated=state.draft.variants.find(v=>v.batch_key===row.batch_key),tr=target.closest('tr');
      for(const key of ['name','sku']){const input=$('[data-field="'+key+'"]',tr);if(input)input.value=updated[key];}
    }
    status();
  }
  function removed(row){if(row.batch_key){cache[row.batch_key]=structuredClone(row);state.draft.batch_config.excluded_keys=[...new Set([...state.draft.batch_config.excluded_keys,row.batch_key])];}}
  function validForSave(){clearTimeout(timer);if(!state.draft?.batch_config){if(optionalRules&&initialBusy&&value('quantities').trim()){toast('请等待首拼生成完成',true);return false;}if(optionalRules&&!initialBusy)sync();if(!state.draft?.batch_config)return true;}sync();if(blocked()){toast(problem||pending?.message||'请等待首拼生成完成',true);return false;}return true;}
  function init(){
    panel().addEventListener('click',event=>{if(event.target.closest('#batch-enable'))enable();});
    panel().addEventListener('input',event=>{const key=event.target.dataset.batchField;if(!key)return;if(key==='name'){$('[name="name"]',$('#product-form')).value=event.target.value;initials();}else if(key==='initials'){field('auto_initials').checked=false;request++;initialBusy=false;schedule();}else if(key==='auto_initials'){initials();}else schedule();setDirty();});
    panel().addEventListener('change',event=>{
      const input=event.target.closest('[data-design-name]');if(!input||!state.draft?.batch_config)return;
      try{BatchModel.renameDesign(state.draft.batch_config,[...state.draft.variants,...Object.values(cache)],input.dataset.designName,input.value);remember();setDirty();renderVariants();renderDesigns();status();}catch(error){toast(error.message,true);}
    });
    panel().addEventListener('click',event=>{const edit=event.target.closest('[data-edit-design]'),assign=event.target.closest('[data-assign-image]'),design=event.target.closest('[data-batch-design]');if(edit){chooseDesign(edit.dataset.editDesign);return;}if(assign){choosePoolImage(assign.dataset.assignImage);return;}if(design){if(!design.hasAttribute('data-view-image'))chooseDesign(design.dataset.batchDesign);return;}if(event.target.closest('#batch-upload-images'))$('#batch-images-file').click();if(event.target.closest('#batch-apply-removal'))sync(true);if(event.target.closest('#batch-restore-rows')){state.draft.batch_config.excluded_keys=[];sync();}});
    $('#batch-images-file').addEventListener('change',event=>{const files=[...event.target.files];event.target.value='';uploadBatch(files);});
    panel().addEventListener('dragstart',event=>{
      if(!state.draft?.batch_config){event.preventDefault();return;}
      const design=event.target.closest('[data-batch-design]'),image=event.target.closest('[data-batch-image]');
      if(uploadBusy||state.uploads||(!design&&!image)){event.preventDefault();return;}
      if(design&&!state.draft.batch_config.design_images[design.dataset.batchDesign]?.length){event.preventDefault();return;}
      dragging=design?{design:design.dataset.batchDesign}:{image:image.dataset.batchImage};event.dataTransfer.setData('application/x-product-center-image',JSON.stringify(dragging));event.dataTransfer.effectAllowed='copyMove';
    });
    panel().addEventListener('dragover',event=>{const target=event.target.closest('[data-batch-design],#batch-image-drop');if(!target||(!dragging&&![...event.dataTransfer.types].includes('Files')))return;event.preventDefault();event.dataTransfer.dropEffect=dragging?.design?'move':'copy';$$('.batch-drop-target',panel()).forEach(node=>node.classList.toggle('batch-drop-target',node===target));target.classList.add('batch-drop-target');});
    panel().addEventListener('dragleave',event=>{const target=event.target.closest('.batch-drop-target');if(target&&!target.contains(event.relatedTarget))target.classList.remove('batch-drop-target');});
    panel().addEventListener('drop',event=>{const target=event.target.closest('[data-batch-design],#batch-image-drop');if(!target)return;event.preventDefault();event.stopPropagation();const source=dragging,files=[...event.dataTransfer.files];clearDrag();if(files.length){uploadBatch(files);return;}if(source&&target.dataset.batchDesign)moveImage(source,target.dataset.batchDesign);});
    panel().addEventListener('dragend',clearDrag);
    $('#variants-body').addEventListener('click',event=>{const reset=event.target.closest('[data-batch-reset]');if(!reset)return;const row=state.draft.variants[Number(reset.dataset.batchReset)];row.batch_overrides=(row.batch_overrides||[]).filter(k=>k!==reset.dataset.resetField);remember();state.draft.variants=BatchModel.generate(state.draft.batch_config,state.draft.variants,cache);setDirty();renderVariants();status();});
    $('#batch-design-file').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';if(!file||utilityBusy)return;utilityBusy=true;$('#utility-close').disabled=true;try{const ids=await uploadFiles([file]);if(ids?.length)applyDesignImage(pendingDesign,[ids[0]]);utilityBusy=false;closeUtility();}catch(error){toast(error.message,true);}finally{utilityBusy=false;$('#utility-close').disabled=false;}});
  }
  function nameChanged(name){if(!rules())return;field('name').value=name;initials();}
  function imageRemoved(id){if(!state.draft?.batch_config)return;for(const key of Object.keys(state.draft.batch_config.design_images))state.draft.batch_config.design_images[key]=state.draft.batch_config.design_images[key].filter(i=>i!==id);for(const row of Object.values(cache))row.image_ids=(row.image_ids||[]).filter(i=>i!==id);renderDesigns();}
  return {load,init,blocked,status,sync,rowEdited,removed,validForSave,setVariantImage,nameChanged,imageRemoved,renderDesigns};
})();
