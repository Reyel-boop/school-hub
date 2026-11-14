import {getSession, getUser, checkPw, setPassword, send, body, wrap} from './_lib.js';
export default wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, {error: 'POST only'});
  const s = getSession(req); if (!s) return send(res, 401, {error: 'Not signed in'});
  const {old, pw} = await body(req), user = await getUser(s.u);
  if (!user || !checkPw(String(old || ''), user.pw)) return send(res, 403, {error: 'Your current password is wrong.'});
  if (String(pw || '').length < 8) return send(res, 400, {error: 'Use at least 8 characters.'});
  await setPassword(s.u, String(pw)); send(res, 200, {ok: true});
});
