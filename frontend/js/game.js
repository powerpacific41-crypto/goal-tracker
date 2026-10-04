// Game layer UI (Phase 3): quest board, goals, arena (partners, duels, crowns), trophies.
// All points, levels and results come from the server; this file only shows them.
(function () {
  const { esc, toast, state } = window.GT;
  const $ = (s) => document.querySelector(s);

  const PRESETS = {
    health: ['Drink 2L water', 'Sleep by 11pm', 'Eat a healthy meal'],
    fitness: ['Workout', 'Walk 10k steps', 'Stretch 10 min'],
    learning: ['Read 20 pages', 'Study session', 'Practice a language'],
    career: ['Deep work block', 'Learn a new skill', 'Reach out to someone'],
    finance: ['Log expenses', 'No-spend day', 'Move money to savings'],
    mind: ['Meditate', 'Journal', 'Screen-free hour'],
    relationships: ['Call family', 'Quality time', 'Send a kind message'],
    creative: ['Write', 'Draw', 'Practice an instrument'],
    home: ['Tidy up', 'Cook at home', 'Declutter one thing'],
    others: []
  };
  const EV = {
    completion: ['⭐', 'Quest completed'], verified: ['✅', 'Verified by partner'], referee: ['🧑‍⚖️', 'Reviewed a photo'],
    perfect_day: ['✨', 'Perfect Day'], flagged: ['⚠️', 'Photo not accepted'], achievement: ['🏅', 'Achievement'],
    crown: ['👑', 'Weekly crown'], duo: ['🤝', 'Duo quest'], cheer: ['📣', 'Cheered a partner']
  };

  let token = 0;            // cancels stale renders when the user navigates away
  let cache = { quests: [], arena: null, areas: [] };
  let wired = false;

  const areaIcon = (key) => ((cache.areas.find((a) => a.key === key) || {}).icon || '✨');
  const num = (n) => Number(n || 0).toLocaleString();
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'others';
  function dayLabel(key) {
    const d = new Date(key + 'T12:00:00');
    return isNaN(d.getTime()) ? key : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function loading(view) { view.innerHTML = '<p class="loading"><span class="spinner"></span> Loading…</p>'; }
  function failure(view, e) { view.innerHTML = `<section class="panel"><p class="status bad">${esc(e.message)}</p></section>`; }

  /* ---------- modal, confetti ---------- */
  function openModal(html, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    const api = {
      el: wrap.firstElementChild,
      set(h) { wrap.firstElementChild.innerHTML = h; },
      close() { wrap.remove(); document.removeEventListener('keydown', onKey); }
    };
    const dismissible = !opts || opts.dismissible !== false;
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
    for (let i = 0; i < 46; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.5 + 's';
      p.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
      p.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3600);
  }

  function achievementCards(list) {
    return list.map((a) => `<div class="ach-pop"><span class="ach-ico">${esc(a.icon)}</span>
      <div><strong>${esc(a.name)}</strong><br><span class="muted">${esc(a.desc)}</span></div>
      <span class="pts">+${a.bonus}</span></div>`).join('');
  }

  function showAchievements(list) {
    if (!list || !list.length) return;
    confetti();
    const m = openModal(`<h3 class="modal-title">🏅 Achievement${list.length > 1 ? 's' : ''} unlocked!</h3>
      ${achievementCards(list)}<div class="modal-actions"><button class="btn primary" data-m="ok">Nice!</button></div>`);
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-m=ok]')) m.close(); });
  }

  /* ---------- shared pieces ---------- */
  function heroCard(h) {
    const span = Math.max(1, h.next - h.floor);
    return `<section class="hero">
      <div class="hero-top">
        <div class="avatar" aria-hidden="true">${esc(h.icon)}<span class="lvl">${h.level}</span></div>
        <div class="hero-id">
          <div class="hero-name">${esc(h.name)}</div>
          <div class="hero-title">Level ${h.level} · ${esc(h.title)}</div>
        </div>
      </div>
      <div class="xp" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${h.pct}"><i style="width:${h.pct}%"></i></div>
      <div class="xp-note">${num(h.score - h.floor)} / ${num(span)} to Level ${h.level + 1}</div>
      <div class="chips">
        <span class="chip" title="Current streak">🔥 ${h.streak} day${h.streak === 1 ? '' : 's'}</span>
        <span class="chip" title="Total points">⭐ ${num(h.points)}</span>
        <span class="chip" title="Days you were active">📅 ${h.activeDays}</span>
        <span class="chip" title="Weekly crowns">👑 ${h.crowns}</span>
        <span class="chip" title="This week">⚡ ${num(h.weekPoints)} this week</span>
      </div>
    </section>`;
  }

  function sourceBadge(src) {
    return src === 'live' ? '<span class="badge live">● Live camera</span>' : '<span class="badge warn">Camera app</span>';
  }
  function statusBadge(s) {
    if (s === 'verified') return '<span class="badge ok">✅ Verified</span>';
    if (s === 'flagged') return '<span class="badge off">⚠️ Not accepted</span>';
    return '<span class="badge">Waiting for review</span>';
  }

  /* ---------- router ---------- */
  function render(route, view) {
    wire(view);
    token++;
    if (route === 'dashboard') return renderHome(view, token);
    if (route === 'goals') return renderGoals(view, token);
    if (route === 'arena') return renderArena(view, token);
    if (route === 'trophies') return renderTrophies(view, token);
  }

  /* ================= HOME: quest board ================= */
  async function renderHome(view, t) {
    loading(view);
    let d;
    try { d = await Api.call('game.home'); } catch (e) { if (t === token) failure(view, e); return; }
    if (t !== token) return;
    cache.quests = d.quests; cache.areas = d.areas;

    const todo = d.quests.filter((q) => !q.doneToday && !q.locked).length;
    const banners = [];
    if (d.incomingInvites) banners.push(`<a class="banner-link" href="#/arena">🤝 You have ${d.incomingInvites} partner invite${d.incomingInvites > 1 ? 's' : ''} waiting →</a>`);
    if (d.unseenCheers) banners.push(`<a class="banner-link" href="#/arena">💌 ${d.unseenCheers} new cheer${d.unseenCheers > 1 ? 's' : ''} from your partner →</a>`);

    const duels = d.duels.map((x) => {
      const lead = x.me === x.them ? 'Tied' : (x.me > x.them ? `You lead by ${x.me - x.them}` : `${esc(x.partner)} leads by ${x.them - x.me}`);
      return `<a class="duel-strip" href="#/arena"><span>⚔️ You <strong>${num(x.me)}</strong> vs ${esc(x.partner)} <strong>${num(x.them)}</strong></span><span class="muted">${lead} · ${x.daysLeft}d left</span></a>`;
    }).join('');

    const dayBar = d.dailyTotal >= 2
      ? `<div class="daybar"><div><strong>${d.dailyDone}/${d.dailyTotal}</strong> daily quests · Perfect Day <strong>+${d.perfectBonus}</strong></div>
         <div class="mini"><i style="width:${Math.round(d.dailyDone / d.dailyTotal * 100)}%"></i></div></div>` : '';

    view.innerHTML = `
      ${heroCard(d.hero)}
      ${banners.join('')}
      ${duels}
      <section class="panel section">
        <h2>Today's quests</h2>
        <p class="muted">${d.quests.length ? (todo ? `${todo} to go. Each one needs a live photo as proof.` : 'All done for today. Great work!') : 'No quests yet.'}</p>
        ${dayBar}
        ${d.quests.length ? `<ul class="quests">${d.quests.map(questRow).join('')}</ul>` : `
          <div class="empty-mini"><p>Create a goal and add activities to start earning points.</p>
          <a class="btn primary" href="#/goals">Set up my first goal</a></div>`}
      </section>`;
    showAchievements(d.newAchievements);
  }

  function questRow(q) {
    const freq = q.frequencyType === 'weekly' ? `${q.doneWeek}/${q.target} this week` : 'Daily';
    let right;
    if (q.doneToday) right = '<span class="done-tag">✓ Done</span>';
    else if (q.locked) right = '<span class="done-tag soft">Week target met</span>';
    else right = `<button class="btn primary q-btn" type="button" data-g="complete" data-id="${esc(q.activityId)}">📸 +${q.points}</button>`;
    return `<li class="quest ${q.doneToday ? 'done' : ''} ${q.locked ? 'locked' : ''}">
      <span class="q-icon">${areaIcon(q.areaKey)}</span>
      <div class="q-main"><strong>${esc(q.name)}</strong><span class="muted">${esc(q.goalTitle)} · ${esc(freq)}</span></div>
      ${right}</li>`;
  }

  /* ---- completing a quest ---- */
  async function startComplete(id, btn) {
    const q = cache.quests.find((x) => x.activityId === id);
    if (!q) return;
    btn.disabled = true;
    try {
      const begin = await Api.call('completions.begin', { activityId: id });
      const info = { code: begin.code, who: state.user.name, title: begin.activityName };
      const photo = await Camera.capture(info);
      const res = await reviewAndSubmit(photo, q, begin, info);
      celebrate(res);
      renderHome($('#view'), ++token);
    } catch (e) {
      if (e.code !== 'CANCELLED') toast(e.message, 'error');
    } finally { btn.disabled = false; }
  }

  function reviewAndSubmit(first, q, begin, info) {
    return new Promise((resolve, reject) => {
      let photo = first;
      const m = openModal('', { dismissible: false });
      const paint = (err) => m.set(`
        <h3 class="modal-title">Looking good?</h3>
        <img class="shot" src="${photo.previewUrl}" alt="Your photo with the live watermark">
        <p class="hint">${photo.source === 'live' ? 'Your partner will see the LIVE watermark and code <strong>' + esc(begin.code) + '</strong>.' : 'Taken with your camera app. Your partner will see it labelled as such.'}</p>
        <div class="field"><label for="g-note">Note (optional)</label><input id="g-note" maxlength="200" placeholder="How did it go?"></div>
        <p class="form-error" role="alert">${esc(err || '')}</p>
        <div class="modal-actions">
          <button class="btn" type="button" data-m="cancel">Cancel</button>
          <button class="btn" type="button" data-m="retake">Retake</button>
          <button class="btn primary" type="button" data-m="send">Submit +${q.points}</button>
        </div>`);
      paint();
      m.el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        if (b.dataset.m === 'cancel') { m.close(); reject(Camera.cancelled()); }
        else if (b.dataset.m === 'retake') {
          m.el.parentElement.hidden = true;
          try { photo = await Camera.capture(info); } catch (err) { if (err.code !== 'CANCELLED') toast(err.message, 'error'); }
          m.el.parentElement.hidden = false;
          paint();
        } else if (b.dataset.m === 'send') {
          const note = ($('#g-note') || {}).value || '';
          m.el.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          b.textContent = 'Saving…';
          try {
            const res = await Api.call('completions.submit', {
              activityId: q.activityId, code: begin.code, notes: note,
              photo: { base64: photo.base64, mime: photo.mime, takenAt: photo.takenAt, source: photo.source }
            });
            m.close();
            resolve(res);
          } catch (err) {
            if (['BAD_CODE', 'CODE_EXPIRED', 'NOT_ALLOWED'].indexOf(err.code) !== -1) { m.close(); reject(err); }
            else paint(err.message);
          }
        }
      });
    });
  }

  function celebrate(res) {
    confetti();
    const up = res.levelAfter > res.levelBefore;
    const h = res.hero;
    const m = openModal(`
      ${up ? `<div class="levelup">⬆️ LEVEL UP!<br><span>Level ${h.level} · ${esc(h.title)} ${esc(h.icon)}</span></div>` : ''}
      <div class="earned">+${res.earned}<small>points</small></div>
      <ul class="breakdown">${res.breakdown.map((b, i) => `<li style="animation-delay:${i * 0.12}s"><span>${esc(b.label)}</span><strong>+${b.points}</strong></li>`).join('')}</ul>
      <div class="xp"><i style="width:${h.pct}%"></i></div>
      <div class="xp-note">Level ${h.level} · ${num(h.score - h.floor)} / ${num(Math.max(1, h.next - h.floor))} to Level ${h.level + 1}</div>
      ${res.newAchievements.length ? `<h4 class="modal-sub">🏅 Achievements unlocked</h4>${achievementCards(res.newAchievements)}` : ''}
      <p class="hint center">Your partner can now review your photo for bonus points.</p>
      <div class="modal-actions"><button class="btn primary" data-m="ok">Awesome!</button></div>`);
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-m=ok]')) m.close(); });
  }

  /* ================= GOALS ================= */
  async function renderGoals(view, t) {
    loading(view);
    let d;
    try { d = await Api.call('goals.list'); } catch (e) { if (t === token) failure(view, e); return; }
    if (t !== token) return;
    cache.areas = d.areas;
    const areaOpts = d.areas.map((a) => `<option value="${a.key}">${a.icon} ${esc(a.label)}</option>`).join('');

    view.innerHTML = `
      <section class="panel section">
        <h2>New goal</h2>
        <p class="muted">A goal is the big thing. Activities inside it are the quests you complete.</p>
        <form class="inline-form two" data-gform="goal" novalidate style="margin-top:14px">
          <div class="field"><label for="g-title">Goal</label><input id="g-title" name="title" maxlength="80" placeholder="e.g. Get fit this year" required></div>
          <div class="field"><label for="g-dur">Duration</label>
            <select id="g-dur" name="durationMonths"><option value="1">1 month</option><option value="3" selected>3 months</option><option value="6">6 months</option><option value="12">12 months</option></select></div>
          <button class="btn primary" type="submit">Create goal</button>
        </form>
        <p class="form-error" id="goal-error" role="alert"></p>
      </section>
      ${d.goals.length ? d.goals.map((g) => goalPanel(g, areaOpts, d.nameMax)).join('') : '<section class="panel empty"><p>No goals yet. Create your first one above.</p></section>'}`;
    view.querySelectorAll('form[data-gform=activity]').forEach(fillPresets);
  }

  function goalPanel(g, areaOpts, nameMax) {
    const acts = g.activities.length ? `<ul class="act-list">${g.activities.map((a) => `
      <li><span class="q-icon">${areaIcon(a.areaKey)}</span>
        <div class="q-main"><strong>${esc(a.name)}</strong><span class="muted">${a.frequencyType === 'weekly' ? a.target + '× per week' : 'Every day'}</span></div>
        <button class="btn small" type="button" data-g="archive-act" data-id="${esc(a.activityId)}">Remove</button></li>`).join('')}</ul>`
      : '<p class="muted">No activities yet. Add one below.</p>';
    return `<section class="panel section">
      <div class="goal-head"><div><h2>${esc(g.title)}</h2><p class="muted">Ends ${esc(dayLabel(g.endDate))}</p></div>
        <button class="btn small danger" type="button" data-g="archive-goal" data-id="${esc(g.goalId)}">Archive</button></div>
      ${acts}
      <form class="act-form" data-gform="activity" data-goal="${esc(g.goalId)}" novalidate>
        <h3>Add an activity</h3>
        <div class="field"><label>Life area</label><select name="areaKey" data-g="area">${areaOpts}</select></div>
        <div class="chips presets" data-presets></div>
        <div class="field"><label>Activity name</label><input name="activityName" maxlength="${nameMax}" placeholder="What will you do?" required></div>
        <div class="two-col">
          <div class="field"><label>How often</label><select name="frequencyType" data-g="freq"><option value="daily">Every day</option><option value="weekly">Some days a week</option></select></div>
          <div class="field" data-target hidden><label>Times per week</label><select name="target">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        </div>
        <p class="form-error" role="alert"></p>
        <button class="btn primary" type="submit">Add activity</button>
      </form></section>`;
  }

  function fillPresets(form) {
    const key = form.elements.areaKey.value;
    form.querySelector('[data-presets]').innerHTML = (PRESETS[key] || [])
      .map((p) => `<button type="button" class="chip btn-chip" data-g="preset" data-name="${esc(p)}">${esc(p)}</button>`).join('');
  }

  /* ================= ARENA ================= */
  async function renderArena(view, t) {
    loading(view);
    let d, dir;
    try {
      [d, dir] = await Promise.all([Api.call('arena.get'), Api.call('users.directory')]);
    } catch (e) { if (t === token) failure(view, e); return; }
    if (t !== token) return;
    cache.arena = d;

    const inv = d.invites;
    const taken = {};
    inv.partners.concat(inv.incoming, inv.outgoing).forEach((x) => { taken[x.userId] = true; });
    const pickable = dir.users.filter((u) => !taken[u.userId]);

    const invites = inv.incoming.map((x) => `
      <div class="row-card"><span>🤝 <strong>${esc(x.name)}</strong> wants to be your accountability partner</span>
        <span class="row-actions"><button class="btn small primary" data-g="respond" data-id="${esc(x.partnershipId)}" data-accept="1">Accept</button>
        <button class="btn small" data-g="respond" data-id="${esc(x.partnershipId)}" data-accept="0">Decline</button></span></div>`).join('')
      + inv.outgoing.map((x) => `
      <div class="row-card"><span>⏳ Waiting for <strong>${esc(x.name)}</strong> to accept</span>
        <button class="btn small" data-g="revoke" data-id="${esc(x.partnershipId)}">Cancel</button></div>`).join('');

    view.innerHTML = `
      ${heroCard(d.hero)}
      ${invites}
      ${d.duels.length ? d.duels.map(duelCard).join('') : `
        <section class="panel section"><h2>⚔️ The Arena</h2>
          <p class="muted">Team up with someone you trust. Every week you duel for a 👑 crown, work on a duo quest together, and review each other's live photos.</p></section>`}
      ${d.duels.length > 1 ? boardCard(d.board) : ''}
      ${d.feed.length ? feedCard(d.feed) : ''}
      <section class="panel section">
        <h2>Find a partner</h2>
        ${pickable.length ? `<form class="inline-form two" data-gform="invite" novalidate style="margin-top:12px">
          <div class="field"><label for="inv-user">Choose someone</label>
            <select id="inv-user" name="userId">${pickable.map((u) => `<option value="${esc(u.userId)}">${esc(u.name)} (${esc(u.userId)})</option>`).join('')}</select></div>
          <button class="btn primary" type="submit">Send invite</button></form>
          <p class="form-error" id="inv-error" role="alert"></p>`
          : '<p class="muted">Nobody else is available to invite right now. Ask your admin to add your partner as a user.</p>'}
        <p class="hint">Partners can see your quest photos and progress while you are partnered. Either of you can end it at any time.</p>
      </section>
      ${d.cheers.length ? `<section class="panel section"><h2>💌 Cheers for you</h2><ul class="cheer-list">${d.cheers.map((c) =>
        `<li class="${c.isNew ? 'new' : ''}"><span class="cheer-emoji">${esc(c.emoji)}</span><span><strong>${esc(c.from)}</strong> ${c.kind === 'nudge' ? 'nudged you. Time for a quest!' : 'cheered you on'}</span></li>`).join('')}</ul></section>` : ''}
      <section class="panel section">
        <h2>How the Arena works</h2>
        <ul class="rules">
          <li>👑 <strong>Weekly crown:</strong> most points Monday to Sunday wins +${d.rules.crown}.</li>
          <li>🤝 <strong>Duo quest:</strong> finish ${d.duels.length ? d.duels[0].duo.target : 20} quests together (at least ${d.duels.length ? d.duels[0].duo.minEach : 5} each) for +${d.rules.duo} each.</li>
          <li>✅ <strong>Verify:</strong> when your partner approves your photo you get +${d.rules.verify}; they earn +${d.rules.referee} for reviewing.</li>
          <li>⚠️ A photo that is not accepted takes its points back. Retake it with the live camera.</li>
        </ul>
      </section>`;
    showAchievements(d.newAchievements);
  }

  function duelCard(x) {
    const total = x.week.me + x.week.them;
    const pct = total > 0 ? Math.round(Math.max(0, x.week.me) / total * 100) : 50;
    const lead = x.week.me === x.week.them ? 'Dead heat!' : (x.week.me > x.week.them ? `You are ahead by ${x.week.me - x.week.them}` : `${esc(x.partner.name)} is ahead by ${x.week.them - x.week.me}`);
    const duoPct = Math.min(100, Math.round(x.duo.combined / x.duo.target * 100));
    const duoNote = x.duo.combined >= x.duo.target && x.duo.me >= x.duo.minEach && x.duo.them >= x.duo.minEach
      ? '🎉 Reached! The bonus lands when the week ends.'
      : `You ${x.duo.me} · ${esc(x.partner.name)} ${x.duo.them} (min ${x.duo.minEach} each)`;
    return `<section class="panel section duel">
      <div class="duel-head"><h2>⚔️ This week's duel</h2><span class="muted">${x.week.daysLeft === 0 ? 'Last day!' : x.week.daysLeft + ' days left'}</span></div>
      <div class="versus">
        <div class="side"><div class="avatar sm">${esc(cache.arena.hero.icon)}</div><strong>You</strong><span class="muted">Lv ${cache.arena.hero.level}</span><span class="crowns">👑 ${x.crowns.me}</span></div>
        <div class="vs">VS</div>
        <div class="side"><div class="avatar sm">${esc(x.partner.icon)}</div><strong>${esc(x.partner.name)}</strong><span class="muted">Lv ${x.partner.level} · 🔥 ${x.partner.streak}</span><span class="crowns">👑 ${x.crowns.them}</span></div>
      </div>
      <div class="scorebar" aria-label="Score split"><i style="width:${pct}%"></i></div>
      <div class="scores"><strong>${num(x.week.me)}</strong><span class="muted">${lead}</span><strong>${num(x.week.them)}</strong></div>

      <div class="duo"><div class="duo-top"><strong>🤝 Duo quest</strong><span>${x.duo.combined}/${x.duo.target}</span></div>
        <div class="mini"><i style="width:${duoPct}%"></i></div><p class="hint">${duoNote}</p></div>

      <div class="cheer-row" aria-label="Send a cheer">
        ${cache.arena.cheerEmojis.map((e) => `<button type="button" class="emoji-btn" data-g="cheer" data-to="${esc(x.partner.userId)}" data-emoji="${esc(e)}" aria-label="Cheer ${esc(e)}">${esc(e)}</button>`).join('')}
        <button type="button" class="btn small" data-g="nudge" data-to="${esc(x.partner.userId)}">👋 Nudge</button>
      </div>
      ${x.history.length ? `<div class="chips hist">${x.history.map((h) => `<span class="chip ${h.result}" title="${h.me} vs ${h.them}">${h.result === 'won' ? '👑' : (h.result === 'lost' ? '🥈' : '🤝')} ${esc(dayLabel(h.weekKey))} · ${h.me}–${h.them}${h.duo ? ' · 🤝' : ''}</span>`).join('')}</div>` : ''}
      <div class="end-row"><button class="btn link" type="button" data-g="revoke" data-id="${esc(x.partnershipId)}">End partnership with ${esc(x.partner.name)}</button></div>
    </section>`;
  }

  function boardCard(board) {
    const medals = ['🥇', '🥈', '🥉'];
    const top = Math.max(1, board[0].points);
    return `<section class="panel section"><h2>🏁 Leaderboard · this week</h2><ol class="board">${board.map((b, i) => `
      <li class="${b.isMe ? 'me' : ''}"><span class="rank">${medals[i] || (i + 1)}</span><span class="b-name">${esc(b.name)}${b.isMe ? ' (you)' : ''}</span>
      <span class="b-bar"><i style="width:${Math.max(4, Math.round(Math.max(0, b.points) / top * 100))}%"></i></span><strong>${num(b.points)}</strong></li>`).join('')}</ol></section>`;
  }

  function feedCard(feed) {
    return `<section class="panel section"><h2>📸 Partner activity</h2>
      <p class="muted">Check their live photos. Look for the LIVE watermark and the matching code.</p>
      <ul class="feed">${feed.map((f) => `<li>
        <div class="feed-main"><strong>${esc(f.name)}</strong> · ${esc(f.activity)}<br>
          <span class="muted">${esc(dayLabel(f.date))} · +${f.points}</span>
          ${f.notes ? `<br><span class="muted">“${esc(f.notes)}”</span>` : ''}</div>
        <div class="feed-side">${sourceBadge(f.source)} ${statusBadge(f.status)}
          <button class="btn small ${f.canReview ? 'primary' : ''}" type="button" data-g="photo" data-id="${esc(f.completionId)}">${f.canReview ? 'Review photo' : 'View photo'}</button></div>
      </li>`).join('')}</ul></section>`;
  }

  async function viewPhoto(id) {
    const item = cache.arena && cache.arena.feed.find((f) => f.completionId === id);
    if (!item) return;
    const m = openModal('<p class="loading"><span class="spinner"></span> Loading photo…</p>');
    try {
      const r = await Api.call('completions.photo', { completionId: id });
      const checks = `<ul class="checklist">
        <li>The banner says <strong>${item.source === 'live' ? 'LIVE PIC' : 'CAMERA APP PIC'}</strong> and shows code <strong class="code">${esc(item.code)}</strong></li>
        <li>The date and time match when they say they did it</li>
        <li>The photo shows the activity: <strong>${esc(item.activity)}</strong></li></ul>`;
      m.set(`<h3 class="modal-title">${esc(item.name)} · ${esc(item.activity)}</h3>
        <img class="shot" src="data:${r.mime};base64,${r.base64}" alt="Completion photo">
        <p>${sourceBadge(item.source)} ${statusBadge(item.status)}</p>
        ${item.canReview ? checks : ''}
        <p class="form-error" role="alert"></p>
        <div class="modal-actions">
          <button class="btn" type="button" data-m="close">Close</button>
          ${item.canReview ? `<button class="btn danger" type="button" data-m="flagged">Not convincing</button>
          <button class="btn primary" type="button" data-m="verified">✅ Verify</button>` : ''}
        </div>`);
      m.el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        if (b.dataset.m === 'close') return m.close();
        if (b.dataset.m === 'flagged' && !confirm('Mark this photo as not convincing? Their points for it will be taken back.')) return;
        m.el.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        try {
          const res = await Api.call('completions.verify', { completionId: id, verdict: b.dataset.m });
          m.close();
          toast(res.status === 'verified' ? 'Verified. You both earned bonus points!' : 'Photo marked as not accepted.', res.status === 'verified' ? 'success' : 'info');
          renderArena($('#view'), ++token);
          showAchievements(res.newAchievements);
        } catch (err) {
          m.el.querySelectorAll('button').forEach((x) => { x.disabled = false; });
          const p = m.el.querySelector('.form-error'); if (p) p.textContent = err.message;
        }
      });
    } catch (e) { m.set(`<p class="status bad">${esc(e.message)}</p><div class="modal-actions"><button class="btn" data-m="close">Close</button></div>`); m.el.addEventListener('click', (ev) => { if (ev.target.closest('[data-m=close]')) m.close(); }); }
  }

  /* ================= TROPHIES ================= */
  async function renderTrophies(view, t) {
    loading(view);
    let d;
    try { d = await Api.call('game.trophies'); } catch (e) { if (t === token) failure(view, e); return; }
    if (t !== token) return;
    const h = d.hero, p = h.parts;
    const got = d.achievements.filter((a) => a.unlockedAt);
    const sorted = d.achievements.slice().sort((a, b) => (b.unlockedAt ? 1 : 0) - (a.unlockedAt ? 1 : 0) || (b.value / b.goal) - (a.value / a.goal));
    const recentCut = Date.now() - 2 * 86400000;

    view.innerHTML = `
      ${heroCard(h)}
      <section class="panel section">
        <h2>How your level grows</h2>
        <p class="muted">Level score = points + how regularly you show up + the size of your chart.</p>
        <div class="formula">
          <div><span>⭐ Points</span><strong>${num(p.points)}</strong></div><em>+</em>
          <div><span>📅 Regularity<small>${h.activeDays} active days × 5</small></span><strong>${num(p.regularity)}</strong></div><em>+</em>
          <div><span>📋 Chart<small>${h.activities} activities × 15 (max 20)</small></span><strong>${num(p.chart)}</strong></div><em>=</em>
          <div class="total"><span>Level score</span><strong>${num(h.score)}</strong></div>
        </div>
      </section>
      <section class="panel section">
        <h2>🏅 Achievements <span class="muted">${got.length}/${d.achievements.length}</span></h2>
        <div class="ach-grid">${sorted.map((a) => {
          const isNew = a.unlockedAt && new Date(a.unlockedAt).getTime() > recentCut;
          return `<div class="ach ${a.unlockedAt ? 'got' : ''}">
            <span class="ach-ico">${esc(a.icon)}</span>${isNew ? '<span class="new-tag">NEW</span>' : ''}
            <strong>${esc(a.name)}</strong><span class="muted">${esc(a.desc)}</span>
            ${a.unlockedAt ? `<span class="pts">+${a.bonus}</span>` : `<div class="mini"><i style="width:${Math.round(a.value / a.goal * 100)}%"></i></div><span class="hint">${num(a.value)}/${num(a.goal)} · +${a.bonus} pts</span>`}</div>`;
        }).join('')}</div>
      </section>
      <section class="panel section">
        <h2>👑 Crown cabinet</h2>
        ${d.crowns.length ? `<div class="chips">${d.crowns.map((c) => `<span class="chip">👑 Week of ${esc(dayLabel(c.weekKey))}${c.partner ? ' vs ' + esc(c.partner) : ''}</span>`).join('')}</div>`
          : '<p class="muted">No crowns yet. Win a weekly duel against your partner to earn one.</p>'}
      </section>
      <section class="panel section">
        <h2>Recent points</h2>
        ${d.recent.length ? `<ul class="xp-log">${d.recent.map((e) => {
          const ev = EV[e.type] || ['•', e.type];
          return `<li><span>${ev[0]}</span><div class="q-main"><strong>${esc(e.note || ev[1])}</strong><span class="muted">${esc(ev[1])} · ${esc(new Date(e.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</span></div><strong class="${e.points < 0 ? 'neg' : 'pos'}">${e.points > 0 ? '+' : ''}${e.points}</strong></li>`;
        }).join('')}</ul>` : '<p class="muted">Complete a quest to see your points here.</p>'}
      </section>`;
  }

  /* ================= events ================= */
  function wire(view) {
    if (wired) return;
    wired = true;
    view.addEventListener('click', onClick);
    view.addEventListener('submit', onSubmit);
    view.addEventListener('change', onChange);
  }

  function refresh() { render(location.hash.replace(/^#\//, '') || 'dashboard', $('#view')); }

  async function onClick(e) {
    const b = e.target.closest('[data-g]');
    if (!b || b.tagName === 'SELECT') return;
    const a = b.dataset.g;
    try {
      if (a === 'complete') return startComplete(b.dataset.id, b);
      if (a === 'preset') {
        const form = b.closest('form');
        form.elements.activityName.value = b.dataset.name;
        form.elements.activityName.dataset.key = slug(b.dataset.name);
        return;
      }
      if (a === 'archive-goal') {
        if (!confirm('Archive this goal? Its activities stop appearing as quests. Your points and history stay.')) return;
        await Api.call('goals.archive', { goalId: b.dataset.id }); toast('Goal archived.', 'success'); return refresh();
      }
      if (a === 'archive-act') {
        if (!confirm('Remove this activity? Your points and history stay.')) return;
        await Api.call('activities.archive', { activityId: b.dataset.id }); return refresh();
      }
      if (a === 'respond') {
        const r = await Api.call('partners.respond', { partnershipId: b.dataset.id, accept: b.dataset.accept === '1' });
        toast(b.dataset.accept === '1' ? 'You are partners now!' : 'Invite declined.', 'success');
        refresh(); return showAchievements(r.newAchievements);
      }
      if (a === 'revoke') {
        if (!confirm('End this partnership? You will stop seeing each other\'s photos and duels.')) return;
        await Api.call('partners.revoke', { partnershipId: b.dataset.id }); return refresh();
      }
      if (a === 'cheer' || a === 'nudge') {
        b.disabled = true;
        const r = await Api.call('cheers.send', { toUserId: b.dataset.to, kind: a, emoji: b.dataset.emoji });
        toast(a === 'nudge' ? 'Nudge sent 👋' : 'Cheer sent ' + b.dataset.emoji + (r.earned ? ' (+' + r.earned + ' pt)' : ''), 'success');
        b.disabled = false; return showAchievements(r.newAchievements);
      }
      if (a === 'photo') return viewPhoto(b.dataset.id);
    } catch (err) { b.disabled = false; toast(err.message, 'error'); }
  }

  function onChange(e) {
    const el = e.target;
    const form = el.closest && el.closest('form[data-gform=activity]');
    if (!form) return;
    if (el.name === 'areaKey') fillPresets(form);
    if (el.name === 'frequencyType') form.querySelector('[data-target]').hidden = el.value !== 'weekly';
  }

  async function onSubmit(e) {
    const kind = e.target.dataset.gform;
    if (!kind) return;
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type=submit]');
    const err = form.querySelector('.form-error') || $('#goal-error') || $('#inv-error');
    if (err) err.textContent = '';
    btn.disabled = true;
    try {
      if (kind === 'goal') {
        const r = await Api.call('goals.create', { title: form.elements.title.value, durationMonths: form.elements.durationMonths.value });
        toast('Goal created. Now add some activities!', 'success'); await refresh(); showAchievements(r.newAchievements);
      } else if (kind === 'activity') {
        const name = form.elements.activityName.value.trim();
        const preset = (PRESETS[form.elements.areaKey.value] || []).indexOf(name) !== -1;
        const r = await Api.call('activities.add', {
          goalId: form.dataset.goal, areaKey: form.elements.areaKey.value, activityName: name,
          activityKey: preset ? slug(name) : 'others', frequencyType: form.elements.frequencyType.value, target: form.elements.target.value
        });
        toast('Activity added.', 'success'); await refresh(); showAchievements(r.newAchievements);
      } else if (kind === 'invite') {
        await Api.call('partners.invite', { userId: form.elements.userId.value });
        toast('Invite sent.', 'success'); refresh();
      }
    } catch (ex) { if (err) err.textContent = ex.message; }
    finally { btn.disabled = false; }
  }

  window.Game = { render: render };
})();
