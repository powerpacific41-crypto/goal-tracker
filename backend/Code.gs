/**
 * GOAL TRACKER - Google Apps Script backend
 * Phase 1: project structure, schema, Drive/Sheets bootstrap, API router.
 * Phase 3 (game layer) lives in Game.gs; its sheets and routes are registered here.
 *
 * Run setup() ONCE from the editor, then deploy as a Web App.
 * The browser only ever talks to doPost()/doGet(); Sheet and Drive IDs
 * live in Script Properties and are never sent to the client.
 */

var APP = {
  VERSION: '0.3.0-phase3',
  ROOT_FOLDER: 'GOAL TRACKER',
  SUBFOLDERS: ['Database', 'User Data', 'Goals', 'Reports', 'Completion Photos'],
  DB_NAME: 'Goal Tracker DB'
};

/**
 * Database schema. Each sheet is a flat table; the first row is the header.
 * New life areas/activities need NO schema change: they are rows of data,
 * and per-activity options live in the JSON `params` column.
 */
var SCHEMA = {
  USERS: ['userId', 'name', 'passwordHash', 'salt', 'role', 'status', 'createdDate', 'lastLogin', 'googleEmail', 'mustChangePassword'],
  GOALS: ['goalId', 'userId', 'title', 'durationMonths', 'startDate', 'endDate', 'status', 'createdDate'],
  GOAL_AREAS: ['goalAreaId', 'goalId', 'areaKey'],
  ACTIVITIES: ['activityDefId', 'goalId', 'userId', 'areaKey', 'activityKey', 'activityName', 'frequencyType', 'target', 'params', 'createdDate'],
  ACTIVITY_INSTANCES: ['activityId', 'goalId', 'userId', 'activityName', 'category', 'frequency', 'target',
    'periodStart', 'periodEnd', 'assignedDate', 'latestDate', 'status', 'completedDate', 'completionNotes'],
  ACTIVITY_LOG: ['logId', 'timestamp', 'userId', 'level', 'action', 'details'],
  // photoFileId points to a PRIVATE Drive file in 'Completion Photos'. A completed row must have one.
  COMPLETIONS: ['completionId', 'activityId', 'goalId', 'userId', 'scheduledDate', 'completedDate', 'status', 'notes',
    'photoFileId', 'photoTakenAt', 'photoMime', 'photoSizeKb',
    // Phase 3 (game): points earned, how the photo was captured (live | camera-app), the one-time code
    // printed on the photo, and the partner's verdict. status: done | verified | flagged
    'points', 'photoSource', 'challengeCode', 'verifiedBy', 'verifiedAt'],
  // status: pending | accepted | declined | revoked. goalId empty = partner for all of requester's goals.
  ACCOUNTABILITY: ['partnershipId', 'requesterId', 'partnerId', 'goalId', 'status', 'requestedDate', 'respondedDate', 'note'],
  SESSIONS: ['sessionId', 'userId', 'role', 'tokenHash', 'createdAt', 'expiresAt', 'revoked'],
  SETTINGS: ['key', 'value', 'description'],
  // Phase 3 (game). GAME_EVENTS is the points ledger: XP, weekly duels and levels are all sums over it.
  GAME_EVENTS: ['eventId', 'userId', 'type', 'points', 'refId', 'dateKey', 'weekKey', 'createdAt', 'note'],
  ACHIEVEMENTS: ['userId', 'achievementKey', 'unlockedAt'],
  // One row per partnership per finished week (Monday to Sunday). winnerId is a userId or 'tie'.
  CROWNS: ['crownId', 'partnershipId', 'weekKey', 'userA', 'userB', 'scoreA', 'scoreB', 'winnerId', 'duoReached', 'settledAt'],
  CHEERS: ['cheerId', 'fromId', 'toId', 'kind', 'emoji', 'refId', 'createdAt', 'seenAt'],
  // Short-lived one-time codes that get printed on completion photos (proof the photo is fresh).
  CHALLENGES: ['code', 'userId', 'activityId', 'createdAt', 'expiresAt', 'used']
};

var DEFAULT_SETTINGS = [
  ['app_version', APP.VERSION, 'Backend version'],
  ['session_ttl_hours', '12', 'How long a login session stays valid'],
  ['min_password_length', '8', 'Minimum password length for new passwords'],
  ['others_name_max_length', '60', 'Max characters for a custom activity name (activity type "Others")'],
  ['max_photo_kb', '1500', 'Largest completion photo accepted (after client-side compression)'],
  ['max_failed_logins', '5', 'Failed logins before an account is locked for a while'],
  ['lockout_minutes', '15', 'How long a locked account must wait (max 360)'],
  ['google_client_id', '', 'OAuth Web client ID for Sign in with Google (leave empty to disable)']
];

/* ------------------------------------------------------------------ */
/* One-time setup (run manually from the Apps Script editor)           */
/* ------------------------------------------------------------------ */

function setup() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();

    // Drive folders
    var root = getOrCreateFolder_(DriveApp.getRootFolder(), APP.ROOT_FOLDER);
    var folderIds = { root: root.getId() };
    APP.SUBFOLDERS.forEach(function (name) {
      folderIds[name] = getOrCreateFolder_(root, name).getId();
    });
    props.setProperty('FOLDER_IDS', JSON.stringify(folderIds));

    // Spreadsheet inside GOAL TRACKER/Database
    var ssId = props.getProperty('DB_SPREADSHEET_ID');
    var ss;
    if (ssId) {
      ss = SpreadsheetApp.openById(ssId);
    } else {
      ss = SpreadsheetApp.create(APP.DB_NAME);
      DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(folderIds['Database']));
      props.setProperty('DB_SPREADSHEET_ID', ss.getId());
    }

    // Sheets + headers (idempotent; adds missing columns on re-run)
    Object.keys(SCHEMA).forEach(function (name) {
      var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
      ensureHeaders_(sheet, SCHEMA[name]);
    });
    var blank = ss.getSheetByName('Sheet1');
    if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

    // Default settings (only inserts keys that are missing)
    var settings = ss.getSheetByName('SETTINGS');
    var existing = settings.getLastRow() > 1
      ? settings.getRange(2, 1, settings.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; })
      : [];
    DEFAULT_SETTINGS.forEach(function (row) {
      if (existing.indexOf(row[0]) === -1) settings.appendRow(row);
    });

    // Keep the stored version in step with the code
    var verRow = findRow_('SETTINGS', 'key', 'app_version');
    if (verRow) updateRow_(verRow, { value: APP.VERSION });

    // Phase 2: first-run developer and admin accounts (temporary passwords, shown once)
    var created = ensureSeedAccounts_();
    created.forEach(function (c) {
      Logger.log('CREATED ACCOUNT  username: ' + c.userId + '   temporary password: ' + c.tempPassword + '   (you must change it at first login)');
    });

    log_('INFO', 'setup', 'Setup completed (' + APP.VERSION + ')', 'system');
    Logger.log('Setup complete. Spreadsheet: ' + ss.getUrl());
    return { spreadsheetUrl: ss.getUrl(), folderUrl: root.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    headers.forEach(function (h) {
      if (current.indexOf(h) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(h);
      }
    });
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
}

/* ------------------------------------------------------------------ */
/* Data helpers (used by every later phase)                            */
/* ------------------------------------------------------------------ */

var _DB = null;      // spreadsheet handle, reused within one request
var _TABLES = {};    // table cache, reused within one request and dropped on any write

function db_() {
  if (_DB) return _DB;
  var id = PropertiesService.getScriptProperties().getProperty('DB_SPREADSHEET_ID');
  if (!id) throw new ApiError('NOT_SET_UP', 'Backend is not set up. Run setup() in the Apps Script editor.');
  _DB = SpreadsheetApp.openById(id);
  return _DB;
}

function sheet_(name) {
  var s = db_().getSheetByName(name);
  if (!s) throw new ApiError('MISSING_SHEET', 'Sheet ' + name + ' is missing. Run setup() again.');
  return s;
}

/** Read a whole table as an array of objects. */
function readAll_(name) {
  if (_TABLES[name]) return _TABLES[name];
  var s = sheet_(name);
  var last = s.getLastRow();
  if (last < 2) return (_TABLES[name] = []);
  var values = s.getRange(1, 1, last, s.getLastColumn()).getValues();
  var headers = values.shift();
  return (_TABLES[name] = values.map(function (row) {
    var o = {};
    headers.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  }));
}

/** Append one object as a row, respecting the sheet's header order. */
function appendObject_(name, obj) {
  delete _TABLES[name];
  var s = sheet_(name);
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  s.appendRow(headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

/** Find the first row whose column `col` equals `value` (exact match). Returns null or a handle. */
function findRow_(name, col, value) {
  var s = sheet_(name);
  var last = s.getLastRow();
  if (last < 2) return null;
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var c = headers.indexOf(col);
  if (c === -1) return null;
  var colValues = s.getRange(2, c + 1, last - 1, 1).getValues();
  for (var i = 0; i < colValues.length; i++) {
    if (String(colValues[i][0]) === String(value)) {
      var row = s.getRange(i + 2, 1, 1, headers.length).getValues()[0];
      var obj = {};
      headers.forEach(function (h, k) { obj[h] = row[k]; });
      return { sheet: s, row: i + 2, headers: headers, obj: obj };
    }
  }
  return null;
}

/** Update named columns of a row found with findRow_. */
function updateRow_(info, changes) {
  delete _TABLES[info.sheet.getName()];
  Object.keys(changes).forEach(function (k) {
    var c = info.headers.indexOf(k);
    if (c !== -1) info.sheet.getRange(info.row, c + 1).setValue(changes[k]);
    info.obj[k] = changes[k];
  });
}

function getSetting_(key, fallback) {
  var r = findRow_('SETTINGS', 'key', key);
  return r && r.obj.value !== '' ? String(r.obj.value) : fallback;
}

function newId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function log_(level, action, details, userId) {
  try {
    appendObject_('ACTIVITY_LOG', {
      logId: newId_('log'),
      timestamp: new Date().toISOString(),
      userId: userId || 'anonymous',
      level: level,
      action: action,
      details: String(details || '').slice(0, 2000)
    });
  } catch (e) {
    console.error('log_ failed: ' + e);
  }
}

/* ------------------------------------------------------------------ */
/* API router                                                          */
/* ------------------------------------------------------------------ */

function ApiError(code, message) {
  this.code = code;
  this.message = message;
}

/**
 * Route table, built on demand because handlers live in Auth.gs (Apps Script
 * evaluates files in order, so a top-level table could not see them yet).
 * `roles` lists who may call the action; 'public' needs no login.
 * `allowWhileMustChange` lets an account with a temporary password reach the action.
 */
function getRoutes_() {
  var ALL = ['user', 'admin', 'developer'];
  var STAFF = ['admin', 'developer'];
  var routes = {
    'system.ping':         { roles: ['public'], handler: routePing_ },
    'system.health':       { roles: ['developer'], handler: routeHealth_ },
    'auth.config':         { roles: ['public'], handler: routeAuthConfig_ },
    'auth.login':          { roles: ['public'], handler: routeLogin_ },
    'auth.googleLogin':    { roles: ['public'], handler: routeGoogleLogin_ },
    'auth.me':             { roles: ALL, handler: routeMe_, allowWhileMustChange: true },
    'auth.logout':         { roles: ALL, handler: routeLogout_, allowWhileMustChange: true },
    'auth.changePassword': { roles: ALL, handler: routeChangePassword_, allowWhileMustChange: true },
    'auth.linkGoogle':     { roles: ALL, handler: routeLinkGoogle_ },
    'auth.unlinkGoogle':   { roles: ALL, handler: routeUnlinkGoogle_ },
    'users.directory':     { roles: ALL, handler: routeUsersDirectory_ },
    'users.list':          { roles: STAFF, handler: routeUsersList_ },
    'users.create':        { roles: STAFF, handler: routeUsersCreate_ },
    'users.setStatus':     { roles: STAFF, handler: routeUsersSetStatus_ },
    'users.resetPassword': { roles: STAFF, handler: routeUsersResetPassword_ }
  };
  // Phase 3: goals, quests, points, achievements, partners, arena (handlers in Game.gs)
  var game = getGameRoutes_();
  Object.keys(game).forEach(function (k) { routes[k] = { roles: ALL, handler: game[k] }; });
  return routes;
}

function doGet() {
  return json_(ok_({ service: 'Goal Tracker API', version: APP.VERSION, message: 'Use POST for API calls.' }));
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_(fail_('BAD_REQUEST', 'Request body must be valid JSON.'));
  }

  var routes = getRoutes_();
  var route = req && typeof req.action === 'string' && routes.hasOwnProperty(req.action) ? routes[req.action] : null;
  if (!route) return json_(fail_('UNKNOWN_ACTION', 'Unknown action: ' + (req && req.action)));

  try {
    var ctx = authorize_(route, req);
    var data = route.handler(req.payload || {}, ctx);
    return json_(ok_(data));
  } catch (err) {
    if (err instanceof ApiError) return json_(fail_(err.code, err.message));
    log_('ERROR', String(req.action), err && err.stack ? err.stack : err, 'system');
    return json_(fail_('SERVER_ERROR', 'Something went wrong on the server. Try again.'));
  }
}

function ok_(data) { return { ok: true, data: data, error: null, ts: new Date().toISOString() }; }
function fail_(code, message) { return { ok: false, data: null, error: { code: code, message: message }, ts: new Date().toISOString() }; }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Phase 1 handlers                                                    */
/* ------------------------------------------------------------------ */

function routePing_() {
  return { pong: true, version: APP.VERSION };
}

function routeHealth_() {
  var ss = db_();
  var tables = {};
  Object.keys(SCHEMA).forEach(function (name) {
    var s = ss.getSheetByName(name);
    tables[name] = s ? Math.max(s.getLastRow() - 1, 0) : null; // null = missing
  });
  var missing = Object.keys(tables).filter(function (n) { return tables[n] === null; });
  return { version: APP.VERSION, healthy: missing.length === 0, missing: missing, rowCounts: tables };
}
