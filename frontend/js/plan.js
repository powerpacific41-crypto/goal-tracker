// Phases 4 and 5: goal creation wizard, goals with progress, and the floating calendar.
// The server (Plan.gs) owns every rule: dates, how many activities are generated, how far each may float.
// This file only collects input, draws what the server returns, and sends the user's actions.
(function () {
  const { esc, toast, state } = window.GT;
  const $ = (s) => document.querySelector(s);

  /* ---------- state ---------- */
  let token = 0;                  // cancels stale renders when the user navigates away
  let wired = false;
  const S = {
    cat: null, today: null, goals: [],
    wiz: null,
    cal: { month: null, sel: null, goalId: '', mode: 'month', data: null, drag: null }
  };

  /* ---------- small helpers ---------- */
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const utc = (k) => { const p = k.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); };
  const addDays = (k, n) => { const p = k.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10); };
  const monthStart = (k) => k.slice(0, 8) + '01';
  const monthEnd = (k) => { const p = k.split('-'); return new Date(Date.UTC(+p[0], +p[1], 0)).toISOString().slice(0, 10); };
  const addMonths = (k, n) => {
    const p = k.split('-'); const m = +p[1] - 1 + n;
    const yy = +p[0] + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return `${yy}-${pad(mm + 1)}-${pad(Math.min(+p[2], last))}`;
  };
  const endDateFor = (start, months) => addDays(addMonths(start, months), -1);   // mirrors Plan.gs; the server has the final say
  const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  const mondayOf = (k) => addDays(k, -((utc(k).getUTCDay() + 6) % 7));
  const fmt = (k, opts) => utc(k).toLocaleDateString([], Object.assign({ timeZone: 'UTC' }, opts || { weekday: 'short', day: 'numeric', month: 'short' }));
  const fmtLong = (k) => fmt(k, { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtYear = (k) => fmt(k, { day: 'numeric', month: 'short', year: 'numeric' });
  const monthTitle = (k) => fmt(k, { month: 'long', year: 'numeric' });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const num = (n) => Number(n || 0).toLocaleString();
  const loading = (view) => { view.innerHTML = '<p class="loading"><span class="spinner"></span> Loading…</p>'; };
  const failure = (view, e, retry) => {
    view.innerHTML = `<section class="panel"><p class="status bad">${esc(e.message)}</p><button class="btn" type="button" data-p="${retry || 'reload'}">Try again</button></section>`;
  };
  const keepScroll = (fn) => { const y = window.scrollY; fn(); window.scrollTo(0, y); };

  /* ---------- catalog lookups (areas and activities are data from the server) ---------- */
  const area = (key) => (S.cat && S.cat.areas.find((a) => a.key === key)) || { key, label: key, icon: '✨', activities: [] };
  const actDef = (areaKey, key) => area(areaKey).activities.find((a) => a.key === key) || null;
  const actIcon = (areaKey, key) => (actDef(areaKey, key) || {}).icon || area(areaKey).icon || '✨';
  const freqLabel = (f, t) => `${cap(f)} ${t}×`;

  /** "15 min per session", "Amount to save each month: 1,500" ... built from the catalog's parameter definitions. */
  function paramText(areaKey, key, params) {
    const def = actDef(areaKey, key);
    if (!def || !params) return '';
    return def.params.filter((pd) => params[pd.key] !== undefined && params[pd.key] !== '')
      .map((pd) => `${pd.label}: ${num(params[pd.key])}${pd.unit && pd.unit !== 'amount' ? ' ' + pd.unit : ''}`).join(' · ');
  }

  async function ensureCatalog() {
    if (S.cat) return S.cat;
    S.cat = await Api.call('plan.catalog');
    return S.cat;
  }

  /* ---------- statuses ---------- */
  const ST = {
    scheduled: { label: 'Scheduled', cls: 'sch', ico: '🗓' },
    pending: { label: 'Pending', cls: 'pen', ico: '●' },
    floating: { label: 'Floating', cls: 'flo', ico: '↪' },
    locked: { label: 'Locked', cls: 'lck', ico: '🔒' },
    completed: { label: 'Completed', cls: 'cmp', ico: '✓' },
    missed: { label: 'Missed', cls: 'mis', ico: '✕' }
  };
  const stOf = (s) => ST[s] || ST.scheduled;

  /* ---------- modal ---------- */
  function openModal(html, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    const dismissible = !opts || opts.dismissible !== false;
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) api.close(); };
    const api = {
      el: wrap.firstElementChild, wrap,
      set(h) { wrap.firstElementChild.innerHTML = h; },
      close() { wrap.remove(); document.removeEventListener('keydown', onKey); }
    };
    if (dismissible) {
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) api.close(); });
    }
    return api;
  }

  /** Confirmation dialog for destructive actions. Resolves true / false. */
  function confirmBox(title, text, yes) {
    return new Promise((resolve) => {
      const m = openModal(`<h3 class="modal-title">${esc(title)}</h3><p>${esc(text)}</p>
        <div class="modal-actions"><button class="btn" data-m="no" type="button">Cancel</button><button class="btn danger" data-m="yes" type="button">${esc(yes)}</button></div>`);
      m.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        m.close(); resolve(b.dataset.m === 'yes');
      });
      m.wrap.addEventListener('click', (e) => { if (e.target === m.wrap) resolve(false); });
    });
  }

  /* ================================================================ */
  /* Entry point                                                      */
  /* ================================================================ */
  function render(route, view) {
    wire(view);
    const t = ++token;
    if (route === 'calendar') return renderCalendar(view, t);
    if (S.wiz) return renderWizard(view);
    return renderGoals(view, t);
  }

  /* ================================================================ */
  /* GOALS                                                            */
  /* ================================================================ */
  async function renderGoals(view, t) {
    loading(view);
    let d;
    try { d = await Api.call('plan.goals'); } catch (e) { if (t === token) failure(view, e); return; }
    if (t !== token) return;
    S.cat = d.catalog; S.today = d.today; S.goals = d.goals;

    const head = `<section class="panel section pl-head">
      <div><h2>Goals</h2><p class="muted">${d.goals.length ? 'Your active goals and how far along they are.' : 'Plan a goal and the app schedules the activities for you.'}</p></div>
      <button class="btn primary" type="button" data-p="wiz-start">＋ Create New Goal</button></section>`;
    if (!d.goals.length) {
      view.innerHTML = head + `<section class="panel empty"><p><strong>No goals yet.</strong></p>
        <p>Pick a duration, a start date and the life areas you care about. Every activity lands in your calendar and can float to a later day when life gets in the way.</p>
        <button class="btn primary" type="button" data-p="wiz-start">Create your first goal</button></section>`;
      return;
    }
    view.innerHTML = head + d.goals.map(goalCard).join('');
  }

  function bar(pct, label) {
    return `<div class="pl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(label || 'Completion')}"><i style="width:${pct}%"></i></div>`;
  }

  function goalCard(g) {
    const c = g.counts;
    const areas = [];
    g.activities.forEach((a) => { if (areas.indexOf(a.areaKey) === -1) areas.push(a.areaKey); });
    const acts = g.activities.map((a) => {
      const pt = paramText(a.areaKey, a.activityKey, a.params);
      return `<li><span class="q-icon">${actIcon(a.areaKey, a.activityKey)}</span>
        <div class="q-main"><strong>${esc(a.name)}</strong><span class="muted">${esc(freqLabel(a.frequencyType, a.target))}${pt ? ' · ' + esc(pt) : ''}</span></div>
        <span class="pl-mini" title="Completed of scheduled">${a.counts.completed}/${a.counts.total}</span></li>`;
    }).join('');
    return `<section class="panel section pl-goal">
      <div class="goal-head"><div><h2>${esc(g.title)}</h2>
        <p class="muted">${esc(fmtYear(g.startDate))} → ${esc(fmtYear(g.endDate))} · ${g.durationMonths} month${g.durationMonths === 1 ? '' : 's'}</p></div>
        <span class="pl-pct">${c.pct}%</span></div>
      ${bar(c.pct, g.title + ' completion')}
      <p class="pl-stats"><span class="pl-dot cmp"></span>${c.completed} done <span class="pl-dot mis"></span>${c.missed} missed <span class="pl-dot pen"></span>${c.open} to go</p>
      <div class="chips">${areas.map((k) => `<span class="chip">${area(k).icon} ${esc(area(k).label)}</span>`).join('')}</div>
      <ul class="act-list">${acts}</ul>
      <div class="row-actions pl-actions">
        <button class="btn small primary" type="button" data-p="open-cal" data-goal="${esc(g.goalId)}" data-date="${esc(g.startDate > S.today ? g.startDate : S.today)}">📅 Open calendar</button>
        <button class="btn small danger" type="button" data-p="archive-goal" data-goal="${esc(g.goalId)}" data-title="${esc(g.title)}">Archive</button>
      </div></section>`;
  }

  /* ================================================================ */
  /* WIZARD  (1 duration -> 2 start date -> 3 areas and activities -> 4 summary)  */
  /* ================================================================ */
  const STEPS = ['Duration', 'Start date', 'Activities', 'Summary'];

  function startWizard(view) {
    const today = S.today || localToday();
    S.wiz = { step: 1, title: '', months: 3, start: today, areas: {}, error: '', summary: null, busy: false };
    renderWizard(view);
    window.scrollTo(0, 0);
  }

  function newActState(def) {
    return { on: true, frequencyType: def.freq, target: def.target, params: {}, name: '' };
  }

  function renderWizard(view) {
    const w = S.wiz;
    const dots = STEPS.map((s, i) => `<li class="${i + 1 === w.step ? 'on' : (i + 1 < w.step ? 'done' : '')}" ${i + 1 === w.step ? 'aria-current="step"' : ''}><span>${i + 1}</span>${esc(s)}</li>`).join('');
    let body = '';
    if (w.step === 1) body = stepDuration(w);
    else if (w.step === 2) body = stepStart(w);
    else if (w.step === 3) body = stepActivities(w);
    else body = stepSummary(w);
    const last = w.step === 4;
    view.innerHTML = `
      <section class="panel section pl-wiz">
        <div class="pl-wiz-top"><h2>Create New Goal</h2><button class="btn link" type="button" data-p="wiz-cancel">Cancel</button></div>
        ${w.copiedFrom ? `<div class="banner">📋 Copied from <strong>${esc(w.copiedFrom)}</strong>. Change anything you like${w.moneyHidden ? ' and enter your own money amounts' : ''}.</div>` : ''}
        <ol class="pl-steps" aria-label="Progress">${dots}</ol>
        ${body}
        <p class="form-error" id="wiz-error" role="alert">${esc(w.error || '')}</p>
        <div class="modal-actions pl-wiz-nav">
          ${w.step > 1 ? `<button class="btn" type="button" data-p="wiz-back" ${w.busy ? 'disabled' : ''}>← ${w.step === 4 ? 'Edit' : 'Back'}</button>` : ''}
          ${last ? `<button class="btn primary" type="button" data-p="wiz-create" ${w.busy || !w.summary ? 'disabled' : ''}>${w.busy ? 'Creating…' : 'Create goal'}</button>`
                 : `<button class="btn primary" type="button" data-p="wiz-next" ${w.busy ? 'disabled' : ''}>${w.busy ? 'Checking…' : 'Next →'}</button>`}
        </div>
      </section>`;
  }

  function stepDuration(w) {
    const months = (S.cat && S.cat.limits.months) || 12;
    const chips = Array.from({ length: months }, (_, i) => i + 1).map((n) =>
      `<button type="button" class="pl-choice ${w.months === n ? 'on' : ''}" data-p="months" data-n="${n}" aria-pressed="${w.months === n}"><strong>${n}</strong><small>${n === 1 ? 'month' : 'months'}</small></button>`).join('');
    return `<h3>How long is this goal?</h3>
      <div class="field"><label for="w-title">Goal name</label><input id="w-title" data-p-input="title" maxlength="80" placeholder="e.g. Fit, calm and debt-free" value="${esc(w.title)}"></div>
      <p class="hint" style="margin:14px 0 8px">Duration</p>
      <div class="pl-choices">${chips}</div>`;
  }

  function stepStart(w) {
    const today = S.today || localToday();
    const maxStart = addDays(today, (S.cat && S.cat.limits.maxStartAheadDays) || 366);
    const end = endDateFor(w.start, w.months);
    return `<h3>When do you start?</h3>
      <div class="field"><label for="w-start">Starting date</label><input id="w-start" type="date" data-p-input="start" min="${today}" max="${maxStart}" value="${esc(w.start)}"></div>
      <div class="pl-end" aria-live="polite">
        <div><span class="muted">Starts</span><strong>${esc(fmtLong(w.start))}</strong></div>
        <div><span class="muted">Ends (calculated)</span><strong>${esc(fmtLong(end))}</strong></div>
        <div><span class="muted">Length</span><strong>${w.months} month${w.months === 1 ? '' : 's'} · ${daysBetween(w.start, end) + 1} days</strong></div>
      </div>
      <p class="hint">The end date is the day before the same date ${w.months} month${w.months === 1 ? '' : 's'} later.</p>`;
  }

  function stepActivities(w) {
    const areas = S.cat.areas;
    const picks = areas.map((a) => `<button type="button" class="pl-area ${w.areas[a.key] ? 'on' : ''}" data-p="area" data-key="${a.key}" aria-pressed="${!!w.areas[a.key]}">
      <span class="ico">${a.icon}</span><span>${esc(a.label)}</span></button>`).join('');
    const sections = areas.filter((a) => w.areas[a.key]).map((a) => areaSection(a, w.areas[a.key])).join('');
    return `<h3>Pick your life areas</h3>
      <p class="muted">Choose one or more, then switch on the activities you want and set how often.</p>
      <div class="pl-areas">${picks}</div>
      ${sections || '<p class="muted pl-hint">Select at least one life area above.</p>'}`;
  }

  function areaSection(a, st) {
    const rows = a.activities.map((def) => {
      const cur = st.acts[def.key];
      return `<div class="pl-act ${cur && cur.on ? 'on' : ''}">
        <label class="pl-act-head"><input type="checkbox" data-p="act" data-area="${a.key}" data-key="${def.key}" ${cur && cur.on ? 'checked' : ''}>
          <span class="q-icon">${def.icon}</span><strong>${esc(def.label)}</strong></label>
        ${cur && cur.on ? actConfig(a, def, cur) : ''}</div>`;
    }).join('');
    return `<div class="pl-area-sec"><h4>${a.icon} ${esc(a.label)}</h4>${rows}</div>`;
  }

  function actConfig(a, def, cur) {
    const lim = S.cat.limits, max = cur.frequencyType === 'weekly' ? lim.weeklyMax : lim.monthlyMax;
    const id = `${a.key}-${def.key}`;
    const params = def.params.map((pd) => `<div class="field"><label for="p-${id}-${pd.key}">${esc(pd.label)}${pd.required ? '' : ' (optional)'}${pd.unit && pd.unit !== 'amount' ? ' · ' + esc(pd.unit) : ''}</label>
        <input id="p-${id}-${pd.key}" type="number" inputmode="decimal" min="${pd.min}" max="${pd.max}" step="any" data-p-input="param" data-area="${a.key}" data-key="${def.key}" data-param="${pd.key}" value="${esc(cur.params[pd.key] === undefined ? '' : cur.params[pd.key])}" ${pd.required ? 'required' : ''}></div>`).join('');
    const other = def.custom ? `<div class="field"><label for="n-${id}">What will you do?</label><input id="n-${id}" data-p-input="name" data-area="${a.key}" data-key="${def.key}" maxlength="${S.cat.nameMax}" placeholder="Name this activity" value="${esc(cur.name)}"></div>` : '';
    return `<div class="pl-cfg">
      ${other}
      <div class="pl-cfg-row">
        <div class="seg" role="group" aria-label="Frequency">
          <button type="button" class="${cur.frequencyType === 'weekly' ? 'on' : ''}" data-p="freq" data-area="${a.key}" data-key="${def.key}" data-v="weekly">Weekly</button>
          <button type="button" class="${cur.frequencyType === 'monthly' ? 'on' : ''}" data-p="freq" data-area="${a.key}" data-key="${def.key}" data-v="monthly">Monthly</button>
        </div>
        <div class="step" role="group" aria-label="Target per ${cur.frequencyType === 'weekly' ? 'week' : 'month'}">
          <button type="button" data-p="tgt" data-d="-1" data-area="${a.key}" data-key="${def.key}" aria-label="Fewer" ${cur.target <= 1 ? 'disabled' : ''}>−</button>
          <span><strong>${cur.target}</strong>× per ${cur.frequencyType === 'weekly' ? 'week' : 'month'}</span>
          <button type="button" data-p="tgt" data-d="1" data-area="${a.key}" data-key="${def.key}" aria-label="More" ${cur.target >= max ? 'disabled' : ''}>＋</button>
        </div>
      </div>
      ${params ? `<div class="two-col pl-params">${params}</div>` : ''}</div>`;
  }

  function wizPayload(w) {
    const areas = Object.keys(w.areas).map((k) => ({
      areaKey: k,
      activities: Object.keys(w.areas[k].acts).filter((x) => w.areas[k].acts[x].on).map((x) => {
        const c = w.areas[k].acts[x];
        return { activityKey: x, name: c.name, frequencyType: c.frequencyType, target: c.target, params: c.params };
      })
    }));
    return { title: w.title.trim(), durationMonths: w.months, startDate: w.start, areas };
  }

  /** Quick checks so the user gets an answer on the same screen. The server repeats all of them. */
  function checkStep(w) {
    if (w.step === 1) {
      if (!w.title.trim()) return 'Give your goal a name.';
    } else if (w.step === 2) {
      const today = S.today || localToday();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(w.start) || isNaN(utc(w.start).getTime())) return 'Pick a starting date.';
      if (w.start < today) return 'The start date cannot be in the past.';
    } else if (w.step === 3) {
      const keys = Object.keys(w.areas);
      if (!keys.length) return 'Pick at least one life area.';
      for (const k of keys) {
        const on = Object.keys(w.areas[k].acts).filter((x) => w.areas[k].acts[x].on);
        if (!on.length) return `Switch on at least one activity in ${area(k).label}, or remove that area.`;
        for (const x of on) {
          const c = w.areas[k].acts[x], def = actDef(k, x);
          if (def.custom && !c.name.trim()) return `Name your "Other" activity in ${area(k).label}.`;
          for (const pd of def.params) {
            const v = c.params[pd.key];
            if ((v === undefined || v === '') && pd.required) return `${def.label}: enter “${pd.label}”.`;
            if (v !== undefined && v !== '' && (Number(v) < pd.min || Number(v) > pd.max)) return `${def.label}: “${pd.label}” must be between ${pd.min} and ${pd.max}.`;
          }
        }
      }
    }
    return '';
  }

  function stepSummary(w) {
    if (!w.summary) return `<p class="loading"><span class="spinner"></span> Building your plan…</p>`;
    const s = w.summary;
    const areas = s.areas.map((a) => `<div class="pl-sum-area"><h4>${area(a.areaKey).icon} ${esc(a.label)}</h4>
      <ul class="act-list">${a.activities.map((x) => {
        const pt = paramText(a.areaKey, x.activityKey, x.params);
        return `<li><span class="q-icon">${actIcon(a.areaKey, x.activityKey)}</span>
          <div class="q-main"><strong>${esc(x.name)}</strong><span class="muted">${esc(freqLabel(x.frequencyType, x.target))}${pt ? ' · ' + esc(pt) : ''}</span></div>
          <span class="pl-mini" title="Scheduled activities">${x.total} planned</span></li>`;
      }).join('')}</ul></div>`).join('');
    return `<h3>Review your goal</h3>
      <dl class="kv pl-kv">
        <dt>Goal</dt><dd>${esc(s.title)}</dd>
        <dt>Duration</dt><dd>${s.durationMonths} month${s.durationMonths === 1 ? '' : 's'}</dd>
        <dt>Start date</dt><dd>${esc(fmtYear(s.startDate))}</dd>
        <dt>End date</dt><dd>${esc(fmtYear(s.endDate))}</dd>
        <dt>Life areas</dt><dd>${s.areas.map((a) => esc(area(a.areaKey).icon + ' ' + a.label)).join(', ')}</dd>
        <dt>Scheduled</dt><dd><strong>${num(s.totalInstances)}</strong> activities will be added to your calendar</dd>
      </dl>
      ${areas}
      <p class="hint">Each activity can float to a later day, but never past its own last allowed date and never outside its week or month. Use “Edit” to change anything.</p>`;
  }

  async function wizNext(view) {
    const w = S.wiz;
    const err = checkStep(w);
    if (err) { w.error = err; return keepScroll(() => renderWizard(view)); }
    w.error = '';
    if (w.step < 3) { w.step++; renderWizard(view); window.scrollTo(0, 0); return; }
    // step 3 -> 4: ask the server to validate and build the plan preview
    w.step = 4; w.summary = null; w.busy = true; renderWizard(view); window.scrollTo(0, 0);
    try {
      w.summary = await Api.call('plan.preview', wizPayload(w));
    } catch (e) {
      w.error = e.message; w.step = 3;
    } finally { w.busy = false; }
    if (S.wiz === w) renderWizard(view);
  }

  async function wizCreate(view) {
    const w = S.wiz;
    w.busy = true; w.error = ''; keepScroll(() => renderWizard(view));
    try {
      const r = await Api.call('plan.createGoal', wizPayload(w));
      S.wiz = null;
      S.cal.goalId = r.goalId; S.cal.month = monthStart(r.startDate); S.cal.sel = r.startDate; S.cal.mode = 'month'; S.cal.data = null;
      toast(`Goal created: ${num(r.instances)} activities scheduled.`, 'success');
      if (location.hash === '#/calendar') render('calendar', view); else location.hash = '#/calendar';
    } catch (e) {
      w.busy = false; w.error = e.message;
      if (S.wiz === w) renderWizard(view);
    }
  }

  /* ================================================================ */
  /* CALENDAR                                                         */
  /* ================================================================ */
  function gridRange(month) {
    const first = monthStart(month), last = monthEnd(month);
    const start = mondayOf(first);
    const weeks = Math.ceil((daysBetween(start, last) + 1) / 7);
    return { start, end: addDays(start, weeks * 7 - 1), weeks };
  }

  async function loadCalendar() {
    const c = S.cal;
    let from, to;
    if (c.mode === 'month') { const g = gridRange(c.month); from = g.start; to = g.end; }
    else { from = c.agendaFrom; to = addDays(from, 13); }
    const d = await Api.call('plan.calendar', { from, to, goalId: c.goalId || undefined });
    S.today = d.today;
    c.data = d;
    return d;
  }

  async function renderCalendar(view, t) {
    const c = S.cal;
    if (!S.cat) { loading(view); try { await ensureCatalog(); } catch (e) { if (t === token) failure(view, e); return; } }
    if (!c.month) c.month = monthStart(S.today || localToday());
    if (c.mode === 'agenda') c.agendaFrom = S.today || localToday();
    if (!c.data) loading(view);
    try { await loadCalendar(); } catch (e) { if (t === token) failure(view, e); return; }
    if (t !== token) return;
    paintCalendar(view);
  }

  function paintCalendar(view) {
    const c = S.cal, d = c.data;
    if (c.goalId && !d.goals.some((g) => g.goalId === c.goalId)) c.goalId = '';
    if (!d.goals.length) {
      view.innerHTML = `<section class="panel empty"><h2>Calendar</h2><p>Your calendar fills up when you create a goal.</p>
        <a class="btn primary" href="#/goals" style="display:inline-block;text-decoration:none">Create New Goal</a></section>`;
      return;
    }
    if (!c.sel) c.sel = d.today >= monthStart(c.month) && d.today <= monthEnd(c.month) ? d.today : monthStart(c.month);
    const filter = d.goals.length > 1 ? `<div class="field pl-filter"><label for="cal-goal">Goal</label><select id="cal-goal" data-p-change="goal">
      <option value="">All goals</option>${d.goals.map((g) => `<option value="${esc(g.goalId)}" ${g.goalId === c.goalId ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}</select></div>` : '';
    const tabs = `<div class="seg" role="tablist" aria-label="Calendar view">
      <button type="button" role="tab" class="${c.mode === 'month' ? 'on' : ''}" aria-selected="${c.mode === 'month'}" data-p="mode" data-v="month">Month</button>
      <button type="button" role="tab" class="${c.mode === 'agenda' ? 'on' : ''}" aria-selected="${c.mode === 'agenda'}" data-p="mode" data-v="agenda">Next 14 days</button></div>`;
    view.innerHTML = `
      <section class="panel section pl-cal-top">
        <div class="pl-cal-title"><h2>${c.mode === 'month' ? esc(monthTitle(c.month)) : 'Today and upcoming'}</h2>${tabs}</div>
        <div class="pl-cal-tools">
          ${c.mode === 'month' ? `<div class="pl-nav"><button class="btn small" type="button" data-p="prev" aria-label="Previous month">‹</button>
            <button class="btn small" type="button" data-p="today">Today</button>
            <button class="btn small" type="button" data-p="next" aria-label="Next month">›</button></div>` : ''}
          ${filter}
        </div>
        <ul class="pl-legend" aria-label="Status colours">${['pending', 'scheduled', 'floating', 'locked', 'completed', 'missed'].map((s) => `<li><span class="pl-dot ${ST[s].cls}"></span>${ST[s].label}</li>`).join('')}</ul>
      </section>
      ${c.mode === 'month' ? monthView(d) : agendaView(d)}`;
  }

  function byDay(items) {
    const m = {};
    items.forEach((i) => { (m[i.assigned] = m[i.assigned] || []).push(i); });
    return m;
  }

  function monthView(d) {
    const c = S.cal, g = gridRange(c.month), map = byDay(d.items);
    const heads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => `<div class="pl-wd" role="columnheader">${n}</div>`).join('');
    let cells = '';
    for (let i = 0; i < g.weeks * 7; i++) {
      const k = addDays(g.start, i), list = map[k] || [];
      const out = k.slice(0, 7) !== c.month.slice(0, 7);
      const chips = list.slice(0, 3).map((it) => chip(it)).join('') + (list.length > 3 ? `<span class="pl-more">+${list.length - 3} more</span>` : '');
      const dots = list.slice(0, 4).map((it) => `<span class="pl-dot ${stOf(it.status).cls}"></span>`).join('');
      cells += `<div class="pl-day ${out ? 'out' : ''} ${k === d.today ? 'today' : ''} ${k === c.sel ? 'sel' : ''}" role="gridcell" data-date="${k}" data-p="day">
        <button type="button" class="pl-num" data-p="day" data-date="${k}" aria-label="${esc(fmtLong(k))}, ${list.length} activit${list.length === 1 ? 'y' : 'ies'}">${+k.slice(8)}</button>
        <div class="pl-chips">${chips}</div>
        <div class="pl-dots" aria-hidden="true">${dots}${list.length > 4 ? '<small>+</small>' : ''}</div></div>`;
    }
    const selItems = map[c.sel] || [];
    return `<section class="pl-cal"><div class="pl-grid" role="grid" aria-label="${esc(monthTitle(c.month))}">${heads}${cells}</div></section>
      <section class="panel section pl-daypanel"><h3>${esc(fmtLong(c.sel))}${c.sel === d.today ? ' <span class="badge">Today</span>' : ''}</h3>
        ${selItems.length ? `<ul class="pl-cards">${selItems.map(card).join('')}</ul>` : '<p class="muted">Nothing scheduled on this day.</p>'}</section>`;
  }

  function agendaView(d) {
    const map = byDay(d.items), days = Object.keys(map).sort();
    if (!days.length) return `<section class="panel empty"><p>Nothing scheduled in the next 14 days.</p></section>`;
    return days.map((k) => `<section class="panel section pl-daypanel"><h3>${esc(fmtLong(k))}${k === d.today ? ' <span class="badge">Today</span>' : ''}</h3>
      <ul class="pl-cards">${map[k].map(card).join('')}</ul></section>`).join('');
  }

  function chip(it) {
    return `<button type="button" class="pl-chip ${stOf(it.status).cls}" data-p="card" data-id="${esc(it.id)}" ${it.canMove ? 'draggable="true"' : ''} title="${esc(it.name + ' · ' + stOf(it.status).label)}">
      <span aria-hidden="true">${actIcon(it.areaKey, it.activityKey)}</span><span class="t">${esc(it.name)}</span></button>`;
  }

  function card(it) {
    const s = stOf(it.status);
    const pt = paramText(it.areaKey, it.activityKey, it.params);
    let note = '';
    if (it.status === 'completed') note = it.hold ? `Completed ${fmt(it.completedDate)} · ⏸ on hold, no points yet` : `Completed ${fmt(it.completedDate)} · ${ptsText(it.earned)} pts`;
    else if (it.status === 'missed') note = `Missed — its window ended ${fmt(it.latest)}`;
    else if (it.status === 'locked') note = 'Last allowed day — do it today';
    else note = `Can float until ${fmt(it.latest)}`;
    return `<li><button type="button" class="pl-card ${s.cls}" data-p="card" data-id="${esc(it.id)}" ${it.canMove ? 'draggable="true"' : ''}>
      <span class="q-icon">${actIcon(it.areaKey, it.activityKey)}</span>
      <span class="q-main"><strong>${esc(it.name.toUpperCase())}</strong>
        <span class="muted">${esc(freqLabel(it.frequency, it.target))}${pt ? ' · ' + esc(pt) : ''}</span>
        <span class="muted pl-note">${esc(note)}${it.status !== 'completed' && it.status !== 'missed' && it.points ? ' · ' + esc(ptsText(it.points.total)) + ' pts' : ''}</span></span>
      <span class="pl-status ${it.hold ? 'hld' : s.cls}"><span aria-hidden="true">${it.hold ? '⏸' : s.ico}</span> ${it.hold ? 'On hold' : s.label}</span></button></li>`;
  }

  const ptsText = (n) => { const v = Math.round(Number(n || 0) * 100) / 100; return (v > 0 ? '+' : '') + v; };
  const findItem = (id) => (S.cal.data ? S.cal.data.items.find((i) => i.id === id) : null);

  /* ---------- the action sheet: Complete / Move to next day / View details ---------- */
  function openSheet(id) {
    const it = findItem(id);
    if (!it) return;
    const s = stOf(it.status), today = S.cal.data.today;
    const nextOpt = it.moveOptions.filter((d) => d > it.assigned)[0];
    const pt = paramText(it.areaKey, it.activityKey, it.params);
    let why = '';
    if (it.status === 'completed') why = `Completed on ${fmtYear(it.completedDate)}.`;
    else if (it.status === 'missed') why = `This one was missed. Its last allowed day was ${fmtYear(it.latest)}.`;
    else if (it.status === 'locked') why = 'This is its last allowed day. Complete it today or it will be marked missed.';
    else if (!it.canComplete) why = `This ${it.frequency === 'weekly' ? 'week' : 'month'} starts on ${fmtYear(it.periodStart)}, so it cannot be completed yet.`;
    const m = openModal(`
      <div class="pl-sheet-head"><span class="q-icon big">${actIcon(it.areaKey, it.activityKey)}</span>
        <div><h3 class="modal-title" style="margin:0">${esc(it.name)}</h3><span class="pl-status ${s.cls}"><span aria-hidden="true">${s.ico}</span> ${s.label}</span></div></div>
      <dl class="kv pl-kv">
        <dt>Goal</dt><dd>${esc(it.goalTitle)}</dd>
        <dt>Life area</dt><dd>${esc(area(it.areaKey).icon + ' ' + area(it.areaKey).label)}</dd>
        <dt>Frequency</dt><dd>${esc(freqLabel(it.frequency, it.target))}</dd>
        <dt>Period</dt><dd>${esc(fmt(it.periodStart))} – ${esc(fmt(it.periodEnd))}</dd>
        <dt>Scheduled</dt><dd>${esc(fmt(it.original))}${it.assigned !== it.original ? ` → now ${esc(fmt(it.assigned))}` : ''}</dd>
        <dt>Latest date</dt><dd>${esc(fmt(it.latest))}</dd>
        ${it.status === 'completed' ? `<dt>Completed</dt><dd>${esc(fmt(it.completedDate))}</dd><dt>Points</dt><dd>${it.hold ? '⏸ On hold until an admin decides' : esc(ptsText(it.earned))}</dd>` : ''}
        ${it.status !== 'completed' && it.status !== 'missed' && it.points ? `<dt>Worth</dt><dd>${esc(ptsText(it.points.total))} pts${it.points.bonus ? ' (incl. floating bonus)' : ''} · missing it costs −5</dd>` : ''}
        ${pt ? `<dt>Details</dt><dd>${esc(pt)}</dd>` : ''}
        ${it.notes ? `<dt>Notes</dt><dd>${esc(it.notes)}</dd>` : ''}
      </dl>
      ${why ? `<p class="hint pl-why">${esc(why)}</p>` : ''}
      <p class="form-error" id="sheet-error" role="alert"></p>
      <div class="pl-sheet-actions">
        ${it.canComplete ? `<button class="btn primary" type="button" data-m="complete">📸 Complete</button>` : ''}
        ${it.canMove ? `<button class="btn" type="button" data-m="next" ${nextOpt ? '' : 'disabled'}>Move to next available day${nextOpt ? ' (' + esc(fmt(nextOpt)) + ')' : ''}</button>` : ''}
      </div>
      ${it.canMove ? `<div class="pl-moveto"><div class="field"><label for="mv-date">Move to another day</label><select id="mv-date">
        ${it.moveOptions.map((dte) => `<option value="${dte}">${esc(fmt(dte))}${dte === today ? ' (today)' : ''}</option>`).join('')}</select></div>
        <button class="btn" type="button" data-m="moveto">Move</button></div>
        <p class="hint">You can move it between ${esc(fmt(it.moveOptions[0]))} and ${esc(fmt(it.latest))}, on days this activity is not already planned.</p>` : ''}
      <div class="modal-actions"><button class="btn" type="button" data-m="close">Close</button></div>`);
    m.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const a = b.dataset.m, err = m.el.querySelector('#sheet-error');
      if (a === 'close') return m.close();
      if (err) err.textContent = '';
      if (a === 'complete') { m.close(); return completeFlow(it); }
      if (a === 'next') return doMove(m, b, 'plan.moveNext', { instanceId: it.id }, err);
      if (a === 'moveto') return doMove(m, b, 'plan.move', { instanceId: it.id, date: m.el.querySelector('#mv-date').value }, err);
    });
  }

  async function doMove(m, btn, action, payload, err) {
    btn.disabled = true;
    try {
      const r = await Api.call(action, payload);
      m.close();
      toast(`Moved to ${fmt(r.item.assigned)}.`, 'success');
      await refreshCalendar();
    } catch (e) {
      if (err) err.textContent = e.message;
      btn.disabled = false;
    }
  }

  async function refreshCalendar() {
    const view = $('#view'), t = ++token;
    try { await loadCalendar(); } catch (e) { if (t === token) failure(view, e); return; }
    if (t === token) keepScroll(() => paintCalendar(view));
  }

  /* ---------- drag and drop (pointer devices); touch users use the sheet ---------- */
  function onDragStart(e) {
    const el = e.target.closest && e.target.closest('[data-p=card][draggable=true]');
    if (!el) return;
    const it = findItem(el.dataset.id);
    if (!it) return;
    S.cal.drag = it;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', it.id); } catch (err) { /* old browsers */ }
    document.querySelectorAll('.pl-day').forEach((c) => {
      const ok = it.moveOptions.indexOf(c.dataset.date) !== -1;
      c.classList.add(ok ? 'drop-ok' : 'drop-no');
    });
  }
  function onDragOver(e) {
    const cell = e.target.closest && e.target.closest('.pl-day');
    if (cell && S.cal.drag && cell.classList.contains('drop-ok')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cell.classList.add('drop-hot'); }
  }
  function onDragLeave(e) { const cell = e.target.closest && e.target.closest('.pl-day'); if (cell) cell.classList.remove('drop-hot'); }
  function endDrag() {
    S.cal.drag = null;
    document.querySelectorAll('.pl-day').forEach((c) => c.classList.remove('drop-ok', 'drop-no', 'drop-hot'));
  }
  async function onDrop(e) {
    const cell = e.target.closest && e.target.closest('.pl-day');
    const it = S.cal.drag;
    if (!cell || !it) return;
    e.preventDefault();
    const date = cell.dataset.date;
    endDrag();
    if (it.moveOptions.indexOf(date) === -1) {
      const why = it.status === 'locked' ? 'It is on its last allowed day.' : `It can only go between ${fmt(it.moveOptions[0] || it.assigned)} and ${fmt(it.latest)}.`;
      return toast('Cannot move it there. ' + why, 'error');
    }
    try {
      await Api.call('plan.move', { instanceId: it.id, date });
      toast(`Moved to ${fmt(date)}.`, 'success');
      S.cal.sel = date;
      await refreshCalendar();
    } catch (ex) { toast(ex.message, 'error'); }
  }

  /* ---------- completing: live photo (Phase 3 flow) + link to the calendar card ---------- */
  // The photo-proof flow and the celebration live in game.js so Today and the calendar behave the same.
  async function completeFlow(it) {
    if (!window.GT.ui) return toast('Please reload the page.', 'error');
    await window.GT.ui.completeTask(it, refreshCalendar);
  }

  /* ================================================================ */
  /* Events (wired once on #view)                                     */
  /* ================================================================ */
  function wire(view) {
    if (wired) return;
    wired = true;
    view.addEventListener('click', onClick);
    view.addEventListener('input', onInput);
    view.addEventListener('change', onChange);
    view.addEventListener('dragstart', onDragStart);
    view.addEventListener('dragover', onDragOver);
    view.addEventListener('dragleave', onDragLeave);
    view.addEventListener('dragend', endDrag);
    view.addEventListener('drop', onDrop);
  }

  function onInput(e) {
    const el = e.target, kind = el.dataset && el.dataset.pInput, w = S.wiz;
    if (!kind || !w) return;
    if (kind === 'title') w.title = el.value;
    else if (kind === 'start') { w.start = el.value; const end = $('.pl-end'); if (end && /^\d{4}-\d{2}-\d{2}$/.test(w.start) && !isNaN(utc(w.start).getTime())) { w.error = ''; keepScroll(() => renderWizard($('#view'))); const again = $('#w-start'); if (again) again.focus(); } }
    else if (kind === 'param') { const st = w.areas[el.dataset.area].acts[el.dataset.key]; if (el.value === '') delete st.params[el.dataset.param]; else st.params[el.dataset.param] = el.value; }
    else if (kind === 'name') w.areas[el.dataset.area].acts[el.dataset.key].name = el.value;
  }

  function onChange(e) {
    const el = e.target;
    if (el.dataset.pChange === 'goal') {
      S.cal.goalId = el.value; S.cal.data = null;
      return renderCalendar($('#view'), ++token);
    }
    if (el.dataset.p === 'act' && S.wiz) {
      const w = S.wiz, a = w.areas[el.dataset.area], def = actDef(el.dataset.area, el.dataset.key);
      if (el.checked) a.acts[def.key] = Object.assign(a.acts[def.key] || newActState(def), { on: true });
      else if (a.acts[def.key]) a.acts[def.key].on = false;
      w.error = '';
      keepScroll(() => renderWizard($('#view')));
    }
  }

  async function onClick(e) {
    const b = e.target.closest('[data-p]');
    if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    const a = b.dataset.p, view = $('#view'), w = S.wiz, c = S.cal;
    try {
      // ----- goals / wizard
      if (a === 'reload') return render(location.hash.replace(/^#\//, ''), view);
      if (a === 'wiz-start') { await ensureCatalog(); return startWizard(view); }
      if (a === 'wiz-cancel') {
        if (!(await confirmBox('Discard this goal?', 'Nothing has been created yet. Your choices will be lost.', 'Discard'))) return;
        S.wiz = null; return render('goals', view);
      }
      if (a === 'wiz-back') { w.error = ''; w.step = Math.max(1, w.step - 1); renderWizard(view); return window.scrollTo(0, 0); }
      if (a === 'wiz-next') return wizNext(view);
      if (a === 'wiz-create') return wizCreate(view);
      if (a === 'months') { w.months = +b.dataset.n; return keepScroll(() => renderWizard(view)); }
      if (a === 'area') {
        const k = b.dataset.key;
        if (w.areas[k]) delete w.areas[k];
        else {
          // start with nothing switched on: the user picks what applies to them
          w.areas[k] = { acts: {} };
        }
        w.error = '';
        return keepScroll(() => renderWizard(view));
      }
      if (a === 'freq') {
        const st = w.areas[b.dataset.area].acts[b.dataset.key], lim = S.cat.limits;
        st.frequencyType = b.dataset.v;
        st.target = Math.min(st.target, st.frequencyType === 'weekly' ? lim.weeklyMax : lim.monthlyMax);
        return keepScroll(() => renderWizard(view));
      }
      if (a === 'tgt') {
        const st = w.areas[b.dataset.area].acts[b.dataset.key], lim = S.cat.limits;
        st.target = Math.max(1, Math.min(st.frequencyType === 'weekly' ? lim.weeklyMax : lim.monthlyMax, st.target + +b.dataset.d));
        return keepScroll(() => renderWizard(view));
      }
      if (a === 'archive-goal') {
        if (!(await confirmBox('Archive this goal?', `“${b.dataset.title}” and its calendar will be hidden. You can't undo this from the app.`, 'Archive'))) return;
        await Api.call('goals.archive', { goalId: b.dataset.goal });
        toast('Goal archived.', 'success'); c.data = null; c.goalId = '';
        return render('goals', view);
      }
      if (a === 'open-cal') {
        c.goalId = b.dataset.goal; c.month = monthStart(b.dataset.date); c.sel = b.dataset.date; c.mode = 'month'; c.data = null;
        location.hash = '#/calendar'; return;
      }
      // ----- calendar
      if (a === 'prev' || a === 'next' || a === 'today') {
        c.month = a === 'today' ? monthStart(S.today || localToday()) : monthStart(addMonths(c.month, a === 'next' ? 1 : -1));
        c.sel = a === 'today' ? (S.today || localToday()) : null; c.data = null;
        return renderCalendar(view, ++token);
      }
      if (a === 'mode') { c.mode = b.dataset.v; c.data = null; return renderCalendar(view, ++token); }
      if (a === 'day') {
        const date = b.dataset.date;
        if (date.slice(0, 7) !== c.month.slice(0, 7)) { c.month = monthStart(date); c.sel = date; c.data = null; return renderCalendar(view, ++token); }
        c.sel = date; return keepScroll(() => paintCalendar(view));
      }
      if (a === 'card') { e.stopPropagation(); return openSheet(b.dataset.id); }
    } catch (ex) {
      if (w) { w.error = ex.message; keepScroll(() => renderWizard(view)); } else toast(ex.message, 'error');
    }
  }

  /** Builds the wizard from a partner's goal sheet (acct.template). Money amounts are never copied. */
  async function startFromTemplate(tpl) {
    await ensureCatalog();
    S.today = S.today || localToday();
    const w = { step: 1, title: tpl.title ? 'Copy of ' + tpl.title : '', months: Math.max(1, Math.min(tpl.durationMonths || 1, (S.cat.limits.months || 12))),
      start: S.today, areas: {}, error: '', summary: null, busy: false,
      copiedFrom: tpl.from ? tpl.from.name : 'a partner', moneyHidden: !!tpl.moneyHidden };
    tpl.areas.forEach((a) => {
      if (!S.cat.areas.some((x) => x.key === a.areaKey)) return;
      const st = { acts: {} };
      a.activities.forEach((x) => {
        const def = actDef(a.areaKey, x.activityKey);
        if (!def) return;
        const lim = S.cat.limits, max = x.frequencyType === 'weekly' ? lim.weeklyMax : lim.monthlyMax;
        st.acts[x.activityKey] = { on: true, frequencyType: x.frequencyType, target: Math.max(1, Math.min(max, x.target)), params: Object.assign({}, x.params), name: x.name || '' };
      });
      if (Object.keys(st.acts).length) w.areas[a.areaKey] = st;
    });
    if (!Object.keys(w.areas).length) throw new Error('Nothing in this goal could be copied.');
    S.wiz = w;
    if (location.hash === '#/goals') render('goals', $('#view')); else location.hash = '#/goals';
    window.scrollTo(0, 0);
  }

  window.Plan = { render: render, startFromTemplate: startFromTemplate };
})();
