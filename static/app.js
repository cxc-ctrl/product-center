'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  box:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 5 8-5M12 12.5V21M8 5.3l8 5"/>',
  grid:'<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="14" width="6.5" height="6.5" rx="1.2"/>',
  edit:'<path d="m15 4 5 5M4 20l4.5-1 12-12a2 2 0 0 0-5-5l-12 12Z"/><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  'image-plus':'<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m18 21-6-9L3 21M18 2v8M14 6h8"/>',
  archive:'<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8Zm-10 10 10 5 10-5M2 18l10 5 10-5"/>',
  warehouse:'<path d="m3 9 9-6 9 6v12H3Z"/><path d="M8 21V11h8v10M8 15h8M8 18h8"/>',
  external:'<path d="M14 3h7v7M21 3l-9 9M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  list:'<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4M12 17h.01"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout:'<path d="M9 3H4v18h5M9 12h12m-5-5 5 5-5 5"/>',
  'chevron-left':'<path d="m15 5-7 7 7 7"/>',
  'chevron-right':'<path d="m9 5 7 7-7 7"/>',
  'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  x:'<path d="m6 6 12 12M6 18 18 6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  sliders:'<path d="M4 7h4m5 0h7M4 17h9m5 0h2"/><circle cx="10.5" cy="7" r="2.5"/><circle cx="15.5" cy="17" r="2.5"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  file:'<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8M8 16h6"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
};
function icon(name){return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.box}</svg>`;}
function fillIcons(root=document){$$('[data-icon]',root).forEach(el=>{el.innerHTML=icon(el.dataset.icon);});}
const statusLabels = {draft:'草稿',ready:'资料就绪',published:'已上架',paused:'已停用'};
const IMAGE_LIMIT_BYTES = 200000;
const PRODUCT_IMAGE_LIMIT = 200;
const state = {products:[],images:{},view:'all',page:1,pageSize:30,selected:new Set(),display:localStorage.getItem('product-center-view') || 'grid',draft:null,dirty:false,uploads:0,uploadErrors:[],busy:false,local:true};
const dialog = $('#product-dialog');
const utility = $('#utility-dialog');
let utilityBusy = false;

async function api(path,options={}){
  const method=(options.method||'GET').toUpperCase();
  if(method!=='GET'&&!ProductAccess.canEdit&&!['/api/login','/api/logout','/api/export/warehouse','/api/export/website'].includes(path))throw new Error('当前为只读浏览，请登录后再进行管理操作。');
  const headers={...(options.headers||{})};
  if(options.body && !(options.body instanceof File) && !(options.body instanceof Blob) && typeof options.body!=='string'){
    headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);
  }
  const res=await fetch(path,{credentials:'same-origin',...options,headers});
  if(!res.ok){
    let value;try{value=await res.json();}catch{value={error:'操作未完成，请稍后重试。'};}
    const err=Object.assign(new Error(value.error),value,{status:res.status});
    if(res.status===401 && path!=='/api/login'){setAccess(false);updateSaveButton();showLogin();}
    throw err;
  }
  return options.download?res:res.json();
}
function toast(message,error=false){
  const region=$('#toast-region');(utility.open?utility:dialog.open?dialog:document.body).append(region);
  const el=document.createElement('div');el.className='toast'+(error?' error':'');el.innerHTML=icon(error?'info':'check')+`<span>${escapeHTML(message)}</span>`;region.append(el);setTimeout(()=>el.remove(),error?6500:3800);
}
function setAccess(editable){
  ProductAccess.set(editable);
  $('#logout-button').hidden=state.local||!ProductAccess.canEdit;
  $('#login-button').hidden=ProductAccess.canEdit;
  $('#access-label').textContent=ProductAccess.canEdit?'已登录 · 可编辑':'未登录 · 只读浏览';
}
function showLogin(){const login=$('#login-screen');$('#login-error').textContent='';if(!login.open)login.showModal();}
function setConnection(text){$('#connection-label').textContent=text;}
function unique(values){return [...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));}
function updateChoices(){
  const active=state.products.filter(p=>!p.archived);
  const categories=unique(state.categoryCatalog?state.categoryCatalog.categories.map(c=>c.name):active.map(p=>p.category));
  const categorySelect=$('[name="category"]',$('#product-form')),chosen=categorySelect.value;
  categorySelect.innerHTML='<option value="">未分类</option>'+unique([...categories,chosen]).map(name=>`<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');categorySelect.value=chosen;
  const scenes=state.sceneCatalog?state.sceneCatalog.scenes.map(s=>s.name):unique(active.map(p=>p.scene));
  const sceneSelect=$('[name="scene"]',$('#product-form')),sceneChosen=sceneSelect.value;
  sceneSelect.innerHTML='<option value="">未设置</option>'+unique([...scenes,sceneChosen]).map(name=>`<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');sceneSelect.value=sceneChosen;
  const materials=unique([...active.flatMap(p=>[p.material,...p.variants.map(v=>v.material)]),...(state.warehouseRules?.config.material_rates||[]).map(r=>r.material)]);
  for(const [selector,values,label] of [['#filter-category',categories,'全部类型'],['#filter-scene',scenes,'全部场景'],['#filter-material',materials,'全部材质']]){
    const el=$(selector),old=el.value;el.innerHTML=`<option value="">${label}</option>`+values.map(v=>`<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('');el.value=values.includes(old)?old:'';
  }
  for(const [selector,values] of [['#material-options',materials]]) $(selector).innerHTML=values.map(v=>`<option value="${escapeHTML(v)}"></option>`).join('');
  $('#category-nav').innerHTML=categories.sort((a,b)=>active.filter(p=>p.category===b).length-active.filter(p=>p.category===a).length||a.localeCompare(b,'zh-CN')).map(category=>`<button class="category-nav-item ${$('#filter-category').value===category?'active':''}" data-category="${escapeHTML(category)}"><span class="category-dot"></span>${escapeHTML(category)}<span>${active.filter(p=>p.category===category).length}</span></button>`).join('');
  const noimage=active.filter(p=>!p.images.length).length;
  $('#stat-products').textContent=active.length;$('#stat-skus').textContent=active.reduce((n,p)=>n+p.variants.length,0).toLocaleString();$('#stat-noimage').textContent=noimage;
  $('#nav-all').textContent=active.length;$('#nav-draft').textContent=active.filter(p=>p.status==='draft').length;$('#nav-noimage').textContent=noimage;$('#nav-trash').textContent=state.products.filter(p=>p.archived).length;
}
async function loadProducts(){
  try{const data=await api('/api/products');state.products=data.products;state.categoryCatalog=data.category_catalog;state.sceneCatalog=data.scene_catalog;state.images=data.images;state.warehouseSyncs=data.warehouse_syncs||{};state.warehouseSyncStates=data.warehouse_sync_states||{};state.warehouseRules=data.warehouse_rules;state.selected=new Set([...state.selected].filter(id=>state.products.some(p=>p.id===id && !p.archived)));updateChoices();if(typeof AnomalyUI!=='undefined')AnomalyUI.refresh(data.anomaly_settings);render();setConnection(state.local?'本机数据已连接':'资料已连接');}
  catch(err){setConnection('连接失败');toast(err.message,true);$('#catalog').innerHTML='';$('#result-count').textContent='读取失败';$('#empty-state').hidden=false;$('#empty-state h2').textContent='暂时无法读取资料';$('#empty-state p').textContent='检查服务是否正在运行，然后刷新网页。';}
}
function filtered(){
  const terms=$('#search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const category=$('#filter-category').value,scene=$('#filter-scene').value,material=$('#filter-material').value,status=$('#filter-status').value,production=$('#filter-production').value;
  let products=state.products.filter(p=>{
    if(p.archived!==(state.view==='trash'))return false;
    if(state.view==='draft'&&p.status!=='draft')return false;
    if(state.view==='noimage'&&p.images.length)return false;
    if(category&&p.category!==category || scene&&p.scene!==scene || status&&p.status!==status)return false;
    if(material&&p.material!==material&&!p.variants.some(v=>v.material===material))return false;
    if(!ProductionMethods.matches(p,production))return false;
    const syncFilter=$('#filter-sync')?.value||'';if(syncFilter&&syncStatus(p).key!==syncFilter)return false;
    const searchable=[p.name,p.category,p.scene,p.material,p.process,p.owner,p.description,...p.tags,ProductionMethods.searchText(p),...p.variants.flatMap(v=>[v.sku,v.name,v.erp_code,v.size,v.material,v.stock_code,v.pack_qty,v.pack_unit])].join(' ').toLowerCase();
    return terms.every(t=>searchable.includes(t));
  });
  const order=$('#sort-order').value;
  products.sort(order==='name'?(a,b)=>a.name.localeCompare(b.name,'zh-CN'):order==='created'?(a,b)=>b.created_at-a.created_at:order==='sku'?(a,b)=>b.variants.length-a.variants.length:(a,b)=>b.updated_at-a.updated_at||a.name.localeCompare(b.name,'zh-CN'));
  return products;
}
function imageURL(id,thumbnail=false){const image=state.images[id];return thumbnail?(image?.thumbnail_url||image?.url||''):(image?.url||'');}
function previewImage(id,alt='',eager=false){return `<img src="${imageURL(id,true)}" data-full-src="${imageURL(id)}" alt="${escapeHTML(alt)}" width="384" height="384" loading="${eager?'eager':'lazy'}" decoding="async">`;}
function placeholder(){return `<div class="image-placeholder"><span class="placeholder-icon">${icon('image')}</span><small>${ProductAccess.canEdit?'添加产品图片':'暂无产品图片'}</small></div>`;}
function syncStatus(product){return WarehouseSyncStatus.status(product,state.warehouseSyncs?.[product.id],state.warehouseSyncStates?.[product.id],state.warehouseRules?.basis);}
function syncStatusHTML(product){if(product.archived)return '';const result=syncStatus(product),at=result.at?new Date(result.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';return `<div class="catalog-sync-status" title="${escapeHTML(result.detail)}"><span class="sync-badge ${result.key}">${result.label}</span>${at?`<small>上次同步 ${at}</small>`:''}</div>`;}
function render(){
  const products=filtered(),pages=Math.max(1,Math.ceil(products.length/state.pageSize));state.page=Math.min(Math.max(1,state.page),pages);
  const visible=products.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
  $('#result-count').textContent=`${state.view==='trash'?'已删除':'共'} ${products.length} 个产品`;
  $('#selected-count').textContent=state.selected.size?`已选 ${state.selected.size} 个`:'';
  const selectable=products.filter(p=>!p.archived);$('#select-all').checked=selectable.length>0&&selectable.every(p=>state.selected.has(p.id));$('#select-all').indeterminate=selectable.some(p=>state.selected.has(p.id))&&!$('#select-all').checked;$('#select-all').disabled=state.view==='trash';
  $('#pagination-summary').textContent=products.length?`显示 ${(state.page-1)*state.pageSize+1}–${Math.min(state.page*state.pageSize,products.length)} 项，共 ${products.length} 项`:'共 0 项';
  $('#page-number').textContent=`${state.page} / ${pages}`;$('#page-prev').disabled=state.page<=1;$('#page-next').disabled=state.page>=pages;
  $('#page-first').disabled=state.page<=1;$('#page-last').disabled=state.page>=pages;
  $('#page-jump').innerHTML=Array.from({length:pages},(_,i)=>`<option value="${i+1}" ${state.page===i+1?'selected':''}>第 ${i+1} 页</option>`).join('');
  $('#grid-view').classList.toggle('active',state.display==='grid');$('#table-view').classList.toggle('active',state.display==='table');
  $('#empty-state').hidden=products.length>0;
  $('#empty-state h2').textContent=state.view==='trash'?'回收站为空':'还没有匹配的产品';$('#empty-state p').textContent=state.view==='trash'?'删除后的产品暂存在这里，可以恢复或彻底删除。':'试试其他关键词，或调整上方筛选条件。';
  $('#trash-toolbar').hidden=state.view!=='trash';$('#empty-trash').disabled=!state.products.some(p=>p.archived);$('#export-button').disabled=state.view==='trash';
  $('#catalog').className=state.display==='grid'?'product-grid':'catalog-table-wrap';
  if(state.display==='grid'){
    $('#catalog').innerHTML=visible.map((p,index)=>`<article class="product-card ${state.selected.has(p.id)?'selected':''}">
      <button class="card-image tone-${index%4}" data-open="${p.id}" data-upload="${p.images.length?'':'1'}" aria-label="${p.images.length?'打开':'上传图片：'}${escapeHTML(p.name)}">${p.images.length&&imageURL(p.images[0])?previewImage(p.images[0],p.name,index<10):placeholder()}</button>
      <div class="card-body"><div class="card-select-row"><div class="card-category">${escapeHTML(p.category||'未分类')}${p.scene?`<span>/</span>${escapeHTML(p.scene)}`:''}</div>${!p.archived?`<label class="card-checkbox"><input type="checkbox" data-select="${p.id}" ${state.selected.has(p.id)?'checked':''} aria-label="选择${escapeHTML(p.name)}"><span>选择</span></label>`:''}</div><button class="card-title" title="${escapeHTML(p.name)}" data-open="${p.id}">${escapeHTML(p.name)}</button>
      <div class="card-meta">${[EditorFields.materials(p).join('、'),...p.tags.slice(0,1)].filter(Boolean).map(t=>`<span class="tag" title="${escapeHTML(t)}">${escapeHTML(t)}</span>`).join('')||'<span class="tag neutral">待补产品资料</span>'}</div>
      ${syncStatusHTML(p)}<div class="card-bottom"><span><span class="sku-number">${p.variants.length}</span> 个销售规格</span>${p.archived?`<div class="trash-card-actions"><button class="text-button" data-restore="${p.id}">恢复</button><button class="text-button danger" data-purge="${p.id}">彻底删除</button></div>`:`<button class="icon-button" data-open="${p.id}" title="编辑产品" aria-label="编辑${escapeHTML(p.name)}">${icon('edit')}</button>`}</div></div></article>`).join('');
  }else{
    $('#catalog').innerHTML=visible.length?`<table class="catalog-table"><thead><tr><th></th><th>产品名称</th><th>类型 / 场景</th><th>材质</th><th>SKU规格</th><th>状态</th><th>仓库同步</th><th>最近更新</th><th></th></tr></thead><tbody>${visible.map(p=>`<tr><td>${!p.archived?`<input type="checkbox" data-select="${p.id}" ${state.selected.has(p.id)?'checked':''} aria-label="选择${escapeHTML(p.name)}">`:''}</td><td><button class="table-product" data-open="${p.id}"><span class="table-thumb">${p.images.length?previewImage(p.images[0]):icon('image')}</span>${escapeHTML(p.name)}</button></td><td>${escapeHTML(p.category||'未分类')} / ${escapeHTML(p.scene||'—')}</td><td>${escapeHTML(EditorFields.materials(p).join('、')||'—')}</td><td>${p.variants.length}</td><td><span class="status-pill ${p.status}">${p.archived?'已删除':statusLabels[p.status]}</span></td><td>${syncStatusHTML(p)}</td><td>${new Date(p.updated_at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}</td><td><button class="icon-button" data-open="${p.id}" aria-label="打开${escapeHTML(p.name)}">${icon('edit')}</button></td></tr>`).join('')}</tbody></table>`:'';
  }
  $$('#main-nav .nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  $$('#category-nav button').forEach(b=>b.classList.toggle('active',b.dataset.category===$('#filter-category').value));
}
function resetFilters(){for(const id of ['search','filter-category','filter-scene','filter-material','filter-status','filter-production','filter-sync'])$('#'+id).value='';state.page=1;state.selected.clear();render();}
function setView(view){if(typeof RulesUI!=='undefined'&&!RulesUI.leave(()=>setView(view)))return;$('#rules-page').hidden=true;$('#product-library').hidden=false;if(typeof RulesUI!=='undefined')RulesUI.nav();state.view=view;resetFilters();$('#sidebar').classList.remove('open');const titles={all:'让每一款产品，都有自己的档案。',draft:'先记录想法，再完善产品。',noimage:'给产品添一张好认的图片。',trash:'回收站'};$('#page-title').textContent=titles[view]||titles.all;}

function blankVariant(){return {sku:'',name:'',erp_code:'',size:'',pack_qty:null,pack_unit:'',cost:null,cost_mode:'按实物自动计算',price:null,shipping:null,material:'',inventory_mode:'',stock_code:'',note:'',image_ids:[]};}
function blankProduct(){return {name:'',category:'',scene:'',material:'',process:'',tags:[],owner:'',description:'',status:'draft',source:'',images:[],variants:[],supply_defaults:{supply_mode:'现货',print_rule_code:'',digit_condition_code:'',print_pricing:'material',print_per_sheet:null,print_laminated:false,print_cutting:'none'},inventory_defaults:{mode:'待关联',auto_link:false}};}
function setDirty(){if(!ProductAccess.canEdit)return;state.dirty=true;$('#save-status').textContent='有未保存的修改';VariantTools.schedule();}
function openProduct(id=null,upload=false,copyData=null){
  if(!ProductAccess.canEdit&&!id){showLogin();return;}
  const existing=id?state.products.find(p=>p.id===id):null;
  if(existing?.archived&&ProductAccess.canEdit){restoreDialog(existing);return;}
  state.draft=structuredClone(copyData||existing||blankProduct());if(!existing&&!state.draft.inventory_defaults)state.draft.inventory_defaults={mode:'待关联',auto_link:false};state.dirty=false;state.uploads=0;state.uploadErrors=[];VariantTools.begin(state.draft);$('#bulk-unit-cost').value='';$$('[data-bulk-field]').forEach(input=>input.value='');
  $('#editor-title').textContent=existing?existing.name:copyData?.batch_config?'新建产品':copyData?'复制产品':'新建产品';$('#editor-kicker').textContent=existing?'PRODUCT DETAILS':'NEW PRODUCT';$('#editor-source').textContent=state.draft.source?'来源：'+state.draft.source:'';
  for(const name of ['name','category','scene','material','process','owner','description','status'])$(`[name="${name}"]`,$('#product-form')).value=state.draft[name]||'';
  $('[name="tags"]',$('#product-form')).value=state.draft.tags.join('，');
  $('#delete-product').hidden=!state.draft.id;$('#duplicate-product').hidden=!state.draft.id;$('#save-status').textContent=state.draft.id?'更新于 '+new Date(state.draft.updated_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'请补齐销售规格后保存';
  BatchUI.load();WarehouseUI.load();renderImages();renderVariants();VariantTools.capture();setEditorTab('basic');updateSaveButton();ProductAccess.apply();if(!dialog.open)dialog.showModal();
  setTimeout(()=>{if(upload)$('#upload-zone').focus();else $('[name="name"]',$('#product-form')).focus();},80);
}
function readFields(){
  const form=$('#product-form');for(const name of ['name','category','scene','material','process','owner','description','status'])state.draft[name]=$(`[name="${name}"]`,form).value.trim();
  state.draft.tags=unique($('[name="tags"]',form).value.split(/[,，、;；\n]+/).map(t=>t.trim()).filter(Boolean));
}
function setEditorTab(tab){
  $('#pane-basic').hidden=tab!=='basic';$('#pane-variants').hidden=tab!=='variants';$('#pane-warehouse').hidden=tab!=='warehouse';if(tab==='warehouse')WarehouseUI.render();if(tab==='variants')renderVariants();
  $$('.editor-tabs [data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-selected',String(b.dataset.tab===tab));});
}
function updateSaveButton(){
  $('#save-product').disabled=!ProductAccess.canEdit||state.uploads>0||state.busy||state.uploadErrors.length>0||(typeof BatchUI!=='undefined'&&BatchUI.blocked());
  $('#save-product').innerHTML=icon(state.busy?'upload':'check')+(state.busy?'正在保存…':state.uploads?'图片上传中…':'保存产品');
}
function renderImages(){
  if(!state.draft)return;const images=state.draft.images;
  $('#image-count').textContent=images.length+' / '+PRODUCT_IMAGE_LIMIT;$('#cover-preview').classList.toggle('has-image',images.length>0);
  $('#cover-preview').innerHTML=images.length?`<button type="button" class="large-image-link image-view-button" data-view-image="${images[0]}" title="点击查看大图" aria-label="放大产品封面"><img src="${imageURL(images[0])}" alt="产品封面"></button><span class="cover-label">产品封面</span><span class="large-image-hint">点击查看大图</span>`:`<div class="image-placeholder">${icon('image')}<small>还没有上传图片</small></div>`;
  $('#image-gallery').innerHTML=images.map((id,index)=>`<div class="gallery-item"><button type="button" class="image-view-button" data-view-image="${id}" title="查看大图" aria-label="放大第${index+1}张图片">${previewImage(id,'产品图片 '+(index+1))}</button><div class="image-actions"><button type="button" data-cover="${id}" class="${index===0?'cover':''}" title="设为封面" aria-label="将第${index+1}张设为封面">${icon('star')}</button><button type="button" data-remove-image="${id}" title="移除此图片" aria-label="移除第${index+1}张图片">${icon('x')}</button></div></div>`).join('');
  renderUploadProgress();
}
function renderUploadProgress(){
  const el=$('#upload-progress');el.innerHTML=(state.uploads?`<div>正在上传 ${state.uploads} 张图片，请稍候…</div>`:'')+state.uploadErrors.map((entry,index)=>`<div class="upload-error">${escapeHTML(entry.name)}：${escapeHTML(entry.error)} <button type="button" data-retry="${index}">重试</button><button type="button" data-dismiss-upload="${index}">移除</button></div>`).join('');updateSaveButton();
}
function canvasBlob(canvas,type,quality){return new Promise(resolve=>canvas.toBlob(resolve,type,quality));}
async function prepareUploadImage(file){
  // Keep small originals and animation intact; the server validates the same cap.
  if(file.size<=IMAGE_LIMIT_BYTES||file.type==='image/gif'||file.type==='image/webp'||typeof createImageBitmap!=='function')return file;
  const source=await createImageBitmap(file,{imageOrientation:'from-image'});
  try{
    if(source.width*source.height>48000000)throw new Error('图片像素过大，请使用4800万像素以内的图片');
    let ratio=Math.min(1,2400/Math.max(source.width,source.height));
    const canvas=document.createElement('canvas');
    while(true){
      canvas.width=Math.max(1,Math.round(source.width*ratio));canvas.height=Math.max(1,Math.round(source.height*ratio));
      const context=canvas.getContext('2d');context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(source,0,0,canvas.width,canvas.height);
      if(file.type==='image/png'){
        const lossless=await canvasBlob(canvas,'image/png');
        if(lossless&&lossless.size<=IMAGE_LIMIT_BYTES)return lossless;
      }
      for(const quality of [.94,.90,.86,.82]){
        const compressed=await canvasBlob(canvas,'image/webp',quality);
        if(!compressed||compressed.type!=='image/webp')return file;
        if(compressed.size<=IMAGE_LIMIT_BYTES)return compressed;
      }
      if(canvas.width===1&&canvas.height===1)throw new Error('无法压缩这张图片，请换一张');
      ratio*=.84;
    }
  }finally{source.close();}
}
function readableBytes(bytes){return bytes>=1000000?(bytes/1000000).toFixed(2)+'MB':(bytes/1000).toFixed(0)+'KB';}
async function uploadFiles(files){
  if(!state.draft||state.busy)return [];
  const list=[...files];if(state.draft.images.length+state.uploads+list.length>PRODUCT_IMAGE_LIMIT){toast('每款产品最多保存200张图片，请减少本次选择。',true);return [];}
  const uploadedIds=[];
  const targetDraft=state.draft;
  state.uploads+=list.length;renderUploadProgress();
  for(const file of list){
    try{
      if(file.size>15*1024*1024)throw new Error('图片超过15MB');
      if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw new Error('请使用JPG、PNG、WebP或GIF');
      const prepared=await prepareUploadImage(file);
      const data=await api('/api/images',{method:'POST',body:prepared,headers:{'Content-Type':prepared.type||file.type,'X-File-Name':encodeURIComponent(file.name)}});
      if(data.image.bytes>IMAGE_LIMIT_BYTES)throw new Error('保存的图片超过200KB，请重试');
      state.images[data.image.id]=data.image;
      uploadedIds.push(data.image.id);
      if(targetDraft===state.draft&&!state.draft.images.includes(data.image.id)){state.draft.images.push(data.image.id);setDirty();}
    }catch(err){if(targetDraft===state.draft)state.uploadErrors.push({name:file.name,file,error:err.message});}
    finally{state.uploads--;renderImages();}
  }
  if(!state.uploadErrors.length)toast('图片已上传，单张不超过200KB。保存产品后完成关联。');
  return uploadedIds;
}
const variantColumns=[['name','text','规格名称'],['sku','text','SKU编码'],['supply_mode','supply','制作方式'],['size','text','尺寸'],['pack_qty','number','每份含量'],['pack_unit','unit','单位'],['cost','number','成本'],['price','number','售价'],['material','material','材质'],['print_per_sheet','number','每张可拼数量'],['note','text','备注']];
function materialSelectOptions(current='',placeholder='请选择材质'){
  const rates=state.warehouseRules?.config?.material_rates||[];
  const values=[...new Set(rates.filter(r=>r.enabled!=='否').map(r=>r.material).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const legacy=current&&!values.includes(current)?`<option value="${escapeHTML(current)}" selected disabled>${escapeHTML(current)}（${rates.some(r=>r.material===current)?'已停用':'未配置'}）</option>`:'';
  return `<option value="">${escapeHTML(placeholder)}</option>`+legacy+values.map(value=>`<option value="${escapeHTML(value)}" ${value===current?'selected':''}>${escapeHTML(value)}</option>`).join('');
}
function refreshMaterialSelect(){
  const select=$('[data-bulk-field="material"]');
  if(select)select.innerHTML=materialSelectOptions(select.value,'统一材质（不修改）');
}
function refreshProcess(){
  if(!state.draft)return;
  const input=$('[name="process"]',$('#product-form'));
  state.draft.process_mode=ProductProcess.mode(state.draft);
  if(state.draft.process_mode==='auto'){state.draft.process=ProductProcess.infer(state.draft);input.value=state.draft.process;}
  $('#process-hint').textContent=state.draft.process_mode==='auto'?'自动汇总各规格及导入资料中明确的工艺；未注明的光膜或哑膜不会猜测。':'已手动填写；点击“重新提取”可按商品资料汇总。';
}
function refreshMaterials(){
  if(!state.draft)return;
  $('#material-summary').textContent=EditorFields.materials(state.draft).join('、')||'尚未填写';
}
function refreshCosts(){
  if(!state.draft)return;
  state.draft.variants.forEach((v,i)=>{EditorFields.calculate(v);const output=$(`[data-pack-cost="${i}"]`);if(output){const estimate=ProductCost.estimate(v,state.draft,state.products,state.warehouseRules?.config);output.textContent=estimate.cost==null?estimate.note:'¥'+estimate.cost.toLocaleString('zh-CN',{maximumFractionDigits:8})+' / 份';}});
}
function showVariantIssues(issues){
  if(issues.length)setEditorTab('variants');
  const box=$('#variant-validation');box.hidden=!issues.length;
  for(const input of document.querySelectorAll('#variants-body [aria-invalid]'))input.removeAttribute('aria-invalid');
  box.innerHTML=issues.length?`<strong>请补齐以下销售规格后再保存（${issues.length}项）</strong><ul>${issues.map((issue,i)=>`<li><button type="button" class="text-button" data-validation-issue="${i}">${escapeHTML((state.draft.variants[issue.row]?.sku||state.draft.variants[issue.row]?.name||'规格')+'：'+issue.message.replace(/^第\d+行：/,''))}</button></li>`).join('')}</ul>`:'';
  const locate=issue=>{if(VariantTools.filtered())VariantTools.reveal(issue.row);box.hidden=false;for(const item of issues){const tr=$(`#variants-body tr[data-row="${item.row}"]`);if(tr)(item.field==='image_ids'?$('[data-variant-photo]',tr):$(`[data-field="${item.field}"]`,tr))?.setAttribute('aria-invalid','true');}const row=$(`#variants-body tr[data-row="${issue.row}"]`);const input=issue.field==='image_ids'?$('[data-variant-photo]',row||document):$(`[data-field="${issue.field}"]`,row||document);(input||$('#add-variant')).focus();input?.scrollIntoView({block:'center',inline:'nearest'});};
  for(const issue of issues){const row=$(`#variants-body tr[data-row="${issue.row}"]`);if(row)(issue.field==='image_ids'?$('[data-variant-photo]',row):$(`[data-field="${issue.field}"]`,row))?.setAttribute('aria-invalid','true');}
  $$('[data-validation-issue]',box).forEach(button=>button.addEventListener('click',()=>locate(issues[Number(button.dataset.validationIssue)])));
  if(issues.length){locate(issues[0]);toast(issues[0].message,true);$('#save-status').textContent='请补齐销售规格，填写内容已保留';}
}
function printCostSourceControl(v,index){
  if(v.supply_mode!=='打印定制')return '';
  return '<select data-field="print_cost_source" aria-label="第'+(index+1)+'行成本来源"><option value="auto" '+(v.print_cost_source!=='manual'?'selected':'')+'>按打印方案自动计算</option><option value="manual" '+(v.print_cost_source==='manual'?'selected':'')+'>手动成本</option></select>';
}
function renderVariants(){
  if(!state.draft)return;refreshMaterialSelect();$('#bulk-unit-cost').disabled=!state.draft.variants.some(v=>EditorFields.manualCost(v,state.draft));$$('[data-bulk-field]').forEach(input=>input.disabled=input.dataset.bulkField==='print_per_sheet'?!state.draft.variants.some(v=>(v.supply_mode||state.draft.supply_defaults?.supply_mode)==='打印定制'):!state.draft.variants.length);state.draft.variants.forEach(EditorFields.calculate);refreshMaterials();refreshProcess();InventoryModel.apply(state.draft);$('#variant-validation').hidden=true;$('#variant-tab-count').textContent=state.draft.variants.length;
  $('#variants-body').innerHTML=state.draft.variants.map((variant,index)=>`<tr data-row="${index}"><td><div class="variant-photo-tools"><button type="button" class="variant-photo" data-variant-photo="${index}" ${variant.image_ids?.length?`data-view-image="${escapeHTML(variant.image_ids[0])}" data-view-variant="${index}" data-view-title="${escapeHTML((variant.name||'未命名规格')+' · '+variant.sku)}"`:''} title="${variant.image_ids?.length?'点击放大查看':'添加规格图片'}" aria-label="第${index+1}行${variant.image_ids?.length?'图片预览':'添加图片'}">${variant.image_ids?.length?previewImage(variant.image_ids[0],variant.name||'规格图片'):icon('image-plus')}</button>${variant.image_ids?.length?`<button type="button" class="text-button variant-change-photo" data-edit-variant-photo="${index}" aria-label="第${index+1}行更换图片">换图</button>`:''}</div></td>${variantColumns.map(([key,type,label])=>{
    let control;
    if(type==='material'){
      control=`<select data-field="material" aria-label="第${index+1}行材质">${materialSelectOptions(variant.material||'')}</select>`;
    }else if(type==='supply'){
      control=`<select data-field="supply_mode" aria-label="第${index+1}行制作方式">${WarehouseUI.options(ProductionMethods.MODES,variant.supply_mode)}</select>`;
     }else if(key==='cost'&&EditorFields.automatic(variant,state.draft)){
      const estimate=ProductCost.estimate(variant,state.draft,state.products,state.warehouseRules?.config),unit=variant.pack_unit||'单位',rate=estimate.cost!=null&&variant.pack_qty>0?Number((estimate.cost/variant.pack_qty).toFixed(8)):'';
      control='<div class="cost-cell">'+printCostSourceControl(variant,index)+(variant.print_sheet_cost!=null?'<label><input data-field="print_sheet_cost" type="number" min="0" step="any" value="'+escapeHTML(variant.print_sheet_cost)+'" aria-label="第'+(index+1)+'行每张大纸完整成本">元/张</label>':'')+'<label><input data-field="unit_cost" type="number" disabled value="'+escapeHTML(rate)+'" aria-label="第'+(index+1)+'行自动每'+escapeHTML(unit)+'成本" placeholder="按打印方案计算">元/'+escapeHTML(unit)+'</label><span class="cost-estimate" data-pack-cost="'+index+'">'+(estimate.cost==null?escapeHTML(estimate.note):'¥'+estimate.cost.toLocaleString('zh-CN',{maximumFractionDigits:8})+' / 份')+'</span><small>'+escapeHTML(estimate.note)+'</small></div>';
    }else if(key==='cost'&&EditorFields.workOrder(variant,state.draft)){
      control=`<div class="cost-cell"><input data-field="unit_cost" type="number" disabled aria-label="第${index+1}行每${escapeHTML(variant.pack_unit||'单位')}成本" placeholder="工单定制无需填写"><span class="cost-estimate">按工单核算</span></div>`;
    }else if(key==='print_per_sheet'&&variant.supply_mode!=='打印定制')control='<span class="muted">无需填写</span>';else if(key==='cost'){
      const estimate=ProductCost.estimate(variant,state.draft,state.products,state.warehouseRules?.config),unit=variant.pack_unit||'单位',rate=variant.unit_cost??(variant.cost!=null&&variant.pack_qty>0?Number((variant.cost/variant.pack_qty).toFixed(8)):'');
      control=`<div class="cost-cell">${printCostSourceControl(variant,index)}<label><input data-field="unit_cost" type="number" min="0" step="any" value="${escapeHTML(rate)}" aria-label="第${index+1}行每${escapeHTML(unit)}成本" placeholder="每${escapeHTML(unit)}成本">元/${escapeHTML(unit)}</label><span class="cost-estimate" data-pack-cost="${index}">${estimate.cost==null?escapeHTML(estimate.note):'¥'+estimate.cost.toLocaleString('zh-CN',{maximumFractionDigits:8})+' / 份'}</span>${estimate.sheets!=null?'<small>预计用纸 '+estimate.sheets+' 张/份</small>':''}${variant.unit_cost==null&&estimate.cost!=null?'<small>沿用已有整份成本；修改单价后重新计算</small>':''}</div>`;
    }else if(type==='unit'||type==='mode'){
      const choices=type==='unit'?['','贴','张','枚','个','件','包','卷','套','份']:['','独立库存','共用库存','待关联','仅统计销售'];
      control=`<select data-field="${key}" aria-label="第${index+1}行${label}" ${key==='inventory_mode'&&InventoryModel.printing(variant)?'disabled':''}>${choices.map(v=>`<option value="${v}" ${variant[key]===v?'selected':''}>${InventoryModel.labels[v]||v||'沿用默认'}</option>`).join('')}</select>`;
    }else control=`<input data-field="${key}" type="${type}" ${type==='number'?`min="${['pack_qty','print_per_sheet'].includes(key)?'1':'0'}" step="${['pack_qty','print_per_sheet'].includes(key)?'1':'any'}"`:`maxlength="${key==='note'?'1000':key==='name'?'300':'160'}"`} value="${escapeHTML(variant[key])}" ${(key==='stock_code'&&variant.inventory_mode!=='共用库存')||(InventoryModel.printing(variant)&&['stock_code','inventory_mode'].includes(key))?'disabled':''} placeholder="${key==='stock_code'?'仅共用库存填写':key==='pack_qty'?'例如500':label}" aria-label="第${index+1}行${label}">`;
    const resetField=key==='cost'?'unit_cost':key;const generated=variant.batch_key&&!(key==='cost'&&!EditorFields.manualCost(variant,state.draft))&&typeof BatchModel!=='undefined'&&BatchModel.AUTO_FIELDS.includes(resetField),overridden=(variant.batch_overrides||[]).includes(resetField);
    return '<td class="'+(overridden?'batch-overridden':'')+'">'+(generated?`<div class="batch-cell">${control}<button type="button" class="batch-reset" data-batch-reset="${index}" data-reset-field="${resetField}" title="恢复此格的统一规则" aria-label="第${index+1}行${label}恢复统一规则" ${overridden?'':'disabled'}>↺</button></div>`:control)+'</td>';
  }).join('')}<td><button type="button" data-remove-variant="${index}" class="row-remove" aria-label="移除第${index+1}个规格" title="移除此规格">${icon('trash')}</button></td></tr>`).join('');
  if(typeof WarehouseUI!=='undefined')WarehouseUI.inventorySummary();VariantTools.render();
}
function chooseVariantPhoto(index){
  const variant=state.draft.variants[index];
  if(!state.draft.images.length){setEditorTab('basic');toast('先上传产品图片，再为规格选择对应图片。');return;}
  const share=()=>!!$('#share-design-image')?.checked;
  openUtility('选择规格图片',`<p>${escapeHTML(variant.name||'未命名规格')}。从本产品已上传的图片中选择。</p>${variant.batch_key?'<label class="batch-auto"><input type="checkbox" id="share-design-image" checked>应用到同款所有数量规格（取消勾选仅修改本行）</label>':''}<div class="variant-photo-picker">${state.draft.images.map(id=>`<button type="button" data-choose-photo="${id}" aria-label="选择图片">${previewImage(id,'产品图片')}</button>`).join('')}</div>`,[{label:'清除规格图片',action:()=>{BatchUI.setVariantImage(variant,[],share());closeUtility();}},{label:'取消',action:closeUtility}]);
  $$('[data-choose-photo]',$('#utility-content')).forEach(button=>button.addEventListener('click',()=>{BatchUI.setVariantImage(variant,[button.dataset.choosePhoto],share());closeUtility();}));
}
async function saveProduct(event){
  event.preventDefault();if(state.uploads||state.busy||state.uploadErrors.length)return;readFields();
  if(!BatchUI.validForSave())return;
  if(!state.draft.name){setEditorTab('basic');$('[name="name"]',$('#product-form')).focus();toast('请填写产品名称。',true);return;}
  InventoryModel.apply(state.draft);state.draft.variants.forEach(EditorFields.calculate);const issues=EditorFields.issues(state.draft,state.products,state.warehouseRules?.config);showVariantIssues(issues);if(issues.length)return;const draft=structuredClone(state.draft);
  state.busy=true;updateSaveButton();
  try{await api(draft.id?'/api/products/'+draft.id:'/api/products',{method:'POST',body:draft});state.dirty=false;dialog.close();state.draft=null;await loadProducts();toast('产品已保存，图片和规格已一起关联。');}
  catch(err){if(err.issues?.length)showVariantIssues(err.issues);else toast(err.message,true);$('#save-status').textContent='保存未完成，填写内容已保留';}
  finally{state.busy=false;updateSaveButton();}
}
function requestClose(){
  if(state.uploads||state.busy){toast('请等待上传或保存完成。',true);return;}
  if(state.dirty){openUtility('保留这次修改吗？','你有尚未保存的资料。选择“继续编辑”返回产品，或放弃本次修改。',[{label:'放弃修改',class:'secondary',action:()=>{closeUtility();state.dirty=false;state.draft=null;dialog.close();}},{label:'继续编辑',class:'primary',action:closeUtility}]);return;}
  state.draft=null;dialog.close();
}
function openUtility(title,content,actions=[]){
  $('#utility-title').textContent=title;$('#utility-content').innerHTML=content;$('#utility-footer').innerHTML='';
  for(const item of actions){const button=document.createElement('button');button.type='button';button.className='button '+(item.class||'secondary');button.textContent=item.label;button.addEventListener('click',()=>item.action(button));$('#utility-footer').append(button);}
  fillIcons($('#utility-content'));if(!utility.open)utility.showModal();
}
function closeUtility(){if(utilityBusy)return;utility.close();}
function issueHTML(issues){return '<div class="issue-list">'+issues.map(issue=>`<div class="issue-item"><strong>${escapeHTML(issue.product||issue.sheet||'')}${issue.row?' · 第'+issue.row+'行':''}${issue.sku?' / '+escapeHTML(issue.sku):''}</strong><div>${escapeHTML(issue.message)}</div></div>`).join('')+'</div>';}
async function trashRequest(button,path,body,message,closeEditor=false){
  button.disabled=true;utilityBusy=true;$('#utility-close').disabled=true;
  try{const result=await api(path,{method:'POST',body});utilityBusy=false;closeUtility();if(closeEditor){state.dirty=false;state.draft=null;dialog.close();}await loadProducts();toast(message+(result.file_cleanup_errors?'部分图片文件清理未完成。':''));}
  catch(err){toast(err.message,true);}finally{utilityBusy=false;$('#utility-close').disabled=false;button.disabled=false;}
}
function restoreDialog(p){openUtility('回收站中的产品',`<p>“${escapeHTML(p.name)}”包含${p.variants.length}个规格、${p.images.length}张图片，恢复后重新出现在产品目录中。</p>`,[{label:'取消',action:closeUtility},{label:'彻底删除',class:'secondary danger',action:()=>purgeDialog(p)},{label:'恢复产品',class:'primary',action:button=>trashRequest(button,'/api/products/'+p.id+'/restore',{revision:p.revision},'产品已恢复。')}]);}
function deleteProduct(){
  if(state.uploads||state.busy)return;const p=state.draft;
  openUtility('删除这个产品？',`<p>“${escapeHTML(p.name)}”将移入回收站，图片和规格一起保留，可以恢复。</p>${state.dirty?'<p class="danger-note">当前未保存的修改不会写入。</p>':''}`,[{label:'取消',action:closeUtility},{label:'移入回收站',class:'primary danger',action:button=>trashRequest(button,'/api/products/'+p.id+'/trash',{revision:p.revision},'产品已移入回收站。',true)}]);
}
function purgeDialog(p){
  openUtility('彻底删除这个产品？',`<p>将彻底删除“${escapeHTML(p.name)}”的产品资料和${p.variants.length}个规格，未被其他产品使用的图片也会删除。</p><p class="danger-note">无法从回收站恢复。仓库中的资料不会被修改。</p>`,[{label:'取消',action:closeUtility},{label:'彻底删除',class:'primary danger',action:button=>trashRequest(button,'/api/products/'+p.id+'/purge',{revision:p.revision,confirm:true},'产品已彻底删除。')}]);
}
function emptyTrash(){
  const items=state.products.filter(p=>p.archived).map(p=>({id:p.id,revision:p.revision}));if(!items.length)return;
  openUtility('清空回收站？',`<p>将彻底删除回收站中全部<strong>${items.length}个产品</strong>及其规格，未被其他产品使用的图片也会清理。</p><p class="danger-note">无法从回收站恢复。此操作包含筛选条件之外的回收站产品。</p>`,[{label:'取消',action:closeUtility},{label:`彻底删除这${items.length}个产品`,class:'primary danger',action:button=>trashRequest(button,'/api/trash/empty',{items,confirm:true},`回收站已清空，彻底删除${items.length}个产品。`)}]);
}
function duplicateProduct(){
  if(state.uploads||state.busy)return;readFields();const draft=structuredClone(state.draft);delete draft.id;delete draft.revision;delete draft.batch_config;draft.name+='（副本）';draft.status='draft';delete draft.warehouse_config;delete draft.supply_defaults;delete draft.inventory_auto;delete draft.inventory_defaults;draft.variants.forEach(v=>{delete v.batch_key;delete v.batch_overrides;v.sku='';v.erp_code='';v.inventory_mode='';v.stock_code='';v.supply_mode='';v.print_rule_code='';v.digit_condition_code='';});dialog.close();openProduct(null,false,draft);setDirty();toast('已复制资料，请填写新产品的SKU编码。');
}
function bulkVariants(){
  openUtility('批量设置销售规格',`<p>只修改你选择的字段，其他内容会保留。保存产品后生效。</p><div class="field-row"><label class="field">数量单位<select id="bulk-unit"><option value="">不修改</option>${['贴','张','枚','个','件','包','卷','套','份'].map(v=>'<option>'+v+'</option>').join('')}</select></label><label class="field">库存方式<select id="bulk-mode"><option value="">不修改</option>${['独立库存','共用库存','待关联','仅统计销售'].map(v=>'<option>'+v+'</option>').join('')}</select></label></div><label class="field">材质<select id="bulk-material">${materialSelectOptions('','不修改材质')}</select><small>选项来自材质加工方案；新增材质请先在方案中配置。</small></label><p class="danger-note">不同款式、尺寸和材质不能共用同一实物库存。共用编码请逐行核对填写。</p>`,[{label:'取消',action:closeUtility},{label:'应用到所有规格',class:'primary',action:()=>{const unit=$('#bulk-unit').value,mode=$('#bulk-mode').value,material=$('#bulk-material').value.trim();state.draft.variants.forEach(v=>{if(unit){v.pack_unit=unit;BatchModel.markOverride(v,'pack_unit');}if(mode){v.inventory_mode=mode;if(mode!=='共用库存')v.stock_code='';}if(material)v.material=material;});setDirty();renderVariants();closeUtility();toast('批量设置已应用，记得保存产品。');}}]);
}
function importValue(value){return value==null?'未填写':Array.isArray(value)?`${value.length} 张图片`:typeof value==='object'?JSON.stringify(value):String(value);}
function chooseImport(){
  openUtility('导入产品资料','<p>按SKU对应产品，导入前先预览。</p><p class="muted">批量更新：已有SKU更新非空字段，新SKU新增。空白保留原值，库存数量不导入，售价人工填写。</p><p class="muted">已有SKU只需保留SKU编码和待修改的列；新SKU还需产品名称和规格名称。材质费用在左侧打印规则维护，此入口只导入商品资料。</p>',[
   {label:'原表自动识别导入',action:()=>{state.importMode='create';closeUtility();$('#import-input').click();}},
   {label:'按SKU新增 / 批量更新',class:'primary',action:()=>{state.importMode='upsert';closeUtility();$('#import-input').click();}}
  ]);
}
async function importFile(file){
  if(file.size>400*1024*1024){toast('表格超过400MB，请拆分后导入。',true);return;}
  openUtility('读取产品表格','<p>正在识别产品分组、成本和图片；带图片的大表需要一些时间，请保持页面打开。</p>');utilityBusy=true;$('#utility-close').disabled=true;
  try{
    const preview=await api('/api/import/preview',{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name),'X-Import-Mode':state.importMode||'upsert'}});
    utilityBusy=false;$('#utility-close').disabled=false;
    const delta=preview.bulk?`<div class="warehouse-preview"><span>新增SKU <strong>${preview.new_skus}</strong></span><span>修改已有SKU <strong>${preview.updated_skus}</strong></span><span>未改动SKU <strong>${preview.unchanged_skus}</strong></span><span>新增产品 <strong>${preview.new_products}</strong></span><span>更新产品 <strong>${preview.updated_products}</strong></span></div><p>空白保留原值；不删除未列出的规格及原图片，不导入库存，不自动同步仓库。请核对下面的修改后确认。</p>${preview.changes.length?`<div class="import-differences"><table><thead><tr><th>SKU</th><th>字段</th><th>原值</th><th>新值</th></tr></thead><tbody>${preview.changes.flatMap(c=>c.fields.map(f=>`<tr><td>${escapeHTML(c.sku)}${c.new?' <small>新增</small>':''}</td><td>${escapeHTML(f.field)}</td><td>${escapeHTML(importValue(f.before))}</td><td>${escapeHTML(importValue(f.after))}</td></tr>`)).join('')}</tbody></table></div><p class="muted">展示前100条变更记录；共${preview.total_changes}条。</p>`:'<p>本次表格与网站资料相同。</p>'}`:'';
    const content=preview.bulk?`<p>${escapeHTML(file.name)}</p>${delta}<p class="muted">识别${preview.variants}个SKU；图片压缩至200KB以内。材质费用在打印规则维护。</p>${preview.issues.length?issueHTML(preview.issues.slice(0,30)):''}`:`<p>${escapeHTML(file.name)}</p>${delta}<div class="import-summary"><div><strong>${preview.products}</strong><span>产品档案</span></div><div><strong>${preview.variants}</strong><span>销售规格</span></div><div><strong>${preview.images||0}</strong><span>压缩图片</span></div></div><div class="preview-names">${preview.names.map(escapeHTML).join('、')}${preview.products>12?'…':''}</div><p class="muted">识别了${preview.sheets}个工作表，导入后可在产品中心检查、编辑。图片自动压缩至200KB以内，保存图片对应关系及原表字段；原始文件请自行保留。实际库存数量不导入。</p>${preview.already_imported?'<p class="danger-note">此文件已经导入过，再次确认不会重复创建产品。</p>':''}${preview.issues.length?`<p>有 ${preview.issues.length} 项需要核对：</p>${issueHTML(preview.issues.slice(0,30))}`:''}`;
    openUtility('确认导入产品资料',content,[{label:'取消',action:closeUtility},{label:preview.already_imported?'此文件已导入':'确认导入',class:'primary',action:async button=>{button.disabled=true;utilityBusy=true;$('#utility-close').disabled=true;try{const result=await api('/api/import/commit',{method:'POST',body:{token:preview.token}});utilityBusy=false;closeUtility();state.view='all';resetFilters();await loadProducts();toast(result.bulk?`已新增 ${result.new_skus} 个SKU，修改 ${result.updated_skus} 个SKU；请再同步到仓库。`:result.already_imported?'此文件已导入，没有重复创建。':`已导入 ${result.products} 个产品、${result.variants} 个规格。`);}catch(err){toast(err.message,true);}finally{utilityBusy=false;$('#utility-close').disabled=false;button.disabled=false;}}}]);
  }catch(err){utilityBusy=false;$('#utility-close').disabled=false;openUtility('未能导入表格',`<p>${escapeHTML(err.message)}</p>`,[{label:'关闭',class:'primary',action:closeUtility}]);}
}
function exportSelection(){return state.selected.size?[...state.selected]:filtered().filter(p=>!p.archived).map(p=>p.id);}
async function exportProductRules(){
  const button=$('#export-product-rules');button.disabled=true;
  try{
    const draft=state.draft,result=RuleExport.rows(draft,v=>ProductCost.estimate(v,draft,state.products,state.warehouseRules?.config).cost);
    const bytes=RuleExport.workbook(result.data),filename=(String($('#product-form').elements.name.value||draft.name||'商品').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100)||'商品')+'-商品规则.xlsx';
    await saveResponse(new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(filename)}}),filename);
    if(result.warnings.length)openUtility('规则已导出，请核对空白项',`<p>已导出当前 ${result.data.length-1} 个销售规格。成本为元/份，长、宽为厘米；无法确定的内容留空，没有按 0 处理。</p><ul>${result.warnings.map(w=>'<li>'+escapeHTML(w)+'</li>').join('')}</ul>`,[{label:'知道了',class:'primary',action:closeUtility}]);
    else toast(`已导出 ${result.data.length-1} 个销售规格；成本为元/份，长、宽为厘米。`);
  }catch(error){toast(error.message,true);}finally{button.disabled=false;}
}
function showExport(){
  const ids=exportSelection();if(!ids.length){toast('当前没有可导出的产品。',true);return;}
  openUtility('导出产品资料',`<p>${state.selected.size?'已选择':'当前筛选结果包含'} <strong>${ids.length}</strong> 个产品。请选择导出用途。</p><button class="export-choice" data-export="warehouse"><span>${icon('warehouse')}</span><div><strong>旧版仓库建档表 · CSV</strong><small>兼容旧资料，工单定制自动排除；新配置使用“同步到新城仓库”。</small></div><span>${icon('chevron-right')}</span></button><button class="export-choice" data-export="website"><span>${icon('box')}</span><div><strong>网站商品资料包 · ZIP</strong><small>通用商品CSV与压缩后的图片，不含内部成本和运费。</small></div><span>${icon('chevron-right')}</span></button><p class="muted">网站资料包需要按接收网站的导入格式映射字段，不会自动发布上架。</p>`);
  $$('[data-export]',$('#utility-content')).forEach(b=>b.addEventListener('click',()=>downloadExport(b.dataset.export,ids,b)));
}
async function saveResponse(res,fallback){
  const disposition=res.headers.get('Content-Disposition')||'';const name=disposition.match(/filename\*=UTF-8''([^;]+)/i);const filename=name?decodeURIComponent(name[1]):fallback;
  const blob=await res.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
async function downloadExport(kind,ids,button){
  button.disabled=true;utilityBusy=true;$('#utility-close').disabled=true;
  try{const res=await api('/api/export/'+kind,{method:'POST',body:{ids},download:true});await saveResponse(res,'产品资料');utilityBusy=false;closeUtility();toast('资料已导出，请查看浏览器下载。');}
  catch(err){
    utilityBusy=false;if(err.issues){openUtility('这些规格还需要补充',`<p>已配置 ${err.valid_rows} 个SKU；还有 ${err.total_issues} 项待完善。本次未导出，请打开产品的“销售规格”补齐后再试。</p>${issueHTML(err.issues)}<p class="muted">产品中心补齐SKU、名称和每份含量即可；现货的实物关联及扣减规则在仓库维护。</p>`,[{label:'返回产品列表',class:'primary',action:closeUtility}]);}else toast(err.message,true);
  }finally{utilityBusy=false;$('#utility-close').disabled=false;button.disabled=false;}
}
async function backup(){
  openUtility('下载完整备份','<p>备份包含全部产品资料、压缩后的图片和导入记录，也包含内部成本。Excel原表请另外保管，备份请保存到可靠位置。</p>',[{label:'取消',action:closeUtility},{label:'下载完整备份',class:'primary',action:async button=>{button.disabled=true;utilityBusy=true;$('#utility-close').disabled=true;try{const res=await api('/api/backup',{method:'POST',body:{},download:true});await saveResponse(res,'产品中心备份.zip');utilityBusy=false;closeUtility();toast('完整备份已下载，图片一并保留。');}catch(err){toast(err.message,true);}finally{utilityBusy=false;$('#utility-close').disabled=false;button.disabled=false;}}}]);
}
function showHelp(){openUtility('开始使用产品中心',`<ul><li><strong>新建产品：</strong>填写名称即可保存草稿，随后补图片、材质和规格。</li><li><strong>上传图片：</strong>打开产品，点击图片区域或拖入多张图片，系统自动压缩到每张200KB以内，保留透明背景；表格导入图片也适用。再点击“保存产品”。星标可更换封面。</li><li><strong>查找资料：</strong>输入名称、编码或标签，也可以组合类型、场景和材质筛选。</li><li><strong>配置规格：</strong>每行一个销售SKU。数量指每份包装含量，成本为整份成本。</li><li><strong>导出仓库：</strong>补齐编码、含量、单位和库存方式后，导出CSV到仓库的“导入新品资料”。已有SKU按仓库规则跳过。</li><li><strong>网站资料：</strong>导出通用CSV及图片包，按目标网站模板导入。</li><li><strong>保存与备份：</strong>资料和图片保存到${state.local?'这台电脑':'服务器'}，不依赖浏览器缓存。定期下载完整备份。</li></ul><p class="muted">删除的产品先进入回收站，可恢复；彻底删除或清空后无法从回收站恢复。产品中心不改写仓库的实际库存。</p>`,[{label:'开始使用',class:'primary',action:closeUtility}]);}

function bind(){
  BatchUI.init();
  document.addEventListener('error',event=>{const image=event.target;if(image.tagName!=='IMG')return;const full=image.dataset.fullSrc;if(full&&!image.dataset.fullRetried){image.dataset.fullRetried='1';image.src=full;return;}image.hidden=true;const note=document.createElement('span');note.className='image-load-note';note.textContent='图片暂时无法加载，点击重试';image.after(note);},{capture:true});
  $('#process-auto').addEventListener('click',()=>{state.draft.process_mode='auto';refreshProcess();setDirty();});
  $('[name="process"]',$('#product-form')).addEventListener('input',()=>{if(state.draft){state.draft.process_mode='manual';refreshProcess();setDirty();}});
  fillIcons();$('#create-button').addEventListener('click',()=>openProduct());$('#product-form').addEventListener('submit',saveProduct);
  for(const panel of [dialog,utility])panel.addEventListener('close',()=>{(dialog.open?dialog:document.body).append($('#toast-region'));});
  $$('.close-dialog').forEach(b=>b.addEventListener('click',requestClose));dialog.addEventListener('cancel',event=>{event.preventDefault();requestClose();});utility.addEventListener('cancel',event=>{if(utilityBusy)event.preventDefault();});$('#utility-close').addEventListener('click',closeUtility);
  $('#product-form').addEventListener('input',event=>{if(event.target.closest('#variants-body,#variant-tools'))return;if(event.target.name==='name')BatchUI.nameChanged(event.target.value);if(event.target.name==='material')state.draft.material=event.target.value;setDirty();});
  $$('.editor-tabs [data-tab]').forEach(b=>b.addEventListener('click',()=>setEditorTab(b.dataset.tab)));
  document.addEventListener('click',event=>{const nav=event.target.closest('[data-view]');if(nav)setView(nav.dataset.view);});
  $('#category-nav').addEventListener('click',event=>{const b=event.target.closest('[data-category]');if(b){state.view='all';$('#filter-category').value=b.dataset.category;state.page=1;state.selected.clear();render();$('#sidebar').classList.remove('open');}});
  for(const id of ['search','filter-category','filter-scene','filter-material','filter-status','filter-production','filter-sync','sort-order'])$('#'+id).addEventListener(id==='search'?'input':'change',()=>{state.page=1;state.selected.clear();render();});
  $('#reset-filters').addEventListener('click',resetFilters);$('#empty-reset').addEventListener('click',()=>setView('all'));
  $('#grid-view').addEventListener('click',()=>{state.display='grid';localStorage.setItem('product-center-view','grid');render();});$('#table-view').addEventListener('click',()=>{state.display='table';localStorage.setItem('product-center-view','table');render();});
  $('#page-prev').addEventListener('click',()=>{state.page--;render();$('.catalog-panel').scrollIntoView({block:'start',behavior:'smooth'});});$('#page-next').addEventListener('click',()=>{state.page++;render();$('.catalog-panel').scrollIntoView({block:'start',behavior:'smooth'});});
  const goPage=page=>{state.page=page;render();$('.catalog-panel').scrollIntoView({block:'start',behavior:'smooth'});};
  $('#page-first').addEventListener('click',()=>goPage(1));$('#page-last').addEventListener('click',()=>goPage(Math.max(1,Math.ceil(filtered().length/state.pageSize))));$('#page-jump').addEventListener('change',event=>goPage(Number(event.target.value)));
  $('#select-all').addEventListener('change',event=>{for(const p of filtered())if(!p.archived){if(event.target.checked)state.selected.add(p.id);else state.selected.delete(p.id);}render();});
  $('#catalog').addEventListener('click',event=>{const purge=event.target.closest('[data-purge]'),restore=event.target.closest('[data-restore]');if(purge||restore){const button=purge||restore;const p=state.products.find(p=>p.id===(button.dataset.purge||button.dataset.restore));if(p){if(purge)purgeDialog(p);else restoreDialog(p);}return;}const open=event.target.closest('[data-open]');if(open)openProduct(open.dataset.open,open.dataset.upload==='1');});
  $('#empty-trash').addEventListener('click',emptyTrash);
  $('#catalog').addEventListener('change',event=>{const id=event.target.dataset.select;if(id){if(event.target.checked)state.selected.add(id);else state.selected.delete(id);render();}});
  $('#image-input').addEventListener('change',event=>{uploadFiles(event.target.files);event.target.value='';});const zone=$('#upload-zone');zone.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('#image-input').click();}});
  for(const name of ['dragenter','dragover'])zone.addEventListener(name,event=>{event.preventDefault();zone.classList.add('dragging');});for(const name of ['dragleave','drop'])zone.addEventListener(name,event=>{event.preventDefault();zone.classList.remove('dragging');if(name==='drop')uploadFiles(event.dataTransfer.files);});
  $('#image-gallery').addEventListener('click',event=>{const cover=event.target.closest('[data-cover]'),remove=event.target.closest('[data-remove-image]');if(cover){state.draft.images=[cover.dataset.cover,...state.draft.images.filter(i=>i!==cover.dataset.cover)];setDirty();renderImages();}if(remove){const id=remove.dataset.removeImage;state.draft.images=state.draft.images.filter(i=>i!==id);state.draft.variants.forEach(v=>{v.image_ids=(v.image_ids||[]).filter(i=>i!==id);});BatchUI.imageRemoved(id);setDirty();renderImages();renderVariants();}});
  $('#upload-progress').addEventListener('click',event=>{const retry=event.target.closest('[data-retry]'),dismiss=event.target.closest('[data-dismiss-upload]');if(retry){const entry=state.uploadErrors.splice(Number(retry.dataset.retry),1)[0];renderUploadProgress();uploadFiles([entry.file]);}if(dismiss){state.uploadErrors.splice(Number(dismiss.dataset.dismissUpload),1);renderUploadProgress();}});
  $('#variants-body').addEventListener('input',event=>{const field=event.target.dataset.field,row=event.target.closest('[data-row]');if(!field||!row||['supply_mode','print_cost_source'].includes(field))return;const variant=state.draft.variants[Number(row.dataset.row)];variant[field]=['pack_qty','cost','unit_cost','price','shipping','print_per_sheet','print_sheet_cost'].includes(field)?(event.target.value===''?null:Number(event.target.value)):event.target.value;if(field==='print_per_sheet')variant.print_pricing='material';const previousRates=state.draft.variants.map(v=>v.unit_cost);BatchUI.rowEdited(variant,field,event.target);if(field==='unit_cost'){state.draft.variants.forEach((v,i)=>{if(v.unit_cost==null&&(v===variant||previousRates[i]!==v.unit_cost)){v.cost=null;v.cost_mode=ProductCost.AUTO;}});}refreshCosts();if(field==='material')refreshMaterials();event.target.removeAttribute('aria-invalid');setDirty();});
  $('#variants-body').addEventListener('change',event=>{if(event.target.dataset.field==='print_cost_source'){const row=state.draft.variants[Number(event.target.closest('[data-row]').dataset.row)];MaterialPrinting.setCostSource(row,event.target.value);setDirty();renderVariants();WarehouseUI.render();return;}if(event.target.dataset.field==='supply_mode'){const row=event.target.closest('[data-row]');state.draft.variants[Number(row.dataset.row)].supply_mode=ProductionMethods.canonical(event.target.value);setDirty();renderVariants();WarehouseUI.render();return;}if(event.target.dataset.field==='cost_mode'){const variant=state.draft.variants[Number(event.target.closest('[data-row]').dataset.row)];variant.cost_mode=event.target.value;if(variant.cost_mode===ProductCost.AUTO)variant.cost=null;setDirty();renderVariants();return;}if(event.target.dataset.field==='inventory_mode'){const row=event.target.closest('[data-row]'),variant=state.draft.variants[Number(row.dataset.row)];variant.inventory_mode=event.target.value;const stock=$('[data-field="stock_code"]',row);stock.disabled=variant.inventory_mode!=='共用库存';if(stock.disabled){variant.stock_code='';stock.value='';}InventoryModel.apply(state.draft);setDirty();renderVariants();WarehouseUI.renderDefaults();}else if(['sku','size','material','pack_qty','pack_unit','unit_cost','stock_code','print_per_sheet'].includes(event.target.dataset.field)){InventoryModel.apply(state.draft);for(const tr of document.querySelectorAll('#variants-body tr')){const v=state.draft.variants[Number(tr.dataset.row)],input=$('[data-field=stock_code]',tr);if(input)input.value=v.stock_code||'';}WarehouseUI.inventorySummary();if(['material','pack_qty','pack_unit','unit_cost','print_per_sheet'].includes(event.target.dataset.field))renderVariants();}});
  $('#variants-body').addEventListener('click',event=>{const editPhoto=event.target.closest('[data-edit-variant-photo]');if(editPhoto){chooseVariantPhoto(Number(editPhoto.dataset.editVariantPhoto));return;}const photo=event.target.closest('[data-variant-photo]');if(photo){if(!photo.hasAttribute('data-view-image'))chooseVariantPhoto(Number(photo.dataset.variantPhoto));return;}const remove=event.target.closest('[data-remove-variant]');if(remove){const index=Number(remove.dataset.removeVariant);const variant=state.draft.variants[index];if(variant.sku||variant.name){openUtility('移除这个销售规格？',`<p>${escapeHTML(variant.name||variant.sku)} 将从当前产品资料中移除，保存产品后生效。仓库已有资料不会被修改。</p>`,[{label:'取消',action:closeUtility},{label:'移除规格',class:'primary',action:()=>{BatchUI.removed(state.draft.variants[index]);state.draft.variants.splice(index,1);setDirty();renderVariants();BatchUI.status();closeUtility();}}]);}else{state.draft.variants.splice(index,1);setDirty();renderVariants();}}});
  $('#add-variant').addEventListener('click',()=>{VariantTools.reveal();if(state.draft.variants.length>=1000){toast('每款产品最多1000个规格。',true);return;}const row=blankVariant();WarehouseUI.inherit([row]);state.draft.variants.push(row);setDirty();renderVariants();const last=$('#variants-body tr:last-child');last?.scrollIntoView({block:'nearest'});$('input',last)?.focus();});
  const applyHeaderEdit=event=>{const input=event.target,field=input.dataset.bulkField;if(!field||!state.draft||(event.type==='input'&&input.tagName==='SELECT')||(event.type==='change'&&input.tagName!=='SELECT'))return;try{if(EditorFields.applyHeader(state.draft,field,input.value)){setDirty();renderVariants();WarehouseUI.render();BatchUI.status();}}catch(error){toast(error.message,true);}};
  $('.variant-table thead').addEventListener('input',applyHeaderEdit);$('.variant-table thead').addEventListener('change',applyHeaderEdit);
  $('#bulk-unit-cost').addEventListener('input',event=>{if(!state.draft)return;try{if(EditorFields.applyUnitCost(state.draft,event.target.value)){setDirty();renderVariants();WarehouseUI.render();BatchUI.status();}}catch(error){toast(error.message,true);}});
  $('#bulk-variants').addEventListener('click',bulkVariants);$('#delete-product').addEventListener('click',deleteProduct);$('#duplicate-product').addEventListener('click',duplicateProduct);
  $('#import-button').addEventListener('click',chooseImport);$('#import-input').addEventListener('change',event=>{const file=event.target.files[0];if(file)importFile(file);event.target.value='';});
  $('#export-product-rules').addEventListener('click',exportProductRules);
  $('#export-button').addEventListener('click',showExport);$('#backup-button').addEventListener('click',backup);$('#help-button').addEventListener('click',showHelp);$('#mobile-menu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#login-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('button[type="submit"]',event.target);button.disabled=true;$('#login-error').textContent='';try{await api('/api/login',{method:'POST',body:{password:$('[name="password"]',event.target).value}});$('[name="password"]',event.target).value='';await start();}catch(err){$('#login-error').textContent=err.message;}finally{button.disabled=false;}});
  $('#login-button').addEventListener('click',showLogin);
  $('#login-cancel').addEventListener('click',()=>$('#login-screen').close());
  document.addEventListener('click',event=>{if(event.target.closest('[data-login]'))showLogin();});
  $('#logout-button').addEventListener('click',async function logout(){if(!RulesUI.leave(logout))return;try{await api('/api/logout',{method:'POST',body:{}});await start();toast('已退出登录，可以继续只读浏览。');}catch(err){toast(err.message,true);}});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!dialog.open){event.preventDefault();$('#search').focus();}});
  window.addEventListener('beforeunload',event=>{if(state.dirty||state.uploads){event.preventDefault();event.returnValue='';}});
}
async function start(){
  try{const session=await api('/api/session');state.local=session.local;setAccess(session.can_edit??session.authenticated);if($('#login-screen').open)$('#login-screen').close();$('#workspace').hidden=false;$('#storage-description').innerHTML=state.local?'资料保存在本机<small>产品与图片持久保存</small>':'资料保存在服务器<small>图片与产品统一保存</small>';$('#catalog').innerHTML=Array.from({length:8},()=>'<div class="skeleton-card"></div>').join('');await loadProducts();updateSaveButton();ProductAccess.apply();}
  catch(err){toast(err.message||'暂时无法连接产品中心。',true);}
}
bind();VariantTools.init();start();
