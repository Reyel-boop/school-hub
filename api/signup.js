// POST {step:'start', name, email, u, role, pos, pw}  -> emails a 6-digit code
// POST {step:'verify', email, code}                   -> creates the account (students: signed in; teacher/staff: waits for admin)
import {getUser, userByEmail, createUser, hashPw, newCode, useCode, sendCode, mailReady, setSession, send, body, wrap, accountsFor, publicUser} from './_lib.js';
const ROLES = {student: 'Student', teacher: 'Teacher', staff: 'Staff'};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export default wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, {error: 'POST only'});
  const b = await body(req);
  if (b.step === 'start') {
    if (!mailReady()) return send(res, 503, {error: 'Creating accounts isn’t available yet: the school’s email sender isn’t set up. Please tell the school admin.'});
    const name = String(b.name || '').trim().replace(/\s+/g, ' '), email = String(b.email || '').trim().toLowerCase(), u = String(b.u || '').trim().toLowerCase();
    const role = String(b.role || ''), pos = '', pw = String(b.pw || '');
    if (!ROLES[role]) return send(res, 400, {error: 'Choose Student, Teacher or Staff.'});
    if (name.length < 3) return send(res, 400, {error: 'Please enter your full name.'});
    if (!EMAIL.test(email)) return send(res, 400, {error: 'Please enter a valid email address.'});
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) return send(res, 400, {error: 'Username: 3 to 30 letters or numbers, no spaces.'});
    if (pw.length < 8) return send(res, 400, {error: 'Password: use at least 8 characters.'});
    if (await getUser(u)) return send(res, 409, {error: 'That username is taken. Try another.'});
    if (await userByEmail(email)) return send(res, 409, {error: 'That email already has an account. Use “Forgot password?” to get back in.'});
    const r = await newCode(email, 'signup', {name, u, role, pos: pos || ROLES[role], pwHash: hashPw(pw)});
    if (r.wait) return send(res, 429, {error: `Please wait ${r.wait} seconds before asking for another code.`});
    await sendCode(email, r.code, 'signup', name.split(' ')[0]);
    return send(res, 200, {ok: true, email, ...(process.env.VERCEL ? {} : {devCode: r.code})});
  }
  if (b.step === 'verify') {
    const email = String(b.email || '').trim().toLowerCase(), r = await useCode(email, 'signup', b.code);
    if (r.error) return send(res, 400, {error: r.error});
    const d = r.data, status = d.role === 'student' ? 'active' : 'pending';
    if (!await createUser({u: d.u, name: d.name, pos: d.pos, role: d.role, pwHash: d.pwHash, email, status})) return send(res, 409, {error: 'That username was just taken. Please sign up again with another one.'});
    if (status === 'pending') return send(res, 200, {pending: true, message: `Your ${d.role} account was created. The school admin needs to approve it before you can sign in.`});
    const user = await getUser(d.u); setSession(req, res, user);
    return send(res, 200, {user: publicUser(user), accounts: accountsFor(user)});
  }
  send(res, 400, {error: 'Unknown step'});
});
