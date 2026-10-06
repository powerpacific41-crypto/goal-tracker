/**
 * GOAL TRACKER - Phase 6: points, scoring ledger, task completion, Today screen, global leaderboard.
 *
 * Replaces the Phase 3 game layer (levels, streaks, crowns, duo quests, cheers, achievements).
 * One rule set decides every point, and it lives in the GAME block below:
 *
 *   base points   health, finance, career = 2 ; every other life area = 1
 *   floating      completed while the task is "floating"  -> +50% of base
 *   locked        completed on its last allowed day       -> no bonus
 *   missed        a task that passed its last allowed day -> -5 (totals may go below zero)
 *   100% week     every weekly task of that week done     -> +0.25 x number of tasks
 *   100% month    every task of that month done           -> +0.5  x number of tasks
 *   100% goal     every task of the goal done             -> +1    x number of tasks
 *
 * HOW POINTS ARE STORED (important for anyone changing a rule):
 *   GAME_EVENTS is a ledger. Every point has a "key" (stored in refId), for example
 *   task:<instanceId>, missed:<instanceId>, bonus_week:<goal>|<monday>, bonus_month:<goal>|<yyyy-MM>,
 *   bonus_goal:<goalId>. Reconcile works out what each key SHOULD be worth right now from the current
 *   tasks and completions, compares with what the ledger already holds for that key, and appends only the
 *   difference. So holds, approvals, rejections and re-opened tasks all correct the ledger by themselves,
 *   nothing is ever edited or deleted, and running it twice changes nothing.
 *
 * Points are settled lazily (when someone opens the app), so no triggers are needed.
 */

var GAME = {
  // ---- point rules ----
  AREA_POINTS: { health: 2, finance: 2, career: 2 },   // any other life area earns DEFAULT_POINTS
  DEFAULT_POINTS: 1,
  FLOATING_BONUS: 0.5,           // share of the base points added for a floating task
  WEEK_BONUS_PER_TASK: 0.25,
  MONTH_BONUS_PER_TASK: 0.5,
  GOAL_BONUS_PER_TASK: 1,
  MISSED_PENALTY: -5,
  // Who a 100% week / month is measured across: 'goal' = each goal on its own, 'all' = all of a person's goals together.
  BONUS_SCOPE: 'goal',
  // ---- limits ----
  CHALLENGE_MINUTES: 10,         // how long a photo code stays valid
  MAX_ACTIVE_GOALS: 10,
  MAX_ACTIVITIES: 30,
  PARTNER_NOTE_MAX: 120,
  FLAG_REASON_MAX: 200,
  REVIEW_NOTE_MAX: 200,
  PARTNER_FEED_DAYS: 30,
  PARTNER_FEED_MAX: 40,
  RECENT_EVENTS: 20
};

// Ledger event types that count towards points. Older Phase 3 events stay in the sheet but are ignored.
var POINT_TYPES = { task: 1, missed: 1, bonus_week: 1, bonus_month: 1, bonus_goal: 1 };

/* ------------------------------------------------------------------ */
/* Route table                                                         */
/* ------------------------------------------------------------------ */

function getGameRoutes_() {
  return {
    'today.get': routeTodayGet_,
    'goals.archive': routeGoalsArchive_,
    'completions.begin': routeCompletionsBegin_,
    'completions.submit': routeCompletionsSubmit_,
    'completions.photo': routeCompletionsPhoto_,
    'board.get': routeBoardGet_
  };
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function tz_() { return Session.getScriptTimeZone(); }

function dateKey_(d) { return Utilities.formatDate(d || new Date(), tz_(), 'yyyy-MM-dd'); }

/** Dates typed into Sheets can come back as Date objects; always normalise to yyyy-MM-dd text. */
function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, db_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

function iso_(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v || '');
}

function ts_(v) { return new Date(v).getTime(); }

function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function addDays_(key, n) {
  var p = key.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10);
}

/** Monday of the week that contains the given day. */
function weekKey_(key) {
  var p = key.split('-');
  var dow = (new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() + 6) % 7;
  return addDays_(key, -dow);
}

function nameMap_() {
  var m = {};
  readAll_('USERS').forEach(function (u) { m[u.userId] = u.name; });
  return m;
}

function isArchived_(a) {
  try { return JSON.parse(a.params || '{}').archived === true; } catch (e) { return false; }
}

/** done / verified / approved completions earn points. */
function isScoringComp_(c) { return c.status === 'done' || c.status === 'verified' || c.status === 'approved'; }

/** A held completion still occupies its task (the task is not re-opened) but earns nothing until the admin decides. */
function isLinkedComp_(c) { return isScoringComp_(c) || c.status === 'held'; }

function isStaff_(ctx) { return ctx.user.role === 'admin' || ctx.user.role === 'developer'; }

function acceptedPartnerships_(userId) {
  return readAll_('ACCOUNTABILITY').filter(function (r) {
    return r.status === 'accepted' && (r.requesterId === userId || r.partnerId === userId);
  });
}

function otherOf_(p, userId) { return p.requesterId === userId ? p.partnerId : p.requesterId; }

function arePartners_(a, b) {
  return readAll_('ACCOUNTABILITY').some(function (r) {
    return r.status === 'accepted' && ((r.requesterId === a && r.partnerId === b) || (r.requesterId === b && r.partnerId === a));
  });
}

/* ------------------------------------------------------------------ */
/* The point rules (pure functions)                                    */
/* ------------------------------------------------------------------ */

function basePoints_(areaKey) {
  return GAME.AREA_POINTS.hasOwnProperty(areaKey) ? GAME.AREA_POINTS[areaKey] : GAME.DEFAULT_POINTS;
}

/**
 * Points for completing a task right now. status is the task's status at that moment:
 * 'floating' earns the bonus; 'locked' (last allowed day), 'pending' and 'scheduled' earn the base only.
 */
function taskPoints_(areaKey, status) {
  var base = basePoints_(areaKey);
  var bonus = status === 'floating' ? round2_(base * GAME.FLOATING_BONUS) : 0;
  return { base: base, bonus: bonus, total: round2_(base + bonus) };
}

function scopeKey_(goalId) { return GAME.BONUS_SCOPE === 'goal' ? String(goalId) : 'all'; }

/** A task counts as done for bonuses only when its completion earns points (a held one does not, yet). */
function taskDone_(r, compById) {
  if (r.status !== 'completed' || !r.completionId) return false;
  var c = compById[r.completionId];
  return !!c && isScoringComp_(c);
}

/**
 * Every 100% group a person's tasks fall into (weekly, monthly, whole goal), with progress.
 *  - week:  weekly tasks, grouped by the Monday of their ORIGINAL date (floating never changes it)
 *  - month: all tasks, grouped by the month of their original date
 *  - goal:  all tasks of a goal
 * rows: the person's ACTIVITY_INSTANCES. Returns [{type, key, goalId, count, done, complete, bonus, dateKey, label}].
 */
function bonusGroups_(rows, compById) {
  var out = [];
  function collect(type, perTask, keyFn, labelFn) {
    var groups = {};
    rows.forEach(function (r) {
      var k = keyFn(r);
      if (k === null) return;
      (groups[k] = groups[k] || { rows: [], goalId: r.goalId }).rows.push(r);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], done = 0, last = '';
      g.rows.forEach(function (r) {
        if (taskDone_(r, compById)) { done++; if (r.completedDate > last) last = r.completedDate; }
      });
      out.push({
        type: type, key: type + ':' + k, goalId: g.goalId, count: g.rows.length, done: done, complete: done === g.rows.length,
        bonus: round2_(g.rows.length * perTask), dateKey: last, label: labelFn(g.rows.length, k)
      });
    });
  }
  collect('bonus_week', GAME.WEEK_BONUS_PER_TASK,
    function (r) { return r.frequency === 'weekly' ? scopeKey_(r.goalId) + '|' + weekKey_(r.originalDate) : null; },
    function (n) { return '100% of the week (' + n + ' tasks)'; });
  collect('bonus_month', GAME.MONTH_BONUS_PER_TASK,
    function (r) { return scopeKey_(r.goalId) + '|' + String(r.originalDate).slice(0, 7); },
    function (n) { return '100% of the month (' + n + ' tasks)'; });
  collect('bonus_goal', GAME.GOAL_BONUS_PER_TASK,
    function (r) { return String(r.goalId); },
    function (n) { return '100% of the goal (' + n + ' tasks)'; });
  return out;
}

/**
 * What each ledger key of one person should be worth right now.
 * rows: all of the person's instances (any goal). comps: all of the person's completions.
 * Returns { key: { type, points, dateKey, note } }.
 */
function scoreDesired_(rows, comps, today) {
  var want = {}, compById = {}, instById = {};
  comps.forEach(function (c) { compById[c.completionId] = c; });
  rows.forEach(function (r) { instById[r.activityId] = r; });
  function put(key, points, dateKey, note) { want[key] = { type: key.split(':')[0], points: round2_(points), dateKey: dateKey, note: note }; }

  comps.forEach(function (c) {
    if (!c.instanceId || !isScoringComp_(c)) return;
    var inst = instById[c.instanceId];
    var label = inst ? inst.activityName : 'Task';
    var extra = c.taskStatus === 'floating' ? ' (floating +' + Math.round(GAME.FLOATING_BONUS * 100) + '%)' : (c.taskStatus === 'locked' ? ' (last day, no bonus)' : '');
    put('task:' + c.instanceId, Number(c.points) || 0, ymd_(c.scheduledDate), label + extra);
  });
  rows.forEach(function (r) {
    if (r.status !== 'missed') return;
    var d = addDays_(r.latestDate, 1);
    put('missed:' + r.activityId, GAME.MISSED_PENALTY, d > today ? today : d, 'Missed: ' + r.activityName);
  });
  bonusGroups_(rows, compById).forEach(function (g) {
    if (g.complete && g.count > 0) put(g.key, g.bonus, g.dateKey || today, g.label);
  });
  return want;
}

/** Ledger lines needed so that every key's net equals what it should be worth. existing: this person's ledger rows. */
function scoreDiff_(userId, want, existing, today) {
  var net = {}, first = {}, out = [];
  existing.forEach(function (e) {
    if (!POINT_TYPES[e.type]) return;
    var k = String(e.refId);
    net[k] = round2_((net[k] || 0) + (Number(e.points) || 0));
    if (!first[k]) first[k] = ymd_(e.dateKey);
  });
  function emit(key, delta, dateKey, note) {
    var dk = dateKey || today;
    out.push({
      eventId: newId_('evt'), userId: userId, type: key.split(':')[0], points: round2_(delta), refId: key,
      dateKey: dk, weekKey: weekKey_(dk), createdAt: new Date().toISOString(), note: note
    });
  }
  Object.keys(want).forEach(function (k) {
    var delta = round2_(want[k].points - (net[k] || 0));
    if (Math.abs(delta) < 0.001) return;
    emit(k, delta, first[k] || want[k].dateKey, (net[k] ? 'Adjusted: ' : '') + want[k].note);
  });
  Object.keys(net).forEach(function (k) {
    if (want[k] || Math.abs(net[k]) < 0.001) return;
    emit(k, -net[k], first[k], 'Reversed');
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Settling: bring tasks up to date, then bring the ledger up to date  */
/* ------------------------------------------------------------------ */

function activeGoalIds_() {
  var m = {};
  readAll_('GOALS').forEach(function (g) { if (g.status === 'active') m[g.goalId] = true; });
  return m;
}

function userCompsForSync_(all, uid) {
  return all.filter(function (c) { return c.userId === uid && c.instanceId; }).map(function (c) {
    return { id: c.completionId, activityId: c.activityId, day: ymd_(c.scheduledDate), notes: String(c.notes || ''), valid: isLinkedComp_(c) };
  });
}

/**
 * Loads fresh data and works out (without writing) what has to change for these people:
 * task rows to save, and ledger lines to append. Only goals that are still active are rolled forward.
 */
function settleCompute_(userIds, today) {
  var L = planLoad_(), active = activeGoalIds_(), comps = readAll_('COMPLETIONS'), events = readAll_('GAME_EVENTS');
  var dirty = [], newEvents = [];
  userIds.forEach(function (uid) {
    var live = L.rows.filter(function (r) { return r.userId === uid && active[r.goalId]; });
    planApplySync_(live, userCompsForSync_(comps, uid), today).forEach(function (r) { if (dirty.indexOf(r) === -1) dirty.push(r); });
    var all = L.rows.filter(function (r) { return r.userId === uid; });
    var mine = comps.filter(function (c) { return c.userId === uid; });
    var theirs = events.filter(function (e) { return e.userId === uid; });
    scoreDiff_(uid, scoreDesired_(all, mine, today), theirs, today).forEach(function (e) { newEvents.push(e); });
  });
  return { L: L, dirty: dirty, events: newEvents };
}

/** Same as settleUsers_ but the caller already holds the script lock. */
function settleNoLock_(userIds, today) {
  _TABLES = {};
  var w = settleCompute_(userIds, today);
  planSave_(w.L, w.dirty);
  planAppendMany_('GAME_EVENTS', w.events);
  return { L: w.L, today: today };
}

/** Optimistic: look first, take the lock only when something has to be written. */
function settleUsers_(userIds) {
  var today = dateKey_();
  var w = settleCompute_(userIds, today);
  if (!w.dirty.length && !w.events.length) return { L: w.L, today: today };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return settleNoLock_(userIds, today);
  } finally {
    lock.releaseLock();
  }
}

/** Points per person (all types that count), optionally limited by a ledger-row test. */
function pointTotals_(test) {
  var t = {};
  readAll_('GAME_EVENTS').forEach(function (e) {
    if (!POINT_TYPES[e.type] || (test && !test(e))) return;
    t[e.userId] = round2_((t[e.userId] || 0) + (Number(e.points) || 0));
  });
  return t;
}

/* ------------------------------------------------------------------ */
/* Goals                                                               */
/* ------------------------------------------------------------------ */

function routeGoalsArchive_(p, ctx) {
  var info = findRow_('GOALS', 'goalId', String(p.goalId || ''));
  if (!info || info.obj.userId !== ctx.user.userId) throw new ApiError('NOT_FOUND', 'Goal not found.');
  updateRow_(info, { status: 'archived' });
  return { archived: true };
}

/* ------------------------------------------------------------------ */
/* Today                                                               */
/* ------------------------------------------------------------------ */

function previewFor_(r) {
  var pts = taskPoints_(r.category, r.status);
  var rule = r.status === 'floating' ? 'floating' : (r.status === 'locked' ? 'locked' : 'normal');
  return { base: pts.base, bonus: pts.bonus, total: pts.total, rule: rule };
}

function rulesView_() {
  return {
    areaPoints: GAME.AREA_POINTS, defaultPoints: GAME.DEFAULT_POINTS, floating: GAME.FLOATING_BONUS, missed: GAME.MISSED_PENALTY,
    week: GAME.WEEK_BONUS_PER_TASK, month: GAME.MONTH_BONUS_PER_TASK, goal: GAME.GOAL_BONUS_PER_TASK
  };
}

function routeTodayGet_(p, ctx) {
  var me = ctx.user.userId;
  var s = settleUsers_([me]), today = s.today;
  var goals = planActiveGoals_(me), names = nameMap_();
  var comps = readAll_('COMPLETIONS').filter(function (c) { return c.userId === me; });
  var compById = {};
  comps.forEach(function (c) { compById[c.completionId] = c; });
  var rows = s.L.rows.filter(function (r) { return r.userId === me && goals[r.goalId]; });
  var item = function (r) {
    var c = r.completionId ? compById[r.completionId] : null;
    return {
      id: r.activityId, name: r.activityName, areaKey: r.category, goalId: r.goalId, goalTitle: goals[r.goalId].title,
      status: r.status, assigned: r.assignedDate, latest: r.latestDate, frequency: r.frequency, target: Number(r.target) || 1,
      points: previewFor_(r), canComplete: planIsOpen_(r) && r.periodStart <= today && today <= r.latestDate,
      hold: c && c.status === 'held' ? { reason: String(c.flagReason || ''), by: names[c.flaggedBy] || '' } : null,
      earned: c ? Number(c.points) || 0 : 0, completedDate: r.completedDate, completionStatus: c ? c.status : ''
    };
  };
  var due = rows.filter(function (r) { return planIsOpen_(r) && r.assignedDate <= today; }).map(item);
  var rank = { locked: 0, floating: 1, pending: 2 };
  due.sort(function (a, b) { return (rank[a.status] === undefined ? 3 : rank[a.status]) - (rank[b.status] === undefined ? 3 : rank[b.status]); });
  var doneToday = rows.filter(function (r) { return r.status === 'completed' && r.completedDate === today; }).map(item);
  var soon = addDays_(today, 7);
  var coming = rows.filter(function (r) { return planIsOpen_(r) && r.assignedDate > today && r.assignedDate <= soon; })
    .sort(function (a, b) { return a.assignedDate < b.assignedDate ? -1 : 1; }).slice(0, 8).map(item);
  var held = rows.filter(function (r) { var c = compById[r.completionId]; return c && c.status === 'held'; }).map(item);

  // Bonus chances for the current week and month, and the whole goal, per goal.
  var wk = weekKey_(today), mo = today.slice(0, 7), chances = [];
  Object.keys(goals).forEach(function (gid) {
    var gr = bonusGroups_(rows.filter(function (r) { return r.goalId === gid; }), compById);
    var pick = function (type, test) { return gr.filter(function (g) { return g.type === type && test(g.key); })[0] || null; };
    var cut = function (g) { return g ? { done: g.done, total: g.count, bonus: g.bonus } : null; };
    chances.push({
      goalId: gid, title: goals[gid].title,
      week: cut(pick('bonus_week', function (k) { return k.split('|')[1] === wk; })),
      month: cut(pick('bonus_month', function (k) { return k.split('|')[1] === mo; })),
      goal: cut(pick('bonus_goal', function () { return true; }))
    });
  });

  var totals = pointTotals_(), weekTotals = pointTotals_(function (e) { return ymd_(e.weekKey) === wk; });
  var incoming = readAll_('ACCOUNTABILITY').filter(function (r) { return r.partnerId === me && r.status === 'pending'; }).length;
  var reviews = isStaff_(ctx) ? readAll_('COMPLETIONS').filter(function (c) { return c.status === 'held'; }).length : 0;
  return {
    today: today, name: ctx.user.name, points: totals[me] || 0, weekPoints: weekTotals[me] || 0,
    goalCount: Object.keys(goals).length, due: due, doneToday: doneToday, coming: coming, held: held, chances: chances,
    incomingInvites: incoming, reviewsWaiting: reviews, rules: rulesView_()
  };
}

/* ------------------------------------------------------------------ */
/* Completing a task (live photo + points)                             */
/* ------------------------------------------------------------------ */

function newChallengeCode_() {
  var hex = randomHex_(4), out = 'GT-';
  for (var i = 0; i < 4; i++) out += AUTH.TEMP_ALPHABET.charAt(parseInt(hex.substr(i * 2, 2), 16) % AUTH.TEMP_ALPHABET.length);
  return out;
}

function purgeChallenges_() {
  var s = sheet_('CHALLENGES'), last = s.getLastRow();
  if (last < 2) return;
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var c = headers.indexOf('expiresAt'), cutoff = Date.now() - 24 * 3600000;
  var rows = s.getRange(2, 1, last - 1, headers.length).getValues();
  for (var i = rows.length - 1; i >= 0; i--) if (Number(rows[i][c]) < cutoff) s.deleteRow(i + 2);
  delete _TABLES.CHALLENGES;
}

/** The task must be open, its window must have started, and the same activity cannot be done twice in one day. */
function taskBlocker_(r, today, comps, me) {
  if (!r) return 'Task not found.';
  if (r.status === 'completed') return 'This task is already completed.';
  if (r.status === 'missed' || today > r.latestDate) return 'This task was missed and is locked.';
  if (today < r.periodStart) return 'This task has not started yet. It opens on ' + r.periodStart + '.';
  var twice = comps.some(function (c) {
    return c.userId === me && c.activityId === r.activityDefId && isLinkedComp_(c) && ymd_(c.scheduledDate) === today;
  });
  if (twice) return 'You already completed this activity today. Do the next one tomorrow.';
  return '';
}

function ownedTask_(L, id, me) {
  var r = L.rows.filter(function (x) { return x.activityId === String(id || '') && x.userId === me; })[0];
  if (!r) throw new ApiError('NOT_FOUND', 'Task not found.');
  var g = findRow_('GOALS', 'goalId', r.goalId);
  if (!g || g.obj.status !== 'active') throw new ApiError('NOT_FOUND', 'That goal is no longer active.');
  return r;
}

/** Step 1: the app asks for a one-time code, prints it on the photo, then submits. */
function routeCompletionsBegin_(p, ctx) {
  var me = ctx.user.userId;
  var s = settleUsers_([me]);
  var r = ownedTask_(s.L, p.instanceId, me);
  var why = taskBlocker_(r, s.today, readAll_('COMPLETIONS'), me);
  if (why) throw new ApiError('NOT_ALLOWED', why);
  purgeChallenges_();
  var now = Date.now(), code = newChallengeCode_();
  // CHALLENGES.activityId holds the task (instance) id from Phase 6 on.
  appendObject_('CHALLENGES', { code: code, userId: me, activityId: r.activityId, createdAt: now, expiresAt: now + GAME.CHALLENGE_MINUTES * 60000, used: false });
  return {
    code: code, expiresAt: now + GAME.CHALLENGE_MINUTES * 60000, serverTime: new Date(now).toISOString(),
    activityName: r.activityName, points: previewFor_(r)
  };
}

function checkPhoto_(photo) {
  if (!photo || typeof photo.base64 !== 'string' || !photo.base64) throw new ApiError('PHOTO_REQUIRED', 'A live photo is required to complete this task.');
  if (photo.mime !== 'image/jpeg') throw new ApiError('BAD_PHOTO', 'The photo must be a JPEG.');
  var bytes;
  try { bytes = Utilities.base64Decode(photo.base64); } catch (e) { throw new ApiError('BAD_PHOTO', 'The photo could not be read.'); }
  var maxKb = parseInt(getSetting_('max_photo_kb', '1500'), 10) || 1500;
  if (bytes.length > maxKb * 1024) throw new ApiError('PHOTO_TOO_BIG', 'The photo is too large (max ' + maxKb + ' KB).');
  if (bytes.length < 100 || (bytes[0] & 255) !== 255 || (bytes[1] & 255) !== 216) throw new ApiError('BAD_PHOTO', 'The photo could not be read.');
  return bytes;
}

/** Step 2: save the photo, link the task, award the points. */
function routeCompletionsSubmit_(p, ctx) {
  var me = ctx.user.userId;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return submitCompletion_(p, me);
  } finally {
    lock.releaseLock();
  }
}

function submitCompletion_(p, me) {
  _TABLES = {};
  var today = dateKey_();
  var s = settleNoLock_([me], today);                      // rolls tasks forward first so the status is current
  var r = ownedTask_(s.L, p.instanceId, me);
  var why = taskBlocker_(r, today, readAll_('COMPLETIONS'), me);
  if (why) throw new ApiError('NOT_ALLOWED', why);

  var ch = findRow_('CHALLENGES', 'code', String(p.code || ''));
  if (!ch || ch.obj.userId !== me || ch.obj.activityId !== r.activityId) throw new ApiError('BAD_CODE', 'This photo was not taken for this task. Start again.');
  if (isTrue_(ch.obj.used)) throw new ApiError('BAD_CODE', 'This photo code was already used. Take a new photo.');
  if (Number(ch.obj.expiresAt) < Date.now()) throw new ApiError('CODE_EXPIRED', 'That took too long. Start again and take the photo within ' + GAME.CHALLENGE_MINUTES + ' minutes.');
  var photo = p.photo || {};
  var bytes = checkPhoto_(photo);

  var id = newId_('cmp'), taskStatus = planStatusOf_(r, today);
  var pts = taskPoints_(r.category, taskStatus);
  var source = photo.source === 'live' ? 'live' : 'camera-app';
  var folderId = JSON.parse(PropertiesService.getScriptProperties().getProperty('FOLDER_IDS'))['Completion Photos'];
  var file = DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(bytes, 'image/jpeg', me + '_' + today + '_' + id + '.jpg'));

  appendObject_('COMPLETIONS', {
    completionId: id, activityId: r.activityDefId, goalId: r.goalId, userId: me, scheduledDate: today,
    completedDate: new Date().toISOString(), status: 'done', notes: String(p.notes || '').slice(0, 200),
    photoFileId: file.getId(), photoTakenAt: String(photo.takenAt || '').slice(0, 40), photoMime: 'image/jpeg',
    photoSizeKb: Math.round(bytes.length / 1024), points: pts.total, photoSource: source, challengeCode: ch.obj.code,
    instanceId: r.activityId, taskStatus: taskStatus, basePoints: pts.base
  });
  updateRow_(ch, { used: true });

  r.status = 'completed'; r.completedDate = today; r.completionId = id; r.completionNotes = String(p.notes || '').slice(0, 200);
  planSave_(s.L, [r]);

  // ledger: this task's points plus any 100% bonus it just completed
  var before = pointTotals_()[me] || 0;
  var stamp = Date.now() - 1000;
  settleNoLock_([me], today);
  var after = pointTotals_()[me] || 0;

  var breakdown = [{ label: r.activityName, points: pts.base }];
  if (pts.bonus) breakdown.push({ label: 'Floating bonus +' + Math.round(GAME.FLOATING_BONUS * 100) + '%', points: pts.bonus });
  readAll_('GAME_EVENTS').forEach(function (e) {
    if (e.userId === me && String(e.type).indexOf('bonus_') === 0 && ts_(e.createdAt) >= stamp) breakdown.push({ label: e.note, points: Number(e.points) || 0 });
  });

  log_('INFO', 'completions.submit', r.activityName + ' +' + pts.total, me);
  return {
    completionId: id, taskStatus: taskStatus, breakdown: breakdown, earned: round2_(after - before),
    totalPoints: after, note: taskStatus === 'locked' ? 'Last allowed day, so no bonus on this one.' : ''
  };
}

/** Owner, accepted partners, and (only for held or already reviewed completions) staff can fetch a photo. */
function routeCompletionsPhoto_(p, ctx) {
  var me = ctx.user.userId;
  var info = findRow_('COMPLETIONS', 'completionId', String(p.completionId || ''));
  if (!info || !info.obj.photoFileId) throw new ApiError('NOT_FOUND', 'Photo not found.');
  var c = info.obj;
  var allowed = c.userId === me || arePartners_(me, c.userId) || (isStaff_(ctx) && (c.status === 'held' || !!c.resolvedBy));
  if (!allowed) throw new ApiError('FORBIDDEN', 'You cannot view this photo.');
  var blob = DriveApp.getFileById(c.photoFileId).getBlob();
  return { base64: Utilities.base64Encode(blob.getBytes()), mime: 'image/jpeg' };
}

/* ------------------------------------------------------------------ */
/* Global leaderboard                                                  */
/* ------------------------------------------------------------------ */

/** Everyone with an active account and at least one goal that is active and has not ended. */
function usersWithActiveGoal_(today) {
  var have = {};
  readAll_('GOALS').forEach(function (g) {
    if (g.status === 'active' && ymd_(g.endDate) >= today) have[g.userId] = true;
  });
  return readAll_('USERS').filter(function (u) { return u.status === 'active' && u.role !== 'developer' && have[u.userId]; });
}

function periodTest_(period, today) {
  if (period === 'week') { var wk = weekKey_(today); return function (e) { return ymd_(e.weekKey) === wk; }; }
  if (period === 'month') { var mo = today.slice(0, 7); return function (e) { return ymd_(e.dateKey).slice(0, 7) === mo; }; }
  return null;
}

function routeBoardGet_(p, ctx) {
  var me = ctx.user.userId, today = dateKey_();
  var period = p.period === 'week' || p.period === 'month' ? p.period : 'all';
  var listed = usersWithActiveGoal_(today);
  var ids = listed.map(function (u) { return u.userId; });
  if (ids.indexOf(me) === -1) ids.push(me);
  settleUsers_(ids);                                       // so everybody's missed tasks and bonuses are up to date
  var test = periodTest_(period, today);
  var totals = pointTotals_(test);
  var done = {};
  readAll_('COMPLETIONS').forEach(function (c) {
    if (!c.instanceId || !isScoringComp_(c)) return;
    var d = ymd_(c.scheduledDate);
    if (period === 'week' && weekKey_(d) !== weekKey_(today)) return;
    if (period === 'month' && d.slice(0, 7) !== today.slice(0, 7)) return;
    done[c.userId] = (done[c.userId] || 0) + 1;
  });
  var rows = listed.map(function (u) {
    return { userId: u.userId, name: u.name, points: totals[u.userId] || 0, tasksDone: done[u.userId] || 0, isMe: u.userId === me };
  }).sort(function (a, b) { return b.points - a.points || b.tasksDone - a.tasksDone || (a.name < b.name ? -1 : 1); });
  var rank = 0, prev = null;
  rows.forEach(function (r, i) {
    if (prev === null || r.points !== prev) rank = i + 1;      // equal points share a rank
    r.rank = rank; prev = r.points;
  });
  var mine = rows.filter(function (r) { return r.isMe; })[0] || null;

  var parts = { tasks: 0, bonuses: 0, penalties: 0 }, missedNet = {};
  var events = readAll_('GAME_EVENTS').filter(function (e) { return e.userId === me && POINT_TYPES[e.type]; });
  events.forEach(function (e) {
    if (test && !test(e)) return;
    var v = Number(e.points) || 0;
    if (e.type === 'task') parts.tasks += v;
    else if (e.type === 'missed') { parts.penalties += v; missedNet[e.refId] = (missedNet[e.refId] || 0) + v; }
    else parts.bonuses += v;
  });
  var missedCount = Object.keys(missedNet).filter(function (k) { return missedNet[k] < 0; }).length;
  var recent = events.filter(function (e) { return Math.abs(Number(e.points) || 0) > 0; })
    .sort(function (a, b) { return ts_(b.createdAt) - ts_(a.createdAt); }).slice(0, GAME.RECENT_EVENTS)
    .map(function (e) { return { type: e.type, points: Number(e.points) || 0, note: e.note, at: iso_(e.createdAt) }; });
  return {
    period: period, today: today, rows: rows,
    me: {
      listed: !!mine, rank: mine ? mine.rank : null, points: totals[me] || 0, of: rows.length,
      parts: { tasks: round2_(parts.tasks), bonuses: round2_(parts.bonuses), penalties: round2_(parts.penalties), missed: missedCount }
    },
    recent: recent, rules: rulesView_()
  };
}
