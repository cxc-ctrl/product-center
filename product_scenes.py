"""Managed product scenes, with atomic reassignment and optimistic conflict checks."""
import hashlib
import json
import time

def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


KEY = 'product_scenes'
DEFAULTS = ['饮品包装', '烘焙包装', '物流包装', '婚礼喜庆', '文创礼品']


def stored(con):
    row = con.execute('SELECT value FROM settings WHERE key=?', (KEY,)).fetchone()
    return json.loads(row['value']) if row else {'revision': 0, 'names': DEFAULTS, 'removed': []}


def read(con):
    saved = stored(con)
    rows = [(r['id'], json.loads(r['payload']).get('scene', ''), bool(r['archived']))
            for r in con.execute('SELECT id,payload,archived FROM products ORDER BY id')]
    removed = {name.casefold() for name in saved.get('removed', [])}
    names = set(saved['names']) | {scene for _, scene, _ in rows if scene}
    scenes = [{'name': name, 'count': sum(c == name and not a for _, c, a in rows),
                   'trash_count': sum(c == name and a for _, c, a in rows)}
                  for name in names if name.casefold() not in removed]
    scenes.sort(key=lambda c: (-c['count'], c['name']))
    basis = hashlib.sha256(json.dumps([saved, rows], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return {'revision': saved['revision'], 'basis': basis, 'scenes': scenes,
            'unclassified': sum(not c and not a for _, c, a in rows)}


def scene_value(con, value, Problem):
    if value.casefold() in {name.casefold() for name in stored(con).get('removed', [])}:
        raise Problem('这个使用场景已改名或删除，请重新选择使用场景。', 409)
    return value


def name_value(raw, Problem):
    if not isinstance(raw, str) or not raw.strip() or len(raw.strip()) > 80 or raw.strip() == '未设置':
        raise Problem('使用场景请填写1至80个字；“未设置”为系统保留名称。')
    return raw.strip()


def change(con, raw, Problem):
    if not isinstance(raw, dict):
        raise Problem('使用场景设置无效。')
    current = read(con)
    if raw.get('basis') != current['basis']:
        raise Problem('使用场景或关联产品有更新，请重新载入后再操作。', 409)
    action = raw.get('action')
    if action not in ('create', 'rename', 'delete'):
        raise Problem('使用场景操作无效。')
    names = [c['name'] for c in current['scenes']]
    name = name_value(raw.get('name'), Problem)
    removed = set(stored(con).get('removed', []))
    target = name
    if action == 'create':
        if any(n.casefold() == name.casefold() for n in names):
            raise Problem('已有同名使用场景。')
        names.append(name)
        removed = {n for n in removed if n.casefold() != name.casefold()}
    else:
        if name not in names:
            raise Problem('使用场景不存在，请重新载入。', 409)
        if action == 'rename':
            target = name_value(raw.get('new_name'), Problem)
            if any(n != name and n.casefold() == target.casefold() for n in names):
                raise Problem('已有同名使用场景，请使用其他名称。')
        else:
            target = raw.get('target', '')
            if not isinstance(target, str) or target == name or target and target not in names:
                raise Problem('请选择其他使用场景或未设置。')
        if target != name:
            names.remove(name)
            if target and target not in names:
                names.append(target)
            removed.add(name)
            removed = {n for n in removed if n.casefold() != target.casefold()}
    affected = 0
    updates = []
    now = int(time.time() * 1000)
    if action != 'create' and target != name:
        for row in con.execute('SELECT * FROM products').fetchall():
            product = json.loads(row['payload'])
            if product.get('scene') != name:
                continue
            product['scene'] = target
            updates.append({'id':row['id'],'previous_revision':row['revision'],'revision':row['revision']+1})
            revision = row['revision'] + 1
            con.execute('UPDATE products SET payload=?,revision=?,updated_at=? WHERE id=?',
                        (dumps(product), revision, now, row['id']))
            con.execute('INSERT INTO events(product_id,action,revision,at,payload) VALUES(?,?,?,?,?)',
                        (row['id'], 'scene_' + action, revision, now, dumps(product)))
            affected += 1
    saved = {'revision': current['revision'] + 1, 'names': names, 'removed': sorted(removed)}
    con.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                (KEY, dumps(saved)))
    return {**read(con), 'affected': affected, 'updates':updates}
