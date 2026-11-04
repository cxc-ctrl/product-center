(function(root){
 'use strict';
 const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
 const text=v=>String(v??'').normalize('NFKC').trim();
 function styleName(v,productName=''){
  let name=text(v.name),bracket=name.match(/[【\[]([^】\]]+)[】\]]/);
  if(bracket)return bracket[1].replace(/\s+/g,'');
  const parent=text(productName);if(parent&&name.startsWith(parent))name=name.slice(parent.length);
  return name.replace(/\d+(?:\.\d+)?\s*[xX×*]\s*\d+(?:\.\d+)?\s*(?:cm|mm|厘米|毫米)?/gi,'')
   .replace(/[-—_\s]*\d+\s*(?:贴|张|枚|个|件|包|卷|套|份)(?:装)?\s*$/,'').replace(/^[\s\-—_]+|[\s\-—_]+$/g,'')||text(v.name)||text(v.sku);
 }
 function sizeNumbers(v){const s=text(v.size),nums=s.match(/\d+(?:\.\d+)?/g);return nums?nums.map(n=>Number(n)*(/mm|毫米/i.test(s)?.1:1)):[Infinity];}
 function compare(a,b,parent){
  let n=collator.compare(styleName(a,parent),styleName(b,parent));if(n)return n;
  const x=sizeNumbers(a),y=sizeNumbers(b);for(let i=0;i<Math.max(x.length,y.length);i++){n=(x[i]??0)-(y[i]??0);if(n&&!Number.isNaN(n))return n;}
  return (Number(a.pack_qty)||0)-(Number(b.pack_qty)||0)||collator.compare(text(a.size),text(b.size))||collator.compare(text(a.sku),text(b.sku));
 }
 const fields=['sku','name','supply_mode','size','pack_qty','pack_unit','unit_cost','cost','price','material','print_per_sheet','note','print_cost_source','print_sheet_cost','image_ids'];
 const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
 let product=null,baseline=null,records=[],objects=new WeakMap(),sequence=[],counter=0,ready=false,pending=false;
 function begin(p){product=p;baseline=null;records=[];objects=new WeakMap();sequence=[];counter=0;ready=false;$('#variant-search').value='';$('#variant-sort').value='group';$('#variant-changed-only').checked=false;}
 function record(v){
  if(objects.has(v))return objects.get(v);
  let found=records.find(r=>v.batch_key&&r.batch===v.batch_key)||records.find(r=>v.sku&&r.sku===v.sku);
  if(!found){found={id:counter++,sku:v.sku,batch:v.batch_key,before:null,sort:structuredClone(v)};records.push(found);sequence.push(found.id);}
  objects.set(v,found);return found;
 }
 function capture(){
  product.variants.forEach(v=>{const r=record(v);r.before=structuredClone(v);});
  baseline=structuredClone(product);ready=true;sort();
 }
 function sort(){
  if(!ready)return;
  const mode=$('#variant-sort').value;
  const entries=product.variants.map((v,index)=>({v,index,r:record(v)}));
  entries.sort((a,b)=>mode==='source'?a.index-b.index:mode==='sku'?collator.compare(a.r.sort.sku||'',b.r.sort.sku||'')||a.r.id-b.r.id:compare(a.r.sort,b.r.sort,baseline.name)||a.r.id-b.r.id);
  sequence=entries.map(e=>e.r.id);render();
 }
 const changed=v=>{const r=record(v);return !r.before||fields.some(f=>!equal(v[f],r.before[f]));};
 function query(){return text($('#variant-search').value).toLowerCase().split(/\s+/).filter(Boolean);}
 function filtered(){return query().length>0||$('#variant-changed-only').checked;}
 function render(){
  if(!ready||state.draft!==product)return;
  const body=$('#variants-body');
  const rows=[...body.querySelectorAll('tr[data-row]')];
  rows.sort((a,b)=>sequence.indexOf(record(product.variants[+a.dataset.row]).id)-sequence.indexOf(record(product.variants[+b.dataset.row]).id));
  // Move only freshly rendered/out-of-order rows, never disturb an active input.
  if(rows.some((r,i)=>body.children[i]!==r))for(const row of rows)body.append(row);
  let visible=0,modified=0;const tokens=query(),only=$('#variant-changed-only').checked;
  for(const row of rows){
   const v=product.variants[+row.dataset.row],r=record(v),isChanged=changed(v);if(isChanged)modified++;
   const hay=text([v.name,v.sku,v.size].join(' ')).toLowerCase();
   row.hidden=!row.contains(document.activeElement)&&!!(tokens.some(t=>!hay.includes(t))||only&&!isChanged);if(!row.hidden)visible++;
   row.classList.toggle('variant-edited',isChanged);
   for(const cell of row.cells)cell.classList.remove('variant-cell-edited');
   for(const input of row.querySelectorAll('[data-field]')){
    const f=input.dataset.field,dirty=!r.before||!equal(v[f],r.before[f]);
    if(dirty)input.closest('td')?.classList.add('variant-cell-edited');
   }
   if(!r.before||!equal(v.image_ids,r.before.image_ids))row.cells[0]?.classList.add('variant-cell-edited');
  }
  $('#variant-result-count').textContent=`显示 ${visible} / ${rows.length} 条 · 已修改 ${modified} 条`;
  $('#variant-no-results').hidden=visible>0||rows.length===0;
  const scoped=filtered();$('#variant-scope-note').hidden=!scoped;
  if(scoped)$$('.variant-table thead input,.variant-table thead select,#bulk-variants').forEach(e=>e.disabled=true);
  else $('#bulk-variants').disabled=!ProductAccess.canEdit;
  $('#variant-undo').disabled=!ProductAccess.canEdit||!state.dirty||state.busy||state.uploads>0;
  ProductAccess.apply();
 }
 function schedule(){if(pending)return;pending=true;queueMicrotask(()=>{pending=false;render();});}
 function reveal(index){if(!ready)return;$('#variant-search').value='';$('#variant-changed-only').checked=false;renderVariants();return $(`#variants-body tr[data-row="${index}"]`);}
 function init(){
  $('#variants-body').addEventListener('focusout',schedule);
  $('#variant-search').addEventListener('input',()=>renderVariants());
  $('#variant-search').addEventListener('keydown',e=>{if(e.key==='Enter')e.preventDefault();});
  $('#variant-changed-only').addEventListener('change',()=>renderVariants());
  $('#variant-sort').addEventListener('change',sort);
  $('#variant-clear-search').addEventListener('click',()=>{reveal();$('#variant-search').focus();});
  $('#variant-undo').addEventListener('click',()=>{
   if(!ready||!ProductAccess.canEdit||!state.dirty||state.busy||state.uploads)return;
   openUtility('撤销本次编辑？','<p>恢复到本次打开商品时的内容，包括基础资料、销售规格和图片关联。本次尚未保存的修改将被撤销，已经上传的图片文件不会删除。</p>',[
    {label:'继续编辑',action:closeUtility},{label:'撤销本次编辑',class:'primary',action:()=>{const saved=structuredClone(baseline);closeUtility();openProduct(saved.id||null,false,saved);setEditorTab('variants');toast('已恢复到本次打开商品时的内容。');}}
   ]);
  });
 }
 root.VariantTools={begin,capture,render,schedule,reveal,init,filtered,compare,styleName};
 if(typeof module!=='undefined')module.exports={compare,styleName};
})(globalThis);
