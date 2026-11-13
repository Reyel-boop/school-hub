/* School Hub lock: when a system is opened from the Hub (?as=username), the person is already
   signed in with the account that matches their Hub role (e.g. a student gets the student view).
   Here we take away every way to switch to another account inside the system:
   - no "Sign out" (signing out happens in the Hub, which closes every open system)
   - no sign-in screen, demo-account list or "Create account" (they would show admin passwords)
   - no "Reset demo data"
   Load this as the LAST script on the page. PROTOTYPE: this is a front-end guard, not real security. */
(function () {
  let as = null; try { as = new URLSearchParams(location.search).get('as'); } catch (e) {}
  if (!as) return; // opened directly, not from the Hub: keep the normal sign-in

  const css = document.createElement('style');
  css.textContent = `
    #login, .demo, #logoutBtn, .who .out, #resetBtn, .foot button { display:none !important; }
    #hubOnly { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; padding:2rem;
      text-align:center; font:15px/1.5 Poppins, system-ui, sans-serif; color:#475569; background:#f8fafc; }
    #hubOnly b { display:block; color:#0f172a; font-size:1.1rem; margin-bottom:.3rem; }`;
  document.head.appendChild(css);

  // Keep any sign-out that still happens (e.g. a keyboard shortcut) from showing the sign-in screen.
  if (typeof P !== 'undefined' && typeof P.logout === 'function') P.logout = () => {}; // P is a shared top-level const from proto.js
  if (typeof window.logout === 'function') window.logout = () => {};

  // If the account could not be opened (e.g. it was deleted), say so instead of showing a sign-in form.
  const app = document.getElementById('app');
  if (!app || app.hidden) {
    const d = document.createElement('div'); d.id = 'hubOnly';
    d.innerHTML = '<div><b>Your account isn’t set up in this system</b>Go back to the School Hub and ask the school admin for access.</div>';
    document.body.appendChild(d);
  }
})();
