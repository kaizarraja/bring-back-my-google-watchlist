// Runs on Google results pages: adds the Watchlist button on movie and TV
// pages, and shows the list when you search "my watchlist".

(() => {
  const HOST_ATTR = 'data-wl-host';

  function ensurePanel(kind) {
    if (document.querySelector(`[${HOST_ATTR}="panel"]`)) return;
    const spot = WLGoogle.findPanelSpot();
    if (!spot) return;
    const host = document.createElement('div');
    host.setAttribute(HOST_ATTR, 'panel');
    host.style.cssText = 'display:block;margin:8px 0 32px;max-width:100%;min-width:0;';
    const root = WLUI.mount(host);
    root.style.setProperty('--wl-card-min', '120px');
    root.append(WLUI.createListView({ kind, showSearch: true }));
    spot.place(host);
    // Catch up with changes made in other browsers; the list refreshes when they arrive.
    chrome.runtime.sendMessage({ type: 'sync-now' }).catch(() => {});
  }

  function ensureButtons(entity) {
    const subtitles = WLGoogle.findSubtitles();
    const floating = document.querySelector(`[${HOST_ATTR}="floating"]`);

    if (!subtitles.length) {
      // No header we recognise: fall back to a button in the corner of the page.
      if (floating) return;
      const host = document.createElement('div');
      host.setAttribute(HOST_ATTR, 'floating');
      const root = WLUI.mount(host);
      root.classList.add('wl-floating');
      root.append(WLUI.createWatchButton(entity));
      document.body.append(host);
      return;
    }

    floating?.remove();
    for (const subtitle of subtitles) {
      if (subtitle.nextElementSibling?.getAttribute(HOST_ATTR) === 'button') continue;
      const host = document.createElement('div');
      host.setAttribute(HOST_ATTR, 'button');
      host.style.cssText = 'display:inline-flex;align-items:center;flex:none;margin-left:12px;';
      WLUI.mount(host).append(WLUI.createWatchButton(entity, { compact: true }));
      subtitle.after(host);
    }
  }

  // Where Google's own "Want to watch" sits (the "Watch movie" row further down the page):
  // clicking Google's button also saves to your list, with a "✓ On your watchlist" line
  // under the row. If Google has hidden its button, ours takes its place in that row.
  function ensureWantToWatch(entity) {
    for (const { row, want } of WLGoogle.findWatchActions()) {
      if (want) {
        if (!want.hasAttribute('data-wl-hooked')) {
          want.setAttribute('data-wl-hooked', '');
          // Capture phase, before Google flips its state: "not pressed" means the person is
          // adding it to Google's list, so add it to ours too; "pressed" means removing.
          want.addEventListener('click', () => {
            WLUI.setSaved(entity, want.getAttribute('aria-pressed') !== 'true');
          }, true);
        }
        if (!row.parentElement.querySelector(`:scope > [${HOST_ATTR}="saved-note"]`)) {
          const host = document.createElement('div');
          host.setAttribute(HOST_ATTR, 'saved-note');
          WLUI.mount(host).append(WLUI.createSavedNote(entity));
          row.after(host);
        }
      } else if (!row.querySelector(`[${HOST_ATTR}="wtw"]`)) {
        const host = document.createElement('div');
        host.setAttribute(HOST_ATTR, 'wtw');
        host.style.cssText = 'display:flex;justify-content:center;flex:none;';
        WLUI.mount(host).append(WLUI.createWantToWatchItem(entity));
        row.append(host);
      }
    }
  }

  let entity;
  let pageUrl = location.href;

  function isWatchlistSearch() {
    // Ignore the search box while someone is typing in it; only what was searched counts.
    const typing = document.activeElement && document.activeElement.matches('textarea[name="q"], input[name="q"]');
    const queries = WLGoogle.getQueries();
    for (const q of typing ? queries.slice(0, 1) : queries) {
      const found = WLGoogle.parseWatchlistQuery(q);
      if (found) return found;
    }
    return null;
  }

  function run() {
    const watchlist = isWatchlistSearch();
    if (watchlist) ensurePanel(watchlist.kind);
    else document.querySelector(`[${HOST_ATTR}="panel"]`)?.remove();

    entity = entity || WLGoogle.findEntity();
    if (entity) {
      ensureButtons(entity);
      ensureWantToWatch(entity);
    }
  }

  // A saved title may be missing details: no poster on this computer yet, or no year or
  // movie/TV label because it was imported. This page has them, so fill them in.
  function fillDetailsIfSaved() {
    if (entity) WL.fillDetails(WL.idFor(entity), entity);
  }

  // Parts of the page render late; put the button back if Google re-renders the header.
  let pending = 0;
  let stopWatching = 0;
  const observer = new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(run, 250);
  });
  function watchForLateChanges() {
    observer.observe(document.body, { childList: true, subtree: true });
    clearTimeout(stopWatching);
    stopWatching = setTimeout(() => observer.disconnect(), 20000);
  }

  run();
  fillDetailsIfSaved();
  watchForLateChanges();
  // Any Google page is a chance to fill in titles still missing a poster or year.
  WLFiller.start();

  // Google sometimes swaps in new results without loading a new page (e.g. after "Did you
  // mean"), so treat a changed address as a new page.
  setInterval(() => {
    if (location.href === pageUrl) return;
    pageUrl = location.href;
    entity = null;
    document.querySelectorAll(`[${HOST_ATTR}="button"], [${HOST_ATTR}="floating"], [${HOST_ATTR}="saved-note"], [${HOST_ATTR}="wtw"]`)
      .forEach((host) => host.remove());
    run();
    fillDetailsIfSaved();
    watchForLateChanges();
  }, 1000);
})();
