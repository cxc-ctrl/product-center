"""Read-only, unguessable image links issued only for warehouse synchronization."""
import hmac
import os
import re
import secrets


def initialize(con):
 con.execute('CREATE TABLE IF NOT EXISTS warehouse_media_tokens(image_id TEXT PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE, token TEXT NOT NULL)')
 con.execute('CREATE TABLE IF NOT EXISTS warehouse_sync_states(product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE, revision INTEGER NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL,at INTEGER NOT NULL,rules_basis TEXT NOT NULL)')


def attach(con,body,products):
 base=os.environ.get('PRODUCT_CENTER_PUBLIC_URL','http://122.51.235.103:8004').rstrip('/')
 by_sku={v['sku']:(p,v) for p in products for v in p['variants']}
 for row in body['variants']:
  p,v=by_sku[row['sku']];row['product_name']=p['name'];row['images']=[]
  for image_id in (v.get('image_ids') or p.get('images',[])[:1])[:30]:
   if not con.execute('SELECT 1 FROM images WHERE id=?',(image_id,)).fetchone():continue
   con.execute('INSERT INTO warehouse_media_tokens VALUES(?,?) ON CONFLICT(image_id) DO NOTHING',(image_id,secrets.token_urlsafe(32)))
   token=con.execute('SELECT token FROM warehouse_media_tokens WHERE image_id=?',(image_id,)).fetchone()[0]
   url=base+'/warehouse-media/'+image_id+'/'+token
   row['images'].append({'id':image_id,'url':url+'/image','thumbnail_url':url+'/thumb'})


def serve(handler,path):
 from app import db,DATA,Problem,ensure_thumbnail
 match=re.fullmatch(r'/warehouse-media/([a-f0-9]{64})/([A-Za-z0-9_-]{43})/(image|thumb)',path)
 if not match:raise Problem('图片不存在。',404)
 with db() as con:
  row=con.execute('SELECT i.*,t.token FROM images i JOIN warehouse_media_tokens t ON i.id=t.image_id WHERE i.id=?',(match[1],)).fetchone()
 if not row or not hmac.compare_digest(row['token'],match[2]):raise Problem('图片不存在。',404)
 original=DATA/'uploads'/row['filename']
 if not original.is_file():raise Problem('图片不存在。',404)
 target=ensure_thumbnail(row['id'],original.read_bytes()) if match[3]=='thumb' else original
 return handler.send(target.read_bytes(),mime='image/webp' if match[3]=='thumb' else row['mime'])
