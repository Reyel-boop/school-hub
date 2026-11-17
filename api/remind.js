// The morning email reminders: one digest per person, sent at 6 AM Philippine time by a Vercel cron
// (vercel.json, with Authorization: Bearer $CRON_SECRET).
//   Students: work due tomorrow, new grades, and (Mondays) missing work and documents waiting to be claimed.
//   Teachers / staff: a school-day summary of their classes (from Momo) and guidance sessions for students they referred.
// Momo's part comes from its /api/reminders (Bearer $REMINDER_SECRET), matched to Hub accounts by email address.
// An admin can preview without sending: GET /api/remind?preview=1 while signed in as admin.
import {getSession, recipients, getDoc, getUser, claimRun, finishRun, dropRun, sendMail, send, wrap} from './_lib.js';
import crypto from 'node:crypto';

const MANILA = 8 * 3600e3;
const ymd = t => new Date(t + MANILA).toISOString().slice(0, 10);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fmtDay = s => new Date(s + 'T00:00:00Z').toLocaleDateString('en-PH', {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'});
const fmtTime = hm => { const [h, m] = String(hm || '').split(':').map(Number); if (isNaN(h)) return ''; return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtDue = iso => new Date(iso).toLocaleString('en-PH', {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila'});
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function momoReminders(){
  const url = (process.env.MOMO_URL || 'https://momo-smart.vercel.app').replace(/\/$/, '') + '/api/reminders', key = process.env.REMINDER_SECRET;
  if (!key) return {students: [], teachers: [], note: 'Momo not connected (REMINDER_SECRET is not set)'};
  try {
    const r = await fetch(url, {headers: {Authorization: 'Bearer ' + key}, signal: AbortSignal.timeout(45000)});
    if (!r.ok) return {students: [], teachers: [], note: `Momo answered ${r.status}`};
    return await r.json();
  } catch (e) { return {students: [], teachers: [], note: 'Momo unreachable: ' + e.message}; }
}

// the Hub account behind a system's username: "hub-ana" -> "ana"; the demo accounts share their own names
async function ownerOf(by, cache){
  if (!by) return null; const u = String(by).startsWith('hub-') ? String(by).slice(4) : String(by);
  if (!cache.has(u)) cache.set(u, await getUser(u)); return cache.get(u);
}

export async function buildDigests(now = Date.now()){
  const today = ymd(now), tomorrow = ymd(now + 864e5), weekday = new Date(now + MANILA).getUTCDay();
  const monday = weekday === 1, schoolDay = weekday >= 1 && weekday <= 5;
  const [people, momo, reqs, cases] = await Promise.all([recipients(), momoReminders(), getDoc('svnhs-reg-reqs'), getDoc('svnhs-go-cases')]);
  const byU = new Map(people.map(p => [p.u, {p, due: [], grades: [], missing: [], teach: []}]));
  const byEmail = new Map(people.map(p => [p.email.toLowerCase(), byU.get(p.u)]));
  const cache = new Map();

  // from Momo, by email
  for (const s of momo.students || []) { const d = byEmail.get(s.email); if (!d) continue;
    s.dueTomorrow.forEach(x => d.due.push(`<b>${esc(x.title)}</b> (${esc(x.course)}) — due ${esc(fmtDue(x.dueAt))}`));
    s.newGrades.forEach(x => d.grades.push(`<b>${esc(x.title)}</b> (${esc(x.course)}): ${x.score} / ${x.points}`));
    s.missing.forEach(x => d.missing.push(`<b>${esc(x.title)}</b> (${esc(x.course)}) — was due ${esc(fmtDue(x.dueAt))}`)); }
  for (const t of momo.teachers || []) { const d = byEmail.get(t.email); if (!d) continue;
    for (const c of t.sections) { const bits = [];
      if (c.needsHelp.length) bits.push(`${c.needsHelp.length} need${c.needsHelp.length === 1 ? 's' : ''} help (${esc(c.needsHelp.slice(0, 5).join(', '))}${c.needsHelp.length > 5 ? '…' : ''})`);
      if (c.missing) bits.push(`${c.missing} missing hand-in${c.missing === 1 ? '' : 's'}`);
      if (c.ungraded) bits.push(`${c.ungraded} waiting for a grade`);
      if (c.attendancePending) bits.push('yesterday’s attendance not submitted');
      d.teach.push(`<b>${esc(c.name)}</b>: ${bits.join(' · ')}`); } }

  // Registrar: documents expected ready tomorrow; on Mondays, documents ready but not yet claimed
  for (const r of Array.isArray(reqs) ? reqs : []) { const o = await ownerOf(r.by, cache); const d = o && byU.get(o.u); if (!d) continue;
    const what = `${(r.items || []).map(i => i.doc).join(', ')} request RG-${String(r.no).padStart(4, '0')}`;
    if (r.due === tomorrow && ['Submitted', 'Processing'].includes(r.status)) d.due.push(`Registrar: your <b>${esc(what)}</b> is expected ready tomorrow`);
    if (r.status === 'Ready for release') d.missing.push(`Registrar: your <b>${esc(what)}</b> is ready — claim it at the Registrar’s Office`); }
  // Guidance: sessions tomorrow, for the student who asked or the teacher who referred
  for (const c of Array.isArray(cases) ? cases : []) { if (!c.sched || c.sched.date !== tomorrow || c.status === 'Closed') continue;
    const o = await ownerOf(c.by, cache); const d = o && byU.get(o.u); if (!d) continue;
    const at = fmtTime(c.sched.time);
    if (c.type === 'Referral') d.teach.push(`Guidance: session for <b>${esc(c.student)}</b> tomorrow${at ? ' at ' + at : ''}`);
    else d.due.push(`Guidance: your session is tomorrow${at ? ' at <b>' + at + '</b>' : ''} at the Guidance Office`); }

  const out = [];
  for (const d of byU.values()) { const {p} = d, R = p.remind, sections = [];
    if (R.due && d.due.length) sections.push(['📅 Due tomorrow', d.due]);
    if (R.grades && d.grades.length) sections.push(['⭐ New grades', d.grades]);
    if (R.missing && monday && d.missing.length) sections.push(['⏰ Still to do', d.missing]);
    if (R.teacher && schoolDay && d.teach.length) sections.push(['🧑‍🏫 Your classes today', d.teach]);
    if (!sections.length) continue;
    const first = String(p.name || '').split(' ')[0] || 'there';
    const subject = `School Hub reminders for ${fmtDay(today)}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#0f172a"><h2 style="margin:0 0 4px">Good morning, ${esc(first)}!</h2>
      <p style="color:#64748b;margin:0 0 18px">Here’s what needs your attention today, ${esc(fmtDay(today))}.</p>
      ${sections.map(([h, items]) => `<h3 style="margin:18px 0 6px;font-size:16px">${h}</h3><ul style="margin:0;padding-left:20px;line-height:1.6">${items.map(i => `<li>${i}</li>`).join('')}</ul>`).join('')}
      <p style="margin-top:24px;color:#64748b;font-size:12px">You get this because your School Hub profile has this email. To change which reminders you get, open the School Hub and choose <b>My profile</b>.</p></div>`;
    const text = `Good morning, ${first}!\n\n` + sections.map(([h, items]) => `${h}\n` + items.map(i => '- ' + i.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).join('\n')).join('\n\n')
      + '\n\nTo change which reminders you get, open the School Hub and choose My profile.';
    out.push({u: p.u, to: p.email, subject, html, text, count: sections.reduce((n, [, i]) => n + i.length, 0)}); }
  return {today, note: momo.note || null, digests: out};
}

export default wrap(async (req, res) => {
  const url = new URL(req.url, 'http://x'), auth = req.headers.authorization || '';
  if (url.searchParams.get('preview')) { // admin: see what would be sent today, nothing is sent
    const s = getSession(req); if (!s || s.role !== 'admin') return send(res, 403, {error: 'Admins only'});
    const r = await buildDigests(); return send(res, 200, {today: r.today, note: r.note, people: r.digests.map(({u, to, subject, text, count}) => ({u, to, subject, count, text}))});
  }
  if (!process.env.CRON_SECRET || !same(auth, 'Bearer ' + process.env.CRON_SECRET)) return send(res, 401, {error: 'Unauthorized'});
  const day = ymd(Date.now());
  if (!await claimRun(day)) return send(res, 200, {ok: true, skipped: 'already sent today'});
  try {
    const r = await buildDigests(); let sent = 0, failed = 0;
    for (const m of r.digests) { try { await sendMail(m.to, m.subject, m.text, m.html); sent++; } catch (e) { failed++; console.error('reminder failed', m.u, e.message); } }
    await finishRun(day, sent, [r.note, failed ? failed + ' failed' : ''].filter(Boolean).join('; '));
    send(res, 200, {ok: true, sent, failed, note: r.note});
  } catch (e) { await dropRun(day); throw e; }
});
