// Watchlist storage, shared by the content scripts, the popup and the background sync.
//
// Everything lives in chrome.storage.local:
//   "t:<id>"  a title: { n: name, y: year, k: kind, a: addedAt, w: watchedAt, u: updatedAt }
//   "p:<id>"  its poster (a small data: URL or a web address)
//   "d:<id>"  a removed title, kept until the removal has reached the sync server: { n, u }
//   "o:<id>"  "this title has changes the server hasn't seen yet"; the value is a stamp,
//             so a sync only clears it if nothing changed again while it was uploading
//
// <id> is Google's Knowledge Graph id (e.g. "/m/0661ql3") when we have one,
// otherwise "q:<title>|<year>".
//
// Versions before 0.2 kept titles in chrome.storage.sync; they're copied over once.

(() => {
  const local = chrome.storage.local;

  const ITEM = 't:';
  const POSTER = 'p:';
  const REMOVED = 'd:';
  const DIRTY = 'o:';
  const MIGRATED = 'migrated:v2';

  // kind is 'movie', 'tv' or null (unknown, e.g. imported titles until their page is opened).
  const KIND_CODES = { movie: 'm', tv: 't' };
  const KINDS = { m: 'movie', t: 'tv' };

  const pack = (item, updatedAt) => ({
    n: item.title,
    y: item.year || 0,
    k: KIND_CODES[item.kind] || 'u',
    a: item.addedAt || Date.now(),
    w: item.watchedAt || 0,
    u: updatedAt,
  });

  const unpack = (id, rec, poster) => ({
    id,
    title: rec.n,
    year: rec.y || null,
    kind: KINDS[rec.k] || null,
    addedAt: rec.a,
    watchedAt: rec.w || null,
    updatedAt: rec.u || rec.a,
    poster: poster || null,
  });

  const stamp = () => Date.now() + Math.random();
  const dirty = (id) => ({ [DIRTY + id]: stamp() });

  const fallbackId = (title, year) =>
    'q:' + title.toLowerCase().replace(/\s+/g, ' ').trim() + '|' + (year || '');

  const idFor = (item) => item.id || fallbackId(item.title, item.year);

  const googleUrl = (item) =>
    item.id.startsWith('q:')
      ? 'https://www.google.com/search?q=' + encodeURIComponent(item.title + (item.year ? ' ' + item.year : ''))
      : 'https://www.google.com/search?kgmid=' + encodeURIComponent(item.id);

  // Copies titles saved by version 0.1 (in chrome.storage.sync) into local storage, once.
  // Safe to run from several pages at the same time: every copy writes the same data.
  async function migrate() {
    const flag = await local.get(MIGRATED);
    if (flag[MIGRATED]) return;
    const old = await chrome.storage.sync.get(null);
    const current = await local.get(null);
    const writes = {};
    for (const [key, rec] of Object.entries(old)) {
      if (!key.startsWith(ITEM) || current[key]) continue;
      const id = key.slice(ITEM.length);
      writes[key] = { ...rec, u: rec.u || rec.a || Date.now() };
      Object.assign(writes, dirty(id));
    }
    writes[MIGRATED] = Date.now();
    await local.set(writes);
  }

  const ready = migrate();

  async function getAll() {
    await ready;
    const all = await local.get(null);
    return Object.keys(all)
      .filter((key) => key.startsWith(ITEM))
      .map((key) => {
        const id = key.slice(ITEM.length);
        return unpack(id, all[key], all[POSTER + id]);
      })
      .sort((a, b) => b.addedAt - a.addedAt);
  }

  async function has(id) {
    await ready;
    const key = ITEM + id;
    return key in (await local.get(key));
  }

  // Adds or updates one title. Returns the stored item.
  async function add(item) {
    await ready;
    const id = idFor(item);
    const writes = { [ITEM + id]: pack(item, Date.now()), ...dirty(id) };
    if (item.poster) writes[POSTER + id] = item.poster;
    await local.set(writes);
    await local.remove(REMOVED + id);
    return { ...item, id };
  }

  // Adds many titles in one write. Titles already on the list are left alone, except
  // that they get a poster if they have none on this computer yet.
  // Returns { added, skipped }.
  async function addMany(items) {
    await ready;
    const all = await local.get(null);
    const writes = {};
    const revived = [];
    let added = 0;
    let skipped = 0;
    const now = Date.now();
    items.forEach((item, i) => {
      if (!item || !item.title) return;
      const id = idFor(item);
      const key = ITEM + id;
      if (key in all || key in writes) {
        if (key in all && item.poster && !all[POSTER + id]) Object.assign(writes, { [POSTER + id]: item.poster }, dirty(id));
        skipped++;
        return;
      }
      // Keep the incoming order: first item ends up newest.
      writes[key] = pack({ ...item, addedAt: item.addedAt || now - i }, now);
      Object.assign(writes, dirty(id));
      if (item.poster) writes[POSTER + id] = item.poster;
      if (all[REMOVED + id]) revived.push(REMOVED + id);
      added++;
    });
    if (Object.keys(writes).length) await local.set(writes);
    if (revived.length) await local.remove(revived);
    return { added, skipped };
  }

  async function remove(id) {
    await ready;
    const got = await local.get(ITEM + id);
    const rec = got[ITEM + id];
    await local.set({ [REMOVED + id]: { n: rec ? rec.n : id, u: Date.now() }, ...dirty(id) });
    await local.remove([ITEM + id, POSTER + id]);
  }

  async function setWatched(id, watched) {
    await ready;
    const key = ITEM + id;
    const got = await local.get(key);
    if (!got[key]) return;
    await local.set({ [key]: { ...got[key], w: watched ? Date.now() : 0, u: Date.now() }, ...dirty(id) });
  }

  // Fills in what a saved title is missing (year, movie/TV, or a poster on this computer)
  // from its Google page. Never overwrites what's already there, and doesn't count as an
  // edit: the server merges details in without letting them undo other changes.
  async function fillDetails(id, { year, kind, getPoster }) {
    await ready;
    const key = ITEM + id;
    const posterKey = POSTER + id;
    const got = await local.get([key, posterKey]);
    const rec = got[key];
    if (!rec) return;
    const writes = {};
    const update = {};
    if (!rec.y && year) update.y = year;
    if ((!rec.k || rec.k === 'u') && KIND_CODES[kind]) update.k = KIND_CODES[kind];
    if (Object.keys(update).length) writes[key] = { ...rec, ...update };
    if (!got[posterKey] && getPoster) {
      const poster = await getPoster();
      if (poster) writes[posterKey] = poster;
    }
    if (Object.keys(writes).length) await local.set({ ...writes, ...dirty(id) });
  }

  // Calls cb whenever the list changes, on this computer or through sync.
  function onChange(cb) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(ITEM) || key.startsWith(POSTER))) cb();
    });
  }

  // ---- Used by the background sync ----

  // Everything the server hasn't seen yet, in the server's format, plus the stamps needed
  // to mark it as sent afterwards.
  async function pendingChanges() {
    await ready;
    const all = await local.get(null);
    const changes = [];
    const stamps = {};
    for (const key of Object.keys(all)) {
      if (!key.startsWith(DIRTY)) continue;
      const id = key.slice(DIRTY.length);
      stamps[id] = all[key];
      const rec = all[ITEM + id];
      const removed = all[REMOVED + id];
      if (rec) {
        const item = unpack(id, rec, all[POSTER + id]);
        changes.push({
          id, title: item.title, year: item.year, kind: item.kind, addedAt: item.addedAt,
          watchedAt: item.watchedAt, poster: item.poster, deleted: false, updatedAt: item.updatedAt,
        });
      } else if (removed) {
        changes.push({ id, title: removed.n, deleted: true, updatedAt: removed.u });
      }
    }
    return { changes, stamps };
  }

  // Marks changes as received by the server, unless they were edited again meanwhile.
  async function markSent(stamps) {
    const ids = Object.keys(stamps);
    if (!ids.length) return;
    const now = await local.get(ids.map((id) => DIRTY + id));
    const done = ids.filter((id) => now[DIRTY + id] === stamps[id]);
    await local.remove(done.flatMap((id) => [DIRTY + id, REMOVED + id]));
  }

  // Marks every title as unsent, so the next sync uploads the whole list (used on sign-in).
  async function markAllUnsent() {
    await ready;
    const all = await local.get(null);
    const writes = {};
    for (const key of Object.keys(all)) {
      if (key.startsWith(ITEM)) Object.assign(writes, dirty(key.slice(ITEM.length)));
      if (key.startsWith(REMOVED)) Object.assign(writes, dirty(key.slice(REMOVED.length)));
    }
    if (Object.keys(writes).length) await local.set(writes);
  }

  // Applies titles that changed on the server. A local change the server hasn't seen yet
  // and that is newer than the server's copy wins; details are filled in either way.
  async function applyRemote(items) {
    await ready;
    if (!items.length) return;
    const all = await local.get(null);
    const writes = {};
    const removals = [];
    for (const r of items) {
      const id = r.id;
      const rec = all[ITEM + id];
      const removed = all[REMOVED + id];
      const localUpdatedAt = rec ? rec.u || rec.a : removed ? removed.u : -1;
      const pending = Boolean(all[DIRTY + id]);
      const remoteWins = !(pending && localUpdatedAt > r.updatedAt);

      if (remoteWins && r.deleted) {
        if (rec) removals.push(ITEM + id, POSTER + id);
        if (removed) removals.push(REMOVED + id, DIRTY + id);
        continue;
      }
      if (remoteWins) {
        writes[ITEM + id] = {
          n: r.title,
          y: r.year || (rec && rec.y) || 0,
          k: KIND_CODES[r.kind] || (rec && rec.k) || 'u',
          a: r.addedAt,
          w: r.watchedAt || 0,
          u: r.updatedAt,
        };
        if (removed) removals.push(REMOVED + id);
      } else if (rec) {
        // Keep our newer state, but take any details we're missing.
        const update = {};
        if (!rec.y && r.year) update.y = r.year;
        if ((!rec.k || rec.k === 'u') && KIND_CODES[r.kind]) update.k = KIND_CODES[r.kind];
        if (Object.keys(update).length) writes[ITEM + id] = { ...rec, ...update };
      }
      if (r.poster && !all[POSTER + id] && !(removed && !remoteWins)) writes[POSTER + id] = r.poster;
    }
    if (Object.keys(writes).length) await local.set(writes);
    if (removals.length) await local.remove(removals);
  }

  // True if version string a ("0.5.0") is newer than b.
  function isNewerVersion(a, b) {
    const [x, y] = [a, b].map((v) => String(v).split('.').map(Number));
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
  }

  globalThis.WL = {
    getAll, has, add, addMany, remove, setWatched, fillDetails, onChange, idFor, googleUrl, isNewerVersion,
    pendingChanges, markSent, markAllUnsent, applyRemote,
  };
})();
