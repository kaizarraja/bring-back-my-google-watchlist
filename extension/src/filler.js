// Fills in what saved titles are missing (poster, year, movie/TV label), usually after an
// import, by looking each one up on Google in the background.
//
// Runs from any open Google page (search results or your saved items), one title every
// few seconds until nothing is left, so an imported list completes itself within minutes
// without looking like a flood of searches. Only one tab works at a time. A title that
// can't be filled is retried the next day, and if Google ever answers with its "unusual
// traffic" check, lookups stop for a day.

(() => {
  const GAP = 6000;
  const RETRY_AFTER = 24 * 60 * 60 * 1000;
  const PAUSE_AFTER_LIMIT = 24 * 60 * 60 * 1000;
  const LOCK_STALE = 30000;

  const LOCK = 'fill:lock';
  const PAUSED = 'fill:pausedAt';
  const PROGRESS = 'fill:progress'; // { left, at }, for the list's "adding details" note
  const TRIED = 'f:';

  const me = Math.random().toString(36).slice(2);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const store = chrome.storage.local;

  async function dueItems() {
    const items = (await WL.getAll()).filter((i) => !i.poster || !i.year || !i.kind);
    const tried = await store.get(items.map((i) => TRIED + i.id));
    const now = Date.now();
    return items
      .filter((i) => !(now - (tried[TRIED + i.id] || 0) < RETRY_AFTER))
      .sort((a, b) => Boolean(a.poster) - Boolean(b.poster)); // missing posters first: they show most
  }

  // True if this tab may work now (no other tab is busy), and marks it as busy.
  async function takeTurn() {
    const { [LOCK]: lock } = await store.get(LOCK);
    if (lock && lock.owner !== me && Date.now() - lock.at < LOCK_STALE) return false;
    await store.set({ [LOCK]: { owner: me, at: Date.now() } });
    return true;
  }

  async function finish() {
    const { [LOCK]: lock } = await store.get(LOCK);
    if (lock && lock.owner === me) await store.remove([LOCK, PROGRESS]);
  }

  let running = false;

  async function start() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const { [PAUSED]: pausedAt = 0 } = await store.get(PAUSED);
        if (Date.now() - pausedAt < PAUSE_AFTER_LIMIT) break;
        if (!(await takeTurn())) break;
        const due = await dueItems();
        if (!due.length) break;
        await store.set({ [PROGRESS]: { left: due.length, at: Date.now() } });

        const item = due[0];
        try {
          const found = await WLGoogle.fetchDetails(item);
          if (found) await WL.fillDetails(item.id, { ...found, getPoster: () => WLUI.shrinkImage(found.poster) });
        } catch (err) {
          if (err.message === 'rate-limited') {
            await store.set({ [PAUSED]: Date.now() });
            break;
          }
          // Anything else: leave this title as it is; it's tried again tomorrow.
        }
        await store.set({ [TRIED + item.id]: Date.now() });
        await sleep(GAP);
      }
    } finally {
      await finish();
      running = false;
    }
  }

  globalThis.WLFiller = { start, PROGRESS };
})();
