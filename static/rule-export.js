(function(root){
 'use strict';
 const HEADERS=['商品编码','商品名称','成本','长','宽','数量'];
 const unitFactor=u=>/^(mm|毫米)$/.test(u)?0.1:1;
 function dimensions(value){
  const text=String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
  const n='(\\d+(?:\\.\\d+)?)',u='(cm|mm|厘米|毫米)?';
  const pair=text.match(new RegExp('^'+n+u+'[x×*＊✕]'+n+u+'(?:[（(]?(?:圆形|方形|长方形|长款|正方形)[）)]?)?$'));
  const positive=(a,b)=>a>0&&b>0?[Number(a.toFixed(8)),Number(b.toFixed(8))]:null;
  if(pair)return positive(Number(pair[1])*unitFactor(pair[2]||pair[4]),Number(pair[3])*unitFactor(pair[4]||pair[2]));
  const circle=text.match(new RegExp('^(?:直径|Φ|φ|ø|圆形)'+n+u+'(?:[（(]?圆形[）)]?)?$'))||text.match(new RegExp('^'+n+u+'[（(]?圆形[）)]?$'));
  if(circle){const diameter=Number(circle[1])*unitFactor(circle[2]);return positive(diameter,diameter);}
  return null;
 }
 const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 function rows(product,costOf){
  if(!product?.variants?.length)throw Error('当前商品没有销售规格可导出。');
  const warnings=[];
  const data=product.variants.map((v,i)=>{
   const size=dimensions(v.size),cost=number(costOf(v)),quantity=number(v.pack_qty);
   if(!size)warnings.push(`第${i+1}行（${v.sku||v.name||'未命名'}）尺寸无法拆分，长、宽已留空。`);
   if(cost==null&&!['定制订单','工单定制'].includes(v.supply_mode||product.supply_defaults?.supply_mode))warnings.push(`第${i+1}行成本待补齐，已留空。`);
   return [String(v.sku||''),String(v.name||''),cost,size?.[0]??null,size?.[1]??null,quantity];
  });
  return {data:[HEADERS,...data],warnings};
 }
 const xml=v=>String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
 // Small uncompressed ZIP writer keeps exports local, including unsaved edits.
 function zip(files){
  const encode=s=>new TextEncoder().encode(s),parts=[],central=[];let offset=0;
  const crc=bytes=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let bit=0;bit<8;bit++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const header=(length,values)=>{const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);for(const [at,value,size] of values)size===2?view.setUint16(at,value,true):view.setUint32(at,value,true);return bytes;};
  for(const [name,text] of Object.entries(files)){
   const filename=encode(name),data=encode(text),checksum=crc(data);
   const local=header(30,[[0,0x04034b50,4],[4,20,2],[10,0,2],[12,33,2],[14,checksum,4],[18,data.length,4],[22,data.length,4],[26,filename.length,2]]);
   const dir=header(46,[[0,0x02014b50,4],[4,20,2],[6,20,2],[14,33,2],[16,checksum,4],[20,data.length,4],[24,data.length,4],[28,filename.length,2],[42,offset,4]]);
   parts.push(local,filename,data);central.push(dir,filename);offset+=local.length+filename.length+data.length;
  }
  const centralSize=central.reduce((n,x)=>n+x.length,0),count=Object.keys(files).length;
  const end=header(22,[[0,0x06054b50,4],[8,count,2],[10,count,2],[12,centralSize,4],[16,offset,4]]);
  const out=new Uint8Array(offset+centralSize+22);let at=0;for(const p of [...parts,...central,end]){out.set(p,at);at+=p.length;}return out;
 }
 function workbook(data){
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const sheetRows=data.map((row,i)=>'<row r="'+(i+1)+'" ht="'+(i===0?32:25)+'" customHeight="1">'+row.map((v,j)=>{const ref=String.fromCharCode(65+j)+(i+1),style=i===0?1:j===2?2:0;if(v==null)return '<c r="'+ref+'" s="'+style+'"/>';return typeof v==='number'?'<c r="'+ref+'" s="'+style+'"><v>'+v+'</v></c>':'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(v)+'</t></is></c>';}).join('')+'</row>').join('');
  return zip({
   '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
   '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
   'xl/workbook.xml':'<workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="商品规则" sheetId="1" r:id="rId1"/></sheets></workbook>',
   'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
   'xl/styles.xml':'<styleSheet xmlns="'+ns+'"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.########"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF274A60"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
   'xl/worksheets/sheet1.xml':'<worksheet xmlns="'+ns+'"><dimension ref="A1:F'+data.length+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="38" customWidth="1"/><col min="2" max="2" width="44" customWidth="1"/><col min="3" max="6" width="15" customWidth="1"/></cols><sheetData>'+sheetRows+'</sheetData><autoFilter ref="A1:F'+data.length+'"/></worksheet>'
  });
 }
 const api={dimensions,rows,workbook};root.RuleExport=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
