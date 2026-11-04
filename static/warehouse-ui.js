'use strict';
const WarehouseUI=(()=>{
 let selected=0;
 const modes=ProductionMethods.MODES;
 const definitions={
  material_rates:{title:'材质加工方案',help:'标准大张32×46.4cm。每种材质统一维护打印、覆膜和切割单价；产品选择组合方案，填写每张可拼数量和每份含量即可计算成本。未知费用留空。',fields:[['material','材质'],['print_cost','材料及打印费（元/张）','decimal'],['lamination_cost','覆膜费（元/张）','decimal'],['flat_cut_cost','平板切割费（元/张）','decimal'],['die_cut_cost','普通模切费（元/张）','decimal'],['enabled','启用',['是','否']],['note','备注']]},
  stocks:{title:'实物资料',help:'价格只录入一次。例如1000贴40元，系统换算为0.04元/贴；计价数量不增加库存。真实库存仍由仓库盘点。',fields:[['code','实物编码'],['name','实物名称'],['unit','库存单位',['贴','张','枚','个','件','包','卷','套','份']],['size','实物尺寸'],['pricing_mode','计价方式',['按总价换算','直接填单价']],['quote_qty','计价数量','numeric'],['quote_unit','计价单位',['贴','张','枚','个','件','包','卷','套','份']],['units_per_quote','每个计价单位含库存单位数','numeric'],['quote_total','货品总价（元）','decimal'],['cost','单位货品成本（元）','decimal'],['kind','实物类型',['普通实物','数字贴版面']],['color','颜色'],['digit_size','数字尺寸（cm）','decimal'],['start','版面起号','numeric'],['end','版面止号','numeric'],['each','每号个数','numeric'],['note','备注']]},
  links:{title:'库存关联',help:'一份商品可以消耗多种实物。普通商品填写每份消耗数量；数字贴选择按数字范围，由版面组成计算。',fields:[['sku','SKU编码'],['stock_code','实物编码'],['mode','扣减方式',['固定数量','按数字范围']],['quantity','每份消耗数量','numeric'],['note','备注']]},
  print_rules:{title:'原有打印规则',help:'固定纸张32×46.4cm。四项价格相加，不用的加工填0，未知价格留空；只用于预计成本，实际成本另行确认。',fields:[['code','打印规则编码'],['name','打印产品名称'],['material','材质'],['per_sheet','可拼数量（个/张）','numeric'],['print_cost','材料及打印费（元/张）','decimal'],['lamination_cost','覆膜费（元/张）','decimal'],['flat_cut_cost','平板切割费（元/张）','decimal'],['die_cut_cost','普通模切费（元/张）','decimal'],['enabled','启用',['是','否']],['note','备注']]},
  digit_conditions:{title:'数字贴条件',help:'按颜色、尺寸设置现货数字范围。超范围或已盘点库存不足时，只建议打印，必须由仓库人工确认整单转入。未盘点、备注不清或规则冲突先核对。',fields:[['code','条件编码'],['color','颜色'],['size','数字尺寸（cm）','decimal'],['start','现货起号','numeric'],['end','现货止号','numeric'],['out_of_range','超范围处理',['建议整单打印','人工核对']],['shortage','库存不足处理',['建议整单打印','人工核对']],['print_rule_code','打印规则编码'],['note','备注']]},
 };
 const root=()=>$('#warehouse-editor');
 function config(){state.draft.warehouse_config||={};for(const key of Object.keys(definitions))state.draft.warehouse_config[key]||=[];return state.draft.warehouse_config;}
 function choices(key){const rows=state.warehouseRules?.config?.[key]||[...config()[key],...state.products.filter(p=>!p.archived).flatMap(p=>p.warehouse_config?.[key]||[])];return [...new Set(rows.map(r=>r.code).filter(Boolean))];}
 const isDigitSupply=row=>row?.supply_mode==='现货优先（按条件）';
 const label=ProductionMethods.label;
 const options=(values,current)=>'<option value="">待填写</option>'+[...new Set([...values,...(current?[current]:[])])].map(v=>`<option value="${escapeHTML(v)}" ${v===current?'selected':''}>${escapeHTML(label(v))}</option>`).join('');
 function ruleOptions(key,current,values){const type=key==='print_rule_code'?'print_rules':key==='digit_condition_code'?'digit_conditions':null;if(!type)return options(values,current);const rows=state.warehouseRules?.config[type]||[];return '<option value="">待填写</option>'+[...new Set([...values,...(current?[current]:[])])].map(code=>{const r=rows.find(r=>r.code===code),name=r?.name||[r?.color,r?.size?String(r.size)+'cm':''].filter(Boolean).join(' ');return `<option value="${escapeHTML(code)}" ${code===current?'selected':''}>${escapeHTML(name?name+' · '+code:code)}</option>`;}).join('');}
 function inherit(rows){const defaults=state.draft?.supply_defaults;if(!defaults)return;for(const row of rows)for(const key of ['supply_mode','print_rule_code','digit_condition_code',...MaterialPrinting.keys])if(row[key]===undefined&&defaults[key]!==undefined)row[key]=defaults[key];}
 function printingFields(v,scope){
  if(v.supply_mode==='定制订单'||isDigitSupply(v)||!InventoryModel.printing(v))return '';
  const attr=key=>`data-print-${scope}="${key}"`,method=MaterialPrinting.method(v);
  const select=(key,title,values,current)=>`<label class="field">${title}<select ${attr(key)}>${values.map(([value,text])=>`<option value="${value}" ${String(current)===value?'selected':''}>${escapeHTML(text)}</option>`).join('')}</select></label>`;
  const choose=select('print_cost_source','成本来源',[['auto','按打印方案自动计算'],['manual','手动成本']],v.print_cost_source||'auto')+(method==='legacy'?select('print_pricing','打印计价',[['material','改用材质加工方案'],['legacy','沿用原有规则']],method):'');
  if(method==='legacy')return choose+`<label class="field">原有打印规则<select ${attr('print_rule_code')}>${ruleOptions('print_rule_code',v.print_rule_code,choices('print_rules'))}</select></label>`;
  const rates=state.warehouseRules?.config.material_rates||[],material=v.material||state.draft.material||'';
  const values=[...new Set([...rates.filter(r=>r.enabled==='是').map(r=>r.material),...(material?[material]:[])])];
  const selectedScheme=JSON.stringify([material,!!v.print_laminated,v.print_cutting||'none']);
  const cutting=[['die','普通模切'],['flat','平板切割']];
  const schemes=material?[false,true].flatMap(laminated=>cutting.map(([cut,name])=>{
    const value=JSON.stringify([material,laminated,cut]);
    return `<option value="${escapeHTML(value)}" ${value===selectedScheme?'selected':''}>${escapeHTML((laminated?'覆膜':'不覆膜')+'－'+name)}</option>`;
  })).join(''):'';
  return choose+`<label class="field">打印材质<select ${attr('material')}><option value="">先选择材质</option>${values.map(m=>`<option value="${escapeHTML(m)}" ${m===material?'selected':''}>${escapeHTML(m)}</option>`).join('')}</select></label><label class="field">加工方式<select ${attr('scheme')} ${material?'':'disabled'}><option value="">${material?'选择覆膜及切割方式':'请先选择材质'}</option>${schemes}</select></label><label class="field">每张可拼数量<input ${attr('print_per_sheet')} type="number" min="1" max="100000" step="1" value="${escapeHTML(v.print_per_sheet)}" placeholder="例如50"></label>`;
 }
 function editPrinting(event){
  const el=event.target,key=el.dataset.printDefault||el.dataset.printVariant;if(!key||!state.draft)return;
  if(key==='scheme'&&!el.value)return;
  if(key==='print_cost_source'){
   const targets=el.dataset.printDefault?state.draft.variants:[state.draft.variants[selected]];
   for(const row of targets)MaterialPrinting.setCostSource(row,el.value);
   if(el.dataset.printDefault){state.draft.supply_defaults||={};state.draft.supply_defaults.print_cost_source=el.value;}
   setDirty();renderVariants();render();return;
  }

  let changes;
  if(key==='scheme'){const [material,laminated,cutting]=JSON.parse(el.value);changes={material,print_pricing:'material',print_laminated:laminated,print_cutting:cutting};}
  else changes={[key]:key==='print_per_sheet'?(el.value===''?null:Number(el.value)):key==='print_laminated'?el.value==='true':el.value};
  if(el.dataset.printDefault){
   state.draft.supply_defaults||={};
   for(const [field,value] of Object.entries(changes)){
    if(field==='material'){state.draft.material=value;$('[name="material"]',$('#product-form')).value=value;}
    else state.draft.supply_defaults[field]=value;
   }
   for(const row of state.draft.variants)Object.assign(row,changes);
  }else Object.assign(state.draft.variants[selected],changes);
  setDirty();renderVariants();
  if(event.type==='input'&&key==='print_per_sheet'){
   const output=$('#warehouse-current-cost'),row=state.draft.variants[selected];
   if(output&&row){const result=ProductCost.estimate(row,state.draft,state.products,state.warehouseRules?.config);output.textContent=costText(result);if(output.nextElementSibling)output.nextElementSibling.textContent=result.note+'。销售价人工填写，打包费、快递另计。';}
   return;
  }
  render();
 }
 function inventoryHelp(){
  const mode=state.draft.supply_defaults?.supply_mode;
  if(mode==='定制订单')return '<p class="muted">工单定制走独立流程，这里仅记录制作方式，不参与ERP/普通建档导出。</p>';
  if(mode==='打印定制')return '<p class="muted">选择材质和加工方式，填写每张可拼数量后自动计算参考成本。</p>';
  if(mode==='现货优先（按条件）')return '<p class="muted">按仓库已配置的条件优先使用现货；当前条件仍按颜色、数字范围和库存等规则判断。</p>';
  return '<p class="muted">这里只标记仓库囤货；实物关联、实际数量及库位在仓库管理。</p>';
 }
 function inventorySummary(){const node=$('#inventory-build-summary');if(node)node.hidden=true;}
 function defaultModeOptions(current,values){
  if(ProductionMethods.modes(state.draft).length<2)return ruleOptions('supply_mode',current,values);
  return '<option value="__mixed__" disabled selected>多种制作方式（选择后统一）</option>'+ruleOptions('supply_mode','',values);
 }
 function renderDefaults(){
  if(!state.draft)return;const d=state.draft.supply_defaults||{};
  for(const host of $$('.product-supply-settings'))host.innerHTML=`<h3>制作方式</h3><div class="warehouse-fields supply-fields">${[['supply_mode','制作方式',modes]].filter(([key])=>(key!=='digit_condition_code'||isDigitSupply(d))&&(key!=='print_rule_code'||InventoryModel.printing(d)||isDigitSupply(d))).map(([key,title,values])=>`<label class="field">${title}<select data-supply-default="${key}">${key==='supply_mode'?defaultModeOptions(d[key],values):ruleOptions(key,d[key],values)}</select></label>`).join('')}${printingFields(d,'default')}</div>${ProductionMethods.modes(state.draft).length>1?'<p class="muted">当前商品含多种制作方式：'+ProductionMethods.modes(state.draft).map(label).map(escapeHTML).join('、')+'。以各销售规格的选择为准。</p>':''}${inventoryHelp()}<details class="supply-help"><summary>应用说明</summary><p class="muted">更改上方制作方式会应用到全部规格，新增规格自动沿用；个别规格可在“销售规格”的制作方式列单独修改。库存配置在仓库管理。</p></details>`;
  inventorySummary();
 }
 function shared(key){
  const cfg=config(),vs=state.draft.variants,refs=key==='stocks'?cfg.links.map(r=>r.stock_code):key==='digit_conditions'?vs.map(v=>v.digit_condition_code):key==='print_rules'?[...vs.map(v=>v.print_rule_code),...state.products.flatMap(p=>p.warehouse_config?.digit_conditions||[]).filter(c=>vs.some(v=>v.digit_condition_code===c.code)).map(c=>c.print_rule_code)]:[];
  return state.products.filter(p=>p.id!==state.draft.id&&!p.archived).flatMap(p=>(p.warehouse_config?.[key]||[]).filter(r=>refs.includes(r.code)&&!cfg[key].some(local=>local.code===r.code)).map(r=>({code:r.code,owner:p.name})));
 }
 function fields(key,row){return definitions[key].fields.filter(([f])=>key!=='stocks'||(!['color','digit_size','start','end','each'].includes(f)||row.kind==='数字贴版面')&&(!['quote_qty','quote_unit','quote_total','units_per_quote'].includes(f)||row.pricing_mode==='按总价换算'));}
 const costText=r=>r.cost==null?r.note:'¥'+r.cost.toLocaleString('zh-CN',{maximumFractionDigits:8})+' / 份（仅货品）';
 function printingReference(v){if(v.supply_mode!=='打印定制'||MaterialPrinting.method(v)!=='material')return '';const e=MaterialPrinting.estimate(v,state.draft.material,state.warehouseRules?.config.material_rates||[]);return `<p><strong>按材质与工序预计：</strong>${escapeHTML(costText(e))}<br><small>${escapeHTML(e.note)}。仓库按实际购买份数重新计算张数，实际成本另行确认。</small></p>`;}

 function render(){
  if(!state.draft)return;const opened=new Set([...root().querySelectorAll('.warehouse-record[open]')].map(r=>r.dataset.record));const cfg=config();selected=Math.min(selected,Math.max(0,state.draft.variants.length-1));const v=state.draft.variants[selected];
  $('#warehouse-sync-one').hidden=!state.draft.id;
  const sync=state.warehouseSyncs?.[state.draft.id],syncInfo=syncStatus(state.draft);
  root().innerHTML=`<div class="warehouse-intro"><div><h3>制作方式配置</h3><p>选择制作方式及打印参数，普通现货同步时自动建立实物关联，数字贴和组合款在仓库维护规则；同步更新产品资料，保留仓库实际数量和历史成本。</p></div><a class="button secondary small" href="/warehouse-template-v5.xlsx" download="材质打印计价_空白模板_V5.xlsx">下载导入范本</a></div><p class="warehouse-sync-state">${escapeHTML(syncInfo.label)} · ${escapeHTML(syncInfo.detail)}<br>${sync?'上次同步：'+new Date(sync.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+(sync.revision===state.draft.revision?'':' · 待重新同步'):'尚未同步到新城仓库'}</p>
  <section class="warehouse-section"><h3>销售SKU的制作方式</h3>${v?`<label class="field">当前销售规格<select id="warehouse-sku">${state.draft.variants.map((r,i)=>`<option value="${i}" ${i===selected?'selected':''}>${escapeHTML(r.name||'未命名规格')} · ${escapeHTML(r.sku||'SKU待填写')}</option>`).join('')}</select></label><div class="warehouse-fields supply-fields">${[['supply_mode','制作方式',modes],['cost_mode','成本方式',[ProductCost.AUTO,ProductCost.FIXED]]].filter(([key])=>(key!=='cost_mode'||!InventoryModel.printing(v))&&(key!=='digit_condition_code'||isDigitSupply(v))&&(key!=='print_rule_code'||InventoryModel.printing(v)||isDigitSupply(v))).map(([key,label,values])=>`<label class="field">${label}<select data-supply="${key}">${ruleOptions(key,key==='cost_mode'?ProductCost.mode(v):v[key],values)}</select></label>`).join('')}${printingFields(v,'variant')}</div><div class="warehouse-cost-summary" ${v.supply_mode==='定制订单'?'hidden':''}><strong>当前每份参考成本：</strong><output id="warehouse-current-cost">${escapeHTML(costText(ProductCost.estimate(v,state.draft,state.products,state.warehouseRules?.config)))}</output><p>${escapeHTML(ProductCost.estimate(v,state.draft,state.products,state.warehouseRules?.config).note)}。数码打印默认按当前材质及加工方案自动计算，也可选择手动成本；实际成本在仓库核算；销售价人工填写，打包费、快递另计。</p>${printingReference(v)}</div>${!InventoryModel.printing(v)&&ProductCost.mode(v)===ProductCost.FIXED?`<label class="field">固定整份货品成本（元/份）<input id="warehouse-fixed-cost" inputmode="decimal" value="${escapeHTML(v.cost)}" placeholder="特殊整包商品填写，未知留空"></label>`:''}<button type="button" class="text-button" id="warehouse-apply-all">应用到全部销售规格</button><p class="muted">资料完整的普通现货同步后可直接盘点；数字贴和组合款的实物关联由仓库维护；按条件处理的具体条件在仓库创建管理。工单定制仅记录制作方式，按独立流程处理，不参与ERP/普通建档导出。</p>`:'请先在销售规格中建立SKU。'}</section>
  <section class="warehouse-section"><h3>通用规则已移到左侧模块</h3><p class="muted">左侧打印规则只维护材质加工方案；数字贴条件在仓库维护。</p><button type="button" class="button secondary small" id="product-open-rules">前往打印规则</button></section>`;
  renderDefaults();
 }
 function load(){if(!state.draft.supply_defaults&&state.draft.variants.length){const rows=state.draft.variants,first=rows[0],defaults={};for(const key of ['supply_mode','print_rule_code','digit_condition_code',...MaterialPrinting.keys])if(first[key]!==undefined&&rows.every(v=>v[key]===first[key]))defaults[key]=first[key];state.draft.supply_defaults=defaults;}inherit(state.draft.variants);selected=0;root().innerHTML='';render();}
 async function sync(ids){
  if(state.busy||utilityBusy)return;if(!ids.length){toast('请选择需要同步的产品',true);return;}
  if(dialog.open&&state.dirty){toast('请先保存商品资料，再同步到仓库。',true);return;}
  utilityBusy=true;
  openUtility('正在核对同步资料','<p>正在检查商品、实物关联和打印规则，请稍候。</p>');$('#utility-close').disabled=true;
  try{const preview=await api('/api/warehouse-sync/preview',{method:'POST',body:{ids}});utilityBusy=false;$('#utility-close').disabled=false;
   openUtility('同步到新城仓库',`<p>本次 ${preview.products} 个产品、${preview.skus} 个销售SKU。</p><div class="warehouse-preview"><span>新增SKU <strong>${preview.new_skus}</strong></span><span>更新已有SKU <strong>${preview.existing_skus}</strong></span><span>独立成品 <strong>${preview.direct_skus||0}</strong></span><span>共用实物SKU <strong>${preview.shared_skus||0}</strong></span><span>实物资料 <strong>${preview.stocks}</strong></span><span>自动新建实物 <strong>${preview.auto_stocks||0}</strong></span><span>自动关联SKU <strong>${preview.auto_linked_skus||0}</strong></span><span>打印规则 <strong>${preview.rules}</strong></span><span>含图片SKU <strong>${preview.image_skus||0}</strong></span></div>${(preview.association_issues||[]).length?`<div class="warehouse-price-changes"><strong>以下规格保留待关联，请到仓库核对：</strong>${preview.association_issues.map(r=>`<p>${escapeHTML(r.codes.join('、'))}：${escapeHTML(r.reason)}</p>`).join('')}</div>`:''}${(preview.cost_changes||[]).length?`<div class="warehouse-price-changes"><strong>以下实物将采用前端新单价：</strong>${preview.cost_changes.map(c=>`<p>${escapeHTML(c.name)}（${escapeHTML(c.code)}）：${c.old} → ${c.next} 元/${escapeHTML(c.unit)}</p>`).join('')}</div>`:''}<p>会同步产品名称、规格、尺寸、材质、每份含量、SKU图片、制作方式、计价资料和相关规则。同款不同包装自动共用库存，不同口味分别建档。新增实物显示待盘点，填写实际数量后才能扣库存。同一个SKU更新现有资料，不重复建立。仓库实际数量、库位、预警线、盘点时间、库存流水及历史订单成本保持原值。</p>`,[{label:'取消',action:closeUtility},{label:'确认同步',class:'primary',action:async button=>{button.disabled=true;utilityBusy=true;$('#utility-close').disabled=true;try{const done=await api('/api/warehouse-sync/commit',{method:'POST',body:{token:preview.token}});utilityBusy=false;closeUtility();await loadProducts();if(state.draft)render();toast(`已同步 ${done.products} 个产品；已有资料已更新，仓库实际库存保持不变。`);}catch(e){await loadProducts();toast(e.message+'；可再次点击继续同步，已完成批次不会重复建档。',true);}finally{utilityBusy=false;button.disabled=false;$('#utility-close').disabled=false;}}}]);
  }catch(e){await loadProducts();utilityBusy=false;$('#utility-close').disabled=false;openUtility('同步前需补齐资料',`<p>${escapeHTML(e.message)}</p>`,[{label:'返回编辑',class:'primary',action:closeUtility}]);}
 }
 async function pullCosts(){
  if(state.dirty){toast('请先保存当前产品，再取回成本。',true);return;}if(utilityBusy||state.busy)return;utilityBusy=true;
  openUtility('正在读取仓库成本','<p>正在核对关联实物，请稍候。</p>');$('#utility-close').disabled=true;
  try{const p=await api('/api/warehouse-costs/preview',{method:'POST',body:{ids:[state.draft.id]}});utilityBusy=false;$('#utility-close').disabled=false;
   if(!p.changes.length){openUtility('仓库成本核对完成',`<p>没有需要更新的单价。${p.missing?'另有 '+p.missing+' 条仓库成本尚未填写。':''}</p>`,[{label:'知道了',class:'primary',action:closeUtility}]);return;}
   openUtility('确认采用仓库单价',`<p>以下 ${p.changes.length} 条前端实物资料将改用仓库补录单价。共享这些实物的销售规格自动重新计算。历史订单成本保持原值。</p><div class="warehouse-price-changes">${p.changes.map(c=>`<p><strong>${escapeHTML(c.name)}</strong>（${escapeHTML(c.code)}）<br>前端 ${c.old==null?'未填写':c.old} → 仓库 ${c.next} 元/${escapeHTML(c.unit)}</p>`).join('')}</div><p>取回后以直接单价保存，不把原报价数量误当作新报价。</p>`,[{label:'取消',action:closeUtility},{label:'确认更新前端成本',class:'primary',action:async b=>{b.disabled=true;utilityBusy=true;$('#utility-close').disabled=true;try{const r=await api('/api/warehouse-costs/commit',{method:'POST',body:{token:p.token}});await loadProducts();const latest=state.products.find(x=>x.id===state.draft.id);if(latest)state.draft=structuredClone(latest);renderVariants();render();utilityBusy=false;closeUtility();toast('已更新 '+r.count+' 条实物单价。其他资料可再正常同步到仓库。');}catch(e){toast(e.message,true);}finally{utilityBusy=false;b.disabled=false;$('#utility-close').disabled=false;}}}]);
  }catch(e){utilityBusy=false;$('#utility-close').disabled=false;openUtility('成本核对未完成','<p>'+escapeHTML(e.message)+'</p>',[{label:'返回',action:closeUtility}]);}
 }
 function init(){
  document.addEventListener('change',editPrinting);
  document.addEventListener('input',event=>{if(event.target.matches('[data-print-default="print_per_sheet"],[data-print-variant="print_per_sheet"]'))editPrinting(event);});
  document.addEventListener('change',e=>{if(e.target.dataset.inventoryDefault&&state.draft){const key=e.target.dataset.inventoryDefault;state.draft.inventory_defaults||={mode:'待关联',auto_link:false};state.draft.inventory_defaults[key]=key==='auto_link'?e.target.checked:e.target.value;if(key==='mode'){if(e.target.value==='共用库存')state.draft.inventory_defaults.auto_link=true;for(const v of state.draft.variants){v.inventory_mode=e.target.value;if(v.inventory_mode!=='共用库存')v.stock_code='';}}InventoryModel.apply(state.draft);setDirty();renderVariants();render();return;}const key=e.target.dataset.supplyDefault;if(!key||!state.draft)return;state.draft.supply_defaults||={supply_mode:'',print_rule_code:'',digit_condition_code:''};if(key==='supply_mode')ProductionMethods.applyAll(state.draft,e.target.value);else{state.draft.supply_defaults[key]=e.target.value;for(const v of state.draft.variants)v[key]=e.target.value;}setDirty();renderVariants();render();});

  root().addEventListener('change',e=>{if(e.target.id==='warehouse-sku'){selected=Number(e.target.value);render();return;}if(e.target.dataset.supply){const v=state.draft.variants[selected];v[e.target.dataset.supply]=e.target.value;if(e.target.dataset.supply==='cost_mode'&&v.cost_mode===ProductCost.AUTO)v.cost=null;if(['cost_mode','supply_mode'].includes(e.target.dataset.supply)){renderVariants();render();}setDirty();}if(['pricing_mode','kind','unit','quote_unit'].includes(e.target.dataset.field)){const r=config()[e.target.dataset.config][Number(e.target.dataset.row)];if(r.pricing_mode==='按总价换算'&&r.unit===r.quote_unit)r.units_per_quote=1;render();}});
  root().addEventListener('input',e=>{if(e.target.id==='warehouse-fixed-cost'){state.draft.variants[selected].cost=e.target.value;setDirty();}const key=e.target.dataset.config;if(key){config()[key][Number(e.target.dataset.row)][e.target.dataset.field]=e.target.value;setDirty();if(key==='stocks'){const i=Number(e.target.dataset.row),r=config().stocks[i],price=ProductCost.unitCost(r),record=e.target.closest('.warehouse-record');const out=record.querySelector('[data-price-result]');if(out)out.textContent=(price==null?'单价待补齐':'库存单位单价：'+price+'元 / '+r.unit)+'；计价数量不计入库存。';const input=record.querySelector('[data-field=cost]');if(input?.readOnly)input.value=price??'';}}const current=$('#warehouse-current-cost');if(current&&state.draft.variants[selected])current.textContent=costText(ProductCost.estimate(state.draft.variants[selected],state.draft,state.products,state.warehouseRules?.config));});
  root().addEventListener('click',e=>{const add=e.target.closest('[data-add-config]'),remove=e.target.closest('[data-remove-config]');if(add){const key=add.dataset.addConfig;const row=Object.fromEntries(definitions[key].fields.map(([f])=>[f,'']));if(key==='links'){row.sku=state.draft.variants[selected]?.sku||'';row.mode='固定数量';}if(key==='stocks'){row.kind='普通实物';row.unit='贴';row.pricing_mode='按总价换算';row.quote_unit='贴';row.units_per_quote=1;}if(key==='print_rules'){row.material=state.draft.material||'';row.enabled='是';row.lamination_cost=0;row.flat_cut_cost=0;row.die_cut_cost=0;}if(key==='digit_conditions'){row.out_of_range='建议整单打印';row.shortage='建议整单打印';}config()[key].push(row);setDirty();render();}if(remove){config()[remove.dataset.removeConfig].splice(Number(remove.dataset.row),1);setDirty();render();}if(e.target.id==='product-open-rules'){if(state.dirty){toast('请先保存当前产品，再维护通用规则。',true);return;}dialog.close();state.draft=null;void RulesUI.open();}if(e.target.id==='warehouse-pull-costs')void pullCosts();if(e.target.id==='warehouse-apply-all'){const v=state.draft.variants[selected];for(const r of state.draft.variants)for(const key of ['supply_mode','print_rule_code','digit_condition_code',...MaterialPrinting.keys])if(v[key]!==undefined)r[key]=v[key];setDirty();toast('已应用到全部规格，保存产品后生效。');}});
  $('#warehouse-sync-one').addEventListener('click',()=>void sync([state.draft.id]));$('#warehouse-sync-selected').addEventListener('click',()=>void sync([...state.selected]));
 }
 return {load,render,init,sync,definitions,fields,options,choices,inherit,renderDefaults,inventorySummary};
})();
WarehouseUI.init();
