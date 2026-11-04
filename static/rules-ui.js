'use strict';
const RulesUI=(()=>{
 let draft=null,dirty=false,busy=false,active='material_rates',query='',visible=false;
 const root=()=>$('#rules-page'),title=key=>WarehouseUI.definitions[key].title;
 function changed(){dirty=true;$('#rules-save').disabled=false;$('#rules-save-status').textContent='有未保存的规则';}
 function leave(next=()=>setView('all')){
  if(busy){toast('正在保存规则，请稍候。',true);return false;}
  if(!dirty)return true;
  openUtility('规则尚未保存','<p>先保存规则，或放弃这次修改后离开。</p>',[{label:'继续编辑',action:closeUtility},{label:'放弃修改并离开',action:()=>{dirty=false;closeUtility();next();}}]);return false;
 }
 function nav(){visible=!root().hidden;$('#rules-nav').classList.toggle('active',visible);if(visible)$$('#main-nav [data-view]').forEach(b=>b.classList.remove('active'));$('#category-nav').hidden=visible;$('.category-heading').hidden=visible;}
 async function open(){
  if(visible)return;if(!leave(open))return;
  try{draft=await api('/api/warehouse-rules');state.warehouseRules=structuredClone(draft);dirty=false;query='';$('#product-library').hidden=true;root().hidden=false;$('#sidebar').classList.remove('open');render();nav();}catch(error){toast(error.message,true);}
 }
 function input(key,row,index,advanced=false){
  return WarehouseUI.fields(key,row).filter(([field])=>key!=='material_rates'||['enabled','note'].includes(field)===advanced).map(([field,label,type])=>{
   let values=Array.isArray(type)?type:null;
   if(field==='stock_code')values=draft.config.stocks.map(r=>r.code);
   if(field==='print_rule_code')values=draft.config.print_rules.map(r=>r.code);
   const attrs=`data-rule-key="${key}" data-rule-index="${index}" data-rule-field="${field}"`;
   return `<label class="field">${label}${values?`<select ${attrs}>${WarehouseUI.options(values,row[field])}</select>`:`<input ${attrs} ${type?`inputmode="${type}"`:''} ${field==='sku'?'list="rules-sku-codes"':''} value="${escapeHTML(row[field])}" maxlength="${field==='note'?1000:field==='name'?300:160}" placeholder="${label}" ${key==='stocks'&&field==='cost'&&row.pricing_mode==='按总价换算'?'readonly':''}>`}</label>`;
  }).join('');
 }
 function list(){
  const key=active,opened=new Set($$('.warehouse-record[open]',root()).map(r=>r.dataset.index));
  $('#rules-records').innerHTML=draft.config[key].map((row,index)=>({row,index})).filter(({row})=>!query||Object.values(row).some(v=>String(v??'').toLowerCase().includes(query))).map(({row,index})=>`<details class="warehouse-record" data-index="${index}" ${opened.has(String(index))||!(row.code||row.sku)?'open':''}><summary><strong>${escapeHTML(row.name||row.material||row.code||row.sku||'新建'+title(key))}</strong><span>${key==='links'?' → '+escapeHTML(row.stock_code):row.name?escapeHTML(row.code):''}</span></summary><div class="warehouse-fields">${input(key,row,index)}</div>${key==='material_rates'?`<details><summary>其他设置</summary><div class="warehouse-fields">${input(key,row,index,true)}</div></details>`:''}${key==='stocks'?`<p data-rule-price="${index}">库存单位单价：${ProductCost.unitCost(row)??'待补齐'} 元 / ${escapeHTML(row.unit)}；计价数量不增加库存。</p>`:''}<button type="button" class="text-button danger" data-rule-remove="${index}">移除这条规则</button></details>`).join('')||'<div class="rules-empty">'+(query?'没有匹配的规则。':'还没有'+title(key)+'，点击“新增”开始。')+'</div>';
 }
 function render(){
  root().innerHTML=`<div class="page-heading"><div><p class="eyebrow">PRINTING RULES</p><h1>打印规则</h1><p class="muted">维护材质、覆膜及切割单价；产品选用组合方案，再填写每张可拼数量。</p></div><div class="heading-actions"><a class="button secondary" href="/warehouse-template-v5.xlsx" download>下载导入范本</a><button type="button" class="button primary" id="rules-save" ${!dirty||busy?'disabled':''}>保存规则</button></div></div><div class="inline-note"><span>${icon('info')}</span><p>这里只维护材质加工方案。数字贴条件在仓库的“数码打印 → 数字贴条件”维护；已同步商品需要重新同步。</p></div><div class="rules-status"><span id="rules-save-status" role="status">${dirty?'有未保存的规则':'规则已载入'}</span><button class="text-button" id="rules-reload" type="button">重新载入</button></div>${draft.issues.length?`<p class="danger-note">${draft.issues.map(escapeHTML).join('<br>')}</p>`:''}<div class="rules-tabs" role="tablist">${['material_rates'].map(key=>`<button type="button" role="tab" aria-selected="${active===key}" class="${active===key?'active':''}" data-rules-tab="${key}">${title(key)} <span>${draft.config[key].length}</span></button>`).join('')}</div><section class="warehouse-section"><div class="rules-toolbar"><div><h2>${title(active)}</h2><p class="muted">${WarehouseUI.definitions[active].help}</p></div><button type="button" class="button secondary small" id="rules-add">${active==='digit_conditions'?'新增数字贴条件':'新增材质方案'}</button></div><label class="rules-search"><span>查找规则</span><input id="rules-search" type="search" placeholder="搜索名称、编码、材质…" value="${escapeHTML(query)}"></label><div id="rules-records" class="warehouse-config-list"></div></section><datalist id="rules-sku-codes">${state.products.filter(p=>!p.archived).flatMap(p=>p.variants).filter(v=>v.sku).map(v=>`<option value="${escapeHTML(v.sku)}">${escapeHTML(v.name)}</option>`).join('')}</datalist>`;list();
 }
 function add(){
  if(active==='print_rules')active='material_rates';
  const key=active,row=Object.fromEntries(WarehouseUI.definitions[key].fields.map(([f])=>[f,'']));
  if(key==='stocks')Object.assign(row,{kind:'普通实物',unit:'贴',pricing_mode:'按总价换算',quote_unit:'贴',units_per_quote:1});
  if(key==='links')row.mode='固定数量';
  if(key==='material_rates')row.enabled='是';
  if(key==='print_rules')Object.assign(row,{enabled:'是',lamination_cost:0,flat_cut_cost:0,die_cut_cost:0});
  if(key==='digit_conditions')Object.assign(row,{out_of_range:'建议整单打印',shortage:'建议整单打印'});
  draft.config[key].push(row);query='';changed();render();const record=$$('.warehouse-record',root()).at(-1);if(record){record.open=true;record.scrollIntoView({block:'nearest'});$('input',record)?.focus();}
 }
 async function save(){
  if(busy)return;busy=true;$('#rules-save').disabled=true;$('#rules-save-status').textContent='正在保存…';
  try{draft=await api('/api/warehouse-rules',{method:'POST',body:{revision:draft.revision,basis:draft.basis,config:draft.config}});state.warehouseRules=structuredClone(draft);dirty=false;await loadProducts();render();nav();toast('打印规则已保存，新建产品可以直接选择。');}
  catch(error){$('#rules-save-status').textContent=error.message;toast(error.message,true);}finally{busy=false;$('#rules-save').disabled=!dirty;}
 }
 function edit(event){
  const el=event.target,key=el.dataset.ruleKey;if(!key||busy)return;const row=draft.config[key][Number(el.dataset.ruleIndex)],field=el.dataset.ruleField;row[field]=el.value;changed();
  if(key==='stocks'){
   if(['pricing_mode','kind','unit','quote_unit'].includes(field)){if(row.unit===row.quote_unit)row.units_per_quote=1;list();}
   else{const price=ProductCost.unitCost(row),out=$('[data-rule-price="'+el.dataset.ruleIndex+'"]',root());if(out)out.textContent='库存单位单价：'+(price??'待补齐')+' 元 / '+row.unit+'；计价数量不增加库存。';const value=$('[data-rule-field="cost"]',el.closest('.warehouse-record'));if(value?.readOnly)value.value=price??'';}
  }
 }
 $('#rules-nav').addEventListener('click',()=>void open());
 root().addEventListener('input',e=>{if(e.target.id==='rules-search'){query=e.target.value.toLowerCase();list();return;}if(e.target.tagName!=='SELECT')edit(e);});
 root().addEventListener('change',e=>{if(e.target.tagName==='SELECT')edit(e);});
 root().addEventListener('click',e=>{if(busy)return;const tab=e.target.closest('[data-rules-tab]'),remove=e.target.closest('[data-rule-remove]');if(tab){active=tab.dataset.rulesTab;query='';render();}if(remove){draft.config[active].splice(Number(remove.dataset.ruleRemove),1);changed();list();}if(e.target.closest('#rules-add'))add();if(e.target.closest('#rules-save'))void save();if(e.target.closest('#rules-reload')){const reload=()=>{visible=false;void open();};if(leave(reload))reload();}});
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 return {open,leave,nav};
})();
