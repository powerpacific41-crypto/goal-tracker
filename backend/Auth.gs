/**
 * GOAL TRACKER - Phase 2: authentication, sessions, user management.
 *
 * - Passwords: PBKDF2-HMAC-SHA256 with a per-user salt. Plain passwords are never stored or logged.
 * - Sessions: random 244-bit token sent to the browser; only its SHA-256 hash is stored.
 * - Brute force: failed logins are counted per username (CacheService) and lock the account for a while.
 * - Google sign-in: the browser sends a Google ID token; the server verifies it with Google and
 *   only accepts an email that an existing account has linked.
 */

var AUTH = {
  PBKDF2_ITERATIONS: 1000,            // stored inside each hash, so it can be raised later
  MAX_PASSWORD_LENGTH: 200,
  USERNAME_RE: /^[a-z][a-z0-9._-]{2,29}$/,
  ROLES: ['user', 'admin', 'developer'],
  TEMP_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  SEEDS: [
    { userId: 'developer', name: 'Developer', role: 'developer' },
    { userId: 'admin', name: 'Admin', role: 'admin' }
  ],
  // Who may manage whom (create / disable / reset). Nobody manages their own account here.
  MANAGES: { developer: ['admin', 'user'], admin: ['user'], user: [] }
};

/* ------------------------------------------------------------------ */
/* Crypto helpers                                                      */
/* ------------------------------------------------------------------ */

function bytesToHex_(bytes) {
  return bytes.map(function (b) { return ((b < 0 ? b + 256 : b) & 255).toString(16).padStart(2, '0'); }).join('');
}

function sha256Hex_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

/** PBKDF2-HMAC-SHA256, one 32-byte block. Returns signed bytes. */
function pbkdf2_(password, saltText, iterations) {
  var pw = Utilities.newBlob(password).getBytes();
  var salt = Utilities.newBlob(saltText).getBytes().concat([0, 0, 0, 1]);
  var u = Utilities.computeHmacSha256Signature(salt, pw);
  var t = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, pw);
    for (var j = 0; j < t.length; j++) t[j] = t[j] ^ u[j];
  }
  return t;
}

function randomHex_(bytes) {
  var hex = '';
  while (hex.length < bytes * 2) hex += Utilities.getUuid().replace(/-/g, '');
  return hex.slice(0, bytes * 2);
}

/** Leading letters keep Sheets from turning an all-digit hex string into a number. */
function hashPassword_(password) {
  var salt = 's' + randomHex_(16);
  var iters = AUTH.PBKDF2_ITERATIONS;
  return { salt: salt, hash: 'pbkdf2$' + iters + '$' + bytesToHex_(pbkdf2_(password, salt, iters)) };
}

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function verifyPassword_(password, salt, stored) {
  var parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  var iters = parseInt(parts[1], 10);
  if (!(iters > 0)) return false;
  return safeEqual_(bytesToHex_(pbkdf2_(password, String(salt), iters)), parts[2]);
}

/** Readable temporary password like K7QM-2XWD-9PTR. */
function makeTempPassword_() {
  var hex = randomHex_(12), out = '';
  for (var i = 0; i < 12; i++) {
    out += AUTH.TEMP_ALPHABET.charAt(parseInt(hex.substr(i * 2, 2), 16) % AUTH.TEMP_ALPHABET.length);
    if (i % 4 === 3 && i < 11) out += '-';
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* User helpers                                                        */
/* ------------------------------------------------------------------ */

function normId_(v) { return String(v || '').trim().toLowerCase().slice(0, 40); }

function isTrue_(v) { return v === true || String(v).toLowerCase() === 'true'; }

/** Safe-to-send view of a USERS row. Never includes the hash or salt. */
function publicUser_(u) {
  return {
    userId: u.userId,
    name: u.name,
    role: u.role,
    status: u.status,
    mustChangePassword: isTrue_(u.mustChangePassword),
    googleLinked: !!u.googleEmail,
    lastLogin: u.lastLogin || null
  };
}

function validateNewPassword_(pw, userId) {
  pw = String(pw || '');
  var min = parseInt(getSetting_('min_password_length', '8'), 10) || 8;
  if (pw.length < min) throw new ApiError('WEAK_PASSWORD', 'Password must be at least ' + min + ' characters.');
  if (pw.length > AUTH.MAX_PASSWORD_LENGTH) throw new ApiError('WEAK_PASSWORD', 'Password is too long.');
  if (pw.toLowerCase() === String(userId).toLowerCase()) throw new ApiError('WEAK_PASSWORD', 'Password cannot be the same as the username.');
  return pw;
}

function createUserRow_(userId, name, role) {
  var temp = makeTempPassword_();
  var h = hashPassword_(temp);
  appendObject_('USERS', {
    userId: userId, name: name, passwordHash: h.hash, salt: h.salt, role: role, status: 'active',
    createdDate: new Date().toISOString(), lastLogin: '', googleEmail: '', mustChangePassword: true
  });
  return temp;
}

/** Creates the developer and admin accounts if they do not exist. Returns the ones it created. */
function ensureSeedAccounts_() {
  var created = [];
  AUTH.SEEDS.forEach(function (seed) {
    if (!findRow_('USERS', 'userId', seed.userId)) {
      created.push({ userId: seed.userId, tempPassword: createUserRow_(seed.userId, seed.name, seed.role) });
    }
  });
  return created;
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

function createSession_(user) {
  purgeSessions_();
  var token = randomHex_(32);
  var ttlMs = (parseFloat(getSetting_('session_ttl_hours', '12')) || 12) * 3600000;
  var now = Date.now();
  appendObject_('SESSIONS', {
    sessionId: newId_('ses'), userId: user.userId, role: user.role,
    tokenHash: 't_' + sha256Hex_(token), createdAt: now, expiresAt: now + ttlMs, revoked: false
  });
  return { token: token, expiresAt: now + ttlMs };
}

function findSession_(token) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  var hash = 't_' + sha256Hex_(token);
  var info = findRow_('SESSIONS', 'tokenHash', hash);
  if (!info) return null;
  if (isTrue_(info.obj.revoked) || Number(info.obj.expiresAt) <= Date.now()) return null;
  return { info: info, tokenHash: hash };
}

function revokeSessions_(userId, exceptHash) {
  var s = sheet_('SESSIONS');
  var last = s.getLastRow();
  if (last < 2) return;
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var cUser = headers.indexOf('userId'), cHash = headers.indexOf('tokenHash'), cRev = headers.indexOf('revoked');
  var rows = s.getRange(2, 1, last - 1, headers.length).getValues();
  rows.forEach(function (r, i) {
    if (String(r[cUser]) === userId && r[cHash] !== exceptHash && !isTrue_(r[cRev])) {
      s.getRange(i + 2, cRev + 1).setValue(true);
    }
  });
}

/** Delete sessions that expired or were revoked more than a day ago. */
function purgeSessions_() {
  var s = sheet_('SESSIONS');
  var last = s.getLastRow();
  if (last < 2) return;
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var cExp = headers.indexOf('expiresAt');
  var cutoff = Date.now() - 24 * 3600000;
  var rows = s.getRange(2, 1, last - 1, headers.length).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (Number(rows[i][cExp]) < cutoff) s.deleteRow(i + 2);
  }
}

/** Replaces the Phase 1 placeholder. Checks the session, the account and the role. */
function authorize_(route, req) {
  if (route.roles.indexOf('public') !== -1) return { user: null };

  var token = String(req.token || '');
  if (!token) throw new ApiError('UNAUTHORIZED', 'Please log in.');
  var session = findSession_(token);
  if (!session) throw new ApiError('SESSION_EXPIRED', 'Your session has expired. Please log in again.');

  var userInfo = findRow_('USERS', 'userId', session.info.obj.userId);
  if (!userInfo || userInfo.obj.status !== 'active') throw new ApiError('SESSION_EXPIRED', 'Your session has expired. Please log in again.');

  var user = userInfo.obj;
  if (route.roles.indexOf(user.role) === -1) throw new ApiError('FORBIDDEN', 'You do not have access to this.');
  if (isTrue_(user.mustChangePassword) && !route.allowWhileMustChange) {
    throw new ApiError('PASSWORD_CHANGE_REQUIRED', 'Please set a new password first.');
  }
  return { user: publicUser_(user), userInfo: userInfo, tokenHash: session.tokenHash };
}

/* ------------------------------------------------------------------ */
/* Brute-force protection                                              */
/* ------------------------------------------------------------------ */

function lockoutMinutes_() {
  return Math.min(Math.max(parseInt(getSetting_('lockout_minutes', '15'), 10) || 15, 1), 360);
}

function checkLockout_(userId) {
  var max = parseInt(getSetting_('max_failed_logins', '5'), 10) || 5;
  var n = parseInt(CacheService.getScriptCache().get('fail:' + userId) || '0', 10);
  if (n >= max) throw new ApiError('LOCKED', 'Too many failed attempts. Try again in ' + lockoutMinutes_() + ' minutes.');
}

function recordFailure_(userId) {
  var cache = CacheService.getScriptCache();
  var n = parseInt(cache.get('fail:' + userId) || '0', 10) + 1;
  cache.put('fail:' + userId, String(n), lockoutMinutes_() * 60);
}

function clearFailures_(userId) {
  CacheService.getScriptCache().remove('fail:' + userId);
}

/* ------------------------------------------------------------------ */
/* Google sign-in                                                      */
/* ------------------------------------------------------------------ */

/** Verifies a Google ID token with Google and returns the verified email. */
function verifyGoogleToken_(idToken) {
  var clientId = getSetting_('google_client_id', '');
  if (!clientId) throw new ApiError('GOOGLE_DISABLED', 'Google sign-in is not set up.');
  idToken = String(idToken || '');
  if (idToken.length < 20 || idToken.length > 4000) throw new ApiError('BAD_REQUEST', 'Invalid Google token.');

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new ApiError('GOOGLE_FAILED', 'Google could not verify this sign-in.');
  var claims = JSON.parse(res.getContentText());

  var issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  var expOk = Number(claims.exp) * 1000 > Date.now();
  if (claims.aud !== clientId || !issOk || !expOk || String(claims.email_verified) !== 'true' || !claims.email) {
    throw new ApiError('GOOGLE_FAILED', 'Google could not verify this sign-in.');
  }
  return String(claims.email).toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Auth handlers                                                       */
/* ------------------------------------------------------------------ */

function routeAuthConfig_() {
  var id = getSetting_('google_client_id', '');
  return { googleEnabled: !!id, googleClientId: id };
}

function routeLogin_(p) {
  var userId = normId_(p.userId);
  var password = String(p.password || '');
  if (!userId || !password) throw new ApiError('BAD_REQUEST', 'Enter your username and password.');
  checkLockout_(userId);

  var info = password.length <= AUTH.MAX_PASSWORD_LENGTH ? findRow_('USERS', 'userId', userId) : null;
  var ok = false;
  if (info) ok = verifyPassword_(password, info.obj.salt, info.obj.passwordHash);
  else verifyPassword_(password.slice(0, AUTH.MAX_PASSWORD_LENGTH), 'sdummy', 'pbkdf2$' + AUTH.PBKDF2_ITERATIONS + '$00'); // similar timing for unknown users

  if (!ok) {
    recordFailure_(userId);
    log_('WARN', 'auth.login', 'Failed login for ' + userId, userId);
    throw new ApiError('INVALID_LOGIN', 'Incorrect username or password.');
  }
  if (info.obj.status !== 'active') throw new ApiError('ACCOUNT_DISABLED', 'This account is disabled. Contact your administrator.');

  clearFailures_(userId);
  updateRow_(info, { lastLogin: new Date().toISOString() });
  var session = createSession_(info.obj);
  log_('INFO', 'auth.login', 'Login ok', userId);
  return { token: session.token, expiresAt: session.expiresAt, user: publicUser_(info.obj) };
}

function routeGoogleLogin_(p) {
  var email = verifyGoogleToken_(p.credential);
  var info = findRow_('USERS', 'googleEmail', email);
  if (!info) throw new ApiError('GOOGLE_NOT_LINKED', 'No account is linked to this Google address. Log in with your password, then link Google from Profile.');
  if (info.obj.status !== 'active') throw new ApiError('ACCOUNT_DISABLED', 'This account is disabled. Contact your administrator.');
  updateRow_(info, { lastLogin: new Date().toISOString() });
  var session = createSession_(info.obj);
  log_('INFO', 'auth.googleLogin', 'Google login ok', info.obj.userId);
  return { token: session.token, expiresAt: session.expiresAt, user: publicUser_(info.obj) };
}

function routeMe_(p, ctx) {
  return { user: ctx.user };
}

function routeLogout_(p, ctx) {
  // revoke only this session
  var s = findRow_('SESSIONS', 'tokenHash', ctx.tokenHash);
  if (s) updateRow_(s, { revoked: true });
  return { loggedOut: true };
}

function routeChangePassword_(p, ctx) {
  var u = ctx.userInfo;
  var current = String(p.currentPassword || '');
  var next = validateNewPassword_(p.newPassword, u.obj.userId);
  checkLockout_(u.obj.userId);
  if (current.length > AUTH.MAX_PASSWORD_LENGTH || !verifyPassword_(current, u.obj.salt, u.obj.passwordHash)) {
    recordFailure_(u.obj.userId);
    throw new ApiError('INVALID_LOGIN', 'Your current password is incorrect.');
  }
  if (next === current) throw new ApiError('WEAK_PASSWORD', 'The new password must be different from the current one.');

  var h = hashPassword_(next);
  updateRow_(u, { passwordHash: h.hash, salt: h.salt, mustChangePassword: false });
  revokeSessions_(u.obj.userId, ctx.tokenHash); // sign out other devices
  clearFailures_(u.obj.userId);
  log_('INFO', 'auth.changePassword', 'Password changed', u.obj.userId);
  return { user: publicUser_(u.obj) };
}

function routeLinkGoogle_(p, ctx) {
  var email = verifyGoogleToken_(p.credential);
  var other = findRow_('USERS', 'googleEmail', email);
  if (other && other.obj.userId !== ctx.user.userId) throw new ApiError('GOOGLE_IN_USE', 'That Google account is already linked to another user.');
  updateRow_(ctx.userInfo, { googleEmail: email });
  log_('INFO', 'auth.linkGoogle', 'Google linked', ctx.user.userId);
  return { user: publicUser_(ctx.userInfo.obj) };
}

function routeUnlinkGoogle_(p, ctx) {
  updateRow_(ctx.userInfo, { googleEmail: '' });
  log_('INFO', 'auth.unlinkGoogle', 'Google unlinked', ctx.user.userId);
  return { user: publicUser_(ctx.userInfo.obj) };
}

/* ------------------------------------------------------------------ */
/* User management handlers                                            */
/* ------------------------------------------------------------------ */

/** Active people a user can pick (used later for accountability partners). */
function routeUsersDirectory_(p, ctx) {
  return {
    users: readAll_('USERS')
      .filter(function (u) { return u.status === 'active' && u.userId !== ctx.user.userId && u.role !== 'developer'; })
      .map(function (u) { return { userId: u.userId, name: u.name }; })
  };
}

function routeUsersList_(p, ctx) {
  return { users: readAll_('USERS').map(publicUser_) };
}

function managedTarget_(ctx, userId) {
  var info = findRow_('USERS', 'userId', normId_(userId));
  if (!info) throw new ApiError('NOT_FOUND', 'User not found.');
  if (info.obj.userId === ctx.user.userId) throw new ApiError('FORBIDDEN', 'Use Profile to manage your own account.');
  if (AUTH.MANAGES[ctx.user.role].indexOf(info.obj.role) === -1) throw new ApiError('FORBIDDEN', 'You cannot manage this account.');
  return info;
}

function routeUsersCreate_(p, ctx) {
  var userId = normId_(p.userId);
  var name = String(p.name || '').trim().slice(0, 60);
  var role = String(p.role || 'user');
  if (!AUTH.USERNAME_RE.test(userId)) throw new ApiError('BAD_REQUEST', 'Username must be 3-30 characters: lowercase letters, digits, dot, dash or underscore, starting with a letter.');
  if (!name) throw new ApiError('BAD_REQUEST', 'Enter a name.');
  if (AUTH.ROLES.indexOf(role) === -1 || AUTH.MANAGES[ctx.user.role].indexOf(role) === -1) throw new ApiError('FORBIDDEN', 'You cannot create an account with that role.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (findRow_('USERS', 'userId', userId)) throw new ApiError('USERNAME_TAKEN', 'That username is already taken.');
    var temp = createUserRow_(userId, name, role);
    log_('INFO', 'users.create', 'Created ' + userId + ' (' + role + ')', ctx.user.userId);
    return { user: publicUser_(findRow_('USERS', 'userId', userId).obj), tempPassword: temp };
  } finally {
    lock.releaseLock();
  }
}

function routeUsersSetStatus_(p, ctx) {
  var status = String(p.status);
  if (status !== 'active' && status !== 'disabled') throw new ApiError('BAD_REQUEST', 'Status must be active or disabled.');
  var info = managedTarget_(ctx, p.userId);
  updateRow_(info, { status: status });
  if (status === 'disabled') revokeSessions_(info.obj.userId, '');
  log_('INFO', 'users.setStatus', info.obj.userId + ' -> ' + status, ctx.user.userId);
  return { user: publicUser_(info.obj) };
}

function routeUsersResetPassword_(p, ctx) {
  var info = managedTarget_(ctx, p.userId);
  var temp = makeTempPassword_();
  var h = hashPassword_(temp);
  updateRow_(info, { passwordHash: h.hash, salt: h.salt, mustChangePassword: true });
  revokeSessions_(info.obj.userId, '');
  clearFailures_(info.obj.userId);
  log_('INFO', 'users.resetPassword', 'Reset ' + info.obj.userId, ctx.user.userId);
  return { user: publicUser_(info.obj), tempPassword: temp };
}

/* ------------------------------------------------------------------ */
/* Editor-only recovery tools (not reachable from the web)             */
/* ------------------------------------------------------------------ */

function resetPasswordFor_(userId) {
  var info = findRow_('USERS', 'userId', userId);
  if (!info) throw new Error('No account named ' + userId + '. Run setup() first.');
  var temp = makeTempPassword_();
  var h = hashPassword_(temp);
  updateRow_(info, { passwordHash: h.hash, salt: h.salt, mustChangePassword: true, status: 'active' });
  revokeSessions_(userId, '');
  clearFailures_(userId);
  Logger.log('New temporary password for ' + userId + ': ' + temp + '   (change it at first login)');
}

/** Run from the editor if you forget the developer password. */
function resetDeveloperPassword() { resetPasswordFor_('developer'); }

/** Run from the editor if you forget the admin password. */
function resetAdminPassword() { resetPasswordFor_('admin'); }

/** Run from the editor to see how long one password check takes (aim for under about 1.5 s). */
function benchmarkPasswordHash() {
  var t = Date.now();
  hashPassword_('benchmark-password');
  Logger.log('One password hash took ' + (Date.now() - t) + ' ms at ' + AUTH.PBKDF2_ITERATIONS + ' iterations.');
}
