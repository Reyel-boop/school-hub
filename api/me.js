import {getSession, getUser, send, wrap, accountsFor} from './_lib.js';
export default wrap(async (req, res) => {
  const s = getSession(req); if (!s) return send(res, 401, {error: 'Not signed in'});
  const user = await getUser(s.u); if (!user) return send(res, 401, {error: 'Account no longer exists'});
  send(res, 200, {user: {u: user.u, name: user.name, pos: user.pos, role: user.role}, accounts: accountsFor(user.role)});
});
