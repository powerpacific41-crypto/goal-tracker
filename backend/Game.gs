/**
 * GOAL TRACKER - Phase 3: the game layer.
 *
 * Goals and activities ("quests"), points, levels, achievements, live-photo proof,
 * accountability partners, weekly duels with crowns, duo quests and cheers.
 *
 * Everything that earns points is decided HERE, never in the browser:
 *   - GAME_EVENTS is the points ledger. Points, levels and weekly duel scores are all sums over it.
 *   - A completion needs a photo and a fresh one-time code (printed on the photo by the app).
 *   - Weekly duels are settled lazily (when someone opens the app), so no triggers are needed.
 */

var GAME = {
  BASE_POINTS: 10,          // every completed quest
  STREAK_BONUS_CAP: 10,     // +1 per streak day, up to this
  FIRST_OF_DAY: 5,          // first quest completed each day
  PERFECT_DAY: 15,          // every daily quest done on one day (needs 2 or more)
  VERIFY_BONUS: 5,          // to you, when your partner verifies your photo
  REFEREE_POINTS: 2,        // to the partner who verified
  CROWN_BONUS: 50,          // weekly duel winner
  DUO_BONUS: 40,            // each partner, when the duo quest is reached
  DUO_TARGET: 20,           // quests done together in a week ...
  DUO_MIN_EACH: 5,          // ... with at least this many from each person
  CHEER_POINTS: 1,          // for sending a cheer (first few per day)
  CHEER_POINTS_PER_DAY: 5,
  CHEERS_PER_DAY: 30,
  NUDGE_HOURS: 4,
  LEVEL_PER_ACTIVE_DAY: 5,  // level score: regularity ...
  LEVEL_PER_ACTIVITY: 15,   // ... and the size of your chart
  LEVEL_ACTIVITY_CAP: 20,   // (only this many activities count towards level)
  CHALLENGE_MINUTES: 10,    // how long a photo code stays valid
  MAX_ACTIVE_GOALS: 10,
  MAX_ACTIVITIES: 30,
  HISTORY_WEEKS: 8          // how far back unsettled weeks are caught up
};

var AREAS = [
  { key: 'health', label: 'Health', icon: '🥗' },
  { key: 'fitness', label: 'Fitness', icon: '🏋️' },
  { key: 'learning', label: 'Learning', icon: '📚' },
  { key: 'career', label: 'Career', icon: '💼' },
  { key: 'finance', label: 'Finance', icon: '💰' },
  { key: 'mind', label: 'Mind', icon: '🧘' },
  { key: 'relationships', label: 'Relationships', icon: '❤️' },
  { key: 'creative', label: 'Creative', icon: '🎨' },
  { key: 'home', label: 'Home', icon: '🏡' },
  { key: 'others', label: 'Others', icon: '✨' }
];

var LEVEL_TITLES = [[1, 'Rookie', '🌱'], [3, 'Spark', '⚡'], [5, 'Climber', '🧗'], [8, 'Challenger', '🛡️'],
  [12, 'Achiever', '🏅'], [16, 'Champion', '🏆'], [20, 'Legend', '🔥'], [30, 'Mythic', '🐉']];

var CHEER_EMOJIS = ['🔥', '👏', '💪', '🎉', '⭐', '🚀'];

// Event types that count towards the weekly duel (bonuses like crowns and achievements do not).
var DUEL_TYPES = { completion: 1, verified: 1, referee: 1, perfect_day: 1, flagged: 1 };

// Each achievement unlocks when stats[metric] >= goal. Add rows here to add achievements.
var ACHIEVEMENTS = [
  { key: 'first_step', name: 'First Step', desc: 'Complete your first quest', icon: '👣', bonus: 10, metric: 'completions', goal: 1 },
  { key: 'warming_up', name: 'Warming Up', desc: 'Complete 10 quests', icon: '🔥', bonus: 20, metric: 'completions', goal: 10 },
  { key: 'on_a_roll', name: 'On a Roll', desc: 'Complete 50 quests', icon: '🎲', bonus: 40, metric: 'completions', goal: 50 },
  { key: 'centurion', name: 'Centurion', desc: 'Complete 100 quests', icon: '💯', bonus: 75, metric: 'completions', goal: 100 },
  { key: 'unstoppable', name: 'Unstoppable', desc: 'Complete 500 quests', icon: '🚀', bonus: 200, metric: 'completions', goal: 500 },
  { key: 'streak_3', name: 'Hat Trick', desc: 'Reach a 3-day streak', icon: '🎯', bonus: 15, metric: 'longestStreak', goal: 3 },
  { key: 'streak_7', name: 'Week Warrior', desc: 'Reach a 7-day streak', icon: '🗓️', bonus: 30, metric: 'longestStreak', goal: 7 },
  { key: 'streak_14', name: 'Fortnight Fighter', desc: 'Reach a 14-day streak', icon: '⚔️', bonus: 50, metric: 'longestStreak', goal: 14 },
  { key: 'streak_30', name: 'Monthly Master', desc: 'Reach a 30-day streak', icon: '🌙', bonus: 100, metric: 'longestStreak', goal: 30 },
  { key: 'streak_100', name: 'Iron Habit', desc: 'Reach a 100-day streak', icon: '🛡️', bonus: 300, metric: 'longestStreak', goal: 100 },
  { key: 'regular_7', name: 'Regular', desc: 'Be active on 7 different days', icon: '📅', bonus: 20, metric: 'activeDays', goal: 7 },
  { key: 'regular_30', name: 'Creature of Habit', desc: 'Be active on 30 different days', icon: '🏡', bonus: 60, metric: 'activeDays', goal: 30 },
  { key: 'dreamer', name: 'Dreamer', desc: 'Create your first goal', icon: '🌠', bonus: 10, metric: 'goals', goal: 1 },
  { key: 'goal_getter', name: 'Goal Getter', desc: 'Have 3 active goals', icon: '🎪', bonus: 20, metric: 'goals', goal: 3 },
  { key: 'planner', name: 'Planner', desc: 'Have 5 activities in your chart', icon: '🗺️', bonus: 15, metric: 'activities', goal: 5 },
  { key: 'architect', name: 'Architect', desc: 'Have 10 activities in your chart', icon: '🏗️', bonus: 30, metric: 'activities', goal: 10 },
  { key: 'perfect_1', name: 'Perfect Day', desc: 'Finish every daily quest in one day', icon: '✨', bonus: 20, metric: 'perfectDays', goal: 1 },
  { key: 'perfect_7', name: 'Flawless Week', desc: 'Get 7 Perfect Days', icon: '💎', bonus: 80, metric: 'perfectDays', goal: 7 },
  { key: 'early_5', name: 'Early Bird', desc: 'Complete 5 quests before 8 AM', icon: '🐦', bonus: 25, metric: 'earlyBird', goal: 5 },
  { key: 'buddy_up', name: 'Buddy Up', desc: 'Team up with an accountability partner', icon: '🤝', bonus: 20, metric: 'partners', goal: 1 },
  { key: 'trusted_5', name: 'Trusted', desc: 'Get 5 quests verified by a partner', icon: '✅', bonus: 30, metric: 'verifiedMine', goal: 5 },
  { key: 'referee_10', name: 'Fair Referee', desc: 'Review 10 partner photos', icon: '🧑‍⚖️', bonus: 30, metric: 'verifiedOthers', goal: 10 },
  { key: 'cheerleader_10', name: 'Cheerleader', desc: 'Send 10 cheers', icon: '📣', bonus: 20, metric: 'cheersSent', goal: 10 },
  { key: 'first_crown', name: 'Crowned!', desc: 'Win your first weekly duel', icon: '👑', bonus: 50, metric: 'crowns', goal: 1 },
  { key: 'crown_3', name: 'Triple Crown', desc: 'Win 3 weekly duels', icon: '🥇', bonus: 100, metric: 'crowns', goal: 3 },
  { key: 'crown_10', name: 'Royalty', desc: 'Win 10 weekly duels', icon: '🏰', bonus: 250, metric: 'crowns', goal: 10 },
  { key: 'dream_team', name: 'Dream Team', desc: 'Reach a duo quest together', icon: '🤜', bonus: 40, metric: 'duoWins', goal: 1 },
  { key: 'dream_team_5', name: 'Dynamic Duo', desc: 'Reach 5 duo quests together', icon: '🦸', bonus: 120, metric: 'duoWins', goal: 5 },
  { key: 'level_5', name: 'Level 5', desc: 'Reach level 5', icon: '⭐', bonus: 25, metric: 'level', goal: 5 },
  { key: 'level_10', name: 'Level 10', desc: 'Reach level 10', icon: '🌟', bonus: 60, metric: 'level', goal: 10 },
  { key: 'level_20', name: 'Level 20', desc: 'Reach level 20', icon: '🌈', bonus: 150, metric: 'level', goal: 20 },
  { key: 'points_1000', name: 'Point Collector', desc: 'Earn 1,000 points', icon: '🪙', bonus: 50, metric: 'points', goal: 1000 }
];

/* ------------------------------------------------------------------ */
/* Route table                                                         */
/* ------------------------------------------------------------------ */

function getGameRoutes_() {
  return {
    'game.home': routeGameHome_,
    'game.trophies': routeGameTrophies_,
    'goals.list': routeGoalsList_,
    'goals.create': routeGoalsCreate_,
    'goals.archive': routeGoalsArchive_,
    'activities.add': routeActivitiesAdd_,
    'activities.archive': routeActivitiesArchive_,
    'completions.begin': routeCompletionsBegin_,
    'completions.submit': routeCompletionsSubmit_,
    'completions.photo': routeCompletionsPhoto_,
    'completions.verify': routeCompletionsVerify_,
    'partners.list': routePartnersList_,
    'partners.invite': routePartnersInvite_,
    'partners.respond': routePartnersRespond_,
    'partners.revoke': routePartnersRevoke_,
    'arena.get': routeArenaGet_,
    'cheers.send': routeCheersSend_
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

function daysLeftInWeek_(key) {
  var p = key.split('-');
  return 6 - ((new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() + 6) % 7);
}

function nameMap_() {
  var m = {};
  readAll_('USERS').forEach(function (u) { m[u.userId] = u.name; });
  return m;
}

function areaOk_(key) { return AREAS.some(function (a) { return a.key === key; }); }

function isArchived_(a) {
  try { return JSON.parse(a.params || '{}').archived === true; } catch (e) { return false; }
}

function isValidComp_(c) { return c.status === 'done' || c.status === 'verified'; }

function addEvent_(userId, type, points, refId, note, dateKey) {
  var dk = dateKey || dateKey_();
  appendObject_('GAME_EVENTS', {
    eventId: newId_('evt'), userId: userId, type: type, points: points, refId: refId || '',
    dateKey: dk, weekKey: weekKey_(dk), createdAt: new Date().toISOString(), note: note || ''
  });
}

/* ------------------------------------------------------------------ */
/* Levels, streaks, stats                                              */
/* ------------------------------------------------------------------ */

/** Level score needed to BE a given level. Level 2 = 30, 5 = 363, 10 = 1566, 20 = 6000 roughly. */
function levelNeed_(L) { return L <= 1 ? 0 : Math.round(30 * Math.pow(L - 1, 1.8)); }

function levelInfo_(score) {
  var L = 1;
  while (L < 99 && score >= levelNeed_(L + 1)) L++;
  var t = LEVEL_TITLES[0];
  LEVEL_TITLES.forEach(function (x) { if (L >= x[0]) t = x; });
  var floor = levelNeed_(L), next = levelNeed_(L + 1);
  return { level: L, title: t[1], icon: t[2], score: score, floor: floor, next: next, pct: Math.min(100, Math.round((score - floor) / (next - floor) * 100)) };
}

function streaks_(days, today) {
  var cur = 0, k = days[today] ? today : addDays_(today, -1);
  while (days[k]) { cur++; k = addDays_(k, -1); }
  var best = 0, run = 0, prev = null;
  Object.keys(days).sort().forEach(function (d) {
    run = (prev && addDays_(prev, 1) === d) ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  });
  return { current: cur, longest: best };
}

function weekScore_(userId, wk) {
  var sum = 0;
  readAll_('GAME_EVENTS').forEach(function (e) {
    if (e.userId === userId && DUEL_TYPES[e.type] && ymd_(e.weekKey) === wk) sum += Number(e.points) || 0;
  });
  return sum;
}

function weekCount_(userId, wk) {
  var end = addDays_(wk, 6), n = 0;
  readAll_('COMPLETIONS').forEach(function (c) {
    if (c.userId !== userId || !isValidComp_(c)) return;
    var d = ymd_(c.scheduledDate);
    if (d >= wk && d <= end) n++;
  });
  return n;
}

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

function buildStats_(userId) {
  var today = dateKey_();
  var valid = readAll_('COMPLETIONS').filter(function (c) { return c.userId === userId && isValidComp_(c); });
  var days = {}, early = 0;
  valid.forEach(function (c) {
    days[ymd_(c.scheduledDate)] = true;
    var d = new Date(c.completedDate);
    if (!isNaN(d.getTime()) && parseInt(Utilities.formatDate(d, tz_(), 'H'), 10) < 8) early++;
  });
  var events = readAll_('GAME_EVENTS').filter(function (e) { return e.userId === userId; });
  var points = 0, perfect = 0, week = 0, wk = weekKey_(today);
  events.forEach(function (e) {
    points += Number(e.points) || 0;
    if (e.type === 'perfect_day') perfect++;
    if (DUEL_TYPES[e.type] && ymd_(e.weekKey) === wk) week += Number(e.points) || 0;
  });
  var goals = readAll_('GOALS').filter(function (g) { return g.userId === userId && g.status === 'active'; });
  var goalIds = {};
  goals.forEach(function (g) { goalIds[g.goalId] = g; });
  var acts = readAll_('ACTIVITIES').filter(function (a) { return a.userId === userId && goalIds[a.goalId] && !isArchived_(a); });
  var crownRows = readAll_('CROWNS');
  var st = streaks_(days, today);
  var regularity = Object.keys(days).length * GAME.LEVEL_PER_ACTIVE_DAY;
  var chart = Math.min(acts.length, GAME.LEVEL_ACTIVITY_CAP) * GAME.LEVEL_PER_ACTIVITY;
  var lv = levelInfo_(Math.max(0, points + regularity + chart));
  return {
    userId: userId, points: points, activeDays: Object.keys(days).length, activities: acts.length, goals: goals.length,
    completions: valid.length, streak: st.current, longestStreak: st.longest, perfectDays: perfect, earlyBird: early,
    partners: acceptedPartnerships_(userId).length,
    crowns: crownRows.filter(function (c) { return c.winnerId === userId; }).length,
    duoWins: crownRows.filter(function (c) { return isTrue_(c.duoReached) && (c.userA === userId || c.userB === userId); }).length,
    cheersSent: readAll_('CHEERS').filter(function (c) { return c.fromId === userId && c.kind === 'cheer'; }).length,
    verifiedMine: valid.filter(function (c) { return c.status === 'verified'; }).length,
    verifiedOthers: readAll_('COMPLETIONS').filter(function (c) { return c.verifiedBy === userId; }).length,
    weekPoints: week, level: lv.level, levelInfo: lv,
    scoreParts: { points: points, regularity: regularity, chart: chart },
    _acts: acts, _goals: goalIds, _valid: valid
  };
}

function heroOf_(s, name) {
  var l = s.levelInfo;
  return {
    name: name, level: l.level, title: l.title, icon: l.icon, score: l.score, floor: l.floor, next: l.next, pct: l.pct,
    points: s.points, streak: s.streak, longestStreak: s.longestStreak, activeDays: s.activeDays, activities: s.activities,
    completions: s.completions, weekPoints: s.weekPoints, crowns: s.crowns, parts: s.scoreParts
  };
}

/** Unlock every achievement whose condition is met. Returns the newly unlocked ones. */
function checkAchievements_(userId) {
  var have = {};
  readAll_('ACHIEVEMENTS').forEach(function (a) { if (a.userId === userId) have[a.achievementKey] = true; });
  var fresh = [];
  for (var pass = 0; pass < 3; pass++) {
    var stats = buildStats_(userId), added = false;
    ACHIEVEMENTS.forEach(function (a) {
      if (have[a.key] || stats[a.metric] < a.goal) return;
      have[a.key] = true; added = true;
      appendObject_('ACHIEVEMENTS', { userId: userId, achievementKey: a.key, unlockedAt: new Date().toISOString() });
      addEvent_(userId, 'achievement', a.bonus, a.key, a.name);
      fresh.push({ key: a.key, name: a.name, desc: a.desc, icon: a.icon, bonus: a.bonus });
    });
    if (!added) break;
  }
  return fresh;
}

/* ------------------------------------------------------------------ */
/* Weekly duels, crowns and duo quests                                 */
/* ------------------------------------------------------------------ */

/** Closes every finished week (Mon-Sun) that has no result yet, for this user's partnerships. */
function settleWeeks_(userId) {
  var parts = acceptedPartnerships_(userId);
  if (!parts.length) return;
  var curWeek = weekKey_(dateKey_());
  var known = readAll_('CROWNS');
  var todo = [];
  parts.forEach(function (p) {
    var first = weekKey_(ymd_(p.respondedDate || p.requestedDate));
    var earliest = addDays_(curWeek, -7 * GAME.HISTORY_WEEKS);
    for (var wk = first > earliest ? first : earliest; wk < curWeek; wk = addDays_(wk, 7)) {
      var done = known.some(function (c) { return c.partnershipId === p.partnershipId && ymd_(c.weekKey) === wk; });
      if (!done) todo.push({ p: p, wk: wk });
    }
  });
  if (!todo.length) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _TABLES = {}; // another request may have settled these while we waited
    var rows = readAll_('CROWNS');
    todo.forEach(function (t) {
      var exists = rows.some(function (c) { return c.partnershipId === t.p.partnershipId && ymd_(c.weekKey) === t.wk; });
      if (exists) return;
      var a = t.p.requesterId, b = t.p.partnerId;
      var sa = weekScore_(a, t.wk), sb = weekScore_(b, t.wk);
      var winner = sa > sb && sa > 0 ? a : (sb > sa && sb > 0 ? b : 'tie');
      var ca = weekCount_(a, t.wk), cb = weekCount_(b, t.wk);
      var duo = ca >= GAME.DUO_MIN_EACH && cb >= GAME.DUO_MIN_EACH && ca + cb >= GAME.DUO_TARGET;
      var id = newId_('crn');
      appendObject_('CROWNS', {
        crownId: id, partnershipId: t.p.partnershipId, weekKey: t.wk, userA: a, userB: b, scoreA: sa, scoreB: sb,
        winnerId: winner, duoReached: duo, settledAt: new Date().toISOString()
      });
      if (winner !== 'tie') addEvent_(winner, 'crown', GAME.CROWN_BONUS, id, 'Weekly duel winner, week of ' + t.wk);
      if (duo) { addEvent_(a, 'duo', GAME.DUO_BONUS, id, 'Duo quest reached'); addEvent_(b, 'duo', GAME.DUO_BONUS, id, 'Duo quest reached'); }
    });
  } finally {
    lock.releaseLock();
  }
}

function duelFor_(p, me, names) {
  var other = otherOf_(p, me), wk = weekKey_(dateKey_());
  var cm = weekCount_(me, wk), co = weekCount_(other, wk);
  var rows = readAll_('CROWNS').filter(function (c) { return c.partnershipId === p.partnershipId; })
    .sort(function (x, y) { return ymd_(y.weekKey) < ymd_(x.weekKey) ? -1 : 1; });
  var ostats = buildStats_(other);
  return {
    partnershipId: p.partnershipId,
    partner: { userId: other, name: names[other] || other, level: ostats.level, title: ostats.levelInfo.title, icon: ostats.levelInfo.icon, streak: ostats.streak },
    week: { key: wk, daysLeft: daysLeftInWeek_(dateKey_()), me: weekScore_(me, wk), them: weekScore_(other, wk) },
    duo: { target: GAME.DUO_TARGET, minEach: GAME.DUO_MIN_EACH, me: cm, them: co, combined: cm + co, bonus: GAME.DUO_BONUS },
    crowns: {
      me: rows.filter(function (c) { return c.winnerId === me; }).length,
      them: rows.filter(function (c) { return c.winnerId === other; }).length
    },
    history: rows.slice(0, 6).map(function (c) {
      var mine = c.userA === me;
      return { weekKey: ymd_(c.weekKey), me: mine ? c.scoreA : c.scoreB, them: mine ? c.scoreB : c.scoreA,
        result: c.winnerId === me ? 'won' : (c.winnerId === 'tie' ? 'tie' : 'lost'), duo: isTrue_(c.duoReached) };
    })
  };
}

/* ------------------------------------------------------------------ */
/* Quests                                                              */
/* ------------------------------------------------------------------ */

function questsFor_(stats) {
  var today = dateKey_(), wk = weekKey_(today), wkEnd = addDays_(wk, 6);
  var anyToday = stats._valid.some(function (c) { return ymd_(c.scheduledDate) === today; });
  var streakAfter = anyToday ? stats.streak : stats.streak + 1;
  var list = stats._acts.map(function (a) {
    var mine = stats._valid.filter(function (c) { return c.activityId === a.activityDefId; });
    var doneToday = mine.some(function (c) { return ymd_(c.scheduledDate) === today; });
    var doneWeek = mine.filter(function (c) { var d = ymd_(c.scheduledDate); return d >= wk && d <= wkEnd; }).length;
    var target = a.frequencyType === 'weekly' ? (Number(a.target) || 1) : 1;
    return {
      activityId: a.activityDefId, goalId: a.goalId, goalTitle: stats._goals[a.goalId].title, name: a.activityName,
      areaKey: a.areaKey, frequencyType: a.frequencyType, target: target, doneToday: doneToday, doneWeek: doneWeek,
      locked: !doneToday && a.frequencyType === 'weekly' && doneWeek >= target,
      points: GAME.BASE_POINTS + (streakAfter > 1 ? Math.min(streakAfter, GAME.STREAK_BONUS_CAP) : 0) + (anyToday ? 0 : GAME.FIRST_OF_DAY)
    };
  });
  var rank = function (q) { return q.doneToday ? 2 : (q.locked ? 1 : 0); };
  return list.sort(function (x, y) { return rank(x) - rank(y); });
}

/** Returns an error message if this activity cannot be completed right now, otherwise ''. */
function cannotComplete_(act, stats) {
  var q = questsFor_(stats).filter(function (x) { return x.activityId === act.activityDefId; })[0];
  if (!q) return 'This activity is not active.';
  if (q.doneToday) return 'You already completed this today.';
  if (q.locked) return 'You already hit this week\'s target for this activity.';
  return '';
}

function ownedActivity_(id, userId) {
  var info = findRow_('ACTIVITIES', 'activityDefId', String(id || ''));
  if (!info || info.obj.userId !== userId || isArchived_(info.obj)) throw new ApiError('NOT_FOUND', 'Activity not found.');
  var goal = findRow_('GOALS', 'goalId', info.obj.goalId);
  if (!goal || goal.obj.status !== 'active') throw new ApiError('NOT_FOUND', 'That goal is no longer active.');
  return info;
}

function routeGameHome_(p, ctx) {
  var me = ctx.user.userId;
  settleWeeks_(me);
  var fresh = checkAchievements_(me);
  var stats = buildStats_(me), names = nameMap_();
  var parts = acceptedPartnerships_(me);
  var quests = questsFor_(stats);
  var today = dateKey_();
  var unseen = readAll_('CHEERS').filter(function (c) { return c.toId === me && !c.seenAt; }).length;
  var incoming = readAll_('ACCOUNTABILITY').filter(function (r) { return r.partnerId === me && r.status === 'pending'; }).length;
  return {
    today: today, hero: heroOf_(stats, names[me] || me), quests: quests, areas: AREAS,
    dailyTotal: quests.filter(function (q) { return q.frequencyType === 'daily'; }).length,
    dailyDone: quests.filter(function (q) { return q.frequencyType === 'daily' && q.doneToday; }).length,
    perfectBonus: GAME.PERFECT_DAY, unseenCheers: unseen, incomingInvites: incoming,
    duels: parts.map(function (x) { var d = duelFor_(x, me, names); return { partner: d.partner.name, me: d.week.me, them: d.week.them, daysLeft: d.week.daysLeft }; }),
    newAchievements: fresh
  };
}

function routeGameTrophies_(p, ctx) {
  var me = ctx.user.userId;
  settleWeeks_(me);
  checkAchievements_(me);
  var stats = buildStats_(me), names = nameMap_();
  var got = {};
  readAll_('ACHIEVEMENTS').forEach(function (a) { if (a.userId === me) got[a.achievementKey] = iso_(a.unlockedAt); });
  var crowns = readAll_('CROWNS').filter(function (c) { return c.winnerId === me; })
    .map(function (c) { return { weekKey: ymd_(c.weekKey), partner: names[c.userA === me ? c.userB : c.userA] || '' }; })
    .sort(function (x, y) { return x.weekKey < y.weekKey ? 1 : -1; });
  var recent = readAll_('GAME_EVENTS').filter(function (e) { return e.userId === me; })
    .sort(function (x, y) { return ts_(y.createdAt) - ts_(x.createdAt); }).slice(0, 15)
    .map(function (e) { return { type: e.type, points: Number(e.points) || 0, note: e.note, at: iso_(e.createdAt) }; });
  return {
    hero: heroOf_(stats, names[me] || me),
    achievements: ACHIEVEMENTS.map(function (a) {
      return { key: a.key, name: a.name, desc: a.desc, icon: a.icon, bonus: a.bonus, goal: a.goal,
        value: Math.min(stats[a.metric], a.goal), unlockedAt: got[a.key] || null };
    }),
    crowns: crowns, recent: recent
  };
}

/* ------------------------------------------------------------------ */
/* Goals and activities                                                */
/* ------------------------------------------------------------------ */

function routeGoalsList_(p, ctx) {
  var me = ctx.user.userId;
  var acts = readAll_('ACTIVITIES').filter(function (a) { return a.userId === me && !isArchived_(a); });
  var goals = readAll_('GOALS').filter(function (g) { return g.userId === me && g.status === 'active'; }).map(function (g) {
    return {
      goalId: g.goalId, title: g.title, durationMonths: g.durationMonths, startDate: ymd_(g.startDate), endDate: ymd_(g.endDate),
      activities: acts.filter(function (a) { return a.goalId === g.goalId; }).map(function (a) {
        return { activityId: a.activityDefId, name: a.activityName, areaKey: a.areaKey, frequencyType: a.frequencyType, target: Number(a.target) || 1 };
      })
    };
  });
  return { goals: goals, areas: AREAS, nameMax: parseInt(getSetting_('others_name_max_length', '60'), 10) || 60 };
}

function routeGoalsCreate_(p, ctx) {
  var me = ctx.user.userId;
  var title = String(p.title || '').trim().slice(0, 80);
  var months = parseInt(p.durationMonths, 10);
  if (!title) throw new ApiError('BAD_REQUEST', 'Give your goal a title.');
  if (!(months >= 1 && months <= 24)) throw new ApiError('BAD_REQUEST', 'Duration must be 1 to 24 months.');
  var active = readAll_('GOALS').filter(function (g) { return g.userId === me && g.status === 'active'; }).length;
  if (active >= GAME.MAX_ACTIVE_GOALS) throw new ApiError('LIMIT', 'You can have up to ' + GAME.MAX_ACTIVE_GOALS + ' active goals.');
  var today = dateKey_(), q = today.split('-');
  var id = newId_('goal');
  appendObject_('GOALS', {
    goalId: id, userId: me, title: title, durationMonths: months, startDate: today,
    endDate: new Date(Date.UTC(+q[0], +q[1] - 1 + months, +q[2])).toISOString().slice(0, 10), status: 'active', createdDate: new Date().toISOString()
  });
  return { goalId: id, newAchievements: checkAchievements_(me) };
}

function routeGoalsArchive_(p, ctx) {
  var info = findRow_('GOALS', 'goalId', String(p.goalId || ''));
  if (!info || info.obj.userId !== ctx.user.userId) throw new ApiError('NOT_FOUND', 'Goal not found.');
  updateRow_(info, { status: 'archived' });
  return { archived: true };
}

function routeActivitiesAdd_(p, ctx) {
  var me = ctx.user.userId;
  var goal = findRow_('GOALS', 'goalId', String(p.goalId || ''));
  if (!goal || goal.obj.userId !== me || goal.obj.status !== 'active') throw new ApiError('NOT_FOUND', 'Goal not found.');
  var area = String(p.areaKey || '');
  if (!areaOk_(area)) throw new ApiError('BAD_REQUEST', 'Pick a life area.');
  var max = parseInt(getSetting_('others_name_max_length', '60'), 10) || 60;
  var name = String(p.activityName || '').trim();
  if (!name) throw new ApiError('BAD_REQUEST', 'Enter a name for the activity.');
  if (name.length > max) throw new ApiError('BAD_REQUEST', 'Activity names can be up to ' + max + ' characters.');
  var freq = p.frequencyType === 'weekly' ? 'weekly' : 'daily';
  var target = freq === 'weekly' ? parseInt(p.target, 10) : 1;
  if (!(target >= 1 && target <= 7)) throw new ApiError('BAD_REQUEST', 'Weekly target must be 1 to 7.');
  var key = /^[a-z0-9_]{1,30}$/.test(String(p.activityKey || '')) ? String(p.activityKey) : 'others';
  var count = readAll_('ACTIVITIES').filter(function (a) { return a.userId === me && !isArchived_(a); }).length;
  if (count >= GAME.MAX_ACTIVITIES) throw new ApiError('LIMIT', 'You can have up to ' + GAME.MAX_ACTIVITIES + ' activities.');

  var id = newId_('act');
  appendObject_('ACTIVITIES', {
    activityDefId: id, goalId: goal.obj.goalId, userId: me, areaKey: area, activityKey: key, activityName: name,
    frequencyType: freq, target: target, params: '{}', createdDate: new Date().toISOString()
  });
  var linked = readAll_('GOAL_AREAS').some(function (r) { return r.goalId === goal.obj.goalId && r.areaKey === area; });
  if (!linked) appendObject_('GOAL_AREAS', { goalAreaId: newId_('ga'), goalId: goal.obj.goalId, areaKey: area });
  return { activityId: id, newAchievements: checkAchievements_(me) };
}

function routeActivitiesArchive_(p, ctx) {
  var info = findRow_('ACTIVITIES', 'activityDefId', String(p.activityId || ''));
  if (!info || info.obj.userId !== ctx.user.userId) throw new ApiError('NOT_FOUND', 'Activity not found.');
  updateRow_(info, { params: JSON.stringify({ archived: true }) });
  return { archived: true };
}

/* ------------------------------------------------------------------ */
/* Completing a quest (live photo + points)                            */
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

/** Step 1: the app asks for a one-time code, prints it on the photo, then submits. */
function routeCompletionsBegin_(p, ctx) {
  var me = ctx.user.userId;
  var act = ownedActivity_(p.activityId, me);
  var why = cannotComplete_(act.obj, buildStats_(me));
  if (why) throw new ApiError('NOT_ALLOWED', why);
  purgeChallenges_();
  var now = Date.now(), code = newChallengeCode_();
  appendObject_('CHALLENGES', { code: code, userId: me, activityId: act.obj.activityDefId, createdAt: now, expiresAt: now + GAME.CHALLENGE_MINUTES * 60000, used: false });
  return { code: code, expiresAt: now + GAME.CHALLENGE_MINUTES * 60000, serverTime: new Date(now).toISOString(), activityName: act.obj.activityName };
}

function checkPhoto_(photo) {
  if (!photo || typeof photo.base64 !== 'string' || !photo.base64) throw new ApiError('PHOTO_REQUIRED', 'A live photo is required to complete this quest.');
  if (photo.mime !== 'image/jpeg') throw new ApiError('BAD_PHOTO', 'The photo must be a JPEG.');
  var bytes;
  try { bytes = Utilities.base64Decode(photo.base64); } catch (e) { throw new ApiError('BAD_PHOTO', 'The photo could not be read.'); }
  var maxKb = parseInt(getSetting_('max_photo_kb', '1500'), 10) || 1500;
  if (bytes.length > maxKb * 1024) throw new ApiError('PHOTO_TOO_BIG', 'The photo is too large (max ' + maxKb + ' KB).');
  if (bytes.length < 100 || (bytes[0] & 255) !== 255 || (bytes[1] & 255) !== 216) throw new ApiError('BAD_PHOTO', 'The photo could not be read.');
  return bytes;
}

/** Step 2: save the photo, award points, check perfect day and achievements. */
function routeCompletionsSubmit_(p, ctx) {
  var me = ctx.user.userId;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _TABLES = {};
    return submitCompletion_(p, me, ctx.user.name);
  } finally {
    lock.releaseLock();
  }
}

function submitCompletion_(p, me, myName) {
  var act = ownedActivity_(p.activityId, me).obj;
  var before = buildStats_(me);
  var why = cannotComplete_(act, before);
  if (why) throw new ApiError('NOT_ALLOWED', why);

  var ch = findRow_('CHALLENGES', 'code', String(p.code || ''));
  if (!ch || ch.obj.userId !== me || ch.obj.activityId !== act.activityDefId) throw new ApiError('BAD_CODE', 'This photo was not taken for this quest. Start again.');
  if (isTrue_(ch.obj.used)) throw new ApiError('BAD_CODE', 'This photo code was already used. Take a new photo.');
  if (Number(ch.obj.expiresAt) < Date.now()) throw new ApiError('CODE_EXPIRED', 'That took too long. Start again and take the photo within ' + GAME.CHALLENGE_MINUTES + ' minutes.');
  var photo = p.photo || {};
  var bytes = checkPhoto_(photo);

  var today = dateKey_(), id = newId_('cmp');
  var source = photo.source === 'live' ? 'live' : 'camera-app';
  var folderId = JSON.parse(PropertiesService.getScriptProperties().getProperty('FOLDER_IDS'))['Completion Photos'];
  var file = DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(bytes, 'image/jpeg', me + '_' + today + '_' + id + '.jpg'));

  var anyToday = before._valid.some(function (c) { return ymd_(c.scheduledDate) === today; });
  var streak = anyToday ? before.streak : before.streak + 1;
  var breakdown = [{ label: 'Quest complete', points: GAME.BASE_POINTS }];
  if (streak > 1) breakdown.push({ label: streak + '-day streak', points: Math.min(streak, GAME.STREAK_BONUS_CAP) });
  if (!anyToday) breakdown.push({ label: 'First quest today', points: GAME.FIRST_OF_DAY });
  var total = breakdown.reduce(function (s, b) { return s + b.points; }, 0);

  appendObject_('COMPLETIONS', {
    completionId: id, activityId: act.activityDefId, goalId: act.goalId, userId: me, scheduledDate: today,
    completedDate: new Date().toISOString(), status: 'done', notes: String(p.notes || '').slice(0, 200),
    photoFileId: file.getId(), photoTakenAt: String(photo.takenAt || '').slice(0, 40), photoMime: 'image/jpeg',
    photoSizeKb: Math.round(bytes.length / 1024), points: total, photoSource: source, challengeCode: ch.obj.code
  });
  updateRow_(ch, { used: true });
  addEvent_(me, 'completion', total, id, act.activityName);

  // Perfect Day: all daily quests done (needs at least two)
  var perfect = false;
  var after = buildStats_(me);
  var dailies = questsFor_(after).filter(function (q) { return q.frequencyType === 'daily'; });
  var already = readAll_('GAME_EVENTS').some(function (e) { return e.userId === me && e.type === 'perfect_day' && ymd_(e.dateKey) === today; });
  if (dailies.length >= 2 && !already && dailies.every(function (q) { return q.doneToday; })) {
    perfect = true;
    breakdown.push({ label: 'Perfect Day', points: GAME.PERFECT_DAY });
    addEvent_(me, 'perfect_day', GAME.PERFECT_DAY, id, 'All daily quests done');
  }
  var fresh = checkAchievements_(me);
  var final = buildStats_(me);
  log_('INFO', 'completions.submit', act.activityName + ' +' + total, me);
  return {
    completionId: id, breakdown: breakdown, earned: breakdown.reduce(function (s, b) { return s + b.points; }, 0),
    perfectDay: perfect, newAchievements: fresh,
    levelBefore: before.level, levelAfter: final.level, hero: heroOf_(final, myName)
  };
}

/** Owner and accepted partners can fetch a completion photo. */
function routeCompletionsPhoto_(p, ctx) {
  var me = ctx.user.userId;
  var info = findRow_('COMPLETIONS', 'completionId', String(p.completionId || ''));
  if (!info || !info.obj.photoFileId) throw new ApiError('NOT_FOUND', 'Photo not found.');
  if (info.obj.userId !== me && !arePartners_(me, info.obj.userId)) throw new ApiError('FORBIDDEN', 'You cannot view this photo.');
  var blob = DriveApp.getFileById(info.obj.photoFileId).getBlob();
  return { base64: Utilities.base64Encode(blob.getBytes()), mime: 'image/jpeg' };
}

/** A partner confirms (or rejects) a photo. Rejecting takes the points back. */
function routeCompletionsVerify_(p, ctx) {
  var me = ctx.user.userId, names = nameMap_();
  var verdict = p.verdict === 'flagged' ? 'flagged' : (p.verdict === 'verified' ? 'verified' : '');
  if (!verdict) throw new ApiError('BAD_REQUEST', 'Choose verify or not convincing.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _TABLES = {};
    var info = findRow_('COMPLETIONS', 'completionId', String(p.completionId || ''));
    if (!info) throw new ApiError('NOT_FOUND', 'Completion not found.');
    var c = info.obj;
    if (c.userId === me || !arePartners_(me, c.userId)) throw new ApiError('FORBIDDEN', 'You can only review your partner\'s photos.');
    if (c.status !== 'done') throw new ApiError('ALREADY_REVIEWED', 'This one was already reviewed.');
    updateRow_(info, { status: verdict, verifiedBy: me, verifiedAt: new Date().toISOString() });
    if (verdict === 'verified') {
      addEvent_(c.userId, 'verified', GAME.VERIFY_BONUS, c.completionId, 'Verified by ' + (names[me] || me));
      addEvent_(me, 'referee', GAME.REFEREE_POINTS, c.completionId, 'Reviewed a partner photo');
    } else {
      addEvent_(c.userId, 'flagged', -(Number(c.points) || 0), c.completionId, 'Photo not accepted by ' + (names[me] || me), ymd_(c.scheduledDate));
    }
    checkAchievements_(c.userId);
    return { status: verdict, newAchievements: checkAchievements_(me) };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Accountability partners                                             */
/* ------------------------------------------------------------------ */

function partnersView_(me) {
  var names = nameMap_(), rows = readAll_('ACCOUNTABILITY');
  var mk = function (r, other) { return { partnershipId: r.partnershipId, userId: other, name: names[other] || other, date: ymd_(r.respondedDate || r.requestedDate) }; };
  return {
    partners: rows.filter(function (r) { return r.status === 'accepted' && (r.requesterId === me || r.partnerId === me); }).map(function (r) { return mk(r, otherOf_(r, me)); }),
    incoming: rows.filter(function (r) { return r.status === 'pending' && r.partnerId === me; }).map(function (r) { return mk(r, r.requesterId); }),
    outgoing: rows.filter(function (r) { return r.status === 'pending' && r.requesterId === me; }).map(function (r) { return mk(r, r.partnerId); })
  };
}

function routePartnersList_(p, ctx) { return partnersView_(ctx.user.userId); }

function routePartnersInvite_(p, ctx) {
  var me = ctx.user.userId, to = normId_(p.userId);
  var target = findRow_('USERS', 'userId', to);
  if (!target || target.obj.status !== 'active' || target.obj.role === 'developer' || to === me) throw new ApiError('NOT_FOUND', 'That person is not available.');
  var clash = readAll_('ACCOUNTABILITY').some(function (r) {
    return (r.status === 'pending' || r.status === 'accepted') && ((r.requesterId === me && r.partnerId === to) || (r.requesterId === to && r.partnerId === me));
  });
  if (clash) throw new ApiError('EXISTS', 'You already have a partnership or a pending invite with this person.');
  appendObject_('ACCOUNTABILITY', { partnershipId: newId_('ptn'), requesterId: me, partnerId: to, goalId: '', status: 'pending', requestedDate: new Date().toISOString() });
  return partnersView_(me);
}

function routePartnersRespond_(p, ctx) {
  var me = ctx.user.userId;
  var info = findRow_('ACCOUNTABILITY', 'partnershipId', String(p.partnershipId || ''));
  if (!info || info.obj.partnerId !== me || info.obj.status !== 'pending') throw new ApiError('NOT_FOUND', 'Invite not found.');
  var accept = p.accept === true;
  updateRow_(info, { status: accept ? 'accepted' : 'declined', respondedDate: new Date().toISOString() });
  var fresh = [];
  if (accept) { checkAchievements_(info.obj.requesterId); fresh = checkAchievements_(me); }
  return { view: partnersView_(me), newAchievements: fresh };
}

/** Either person can end a partnership; the requester can also withdraw a pending invite. */
function routePartnersRevoke_(p, ctx) {
  var me = ctx.user.userId;
  var info = findRow_('ACCOUNTABILITY', 'partnershipId', String(p.partnershipId || ''));
  var r = info && info.obj;
  var mine = r && (r.requesterId === me || r.partnerId === me);
  var okState = r && ((r.status === 'accepted') || (r.status === 'pending' && r.requesterId === me));
  if (!mine || !okState) throw new ApiError('NOT_FOUND', 'Partnership not found.');
  updateRow_(info, { status: 'revoked', respondedDate: new Date().toISOString() });
  return partnersView_(me);
}

/* ------------------------------------------------------------------ */
/* Arena: duels, leaderboard, verification feed, cheers                */
/* ------------------------------------------------------------------ */

function routeArenaGet_(p, ctx) {
  var me = ctx.user.userId;
  settleWeeks_(me);
  var fresh = checkAchievements_(me);
  var names = nameMap_(), today = dateKey_(), wk = weekKey_(today);
  var parts = acceptedPartnerships_(me);
  var duels = parts.map(function (x) { return duelFor_(x, me, names); });
  var ids = parts.map(function (x) { return otherOf_(x, me); });

  var board = [{ userId: me, name: names[me] || me, points: weekScore_(me, wk), isMe: true }]
    .concat(ids.map(function (id) { return { userId: id, name: names[id] || id, points: weekScore_(id, wk), isMe: false }; }))
    .sort(function (x, y) { return y.points - x.points; });

  var actName = {};
  readAll_('ACTIVITIES').forEach(function (a) { actName[a.activityDefId] = a.activityName; });
  var since = addDays_(today, -14);
  var feed = readAll_('COMPLETIONS').filter(function (c) { return ids.indexOf(c.userId) !== -1 && ymd_(c.scheduledDate) >= since; })
    .sort(function (x, y) { return ts_(y.completedDate) - ts_(x.completedDate); }).slice(0, 30)
    .map(function (c) {
      return { completionId: c.completionId, userId: c.userId, name: names[c.userId] || c.userId, activity: actName[c.activityId] || 'Quest',
        date: ymd_(c.scheduledDate), status: c.status, points: Number(c.points) || 0, code: c.challengeCode, source: c.photoSource,
        takenAt: iso_(c.photoTakenAt), notes: c.notes || '', canReview: c.status === 'done' };
    });

  var inbox = readAll_('CHEERS').filter(function (c) { return c.toId === me; })
    .sort(function (x, y) { return ts_(y.createdAt) - ts_(x.createdAt); }).slice(0, 10);
  var cheers = inbox.map(function (c) { return { from: names[c.fromId] || c.fromId, kind: c.kind, emoji: c.emoji, at: iso_(c.createdAt), isNew: !c.seenAt }; });
  inbox.filter(function (c) { return !c.seenAt; }).forEach(function (c) {
    var row = findRow_('CHEERS', 'cheerId', c.cheerId);
    if (row) updateRow_(row, { seenAt: new Date().toISOString() });
  });

  var stats = buildStats_(me);
  return {
    hero: heroOf_(stats, names[me] || me), duels: duels, board: board, feed: feed, cheers: cheers,
    invites: partnersView_(me), cheerEmojis: CHEER_EMOJIS, directoryHint: true,
    rules: { crown: GAME.CROWN_BONUS, duo: GAME.DUO_BONUS, verify: GAME.VERIFY_BONUS, referee: GAME.REFEREE_POINTS },
    newAchievements: fresh
  };
}

function routeCheersSend_(p, ctx) {
  var me = ctx.user.userId, to = normId_(p.toUserId);
  if (!arePartners_(me, to)) throw new ApiError('FORBIDDEN', 'You can only cheer your accountability partners.');
  var kind = p.kind === 'nudge' ? 'nudge' : 'cheer';
  var emoji = kind === 'nudge' ? '👋' : String(p.emoji || '');
  if (CHEER_EMOJIS.indexOf(emoji) === -1 && kind === 'cheer') throw new ApiError('BAD_REQUEST', 'Pick one of the cheer emojis.');
  var all = readAll_('CHEERS').filter(function (c) { return c.fromId === me; });
  var now = Date.now(), today = dateKey_();
  if (kind === 'nudge' && all.some(function (c) { return c.toId === to && c.kind === 'nudge' && now - ts_(c.createdAt) < GAME.NUDGE_HOURS * 3600000; })) {
    throw new ApiError('RATE_LIMITED', 'You nudged them recently. Give it a few hours.');
  }
  var sentToday = all.filter(function (c) { return dateKey_(new Date(c.createdAt)) === today; });
  if (sentToday.length >= GAME.CHEERS_PER_DAY) throw new ApiError('RATE_LIMITED', 'That is plenty of cheering for today!');
  appendObject_('CHEERS', { cheerId: newId_('chr'), fromId: me, toId: to, kind: kind, emoji: emoji, refId: String(p.refId || '').slice(0, 40), createdAt: new Date().toISOString() });
  var earned = 0;
  if (kind === 'cheer' && sentToday.filter(function (c) { return c.kind === 'cheer'; }).length < GAME.CHEER_POINTS_PER_DAY) {
    earned = GAME.CHEER_POINTS;
    addEvent_(me, 'cheer', earned, '', 'Cheered a partner');
  }
  return { sent: true, earned: earned, newAchievements: checkAchievements_(me) };
}
