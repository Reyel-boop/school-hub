import {getSession, getUser, send, wrap, accountsFor, publicUser, clearSession} from './_lib.js';
export default wrap(async (req, res) => {
  const s = getSession(req); if (!s) return send(res, 401, {error: 'Not signed in'});
  const user = await getUser(s.u); if (!user || user.status !== 'active') { clearSession(res); return send(res, 401, {error: 'Not signed in'}); }
  send(res, 200, {user: publicUser(user), accounts: accountsFor(user)});
});
