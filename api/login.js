import {getUser, userByEmail, checkPw, setSession, send, body, wrap, accountsFor, publicUser} from './_lib.js';
export default wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, {error: 'POST only'});
  const {u, p} = await body(req), name = String(u || '').trim().toLowerCase();
  const user = name && (name.includes('@') ? await userByEmail(name) : await getUser(name));
  if (!user || !checkPw(String(p || ''), user.pw)) { await new Promise(r => setTimeout(r, 600)); return send(res, 401, {error: 'Wrong username or password.'}); }
  if (user.status === 'pending') return send(res, 403, {error: 'Your account is waiting for the school admin to approve it. Please try again later.'});
  if (user.status !== 'active') return send(res, 403, {error: 'This account is turned off. Please contact the school admin.'});
  setSession(req, res, user);
  send(res, 200, {user: publicUser(user), accounts: accountsFor(user)});
});
