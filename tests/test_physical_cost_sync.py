import contextlib
import importlib.util
import pathlib
import sqlite3
import sys
import threading
import time
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class PhysicalCostSyncTest(unittest.TestCase):
 def setUp(self):
  self.con = sqlite3.connect(':memory:')
  self.con.row_factory = sqlite3.Row
  self.con.executescript('''
  CREATE TABLE products(id TEXT PRIMARY KEY, revision INTEGER, archived INTEGER);
  INSERT INTO products VALUES('p',5,0);
  CREATE TABLE warehouse_syncs(product_id TEXT PRIMARY KEY,revision INTEGER,at INTEGER);
  CREATE TABLE warehouse_sync_states(product_id TEXT PRIMARY KEY,revision INTEGER,status TEXT,error TEXT,at INTEGER,rules_basis TEXT);
  ''')
  @contextlib.contextmanager
  def db():
   with self.con: yield self.con
  class Problem(Exception): pass
  self.originals = {key: sys.modules.get(key) for key in ['app','shared_rules','warehouse_config']}
  sys.modules['app'] = types.SimpleNamespace(Problem=Problem,db=db,record=lambda x:x,LOCK=threading.RLock())
  sys.modules['shared_rules'] = types.SimpleNamespace(read=lambda con:{'basis':'rules'})
  sys.modules['warehouse_config'] = types.SimpleNamespace(bundle=lambda *a:None)
  spec=importlib.util.spec_from_file_location('subject_sync',ROOT/'warehouse_sync.py')
  self.mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.mod)
  self.variants=[{'sku':f'SKU-{i}','product_id':'p','revision':5} for i in range(21)]
  self.mod.PLANS['token']={'at':time.time(),'products':[('p',5)],'dependencies':[],'rules_basis':'rules','batches':[{'body':{'variants':self.variants[:20]},'basis':'one'},{'body':{'variants':self.variants[20:]},'basis':'two'}],'next':0,'busy':False}
  self.calls=[]
  def remote(raw):
   self.calls.append(raw['action'])
   if raw['action']=='product_center_sync_preview':return {'syncPreview':{'basis':'new'}}
   if raw['action']=='product_center_sync_costs':
    self.assertEqual(raw['variants'],self.variants)
    return {'physicalCosts':{'changes':[{'code':'STOCK','next':.04}], 'unchanged':[], 'skipped':[{'code':'CONFLICT','codes':['SKU-0'],'reason':'单价冲突','warning':True}]}}
   return {'ok':True}
  self.mod.remote=remote

 def tearDown(self):
  self.con.close()
  for key,value in self.originals.items():
   if value is None:sys.modules.pop(key,None)
   else:sys.modules[key]=value

 def test_all_batches_before_costs_and_visible_warning(self):
  result=self.mod._handle_sync(None,'/api/warehouse-sync/commit',{'token':'token'})
  self.assertEqual(self.calls,['product_center_sync','product_center_sync_preview','product_center_sync','product_center_sync_costs'])
  self.assertEqual(result['skus'],21)
  self.assertEqual(result['physical_costs']['changes'][0]['next'],.04)
  state=self.con.execute('select * from warehouse_sync_states').fetchone()
  self.assertEqual(state['revision'],5)
  self.assertIn('单价冲突',state['error'])

 def test_revision_changed_stops_cost_sync(self):
  original=self.mod.remote
  def remote(raw):
   response=original(raw)
   if len(self.calls)==3:self.con.execute("update products set revision=6 where id='p'")
   return response
  self.mod.remote=remote
  with self.assertRaisesRegex(Exception,'商品资料已更新'):
   self.mod._handle_sync(None,'/api/warehouse-sync/commit',{'token':'token'})
  self.assertNotIn('product_center_sync_costs',self.calls)
  self.assertIsNone(self.con.execute('select * from warehouse_syncs').fetchone())

if __name__=='__main__':unittest.main()
