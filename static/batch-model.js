(function(root){
  'use strict';
  const SHARED_FIELDS=['size','cost','unit_cost','price'];
  const AUTO_FIELDS=['name','sku','size','pack_qty','pack_unit','image_ids','cost','unit_cost','price'];
  function letter(index){let value='';for(index++;index>0;index=Math.floor((index-1)/26))value=String.fromCharCode(65+(index-1)%26)+value;return value;}
  function designName(config,design){return config.design_names?.[design]||design+'款';}
  function generatedName(config,design,quantity,unit){return config.name+(config.count===1&&config.omit_single_design&&!config.design_names?.[design]?'':'-'+designName(config,design))+'-'+quantity+unit;}
  function inferDesignNames(config,rows){
    config.design_names||={};
    for(let i=0;i<config.count;i++){
      const design=letter(i);if(Object.hasOwn(config.design_names,design))continue;
      const group=rows.filter(row=>row.batch_key?.split(':')[0]===design);if(!group.length)continue;
      const labels=group.map(row=>{const prefix=config.name+'-',suffix='-'+row.pack_qty+row.pack_unit;return row.name?.startsWith(prefix)&&row.name.endsWith(suffix)?row.name.slice(prefix.length,-suffix.length):'';});
      if(labels[0]&&labels[0].length<=80&&labels.every(label=>label===labels[0])&&labels[0]!==design+'款')config.design_names[design]=labels[0];
    }
  }
  function renameDesign(config,rows,design,value){
    const name=String(value).trim();if(name.length>80)throw Error('款式或口味名称最多80字');
    if(!Array.from({length:config.count},(_,i)=>letter(i)).includes(design))throw Error('款式不存在');
    config.design_names||={};if(name)config.design_names[design]=name;else delete config.design_names[design];
    for(const row of rows)if(row.batch_key?.split(':')[0]===design){row.name=generatedName(config,design,row.pack_qty,row.pack_unit);row.batch_overrides=(row.batch_overrides||[]).filter(field=>field!=='name');}
  }
  function normalize(raw){
    const c={...raw,name:String(raw.name||'').trim(),count:Number(raw.count),prefix1:String(raw.prefix1||'').trim().toUpperCase(),prefix2:String(raw.prefix2||'').trim().toUpperCase(),initials:String(raw.initials||'').trim().toUpperCase(),unit:raw.unit||'贴',size:String(raw.size||'').trim(),auto_initials:raw.auto_initials!==false,design_images:raw.design_images||{},excluded_keys:raw.excluded_keys||[]};
    c.quantities=Array.isArray(raw.quantities)?raw.quantities.map(Number):String(raw.quantities||'').trim().split(/[,，、;；\s]+/).filter(Boolean).map(Number);
    if(!c.name||c.name.length>160)throw Error('请填写产品名称，最多160字');
    if(!Number.isInteger(c.count)||c.count<1||c.count>200)throw Error('款数需要填写1至200的整数');
    for(const [key,label,max] of [['prefix1','SKU第一层',32],['prefix2','SKU第二层',32],['initials','产品首拼',80]])if(!new RegExp('^[A-Z0-9]{1,'+max+'}$').test(c[key]))throw Error(label+'请填写英文字母或数字');
    if(!c.quantities.length||c.quantities.length>50||c.quantities.some(q=>!Number.isInteger(q)||q<1||q>100000))throw Error('数量规格请填写1至100000的整数，用逗号分开');
    if(new Set(c.quantities).size!==c.quantities.length)throw Error('数量规格不能重复');
    if(c.count*c.quantities.length>1000)throw Error('款数乘以数量规格最多生成1000行');
    if(!['贴','张','枚','个','件','包','卷','套','份'].includes(c.unit))throw Error('请选择数量单位');
    if(c.size.length>160)throw Error('尺寸最多160字');
    if(raw.design_names!=null&&(typeof raw.design_names!=='object'||Array.isArray(raw.design_names)||Object.keys(raw.design_names).length>200||Object.entries(raw.design_names).some(([key,value])=>! /^[A-Z]{1,3}$/.test(key)||typeof value!=='string'||value.length>80)))throw Error('款式或口味名称无效');
    c.design_names=Object.fromEntries(Object.entries(raw.design_names||{}).map(([key,value])=>[key,value.trim()]).filter(([,value])=>value));
    if(raw.omit_single_design!==undefined&&typeof raw.omit_single_design!=='boolean')throw Error('单款命名设置无效');
    return c;
  }
  function generate(raw,previous=[],cache={}){
    const c=normalize(raw),known={...cache};
    for(const row of previous)if(row.batch_key)known[row.batch_key]=row;
    const rows=[];
    for(let index=0;index<c.count;index++)for(const quantity of c.quantities){
      const design=letter(index),key=design+':'+quantity;
      if(c.excluded_keys.includes(key))continue;
      const old=known[key],row=old?structuredClone(old):{sku:'',name:'',erp_code:'',size:'',pack_qty:null,pack_unit:'',cost:null,cost_mode:'按实物自动计算',price:null,shipping:null,material:'',inventory_mode:'',stock_code:'',note:'',image_ids:[]};
      const overrides=new Set(row.batch_overrides||[]),qty=overrides.has('pack_qty')?row.pack_qty:quantity,unit=overrides.has('pack_unit')?row.pack_unit:c.unit;
      const generated={name:generatedName(c,design,qty,unit),sku:[c.prefix1,c.prefix2,c.initials,design,qty].join('-'),size:c.size,pack_qty:quantity,pack_unit:c.unit,image_ids:c.design_images[design]||[]};
      for(const field of ['cost','unit_cost','price'])if(Object.hasOwn(c.row_defaults||{},field))generated[field]=c.row_defaults[field];
      for(const field of AUTO_FIELDS)if(!overrides.has(field)&&Object.hasOwn(generated,field))row[field]=structuredClone(generated[field]);
      row.batch_key=key;row.batch_overrides=[...overrides];rows.push(row);
    }
    const result=rows.concat(previous.filter(row=>!row.batch_key));if(result.length>1000)throw Error('加上手动添加的规格后超过1000行，请减少数量');return result;
  }
  function markOverride(row,field){if(row.batch_key&&AUTO_FIELDS.includes(field))row.batch_overrides=[...new Set([...(row.batch_overrides||[]),field])];}
  function sharedEdit(config,rows,index,field){
    if(!SHARED_FIELDS.includes(field)||!rows[index]?.batch_key)return;
    const row=rows[index];
    if(index!==0){markOverride(row,field);return;}
    if(field==='size')config.size=row.size;else{config.row_defaults||={};config.row_defaults[field]=row[field];}
    row.batch_overrides=(row.batch_overrides||[]).filter(key=>key!==field);
    for(const other of rows.slice(1))if(other.batch_key&&!(other.batch_overrides||[]).includes(field))other[field]=row[field];
  }
  function fillImages(config,ids){
    config.design_images||={};const queue=[...ids];
    for(let index=0;index<config.count&&queue.length;index++){const design=letter(index);if(!config.design_images[design]?.length)config.design_images[design]=[queue.shift()];}
    return queue;
  }
  function swapImages(config,source,target){
    const valid=Array.from({length:config.count},(_,i)=>letter(i));
    if(source===target||!valid.includes(source)||!valid.includes(target))return;
    const images=config.design_images||={};[images[source],images[target]]=[[...(images[target]||[])],[...(images[source]||[])]];
  }
  function issues(rows,otherProducts=[],ownId){
    const errors=[],seen=new Set(),external=new Set(otherProducts.filter(p=>p.id!==ownId).flatMap(p=>p.variants.map(v=>v.sku).filter(Boolean)));
    for(const row of rows){if(row.batch_key&&(!Number.isInteger(row.pack_qty)||row.pack_qty<1||row.pack_qty>100000))errors.push('每份含量需要填写1至100000的整数');if(!row.sku){errors.push('存在未填写SKU的规格');continue;}if(seen.has(row.sku))errors.push('SKU重复：'+row.sku);if(external.has(row.sku))errors.push('SKU已被其他产品使用：'+row.sku);if(row.sku.length>160)errors.push('SKU过长：'+row.sku);seen.add(row.sku);}
    return [...new Set(errors)];
  }
  const api={AUTO_FIELDS,SHARED_FIELDS,letter,designName,generatedName,inferDesignNames,renameDesign,normalize,generate,markOverride,sharedEdit,fillImages,swapImages,issues};root.BatchModel=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
