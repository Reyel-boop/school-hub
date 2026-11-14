import {getUser, checkPw, setSession, send, body, wrap, accountsFor} from './_lib.js';
export default wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, {error: 'POST only'});
  const {u, p} = await body(req), name = String(u || '').trim().toLowerCase();
  const user = name && await getUser(name);
  if (!user || !checkPw(String(p || ''), user.pw)) { await new Promise(r => setTimeout(r, 600)); return send(res, 401, {error: 'Wrong username or password.'}); }
  setSession(req, res, user);
  send(res, 200, {user: {u: user.u, name: user.name, pos: user.pos, role: user.role}, accounts: accountsFor(user.role)});
});
