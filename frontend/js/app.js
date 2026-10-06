// Goal Tracker app shell (Phase 2: login, sessions, profile, user management; Phase 3: game screens in game.js).
// Navigation is data-driven so later phases only add entries, not new plumbing.
// Security note: this file only controls what is SHOWN. The server checks every request.
(function () {
  // Items flagged more:true live in the "More" sheet on phones (the bar holds 5 slots). Wide screens list them all.
  const NAV = {
    user: [
      { id: 'today', label: 'Today', icon: '🏠' },
      { id: 'goals', label: 'Goals', icon: '🎯' },
      { id: 'calendar', label: 'Calendar', icon: '📅' },
      { id: 'partners', label: 'Partners', icon: '🤝' },
      { id: 'board', label: 'Board', icon: '🏆' }
    ],
    admin: [
      { id: 'today', label: 'Today', icon: '🏠' },
      { id: 'goals', label: 'Goals', icon: '🎯' },
      { id: 'calendar', label: 'Calendar', icon: '📅' },
      { id: 'board', label: 'Board', icon: '🏆' },
      { id: 'partners', label: 'Partners', icon: '🤝', more: true },
      { id: 'reviews', label: 'Reviews', icon: '🔎', more: true },
      { id: 'users', label: 'Users', icon: '👥', more: true }
    ],
    developer: [
      { id: 'system', label: 'System', icon: '🛠️' },
      { id: 'users', label: 'Users', icon: '👥' },
      { id: 'goals', label: 'Goals', icon: '🎯' },
      { id: 'activities', label: 'Activities', icon: '🧩', more: true },
      { id: 'testing', label: 'Testing', icon: '🧪', more: true },
      { id: 'logs', label: 'Logs', icon: '📜', more: true }
    ]
  };

  // Screens drawn by game.js (Phase 6): Today, Board, Partners, Reviews.
  const GAME_ROUTES = ['today', 'board', 'partners', 'reviews'];
  // plan.js: goal creation wizard, goals with progress, floating calendar.
  const PLAN_ROUTES = ['goals', 'calendar'];

  const PHASE_FOR = { activities: 'a later phase', testing: 'a later phase', logs: 'a later phase' };

  // Which roles an account may create / manage (mirrors the server rule).
  const MANAGES = { developer: ['admin', 'user'], admin: ['user'], user: [] };

  const state = { user: null, previewRole: null, auth: null };
  const $ = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(v) {
    if (!v) return 'Never';
    const d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  /* ---------- toasts ---------- */
  function toast(message, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }
  window.toast = toast;

  /* ---------- Google Identity Services (loaded only when enabled) ---------- */
  let gisPromise = null;
  function loadGoogle() {
    if (window.google && window.google.accounts) return Promise.resolve();
    if (!gisPromise) {
      gisPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = resolve;
        s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in.')); };
        document.head.appendChild(s);
      });
    }
    return gisPromise;
  }
  function renderGoogleButton(el, callback) {
    loadGoogle().then(() => {
      window.google.accounts.id.initialize({ client_id: state.auth.googleClientId, callback: callback });
      window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'continue_with', width: 280 });
    }).catch(() => { el.textContent = 'Google sign-in is unavailable right now.'; });
  }
  async function getAuthConfig() {
    if (state.auth) return state.auth;
    try { state.auth = await Api.call('auth.config'); }
    catch (e) { return { googleEnabled: false, googleClientId: '' }; }
    return state.auth;
  }

  /* ---------- shell chrome ---------- */
  function setAuthMode(on) {
    document.body.classList.toggle('auth-mode', on);
    $('#user-area').hidden = on;
    $('#nav').hidden = on;
  }

  function effectiveRole() { return state.previewRole || state.user.role; }

  function renderTopbar() {
    $('#who').textContent = state.user.name;
    $('#profile-btn').setAttribute('aria-label', 'Profile of ' + state.user.name);
    $('#preview-wrap').hidden = state.user.role !== 'developer';
  }

  function renderNav() {
    const items = NAV[effectiveRole()];
    const main = items.filter((n) => !n.more);
    const more = items.filter((n) => n.more);
    const link = (n, cls) => `<a href="#/${n.id}" data-id="${n.id}"${cls ? ' class="' + cls + '"' : ''}><span class="ni" aria-hidden="true">${n.icon || ''}</span><span>${esc(n.label)}</span></a>`;
    $('#nav').innerHTML = main.map((n) => link(n)).join('')
      + more.map((n) => link(n, 'wide-only')).join('')
      + (more.length ? '<button type="button" class="more-btn" data-id="__more" aria-haspopup="dialog"><span class="ni" aria-hidden="true">⋯</span><span>More</span></button>' : '');
    highlightNav();
  }

  function highlightNav() {
    if (!state.user) return;
    const current = currentRoute();
    const items = NAV[effectiveRole()];
    const inMore = items.some((n) => n.more && n.id === current);
    document.querySelectorAll('#nav a').forEach((a) => {
      a.toggleAttribute('aria-current', a.dataset.id === current);
    });
    const mb = document.querySelector('#nav .more-btn');
    if (mb) mb.toggleAttribute('aria-current', inMore);
    const pb = $('#profile-btn');
    if (pb) pb.toggleAttribute('aria-current', current === 'profile');
  }

  function openMore() {
    if (!window.GT.ui) return;
    const items = NAV[effectiveRole()].filter((n) => n.more);
    const m = window.GT.ui.openModal(`<h3 class="modal-title">More</h3>
      <div class="more-list">${items.map((n) => `<a class="more-item" href="#/${n.id}"><span class="ni">${n.icon}</span><span>${esc(n.label)}</span></a>`).join('')}
      <a class="more-item" href="#/profile"><span class="ni">👤</span><span>Profile &amp; password</span></a>
      <button type="button" class="more-item" data-m="logout"><span class="ni">🚪</span><span>Log out</span></button></div>`);
    m.el.addEventListener('click', (e) => {
      if (e.target.closest('a.more-item')) m.close();
      else if (e.target.closest('[data-m=logout]')) { m.close(); logout(); }
    });
  }

  function currentRoute() {
    const items = NAV[state.user ? effectiveRole() : 'user'];
    return location.hash.replace(/^#\//, '') || items[0].id;
  }

  /* ---------- session lifecycle ---------- */
  function enter(user) {
    state.user = user;
    state.previewRole = null;
    $('#preview-role').value = '';
    setAuthMode(false);
    renderTopbar();
    if (user.mustChangePassword) {
      $('#nav').hidden = true;
      return showForcedChange();
    }
    const items = NAV[user.role];
    if (currentRoute() !== 'profile' && !items.some((n) => n.id === currentRoute())) location.hash = '#/' + items[0].id;
    renderNav();
    render();
  }

  function leave(message) {
    Api.clearToken();
    state.user = null;
    state.previewRole = null;
    location.hash = '';
    showLogin(message);
  }

  async function logout() {
    try { await Api.call('auth.logout'); } catch (e) { /* the token is dropped locally either way */ }
    leave();
    toast('You have been logged out.', 'info');
  }

  /* ---------- login ---------- */
  async function showLogin(message) {
    setAuthMode(true);
    const cfg = await getAuthConfig();
    $('#view').innerHTML = `
      <section class="panel auth-card">
        <h2>Log in</h2>
        <p class="muted">Use the username and password you were given.</p>
        <form class="stack" data-form="login" novalidate>
          <div class="field">
            <label for="login-user">Username</label>
            <input id="login-user" name="userId" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
          </div>
          <div class="field">
            <label for="login-pass">Password</label>
            <input id="login-pass" name="password" type="password" autocomplete="current-password" required>
          </div>
          <p class="form-error" id="login-error" role="alert">${esc(message || '')}</p>
          <button class="btn primary" type="submit">Log in</button>
        </form>
        ${cfg.googleEnabled ? '<div class="divider">or</div><div id="google-slot" class="google-slot"></div>' : ''}
      </section>`;
    if (cfg.googleEnabled) renderGoogleButton($('#google-slot'), onGoogleLogin);
    const u = $('#login-user'); if (u) u.focus();
  }

  async function doLogin(form) {
    const btn = form.querySelector('button[type=submit]');
    const err = $('#login-error');
    err.textContent = '';
    btn.disabled = true;
    try {
      const r = await Api.call('auth.login', { userId: form.elements.userId.value, password: form.elements.password.value });
      Api.setToken(r.token);
      enter(r.user);
    } catch (e) {
      err.textContent = e.message;
      form.elements.password.value = '';
      form.elements.password.focus();
    } finally {
      btn.disabled = false;
    }
  }

  async function onGoogleLogin(resp) {
    try {
      const r = await Api.call('auth.googleLogin', { credential: resp.credential });
      Api.setToken(r.token);
      enter(r.user);
    } catch (e) {
      const err = $('#login-error');
      if (err) err.textContent = e.message; else toast(e.message, 'error');
    }
  }

  /* ---------- forced password change (temporary passwords) ---------- */
  function passwordForm(opts) {
    return `
      <form class="stack" data-form="changePassword" novalidate>
        <div class="field">
          <label for="pw-current">${opts.currentLabel}</label>
          <input id="pw-current" name="currentPassword" type="password" autocomplete="current-password" required>
        </div>
        <div class="field">
          <label for="pw-new">New password</label>
          <input id="pw-new" name="newPassword" type="password" autocomplete="new-password" required>
          <p class="hint">At least 8 characters. It cannot be your username.</p>
        </div>
        <div class="field">
          <label for="pw-confirm">Repeat new password</label>
          <input id="pw-confirm" name="confirm" type="password" autocomplete="new-password" required>
        </div>
        <p class="form-error" id="pw-error" role="alert"></p>
        <button class="btn primary" type="submit">${opts.button}</button>
      </form>`;
  }

  function showForcedChange() {
    setAuthMode(false);
    $('#nav').hidden = true;
    $('#view').innerHTML = `
      <section class="panel auth-card">
        <h2>Choose a new password</h2>
        <p class="muted">You are using a temporary password. Set your own to continue.</p>
        ${passwordForm({ currentLabel: 'Temporary password', button: 'Save and continue' })}
      </section>`;
  }

  async function doChangePassword(form) {
    const err = $('#pw-error');
    err.textContent = '';
    if (form.elements.newPassword.value !== form.elements.confirm.value) { err.textContent = 'The new passwords do not match.'; return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await Api.call('auth.changePassword', {
        currentPassword: form.elements.currentPassword.value,
        newPassword: form.elements.newPassword.value
      });
      toast('Password updated.', 'success');
      const wasForced = state.user.mustChangePassword;
      state.user = r.user;
      if (wasForced) { location.hash = '#/' + NAV[state.user.role][0].id; enter(state.user); }
      else form.reset();
    } catch (e) {
      err.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- views ---------- */
  function placeholder(title, phase) {
    return `<section class="panel empty">
      <h2>${esc(title)}</h2>
      <p>This screen is built in ${esc(phase)}.</p>
    </section>`;
  }

  function render() {
    if (!state.user || state.user.mustChangePassword) return;
    const route = currentRoute();
    highlightNav();
    const view = $('#view');
    const role = state.user.role;                     // real role, not the preview
    if (route === 'profile') return renderProfile(view);
    if (route === 'system' && role === 'developer') return renderSystem(view);
    if (route === 'users' && MANAGES[role].length) return renderUsers(view);
    if (PLAN_ROUTES.indexOf(route) !== -1 && NAV[effectiveRole()].some((n) => n.id === route) && window.Plan) return window.Plan.render(route, view);
    if (GAME_ROUTES.indexOf(route) !== -1 && NAV[effectiveRole()].some((n) => n.id === route) && window.Game) return window.Game.render(route, view);
    const item = NAV[effectiveRole()].find((n) => n.id === route);
    view.innerHTML = placeholder(item ? item.label : 'Not found', PHASE_FOR[route] || 'a later phase');
  }

  /* --- profile --- */
  async function renderProfile(view) {
    const u = state.user;
    const cfg = await getAuthConfig();
    view.innerHTML = `
      ${state.previewRole ? '<div class="banner">Preview only changes the menu. You still have your own permissions.</div>' : ''}
      <section class="panel section">
        <h2>Profile</h2>
        <dl class="kv">
          <dt>Name</dt><dd>${esc(u.name)}</dd>
          <dt>Username</dt><dd>${esc(u.userId)}</dd>
          <dt>Role</dt><dd><span class="badge">${esc(u.role)}</span></dd>
          <dt>Last login</dt><dd>${esc(fmtDate(u.lastLogin))}</dd>
        </dl>
      </section>
      <section class="panel section">
        <h2>Change password</h2>
        <p class="muted">Changing it signs you out on your other devices.</p>
        ${passwordForm({ currentLabel: 'Current password', button: 'Update password' })}
      </section>
      ${cfg.googleEnabled ? `
      <section class="panel section">
        <h2>Google sign-in</h2>
        ${u.googleLinked
          ? '<p class="muted">A Google account is linked. You can log in with it.</p><button class="btn" type="button" data-action="unlink-google">Unlink Google</button>'
          : '<p class="muted">Link your Google account to log in without a password.</p><div id="google-slot" class="google-slot"></div>'}
      </section>` : ''}
      <section class="section"><button class="btn" type="button" data-action="logout">Log out</button></section>`;
    const slot = $('#google-slot');
    if (slot) renderGoogleButton(slot, onGoogleLink);
  }

  async function onGoogleLink(resp) {
    try {
      const r = await Api.call('auth.linkGoogle', { credential: resp.credential });
      state.user = r.user;
      toast('Google account linked.', 'success');
      render();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function unlinkGoogle() {
    try {
      const r = await Api.call('auth.unlinkGoogle');
      state.user = r.user;
      toast('Google account unlinked.', 'success');
      render();
    } catch (e) { toast(e.message, 'error'); }
  }

  /* --- users (admin / developer) --- */
  async function renderUsers(view) {
    const roles = MANAGES[state.user.role];
    view.innerHTML = `
      <section class="panel section">
        <h2>Add a user</h2>
        <p class="muted">They get a temporary password and must choose their own at first login.</p>
        <form class="inline-form" data-form="createUser" novalidate style="margin-top:14px">
          <div class="field"><label for="nu-id">Username</label>
            <input id="nu-id" name="userId" autocapitalize="none" autocorrect="off" spellcheck="false" required></div>
          <div class="field"><label for="nu-name">Name</label>
            <input id="nu-name" name="name" required></div>
          <div class="field"><label for="nu-role">Role</label>
            <select id="nu-role" name="role">${roles.map((r) => `<option value="${r}">${r}</option>`).join('')}</select></div>
          <button class="btn primary" type="submit">Create</button>
        </form>
        <p class="form-error" id="user-error" role="alert"></p>
        <div id="temp-box"></div>
      </section>
      <section class="panel section">
        <h2>Users</h2>
        <div id="user-list"><p class="loading"><span class="spinner"></span> Loading…</p></div>
      </section>`;
    loadUsers();
  }

  async function loadUsers() {
    const box = $('#user-list');
    if (!box) return;
    try {
      const { users } = await Api.call('users.list');
      const mine = MANAGES[state.user.role];
      const rows = users.map((u) => {
        const you = u.userId === state.user.userId;
        const canManage = !you && mine.indexOf(u.role) !== -1;
        const actions = canManage ? `
          <div class="row-actions">
            <button class="btn small" type="button" data-action="reset" data-id="${esc(u.userId)}">Reset password</button>
            <button class="btn small ${u.status === 'active' ? 'danger' : ''}" type="button" data-action="toggle" data-id="${esc(u.userId)}" data-status="${esc(u.status)}">
              ${u.status === 'active' ? 'Disable' : 'Enable'}</button>
          </div>` : '';
        return `<tr>
          <td>${esc(u.name)}${you ? ' <span class="muted">(you)</span>' : ''}<br><span class="muted">${esc(u.userId)}</span></td>
          <td><span class="badge">${esc(u.role)}</span></td>
          <td><span class="badge ${u.status === 'active' ? '' : 'off'}">${esc(u.status)}</span></td>
          <td>${esc(fmtDate(u.lastLogin))}</td>
          <td>${actions}</td></tr>`;
      }).join('');
      box.innerHTML = `<div class="table-wrap"><table class="table">
        <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    } catch (e) {
      box.innerHTML = `<p class="status bad">${esc(e.message)}</p>`;
    }
  }

  function showTempPassword(userId, temp, heading) {
    $('#temp-box').innerHTML = `
      <div class="tempbox">
        <strong>${esc(heading)}</strong><br>
        <span class="muted">Username:</span> <code>${esc(userId)}</code><br>
        <span class="muted">Temporary password:</span> <code>${esc(temp)}</code>
        <p class="hint">Shown only once. Give it to the user privately; they must change it at first login.</p>
      </div>`;
    $('#temp-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function doCreateUser(form) {
    const err = $('#user-error');
    err.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await Api.call('users.create', { userId: form.elements.userId.value, name: form.elements.name.value, role: form.elements.role.value });
      form.reset();
      showTempPassword(r.user.userId, r.tempPassword, 'Account created');
      loadUsers();
    } catch (e) { err.textContent = e.message; }
    finally { btn.disabled = false; }
  }

  async function resetUser(id) {
    if (!confirm('Reset the password for ' + id + '? They will be signed out everywhere.')) return;
    try {
      const r = await Api.call('users.resetPassword', { userId: id });
      showTempPassword(r.user.userId, r.tempPassword, 'Password reset');
      loadUsers();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function toggleUser(id, status) {
    const next = status === 'active' ? 'disabled' : 'active';
    if (next === 'disabled' && !confirm('Disable ' + id + '? They will be signed out and cannot log in.')) return;
    try {
      await Api.call('users.setStatus', { userId: id, status: next });
      toast(id + ' is now ' + next + '.', 'success');
      loadUsers();
    } catch (e) { toast(e.message, 'error'); }
  }

  /* --- system (developer) --- */
  function renderSystem(view) {
    view.innerHTML = `
      <section class="panel">
        <h2>Backend connection</h2>
        <p class="muted">Checks that this site can reach your Apps Script API and that every sheet exists.</p>
        <button id="run-check" class="btn primary">Run system check</button>
        <div id="check-result" aria-live="polite"></div>
      </section>`;
    $('#run-check').addEventListener('click', runCheck);
  }

  async function runCheck() {
    const btn = $('#run-check');
    const out = $('#check-result');
    btn.disabled = true;
    out.innerHTML = '<p class="loading"><span class="spinner"></span> Checking…</p>';
    try {
      const ping = await Api.call('system.ping');
      const health = await Api.call('system.health');
      const rows = Object.keys(health.rowCounts)
        .map((t) => `<tr><td>${esc(t)}</td><td>${health.rowCounts[t] === null ? 'missing' : health.rowCounts[t]}</td></tr>`)
        .join('');
      out.innerHTML = `
        <p class="status ${health.healthy ? 'ok' : 'bad'}">
          ${health.healthy ? 'Connected. All sheets found.' : 'Connected, but sheets are missing: ' + esc(health.missing.join(', '))}
        </p>
        <p class="muted">Backend version ${esc(ping.version)}</p>
        <table class="table"><thead><tr><th>Sheet</th><th>Rows</th></tr></thead><tbody>${rows}</tbody></table>`;
      toast(health.healthy ? 'System check passed' : 'Some sheets are missing', health.healthy ? 'success' : 'error');
    } catch (err) {
      out.innerHTML = `<p class="status bad">${esc(err.message)}</p>`;
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // Shared helpers for game.js
  window.GT = { state: state, esc: esc, toast: toast, fmtDate: fmtDate };

  /* ---------- boot ---------- */
  async function boot() {
    // one delegated listener each for forms and buttons inside the main view
    const view = $('#view');
    view.addEventListener('submit', (e) => {
      const name = e.target.dataset.form;
      if (!name) return;
      e.preventDefault();
      if (name === 'login') doLogin(e.target);
      else if (name === 'changePassword') doChangePassword(e.target);
      else if (name === 'createUser') doCreateUser(e.target);
    });
    view.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const a = b.dataset.action;
      if (a === 'logout') logout();
      else if (a === 'unlink-google') unlinkGoogle();
      else if (a === 'reset') resetUser(b.dataset.id);
      else if (a === 'toggle') toggleUser(b.dataset.id, b.dataset.status);
    });

    $('#logout-btn').addEventListener('click', logout);
    $('#nav').addEventListener('click', (e) => { if (e.target.closest('.more-btn')) openMore(); });
    $('#preview-role').addEventListener('change', (e) => {
      state.previewRole = e.target.value || null;
      const items = NAV[effectiveRole()];
      if (currentRoute() !== 'profile' && !items.some((n) => n.id === currentRoute())) location.hash = '#/' + items[0].id;
      renderNav();
      render();
    });
    window.addEventListener('hashchange', render);
    window.addEventListener('gt:session-expired', () => { if (state.user) leave('Your session has ended. Please log in again.'); });

    if (!Api.getToken()) return showLogin();
    $('#view').innerHTML = '<p class="loading"><span class="spinner"></span> Loading…</p>';
    setAuthMode(true);
    try {
      const r = await Api.call('auth.me');
      enter(r.user);
    } catch (e) {
      if (e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'NOT_CONFIGURED') {
        // Keep the saved login; the problem is the connection, not the session.
        $('#view').innerHTML = `<section class="panel auth-card"><h2>Cannot connect</h2><p class="muted">${esc(e.message)}</p>
          <button class="btn primary" type="button" onclick="location.reload()">Try again</button></section>`;
      } else {
        Api.clearToken();
        showLogin();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
