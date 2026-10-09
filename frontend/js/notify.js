/* In-app notifications: bell + bottom sheet + polling. Works while the app is open. */
(function () {
  'use strict';
  const GT = window.GT;
  const esc = GT.esc;
  const ICON = { partner_done: '✅', partner_goal: '🏆', member_joined: '👋', leader: '🥇' };
  const POLL_MS = 75000;
  let timer = null, seen = null, items = [], unread = 0, sheet = null, busy = false;

  const bell = () => document.getElementById('bell-btn');
  const bubble = () => document.getElementById('bell-count');

  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 172800) return 'yesterday';
    return Math.floor(s / 86400) + ' days ago';
  }

  function paintBell() {
    const b = bubble(); if (!b) return;
    b.textContent = unread > 99 ? '99+' : String(unread);
    b.hidden = unread <= 0;
    const btn = bell();
    if (btn) btn.setAttribute('aria-label', unread > 0 ? 'Notifications, ' + unread + ' unread' : 'Notifications');
  }

  function listHtml() {
    const rows = items.length ? items.map((n) => `
      <li><button type="button" class="ntf-item${n.unread ? ' unread' : ''}" data-id="${esc(n.id)}" data-link="${esc(n.link || '')}">
        <span class="ntf-ic" aria-hidden="true">${ICON[n.type] || '🔔'}</span>
        <span class="ntf-tx"><strong>${esc(n.title)}</strong>${n.body ? `<span class="muted">${esc(n.body)}</span>` : ''}<small class="muted">${esc(ago(n.at))}</small></span>
      </button></li>`).join('') : '<li class="muted ntf-empty">Nothing yet. You will see partner activity, new members and leaderboard changes here.</li>';
    return `<div class="ntf-head"><h3 class="modal-title">Notifications</h3>
      <button class="btn secondary small" type="button" data-ntf="all"${unread ? '' : ' disabled'}>Mark all read</button></div>
      <ul class="ntf-list">${rows}</ul>`;
  }

  function renderSheet() { if (sheet) sheet.set(listHtml()); }

  async function markRead(body) {
    try { const r = await Api.call('notify.read', body); unread = r.unread; } catch (e) { /* retry on next poll */ }
    paintBell();
  }

  function openSheet() {
    if (sheet) return;
    sheet = GT.ui.openModal(listHtml());
    const close = sheet.close;
    sheet.close = function () { sheet = null; close(); };
    sheet.wrap.addEventListener('click', async (e) => {
      if (e.target === sheet.wrap) { sheet.close(); return; }
      const all = e.target.closest('[data-ntf="all"]');
      if (all) {
        items.forEach((n) => { n.unread = false; }); unread = 0; paintBell(); renderSheet();
        markRead({ all: true }); return;
      }
      const it = e.target.closest('.ntf-item');
      if (!it) return;
      const n = items.find((x) => x.id === it.dataset.id);
      if (n && n.unread) { n.unread = false; unread = Math.max(0, unread - 1); paintBell(); markRead({ ids: [n.id] }); }
      const link = it.dataset.link;
      sheet.close();
      if (link) location.hash = link;
    });
    refresh(false);
  }

  function system(n) {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((reg) => reg.showNotification(n.title, { body: n.body, icon: 'icons/icon-192.png', tag: n.id }));
      }
    } catch (e) { /* optional */ }
  }

  async function refresh(announce) {
    if (!GT.state.user || GT.state.user.mustChangePassword || busy) return;
    busy = true;
    try {
      const d = await Api.call('notify.list');
      const fresh = seen ? d.items.filter((n) => n.unread && !seen[n.id]) : [];
      seen = seen || {};
      d.items.forEach((n) => { seen[n.id] = true; });
      items = d.items; unread = d.unread;
      paintBell(); renderSheet();
      if (announce !== false) fresh.slice(0, 3).forEach((n) => { GT.toast((ICON[n.type] || '🔔') + ' ' + n.title); system(n); });
    } catch (e) { /* offline: keep what we have */ } finally { busy = false; }
  }

  function start() {
    stop(false);
    seen = null; items = []; unread = 0; paintBell();
    refresh(false);
    timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(true); }, POLL_MS);
  }
  function stop(clear) {
    if (timer) clearInterval(timer); timer = null;
    if (clear !== false) { seen = null; items = []; unread = 0; if (sheet) sheet.close(); paintBell(); }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && timer) refresh(true); });
  document.addEventListener('click', (e) => { if (e.target.closest('#bell-btn')) openSheet(); });

  GT.notify = { start, stop, refresh: () => refresh(true) };
  if (GT.state && GT.state.user) start();
})();
