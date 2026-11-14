/* School Hub cloud sync. Load FIRST in each system: <script src="../shared/cloud.js" data-mod="aralmath"></script>
   On the Vercel deployment it makes the school's shared database the source of truth:
   - before the system starts, it downloads the system's data into this browser (one quick request)
   - every save is uploaded in the background; if someone else saved first, both changes are merged
   - every 20 seconds (and when the tab comes back) it pulls changes made on other computers
   - only people signed in to the School Hub, with access to this system, can read or change its data
   On static hosting (GitHub Pages, opening the file) there is no /api, so nothing changes: data stays in the browser. */
(function () {
  const me = document.currentScript, MOD = me && me.dataset.mod;
  const PRE = {aralmath:'svnhs-aralmath-', accounting:'svnhs-acct-', cashier:'svnhs-cash-', clinic:'svnhs-cl-', enroll:'svnhs-en-', guidance:'svnhs-go-',
    hr:'svnhs-hr-', ict:'svnhs-ict-', idsys:'svnhs-id-', registrar:'svnhs-reg-', rpms:'svnhs-rpms-', tools:'svnhs-tt-'}[MOD];
  if (!PRE || location.protocol === 'file:') return;

  const LS = window.localStorage, rawSet = Storage.prototype.setItem, rawGet = Storage.prototype.getItem;
  const get = k => rawGet.call(LS, k), set = (k, v) => rawSet.call(LS, k, v);
  const syncable = k => typeof k === 'string' && k.startsWith(PRE) && !k.endsWith('-session');
  const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
  const META = 'hubcloud-meta-' + MOD, BASE = 'hubcloud-base:';
  let meta = parse(get(META)) || {};             // key -> {v: server version, dirty: unsent local change}
  const saveMeta = () => set(META, JSON.stringify(meta));

  // ---- three-way merge: keep both people's changes (base = last version both started from) ----
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const idOf = x => isObj(x) && x.id != null ? 'id:' + x.id : 'j:' + JSON.stringify(x);
  function merge3(base, local, remote){
    if (same(local, base)) return remote;
    if (same(remote, base) || same(local, remote)) return local;
    if (Array.isArray(local) && Array.isArray(remote)) {
      const B = new Map((Array.isArray(base) ? base : []).map(x => [idOf(x), x])), L = new Map(local.map(x => [idOf(x), x])), out = [], seen = new Set();
      for (const x of remote) { const k = idOf(x); seen.add(k);
        if (B.has(k) && !L.has(k)) { if (same(B.get(k), x)) continue; out.push(x); continue; }   // removed here (unless they changed it)
        out.push(L.has(k) ? merge3(B.get(k), L.get(k), x) : x); }
      for (const x of local) { const k = idOf(x); if (!seen.has(k) && !B.has(k)) out.push(x); } // added here
      return out;
    }
    if (isObj(local) && isObj(remote)) {
      const b = isObj(base) ? base : {}, out = Object.assign({}, remote);
      for (const k of new Set([...Object.keys(local), ...Object.keys(b)])) {
        if (!(k in local)) { if (k in remote && same(remote[k], b[k])) delete out[k]; continue; }      // deleted here
        if (!(k in remote)) { if (!(k in b) || !same(local[k], b[k])) out[k] = local[k]; continue; }  // new here, or changed here while they deleted it
        out[k] = merge3(b[k], local[k], remote[k]);
      }
      return out;
    }
    return local; // two different plain values: this computer's newer edit wins
  }

  // ---- small status banner ----
  function banner(html, kind){
    const show = () => { let b = document.getElementById('cloudBar');
      if (!html) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement('div'); b.id = 'cloudBar'; document.body.appendChild(b); }
      b.style.cssText = `position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;max-width:calc(100% - 32px);padding:.55rem .9rem;border-radius:.7rem;font:13px/1.4 Poppins,system-ui,sans-serif;box-shadow:0 8px 24px -8px rgba(15,23,42,.45);display:flex;gap:.6rem;align-items:center;background:${kind === 'warn' ? '#fef3c7;color:#78350f' : '#0f172a;color:#f8fafc'}`;
      b.innerHTML = html; };
    document.body ? show() : document.addEventListener('DOMContentLoaded', show);
  }
  function blocker(title, text){
    const show = () => { const d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:2rem;text-align:center;background:#f8fafc;font:15px/1.5 Poppins,system-ui,sans-serif;color:#475569';
      d.innerHTML = `<div><b style="display:block;color:#0f172a;font-size:1.1rem;margin-bottom:.3rem">${title}</b>${text}<br><a href="/" target="_top" style="display:inline-block;margin-top:1rem;color:#0e7490;font-weight:600">Go to the School Hub</a></div>`;
      document.body.appendChild(d); };
    document.body ? show() : document.addEventListener('DOMContentLoaded', show);
  }

  // ---- 1. download this system's data before it starts (synchronous on purpose: the system reads it right away) ----
  let first; try { const x = new XMLHttpRequest(); x.open('GET', '/api/data?mod=' + MOD, false); x.send(); first = {status: x.status, json: parse(x.responseText)}; } catch (e) { first = {status: 0}; }
  if (first.status === 401) { blocker('Please sign in to the School Hub first', 'For privacy, school systems only open for people signed in to the Hub.'); throw new Error('Not signed in to the School Hub'); }
  if (first.status === 403) { blocker('You don’t have access to this system', 'Ask the school admin if you need it.'); throw new Error('No access'); }
  if (first.status !== 200 && first.status !== 0 && first.status < 500) return; // no API here (static hosting): browser-only mode, as before
  const online = first.status === 200 && first.json && Array.isArray(first.json.docs);

  // open the system with the account the Hub assigns to this person (no switching accounts through the address bar)
  if (online && first.json.account) { const q = new URLSearchParams(location.search);
    if (q.get('as') !== first.json.account) { q.set('as', first.json.account); history.replaceState(null, '', location.pathname + '?' + q + location.hash); } }

  function applyServer(docs){ // returns true if anything in this browser changed
    let changed = false;
    for (const d of docs) {
      const m = meta[d.key] || {}, local = get(d.key);
      if (m.v === d.v && local != null) continue;
      if (m.dirty && local != null) { const merged = merge3(parse(get(BASE + d.key)), parse(local), d.value), s = JSON.stringify(merged);
        if (s !== local) { set(d.key, s); changed = true; } }
      else { const s = JSON.stringify(d.value); if (s !== local) { set(d.key, s); changed = true; } }
      set(BASE + d.key, JSON.stringify(d.value)); meta[d.key] = {v: d.v, dirty: !!m.dirty};
    }
    saveMeta(); return changed;
  }
  if (online) {
    applyServer(first.json.docs);
    const onServer = new Set(first.json.docs.map(d => d.key));
    for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (syncable(k) && !onServer.has(k)) meta[k] = {v: 0, dirty: true}; } // local data the school doesn't have yet
    saveMeta();
  } else banner('⚠ Can’t reach the school server. Changes are kept on this computer and will upload when the connection is back.', 'warn');

  // ---- 2. upload saves ----
  Storage.prototype.setItem = function (k, val) {
    const before = this === LS && syncable(k) ? rawGet.call(this, k) : null;
    rawSet.call(this, k, val);
    if (this === LS && syncable(k) && before !== String(val)) { meta[k] = Object.assign(meta[k] || {v: 0}, {dirty: true}); saveMeta(); schedulePush(); }
  };
  let pushTimer = null, pushing = false;
  function schedulePush(ms = 400){ clearTimeout(pushTimer); pushTimer = setTimeout(push, ms); }
  async function push(){
    if (pushing) return schedulePush(300); pushing = true; let retry = false, merged = false;
    try {
      for (const k of Object.keys(meta).filter(k => meta[k].dirty)) {
        const sent = get(k); if (sent == null) { meta[k].dirty = false; continue; }
        const r = await fetch('/api/data', {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', keepalive: sent.length < 60000,
          body: JSON.stringify({key: k, value: parse(sent), base: meta[k].v || 0})});
        if (r.status === 200) { const {v} = await r.json(); set(BASE + k, sent); meta[k].v = v; if (get(k) === sent) meta[k].dirty = false; else retry = true; }
        else if (r.status === 409) { const {current} = await r.json();
          const out = JSON.stringify(merge3(parse(get(BASE + k)), parse(get(k)), current.value));
          set(BASE + k, JSON.stringify(current.value)); meta[k].v = current.v; if (out !== get(k)) { set(k, out); merged = true; } retry = true; }
        else if (r.status === 401) { banner('⚠ Your School Hub sign-in ended. <a href="/" target="_top" style="color:inherit;font-weight:700">Sign in again</a> so your changes can be saved.', 'warn'); break; }
        else { retry = true; break; }
      }
      if (!retry) banner(null);
    } catch (e) { retry = true; banner('⚠ Offline. Your changes are kept on this computer and will upload when the connection is back.', 'warn'); }
    finally { saveMeta(); pushing = false; }
    if (merged) reloadApp();
    if (retry) schedulePush(merged ? 50 : 5000);
  }

  // ---- 3. pull changes from other computers ----
  async function pull(){
    if (document.hidden) return;
    try { const r = await fetch('/api/data?mod=' + MOD, {credentials: 'same-origin'}); if (r.status !== 200) return;
      const {docs} = await r.json(); if (applyServer(docs)) reloadApp();
      if (Object.values(meta).some(m => m.dirty)) schedulePush(50);
    } catch (e) {}
  }
  setInterval(pull, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  window.addEventListener('online', () => { pull(); schedulePush(50); });
  window.addEventListener('pagehide', () => { if (Object.values(meta).some(m => m.dirty)) push(); });

  // give the running system the new data
  const busy = () => { const a = document.activeElement; return (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || !!document.querySelector('#shade.on')
    || (typeof window.cloudCanRefresh === 'function' && !window.cloudCanRefresh()); };
  let waiting = false;
  function reloadApp(){
    const p = typeof P !== 'undefined' ? P : null; // the shared engine's P is a global const from proto.js
    if (p && p.cfg) { // shared engine: swap in the merged data without losing the screen
      p.users = parse(get(p.cfg.key + '-users')) || p.users;
      for (const k of Object.keys(p.cfg.data)) { const v = parse(get(p.cfg.key + '-' + k)); if (v != null) p.db[k] = v; }
      if (p.me) p.me = p.users.find(x => x.u === p.me.u) || p.me;
      const go = () => { if (busy()) return setTimeout(go, 3000); try { p.refresh(); } catch (e) {} };
      if (p.me) go(); return;
    }
    if (waiting) return; waiting = true; // systems with their own code: reload the page when it's safe
    const go = () => { if (busy()) { banner('🔄 Someone else updated this system. <button onclick="location.reload()" style="font:inherit;font-weight:700;background:#fff;color:#0f172a;border:0;border-radius:.4rem;padding:.2rem .6rem;cursor:pointer">Show changes</button>'); return setTimeout(go, 4000); } location.reload(); };
    go();
  }
  window.hubCloud = {merge3, pull, push: () => push(), status: () => JSON.parse(JSON.stringify(meta))};
})();
