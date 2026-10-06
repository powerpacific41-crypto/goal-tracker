/**
 * GOAL TRACKER - Phase 6: accountability partners.
 *
 * - Anyone can send a request to one or more registered users. A request starts as `pending`; only the invited
 *   person can accept or decline it; the sender can withdraw it. Either partner can end an accepted partnership.
 * - Accepted partners see each other's goals, progress, points and completion photos (and nothing else).
 * - A partner who doubts a photo can FLAG the task. A flagged task goes on HOLD: it earns no points (and cannot
 *   count towards a 100% bonus) until an admin APPROVES it (points are given) or REJECTS it (no points, the task
 *   re-opens if its window is still open, otherwise it becomes missed).
 * - A partner can copy another partner's goal sheet. The copy opens in the normal goal wizard, so the person
 *   chooses their own start date and enters their own amounts (money amounts are never copied).
 *
 * Points are never edited here: the status of the completion changes and Game.gs reconcile moves the ledger.
 */

var ACCT = {
  MAX_INVITES_AT_ONCE: 20,
  MAX_OPEN_FLAGS: 10          // flags one person may have waiting for an admin at the same time
};

function getAcctRoutes_() {
  return {
    'acct.overview': routeAcctOverview_,
    'acct.invite': routeAcctInvite_,
    'acct.respond': routeAcctRespond_,
    'acct.revoke': routeAcctRevoke_,
    'acct.partner': routeAcctPartner_,
    'acct.review': routeAcctReview_,
    'acct.template': routeAcctTemplate_
  };
}

function getStaffRoutes_() {
  return {
    'reviews.list': routeReviewsList_,
    'reviews.resolve': routeReviewsResolve_
  };
}

/* ------------------------------------------------------------------ */
/* Partnerships                                                        */
/* ------------------------------------------------------------------ */

function hasRelation_(rows, a, b) {
  return rows.some(function (r) {
    return (r.status === 'pending' || r.status === 'accepted') && ((r.requesterId === a && r.partnerId === b) || (r.requesterId === b && r.partnerId === a));
  });
}

function acctOverviewFor_(me) {
  var names = nameMap_(), rows = readAll_('ACCOUNTABILITY'), today = dateKey_(), wk = weekKey_(today);
  var totals = pointTotals_(), weekTotals = pointTotals_(function (e) { return ymd_(e.weekKey) === wk; });
  var held = {};
  readAll_('COMPLETIONS').forEach(function (c) { if (c.status === 'held') held[c.userId] = (held[c.userId] || 0) + 1; });
  var withGoal = {};
  readAll_('GOALS').forEach(function (g) { if (g.status === 'active' && ymd_(g.endDate) >= today) withGoal[g.userId] = true; });
  var mk = function (r, other) {
    return { partnershipId: r.partnershipId, userId: other, name: names[other] || other, date: ymd_(r.respondedDate || r.requestedDate), note: String(r.note || '') };
  };
  var partners = rows.filter(function (r) { return r.status === 'accepted' && (r.requesterId === me || r.partnerId === me); }).map(function (r) {
    var o = mk(r, otherOf_(r, me));
    o.points = totals[o.userId] || 0; o.weekPoints = weekTotals[o.userId] || 0; o.onHold = held[o.userId] || 0; o.hasGoal = !!withGoal[o.userId];
    return o;
  });
  var people = readAll_('USERS').filter(function (u) {
    return u.status === 'active' && u.role !== 'developer' && u.userId !== me && !hasRelation_(rows, me, u.userId);
  }).map(function (u) { return { userId: u.userId, name: u.name, hasGoal: !!withGoal[u.userId] }; })
    .sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  return {
    partners: partners,
    incoming: rows.filter(function (r) { return r.status === 'pending' && r.partnerId === me; }).map(function (r) { return mk(r, r.requesterId); }),
    outgoing: rows.filter(function (r) { return r.status === 'pending' && r.requesterId === me; }).map(function (r) { return mk(r, r.partnerId); }),
    people: people
  };
}

function routeAcctOverview_(p, ctx) { return acctOverviewFor_(ctx.user.userId); }

/** Send a request to one or more people. Returns who it reached and who was skipped (with the reason). */
function routeAcctInvite_(p, ctx) {
  var me = ctx.user.userId;
  var ids = [];
  (Array.isArray(p.userIds) ? p.userIds : []).forEach(function (v) {
    var id = normId_(v);
    if (id && ids.indexOf(id) === -1) ids.push(id);
  });
  if (!ids.length) throw new ApiError('BAD_REQUEST', 'Pick at least one person.');
  if (ids.length > ACCT.MAX_INVITES_AT_ONCE) throw new ApiError('BAD_REQUEST', 'You can invite up to ' + ACCT.MAX_INVITES_AT_ONCE + ' people at once.');
  var note = String(p.note || '').trim().slice(0, GAME.PARTNER_NOTE_MAX);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _TABLES = {};
    var rows = readAll_('ACCOUNTABILITY'), names = nameMap_(), sent = [], skipped = [];
    ids.forEach(function (to) {
      var target = findRow_('USERS', 'userId', to);
      if (!target || target.obj.status !== 'active' || target.obj.role === 'developer' || to === me) { skipped.push({ userId: to, name: names[to] || to, reason: 'Not available.' }); return; }
      if (hasRelation_(rows, me, to)) { skipped.push({ userId: to, name: names[to] || to, reason: 'Already partners or a request is waiting.' }); return; }
      appendObject_('ACCOUNTABILITY', { partnershipId: newId_('ptn'), requesterId: me, partnerId: to, goalId: '', status: 'pending', requestedDate: new Date().toISOString(), note: note });
      sent.push({ userId: to, name: names[to] || to });
    });
    if (sent.length) log_('INFO', 'acct.invite', 'Sent ' + sent.length + ' request(s)', me);
    return { sent: sent, skipped: skipped, overview: acctOverviewFor_(me) };
  } finally {
    lock.releaseLock();
  }
}

function routeAcctRespond_(p, ctx) {
  var me = ctx.user.userId;
  var info = findRow_('ACCOUNTABILITY', 'partnershipId', String(p.partnershipId || ''));
  if (!info || info.obj.partnerId !== me || info.obj.status !== 'pending') throw new ApiError('NOT_FOUND', 'Request not found.');
  updateRow_(info, { status: p.accept === true ? 'accepted' : 'declined', respondedDate: new Date().toISOString() });
  return { overview: acctOverviewFor_(me) };
}

/** Either person can end a partnership; the sender can also withdraw a pending request. */
function routeAcctRevoke_(p, ctx) {
  var me = ctx.user.userId;
  var info = findRow_('ACCOUNTABILITY', 'partnershipId', String(p.partnershipId || ''));
  var r = info && info.obj;
  var mine = r && (r.requesterId === me || r.partnerId === me);
  var okState = r && (r.status === 'accepted' || (r.status === 'pending' && r.requesterId === me));
  if (!mine || !okState) throw new ApiError('NOT_FOUND', 'Partnership not found.');
  updateRow_(info, { status: 'revoked', respondedDate: new Date().toISOString() });
  return { overview: acctOverviewFor_(me) };
}

/* ------------------------------------------------------------------ */
/* A partner's progress                                                */
/* ------------------------------------------------------------------ */

function routeAcctPartner_(p, ctx) {
  var me = ctx.user.userId, other = normId_(p.userId);
  if (!arePartners_(me, other)) throw new ApiError('FORBIDDEN', 'You are not accountability partners with this person.');
  var s = settleUsers_([me, other]), today = s.today, wk = weekKey_(today), names = nameMap_();
  var goals = planActiveGoals_(other);
  var rows = s.L.rows.filter(function (r) { return r.userId === other; });
  var live = rows.filter(function (r) { return goals[r.goalId]; });
  var defs = readAll_('ACTIVITIES').filter(function (a) { return a.userId === other; });
  var defById = {}, instById = {};
  defs.forEach(function (a) { defById[a.activityDefId] = a; });
  rows.forEach(function (r) { instById[r.activityId] = r; });

  var goalCards = Object.keys(goals).map(function (id) {
    var g = goals[id], gRows = live.filter(function (r) { return r.goalId === id; });
    g.counts = planCounts_(gRows);
    g.activities = defs.filter(function (a) { return a.goalId === id && !isArchived_(a); }).map(function (a) {
      return { name: a.activityName, areaKey: a.areaKey, activityKey: a.activityKey, frequencyType: a.frequencyType, target: Number(a.target) || 1,
        counts: planCounts_(gRows.filter(function (r) { return r.activityDefId === a.activityDefId; })) };
    });
    g.copyable = !!acctTemplateFor_(id).areas.length;
    return g;
  }).sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; });

  var cutoff = addDays_(today, -GAME.PARTNER_FEED_DAYS);
  var feed = readAll_('COMPLETIONS').filter(function (c) { return c.userId === other && c.instanceId && ymd_(c.scheduledDate) >= cutoff; })
    .sort(function (a, b) { return ts_(b.completedDate) - ts_(a.completedDate); }).slice(0, GAME.PARTNER_FEED_MAX).map(function (c) {
      var inst = instById[c.instanceId], def = defById[c.activityId];
      return {
        completionId: c.completionId, name: inst ? inst.activityName : (def ? def.activityName : 'Task'), areaKey: inst ? inst.category : (def ? def.areaKey : ''),
        date: ymd_(c.scheduledDate), status: c.status, points: Number(c.points) || 0, source: c.photoSource, code: c.challengeCode,
        takenAt: iso_(c.photoTakenAt), notes: c.notes || '', taskStatus: c.taskStatus || '',
        canReview: c.status === 'done' || c.status === 'verified', flaggedBy: names[c.flaggedBy] || '', reason: String(c.flagReason || ''),
        resolution: String(c.resolution || '')
      };
    });

  var totals = pointTotals_(), weekTotals = pointTotals_(function (e) { return ymd_(e.weekKey) === wk; });
  var inWeek = live.filter(function (r) { return weekKey_(r.originalDate) === wk; });
  var scoring = {};
  readAll_('COMPLETIONS').forEach(function (c) { if (c.userId === other && isScoringComp_(c)) scoring[c.completionId] = true; });
  return {
    partner: { userId: other, name: names[other] || other },
    stats: {
      points: totals[other] || 0, weekPoints: weekTotals[other] || 0,
      tasksDone: Object.keys(scoring).length, missed: live.filter(function (r) { return r.status === 'missed'; }).length,
      weekDone: inWeek.filter(function (r) { return r.status === 'completed'; }).length, weekTotal: inWeek.length,
      dueToday: live.filter(function (r) { return planIsOpen_(r) && r.assignedDate <= today; }).length,
      onHold: feed.filter(function (f) { return f.status === 'held'; }).length
    },
    goals: goalCards, feed: feed, today: today, maxOpenFlags: ACCT.MAX_OPEN_FLAGS
  };
}

/* ------------------------------------------------------------------ */
/* Verify or flag a partner's completion                               */
/* ------------------------------------------------------------------ */

function routeAcctReview_(p, ctx) {
  var me = ctx.user.userId;
  var verdict = p.verdict === 'flagged' ? 'flagged' : (p.verdict === 'verified' ? 'verified' : '');
  if (!verdict) throw new ApiError('BAD_REQUEST', 'Choose "Looks good" or "Flag".');
  var reason = String(p.reason || '').trim().slice(0, GAME.FLAG_REASON_MAX);
  if (verdict === 'flagged' && reason.length < 3) throw new ApiError('BAD_REQUEST', 'Say briefly why you doubt it, so the admin can decide.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _TABLES = {};
    var info = findRow_('COMPLETIONS', 'completionId', String(p.completionId || ''));
    if (!info) throw new ApiError('NOT_FOUND', 'Task not found.');
    var c = info.obj;
    if (c.userId === me || !arePartners_(me, c.userId)) throw new ApiError('FORBIDDEN', 'You can only review your accountability partners\' tasks.');
    if (c.status === 'held') throw new ApiError('ALREADY_REVIEWED', 'This task is already on hold, waiting for an admin.');
    if (c.status === 'approved' || c.status === 'rejected') throw new ApiError('ALREADY_REVIEWED', 'An admin has already decided on this task.');
    if (c.status !== 'done' && c.status !== 'verified') throw new ApiError('ALREADY_REVIEWED', 'This task can no longer be reviewed.');
    var now = new Date().toISOString(), today = dateKey_();
    if (verdict === 'verified') {
      if (c.status !== 'verified') updateRow_(info, { status: 'verified', verifiedBy: me, verifiedAt: now });
      return { status: 'verified' };
    }
    if (ymd_(c.scheduledDate) < addDays_(today, -GAME.PARTNER_FEED_DAYS)) throw new ApiError('TOO_OLD', 'This task is more than ' + GAME.PARTNER_FEED_DAYS + ' days old and can no longer be flagged.');
    var open = readAll_('COMPLETIONS').filter(function (x) { return x.status === 'held' && x.flaggedBy === me; }).length;
    if (open >= ACCT.MAX_OPEN_FLAGS) throw new ApiError('RATE_LIMITED', 'You already have ' + open + ' flags waiting for an admin. Wait for those to be decided first.');
    updateRow_(info, { status: 'held', flaggedBy: me, flaggedAt: now, flagReason: reason });
    settleNoLock_([c.userId], today);                      // takes this task's points (and any bonus it completed) out of the ledger
    log_('INFO', 'acct.flag', 'Flagged ' + c.completionId + ' of ' + c.userId, me);
    return { status: 'held' };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Admin: decide on flagged tasks                                      */
/* ------------------------------------------------------------------ */

function reviewCard_(c, names, instById, defById) {
  var inst = instById[c.instanceId], def = defById[c.activityId];
  return {
    completionId: c.completionId, owner: { userId: c.userId, name: names[c.userId] || c.userId },
    flaggedBy: { userId: c.flaggedBy, name: names[c.flaggedBy] || c.flaggedBy }, reason: String(c.flagReason || ''), flaggedAt: iso_(c.flaggedAt),
    name: inst ? inst.activityName : (def ? def.activityName : 'Task'), areaKey: inst ? inst.category : (def ? def.areaKey : ''),
    date: ymd_(c.scheduledDate), points: Number(c.points) || 0, source: c.photoSource, code: c.challengeCode, takenAt: iso_(c.photoTakenAt),
    notes: c.notes || '', taskStatus: c.taskStatus || '', status: c.status, resolvedBy: names[c.resolvedBy] || '', resolvedAt: iso_(c.resolvedAt), resolution: String(c.resolution || '')
  };
}

function routeReviewsList_(p, ctx) {
  var names = nameMap_(), comps = readAll_('COMPLETIONS');
  var instById = {}, defById = {};
  planLoad_().rows.forEach(function (r) { instById[r.activityId] = r; });
  readAll_('ACTIVITIES').forEach(function (a) { defById[a.activityDefId] = a; });
  var waiting = comps.filter(function (c) { return c.status === 'held'; })
    .sort(function (a, b) { return ts_(a.flaggedAt) - ts_(b.flaggedAt); })
    .map(function (c) { return reviewCard_(c, names, instById, defById); });
  var decided = comps.filter(function (c) { return (c.status === 'approved' || c.status === 'rejected') && c.resolvedBy; })
    .sort(function (a, b) { return ts_(b.resolvedAt) - ts_(a.resolvedAt); }).slice(0, 10)
    .map(function (c) { return reviewCard_(c, names, instById, defById); });
  return { waiting: waiting, decided: decided, me: ctx.user.userId };
}

function routeReviewsResolve_(p, ctx) {
  var me = ctx.user.userId;
  var decision = p.decision === 'approve' ? 'approve' : (p.decision === 'reject' ? 'reject' : '');
  if (!decision) throw new ApiError('BAD_REQUEST', 'Choose approve or reject.');
  var note = String(p.note || '').trim().slice(0, GAME.REVIEW_NOTE_MAX);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _TABLES = {};
    var info = findRow_('COMPLETIONS', 'completionId', String(p.completionId || ''));
    if (!info) throw new ApiError('NOT_FOUND', 'Task not found.');
    var c = info.obj;
    if (c.status !== 'held') throw new ApiError('ALREADY_REVIEWED', 'This task is not on hold any more.');
    if (c.userId === me || c.flaggedBy === me) throw new ApiError('FORBIDDEN', 'You cannot decide on a task you own or flagged. Ask another admin.');
    updateRow_(info, { status: decision === 'approve' ? 'approved' : 'rejected', resolvedBy: me, resolvedAt: new Date().toISOString(), resolution: note });
    settleNoLock_([c.userId], dateKey_());                 // approve: points come back; reject: the task re-opens (or is missed)
    log_('INFO', 'reviews.resolve', decision + ' ' + c.completionId, me);
    return { status: decision === 'approve' ? 'approved' : 'rejected' };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Copying a partner's goal sheet                                      */
/* ------------------------------------------------------------------ */

/**
 * Turns a goal into a goal-wizard payload using only what the catalog knows. Money amounts are left out on purpose
 * (they are the other person's; the copier must enter their own). Activities the catalog cannot represent are skipped.
 */
function acctTemplateFor_(goalId) {
  var goal = findRow_('GOALS', 'goalId', goalId);
  var byArea = {}, order = [], skipped = 0, moneyHidden = false;
  readAll_('ACTIVITIES').filter(function (a) { return a.goalId === goalId && !isArchived_(a); }).forEach(function (a) {
    var area = planArea_(a.areaKey), def = area && planActDef_(area, a.activityKey);
    var freq = a.frequencyType;
    if (!def || (freq !== 'weekly' && freq !== 'monthly')) { skipped++; return; }
    var have = planParams_(a.params), params = {};
    def.params.forEach(function (pd) {
      if (have[pd.key] === undefined) return;
      if (pd.unit === 'amount') { moneyHidden = true; return; }
      params[pd.key] = have[pd.key];
    });
    if (!byArea[a.areaKey]) { byArea[a.areaKey] = []; order.push(a.areaKey); }
    byArea[a.areaKey].push({ activityKey: def.key, name: def.custom ? a.activityName : '', frequencyType: freq, target: Number(a.target) || 1, params: params });
  });
  return {
    title: goal ? goal.obj.title : '', durationMonths: goal ? Math.min(Number(goal.obj.durationMonths) || 1, PLAN.MAX_MONTHS) : 1,
    areas: order.map(function (k) { return { areaKey: k, activities: byArea[k] }; }), skipped: skipped, moneyHidden: moneyHidden
  };
}

function routeAcctTemplate_(p, ctx) {
  var me = ctx.user.userId;
  var goal = findRow_('GOALS', 'goalId', String(p.goalId || ''));
  if (!goal || goal.obj.status !== 'active' || goal.obj.userId === me || !arePartners_(me, goal.obj.userId)) {
    throw new ApiError('NOT_FOUND', 'Goal not found.');
  }
  var t = acctTemplateFor_(goal.obj.goalId);
  if (!t.areas.length) throw new ApiError('NOT_COPYABLE', 'This goal was made with an older version of the app and cannot be copied.');
  t.from = { userId: goal.obj.userId, name: nameMap_()[goal.obj.userId] || goal.obj.userId };
  return t;
}
