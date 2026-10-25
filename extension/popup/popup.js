// Toolbar popup: the full list, sign-in for syncing, and backup and import.

(() => {
  const { el } = WLUI;
  const app = document.getElementById('app');
  app.className = 'wl-root';
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => { app.dataset.theme = darkQuery.matches ? 'dark' : 'light'; };
  darkQuery.addEventListener('change', applyTheme);
  applyTheme();

  const style = document.createElement('style');
  style.textContent = WLUI.CSS;
  document.head.prepend(style);

  const status = el('div', { class: 'wl-status', role: 'status' });
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: importFile });

  const syncText = el('span', { class: 'wl-sync-text' });
  const signInButton = el('button', { class: 'wl-chip wl-primary', type: 'button', text: 'Sign in with Google to sync', onclick: signIn });
  const syncNowButton = el('button', { class: 'wl-link', type: 'button', text: 'Sync now', onclick: () => send('sync-now') });
  const signOutButton = el('button', { class: 'wl-link', type: 'button', text: 'Sign out', onclick: () => send('sign-out') });
  const deleteButton = el('button', { class: 'wl-link', type: 'button', text: 'Delete synced data', onclick: deleteSynced });
  const syncRow = el('div', { class: 'wl-sync' }, [syncText, signInButton, syncNowButton, signOutButton, deleteButton]);
  const updateNote = el('a', { class: 'wl-update', href: WL_CONFIG.homepage, target: '_blank', rel: 'noopener', hidden: true });

  app.append(
    WLUI.createListView({ openInNewTab: true, showSearch: true }),
    el('footer', { class: 'wl-footer' }, [
      updateNote,
      syncRow,
      el('button', { class: 'wl-link', type: 'button', text: 'Export', title: 'Save a backup file of your watchlist', onclick: exportFile }),
      el('button', { class: 'wl-link', type: 'button', text: 'Import file', title: 'Load a backup file', onclick: () => fileInput.click() }),
      el('a', {
        class: 'wl-link', href: 'https://www.google.com/interests/saved', target: '_blank', rel: 'noopener',
        text: 'Import from Google', title: 'Open your old Google watchlist, then press "Import" on that page',
      }),
      status,
      fileInput,
    ]),
  );

  function send(type) {
    return chrome.runtime.sendMessage({ type });
  }

  async function signIn() {
    signInButton.disabled = true;
    syncText.textContent = 'Signing in…';
    const res = await send('sign-in');
    signInButton.disabled = false;
    if (!res.ok) syncText.textContent = /did not approve|canceled|cancelled/i.test(res.error) ? 'Sign-in was cancelled.' : 'Sign-in failed: ' + res.error;
  }

  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    return new Date(t).toLocaleString();
  };

  async function showSync() {
    const { auth, 'sync:status': st } = await chrome.storage.local.get(['auth', 'sync:status']);
    signInButton.hidden = Boolean(auth);
    syncNowButton.hidden = !auth;
    signOutButton.hidden = !auth;
    deleteButton.hidden = !auth;
    if (!auth) {
      syncText.textContent = st && st.error ? st.error : 'Your list is only on this browser.';
    } else if (st && st.error) {
      syncText.textContent = `Signed in as ${auth.email} · couldn't sync: ${st.error}`;
    } else {
      syncText.textContent = `Synced as ${auth.email}` + (st && st.at ? ` · ${ago(st.at)}` : '');
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('auth' in changes || 'sync:status' in changes)) showSync();
  });
  showSync();
  send('sync-now');

  async function deleteSynced() {
    if (!confirm('Delete your list from the sync server? Every signed-in browser will be signed out. The list on this browser stays, and you can sign in again to start syncing afresh.')) return;
    const res = await send('delete-account');
    status.textContent = res.ok ? 'Your synced data was deleted from the server.' : "Couldn't delete: " + res.error;
  }

  // Installed by hand, the extension can't update itself, so point people to a newer release.
  async function checkForUpdate() {
    try {
      const latest = await (await fetch(WL_CONFIG.versionUrl, { cache: 'no-store' })).json();
      const newer = (a, b) => {
        const [x, y] = [a, b].map((v) => String(v).split('.').map(Number));
        for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
        return false;
      };
      if (newer(latest.version, chrome.runtime.getManifest().version)) {
        updateNote.textContent = `Version ${latest.version} is available. Download it →`;
        updateNote.hidden = false;
      }
    } catch {
      // Offline or the site is down; try again next time.
    }
  }
  checkForUpdate();

  async function exportFile() {
    const items = (await WL.getAll()).map(({ poster, ...rest }) => rest);
    const blob = new Blob([JSON.stringify({ app: 'my-watchlist', version: 1, exportedAt: new Date().toISOString(), items }, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `my-watchlist-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    status.textContent = `Exported ${items.length} titles.`;
  }

  async function importFile() {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const raw = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(raw)) throw new Error('This file has no list of titles in it.');
      const items = raw
        .filter((i) => i && typeof i.title === 'string' && i.title.trim())
        .map((i) => ({
          id: typeof i.id === 'string' ? i.id : null,
          title: i.title.trim(),
          year: Number(i.year) || null,
          kind: i.kind === 'tv' || i.kind === 'movie' ? i.kind : null,
          addedAt: Number(i.addedAt) || null,
          watchedAt: Number(i.watchedAt) || null,
        }));
      const r = await WL.addMany(items);
      status.textContent = `Imported ${r.added} titles` +
        (r.skipped ? `, ${r.skipped} were already on your list` : '') + '.';
    } catch (err) {
      status.textContent = 'Could not import that file: ' + (err.message || err);
    }
  }

})();
