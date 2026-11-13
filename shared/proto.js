/* Shared engine for the SVNHS Hub prototype systems.
   Handles: demo accounts + sign-in/sign-up, header, tabs, drawer, local storage.
   PROTOTYPE ONLY: data lives in this browser's localStorage and passwords are plain text. */

const $ = id => document.getElementById(id);
const clone = x => JSON.parse(JSON.stringify(x));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayStr = () => ymd(new Date());
const ago = t => { const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' hr ago'; const d = Math.round(h / 24); return d + ' day' + (d > 1 ? 's' : '') + ' ago'; };
const when = t => t ? new Date(t).toLocaleString('en-PH', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) : '—';
const fmtDate = s => s ? new Date(s + 'T00:00').toLocaleDateString('en-PH', {month:'short', day:'numeric', year:'numeric'}) : '—';
const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
const initials = n => String(n).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const nextNo = list => list.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1;
const doneSvg = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';

const P = {
  me: null, users: [], db: {}, cfg: null, current: '',
  role(){ return P.cfg.roles[P.me.role]; },
  isAdmin(){ return !!(P.me && P.cfg.roles[P.me.role].admin); },
  userOf(u){ return P.users.find(x => x.u === u) || {u, name:u, pos:'', role:''}; },
  usersWith(role){ return P.users.filter(x => x.role === role); },

  init(cfg){
    P.cfg = cfg;
    document.title = cfg.title;
    const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch(e) { return null; } };
    P.users = get(cfg.key + '-users') || clone(cfg.sampleUsers);
    for (const [k, v] of Object.entries(cfg.data)) P.db[k] = get(cfg.key + '-' + k) ?? clone(v);

    const su = cfg.signup;
    document.body.insertAdjacentHTML('afterbegin', `
<section id="login" hidden><div class="lcard">
  <div class="logo">${cfg.icon}</div><h1>${esc(cfg.title)}</h1>
  <div id="signinBox">
    <p class="sub">${esc(cfg.subtitle)} · sign in to continue</p>
    <form id="signinForm">
      <div id="signinErr" class="err" hidden></div>
      <div><label>Username</label><input name="u" required autocomplete="username"></div>
      <div><label>Password</label><input name="p" type="password" required autocomplete="current-password"></div>
      <button class="btn">Sign in</button>
    </form>
    ${su ? `<p class="switchlink">No account yet? <button type="button" id="toSignup">Create one</button></p>` : ''}
    <div class="demo"><b>Prototype demo accounts</b> (tap to fill in)
      ${cfg.demo.map(([u, p, l]) => `<button type="button" data-u="${u}" data-p="${p}">${esc(l)} — ${u} / ${p}</button>`).join('')}
    </div>
  </div>
  ${su ? `<div id="signupBox" hidden>
    <p class="sub">Create an account</p>
    <form id="signupForm">
      <div id="signupErr" class="err" hidden></div>
      <div><label>I am a</label><div class="seg">${su.roles.map(([r, l], i) => `<label><input type="radio" name="role" value="${r}" ${i ? '' : 'checked'}>${esc(l)}</label>`).join('')}</div></div>
      <div><label>Full name</label><input name="name" required placeholder="e.g. Juan Dela Cruz"></div>
      <div id="suPos"><label id="suPosLabel"></label><input name="pos"></div>
      <div><label>Username</label><input name="u" required pattern="[A-Za-z0-9._-]{3,}" title="At least 3 letters or numbers, no spaces"></div>
      <div><label>Password</label><input name="p" type="password" required minlength="6"></div>
      <button class="btn">Create account</button>
    </form>
    <p class="switchlink">Already have an account? <button type="button" id="toSignin">Sign in</button></p>
  </div>` : ''}
</div></section>
<section id="app" hidden>
  <header><div class="head">
    <div class="ic">${cfg.icon}</div>
    <div><h1>${esc(cfg.title)}</h1><p id="tagline"></p></div>
    <div class="who"><div class="nm"><span id="whoName"></span><small id="whoPos"></small></div><div class="av" id="whoAv"></div><button class="out" id="logoutBtn">Sign out</button></div>
  </div><nav class="tabs" id="tabs"></nav></header>
  <main id="view"></main>
  <div class="shade" id="shade"><aside class="drawer" id="drawer"></aside></div>
  <div class="foot">Prototype · accounts and records are saved in this browser only · <button id="resetBtn">Reset demo data</button></div>
</section>`);

    document.querySelectorAll('.demo button').forEach(b => b.onclick = () => { const f = $('signinForm'); f.u.value = b.dataset.u; f.p.value = b.dataset.p; });
    $('signinForm').onsubmit = e => {
      e.preventDefault();
      const f = e.target, u = f.u.value.trim().toLowerCase();
      const acc = P.users.find(x => x.u === u && x.p === f.p.value);
      if (!acc) { $('signinErr').textContent = 'Wrong username or password.'; $('signinErr').hidden = false; return; }
      $('signinErr').hidden = true; f.reset(); P.start(acc);
    };
    if (su) {
      const showSu = on => { $('signinBox').hidden = on; $('signupBox').hidden = !on; };
      $('toSignup').onclick = () => showSu(true);
      $('toSignin').onclick = () => showSu(false);
      P.showSignin = () => showSu(false);
      const syncPos = () => {
        const r = $('signupForm').role.value, lab = su.posLabel[r];
        $('suPos').hidden = !lab; $('suPosLabel').textContent = lab || '';
        $('signupForm').pos.placeholder = su.posHint?.[r] || '';
      };
      $('signupForm').addEventListener('change', e => { if (e.target.name === 'role') syncPos(); });
      syncPos();
      $('signupForm').onsubmit = e => {
        e.preventDefault();
        const f = e.target, u = f.u.value.trim().toLowerCase(), role = f.role.value;
        const err = m => { $('signupErr').textContent = m; $('signupErr').hidden = false; };
        if (P.users.some(x => x.u === u)) return err('That username is taken. Try another.');
        if (su.posLabel[role] && !f.pos.value.trim()) return err('Please fill in: ' + su.posLabel[role]);
        const acc = {u, p:f.p.value, name:f.name.value.trim(), pos: f.pos.value.trim() || su.posDefault?.[role] || '', role};
        P.users.push(acc); P.save(); f.reset(); syncPos(); $('signupErr').hidden = true; showSu(false); P.start(acc);
      };
    }
    $('logoutBtn').onclick = P.logout;
    $('resetBtn').onclick = P.reset;
    $('shade').onclick = e => { if (e.target.id === 'shade') P.close(); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') P.close(); });

    // Opened from the School Hub (?as=username): the Hub already signed the person in, so skip the password.
    let as = null; try { as = new URLSearchParams(location.search).get('as'); } catch(e) {}
    let saved = null; try { saved = sessionStorage.getItem(cfg.key + '-session'); } catch(e) {}
    const acc = (as && P.users.find(x => x.u === as)) || (saved && P.users.find(x => x.u === saved));
    if (acc) P.start(acc); else $('login').hidden = false;
  },

  save(){
    const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) { console.warn('Could not save', k, e); } };
    put(P.cfg.key + '-users', P.users);
    for (const k of Object.keys(P.db)) put(P.cfg.key + '-' + k, P.db[k]);
  },

  start(acc){
    P.me = acc; try { sessionStorage.setItem(P.cfg.key + '-session', acc.u); } catch(e) {}
    const r = P.role();
    $('login').hidden = true; $('app').hidden = false;
    $('whoName').innerHTML = esc(acc.name) + (r.admin ? '<span class="role">ADMIN</span>' : r.badge ? `<span class="role">${r.badge}</span>` : '');
    $('whoPos').textContent = acc.pos;
    $('whoAv').textContent = initials(acc.name);
    $('tagline').textContent = r.tagline;
    $('tabs').innerHTML = r.tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('');
    document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => P.tab(b.dataset.tab));
    P.tab(r.tabs[0][0]);
  },
  tab(name){
    P.current = name;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    P.cfg.views[name]($('view'));
    P.counts();
  },
  refresh(){ P.tab(P.current); },
  counts(){ if (P.cfg.counts) P.cfg.counts(); },
  setCount(id, n){ const el = $(id); if (el) el.textContent = n ? n : ''; },
  open(html){ $('drawer').innerHTML = html; $('shade').classList.add('on'); },
  close(){ $('shade').classList.remove('on'); },
  logout(){
    P.me = null; try { sessionStorage.removeItem(P.cfg.key + '-session'); } catch(e) {}
    P.close(); $('app').hidden = true; $('login').hidden = false; P.showSignin?.();
  },
  reset(){
    if (!confirm('Remove all accounts and records and bring back the demo data?')) return;
    P.users = clone(P.cfg.sampleUsers);
    for (const [k, v] of Object.entries(P.cfg.data)) P.db[k] = clone(v);
    P.save(); P.logout();
  },
  /* small helpers for pages */
  log(item, m, by){ (item.log = item.log || []).push({t:Date.now(), m, by: by || P.me.u}); },
  timeline(item, staffRole){
    const nameOf = u => { const x = P.userOf(u); return P.cfg.roles[x.role]?.admin ? (P.cfg.officeName || x.name) : x.name; };
    return `<div><h3 class="sec">Updates</h3><div class="tl">${(item.log || []).slice().reverse().map(l =>
      `<div class="${P.cfg.roles[P.userOf(l.by).role]?.admin ? '' : 'them'}">${esc(l.m)}<small>${esc(nameOf(l.by))} · ${when(l.t)}</small></div>`).join('')}</div></div>`;
  },
  doneCard(msg, no, again, viewCall){
    return `<div class="card done-msg"><div class="chk">${doneSvg}</div><p style="margin-top:1rem">${msg}</p><div class="big">${esc(no)}</div>
      <div class="actions" style="justify-content:center;margin-top:1rem">${viewCall ? `<button class="btn ghost" onclick="${viewCall}">View</button>` : ''}<button class="btn" onclick="P.refresh()">${again}</button></div></div>`;
  },
};
