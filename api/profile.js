// The signed-in person's own profile: the email for reminders and updates, and which reminders they want.
// GET                                   -> {email, remind:{due, missing, grades, teacher}}
// POST {step:'email', email}            -> emails a 6-digit code to confirm the new address
// POST {step:'verify', email, code}     -> saves the address
// POST {step:'remind', remind:{...}}    -> saves the reminder choices
import {getSession, getUser, userByEmail, newCode, dropCode, useCode, sendCode, mailReady, setEmail, setRemind, getRemind, send, body, wrap} from './_lib.js';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export default wrap(async (req, res) => {
  const s = getSession(req); if (!s) return send(res, 401, {error: 'Not signed in'});
  const user = await getUser(s.u); if (!user || user.status !== 'active') return send(res, 401, {error: 'Not signed in'});
  if (req.method === 'GET') return send(res, 200, {email: user.email || null, remind: await getRemind(user.u)});
  if (req.method !== 'POST') return send(res, 405, {error: 'GET or POST'});
  const b = await body(req);
  if (b.step === 'email') {
    if (!mailReady()) return send(res, 503, {error: 'The school’s email sender isn’t set up yet. Please tell the school admin.'});
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return send(res, 400, {error: 'Please enter a valid email address.'});
    if ((user.email || '').toLowerCase() === email) return send(res, 200, {ok: true, same: true});
    const other = await userByEmail(email); if (other && other.u !== user.u) return send(res, 409, {error: 'That email is already used by another account.'});
    const r = await newCode(email, 'email', {u: user.u});
    if (r.wait) return send(res, 429, {error: `Please wait ${r.wait} seconds before asking for another code.`});
    try { await sendCode(email, r.code, 'email', String(user.name).split(' ')[0]); } catch (e) { console.error('email failed', e.message); await dropCode(email, 'email'); return send(res, 502, {error: 'We couldn’t send the email right now. Check the address, or try again in a few minutes.'}); }
    return send(res, 200, {ok: true, email, ...(process.env.VERCEL ? {} : {devCode: r.code})});
  }
  if (b.step === 'verify') {
    const email = String(b.email || '').trim().toLowerCase(), r = await useCode(email, 'email', b.code);
    if (r.error) return send(res, 400, {error: r.error});
    if (!r.data || r.data.u !== user.u) return send(res, 400, {error: 'Please request a new code.'});
    const other = await userByEmail(email); if (other && other.u !== user.u) return send(res, 409, {error: 'That email is already used by another account.'});
    await setEmail(user.u, email);
    return send(res, 200, {ok: true, email});
  }
  if (b.step === 'remind') { await setRemind(user.u, b.remind || {}); return send(res, 200, {ok: true, remind: await getRemind(user.u)}); }
  send(res, 400, {error: 'Unknown step'});
});
