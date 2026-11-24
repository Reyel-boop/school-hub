// One AskReyel account for every system.
// GET  ?to=momo|tuon  -> (signed in) sends the browser to that system with a 2-minute sign-in pass; (not signed in) to the AskReyel sign-in, then back
// GET  ?pub           -> the public key Momo uses to check passes
// POST {pass, aud:'tuon'} -> who the pass belongs to (for Tuon, a static site that can't check keys itself)
import {getSession, getUser, send, body, wrap, ssoPass, ssoCheck, ssoPublicKey} from './_lib.js';
const TARGETS = {
  momo: p => 'https://www.momo-smart.com/sso?pass=' + encodeURIComponent(p),
  tuon: p => 'https://reyel-boop.github.io/tuon/#/sso/' + encodeURIComponent(p),
};
const TUON_ORIGIN = 'https://reyel-boop.github.io';
const go = (res, url) => { res.statusCode = 302; res.setHeader('Location', url); res.setHeader('Cache-Control', 'no-store'); res.end(); };
export default wrap(async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', TUON_ORIGIN); res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 204; return res.end();
  }
  if (req.method === 'POST') {
    res.setHeader('Access-Control-Allow-Origin', TUON_ORIGIN);
    const b = await body(req), p = ssoCheck(b.pass, 'tuon');
    if (!p) return send(res, 401, {error: 'This sign-in link has expired. Open Tuon again from AskReyel.'});
    const user = await getUser(p.u);
    if (!user || user.status !== 'active') return send(res, 401, {error: 'This AskReyel account is turned off.'});
    return send(res, 200, {u: user.u, name: user.name, email: user.email || null, role: user.role});
  }
  if (q.has('pub')) return send(res, 200, {alg: 'Ed25519', spki: ssoPublicKey()});
  const to = q.get('to');
  if (!TARGETS[to]) return send(res, 400, {error: 'Unknown system'});
  const s = getSession(req), user = s && await getUser(s.u);
  if (!user || user.status !== 'active') return go(res, '/#/' + to); // sign in to AskReyel first; it opens the system afterwards
  go(res, TARGETS[to](ssoPass(user, to)));
});
