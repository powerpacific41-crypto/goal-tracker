/**
 * Phase 7: in-app notifications.
 *   - a partner completes a task (or a whole goal)
 *   - someone new is added to the app
 *   - someone takes the top spot on the all-time leaderboard
 * Each notification is one row in NOTIFICATIONS for one person. The app shows them in the bell menu.
 * notifyMany_ is the single place where a notification is created, so a push channel can be added there later.
 */

var NOTIFY = {
  LIST_LIMIT: 40,          // newest items returned to the app
  PRUNE_AT: 1500,          // when the sheet grows past this many rows ...
  PRUNE_COUNT: 500         // ... the oldest ones are deleted
};

function getNotifyRoutes_() {
  return {
    'notify.list': routeNotifyList_,
    'notify.read': routeNotifyRead_
  };
}

/** Creates one notification per recipient. Never throws: a failed notification must not break the action that caused it. */
function notifyMany_(userIds, type, title, body, link) {
  try {
    var seen = {}, now = new Date().toISOString(), rows = [];
    (userIds || []).forEach(function (id) {
      if (!id || seen[id]) return;
      seen[id] = true;
      var t = typeof title === 'function' ? title(id) : title, b = typeof body === 'function' ? body(id) : body;
      if (!t) return;
      rows.push({ notificationId: newId_('ntf'), userId: id, type: type, title: String(t).slice(0, 120), body: String(b || '').slice(0, 240), link: link || '', createdAt: now, readAt: '' });
    });
    if (!rows.length) return 0;
    planAppendMany_('NOTIFICATIONS', rows);
    notifyPrune_();
    return rows.length;
  } catch (e) {
    log_('ERROR', 'notify', String(e && e.stack ? e.stack : e), 'system');
    return 0;
  }
}

function notifyPrune_() {
  var s = sheet_('NOTIFICATIONS'), last = s.getLastRow();
  if (last - 1 > NOTIFY.PRUNE_AT && s.deleteRows) { s.deleteRows(2, NOTIFY.PRUNE_COUNT); delete _TABLES['NOTIFICATIONS']; }
}

/** Everyone who should hear about community news: active accounts except developers and the people in `except`. */
function communityIds_(except) {
  var skip = {};
  (except || []).forEach(function (x) { skip[x] = true; });
  return readAll_('USERS').filter(function (u) { return u.status === 'active' && u.role !== 'developer' && !skip[u.userId]; })
    .map(function (u) { return u.userId; });
}

function partnerIdsOf_(userId) {
  var out = [];
  readAll_('ACCOUNTABILITY').forEach(function (r) {
    if (r.status === 'accepted' && (r.requesterId === userId || r.partnerId === userId)) out.push(otherOf_(r, userId));
  });
  return out;
}

function setSetting_(key, value, description) {
  var r = findRow_('SETTINGS', 'key', key);
  if (r) updateRow_(r, { value: value });
  else appendObject_('SETTINGS', { key: key, value: value, description: description || '' });
}

/* ---------- events ---------- */

function notifyTaskDone_(me, taskName, points, goalDone, goalTitle) {
  var names = nameMap_(), who = names[me] || me, partners = partnerIdsOf_(me);
  if (!partners.length) return;
  notifyMany_(partners, 'partner_done', who + ' completed a task', taskName + ' · ' + (points > 0 ? '+' : '') + round2_(points) + ' points', '#/partners');
  if (goalDone) notifyMany_(partners, 'partner_goal', who + ' finished a whole goal 🏆', goalTitle || 'Every task is done.', '#/partners');
}

function notifyNewUser_(userId, name, creatorId) {
  notifyMany_(communityIds_([userId, creatorId]), 'member_joined', name + ' joined Goal Tracker', 'Invite them as an accountability partner.', '#/partners');
}

/**
 * Called whenever points change. When somebody ends up strictly ahead of the current all-time leader,
 * everybody hears about it. A tie does not take the top spot. The first leader is recorded silently.
 */
function leaderCheck_() {
  try {
    var today = dateKey_(), listed = usersWithActiveGoal_(today);
    if (!listed.length) return;
    var totals = pointTotals_(), best = null;
    listed.forEach(function (u) { var p = totals[u.userId] || 0; if (!best || p > best.p) best = { u: u, p: p }; });
    var prevId = getSetting_('leader_user', '');
    var prev = prevId ? listed.filter(function (u) { return u.userId === prevId; })[0] : null;
    if (prev && (totals[prev.userId] || 0) >= best.p) return;       // still on top, or tied
    if (best.u.userId === prevId) return;
    setSetting_('leader_user', best.u.userId, 'Current all-time leaderboard leader (used for notifications)');
    if (!prevId) return;
    var names = nameMap_(), newName = names[best.u.userId] || best.u.userId, oldName = names[prevId] || prevId, pts = round2_(best.p);
    var prevPts = round2_(totals[prevId] || 0);
    notifyMany_(communityIds_([]), 'leader',
      function (id) { return id === best.u.userId ? '🥇 You are #1' : id === prevId ? newName + ' overtook you' : newName + ' is now #1'; },
      function (id) { return id === best.u.userId ? 'You moved ahead of ' + oldName + ' with ' + pts + ' points.' : id === prevId ? pts + ' points to your ' + prevPts + '.' : pts + ' points, ahead of ' + oldName + '.'; },
      '#/board');
  } catch (e) {
    log_('ERROR', 'leaderCheck', String(e && e.stack ? e.stack : e), 'system');
  }
}

/* ---------- routes ---------- */

function routeNotifyList_(p, ctx) {
  var me = ctx.user.userId, items = [], unread = 0;
  readAll_('NOTIFICATIONS').forEach(function (n) {
    if (n.userId !== me) return;
    var isNew = !n.readAt;
    if (isNew) unread++;
    items.push({ id: n.notificationId, type: n.type, title: n.title, body: n.body, link: n.link, at: new Date(n.createdAt).toISOString(), unread: isNew });
  });
  items.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  return { unread: unread, items: items.slice(0, NOTIFY.LIST_LIMIT) };
}

/** { all: true } or { ids: [...] }. Only the owner's own rows are touched. */
function routeNotifyRead_(p, ctx) {
  var me = ctx.user.userId, ids = {}, all = p.all === true;
  (Array.isArray(p.ids) ? p.ids : []).slice(0, 100).forEach(function (x) { ids[String(x)] = true; });
  var s = sheet_('NOTIFICATIONS'), last = s.getLastRow();
  if (last < 2) return { unread: 0 };
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var cId = headers.indexOf('notificationId'), cUser = headers.indexOf('userId'), cRead = headers.indexOf('readAt');
  var values = s.getRange(2, 1, last - 1, headers.length).getValues(), now = new Date().toISOString(), unread = 0;
  values.forEach(function (row, i) {
    if (row[cUser] !== me) return;
    if (!row[cRead] && (all || ids[row[cId]])) s.getRange(i + 2, cRead + 1).setValue(now);
    else if (!row[cRead]) unread++;
  });
  delete _TABLES['NOTIFICATIONS'];
  return { unread: unread };
}
