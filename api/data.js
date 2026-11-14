// GET  /api/data?mod=aralmath            -> {docs:[{key, value, v}]}
// POST /api/data {key, value, base}      -> {v} or 409 {current:{value, v}} when someone else saved first
import {getSession, getUser, send, body, wrap, listDocs, saveDoc, modOfKey, canUse, PREFIX, ACCESS, accountIn} from './_lib.js';
export default wrap(async (req, res) => {
  const s = getSession(req); if (!s) return send(res, 401, {error: 'Not signed in'});
  if (req.method === 'GET') {
    const mod = new URL(req.url, 'http://x').searchParams.get('mod');
    if (!PREFIX[mod]) return send(res, 400, {error: 'Unknown system'});
    if (!canUse(s, mod)) return send(res, 403, {error: 'No access to this system'});
    const user = await getUser(s.u); if (!user || user.status !== 'active') return send(res, 401, {error: 'Not signed in'});
    return send(res, 200, {account: accountIn(user, mod), me: {name: user.name, pos: user.pos, like: ACCESS[mod][user.role]}, docs: await listDocs(mod)});
  }
  if (req.method !== 'POST') return send(res, 405, {error: 'GET or POST'});
  const {key, value, base} = await body(req), mod = modOfKey(String(key || ''));
  if (!mod) return send(res, 400, {error: 'Unknown key'});
  if (!canUse(s, mod)) return send(res, 403, {error: 'No access to this system'});
  if (value === undefined || !Number.isInteger(base) || base < 0) return send(res, 400, {error: 'Bad request'});
  const who = await getUser(s.u); if (!who || who.status !== 'active') return send(res, 401, {error: 'Not signed in'});
  const r = await saveDoc(key, value, base, s.u);
  r.ok ? send(res, 200, {v: r.v}) : send(res, 409, {current: r.current});
});
