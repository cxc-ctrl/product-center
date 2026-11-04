(function(root){
  'use strict';
  const hasNumber=v=>v!==''&&v!=null&&Number.isFinite(Number(v))&&Number(v)>=0;
  const workOrder=(v,p={})=>['定制订单','工单定制'].includes(v.supply_mode||p.supply_defaults?.supply_mode);
  const automatic=(v,p={})=>(v.supply_mode||p.supply_defaults?.supply_mode)==='打印定制'&&v.print_cost_source!=='manual';
  const manualCost=(v,p={})=>!workOrder(v,p)&&!automatic(v,p);
  function materials(p){
    const seen=new Set(),names=[];
    for(const value of (p.variants?.length?p.variants.map(v=>v.material||p.material):[p.material])){
      const name=String(value||'').trim(),key=name.normalize('NFKC').replace(/\s+/gu,'').toLowerCase();
      if(key&&!seen.has(key)){seen.add(key);names.push(name);}
    }
    return names;
  }
  function calculate(v){
    if(!manualCost(v)||v.unit_cost==null||v.unit_cost==='')return;
    v.cost_mode='固定整份成本';
    v.cost=hasNumber(v.unit_cost)&&Number(v.pack_qty)>0?Number((Number(v.unit_cost)*Number(v.pack_qty)).toFixed(8)):null;
    if(v.supply_mode==='打印定制'){v.manual_unit_cost=v.unit_cost;v.manual_cost=v.cost;}
  }
  function applyUnitCost(product,value){
    if(!hasNumber(value))return false;
    const rate=Number(value),editable=product.variants.filter(v=>manualCost(v,product));
    if(!editable.length)return false;
    if(rate>100000000||editable.some(v=>rate*Number(v.pack_qty)>100000000))throw Error('每单位成本乘以每份含量不能超过100000000元。');
    for(const row of editable){row.unit_cost=rate;calculate(row);}
    if(product.batch_config){
      product.batch_config.row_defaults={...product.batch_config.row_defaults,unit_cost:rate,cost:null};
      for(const row of product.variants){
        if(!row.batch_key)continue;
        row.batch_overrides=!manualCost(row,product)?[...new Set([...(row.batch_overrides||[]),'unit_cost','cost'])]:(row.batch_overrides||[]).filter(key=>!['unit_cost','cost'].includes(key));
      }
    }
    return true;
  }
  function applyHeader(product,field,value){
    const allowed=['supply_mode','size','pack_qty','pack_unit','price','material','print_per_sheet','note'];
    if(!allowed.includes(field))throw Error('此字段不支持统一修改。');
    if(value===''||value==null||!product.variants.length)return false;
    const numeric=['pack_qty','price','print_per_sheet'].includes(field);
    if(numeric){
      value=Number(value);
      if(!Number.isFinite(value)||value<0||value>100000000)throw Error('请填写有效的非负数字。');
      if(field!=='price'&&(!Number.isInteger(value)||value<1||value>100000))throw Error('数量须为1至100000的整数。');
    }else{
      value=String(value).trim();
      if(!value)return false;
      if(value.length>(field==='note'?1000:160))throw Error('填写内容过长。');
    }
    if(field==='supply_mode'&&!['现货','打印定制','现货优先（按条件）','定制订单'].includes(value))throw Error('制作方式无效。');
    if(field==='pack_unit'&&!['贴','张','枚','个','件','包','卷','套','份'].includes(value))throw Error('含量单位无效。');
    const editable=product.variants.filter(v=>field!=='print_per_sheet'||(v.supply_mode||product.supply_defaults?.supply_mode)==='打印定制');
    if(!editable.length)return false;
    if(field==='pack_qty'&&editable.some(v=>!workOrder(v,product)&&(v.unit_cost??(v.cost!=null&&v.pack_qty>0?v.cost/v.pack_qty:0))*value>100000000))throw Error('每单位成本乘以每份含量不能超过100000000元。');
    for(const row of editable){
      if(field==='pack_qty'&&manualCost(row,product)&&row.unit_cost==null&&row.cost!=null&&row.pack_qty>0)row.unit_cost=Number((row.cost/row.pack_qty).toFixed(8));
      row[field]=value;
      if(field==='pack_qty')calculate(row);
      if(field==='print_per_sheet')row.print_pricing='material';
      if(row.batch_key){
        const overrides=new Set(row.batch_overrides||[]);
        if(['size','price','pack_unit'].includes(field))overrides.delete(field);
        if(field==='pack_qty')overrides.add('pack_qty');
        // A bulk packaging edit must not collapse distinct SKU codes on regeneration.
        if(['pack_qty','pack_unit'].includes(field)){overrides.add('sku');overrides.add('name');}
        row.batch_overrides=[...overrides];
      }
    }
    if(field==='supply_mode'||field==='print_per_sheet'){product.supply_defaults||={};product.supply_defaults[field]=value;}
    if(product.batch_config){
      if(field==='size')product.batch_config.size=value;
      if(field==='pack_unit')product.batch_config.unit=value;
      if(field==='price')product.batch_config.row_defaults={...product.batch_config.row_defaults,price:value};
    }
    return true;
  }
  function issues(p,known=[],shared=null){
    const errors=[],add=(row,field,label)=>errors.push({row,field,message:`第${row+1}行：请填写${label}。`});
    if(!p.variants.length)return [{row:0,field:'name',message:'请至少填写一条完整的销售规格。'}];
    const seen=new Set(),external=new Set(known.filter(other=>other.id!==p.id).flatMap(other=>other.variants.map(v=>v.sku).filter(Boolean)));
    p.variants.forEach((v,i)=>{
      if(v.sku&&(seen.has(v.sku)||external.has(v.sku)))errors.push({row:i,field:'sku',message:`第${i+1}行：SKU编码重复或已被其他产品使用：${v.sku}`});
      seen.add(v.sku);
      for(const [key,label] of [['name','规格名称'],['sku','SKU编码'],['size','尺寸'],['pack_unit','含量单位'],['material','材质']])if(!String(v[key]||'').trim())add(i,key,label);
      if(!Number.isInteger(v.pack_qty)||v.pack_qty<1||v.pack_qty>100000)add(i,'pack_qty','1至100000的整数含量');
      if(automatic(v,p)){
        const cost=typeof ProductCost!=='undefined'?ProductCost.estimate(v,p,known,shared).cost:v.cost;
        if(cost==null)add(i,'material','可计算成本的材质及加工费用');
      }else if(!workOrder(v,p)&&!hasNumber(v.unit_cost)&&!hasNumber(v.cost)){
        const stockAuto=v.cost_mode==='按实物自动计算'&&typeof ProductCost!=='undefined'&&ProductCost.estimate(v,p,known,shared).cost!=null;
        if(!stockAuto)add(i,'unit_cost','每单位成本');
      }
      if(v.unit_cost!=null&&v.unit_cost!==''&&!hasNumber(v.unit_cost))add(i,'unit_cost','有效的非负成本');
      if(!hasNumber(v.price))add(i,'price','销售价');
      if(v.supply_mode==='打印定制'&&(!Number.isInteger(v.print_per_sheet)||v.print_per_sheet<1))add(i,'print_per_sheet','每张可拼数量');
      if(hasNumber(v.cost)&&v.cost>100000000)add(i,'unit_cost','计算后不超过100000000元的成本');
    });
    return errors;
  }
  const api={materials,calculate,issues,workOrder,automatic,manualCost,applyUnitCost,applyHeader};root.EditorFields=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
