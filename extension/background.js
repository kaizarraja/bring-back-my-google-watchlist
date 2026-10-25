// Background sync: keeps this browser's list in step with the sync server.
//
// Syncs a couple of seconds after any change, every half hour, when the browser
// starts, and when the popup or the "my watchlist" page asks. The half-hour check only
// catches changes from other browsers that nobody has looked at yet, so it can be slow;
// it keeps each user to a few dozen requests a day. Each sync sends this
// browser's unsent changes and receives everything that changed elsewhere since last time.
//
// Signing in happens here rather than in the popup, because the popup closes as soon
// as Google's sign-in window takes focus.

importScripts('src/config.js', 'src/storage.js');

const AUTH = 'auth'; // { token, email }
const CURSOR = 'sync:cursor';
const STATUS = 'sync:status'; // { at, error }
const ALARM = 'sync';
const PUSH_DELAY = 2000;
const MAX_PER_REQUEST = 200;

const api = (path) => WL_CONFIG.apiBase.replace(/\/$/, '') + path;

class SignedOut extends Error {}

async function call(path, body, token) {
  const res = await fetch(api(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) throw new SignedOut(data.error || 'Signed out');
  if (!res.ok) throw new Error(data.error || `Sync server error (${res.status})`);
  return data;
}

let running = null;
let again = false;

// Runs one sync, or queues one more if a sync is already running.
function syncNow() {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncOnce() {
  const { [AUTH]: auth, [CURSOR]: savedCursor = 0 } = await chrome.storage.local.get([AUTH, CURSOR]);
  if (!auth) return;
  let cursor = savedCursor;
  try {
    const { changes, stamps } = await WL.pendingChanges();
    // Send in chunks; every response also carries a page of changes from elsewhere.
    let i = 0;
    let more = true;
    while (i < changes.length || more) {
      const chunk = changes.slice(i, i + MAX_PER_REQUEST);
      const res = await call('/v1/sync', { since: cursor, changes: chunk }, auth.token);
      await WL.markSent(Object.fromEntries(chunk.map((c) => [c.id, stamps[c.id]])));
      await WL.applyRemote(res.items);
      cursor = res.cursor;
      more = res.more;
      i += chunk.length;
      await chrome.storage.local.set({ [CURSOR]: cursor });
    }
    // Stamps for titles with nothing left to send (e.g. removed before they ever synced).
    await WL.markSent(Object.fromEntries(Object.entries(stamps).filter(([id]) => !changes.some((c) => c.id === id))));
    await chrome.storage.local.set({ [STATUS]: { at: Date.now(), error: null } });
  } catch (err) {
    if (err instanceof SignedOut) {
      await chrome.storage.local.remove([AUTH, CURSOR]);
      await chrome.storage.local.set({ [STATUS]: { at: Date.now(), error: 'You were signed out. Sign in again to keep syncing.' } });
    } else {
      await chrome.storage.local.set({ [STATUS]: { at: Date.now(), error: navigator.onLine ? err.message : 'Offline' } });
    }
  }
}

async function signIn() {
  const nonce = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: WL_CONFIG.googleClientId,
    response_type: 'id_token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: 'openid email',
    nonce,
    prompt: 'select_account',
  });
  const redirect = await chrome.identity.launchWebAuthFlow({
    url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params,
    interactive: true,
  });
  const idToken = new URLSearchParams(new URL(redirect).hash.slice(1)).get('id_token');
  if (!idToken) throw new Error('Google did not complete the sign-in.');
  const { token, email } = await call('/v1/auth/google', { idToken, nonce });
  await chrome.storage.local.set({ [AUTH]: { token, email }, [CURSOR]: 0 });
  // Upload everything on this browser; the server merges it with what other browsers sent.
  await WL.markAllUnsent();
  await syncNow();
  return { email };
}

async function signOut() {
  const { [AUTH]: auth } = await chrome.storage.local.get(AUTH);
  await chrome.storage.local.remove([AUTH, CURSOR, STATUS]);
  if (auth) call('/v1/signout', {}, auth.token).catch(() => {});
}

// Deletes this account's synced list from the server. The list on this browser stays.
async function deleteAccount() {
  const { [AUTH]: auth } = await chrome.storage.local.get(AUTH);
  if (!auth) return;
  await call('/v1/account/delete', {}, auth.token);
  await chrome.storage.local.remove([AUTH, CURSOR, STATUS]);
}

// ---- Update nudges ----
// Hand-installed extensions can't update themselves, so once a day (and when the browser
// starts or the popup opens) check the website's version.json. If there's a newer
// version, show an orange NEW badge on the toolbar icon; the list on Google and in the
// popup show a banner with what's new and a link to the How to update page.

const UPDATE_ALARM = 'update-check';
const LATEST = 'update:latest'; // { version, notes, important, checkedAt }

async function refreshBadge() {
  const { [LATEST]: latest } = await chrome.storage.local.get(LATEST);
  const current = chrome.runtime.getManifest().version;
  if (latest && WL.isNewerVersion(latest.version, current)) {
    await chrome.action.setBadgeBackgroundColor({ color: latest.important ? '#C5221F' : '#E8710A' });
    await chrome.action.setBadgeText({ text: 'NEW' });
    await chrome.action.setTitle({ title: `Update available: version ${latest.version}. Open to see what's new.` });
  } else {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'My Watchlist' });
  }
}

async function checkForUpdate() {
  try {
    const res = await fetch(WL_CONFIG.versionUrl, { cache: 'no-store' });
    if (!res.ok) return;
    const { version, notes = '', important = false } = await res.json();
    if (typeof version !== 'string') return;
    await chrome.storage.local.set({ [LATEST]: { version, notes: String(notes), important: Boolean(important), checkedAt: Date.now() } });
  } catch {
    // Offline or the site is down; try again at the next check.
  }
  await refreshBadge();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForUpdate();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    'sign-in': signIn, 'sign-out': signOut, 'sync-now': syncNow, 'delete-account': deleteAccount, 'check-update': checkForUpdate,
  };
  const handler = handlers[message && message.type];
  if (!handler) return false;
  handler().then(
    (result) => sendResponse({ ok: true, ...(result || {}) }),
    (err) => sendResponse({ ok: false, error: err.message || String(err) }),
  );
  return true; // responds asynchronously
});

// Push local edits shortly after they happen.
let pushTimer = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !Object.keys(changes).some((key) => key.startsWith('o:') && changes[key].newValue)) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, PUSH_DELAY);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) syncNow();
});

function schedule() {
  chrome.alarms.create(ALARM, { periodInMinutes: 30 });
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 24 * 60 });
  syncNow();
  checkForUpdate();
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  schedule();
  if (reason === 'install') {
    // First run: walk through signing in and importing the old Google watchlist.
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  } else if (reason === 'update') {
    // Let titles that older versions gave up on be looked up again straight away.
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter((key) => key.startsWith('f:') || key === 'fill:pausedAt'));
  }
});
chrome.runtime.onStartup.addListener(schedule);
