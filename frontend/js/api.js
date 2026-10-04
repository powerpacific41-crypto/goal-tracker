// Thin client for the Apps Script backend.
// Uses Content-Type text/plain so the browser sends a "simple" request (no CORS preflight),
// which Apps Script web apps require.
const TOKEN_KEY = 'gt_token';

window.Api = {
  getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } },
  setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* storage blocked */ } },
  clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } },

  async call(action, payload) {
    const cfg = window.GT_CONFIG;
    if (!cfg.API_URL || cfg.API_URL.indexOf('PASTE_') === 0) {
      throw new ApiFailure('NOT_CONFIGURED', 'API_URL is not set. Edit frontend/js/config.js.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(cfg.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, payload: payload || {}, token: Api.getToken() }),
        signal: controller.signal
      });
    } catch (err) {
      throw new ApiFailure(
        err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
        err.name === 'AbortError'
          ? 'The server took too long to respond. Try again.'
          : 'Could not reach the server. Check your connection.'
      );
    } finally {
      clearTimeout(timer);
    }

    let body;
    try { body = await res.json(); }
    catch (e) { throw new ApiFailure('BAD_RESPONSE', 'The server sent an unreadable response.'); }

    if (!body.ok) {
      // The session ended on the server: tell the app so it can show the login screen.
      if (body.error.code === 'SESSION_EXPIRED' || body.error.code === 'UNAUTHORIZED') {
        window.dispatchEvent(new CustomEvent('gt:session-expired'));
      }
      throw new ApiFailure(body.error.code, body.error.message);
    }
    return body.data;
  }
};

class ApiFailure extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
window.ApiFailure = ApiFailure;
