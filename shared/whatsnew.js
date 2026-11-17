/* The welcome post for the Hub's systems (Aral Math, Aral Reading, ...): a full-screen page that opens
   every time someone opens the system (once per sign-in / browser visit), with their own reminders on
   top and "What's new" below. It closes with ✕, "Got it!" or Escape. A "🎉 What's new" button beside
   Sign out opens it again. `reminders` is a function returning [{icon, text, tab?, urgent?}].
   Load after shared/proto.js and call WhatsNew({...}) before P.init:
     WhatsNew({app:'aralmath', id:'2026-11-17', date:'November 17, 2026', name:'Aral Math', color:'#2563eb',
               student:[{icon, title, text, tab?, cta?}], teacher:[...]});
   An item's `tab` opens that tab of the system when its button is pressed. */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  let CFG = null;
  // once per browser visit (sessionStorage) and account
  const key = () => `${CFG.app}-opened:${(typeof P !== 'undefined' && P.me && P.me.u) || 'guest'}`;
  const seen = () => { try { return sessionStorage.getItem(key()) === '1'; } catch (e) { return false; } };
  const mark = () => { try { sessionStorage.setItem(key(), '1'); } catch (e) {} };

  function style(){
    if (document.getElementById('wnStyle')) return;
    const s = document.createElement('style'); s.id = 'wnStyle';
    s.textContent = `
      #wn{position:fixed;inset:0;z-index:9999;overflow-y:auto;background:#f5f7fb;font-family:inherit;color:#0f172a;animation:wnIn .25s ease-out}
      @keyframes wnIn{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:none}}
      #wn .wnx{position:fixed;top:14px;right:14px;z-index:2;width:48px;height:48px;border-radius:50%;border:0;background:#fff;font-size:22px;font-weight:700;color:#0f172a;cursor:pointer;box-shadow:0 6px 18px rgba(15,23,42,.18)}
      #wn .wnx:hover{transform:scale(1.06)}
      #wn .wnhead{padding:56px 20px 92px;text-align:center;color:#fff;background:linear-gradient(135deg,#0f2557,var(--wnc,#2563eb))}
      #wn .wnhead .pop{font-size:46px;line-height:1}
      #wn .wnhead small{display:block;margin-top:12px;font-size:12px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#fcd34d}
      #wn .wnhead h1{margin:8px 0 0;font-size:clamp(26px,5vw,38px);font-weight:800;letter-spacing:-.02em}
      #wn .wnhead p{margin:8px auto 0;max-width:36rem;font-size:15px;opacity:.88}
      #wn .wngrid{max-width:62rem;margin:-64px auto 0;padding:0 16px 28px;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
      #wn .wncard{display:flex;gap:14px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:18px;box-shadow:0 4px 14px -6px rgba(15,23,42,.12)}
      #wn .wnico{flex:none;width:48px;height:48px;border-radius:14px;background:#eef2ff;display:flex;align-items:center;justify-content:center;font-size:24px}
      #wn .wncard h2{margin:0;font-size:16px;font-weight:800}
      #wn .wncard p{margin:4px 0 0;font-size:14px;line-height:1.55;color:#64748b}
      #wn .wngo{margin-top:8px;padding:0;border:0;background:none;font:inherit;font-size:14px;font-weight:700;color:var(--wnc,#2563eb);cursor:pointer}
      #wn .wngo:hover{text-decoration:underline}
      #wn .wnrem{max-width:62rem;margin:-64px auto 0;padding:0 16px}
      #wn .wnrem>div{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:18px;box-shadow:0 4px 14px -6px rgba(15,23,42,.12)}
      #wn .wnrem h2,#wn .wnh2{margin:0;font-size:18px;font-weight:800}
      #wn .wnh2{max-width:62rem;margin:28px auto 12px;padding:0 16px}#wn .wnh2 small{font-size:13px;font-weight:600;color:#64748b}
      #wn .wnrem ul{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
      #wn .wnri{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:0;border-radius:12px;padding:11px 12px;background:#f5f7fb;font:inherit;font-size:14px;font-weight:600;color:#0f172a}
      #wn .wnri.urgent{background:#fff1f2;color:#9f1239}#wn button.wnri{cursor:pointer}#wn button.wnri:hover{box-shadow:0 0 0 2px var(--wnc,#2563eb) inset}
      #wn .wnri .ic{font-size:18px}#wn .wnri .tx{flex:1}#wn .wnri .op{font-size:12px;font-weight:700;color:var(--wnc,#2563eb)}
      #wn .wnok2{margin:10px 0 0;font-size:14px;font-weight:600;color:#047857}
      #wn .wngrid.after{margin-top:0}
      #wn .wnfoot{text-align:center;padding:4px 16px 48px}
      #wn .wnok{border:0;border-radius:16px;padding:14px 40px;font:inherit;font-size:16px;font-weight:700;color:#fff;background:#0f2557;cursor:pointer;box-shadow:0 8px 20px -8px rgba(15,23,42,.5)}
      #wn .wnfoot small{display:block;margin-top:12px;font-size:12px;color:#64748b}`;
    document.head.appendChild(s);
  }

  function close(){
    mark(); const el = document.getElementById('wn'); if (el) el.remove();
    document.removeEventListener('keydown', onKey); document.body.style.overflow = '';
  }
  function onKey(e){ if (e.key === 'Escape') close(); }

  function open(){
    if (!CFG || typeof P === 'undefined' || !P.me) return;
    style(); const old = document.getElementById('wn'); if (old) old.remove();
    const teacher = P.me.role !== 'student', items = (teacher ? CFG.teacher : CFG.student) || CFG.student || [];
    const first = String(P.me.name || '').split(/\s+/)[0] || 'there';
    const el = document.createElement('div'); el.id = 'wn'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'wnT');
    el.style.setProperty('--wnc', CFG.color || '#2563eb');
    let rem = []; try { rem = (CFG.reminders && CFG.reminders()) || []; } catch (e) { rem = []; }
    const today = new Date().toLocaleDateString('en-PH', {weekday: 'long', month: 'long', day: 'numeric'});
    el.innerHTML = `<button class="wnx" aria-label="Close">✕</button>
      <div class="wnhead"><div class="pop" aria-hidden="true">👋</div><small>${esc(today)}</small>
        <h1 id="wnT">Welcome back, ${esc(first)}!</h1><p>Here are your reminders and what's new in ${esc(CFG.name)}.</p></div>
      <div class="wnrem"><div><h2>🔔 Your reminders</h2>${rem.length ? `<ul>${rem.map((r, i) => `<li>${r.tab
          ? `<button class="wnri ${r.urgent ? 'urgent' : ''}" data-r="${i}"><span class="ic" aria-hidden="true">${esc(r.icon)}</span><span class="tx">${esc(r.text)}</span><span class="op">Open →</span></button>`
          : `<div class="wnri ${r.urgent ? 'urgent' : ''}"><span class="ic" aria-hidden="true">${esc(r.icon)}</span><span class="tx">${esc(r.text)}</span></div>`}</li>`).join('')}</ul>`
        : `<p class="wnok2">✅ You're all caught up. Nothing needs your attention right now!</p>`}</div></div>
      <h2 class="wnh2">🎉 What's new in ${esc(CFG.name)} <small>· ${esc(CFG.date)}</small></h2>
      <div class="wngrid after">${items.map((it, i) => `<article class="wncard"><div class="wnico" aria-hidden="true">${esc(it.icon)}</div><div>
        <h2>${esc(it.title)}</h2><p>${esc(it.text)}</p>${it.tab ? `<button class="wngo" data-i="${i}">${esc(it.cta || 'Try it')} →</button>` : ''}</div></article>`).join('')}</div>
      <div class="wnfoot"><button class="wnok">Got it!</button><small>This opens each time you open ${esc(CFG.name)}. Open it again anytime with “🎉 What's new” at the top.</small></div>`;
    el.querySelectorAll('.wnri[data-r]').forEach(b => b.onclick = () => { const r = rem[+b.dataset.r]; close(); try { P.tab(r.tab); } catch (e) {} });
    el.querySelector('.wnx').onclick = close; el.querySelector('.wnok').onclick = close;
    el.querySelectorAll('.wngo').forEach(b => b.onclick = () => { const it = items[+b.dataset.i]; close(); try { P.tab(it.tab); } catch (e) {} });
    document.body.appendChild(el); document.body.style.overflow = 'hidden'; document.addEventListener('keydown', onKey);
    setTimeout(() => el.querySelector('.wnok').focus({preventScroll: true}), 50);
  }

  // the "🎉 What's new" button beside Sign out
  function button(){
    if (document.getElementById('wnBtn')) return; const out = document.getElementById('logoutBtn'); if (!out) return;
    const b = document.createElement('button'); b.className = 'out'; b.id = 'wnBtn'; b.type = 'button'; b.textContent = "🎉 What's new";
    b.style.marginRight = '.4rem'; b.onclick = open; out.parentNode.insertBefore(b, out);
  }

  window.WhatsNew = function (cfg) {
    CFG = cfg; window.showWhatsNew = open;
    if (typeof P === 'undefined' || P.__wn) return; P.__wn = true;
    const start = P.start;
    P.start = function (acc) { start.call(P, acc); button(); if (!seen()) setTimeout(open, 500); };
  };
})();
