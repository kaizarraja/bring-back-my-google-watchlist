// Runs on Google results pages: adds the Watchlist button on movie and TV
// pages, and shows the list when you search "my watchlist".

(() => {
  const HOST_ATTR = 'data-wl-host';

  // Titles missing a poster, year or movie/TV label (usually imported ones) get them from
  // their Google page in the background. Only a few per visit, spaced out, so it stays a
  // handful of ordinary searches. Each title is retried at most once a week, and if Google
  // ever answers with its "unusual traffic" check, lookups stop for a day.
  const FILL_PER_VISIT = 5;
  const FILL_GAP = 1500;
  const RETRY_AFTER = 7 * 24 * 60 * 60 * 1000;
  const PAUSE_AFTER_LIMIT = 24 * 60 * 60 * 1000;

  async function fillMissingDetails() {
    const { 'fill:pausedAt': pausedAt = 0 } = await chrome.storage.local.get('fill:pausedAt');
    if (Date.now() - pausedAt < PAUSE_AFTER_LIMIT) return;
    const items = (await WL.getAll()).filter((i) => !i.poster || !i.year || !i.kind);
    const tried = await chrome.storage.local.get(items.map((i) => 'f:' + i.id));
    const due = items
      .filter((i) => !(Date.now() - (tried['f:' + i.id] || 0) < RETRY_AFTER))
      .sort((a, b) => Boolean(a.poster) - Boolean(b.poster)) // missing posters first: they show most
      .slice(0, FILL_PER_VISIT);
    for (const item of due) {
      await new Promise((resolve) => setTimeout(resolve, FILL_GAP));
      try {
        const found = await WLGoogle.fetchDetails(item);
        await chrome.storage.local.set({ ['f:' + item.id]: Date.now() });
        if (found) await WL.fillDetails(item.id, { ...found, getPoster: () => WLUI.shrinkImage(found.poster) });
      } catch (err) {
        if (err.message === 'rate-limited') {
          await chrome.storage.local.set({ 'fill:pausedAt': Date.now() });
          return;
        }
        // Anything else: leave this title as it is; it's tried again next week.
        await chrome.storage.local.set({ ['f:' + item.id]: Date.now() });
      }
    }
  }

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
    fillMissingDetails();
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

  let entity;

  function run() {
    const watchlist = WLGoogle.parseWatchlistQuery(WLGoogle.getQuery());
    if (watchlist) ensurePanel(watchlist.kind);

    entity = entity || WLGoogle.findEntity();
    if (entity) ensureButtons(entity);
  }

  // A saved title may be missing details: no poster on this computer yet, or no year or
  // movie/TV label because it was imported. This page has them, so fill them in.
  function fillDetailsIfSaved() {
    if (entity) WL.fillDetails(WL.idFor(entity), entity);
  }

  run();
  fillDetailsIfSaved();

  // Parts of the page render late; put the button back if Google re-renders the header.
  let pending = 0;
  const observer = new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(run, 250);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 20000);
})();
