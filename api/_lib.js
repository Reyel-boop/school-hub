// Shared server code for the School Hub API (Vercel Functions).
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
  if (!q) { if (!MEM.users.size) SEED.forEach(s => MEM.users.set(s.u, {...s, pw: hashPw(s.p)})); return MEM.users.get(u) || null; }
  let rows = await q`select u, name, pos, role, pw from hub_users where u = ${u}`;
  if (!rows.length) { const [{n}] = await q`select count(*)::int as n from hub_users`;
    if (!n) { for (const s of SEED) await q`insert into hub_users (u, name, pos, role, pw) values (${s.u}, ${s.name}, ${s.pos}, ${s.role}, ${hashPw(s.p)}) on conflict do nothing`;
      rows = await q`select u, name, pos, role, pw from hub_users where u = ${u}`; } }
  return rows[0] || null;
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
  res.setHeader('Set-Cookie', `${COOKIE}=${data}.${sign(data)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${HOURS * 3600}${secure}`);
}
export function clearSession(res){ res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); }
export function getSession(req){
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)); if (!m) return null;
  const [data, sig] = m[1].split('.'); if (!data || !sig) return null;
  const good = sign(data); if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const s = JSON.parse(Buffer.from(data, 'base64url').toString()); return s.exp > Date.now() ? s : null; } catch (e) { return null; }
}

// ---------- who may open which system (same table as the Hub) ----------
export const ACCESS = {
  aralmath:   {admin:'teacher',    principal:'teacher',   teacher:'teacher', staff:null,        student:'student'},
  accounting: {admin:'bookkeeper', principal:'principal', teacher:'teacher', staff:'teacher',   student:null},
  cashier:    {admin:'cashier',    principal:'cashier',   teacher:null,      staff:'cashier',   student:'student'},
  clinic:     {admin:'nurse',      principal:'nurse',     teacher:'teacher', staff:'teacher',   student:'student'},
  enroll:     {admin:'registrar',  principal:'registrar', teacher:'teacher', staff:'registrar', student:null},
  guidance:   {admin:'counselor',  principal:'counselor', teacher:'teacher', staff:'teacher',   student:'student'},
  hr:         {admin:'hr',         principal:'principal', teacher:'teacher', staff:'teacher',   student:null},
  ict:        {admin:'admin',      principal:'teacher',   teacher:'teacher', staff:'registrar', student:null},
  idsys:      {admin:'idadmin',    principal:'idadmin',   teacher:'teacher', staff:'teacher',   student:null},
  registrar:  {admin:'registrar',  principal:'registrar', teacher:null,      staff:'registrar', student:'student'},
  rpms:       {admin:'principal',  principal:'principal', teacher:'teacher', staff:null,        student:null},
  tools:      {admin:'teacher',    principal:'teacher',   teacher:'teacher', staff:null,        student:null},
};
// storage key prefix of each system
export const PREFIX = {aralmath:'svnhs-aralmath-', accounting:'svnhs-acct-', cashier:'svnhs-cash-', clinic:'svnhs-cl-', enroll:'svnhs-en-', guidance:'svnhs-go-',
  hr:'svnhs-hr-', ict:'svnhs-ict-', idsys:'svnhs-id-', registrar:'svnhs-reg-', rpms:'svnhs-rpms-', tools:'svnhs-tt-'};
export const modOfKey = key => Object.keys(PREFIX).find(m => key.startsWith(PREFIX[m]) && !key.endsWith('-session')) || null;
export const canUse = (sess, mod) => !!(sess && ACCESS[mod] && ACCESS[mod][sess.role]);
export const accountsFor = role => Object.fromEntries(Object.entries(ACCESS).map(([m, a]) => [m, a[role] || null]));

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
