(function(root){
 'use strict';
 function infer(product){
  const found=new Set();
  for(const row of product.variants||[]){
   const source=row.source_fields||{},texts=[row.name||'',row.material||'',...Object.entries(source).filter(([key])=>['工艺','覆膜','加工','切割'].some(word=>key.includes(word))).map(([,value])=>value)];
   const text=texts.join('、').normalize('NFKC').replace(/(?:不|无|未)(?:覆)?(?:光膜|亮膜|哑膜|啞膜|亚膜|覆膜|模切|切割)/gu,'');
   const printing=row.supply_mode==='打印定制';
   if(row.print_laminated!==false||!printing){
    const gloss=/光膜|亮膜/u.test(text),matte=/哑膜|啞膜|亚膜/u.test(text);
    if(gloss)found.add('光膜');if(matte)found.add('哑膜');
    if(!gloss&&!matte&&((row.print_laminated===true&&printing)||text.includes('覆膜')))found.add('覆膜');
   }
   if(['die','both'].includes(row.print_cutting))found.add('模切');
   if(['flat','both'].includes(row.print_cutting))found.add('平板切割');
   if(!['die','flat','both'].includes(row.print_cutting)){if(text.includes('模切'))found.add('模切');if(text.includes('平板切割'))found.add('平板切割');}
  }
  return ['光膜','哑膜','覆膜','模切','平板切割'].filter(name=>found.has(name)).join('、');
 }
 const mode=p=>p.process_mode||(p.process?'manual':'auto');
 const api={infer,mode};root.ProductProcess=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
