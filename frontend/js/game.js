// Phase 6 screens: Today, Leaderboard, Partners (accountability) and Reviews (admin).
// Also shares the photo-completion flow with the calendar (window.GT.ui.completeTask).
// Every point and rule comes from the server; this file only shows it.
(function () {
  const { esc, toast, state } = window.GT;
  const $ = (s) => document.querySelector(s);

  const AREAS = {
    health: ['🥗', 'Health'], social: ['🎉', 'Social'], family: ['👨‍👩‍👧', 'Family'], career: ['💼', 'Career'],
    spiritual: ['🕊️', 'Spiritual'], finance: ['💰', 'Finance & Wealth']
  };
  const areaIcon = (k) => (AREAS[k] || ['✨'])[0];
  const areaName = (k) => (AREAS[k] || [0, k])[1];
  const EV = {
    task: ['✅', 'Task completed'], missed: ['⏰', 'Missed task'], bonus_week: ['📅', 'Weekly 100%'],
    bonus_month: ['🗓️', 'Monthly 100%'], bonus_goal: ['🏆', 'Goal 100%']
  };

  let token = 0, wired = false;
  const S = { today: null, partnerId: null, partnerData: null, boardPeriod: 'all', selected: {}, filter: '' };

  const fmtPts = (n) => { const v = Math.round(Number(n || 0) * 100) / 100; return (v > 0 ? '+' : '') + v.toLocaleString(); };
  const pts = (n) => (Math.round(Number(n || 0) * 100) / 100).toLocaleString();
  function dayLabel(key) {
    const d = new Date(key + 'T12:00:00');
    return isNaN(d.getTime()) ? key : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }
  const loading = (view) => { view.innerHTML = '<p class="loading"><span class="spinner"></span> Loading…</p>'; };
  const failure = (view, e) => { view.innerHTML = `<section class="panel"><p class="status bad">${esc(e.message)}</p><button class="btn" type="button" data-g="reload">Try again</button></section>`; };
  const pad = (n) => (n < 10 ? '0' : '') + n;

  /* ---------- modal (bottom sheet on phones), confetti ---------- */
  function openModal(html, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('modal-open');
    const dismissible = !opts || opts.dismissible !== false;
    const api = {
      el: wrap.firstElementChild, wrap,
      set(h) { wrap.firstElementChild.innerHTML = h; },
      close() { wrap.remove(); document.removeEventListener('keydown', onKey); if (!document.querySelector('.modal-backdrop')) document.body.classList.remove('modal-open'); }
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) api.close(); };
    if (dismissible) {
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) api.close(); });
    }
    return api;
  }

  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#e8a317', '#1f8a5b', '#0f3d4c', '#e4572e', '#7b5ea7', '#2e9cca'];
    const box = document.createElement('div');
    box.className = 'confetti';
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.5 + 's';
      p.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3600);
  }

  function ask(title, text, yes, opts) {
    return new Promise((resolve) => {
      const m = openModal(`<h3 class="modal-title">${esc(title)}</h3><p>${esc(text)}</p>
        ${opts && opts.input ? `<div class="field"><label for="ask-in">${esc(opts.input)}</label><textarea id="ask-in" rows="3" maxlength="${opts.max || 200}" placeholder="${esc(opts.placeholder || '')}"></textarea></div>
        <p class="form-error" id="ask-err" role="alert"></p>` : ''}
        <div class="modal-actions"><button class="btn" data-m="no" type="button">Cancel</button>
        <button class="btn ${opts && opts.danger === false ? 'primary' : 'danger'}" data-m="yes" type="button">${esc(yes)}</button></div>`, { dismissible: true });
      let done = false;
      m.wrap.addEventListener('click', (e) => { if (e.target === m.wrap && !done) { done = true; resolve(null); } });
      m.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        if (b.dataset.m === 'no') { done = true; m.close(); return resolve(null); }
        const val = opts && opts.input ? ($('#ask-in').value || '').trim() : '';
        if (opts && opts.input && opts.required && val.length < 3) { $('#ask-err').textContent = 'Please write a short reason.'; return; }
        done = true; m.close(); resolve({ value: val });
      });
    });
  }

  /* ================================================================ */
  /* Completing a task (shared with the calendar)                     */
  /* ================================================================ */
  const ruleText = (p) => (p.rule === 'floating' ? `floating +${Math.round((state.rules ? state.rules.floating : 0.5) * 100)}%` : p.rule === 'locked' ? 'last day, no bonus' : '');

  async function completeTask(task, done) {
    try {
      const begin = await Api.call('completions.begin', { instanceId: task.id });
      const info = { code: begin.code, who: state.user.name, title: begin.activityName };
      const photo = await Camera.capture(info);
      const res = await reviewAndSubmit(photo, task, begin, info);
      celebrate(res, task);
      if (done) await done(res);
    } catch (e) {
      if (e.code !== 'CANCELLED') toast(e.message, 'error');
    }
  }

  function reviewAndSubmit(first, task, begin, info) {
    return new Promise((resolve, reject) => {
      let photo = first;
      const total = begin.points ? begin.points.total : 0;
      const m = openModal('', { dismissible: false });
      const paint = (err) => m.set(`
        <h3 class="modal-title">Complete “${esc(task.name)}”</h3>
        <img class="shot" src="${photo.previewUrl}" alt="Your photo with the live watermark">
        <p class="hint">${photo.source === 'live' ? 'Your partners will see the LIVE watermark and code <strong>' + esc(begin.code) + '</strong>.' : 'Taken with your camera app. Your partners will see it labelled as such.'}</p>
        <div class="field"><label for="g-note">Note (optional)</label><input id="g-note" maxlength="200" placeholder="How did it go?"></div>
        <p class="form-error" role="alert">${esc(err || '')}</p>
        <div class="modal-actions stack-sm">
          <button class="btn primary" type="button" data-m="send">Submit · ${fmtPts(total)}</button>
          <button class="btn" type="button" data-m="retake">Retake photo</button>
          <button class="btn link" type="button" data-m="cancel">Cancel</button>
        </div>`);
      paint();
      m.el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        if (b.dataset.m === 'cancel') { m.close(); reject(Camera.cancelled()); }
        else if (b.dataset.m === 'retake') {
          m.wrap.hidden = true;
          try { photo = await Camera.capture(info); } catch (err) { if (err.code !== 'CANCELLED') toast(err.message, 'error'); }
          m.wrap.hidden = false;
          paint();
        } else if (b.dataset.m === 'send') {
          const note = ($('#g-note') || {}).value || '';
          m.el.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          b.textContent = 'Saving…';
          try {
            const res = await Api.call('completions.submit', {
              instanceId: task.id, code: begin.code, notes: note,
              photo: { base64: photo.base64, mime: photo.mime, takenAt: photo.takenAt, source: photo.source }
            });
            m.close(); resolve(res);
          } catch (err) {
            if (['BAD_CODE', 'CODE_EXPIRED', 'NOT_ALLOWED', 'NOT_FOUND'].indexOf(err.code) !== -1) { m.close(); reject(err); }
            else paint(err.message);
          }
        }
      });
    });
  }

  function celebrate(res, task) {
    if (res.breakdown.length > 1) confetti();
    const m = openModal(`
      <div class="earned">${fmtPts(res.earned)}<small>points</small></div>
      <p class="center"><strong>${esc(task.name)}</strong> is done${res.taskStatus === 'floating' ? ' <span class="badge ok">floating bonus</span>' : ''}.</p>
      <ul class="breakdown">${res.breakdown.map((b, i) => `<li style="animation-delay:${i * 0.12}s"><span>${esc(b.label)}</span><strong>${fmtPts(b.points)}</strong></li>`).join('')}</ul>
      ${res.note ? `<p class="hint center">${esc(res.note)}</p>` : ''}
      <p class="hint center">Your partners can now check your photo. Total: <strong>${pts(res.totalPoints)}</strong></p>
      <div class="modal-actions"><button class="btn primary wide" data-m="ok" type="button">Nice!</button></div>`);
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-m=ok]')) m.close(); });
  }

  window.GT.ui = { openModal, confetti, ask, completeTask, fmtPts, pts, areaIcon, areaName };

  /* ================================================================ */
  /* Router                                                           */
  /* ================================================================ */
  function render(route, view) {
    wire(view);
    token++;
    if (route === 'today') return renderToday(view, token);
    if (route === 'board') return renderBoard(view, token);
    if (route === 'partners') return renderPartners(view, token);
    if (route === 'reviews') return renderReviews(view, token);
  }

  /* ================================================================ */
  /* TODAY                                                            */
  /* ================================================================ */
  function taskBadge(t) {
    if (t.status === 'locked') return '<span class="tag lck">🔒 Last day</span>';
    if (t.status === 'floating') return `<span class="tag flo">↪ Floating ${t.points.bonus ? '+' + t.points.bonus : ''}</span>`;
    return '';
  }

  function taskRow(t, today) {
    const sub = [esc(t.goalTitle), esc(areaName(t.areaKey)), t.frequency === 'weekly' ? 'weekly' : 'monthly'].join(' · ');
    const late = t.assigned < today ? ` · planned ${esc(dayLabel(t.assigned))}` : '';
    return `<li class="task ${t.status}">
      <span class="q-icon">${areaIcon(t.areaKey)}</span>
      <div class="q-main"><strong>${esc(t.name)}</strong><span class="muted">${sub}${late}</span>
        <span class="tagrow">${taskBadge(t)}${t.status === 'locked' ? '<span class="muted tiny">Do it today or lose 5</span>' : ''}</span></div>
      ${t.canComplete ? `<button class="btn primary t-btn" type="button" data-g="complete" data-id="${esc(t.id)}">📸<span>${fmtPts(t.points.total)}</span></button>` : ''}
    </li>`;
  }

  function chanceBar(label, c) {
    if (!c) return '';
    const pct = c.total ? Math.round(c.done / c.total * 100) : 0;
    return `<div class="chance"><div class="chance-top"><span>${label}</span><strong>${c.done}/${c.total}</strong><span class="bonus">${fmtPts(c.bonus)} bonus</span></div>
      <div class="mini"><i style="width:${pct}%"></i></div></div>`;
  }

  async function renderToday(view, t) {
    loading(view);
    let d;
    try { d = await Api.call('today.get'); } catch (e) { if (t === token) failure(view, e); return; }
    if (t !== token) return;
    S.today = d; state.rules = d.rules;
    const R = d.rules;
    const banners = [];
    if (d.incomingInvites) banners.push(`<a class="banner-link" href="#/partners">🤝 ${d.incomingInvites} partner request${d.incomingInvites > 1 ? 's' : ''} waiting →</a>`);
    if (d.reviewsWaiting) banners.push(`<a class="banner-link" href="#/reviews">🔎 ${d.reviewsWaiting} flagged task${d.reviewsWaiting > 1 ? 's' : ''} need a decision →</a>`);

    const hero = `<section class="hero today-hero">
      <div class="hero-row"><div><div class="hero-name">Hi ${esc(d.name.split(' ')[0])} 👋</div><div class="hero-title">${esc(dayLabel(d.today))}</div></div>
        <a class="score-pill" href="#/board" aria-label="Open leaderboard"><strong class="${d.points < 0 ? 'neg-on' : ''}">${pts(d.points)}</strong><span>points</span></a></div>
      <div class="chips"><span class="chip">⚡ ${fmtPts(d.weekPoints)} this week</span><span class="chip">🎯 ${d.goalCount} goal${d.goalCount === 1 ? '' : 's'}</span></div>
    </section>`;

    if (!d.goalCount) {
      view.innerHTML = hero + banners.join('') + `<section class="panel empty"><h2>Start with a goal</h2>
        <p>Pick your life areas and activities. The app schedules every task for you and keeps score.</p>
        <a class="btn primary wide" href="#/goals">Create my first goal</a></section>` + rulesCard(R);
      return;
    }

    const held = d.held.length ? `<section class="panel section hold-box"><h2>⏸ On hold</h2>
      <p class="muted">A partner doubted ${d.held.length === 1 ? 'this task' : 'these tasks'}. No points until an admin decides.</p>
      <ul class="tasks">${d.held.map((x) => `<li class="task held"><span class="q-icon">${areaIcon(x.areaKey)}</span>
        <div class="q-main"><strong>${esc(x.name)}</strong><span class="muted">Flagged by ${esc(x.hold ? x.hold.by : '')}${x.hold && x.hold.reason ? ': “' + esc(x.hold.reason) + '”' : ''}</span></div></li>`).join('')}</ul></section>` : '';

    const chances = d.chances.map((c) => `<div class="chance-goal"><h3>${esc(c.title)}</h3>${chanceBar('This week', c.week)}${chanceBar('This month', c.month)}${chanceBar('Whole goal', c.goal)}</div>`).join('');

    view.innerHTML = `${hero}${banners.join('')}
      <section class="panel section"><h2>Due today</h2>
        <p class="muted">${d.due.length ? `${d.due.length} to do. Each one needs a live photo as proof.` : 'Nothing due. You are all caught up. 🎉'}</p>
        ${d.due.length ? `<ul class="tasks">${d.due.map((x) => taskRow(x, d.today)).join('')}</ul>` : ''}
      </section>
      ${held}
      ${d.doneToday.length ? `<section class="panel section"><h2>Done today</h2><ul class="tasks">${d.doneToday.map((x) => `<li class="task done"><span class="q-icon">${areaIcon(x.areaKey)}</span>
        <div class="q-main"><strong>${esc(x.name)}</strong><span class="muted">${esc(x.goalTitle)}</span></div><span class="done-tag">${x.completionStatus === 'held' ? '⏸ Held' : '✓ ' + fmtPts(x.earned)}</span></li>`).join('')}</ul></section>` : ''}
      <section class="panel section"><h2>Bonus chances</h2><p class="muted">Finish every task of the period to earn the bonus.</p>${chances}</section>
      ${d.coming.length ? `<section class="panel section"><h2>Coming up</h2><ul class="tasks compact">${d.coming.map((x) => `<li class="task"><span class="q-icon">${areaIcon(x.areaKey)}</span>
        <div class="q-main"><strong>${esc(x.name)}</strong><span class="muted">${esc(dayLabel(x.assigned))} · ${esc(x.goalTitle)}</span></div><span class="muted tiny">${fmtPts(x.points.total)}</span></li>`).join('')}</ul></section>` : ''}
      ${rulesCard(R)}`;
  }

  function rulesCard(R) {
    const high = Object.keys(R.areaPoints).map((k) => areaName(k)).join(', ');
    return `<details class="panel section rules-box"><summary>How points work</summary>
      <ul class="rules">
        <li>⭐ <strong>${esc(high)}</strong> tasks earn <strong>${R.areaPoints.health}</strong> points. Every other area earns <strong>${R.defaultPoints}</strong>.</li>
        <li>↪ A <strong>floating</strong> task (moved from its planned day) earns <strong>+${Math.round(R.floating * 100)}%</strong>.</li>
        <li>🔒 A <strong>locked</strong> task (its last allowed day) earns the base points, no bonus.</li>
        <li>⏰ A task you do not complete costs <strong>${R.missed}</strong>. Your total can go below zero.</li>
        <li>📅 100% of a week: <strong>+${R.week} × tasks</strong> · 🗓️ 100% of a month: <strong>+${R.month} × tasks</strong> · 🏆 100% of a goal: <strong>+${R.goal} × tasks</strong>.</li>
        <li>⏸ A task a partner flags earns nothing until an admin approves it.</li>
      </ul></details>`;
  }

  /* ================================================================ */
  /* LEADERBOARD                                                      */
  /* ================================================================ */
  async function renderBoard(view, t) {
    loading(view);
    let d;
    try { d = await Api.call('board.get', { period: S.boardPeriod }); } catch (e) { if (t === token) failure(view, e); return; }
    if (t !== token) return;
    const medals = ['🥇', '🥈', '🥉'];
    const seg = [['all', 'All time'], ['month', 'This month'], ['week', 'This week']].map((x) =>
      `<button type="button" class="${S.boardPeriod === x[0] ? 'on' : ''}" data-g="period" data-v="${x[0]}" aria-pressed="${S.boardPeriod === x[0]}">${x[1]}</button>`).join('');
    const me = d.me, p = me.parts;
    const mine = `<section class="hero today-hero"><div class="hero-row"><div><div class="hero-title">${me.listed ? 'Your rank' : 'Not on the board yet'}</div>
        <div class="hero-name">${me.listed ? '#' + me.rank + ' of ' + me.of : 'Create a goal to join'}</div></div>
        <div class="score-pill static"><strong class="${me.points < 0 ? 'neg-on' : ''}">${pts(me.points)}</strong><span>points</span></div></div>
      <div class="chips"><span class="chip">✅ ${fmtPts(p.tasks)} tasks</span><span class="chip">🎁 ${fmtPts(p.bonuses)} bonuses</span><span class="chip">⏰ ${fmtPts(p.penalties)} missed${p.missed ? ' (' + p.missed + ')' : ''}</span></div></section>`;
    const top = Math.max(1, ...d.rows.map((r) => r.points));
    const list = d.rows.length ? `<ol class="board">${d.rows.map((r) => `<li class="${r.isMe ? 'me' : ''}">
        <span class="rank">${medals[r.rank - 1] || r.rank}</span>
        <span class="b-name"><strong>${esc(r.name)}${r.isMe ? ' (you)' : ''}</strong><span class="muted tiny">${r.tasksDone} task${r.tasksDone === 1 ? '' : 's'} done</span>
          <span class="b-bar"><i style="width:${r.points > 0 ? Math.max(4, Math.round(r.points / top * 100)) : 0}%"></i></span></span>
        <strong class="b-pts ${r.points < 0 ? 'neg' : ''}">${pts(r.points)}</strong></li>`).join('')}</ol>`
      : '<p class="muted">Nobody has an active goal yet.</p>';
    const recent = d.recent.length ? `<section class="panel section"><h2>My recent points</h2><ul class="xp-log">${d.recent.map((e) => {
      const ev = EV[e.type] || ['•', e.type];
      return `<li><span>${ev[0]}</span><div class="q-main"><strong>${esc(e.note || ev[1])}</strong><span class="muted tiny">${esc(ev[1])} · ${esc(new Date(e.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</span></div>
        <strong class="${e.points < 0 ? 'neg' : 'pos'}">${fmtPts(e.points)}</strong></li>`;
    }).join('')}</ul></section>` : '';
    view.innerHTML = `${mine}
      <section class="panel section"><div class="board-head"><h2>🏁 Leaderboard</h2><div class="seg" role="group" aria-label="Period">${seg}</div></div>
        <p class="hint">Everyone with an active goal is listed. Equal points share a rank.</p>${list}</section>${recent}`;
  }

  /* ================================================================ */
  /* PARTNERS                                                         */
  /* ================================================================ */
  async function renderPartners(view, t) {
    if (S.partnerId) return renderPartnerDetail(view, t);
    loading(view);
    let d;
    try { d = await Api.call('acct.overview'); } catch (e) { if (t === token) failure(view, e); return; }
    if (t !== token) return;
    S.overview = d;
    const incoming = d.incoming.map((x) => `<div class="row-card"><span>🤝 <strong>${esc(x.name)}</strong> wants to be accountability partners${x.note ? `<br><span class="muted">“${esc(x.note)}”</span>` : ''}</span>
      <span class="row-actions"><button class="btn small primary" data-g="respond" data-id="${esc(x.partnershipId)}" data-accept="1" type="button">Accept</button>
      <button class="btn small" data-g="respond" data-id="${esc(x.partnershipId)}" data-accept="0" type="button">Decline</button></span></div>`).join('');
    const partners = d.partners.length ? `<ul class="plist">${d.partners.map((x) => `<li class="pcard">
        <button type="button" class="pmain" data-g="open-partner" data-id="${esc(x.userId)}">
          <span class="avatar sm">${esc(x.name.charAt(0).toUpperCase())}</span>
          <span class="q-main"><strong>${esc(x.name)}</strong><span class="muted tiny">${pts(x.points)} pts · ${fmtPts(x.weekPoints)} this week${x.hasGoal ? '' : ' · no active goal'}</span>
            ${x.onHold ? `<span class="tag lck">⏸ ${x.onHold} on hold</span>` : ''}</span><span class="chev" aria-hidden="true">›</span></button>
        <button class="btn link tiny" type="button" data-g="end" data-id="${esc(x.partnershipId)}" data-name="${esc(x.name)}">End</button></li>`).join('')}</ul>`
      : '<p class="muted">No partners yet. Send a request below. Partners see each other\'s progress and photos, and can flag tasks they doubt.</p>';
    const waiting = d.outgoing.length ? `<h3 class="sub">Waiting for an answer</h3>${d.outgoing.map((x) => `<div class="row-card soft"><span>⏳ <strong>${esc(x.name)}</strong></span>
      <button class="btn small" data-g="cancel-invite" data-id="${esc(x.partnershipId)}" type="button">Cancel</button></div>`).join('')}` : '';
    view.innerHTML = `${incoming}
      <section class="panel section"><h2>🤝 Accountability partners</h2>${partners}${waiting}</section>
      <section class="panel section"><h2>Invite people</h2>${inviteForm(d.people)}</section>`;
  }

  function inviteForm(people) {
    if (!people.length) return '<p class="muted">Everyone is already a partner or has a pending request. Ask your admin to add more users.</p>';
    const f = S.filter.toLowerCase();
    const shown = people.filter((p) => !f || p.name.toLowerCase().indexOf(f) !== -1 || p.userId.indexOf(f) !== -1);
    const n = Object.keys(S.selected).length;
    return `<p class="muted">Tick one or more people and send them a request.</p>
      <div class="field"><label for="p-search">Search</label><input id="p-search" type="search" data-g-input="filter" placeholder="Type a name" value="${esc(S.filter)}" autocomplete="off"></div>
      <ul class="pick" id="pick-list">${shown.map((p) => `<li><label class="pick-row"><input type="checkbox" data-g-check="${esc(p.userId)}" ${S.selected[p.userId] ? 'checked' : ''}>
        <span class="avatar xs">${esc(p.name.charAt(0).toUpperCase())}</span><span class="q-main"><strong>${esc(p.name)}</strong><span class="muted tiny">${esc(p.userId)}${p.hasGoal ? '' : ' · no goal yet'}</span></span></label></li>`).join('') || '<li class="muted">No match.</li>'}</ul>
      <div class="field"><label for="p-note">Message (optional)</label><input id="p-note" maxlength="120" placeholder="Let's keep each other honest"></div>
      <p class="form-error" id="inv-error" role="alert"></p>
      <button class="btn primary wide" type="button" data-g="send-invites" id="send-btn" ${n ? '' : 'disabled'}>${n ? `Send request to ${n} ${n === 1 ? 'person' : 'people'}` : 'Pick at least one person'}</button>
      <p class="hint">Partners can see your goals, points and completion photos while you are partnered. Either of you can end it any time.</p>`;
  }

  function statusBadge(f) {
    if (f.status === 'held') return '<span class="badge off">⏸ On hold</span>';
    if (f.status === 'approved') return '<span class="badge ok">✅ Admin approved</span>';
    if (f.status === 'rejected') return '<span class="badge off">✕ Admin rejected</span>';
    if (f.status === 'verified') return '<span class="badge ok">👍 Looks good</span>';
    return '<span class="badge">Not checked</span>';
  }
  const srcBadge = (s) => (s === 'live' ? '<span class="badge live">● Live camera</span>' : '<span class="badge warn">Camera app</span>');

  async function renderPartnerDetail(view, t) {
    loading(view);
    let d;
    try { d = await Api.call('acct.partner', { userId: S.partnerId }); } catch (e) { if (t === token) { S.partnerId = null; failure(view, e); } return; }
    if (t !== token) return;
    S.partnerData = d;
    const st = d.stats;
    const goals = d.goals.length ? d.goals.map((g) => `<div class="pgoal"><div class="goal-head"><div><h3>${esc(g.title)}</h3>
        <p class="muted tiny">${esc(dayLabel(g.startDate))} → ${esc(dayLabel(g.endDate))}</p></div><span class="pl-pct">${g.counts.pct}%</span></div>
      <div class="mini big"><i style="width:${g.counts.pct}%"></i></div>
      <p class="pl-stats">${g.counts.completed} done · ${g.counts.missed} missed · ${g.counts.open} to go</p>
      <ul class="act-list">${g.activities.map((a) => `<li><span class="q-icon">${areaIcon(a.areaKey)}</span><div class="q-main"><strong>${esc(a.name)}</strong>
        <span class="muted tiny">${a.frequencyType === 'weekly' ? a.target + '× a week' : a.target + '× a month'}</span></div><span class="pl-mini">${a.counts.completed}/${a.counts.total}</span></li>`).join('')}</ul>
      ${g.copyable ? `<button class="btn primary wide" type="button" data-g="copy-goal" data-id="${esc(g.goalId)}">📋 Copy this goal sheet</button>` : '<p class="hint">This goal was made with an older version and cannot be copied.</p>'}</div>`).join('') : '<p class="muted">No active goals.</p>';
    const feed = d.feed.length ? `<ul class="feed">${d.feed.map((f) => `<li class="feed-item">
        <div class="feed-main"><span class="q-icon">${areaIcon(f.areaKey)}</span><div class="q-main"><strong>${esc(f.name)}</strong>
          <span class="muted tiny">${esc(dayLabel(f.date))} · ${fmtPts(f.points)}${f.taskStatus === 'floating' ? ' · floating' : ''}${f.taskStatus === 'locked' ? ' · last day' : ''}</span>
          ${f.notes ? `<span class="muted tiny">“${esc(f.notes)}”</span>` : ''}${f.status === 'held' && f.reason ? `<span class="muted tiny">Flagged: “${esc(f.reason)}”</span>` : ''}</div></div>
        <div class="feed-side">${srcBadge(f.source)} ${statusBadge(f)}
          <button class="btn small ${f.canReview ? 'primary' : ''}" type="button" data-g="photo" data-id="${esc(f.completionId)}">${f.canReview ? 'Check photo' : 'View photo'}</button></div></li>`).join('')}</ul>`
      : '<p class="muted">No completed tasks in the last 30 days.</p>';
    view.innerHTML = `<div class="back-row"><button class="btn link" type="button" data-g="back">‹ All partners</button></div>
      <section class="hero today-hero"><div class="hero-row"><div><div class="hero-name">${esc(d.partner.name)}</div><div class="hero-title">${st.weekDone}/${st.weekTotal} done this week</div></div>
        <div class="score-pill static"><strong class="${st.points < 0 ? 'neg-on' : ''}">${pts(st.points)}</strong><span>points</span></div></div>
        <div class="chips"><span class="chip">⚡ ${fmtPts(st.weekPoints)} this week</span><span class="chip">✅ ${st.tasksDone} done</span><span class="chip">⏰ ${st.missed} missed</span><span class="chip">📌 ${st.dueToday} due today</span></div></section>
      <section class="panel section"><h2>Goals</h2>${goals}</section>
      <section class="panel section"><h2>📸 Completed tasks</h2>
        <p class="muted">Look for the LIVE watermark and the matching code. If something looks wrong, flag it: the task goes on hold and an admin decides.</p>${feed}</section>`;
  }

  async function viewPhoto(id) {
    const item = S.partnerData && S.partnerData.feed.find((f) => f.completionId === id);
    if (!item) return;
    const m = openModal('<p class="loading"><span class="spinner"></span> Loading photo…</p>');
    try {
      const r = await Api.call('completions.photo', { completionId: id });
      const checks = `<ul class="checklist"><li>Banner says <strong>${item.source === 'live' ? 'LIVE PIC' : 'CAMERA APP PIC'}</strong> with code <strong class="code">${esc(item.code)}</strong></li>
        <li>The date and time make sense</li><li>The photo shows: <strong>${esc(item.name)}</strong></li></ul>`;
      m.set(`<h3 class="modal-title">${esc(S.partnerData.partner.name)} · ${esc(item.name)}</h3>
        <img class="shot" src="data:${r.mime};base64,${r.base64}" alt="Completion photo">
        <p>${srcBadge(item.source)} ${statusBadge(item)}</p>${item.canReview ? checks : ''}
        <p class="form-error" role="alert"></p>
        <div class="modal-actions stack-sm">
          ${item.canReview ? '<button class="btn primary" type="button" data-m="verified">👍 Looks good</button><button class="btn danger" type="button" data-m="flag">⚠️ Flag this task</button>' : ''}
          <button class="btn" type="button" data-m="close">Close</button></div>`);
      m.el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        if (b.dataset.m === 'close') return m.close();
        let reason = '';
        if (b.dataset.m === 'flag') {
          m.wrap.hidden = true;
          const a = await ask('Flag this task?', 'It goes on hold: no points for your partner until an admin approves or rejects it. Say what looks wrong.',
            'Flag it', { input: 'Why do you doubt it?', required: true, placeholder: 'e.g. the photo is a screenshot' });
          m.wrap.hidden = false;
          if (!a) return;
          reason = a.value;
        }
        m.el.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        try {
          const res = await Api.call('acct.review', { completionId: id, verdict: b.dataset.m === 'flag' ? 'flagged' : 'verified', reason });
          m.close();
          toast(res.status === 'held' ? 'Flagged. The task is on hold until an admin decides.' : 'Marked as looks good.', res.status === 'held' ? 'info' : 'success');
          renderPartnerDetail($('#view'), ++token);
        } catch (err) {
          m.el.querySelectorAll('button').forEach((x) => { x.disabled = false; });
          const p = m.el.querySelector('.form-error'); if (p) p.textContent = err.message;
        }
      });
    } catch (e) {
      m.set(`<p class="status bad">${esc(e.message)}</p><div class="modal-actions"><button class="btn" data-m="close" type="button">Close</button></div>`);
      m.el.addEventListener('click', (ev) => { if (ev.target.closest('[data-m=close]')) m.close(); });
    }
  }

  /* ================================================================ */
  /* REVIEWS (admin)                                                  */
  /* ================================================================ */
  async function renderReviews(view, t) {
    loading(view);
    let d;
    try { d = await Api.call('reviews.list'); } catch (e) { if (t === token) failure(view, e); return; }
    if (t !== token) return;
    S.reviews = d;
    const waiting = d.waiting.length ? d.waiting.map((c) => `<div class="review">
        <div class="review-top"><span class="q-icon">${areaIcon(c.areaKey)}</span><div class="q-main"><strong>${esc(c.name)}</strong>
          <span class="muted tiny">${esc(c.owner.name)} · ${esc(dayLabel(c.date))} · ${fmtPts(c.points)}</span></div>${srcBadge(c.source)}</div>
        <p class="flagline">🚩 <strong>${esc(c.flaggedBy.name)}</strong> says: “${esc(c.reason)}”</p>
        <div class="row-actions"><button class="btn small" type="button" data-g="rphoto" data-id="${esc(c.completionId)}">View photo</button>
        ${c.owner.userId === d.me || c.flaggedBy.userId === d.me ? '<span class="muted tiny">You are involved, so another admin must decide.</span>'
          : `<button class="btn small primary" type="button" data-g="resolve" data-d="approve" data-id="${esc(c.completionId)}">Approve</button>
             <button class="btn small danger" type="button" data-g="resolve" data-d="reject" data-id="${esc(c.completionId)}">Reject</button>`}</div></div>`).join('')
      : '<p class="muted">Nothing is waiting. 🎉</p>';
    const decided = d.decided.length ? `<section class="panel section"><h2>Recently decided</h2><ul class="xp-log">${d.decided.map((c) => `<li><span>${c.status === 'approved' ? '✅' : '✕'}</span>
      <div class="q-main"><strong>${esc(c.name)} · ${esc(c.owner.name)}</strong><span class="muted tiny">${c.status === 'approved' ? 'Approved' : 'Rejected'} by ${esc(c.resolvedBy)}${c.resolution ? ': “' + esc(c.resolution) + '”' : ''}</span></div></li>`).join('')}</ul></section>` : '';
    view.innerHTML = `<section class="panel section"><h2>🔎 Flagged tasks</h2>
      <p class="muted">Approve = the task counts and points are given. Reject = no points; the task re-opens if its window is still open, otherwise it is missed.</p>${waiting}</section>${decided}`;
  }

  async function reviewPhoto(id) {
    const m = openModal('<p class="loading"><span class="spinner"></span> Loading photo…</p>');
    try {
      const r = await Api.call('completions.photo', { completionId: id });
      m.set(`<h3 class="modal-title">Flagged photo</h3><img class="shot" src="data:${r.mime};base64,${r.base64}" alt="Completion photo">
        <div class="modal-actions"><button class="btn" data-m="close" type="button">Close</button></div>`);
    } catch (e) { m.set(`<p class="status bad">${esc(e.message)}</p><div class="modal-actions"><button class="btn" data-m="close" type="button">Close</button></div>`); }
    m.el.addEventListener('click', (ev) => { if (ev.target.closest('[data-m=close]')) m.close(); });
  }

  /* ================================================================ */
  /* Events                                                           */
  /* ================================================================ */
  function wire(view) {
    if (wired) return;
    wired = true;
    view.addEventListener('click', onClick);
    view.addEventListener('change', onChange);
    view.addEventListener('input', onInput);
  }

  function refresh() { render(location.hash.replace(/^#\//, '') || 'today', $('#view')); }

  function updateSendButton() {
    const btn = $('#send-btn');
    if (!btn) return;
    const n = Object.keys(S.selected).length;
    btn.disabled = !n;
    btn.textContent = n ? `Send request to ${n} ${n === 1 ? 'person' : 'people'}` : 'Pick at least one person';
  }

  function onChange(e) {
    const el = e.target;
    if (el.dataset && el.dataset.gCheck) {
      if (el.checked) S.selected[el.dataset.gCheck] = true; else delete S.selected[el.dataset.gCheck];
      updateSendButton();
    }
  }

  function onInput(e) {
    const el = e.target;
    if (el.dataset && el.dataset.gInput === 'filter') {
      S.filter = el.value;
      const people = (S.overview && S.overview.people) || [];
      const f = S.filter.toLowerCase();
      const shown = people.filter((p) => !f || p.name.toLowerCase().indexOf(f) !== -1 || p.userId.indexOf(f) !== -1);
      $('#pick-list').innerHTML = shown.map((p) => `<li><label class="pick-row"><input type="checkbox" data-g-check="${esc(p.userId)}" ${S.selected[p.userId] ? 'checked' : ''}>
        <span class="avatar xs">${esc(p.name.charAt(0).toUpperCase())}</span><span class="q-main"><strong>${esc(p.name)}</strong><span class="muted tiny">${esc(p.userId)}${p.hasGoal ? '' : ' · no goal yet'}</span></span></label></li>`).join('') || '<li class="muted">No match.</li>';
    }
  }

  async function onClick(e) {
    const b = e.target.closest('[data-g]');
    if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const a = b.dataset.g, view = $('#view');
    try {
      if (a === 'reload') return refresh();
      if (a === 'complete') { b.disabled = true; await completeTask({ id: b.dataset.id, name: (S.today.due.find((x) => x.id === b.dataset.id) || {}).name || 'Task' }, async () => { await renderToday(view, ++token); }); b.disabled = false; return; }
      if (a === 'period') { S.boardPeriod = b.dataset.v; return renderBoard(view, ++token); }
      if (a === 'open-partner') { S.partnerId = b.dataset.id; window.scrollTo(0, 0); return renderPartners(view, ++token); }
      if (a === 'back') { S.partnerId = null; S.partnerData = null; return renderPartners(view, ++token); }
      if (a === 'photo') return viewPhoto(b.dataset.id);
      if (a === 'rphoto') return reviewPhoto(b.dataset.id);
      if (a === 'respond') {
        await Api.call('acct.respond', { partnershipId: b.dataset.id, accept: b.dataset.accept === '1' });
        toast(b.dataset.accept === '1' ? 'You are partners now!' : 'Request declined.', 'success'); return refresh();
      }
      if (a === 'cancel-invite') { await Api.call('acct.revoke', { partnershipId: b.dataset.id }); toast('Request cancelled.', 'info'); return refresh(); }
      if (a === 'end') {
        const ok = await ask('End partnership?', `You and ${b.dataset.name} will stop seeing each other's progress and photos.`, 'End it');
        if (!ok) return;
        await Api.call('acct.revoke', { partnershipId: b.dataset.id }); toast('Partnership ended.', 'info'); return refresh();
      }
      if (a === 'send-invites') {
        const ids = Object.keys(S.selected);
        if (!ids.length) return;
        b.disabled = true;
        const err = $('#inv-error'); if (err) err.textContent = '';
        try {
          const r = await Api.call('acct.invite', { userIds: ids, note: ($('#p-note') || {}).value || '' });
          S.selected = {}; S.filter = '';
          toast(r.sent.length ? `Request sent to ${r.sent.length} ${r.sent.length === 1 ? 'person' : 'people'}.` : 'No request was sent.', r.sent.length ? 'success' : 'error');
          if (r.skipped.length) toast(`Skipped: ${r.skipped.map((s) => s.name).join(', ')}`, 'info');
          return refresh();
        } catch (ex) { if (err) err.textContent = ex.message; b.disabled = false; return; }
      }
      if (a === 'copy-goal') {
        b.disabled = true;
        try {
          const tpl = await Api.call('acct.template', { goalId: b.dataset.id });
          if (!window.Plan || !window.Plan.startFromTemplate) throw new Error('The goal wizard is not available.');
          S.partnerId = null; S.partnerData = null;
          await window.Plan.startFromTemplate(tpl);
        } finally { b.disabled = false; }
        return;
      }
      if (a === 'resolve') {
        const approve = b.dataset.d === 'approve';
        const r = await ask(approve ? 'Approve this task?' : 'Reject this task?',
          approve ? 'The task counts and the points are given back.' : 'No points. The task re-opens if its window is still open, otherwise it is missed.',
          approve ? 'Approve' : 'Reject', { input: 'Note (optional)', danger: approve ? false : true, placeholder: 'Shown to everyone involved' });
        if (!r) return;
        await Api.call('reviews.resolve', { completionId: b.dataset.id, decision: b.dataset.d, note: r.value });
        toast(approve ? 'Approved.' : 'Rejected.', 'success'); return renderReviews(view, ++token);
      }
    } catch (err) { b.disabled = false; toast(err.message, 'error'); }
  }

  window.Game = { render: render };
})();
