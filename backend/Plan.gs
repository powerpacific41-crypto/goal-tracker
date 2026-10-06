/**
 * GOAL TRACKER - Phases 4 and 5: goal creation workflow, activity generation, floating calendar engine.
 *
 * Routes (plan.*) for creating goals and working the calendar. Game.gs owns points and completing a task:
 *   - ACTIVITY_INSTANCES holds the generated, movable calendar cards ("tasks");
 *   - completing a task goes through completions.begin / completions.submit (live photo + points), which also
 *     links the card to its completion, so there is no separate "plan.complete" step any more;
 *   - Phase 6: a goal can also be created from a partner's goal sheet (the app sends the copied sheet to plan.createGoal).
 *
 * The engine is generic. It never mentions a specific activity: everything comes from CATALOG below
 * (areas, activities, allowed frequencies, extra parameters). Add a row to CATALOG to add a life area or
 * an activity; no schema change is needed because per-activity options live in the JSON `params` column.
 *
 * FLOATING RULE (per period, k instances, n days in the period, instance i = 0..k-1):
 *   assigned_i = periodStart + floor(i * n / k)          evenly spread
 *   latest_i   = periodEnd - (k - 1 - i)                 the last day it may float to
 * latest_i leaves a free day for every later instance of the same activity, so floating can never make
 * the rest of the period impossible. Example, 5x/week (Mon..Sun): latest = Wed, Thu, Fri, Sat, Sun.
 * An open instance rolls forward day by day (Mon -> Tue -> Wed). On its latest date it is "locked"
 * (last chance, cannot move). The day after, if still open, it is "missed". It never leaves its period.
 *
 * Periods: weekly = calendar week (Monday to Sunday), monthly = calendar month, both clipped to the goal's
 * dates. A clipped period gets a share of the target (rounded), so a goal that starts on a Friday is not
 * asked for a full week of runs.
 */

var PLAN = {
  MAX_INSTANCES_PER_GOAL: 4000,
  MAX_MONTHS: 12,
  MAX_START_AHEAD_DAYS: 366,
  WEEKLY_MAX: 7,
  MONTHLY_MAX: 31,
  MAX_RANGE_DAYS: 70,
  DATE_COLS: ['periodStart', 'periodEnd', 'assignedDate', 'latestDate', 'originalDate', 'completedDate'],
  NEEDS_COLS: ['activityDefId', 'originalDate', 'movedCount', 'completionId']
};

/**
 * The catalog: life areas and their activities. DATA, not logic.
 * params: extra numeric fields. required:true means the wizard must collect it.
 * custom:true means the user types the activity name ("Other").
 */
var CATALOG = [
  { key: 'health', label: 'Health', icon: '🥗', activities: [
    { key: 'run', label: 'Run', icon: '🏃', freq: 'weekly', target: 3, params: [{ key: 'distanceKm', label: 'Distance per run', unit: 'km', min: 0.1, max: 200 }] },
    { key: 'workout', label: 'Workout', icon: '🏋️', freq: 'weekly', target: 3, params: [{ key: 'minutesPerSession', label: 'Minutes per workout', unit: 'min', min: 1, max: 600 }] },
    { key: 'step_count', label: 'Step Count', icon: '👟', freq: 'weekly', target: 7, params: [{ key: 'stepsPerDay', label: 'Steps per day', unit: 'steps', min: 1000, max: 100000 }] },
    { key: 'others', label: 'Other', icon: '✨', custom: true, freq: 'weekly', target: 1, params: [] }
  ] },
  { key: 'social', label: 'Social', icon: '🎉', activities: [
    { key: 'post_social', label: 'Post on Social Media', icon: '📱', freq: 'weekly', target: 2, params: [] },
    { key: 'go_out_friend', label: 'Go Out With a Friend', icon: '🤝', freq: 'weekly', target: 1, params: [] },
    { key: 'attend_event', label: 'Attend an Event', icon: '🎟️', freq: 'monthly', target: 2, params: [] },
    { key: 'others', label: 'Other', icon: '✨', custom: true, freq: 'weekly', target: 1, params: [] }
  ] },
  { key: 'family', label: 'Family', icon: '👨‍👩‍👧', activities: [
    { key: 'call_parents', label: 'Call Parents', icon: '📞', freq: 'weekly', target: 2, params: [] },
    { key: 'call_relative', label: 'Call a Relative', icon: '☎️', freq: 'weekly', target: 1, params: [] },
    { key: 'go_out_family', label: 'Go Out With Family', icon: '🚗', freq: 'weekly', target: 1, params: [] },
    { key: 'others', label: 'Other', icon: '✨', custom: true, freq: 'weekly', target: 1, params: [] }
  ] },
  { key: 'career', label: 'Career', icon: '💼', activities: [
    { key: 'acquire_certificate', label: 'Acquire a Certificate', icon: '📜', freq: 'monthly', target: 1, params: [] },
    { key: 'take_class', label: 'Take a Class', icon: '🎓', freq: 'weekly', target: 1, params: [] },
    { key: 'short_course', label: 'Short Development Course', icon: '🧠', freq: 'monthly', target: 1, params: [] },
    { key: 'others', label: 'Other', icon: '✨', custom: true, freq: 'weekly', target: 1, params: [] }
  ] },
  { key: 'spiritual', label: 'Spiritual', icon: '🕊️', activities: [
    { key: 'meditate', label: 'Meditate', icon: '🧘', freq: 'weekly', target: 5, params: [{ key: 'minutesPerSession', label: 'Minutes per session', unit: 'min', min: 1, max: 600, required: true }] },
    { key: 'pray', label: 'Pray', icon: '🙏', freq: 'weekly', target: 7, params: [] },
    { key: 'give_charity', label: 'Give Charity', icon: '💝', freq: 'monthly', target: 1, params: [{ key: 'monthlyBudget', label: 'Monthly charity budget', unit: 'amount', min: 0.01, max: 100000000, required: true }] },
    { key: 'others', label: 'Other', icon: '✨', custom: true, freq: 'weekly', target: 1, params: [] }
  ] },
  { key: 'finance', label: 'Finance & Wealth', icon: '💰', activities: [
    { key: 'save_money', label: 'Save Money', icon: '🐷', freq: 'monthly', target: 1, params: [{ key: 'monthlyAmount', label: 'Amount to save each month', unit: 'amount', min: 0.01, max: 100000000, required: true }] },
    { key: 'invest', label: 'Invest', icon: '📈', freq: 'monthly', target: 1, params: [{ key: 'monthlyAmount', label: 'Amount to invest each month', unit: 'amount', min: 0.01, max: 100000000, required: true }] },
    { key: 'others', label: 'Other', icon: '✨', custom: true, freq: 'weekly', target: 1, params: [] }
  ] }
];

function getPlanRoutes_() {
  return {
    'plan.catalog': routePlanCatalog_,
    'plan.preview': routePlanPreview_,
    'plan.createGoal': routePlanCreateGoal_,
    'plan.goals': routePlanGoals_,
    'plan.calendar': routePlanCalendar_,
    'plan.move': routePlanMove_,
    'plan.moveNext': routePlanMoveNext_
  };
}

/* ------------------------------------------------------------------ */
/* Date helpers (all dates are 'yyyy-MM-dd' text)                      */
/* ------------------------------------------------------------------ */

function planPad_(n) { return (n < 10 ? '0' : '') + n; }

function planValidDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  var p = s.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return d.getUTCFullYear() === +p[0] && d.getUTCMonth() === +p[1] - 1 && d.getUTCDate() === +p[2];
}

/** Same day-of-month n months later; clamps to the last day (31 Jan + 1 month = 28/29 Feb). */
function planAddMonths_(key, n) {
  var p = key.split('-'), y = +p[0], m = +p[1] - 1 + n, d = +p[2];
  var yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  var last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return yy + '-' + planPad_(mm + 1) + '-' + planPad_(Math.min(d, last));
}

/** Goal end date: the day before the same date N months later (start 5 Oct, 3 months -> 4 Jan). */
function planEndDate_(start, months) { return addDays_(planAddMonths_(start, months), -1); }

function planMonthEnd_(key) {
  var p = key.split('-');
  return new Date(Date.UTC(+p[0], +p[1], 0)).toISOString().slice(0, 10);
}

function planDaysBetween_(a, b) {
  var p = a.split('-'), q = b.split('-');
  return Math.round((Date.UTC(+q[0], +q[1] - 1, +q[2]) - Date.UTC(+p[0], +p[1] - 1, +p[2])) / 86400000);
}

/* ------------------------------------------------------------------ */
/* Catalog and validation                                              */
/* ------------------------------------------------------------------ */

function planArea_(key) {
  for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].key === key) return CATALOG[i];
  return null;
}

function planActDef_(area, key) {
  for (var i = 0; i < area.activities.length; i++) if (area.activities[i].key === key) return area.activities[i];
  return null;
}

function planAreaLabel_(key) {
  var a = planArea_(key);
  return a ? a.label : key;
}

function planNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isFinite(n) ? n : NaN;
}

/** Validates one activity row from the wizard against the catalog. Returns a clean object or throws. */
function planCleanActivity_(area, raw) {
  var def = planActDef_(area, String(raw && raw.activityKey || ''));
  if (!def) throw new ApiError('BAD_REQUEST', 'Unknown activity in ' + area.label + '.');
  var name = def.label;
  if (def.custom) {
    var max = parseInt(getSetting_('others_name_max_length', '60'), 10) || 60;
    name = String(raw.name || '').trim();
    if (!name) throw new ApiError('BAD_REQUEST', 'Enter a name for the "Other" activity in ' + area.label + '.');
    if (name.length > max) throw new ApiError('BAD_REQUEST', 'Activity names can be up to ' + max + ' characters.');
  }
  var freq = raw.frequencyType === 'monthly' ? 'monthly' : (raw.frequencyType === 'weekly' ? 'weekly' : '');
  if (!freq) throw new ApiError('BAD_REQUEST', 'Choose weekly or monthly for ' + name + '.');
  var target = parseInt(raw.target, 10);
  var cap = freq === 'weekly' ? PLAN.WEEKLY_MAX : PLAN.MONTHLY_MAX;
  if (!(target >= 1 && target <= cap)) throw new ApiError('BAD_REQUEST', name + ': the target must be 1 to ' + cap + ' per ' + (freq === 'weekly' ? 'week' : 'month') + '.');
  var params = {}, given = raw.params || {};
  def.params.forEach(function (pd) {
    var v = planNum_(given[pd.key]);
    if (v === null) {
      if (pd.required) throw new ApiError('BAD_REQUEST', name + ': ' + pd.label + ' is required.');
      return;
    }
    if (isNaN(v) || v < pd.min || v > pd.max) throw new ApiError('BAD_REQUEST', name + ': ' + pd.label + ' must be between ' + pd.min + ' and ' + pd.max + '.');
    params[pd.key] = Math.round(v * 100) / 100;
  });
  return { activityKey: def.key, activityName: name, frequencyType: freq, target: target, params: params };
}

/** Validates the whole wizard payload. Returns clean data; throws ApiError with a friendly message. */
function planCleanGoal_(p, me) {
  var title = String(p.title || '').trim().slice(0, 80);
  if (!title) throw new ApiError('BAD_REQUEST', 'Give your goal a title.');
  var months = parseInt(p.durationMonths, 10);
  if (!(months >= 1 && months <= PLAN.MAX_MONTHS)) throw new ApiError('BAD_REQUEST', 'Duration must be 1 to ' + PLAN.MAX_MONTHS + ' months.');
  var start = String(p.startDate || '');
  if (!planValidDate_(start)) throw new ApiError('BAD_REQUEST', 'Pick a valid start date.');
  var today = dateKey_();
  if (start < today) throw new ApiError('BAD_REQUEST', 'The start date cannot be in the past.');
  if (planDaysBetween_(today, start) > PLAN.MAX_START_AHEAD_DAYS) throw new ApiError('BAD_REQUEST', 'The start date is too far ahead (max one year).');
  var end = planEndDate_(start, months);

  var areasIn = Array.isArray(p.areas) ? p.areas : [];
  if (!areasIn.length) throw new ApiError('BAD_REQUEST', 'Pick at least one life area.');
  var seenAreas = {}, activities = [];
  areasIn.forEach(function (a) {
    var area = planArea_(String(a && a.areaKey || ''));
    if (!area) throw new ApiError('BAD_REQUEST', 'Unknown life area.');
    if (seenAreas[area.key]) throw new ApiError('BAD_REQUEST', area.label + ' is listed twice.');
    seenAreas[area.key] = true;
    var list = Array.isArray(a.activities) ? a.activities : [];
    if (!list.length) throw new ApiError('BAD_REQUEST', 'Add at least one activity to ' + area.label + ' or remove the area.');
    var seen = {};
    list.forEach(function (raw) {
      var c = planCleanActivity_(area, raw);
      var dupKey = c.activityKey === 'others' ? 'others:' + c.activityName.toLowerCase() : c.activityKey;
      if (seen[dupKey]) throw new ApiError('BAD_REQUEST', c.activityName + ' is added twice in ' + area.label + '.');
      seen[dupKey] = true;
      c.areaKey = area.key;
      activities.push(c);
    });
  });

  var total = 0;
  activities.forEach(function (c) {
    c.instances = planGenerate_(c, start, end);
    c.total = c.instances.length;
    total += c.total;
  });
  if (total > PLAN.MAX_INSTANCES_PER_GOAL) throw new ApiError('LIMIT', 'This plan would create ' + total + ' scheduled activities (max ' + PLAN.MAX_INSTANCES_PER_GOAL + '). Use fewer activities, lower targets or a shorter duration.');
  return { title: title, months: months, start: start, end: end, areas: Object.keys(seenAreas), activities: activities, total: total };
}

/** Caps from Game.gs (goals and activities per user). */
function planCheckLimits_(me, newActivities) {
  var goals = readAll_('GOALS').filter(function (g) { return g.userId === me && g.status === 'active'; }).length;
  if (goals >= GAME.MAX_ACTIVE_GOALS) throw new ApiError('LIMIT', 'You can have up to ' + GAME.MAX_ACTIVE_GOALS + ' active goals.');
  var acts = readAll_('ACTIVITIES').filter(function (a) { return a.userId === me && !isArchived_(a); }).length;
  if (acts + newActivities > GAME.MAX_ACTIVITIES) throw new ApiError('LIMIT', 'You can have up to ' + GAME.MAX_ACTIVITIES + ' activities in total (you have ' + acts + ').');
}

/* ------------------------------------------------------------------ */
/* The engine (pure functions: no sheet access, easy to test)          */
/* ------------------------------------------------------------------ */

/** Calendar weeks (Mon-Sun) or months that touch [start, end], each clipped to the goal. */
function planPeriods_(freq, start, end) {
  var out = [], cur = start;
  while (cur <= end) {
    var ps, pe;
    if (freq === 'weekly') { ps = weekKey_(cur); pe = addDays_(ps, 6); }
    else { ps = cur.slice(0, 8) + '01'; pe = planMonthEnd_(cur); }
    var fullDays = planDaysBetween_(ps, pe) + 1;
    out.push({ ps: ps < start ? start : ps, pe: pe > end ? end : pe, fullDays: fullDays });
    cur = addDays_(pe, 1);
  }
  return out;
}

/**
 * Builds every instance for one activity. def: {frequencyType, target, areaKey, activityName, ...ids}.
 * Returns plain objects ready to become ACTIVITY_INSTANCES rows (ids are added by the caller).
 */
function planGenerate_(def, start, end) {
  var periods = planPeriods_(def.frequencyType, start, end), plan = [], total = 0;
  periods.forEach(function (p) {
    var days = planDaysBetween_(p.ps, p.pe) + 1;
    var k = days >= p.fullDays ? Math.min(def.target, days) : Math.min(days, Math.round(def.target * days / p.fullDays));
    plan.push({ p: p, days: days, k: k });
    total += k;
  });
  if (total === 0 && plan.length) {            // a very short goal must still ask for at least one
    var best = plan[0];
    plan.forEach(function (x) { if (x.days / x.p.fullDays > best.days / best.p.fullDays) best = x; });
    best.k = 1;
  }
  var out = [];
  plan.forEach(function (x) {
    for (var i = 0; i < x.k; i++) {
      var assigned = addDays_(x.p.ps, Math.floor(i * x.days / x.k));
      out.push({
        activityName: def.activityName, category: def.areaKey, frequency: def.frequencyType, target: def.target,
        periodStart: x.p.ps, periodEnd: x.p.pe, assignedDate: assigned, latestDate: addDays_(x.p.pe, -(x.k - 1 - i)),
        originalDate: assigned, movedCount: 0, completedDate: '', completionNotes: '', completionId: ''
      });
    }
  });
  return out;
}

function planIsOpen_(r) { return r.status !== 'completed' && r.status !== 'missed'; }

/** The status an instance should have on a given day. completed/missed are decided elsewhere and kept. */
function planStatusOf_(r, today) {
  if (r.completedDate || r.status === 'completed') return 'completed';
  if (today > r.latestDate) return 'missed';
  if (today === r.latestDate) return 'locked';
  if (r.assignedDate !== r.originalDate) return 'floating';
  return r.assignedDate <= today ? 'pending' : 'scheduled';
}

function planGroupKey_(r) { return r.activityDefId + '|' + r.periodStart; }

/**
 * Brings one user's instances up to date for `today`. Mutates the rows, returns the ones that changed.
 *   1. a completion that a partner rejected re-opens its instance;
 *   2. completions made outside the calendar (Quests screen) are linked to the instance that is due soonest;
 *   3. open instances whose assigned day has passed roll forward to the next free day (never past latestDate);
 *   4. instances past their latest date become missed; the rest get their status.
 * rows: this user's instances. comps: [{id, activityId, day, notes, valid}] this user's completions.
 */
function planApplySync_(rows, comps, today) {
  var dirty = [];
  function touch(r) { if (dirty.indexOf(r) === -1) dirty.push(r); }
  var byComp = {};
  comps.forEach(function (c) { byComp[c.id] = c; });

  // 1. reopen instances whose completion is no longer valid
  rows.forEach(function (r) {
    if (r.status === 'completed' && r.completionId && byComp[r.completionId] && !byComp[r.completionId].valid) {
      r.completionId = ''; r.completedDate = ''; r.status = 'scheduled'; touch(r);
    }
  });

  // 2. link unlinked valid completions
  var linked = {};
  rows.forEach(function (r) { if (r.completionId) linked[r.completionId] = true; });
  comps.filter(function (c) { return c.valid && !linked[c.id]; })
    .sort(function (a, b) { return a.day < b.day ? -1 : (a.day > b.day ? 1 : 0); })
    .forEach(function (c) {
      var cands = rows.filter(function (r) {
        return r.activityDefId === c.activityId && r.status !== 'completed' && r.periodStart <= c.day && c.day <= r.latestDate;
      }).sort(function (a, b) { return a.latestDate < b.latestDate ? -1 : (a.latestDate > b.latestDate ? 1 : (a.assignedDate < b.assignedDate ? -1 : 1)); });
      if (!cands.length) return;
      var r = cands[0];
      r.status = 'completed'; r.completedDate = c.day; r.completionId = c.id; r.completionNotes = c.notes || r.completionNotes; touch(r);
      linked[c.id] = true;
    });

  // 3 + 4. roll forward, then statuses
  var groups = {};
  rows.forEach(function (r) {
    if (r.status === 'completed') return;
    if (today > r.latestDate) {
      if (r.status !== 'missed') { r.status = 'missed'; touch(r); }
      return;
    }
    (groups[planGroupKey_(r)] = groups[planGroupKey_(r)] || []).push(r);
  });
  function byUrgency(a, b) {
    if (a.latestDate !== b.latestDate) return a.latestDate < b.latestDate ? -1 : 1;
    return a.originalDate < b.originalDate ? -1 : (a.originalDate > b.originalDate ? 1 : 0);
  }
  Object.keys(groups).forEach(function (k) {
    var list = groups[k].sort(byUrgency), owner = {}, queue = [];
    list.forEach(function (r) {
      if (r.assignedDate >= today && !owner[r.assignedDate]) owner[r.assignedDate] = r; else queue.push(r);
    });
    // Cards that need a day (their day passed, or two share one) take the earliest day they may use.
    // A day held by a card with MORE slack (a later latest date) is handed over: that card moves on.
    // Every hand-over goes to a strictly later deadline, so this always finishes.
    while (queue.length) {
      queue.sort(byUrgency);
      var r = queue.shift(), before = r.assignedDate, placed = false;
      for (var d = today; d <= r.latestDate; d = addDays_(d, 1)) {
        var o = owner[d];
        if (!o) { owner[d] = r; r.assignedDate = d; placed = true; break; }
        if (o !== r && o.latestDate > r.latestDate) { owner[d] = r; r.assignedDate = d; queue.push(o); placed = true; break; }
      }
      if (!placed) r.assignedDate = r.latestDate;     // only reachable if moves left no feasible day
      if (r.assignedDate !== before) touch(r);
    }
  });
  rows.forEach(function (r) {
    if (r.status === 'completed' || r.status === 'missed') return;
    var s = planStatusOf_(r, today);
    if (r.status !== s) { r.status = s; touch(r); }
  });
  return dirty;
}

/** Dates an open instance may be moved to: today (or period start) .. latestDate, minus days its siblings use. */
function planMoveOptions_(r, siblings, today) {
  if (!planIsOpen_(r) || r.status === 'locked' || today >= r.latestDate) return [];
  var lo = r.periodStart > today ? r.periodStart : today;
  var used = {};
  siblings.forEach(function (s) { if (s !== r && planIsOpen_(s)) used[s.assignedDate] = true; });
  var out = [];
  for (var d = lo; d <= r.latestDate; d = addDays_(d, 1)) if (!used[d] && d !== r.assignedDate) out.push(d);
  return out;
}

/* ------------------------------------------------------------------ */
/* Sheet access for ACTIVITY_INSTANCES (whole-table reads, batch writes) */
/* ------------------------------------------------------------------ */

/** Sheets hands back real Date objects for date cells, and formatting each one is slow. Dates repeat a lot, so convert each distinct one once. */
var PLAN_YMD = {};
function planYmd_(v) {
  if (v instanceof Date) {
    var k = v.getTime();
    return PLAN_YMD[k] || (PLAN_YMD[k] = ymd_(v));
  }
  return ymd_(v);
}

function planLoad_() {
  var s = sheet_('ACTIVITY_INSTANCES'), last = s.getLastRow(), cols = s.getLastColumn();
  var headers = s.getRange(1, 1, 1, cols).getValues()[0];
  PLAN.NEEDS_COLS.forEach(function (c) {
    if (headers.indexOf(c) === -1) throw new ApiError('NEEDS_SETUP', 'The backend needs an update. Run setup() once in the Apps Script editor, then deploy a new version.');
  });
  var rows = [];
  if (last >= 2) {
    s.getRange(2, 1, last - 1, cols).getValues().forEach(function (v, i) {
      var o = { _row: i + 2 };
      headers.forEach(function (h, k) { o[h] = v[k]; });
      PLAN.DATE_COLS.forEach(function (c) { o[c] = planYmd_(o[c]); });
      o.movedCount = Number(o.movedCount) || 0;
      rows.push(o);
    });
  }
  return { sheet: s, headers: headers, rows: rows };
}

/** Writes changed rows back as ONE contiguous block (the rows between the first and last changed one). */
function planSave_(L, dirty) {
  if (!dirty.length) return;
  var min = Infinity, max = 0;
  dirty.forEach(function (r) { min = Math.min(min, r._row); max = Math.max(max, r._row); });
  var span = L.rows.filter(function (r) { return r._row >= min && r._row <= max; }).sort(function (a, b) { return a._row - b._row; });
  var values = span.map(function (r) { return L.headers.map(function (h) { return r[h] === undefined ? '' : r[h]; }); });
  L.sheet.getRange(min, 1, values.length, L.headers.length).setValues(values);
  delete _TABLES.ACTIVITY_INSTANCES;
}

function planAppendMany_(name, objs) {
  if (!objs.length) return;
  var s = sheet_(name);
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var values = objs.map(function (o) { return headers.map(function (h) { return o[h] === undefined ? '' : o[h]; }); });
  s.getRange(s.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  delete _TABLES[name];
}

function planUserComps_(me) { return userCompsForSync_(readAll_('COMPLETIONS'), me); }

/** A person's task cards in goals that are still active (archived goals are frozen: nothing rolls or goes missed). */
function planLiveRows_(L, me) {
  var active = activeGoalIds_();
  return L.rows.filter(function (r) { return r.userId === me && active[r.goalId]; });
}

/** Brings the person's tasks AND points up to date (Game.gs settleUsers_ does both, taking the lock only when needed). */
function planSync_(me) { return settleUsers_([me]); }

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function planParams_(raw) {
  try { var o = JSON.parse(raw || '{}'); return o && typeof o === 'object' && !o.archived ? o : {}; } catch (e) { return {}; }
}

function planActiveGoals_(me) {
  var m = {};
  readAll_('GOALS').forEach(function (g) {
    if (g.userId === me && g.status === 'active') m[g.goalId] = { goalId: g.goalId, title: g.title, startDate: ymd_(g.startDate), endDate: ymd_(g.endDate), durationMonths: Number(g.durationMonths) || 0 };
  });
  return m;
}

function planCatalogView_() {
  return {
    areas: CATALOG,
    limits: { months: PLAN.MAX_MONTHS, weeklyMax: PLAN.WEEKLY_MAX, monthlyMax: PLAN.MONTHLY_MAX, maxStartAheadDays: PLAN.MAX_START_AHEAD_DAYS },
    nameMax: parseInt(getSetting_('others_name_max_length', '60'), 10) || 60
  };
}

function routePlanCatalog_() {
  return planCatalogView_();
}

function routePlanPreview_(p, ctx) {
  var me = ctx.user.userId;
  var g = planCleanGoal_(p, me);
  planCheckLimits_(me, g.activities.length);
  return {
    title: g.title, durationMonths: g.months, startDate: g.start, endDate: g.end, totalInstances: g.total,
    areas: g.areas.map(function (k) {
      return { areaKey: k, label: planAreaLabel_(k), activities: g.activities.filter(function (a) { return a.areaKey === k; }).map(function (a) {
        return { activityKey: a.activityKey, name: a.activityName, frequencyType: a.frequencyType, target: a.target, params: a.params, total: a.total };
      }) };
    })
  };
}

function routePlanCreateGoal_(p, ctx) {
  var me = ctx.user.userId;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    _TABLES = {};
    var g = planCleanGoal_(p, me);
    planCheckLimits_(me, g.activities.length);
    var now = new Date().toISOString(), goalId = newId_('goal'), today = dateKey_();
    var defs = [], inst = [];
    g.activities.forEach(function (a) {
      var defId = newId_('act');
      defs.push({ activityDefId: defId, goalId: goalId, userId: me, areaKey: a.areaKey, activityKey: a.activityKey, activityName: a.activityName,
        frequencyType: a.frequencyType, target: a.target, params: JSON.stringify(a.params), createdDate: now });
      a.instances.forEach(function (x) {
        x.activityId = newId_('ins'); x.goalId = goalId; x.userId = me; x.activityDefId = defId;
        x.status = planStatusOf_(x, today);
        inst.push(x);
      });
    });
    appendObject_('GOALS', { goalId: goalId, userId: me, title: g.title, durationMonths: g.months, startDate: g.start, endDate: g.end, status: 'active', createdDate: now });
    planAppendMany_('GOAL_AREAS', g.areas.map(function (k) { return { goalAreaId: newId_('ga'), goalId: goalId, areaKey: k }; }));
    planAppendMany_('ACTIVITIES', defs);
    planAppendMany_('ACTIVITY_INSTANCES', inst);
    log_('INFO', 'plan.createGoal', g.title + ': ' + defs.length + ' activities, ' + inst.length + ' instances', me);
    return { goalId: goalId, startDate: g.start, endDate: g.end, activities: defs.length, instances: inst.length };
  } finally {
    lock.releaseLock();
  }
}

function planCounts_(rows) {
  var c = { total: rows.length, completed: 0, missed: 0, open: 0 };
  rows.forEach(function (r) { if (r.status === 'completed') c.completed++; else if (r.status === 'missed') c.missed++; else c.open++; });
  c.pct = c.total ? Math.round(c.completed * 100 / c.total) : 0;
  return c;
}

function routePlanGoals_(p, ctx) {
  var me = ctx.user.userId;
  var s = planSync_(me), goals = planActiveGoals_(me);
  var acts = readAll_('ACTIVITIES').filter(function (a) { return a.userId === me && !isArchived_(a) && goals[a.goalId]; });
  var mine = s.L.rows.filter(function (r) { return r.userId === me && goals[r.goalId]; });
  var out = Object.keys(goals).map(function (id) {
    var g = goals[id];
    g.counts = planCounts_(mine.filter(function (r) { return r.goalId === id; }));
    g.activities = acts.filter(function (a) { return a.goalId === id; }).map(function (a) {
      var rows = mine.filter(function (r) { return r.activityDefId === a.activityDefId; });
      return { activityId: a.activityDefId, name: a.activityName, areaKey: a.areaKey, activityKey: a.activityKey, frequencyType: a.frequencyType,
        target: Number(a.target) || 1, params: planParams_(a.params), counts: planCounts_(rows) };
    });
    return g;
  }).sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; });
  return { today: s.today, goals: out, catalog: planCatalogView_() };
}

function planItem_(r, g, defs, groups, today, compById) {
  var sib = groups[planGroupKey_(r)] || [r];
  var open = planIsOpen_(r);
  var options = planMoveOptions_(r, sib, today);
  var def = defs[r.activityDefId] || {};
  var comp = r.completionId && compById ? compById[r.completionId] : null;
  return {
    id: r.activityId, goalId: r.goalId, goalTitle: g ? g.title : '', defId: r.activityDefId, name: r.activityName, areaKey: r.category, activityKey: def.activityKey || '',
    frequency: r.frequency, target: Number(r.target) || 1, periodStart: r.periodStart, periodEnd: r.periodEnd,
    assigned: r.assignedDate, latest: r.latestDate, original: r.originalDate, moved: r.movedCount, status: r.status,
    completedDate: r.completedDate, notes: String(r.completionNotes || ''), params: planParams_(def.params),
    canComplete: open && r.periodStart <= today && today <= r.latestDate,
    moveOptions: options, canMove: options.length > 0,
    points: previewFor_(r), completionStatus: comp ? comp.status : '', earned: comp ? Number(comp.points) || 0 : 0,
    hold: !!(comp && comp.status === 'held')
  };
}

function planDateArg_(v, fallback) {
  var s = String(v || '');
  if (!s) return fallback;
  if (!planValidDate_(s)) throw new ApiError('BAD_REQUEST', 'Invalid date.');
  return s;
}

function routePlanCalendar_(p, ctx) {
  var me = ctx.user.userId;
  var today0 = dateKey_();
  var from = planDateArg_(p.from, today0.slice(0, 8) + '01');
  var to = planDateArg_(p.to, planMonthEnd_(from));
  if (to < from) throw new ApiError('BAD_REQUEST', 'The end of the range is before its start.');
  if (planDaysBetween_(from, to) > PLAN.MAX_RANGE_DAYS) throw new ApiError('BAD_REQUEST', 'That date range is too long.');
  var s = planSync_(me), goals = planActiveGoals_(me);
  var defs = {};
  readAll_('ACTIVITIES').forEach(function (a) { if (a.userId === me) defs[a.activityDefId] = a; });
  var mine = s.L.rows.filter(function (r) { return r.userId === me && goals[r.goalId]; });
  var groups = {};
  mine.forEach(function (r) { (groups[planGroupKey_(r)] = groups[planGroupKey_(r)] || []).push(r); });
  var compById = {};
  readAll_('COMPLETIONS').forEach(function (c) { if (c.userId === me) compById[c.completionId] = c; });
  var goalFilter = String(p.goalId || '');
  var items = mine.filter(function (r) { return r.assignedDate >= from && r.assignedDate <= to && (!goalFilter || r.goalId === goalFilter); })
    .map(function (r) { return planItem_(r, goals[r.goalId], defs, groups, s.today, compById); })
    .sort(function (a, b) { return a.assigned < b.assigned ? -1 : (a.assigned > b.assigned ? 1 : (a.name < b.name ? -1 : 1)); });
  return {
    today: s.today, from: from, to: to, items: items,
    goals: Object.keys(goals).map(function (k) { return { goalId: k, title: goals[k].title, startDate: goals[k].startDate, endDate: goals[k].endDate }; }),
    areas: CATALOG.map(function (a) { return { key: a.key, label: a.label, icon: a.icon }; })
  };
}

/* ------------------------------------------------------------------ */
/* Actions: move, move to next day, complete                           */
/* ------------------------------------------------------------------ */

function planOwnedRow_(L, id, me) {
  var hit = L.rows.filter(function (r) { return r.activityId === String(id || '') && r.userId === me; })[0];
  if (!hit) throw new ApiError('NOT_FOUND', 'Activity not found.');
  var g = findRow_('GOALS', 'goalId', hit.goalId);
  if (!g || g.obj.status !== 'active') throw new ApiError('NOT_FOUND', 'That goal is no longer active.');
  return hit;
}

function planMove_(p, ctx, pick) {
  var me = ctx.user.userId;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _TABLES = {};
    var today = dateKey_();
    var L = planLoad_();
    var mine = planLiveRows_(L, me);
    var dirty = planApplySync_(mine, planUserComps_(me), today);           // bring everything up to date first
    var r = planOwnedRow_(L, p.instanceId, me);
    if (r.status === 'completed') throw new ApiError('NOT_ALLOWED', 'This activity is already completed.');
    if (r.status === 'missed') throw new ApiError('NOT_ALLOWED', 'This activity was missed and is locked.');
    var sib = mine.filter(function (x) { return planGroupKey_(x) === planGroupKey_(r); });
    var options = planMoveOptions_(r, sib, today);
    if (r.status === 'locked' || today >= r.latestDate) throw new ApiError('LOCKED', 'This is its last allowed day (' + r.latestDate + '). It must be done today or it will be missed.');
    var date = pick(r, options);
    if (options.indexOf(date) === -1) {
      throw new ApiError('INVALID_DATE', options.length
        ? 'You can only move this activity between ' + options[0] + ' and ' + r.latestDate + ', on days it does not already use.'
        : 'There is no free day left for this activity before ' + r.latestDate + '.');
    }
    r.assignedDate = date;
    r.movedCount = (Number(r.movedCount) || 0) + 1;
    r.status = planStatusOf_(r, today);
    if (dirty.indexOf(r) === -1) dirty.push(r);
    planSave_(L, dirty);
    log_('INFO', 'plan.move', r.activityName + ' -> ' + date, me);
    var groups = {};
    mine.forEach(function (x) { (groups[planGroupKey_(x)] = groups[planGroupKey_(x)] || []).push(x); });
    var defs = {};
    readAll_('ACTIVITIES').forEach(function (a) { if (a.userId === me) defs[a.activityDefId] = a; });
    return { item: planItem_(r, planActiveGoals_(me)[r.goalId], defs, groups, today, {}) };
  } finally {
    lock.releaseLock();
  }
}

function routePlanMove_(p, ctx) {
  var date = String(p.date || '');
  if (!planValidDate_(date)) throw new ApiError('BAD_REQUEST', 'Pick a valid date.');
  return planMove_(p, ctx, function () { return date; });
}

function routePlanMoveNext_(p, ctx) {
  return planMove_(p, ctx, function (r, options) {
    var next = options.filter(function (d) { return d > r.assignedDate; })[0];
    if (!next) throw new ApiError('LOCKED', 'No later day is free. The last allowed day is ' + r.latestDate + '.');
    return next;
  });
}
