// School admin only. GET -> all Hub accounts; POST {u, action: approve | reject | disable | enable}
import {getSession, getUser, listUsers, setStatus, deleteUser, send, body, wrap} from './_lib.js';
export default wrap(async (req, res) => {
  const s = getSession(req); const me = s && await getUser(s.u);
  if (!me || me.status !== 'active' || me.role !== 'admin') return send(res, 403, {error: 'Only the school admin can manage accounts.'});
  if (req.method === 'GET') return send(res, 200, {users: await listUsers()});
  if (req.method !== 'POST') return send(res, 405, {error: 'GET or POST'});
  const {u, action} = await body(req), x = await getUser(String(u || ''));
  if (!x) return send(res, 404, {error: 'No such account'});
  if (x.u === me.u) return send(res, 400, {error: 'You can’t change your own account here.'});
  if (action === 'approve' || action === 'enable') await setStatus(x.u, 'active');
  else if (action === 'disable') await setStatus(x.u, 'disabled');
  else if (action === 'reject') { if (x.status !== 'pending') return send(res, 400, {error: 'Only waiting accounts can be rejected.'}); await deleteUser(x.u); }
  else return send(res, 400, {error: 'Unknown action'});
  send(res, 200, {ok: true});
});
