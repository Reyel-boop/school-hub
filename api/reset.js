// Forgot password. POST {step:'start', who: username or email} -> emails a code (same answer whether or not the account exists)
//                  POST {step:'verify', who, code, pw}           -> sets the new password
import {getUser, userByEmail, newCode, useCode, sendCode, mailReady, setPassword, send, body, wrap} from './_lib.js';
const find = async who => { const w = String(who || '').trim().toLowerCase(); return w.includes('@') ? userByEmail(w) : getUser(w); };
export default wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, {error: 'POST only'});
  const b = await body(req);
  if (b.step === 'start') {
    if (!mailReady()) return send(res, 503, {error: 'Password reset by email isn’t available yet. Please ask the school admin to reset it.'});
    const user = await find(b.who); let dev = {};
    if (user && user.email) { const r = await newCode(user.email, 'reset');
      if (r.wait) return send(res, 429, {error: `Please wait ${r.wait} seconds before asking for another code.`});
      try { await sendCode(user.email, r.code, 'reset'); } catch (e) { console.error('email failed', e.message); return send(res, 502, {error: 'We couldn’t send the email right now. Please try again in a few minutes, or tell the school admin.'}); } if (!process.env.VERCEL) dev = {devCode: r.code}; }
    const hint = user && user.email ? user.email.replace(/^(.)(.*)(@.*)$/, (_, a, m, d) => a + '*'.repeat(Math.min(6, m.length)) + d) : null;
    return send(res, 200, {ok: true, hint, ...dev});
  }
  if (b.step === 'verify') {
    const user = await find(b.who); if (!user || !user.email) return send(res, 400, {error: 'Wrong code. Check the email and try again.'});
    if (String(b.pw || '').length < 8) return send(res, 400, {error: 'Password: use at least 8 characters.'});
    const r = await useCode(user.email, 'reset', b.code); if (r.error) return send(res, 400, {error: r.error});
    await setPassword(user.u, String(b.pw)); return send(res, 200, {ok: true, u: user.u});
  }
  send(res, 400, {error: 'Unknown step'});
});
