# Goal Tracker

Zero-cost, mobile-first goal tracking app.
Netlify (frontend) + Google Apps Script (API) + Google Sheets (database) + Google Drive (storage).

## Project structure

```
goal-tracker/
├── netlify.toml            Netlify settings (publishes /frontend, SPA fallback, security headers)
├── backend/
│   ├── Code.gs             API router, schema, setup(), data helpers
│   ├── Auth.gs             Phase 2: login, sessions, passwords, users, Google sign-in
│   ├── Game.gs             Phase 3: goals, quests, points, levels, achievements, partners, duels, crowns
│   └── appsscript.json     Apps Script manifest (web app + scopes)
└── frontend/
    ├── index.html          App shell
    ├── css/styles.css      Mobile-first styles
    ├── css/game.css        Phase 3 game styles (hero card, quests, arena, modals, camera)
    └── js/
        ├── config.js       Your Apps Script URL goes here
        ├── api.js          API client (timeouts, error handling, session token)
        ├── camera.js       Live in-app camera + "live pic" watermark (Phase 3)
        ├── app.js          Login, role-based navigation, profile, users, system check
        └── game.js         Phase 3 screens: Quests, Goals, Arena, Trophies
```

---

## Phase 1 setup

### A. Backend (Google Apps Script)

1. Go to https://script.google.com and click **New project**. Name it `Goal Tracker API`.
2. Replace the contents of `Code.gs` with `backend/Code.gs` from this project.
3. Open **Project Settings** (gear icon) and tick **Show "appsscript.json" manifest file in editor**.
4. Open `appsscript.json` in the editor and replace it with `backend/appsscript.json`. Change `timeZone` if needed.
5. In the function dropdown at the top, select **setup** and click **Run**.
6. Approve the permissions when Google asks (Drive and Sheets access). If you see "Google hasn't verified this app", choose **Advanced > Go to Goal Tracker API**. This is your own script.
7. Open **Execution log**. You should see `Setup complete. Spreadsheet: https://docs.google.com/...`.
8. Click **Deploy > New deployment**, choose type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

"Anyone" is required so the Netlify site can call the API. Access control is the login system from Phase 2: every action except ping, config and login needs a valid session. Sheet and Drive IDs stay in Script Properties and never reach the browser.

> After any later change to `Code.gs`, use **Deploy > Manage deployments > Edit > New version** so the same URL serves the new code.

### B. Frontend (local check)

1. Open `frontend/js/config.js` and paste your `/exec` URL into `API_URL`.
2. From the `frontend` folder, run a local server (any one of these):
   - `python3 -m http.server 8080`
   - `npx serve .`
3. Open http://localhost:8080.

### C. Frontend (Netlify)

1. Push this project to a GitHub repository, or use drag and drop.
2. **Option 1 (drag and drop):** at https://app.netlify.com/drop, drag the `frontend` folder.
3. **Option 2 (Git):** Netlify > Add new site > Import from Git > pick the repo. Build command: leave empty. Publish directory: `frontend` (already set in `netlify.toml`).
4. Open the Netlify URL once the deploy finishes.

---

## Phase 2 setup (login, roles, users)

### Upgrade the backend
1. In the Apps Script editor click **+ > Script**, name it `Auth`, and paste `backend/Auth.gs`.
2. Replace `Code.gs` with the new `backend/Code.gs`.
3. Select **setup** and click **Run** (it is safe to re-run; it adds the new column and settings and creates the first accounts).
4. Open **Execution log**. You will see two lines like:
   `CREATED ACCOUNT  username: developer   temporary password: K7QM-2XWD-9PTR`
   Copy both passwords now. They are shown only once and are not stored anywhere readable.
5. **Deploy > Manage deployments > Edit > New version > Deploy**.
6. Optional: run **benchmarkPasswordHash**. It should report well under 2000 ms. If it is much slower, lower `PBKDF2_ITERATIONS` at the top of `Auth.gs` before anyone sets a real password.

### First login
Open the site, log in as `developer` with the temporary password, and choose a new password. Do the same for `admin`.

If you forget a password, run **resetDeveloperPassword** or **resetAdminPassword** from the editor and read the new temporary password in the Execution log.

### Roles
| Role | Can do |
|------|--------|
| user | Own goals and profile. Sees only a name list of other users (for accountability partners later). |
| admin | Everything a user can, plus create users, reset passwords and disable or enable users (users only). |
| developer | Everything an admin can, plus create or manage admins, and the System, Testing and Logs areas. |

### Optional: Sign in with Google
1. Go to https://console.cloud.google.com, create or pick a project, then **APIs & Services > OAuth consent screen** and set it up (External is fine; add yourself as a test user while in testing mode).
2. **Credentials > Create credentials > OAuth client ID > Web application**. Under **Authorized JavaScript origins** add your Netlify URL (for example `https://your-site.netlify.app`) and `http://localhost:8080`. No redirect URI is needed.
3. Copy the **Client ID**, open the `SETTINGS` sheet and paste it as the value of `google_client_id`.
4. Reload the site. A Google button appears on the login screen and in **Profile**.
5. Each person first logs in with their password, then links their Google account from **Profile**. Google login only works for linked accounts.

### Security notes
- Passwords are hashed with PBKDF2-HMAC-SHA256 and a per-user salt. Session tokens are random; only their hash is stored.
- 5 failed logins on a username lock it for 15 minutes (`max_failed_logins`, `lockout_minutes` in `SETTINGS`).
- A password change or reset signs the user out on other devices. Disabling a user ends their sessions.
- The browser keeps the session token in `localStorage` so a phone stays logged in for `session_ttl_hours` (default 12). Log out on shared devices.
- Apps Script cannot read request headers, so the token travels in the request body over HTTPS.

## Phase 3: game layer (points, levels, achievements, partner arena)

### Upgrade an existing install
1. In the Apps Script editor click **+ > Script**, name it `Game`, and paste `backend/Game.gs`.
2. Replace `Code.gs` with the new `backend/Code.gs` (keep `Auth.gs` as is).
3. Select **setup** and click **Run**. It is safe to re-run: it adds five sheets (`GAME_EVENTS`, `ACHIEVEMENTS`, `CROWNS`, `CHEERS`, `CHALLENGES`) and new columns on `COMPLETIONS`. Existing data is untouched.
4. **Deploy > Manage deployments > Edit > New version > Deploy**.
5. Redeploy the `frontend` folder (it has two new files: `js/game.js` and `css/game.css`).
6. Create at least two users (Users tab) so people can partner up. Each person logs in once to set a password.

### What users get
| Feature | How it works |
|---------|--------------|
| **Quests** | Every activity in an active goal is a quest. Daily quests can be done once a day. Weekly quests have a target (1 to 7 times a week), at most once a day. |
| **Points** | 10 per quest, + streak bonus (+1 per streak day, max +10), + 5 for the first quest of the day. **Perfect Day** gives +15 when all daily quests are done (needs 2 or more). |
| **Level** | Level score = total points + 5 per active day (regularity) + 15 per activity in your chart (the first 20 count). Level 2 needs 30, level 5 about 360, level 10 about 1,570, level 20 about 6,000. Titles: Rookie, Spark, Climber, Challenger, Achiever, Champion, Legend, Mythic. |
| **Achievements** | 32 milestones (quests done, streaks, active days, chart size, perfect days, partner and crown milestones, levels). Each pays bonus points. They are plain data in `ACHIEVEMENTS` at the top of `Game.gs`. |
| **Live photo proof** | Completing a quest opens an in-app live camera. The photo is stamped with a LIVE banner, the user's name, the time and a one-time code (for example `GT-K7Q2`), plus a faint diagonal pattern of the code across the whole image. |
| **Partner review** | Partners open the photo in the Arena and tap **Verify** (you get +5, they get +2) or **Not convincing** (the points are taken back and the quest can be done again). |
| **Weekly duel and crown** | Each week (Monday to Sunday) both partners' points are compared. The winner gets a crown and +50. Results are settled automatically the next time either person opens the app (no triggers needed). Ties give no crown. |
| **Duo quest** | Finish 20 quests together in a week, with at least 5 from each person, and you both get +40. |
| **Cheers and nudges** | Partners can send emoji cheers (+1 point to the sender, up to 5 a day) and a 👋 nudge (once per 4 hours). Preset emojis only, so there is nothing to moderate. |
| **Leaderboard** | With more than one partner you get a weekly ranking. |

All the numbers are in the `GAME` block at the top of `Game.gs`.

### How the live-photo check works (and what it cannot do)
1. Tapping **Complete** asks the server for a one-time code that is valid for 10 minutes and tied to that user and activity.
2. The app takes the photo from the live camera feed (no gallery picker) and prints the code, name and time on it.
3. The server accepts the completion only with a valid, unused code and a real JPEG. The code is stored with the completion and shown to the partner next to the photo.
4. If the browser blocks the camera, the app falls back to the phone's camera app. That photo must be under 3 minutes old and is labelled **CAMERA APP PIC**, and the partner sees a "Camera app" badge.

A watermark added in the browser deters casual cheating but cannot prove authenticity, because someone determined could still edit an image. The one-time code, the live camera, and above all the partner's review are what make it hard to fake. If you ever need a stronger guarantee, the next step would be a native app with device attestation.

### Things to know
- **Navigation:** the user menu is now Quests, Goals, Arena, Trophies, Profile. The unbuilt Calendar and Progress screens are left out of the menu for now (the routes still exist). Admin and developer menus are unchanged except that Quests and Goals now show real screens.
- **Data model:** activities are rows in `ACTIVITIES`; each completion is a row in `COMPLETIONS`. `ACTIVITY_INSTANCES` (planned for the calendar phase) is not used yet.
- **Privacy:** partners see each other's quest names, photos, level and weekly points while the partnership is accepted. Either person can end it at any time. Photos stay private in Drive and are only sent through the API to the owner and accepted partners.
- **Speed:** each request reads whole sheets. That is fine for a few dozen users. If it gets slow, the tables can be cached or trimmed.

## Phase 3 test procedure

| # | Test | Expected result |
|---|------|-----------------|
| 1 | Run `setup()` again | 15 sheets now exist, `COMPLETIONS` has the new columns, no existing rows change. |
| 2 | Log in as a user, open **Goals**, create a goal and add three activities (two daily, one weekly 3×) | Each shows in the goal. The **Dreamer** achievement pops up. |
| 3 | Open **Quests**, tap **📸** on one quest | The live camera opens with a LIVE badge and a code. Take a photo, see the preview with the watermark, submit. |
| 4 | Look at the celebration screen | Points breakdown (10 + 5 first of day), confetti, **First Step** achievement. The level bar moves. |
| 5 | Try to complete the same daily quest again | The button is gone and it shows Done. |
| 6 | Complete the other daily quest | **Perfect Day** +15 is added. |
| 7 | Deny camera permission and try again | The phone's camera app opens. The preview and later the partner see a "Camera app" label. |
| 8 | **Arena**: invite another user. Log in as them and accept | Both see a duel card. Both get **Buddy Up**. |
| 9 | The second user completes a quest. First user: **Arena > Review photo** | Photo shows with the LIVE banner and matching code. **Verify** gives them +5 and the reviewer +2. |
| 10 | Review another photo with **Not convincing** | The points are removed and that quest can be completed again. |
| 11 | Send cheers and a nudge | Toast confirms. Partner sees them under **Cheers for you**. A second nudge within 4 hours is refused. |
| 12 | After a Sunday passes, open **Arena** | The finished week appears in the history. The winner has a 👑 and +50. A duo quest bonus is paid if reached. |
| 13 | **Trophies** | Level breakdown, achievements (unlocked in colour, locked greyed with progress), crown cabinet, recent points. |
| 14 | Copy a code from one completion and try to reuse it from the API | The server refuses (`BAD_CODE`). |

---

## Phase 2 test procedure

| # | Test | Expected result |
|---|------|-----------------|
| 1 | Run `setup()` | Execution log shows two CREATED ACCOUNT lines the first time, none on a second run. `USERS` has `developer` and `admin`; the password cells hold `pbkdf2$...` text, never a readable password. |
| 2 | Open the site while logged out | Only the login form, no menu. |
| 3 | Log in with a wrong password | "Incorrect username or password." Same message for an unknown username. |
| 4 | Log in as `developer` with the temporary password | "Choose a new password" screen, no menu. After saving, the developer menu appears. |
| 5 | Developer > **System** > **Run system check** | Green message and a table of 15 sheets. |
| 6 | Make 5 wrong logins for `admin` | "Too many failed attempts. Try again in 15 minutes." |
| 7 | As admin, **Users** > create `testuser` | A one-time temporary password appears. The role list offers only `user`. |
| 8 | Log in as `testuser` | Forced password change, then the user menu (5 tabs). There is no Users or System tab. |
| 9 | Admin: **Reset password** for `testuser` while they are logged in | Their next action returns them to login with "Your session has ended". |
| 10 | Admin: **Disable** `testuser` | They cannot log in ("This account is disabled"). **Enable** restores access. |
| 11 | Developer: use **Preview as** | The menu changes to match the chosen role. It is a view only; the server still applies the developer's real permissions. |
| 12 | Log in as `testuser`, then change the password from **Profile** on a second browser | The first browser is signed out on its next action. |
| 13 | (Google enabled) Link Google from Profile, log out, use the Google button | You are logged in. A Google account that is not linked is refused with a clear message. |

---

## Phase 1 test procedure

| # | Test | Expected result |
|---|------|-----------------|
| 1 | Open the Drive folder **GOAL TRACKER** | It contains `Database`, `User Data`, `Goals`, `Reports`, `Completion Photos`. The `Database` folder holds the spreadsheet **Goal Tracker DB**. |
| 2 | Open **Goal Tracker DB** | 10 sheets: USERS, GOALS, GOAL_AREAS, ACTIVITIES, ACTIVITY_INSTANCES, ACTIVITY_LOG, COMPLETIONS, ACCOUNTABILITY, SESSIONS, SETTINGS. Each has a bold, frozen header row. SETTINGS has 8 rows. |
| 3 | Run `setup()` a second time | No duplicate sheets, folders or settings rows. |
| 4 | Visit the `/exec` URL in a browser | JSON with `"ok":true` and `"service":"Goal Tracker API"`. |
| 5 | Log in as developer (Phase 2), then **System** > **Run system check** | Green message "Connected. All sheets found." and a table of 15 sheets with row counts. |
| 6 | Clear `API_URL` back to the placeholder and run the check | Red message: "API_URL is not set." |
| 7 | Turn off your network and run the check | Red message: "Could not reach the server." |
| 8 | Use the **Preview as** dropdown (User, Admin, Developer) | Navigation changes to match each role. On a phone-width window it is a bottom tab bar; at 900px and wider it is a side rail. |
| 9 | Delete the `SETTINGS` sheet, run the check, then run `setup()` | The check reports `SETTINGS` as missing; after `setup()` it passes again. |

If a step fails, open **Executions** in the Apps Script editor to see the server-side error.

---

## Notes for later phases

- **Extensibility:** life areas and activities are data, not schema. Per-activity options (minutes per session, monthly amounts, and so on) go in the JSON `params` column of `ACTIVITIES`.
- **`system.health`** is restricted to the developer role (done in Phase 2).
- Phase 3 adds goal and activity routes (`goals.*`, `activities.*`), completion routes (`completions.*`), game routes (`game.*`, `arena.get`), partner routes (`partners.*`) and `cheers.send`. All need a login.

## Design decisions for upcoming phases

- **"Others" activity:** stored as `activityKey = 'others'` with the typed text in `activityName`. The name is required and capped by the `others_name_max_length` setting; the server validates it, not just the form.
- **Completion needs a photo:** a completion is rejected server-side unless it carries a photo. The file is saved privately in `Completion Photos` and linked through `COMPLETIONS.photoFileId`. `frontend/js/camera.js` captures and compresses the photo. The `Permissions-Policy` header now allows `camera=(self)`.
- **Accountability partners:** rows in `ACCOUNTABILITY`. A request starts as `pending` and only the invited user can move it to `accepted` or `declined`; the requester can `revoke`. Partners see progress and photos only while status is `accepted`.
- **Upgrading an existing install:** paste the new `Code.gs`, run `setup()` again (it adds the new sheet, folder, columns and settings without touching existing data), then deploy a new version.
