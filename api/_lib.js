// Shared server code for AskReyel API (Vercel Functions).
// Data model: every system keeps its data as JSON documents under keys like "svnhs-aralmath-attempts".
// Each document has a version number so two people saving at the same time can't overwrite each other.
import crypto from 'node:crypto';

// ---------- database ----------
let sqlFn = null;
const MEM = globalThis.__hubMem || (globalThis.__hubMem = {users: new Map(), kv: new Map()}); // local tests only
export const usingMemory = () => !(process.env.DATABASE_URL || process.env.POSTGRES_URL);
async function sql(){
  if (sqlFn) return sqlFn;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) { if (process.env.VERCEL) throw new Error('Database is not connected'); return null; }
  const {neon} = await import('@neondatabase/serverless');
  const q = neon(url);
  await q`create table if not exists hub_users (u text primary key, name text not null, pos text not null, role text not null, pw text not null, created_at timestamptz default now())`;
  await q`create table if not exists kv (key text primary key, value jsonb not null, v integer not null default 1, updated_at timestamptz not null default now(), updated_by text)`;
  await q`alter table hub_users add column if not exists email text`;
  await q`alter table hub_users add column if not exists status text not null default 'active'`;
  await q`create unique index if not exists hub_users_email on hub_users (lower(email))`;
  await q`create table if not exists voice_clips (id text primary key, mime text not null, data bytea not null, updated_at timestamptz not null default now(), updated_by text)`;
  await q`alter table hub_users add column if not exists remind jsonb not null default '{}'::jsonb`;
  await q`create table if not exists reminder_runs (day text primary key, at timestamptz not null default now(), sent integer not null default 0, note text)`;
  await q`create table if not exists email_codes (email text not null, purpose text not null, code text not null, data jsonb, tries integer not null default 0, sent_at timestamptz not null default now(), expires_at timestamptz not null, primary key (email, purpose))`;
  return sqlFn = q;
}

// ---------- passwords ----------
export function hashPw(pw){ const salt = crypto.randomBytes(16).toString('hex'); return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`; }
export function checkPw(pw, stored){
  const [, salt, hash] = String(stored).split('$'); if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Hub accounts ----------
const SEED = [ // first-run accounts; change these passwords right after setup
  {u:'admin',     p:'admin123',     name:'School Admin',     pos:'System Administrator', role:'admin'},
  {u:'principal', p:'principal123', name:'School Principal', pos:'Principal',            role:'principal'},
  {u:'teacher',   p:'teacher123',   name:'Juan Dela Cruz',   pos:'Teacher',              role:'teacher'},
  {u:'staff',     p:'staff123',     name:'Maria Santos',     pos:'Office Staff',         role:'staff'},
  {u:'student',   p:'student123',   name:'Ana Reyes',        pos:'Student',              role:'student'},
];
export async function getUser(u){
  const q = await sql();
  if (!q) { if (!MEM.users.size) SEED.forEach(s => MEM.users.set(s.u, {...s, pw: hashPw(s.p), status: 'active', email: null})); return MEM.users.get(u) || null; }
  let rows = await q`select u, name, pos, role, pw, email, status from hub_users where u = ${u}`;
  if (!rows.length) { const [{n}] = await q`select count(*)::int as n from hub_users`;
    if (!n) { for (const s of SEED) await q`insert into hub_users (u, name, pos, role, pw) values (${s.u}, ${s.name}, ${s.pos}, ${s.role}, ${hashPw(s.p)}) on conflict do nothing`;
      rows = await q`select u, name, pos, role, pw, email, status from hub_users where u = ${u}`; } }
  return rows[0] || null;
}
export async function userByEmail(email){
  const q = await sql(), e = String(email || '').trim().toLowerCase(); if (!e) return null;
  if (!q) { await getUser('admin'); return [...MEM.users.values()].find(x => (x.email || '').toLowerCase() === e) || null; }
  const rows = await q`select u, name, pos, role, pw, email, status from hub_users where lower(email) = ${e}`; return rows[0] || null;
}
export async function createUser(x){ // x: {u, name, pos, role, pwHash, email, status}
  const q = await sql();
  if (!q) { await getUser('admin'); if (MEM.users.has(x.u)) return false; MEM.users.set(x.u, {u: x.u, name: x.name, pos: x.pos, role: x.role, pw: x.pwHash, email: x.email, status: x.status}); return true; }
  const rows = await q`insert into hub_users (u, name, pos, role, pw, email, status) values (${x.u}, ${x.name}, ${x.pos}, ${x.role}, ${x.pwHash}, ${x.email}, ${x.status}) on conflict do nothing returning u`;
  return rows.length > 0;
}
export async function listUsers(){
  const q = await sql();
  if (!q) { await getUser('admin'); return [...MEM.users.values()].map(({pw, p, ...x}) => x); }
  return q`select u, name, pos, role, email, status, created_at from hub_users order by (status = 'pending') desc, created_at desc`;
}
export async function setStatus(u, status){
  const q = await sql();
  if (!q) { const x = MEM.users.get(u); if (x) x.status = status; return !!x; }
  return (await q`update hub_users set status = ${status} where u = ${u} returning u`).length > 0;
}
export async function deleteUser(u){
  const q = await sql();
  if (!q) return MEM.users.delete(u);
  return (await q`delete from hub_users where u = ${u} returning u`).length > 0;
}

// ---------- profile: email address and reminder choices ----------
export const REMIND_KINDS = ['due', 'missing', 'grades', 'teacher'];
export const remindOf = x => Object.fromEntries(REMIND_KINDS.map(k => [k, !(x && x.remind && x.remind[k] === false)])); // all on unless turned off
export async function setEmail(u, email){
  const q = await sql(), e = String(email || '').trim().toLowerCase();
  if (!q) { const x = MEM.users.get(u); if (x) x.email = e; return; }
  await q`update hub_users set email = ${e} where u = ${u}`;
}
export async function setRemind(u, prefs){
  const q = await sql(), v = Object.fromEntries(REMIND_KINDS.map(k => [k, prefs[k] !== false]));
  if (!q) { const x = MEM.users.get(u); if (x) x.remind = v; return; }
  await q`update hub_users set remind = ${JSON.stringify(v)}::jsonb where u = ${u}`;
}
export async function getRemind(u){
  const q = await sql(); if (!q) return remindOf(MEM.users.get(u));
  const [r] = await q`select remind from hub_users where u = ${u}`; return remindOf(r);
}
// everyone who can get reminders: active, with an email address
export async function recipients(){
  const q = await sql();
  if (!q) { await getUser('admin'); return [...MEM.users.values()].filter(x => x.status === 'active' && x.email).map(x => ({u: x.u, name: x.name, role: x.role, email: x.email, remind: remindOf(x)})); }
  const rows = await q`select u, name, role, email, remind from hub_users where status = 'active' and email is not null and email <> ''`;
  return rows.map(x => ({...x, remind: remindOf(x)}));
}
export async function getDoc(key){
  const q = await sql(); if (!q) { const d = MEM.kv.get(key); return d ? d.value : null; }
  const [r] = await q`select value from kv where key = ${key}`; return r ? r.value : null;
}
// one reminder run per school day: returns false when today's run already happened
export async function claimRun(day){
  const q = await sql(); if (!q) { const k = '__run' + day; if (MEM.kv.has(k)) return false; MEM.kv.set(k, {value: 1, v: 1}); return true; }
  return (await q`insert into reminder_runs (day) values (${day}) on conflict do nothing returning day`).length > 0;
}
export async function finishRun(day, sent, note){
  const q = await sql(); if (q) await q`update reminder_runs set sent = ${sent}, note = ${note || null} where day = ${day}`;
}
export async function dropRun(day){ const q = await sql(); if (q) await q`delete from reminder_runs where day = ${day}`; else MEM.kv.delete('__run' + day); }

// ---------- 6-digit email codes (sign-up and forgot password) ----------
const MEMC = globalThis.__hubCodes || (globalThis.__hubCodes = new Map());
const codeHash = (email, code) => crypto.createHash('sha256').update(email + ':' + code + ':' + secret()).digest('hex');
export async function newCode(email, purpose, data){ // returns {code} or {wait: seconds}
  const q = await sql(), e = email.toLowerCase(), code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  const k = e + '|' + purpose, prev = q ? (await q`select sent_at from email_codes where email = ${e} and purpose = ${purpose}`)[0] : MEMC.get(k);
  if (prev) { const ago = (Date.now() - new Date(prev.sent_at).getTime()) / 1000; if (ago < 60) return {wait: Math.ceil(60 - ago)}; }
  const row = {code: codeHash(e, code), data: data || null, tries: 0, sent_at: new Date().toISOString(), expires_at: new Date(Date.now() + 15 * 60e3).toISOString()};
  if (!q) MEMC.set(k, row);
  else await q`insert into email_codes (email, purpose, code, data, tries, sent_at, expires_at) values (${e}, ${purpose}, ${row.code}, ${JSON.stringify(row.data)}::jsonb, 0, now(), ${row.expires_at})
    on conflict (email, purpose) do update set code = excluded.code, data = excluded.data, tries = 0, sent_at = now(), expires_at = excluded.expires_at`;
  return {code};
}
export async function dropCode(email, purpose){ // e.g. the email could not be sent: let them try again right away
  const q = await sql(), e = String(email || '').toLowerCase();
  if (q) await q`delete from email_codes where email = ${e} and purpose = ${purpose}`; else MEMC.delete(e + '|' + purpose);
}
export async function useCode(email, purpose, code){ // returns {ok, data} or {error}
  const q = await sql(), e = String(email || '').toLowerCase(), k = e + '|' + purpose;
  const row = q ? (await q`select code, data, tries, expires_at from email_codes where email = ${e} and purpose = ${purpose}`)[0] : MEMC.get(k);
  if (!row) return {error: 'Please request a new code.'};
  if (new Date(row.expires_at).getTime() < Date.now()) return {error: 'That code has expired. Please request a new one.'};
  if (row.tries >= 5) return {error: 'Too many wrong tries. Please request a new code.'};
  const good = row.code === codeHash(e, String(code || '').replace(/\D/g, ''));
  if (!good) { if (q) await q`update email_codes set tries = tries + 1 where email = ${e} and purpose = ${purpose}`; else row.tries++; return {error: 'Wrong code. Check the email and try again.'}; }
  if (q) await q`delete from email_codes where email = ${e} and purpose = ${purpose}`; else MEMC.delete(k);
  return {ok: true, data: row.data};
}

// ---------- sending email through Gmail (GMAIL_USER + GMAIL_APP_PASSWORD) ----------
export const mailReady = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || !process.env.VERCEL;
export async function sendCode(to, code, purpose, name){
  const title = purpose === 'signup' ? 'Your AskReyel sign-up code' : purpose === 'email' ? 'Your AskReyel email code' : 'Your AskReyel password reset code';
  const intro = purpose === 'signup' ? `Hi ${name || 'there'}! Use this code to finish creating your AskReyel account:`
    : purpose === 'email' ? `Hi ${name || 'there'}! Use this code to confirm this email for your AskReyel reminders and updates:` : 'Use this code to set a new password for your AskReyel account:';
  if (!process.env.GMAIL_USER) { console.log(`[email to ${to}] ${title}: ${code}`); globalThis.__lastCode = code; return; } // local tests
  const nodemailer = (await import('nodemailer')).default;
  const t = nodemailer.createTransport({service: 'gmail', auth: {user: process.env.GMAIL_USER.trim(), pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '')}});
  await t.sendMail({from: `"AskReyel" <${process.env.GMAIL_USER.trim()}>`, to, subject: `${code} is ${title.toLowerCase().replace('your ', 'your ')}`,
    text: `${intro}\n\n${code}\n\nThe code works for 15 minutes. If you didn't ask for this, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;color:#0f172a"><h2 style="margin:0 0 12px">AskReyel</h2><p>${intro}</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f1f5f9;border-radius:10px;padding:14px;text-align:center;margin:18px 0">${code}</p>
      <p style="color:#64748b;font-size:13px">The code works for 15 minutes. If you didn't ask for this, you can ignore this email.</p></div>`});
}
export async function sendMail(to, subject, text, html){
  if (!process.env.GMAIL_USER) { console.log(`[email to ${to}] ${subject}\n${text}`); (globalThis.__sent || (globalThis.__sent = [])).push({to, subject, text, html}); return; } // local tests
  const nodemailer = (await import('nodemailer')).default;
  const t = nodemailer.createTransport({service: 'gmail', auth: {user: process.env.GMAIL_USER.trim(), pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '')}});
  await t.sendMail({from: `"AskReyel" <${process.env.GMAIL_USER.trim()}>`, to, subject, text, html});
}
export async function setPassword(u, pw){
  const q = await sql(); const h = hashPw(pw);
  if (!q) { const x = MEM.users.get(u); if (x) x.pw = h; return; }
  await q`update hub_users set pw = ${h} where u = ${u}`;
}

// ---------- sessions: signed, HttpOnly cookie ----------
const COOKIE = 'hub_session', HOURS = 12;
function secret(){ const s = process.env.SESSION_SECRET; if (s && s.length >= 32) return s; if (process.env.VERCEL) throw new Error('SESSION_SECRET is not set'); return 'local-test-secret-local-test-secret!!'; }
const sign = data => crypto.createHmac('sha256', secret()).update(data).digest('base64url');
export function setSession(req, res, user){
  const data = Buffer.from(JSON.stringify({u: user.u, role: user.role, exp: Date.now() + HOURS * 3600e3})).toString('base64url');
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL ? '; Secure' : '';
  // no Max-Age: the cookie ends when the browser closes (shared school computers); the session itself still expires after 12 hours
  res.setHeader('Set-Cookie', `${COOKIE}=${data}.${sign(data)}; HttpOnly; SameSite=Lax; Path=/${secure}`);
}
export function clearSession(res){ res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${process.env.VERCEL ? '; Secure' : ''}`); }
export function getSession(req){
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)); if (!m) return null;
  const [data, sig] = m[1].split('.'); if (!data || !sig) return null;
  const good = sign(data); if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const s = JSON.parse(Buffer.from(data, 'base64url').toString()); return s.exp > Date.now() ? s : null; } catch (e) { return null; }
}

// ---------- who may open which system (same table as the Hub) ----------
export const ACCESS = {
  aralmath:   {admin:'teacher',    principal:'teacher',   teacher:'teacher', staff:null,        student:'student'},
  aralread:   {admin:'teacher',    principal:'teacher',   teacher:'teacher', staff:null,        student:'student'},
  accounting: {admin:'bookkeeper', principal:'principal', teacher:'teacher', staff:'teacher',   student:null},
  cashier:    {admin:'cashier',    principal:'cashier',   teacher:null,      staff:'cashier',   student:null},
  clinic:     {admin:'nurse',      principal:'nurse',     teacher:'teacher', staff:'teacher',   student:null},
  enroll:     {admin:'registrar',  principal:'registrar', teacher:'teacher', staff:'registrar', student:null},
  guidance:   {admin:'counselor',  principal:'counselor', teacher:'teacher', staff:'teacher',   student:null},
  hr:         {admin:'hr',         principal:'principal', teacher:'teacher', staff:'teacher',   student:null},
  ict:        {admin:'admin',      principal:'teacher',   teacher:'teacher', staff:'registrar', student:null},
  idsys:      {admin:'idadmin',    principal:'idadmin',   teacher:'teacher', staff:'teacher',   student:null},
  registrar:  {admin:'registrar',  principal:'registrar', teacher:null,      staff:'registrar', student:null},
  rpms:       {admin:'principal',  principal:'principal', teacher:'teacher', staff:null,        student:null},
  tools:      {admin:'teacher',    principal:'teacher',   teacher:'teacher', staff:null,        student:null},
};
// storage key prefix of each system
export const PREFIX = {aralmath:'svnhs-aralmath-', aralread:'svnhs-aralread-', accounting:'svnhs-acct-', cashier:'svnhs-cash-', clinic:'svnhs-cl-', enroll:'svnhs-en-', guidance:'svnhs-go-',
  hr:'svnhs-hr-', ict:'svnhs-ict-', idsys:'svnhs-id-', registrar:'svnhs-reg-', rpms:'svnhs-rpms-', tools:'svnhs-tt-'};
export const modOfKey = key => Object.keys(PREFIX).find(m => key.startsWith(PREFIX[m]) && !key.endsWith('-session')) || null;
// everyone who is not a student may use every system: fill any gap with the admin's account for that system
for (const sys of Object.values(ACCESS)) for (const role of ['admin', 'principal', 'teacher', 'staff']) if (!sys[role]) sys[role] = sys.admin;
export const canUse = (sess, mod) => !!(sess && ACCESS[mod] && ACCESS[mod][sess.role]);
const SEEDED = new Set(SEED.map(x => x.u));
// which account a Hub user opens inside each system: the demo accounts use the shared demo account;
// everyone else gets their own account ("hub-<username>") created from that template on first visit
export const accountIn = (user, mod) => { const t = ACCESS[mod] && ACCESS[mod][user.role]; return !t ? null : SEEDED.has(user.u) ? t : 'hub-' + user.u; };
export const accountsFor = user => Object.fromEntries(Object.keys(ACCESS).map(m => [m, accountIn(user, m)]));
export const publicUser = x => ({u: x.u, name: x.name, pos: x.pos, role: x.role, email: x.email || null});

// ---------- documents ----------
export async function listDocs(mod){
  const q = await sql(), pre = PREFIX[mod];
  if (!q) return [...MEM.kv.entries()].filter(([k]) => k.startsWith(pre)).map(([key, d]) => ({key, value: d.value, v: d.v}));
  return q`select key, value, v from kv where starts_with(key, ${pre})`;
}
// save only if nobody else saved since version `base` (0 = new document); returns {ok, v} or {ok:false, current}
export async function saveDoc(key, value, base, by){
  const q = await sql();
  if (!q) { const cur = MEM.kv.get(key); if ((cur ? cur.v : 0) !== base) return {ok:false, current: cur ? {value: cur.value, v: cur.v} : {value: null, v: 0}};
    const v = base + 1; MEM.kv.set(key, {value, v}); return {ok:true, v}; }
  const json = JSON.stringify(value);
  const rows = base === 0
    ? await q`insert into kv (key, value, v, updated_by) values (${key}, ${json}::jsonb, 1, ${by}) on conflict (key) do nothing returning v`
    : await q`update kv set value = ${json}::jsonb, v = v + 1, updated_at = now(), updated_by = ${by} where key = ${key} and v = ${base} returning v`;
  if (rows.length) return {ok:true, v: rows[0].v};
  const cur = await q`select value, v from kv where key = ${key}`;
  return {ok:false, current: cur[0] || {value: null, v: 0}};
}

export async function body(req){
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (e) { return {}; }
}
export const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
export const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { console.error(e); send(res, 500, {error: e.message || 'Server error'}); } };

// ---------- recorded voice-over clips (human recordings, shared by every student) ----------
const MEMV = globalThis.__hubVoice || (globalThis.__hubVoice = new Map());
export async function voiceList(){
  const q = await sql();
  if (!q) return Object.fromEntries([...MEMV.entries()].map(([id, x]) => [id, x.t]));
  const rows = await q`select id, extract(epoch from updated_at)::bigint as t from voice_clips`;
  return Object.fromEntries(rows.map(r => [r.id, Number(r.t)]));
}
export async function voiceGet(id){
  const q = await sql();
  if (!q) return MEMV.get(id) || null;
  const rows = await q`select mime, encode(data, 'base64') as b64 from voice_clips where id = ${id}`;
  return rows[0] ? {mime: rows[0].mime, buf: Buffer.from(rows[0].b64, 'base64')} : null;
}
export async function voicePut(id, mime, b64, by){
  const q = await sql();
  if (!q) { MEMV.set(id, {mime, buf: Buffer.from(b64, 'base64'), t: Math.floor(Date.now() / 1000)}); return; }
  await q`insert into voice_clips (id, mime, data, updated_by) values (${id}, ${mime}, decode(${b64}, 'base64'), ${by})
    on conflict (id) do update set mime = excluded.mime, data = excluded.data, updated_at = now(), updated_by = excluded.updated_by`;
}
export async function voiceDel(id){ const q = await sql(); if (!q) { MEMV.delete(id); return; } await q`delete from voice_clips where id = ${id}`; }

// ---------- ICT Concerns: tell the ICT admin about each new ticket ----------
export const ICT_TICKETS_KEY = 'svnhs-ict-tickets-v2';
const escMail = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// Emails the AskReyel `admin` account (if it has an email) about a new ICT ticket. Never throws.
export async function ictTicketMail(t){
  try {
    if (!t || !mailReady()) return;
    const admin = await getUser('admin'); if (!admin || !admin.email) return;
    const tno = 'ICT-' + String(t.no).padStart(4, '0');
    let from = '';
    if (t.reporter) from = `${t.reporter.name} (open link)${t.reporter.pos ? ', ' + t.reporter.pos : ''}${t.reporter.contact ? ' · ' + t.reporter.contact : ''}`;
    else { const u = t.by ? await getUser(String(t.by).replace(/^hub-/, '')) : null; from = u ? `${u.name}${u.pos ? ', ' + u.pos : ''}` : String(t.by || 'a teacher'); }
    const lines = [`${t.priority === 'Urgent' ? 'URGENT: ' : ''}${t.title}`, `From: ${from}`, `Where: ${t.location}`, `Category: ${t.cat}`, '', t.desc || '', '', 'Open ICT Concerns in AskReyel to update this ticket.'];
    await sendMail(admin.email, `${t.priority === 'Urgent' ? '[URGENT] ' : ''}New ICT concern ${tno}: ${t.title}`, lines.join('\n'),
      `<div style="font-family:Arial,sans-serif;max-width:520px;color:#0f172a"><h2 style="margin:0 0 8px">New ICT concern ${tno}</h2>${lines.map(l => `<p style="margin:4px 0">${escMail(l)}</p>`).join('')}</div>`);
  } catch (e) { console.error('ICT email failed', e.message); }
}

// ---------- raw database access for features with their own tables (e.g. the Aral Math live game) ----------
export const hubSql = () => sql();   // null in local memory mode
export const hubMem = MEM;

// ---------- one AskReyel account for Momo and Tuon (sign-in passes) ----------
// AskReyel signs a short pass {u, name, email, role, aud, exp} with an Ed25519 key made from SESSION_SECRET.
// Momo and Tuon trust a pass only if it checks out against the public key at /api/sso?pub.
let ssoKeys = null;
function ssoKeyPair(){
  if (ssoKeys) return ssoKeys;
  const seed = crypto.createHmac('sha256', secret()).update('askreyel-sso-v1').digest();
  const priv = crypto.createPrivateKey({key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8'});
  return (ssoKeys = {priv, pub: crypto.createPublicKey(priv)});
}
export const ssoPublicKey = () => ssoKeyPair().pub.export({format: 'der', type: 'spki'}).toString('base64');
export function ssoPass(user, aud, seconds = 120){
  const data = Buffer.from(JSON.stringify({u: user.u, name: user.name, email: user.email || null, role: user.role, aud, exp: Date.now() + seconds * 1000})).toString('base64url');
  return data + '.' + crypto.sign(null, Buffer.from(data), ssoKeyPair().priv).toString('base64url');
}
export function ssoCheck(pass, aud){
  const [data, sig] = String(pass || '').split('.'); if (!data || !sig) return null;
  try {
    if (!crypto.verify(null, Buffer.from(data), ssoKeyPair().pub, Buffer.from(sig, 'base64url'))) return null;
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    return p.aud === aud && p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}
