// Shared UI: the Watchlist button and the list view used on Google's results
// page and in the toolbar popup. Everything is built with plain DOM so it can
// live inside a shadow root, away from Google's own CSS.

(() => {
  const ICONS = {
    bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2zm0 15-5-2.18L7 18V5h10v13z"/></svg>',
    bookmarkFilled: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 12.5 10c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 10.53 17.15 8 12.5 8z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
  };

  const CSS = `
    .wl-root {
      --wl-bg: #ffffff;
      --wl-surface: #f1f3f4;
      --wl-border: #dadce0;
      --wl-text: #1f1f1f;
      --wl-muted: #5f6368;
      --wl-accent: #0b57d0;
      --wl-accent-soft: #d3e3fd;
      --wl-on-accent-soft: #041e49;
      --wl-danger: #b3261e;
      font-family: "Google Sans", Roboto, Arial, system-ui, sans-serif;
      color: var(--wl-text);
      font-size: 14px;
      line-height: 1.4;
    }
    .wl-root[data-theme="dark"] {
      --wl-bg: #1f1f1f;
      --wl-surface: #303134;
      --wl-border: #3c4043;
      --wl-text: #e8eaed;
      --wl-muted: #9aa0a6;
      --wl-accent: #a8c7fa;
      --wl-accent-soft: #004a77;
      --wl-on-accent-soft: #c2e7ff;
      --wl-danger: #f2b8b5;
    }
    .wl-root *, .wl-root *::before, .wl-root *::after { box-sizing: border-box; }
    .wl-root svg { width: 18px; height: 18px; fill: currentColor; flex: none; }

    /* Watchlist button */
    .wl-btn {
      display: inline-flex; align-items: center; gap: 8px;
      height: 36px; padding: 0 16px 0 12px; margin: 10px 0 4px;
      border: 1px solid var(--wl-border); border-radius: 18px;
      background: var(--wl-bg); color: var(--wl-accent);
      font: inherit; font-weight: 500; cursor: pointer;
      transition: background-color .15s, border-color .15s;
    }
    .wl-btn:hover { background: var(--wl-surface); }
    .wl-btn:focus-visible { outline: 2px solid var(--wl-accent); outline-offset: 2px; }
    .wl-btn[aria-pressed="true"] {
      background: var(--wl-accent-soft); color: var(--wl-on-accent-soft); border-color: transparent;
    }
    .wl-btn[disabled] { opacity: .6; cursor: progress; }
    .wl-btn.wl-compact { height: 24px; margin: 0; padding: 0 10px 0 6px; gap: 4px; border-radius: 12px; font-size: 13px; }
    .wl-btn.wl-compact svg { width: 16px; height: 16px; }
    .wl-inline { display: flex; align-items: center; gap: 8px; }
    .wl-inline .wl-btn-error { margin: 0; }
    .wl-btn-error { margin: 4px 0 0; color: var(--wl-danger); font-size: 12px; }
    .wl-floating { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; }
    .wl-floating .wl-btn { margin: 0; box-shadow: 0 2px 8px rgba(0,0,0,.2); }

    /* List view */
    .wl-list { background: transparent; }
    .wl-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .wl-title { margin: 0; font-size: 22px; font-weight: 400; }
    .wl-sub { color: var(--wl-muted); font-size: 13px; }
    .wl-controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 16px; }
    .wl-chip {
      height: 32px; padding: 0 14px; border-radius: 8px;
      border: 1px solid var(--wl-border); background: transparent; color: var(--wl-text);
      font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
    }
    .wl-chip:hover { background: var(--wl-surface); }
    .wl-chip[aria-pressed="true"] { background: var(--wl-accent-soft); color: var(--wl-on-accent-soft); border-color: transparent; }
    .wl-chip:focus-visible { outline: 2px solid var(--wl-accent); outline-offset: 2px; }
    .wl-sep { width: 1px; background: var(--wl-border); margin: 4px 4px; }
    .wl-search {
      flex: 1 1 140px; min-width: 0; height: 32px; padding: 0 12px; border-radius: 8px;
      border: 1px solid var(--wl-border); background: var(--wl-bg); color: var(--wl-text); font: inherit; font-size: 13px;
    }
    .wl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--wl-card-min, 128px), 1fr)); gap: 16px 12px; }
    .wl-card { position: relative; min-width: 0; }
    .wl-poster {
      display: block; aspect-ratio: 2 / 3; width: 100%; border-radius: 8px; overflow: hidden;
      background: var(--wl-surface); color: var(--wl-muted); text-decoration: none;
    }
    .wl-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .wl-poster-fallback {
      display: flex; align-items: center; justify-content: center; height: 100%; padding: 10px;
      text-align: center; font-size: 15px; font-weight: 500; color: var(--wl-text);
    }
    .wl-card[data-watched="true"] .wl-poster img { opacity: .55; }
    .wl-name {
      display: block; margin-top: 6px; color: var(--wl-text); text-decoration: none; font-weight: 500;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .wl-name:hover { text-decoration: underline; }
    .wl-meta { color: var(--wl-muted); font-size: 12px; }
    .wl-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; opacity: 0; transition: opacity .15s; }
    .wl-card:hover .wl-actions, .wl-card:focus-within .wl-actions { opacity: 1; }
    @media (hover: none) { .wl-actions { opacity: 1; } }
    .wl-icon-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px;
      border: 0; border-radius: 50%; background: rgba(32,33,36,.82); color: #fff; cursor: pointer;
    }
    .wl-icon-btn:hover { background: rgba(32,33,36,.95); }
    .wl-icon-btn:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
    .wl-empty { grid-column: 1 / -1; margin: 0; padding: 24px 0; color: var(--wl-muted); }
    .wl-head-side { display: inline-flex; align-items: baseline; gap: 12px; }
    .wl-fill-note { margin: 6px 0 0; color: var(--wl-muted); font-size: 12px; }
    .wl-fill-note[hidden] { display: none; }
    .wl-import-link { color: var(--wl-accent); font-size: 13px; font-weight: 500; text-decoration: none; }
    .wl-import-link:hover { text-decoration: underline; }
    .wl-welcome {
      grid-column: 1 / -1; padding: 16px; border: 1px solid var(--wl-border); border-radius: 12px; background: var(--wl-surface);
    }
    .wl-welcome p { margin: 0 0 10px; }
    .wl-welcome-title { font-size: 16px; font-weight: 500; }
    .wl-welcome-button {
      display: inline-block; margin: 2px 0 12px; padding: 8px 14px; border-radius: 18px;
      background: var(--wl-accent); color: var(--wl-bg); font-weight: 500; text-decoration: none;
    }
    .wl-welcome-button:hover { opacity: .9; }
    .wl-welcome .wl-welcome-alt { margin: 0; color: var(--wl-muted); font-size: 13px; }
  `;

  // Picks light or dark to match the page behind us.
  function detectTheme(el = document.body) {
    const bg = el && getComputedStyle(el).backgroundColor;
    const m = bg && bg.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3 && (m.length < 4 || Number(m[3]) > 0)) {
      const [r, g, b] = m.map(Number);
      return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? 'dark' : 'light';
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Creates a shadow-rooted host whose content is styled by CSS and themed to the page.
  function mount(host, theme = detectTheme()) {
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const root = document.createElement('div');
    root.className = 'wl-root';
    root.dataset.theme = theme;
    shadow.append(style, root);
    return root;
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children)) if (child != null) node.append(child);
    return node;
  }

  // Imported titles may not say whether they're a movie or a show; they get no label.
  const kindLabel = (kind) => (kind === 'tv' ? 'TV show' : kind === 'movie' ? 'Movie' : null);

  const POSTER_WIDTH = 180;

  // Returns a poster to store for an <img> or image address: a small JPEG copy of an inline
  // (data:) image, so hundreds fit comfortably in local storage, or the web address as is.
  async function shrinkImage(img) {
    if (typeof img === 'string') {
      const src = img;
      img = new Image();
      img.src = src;
    }
    if (!img || !img.src) return null;
    if (!img.src.startsWith('data:')) return img.src;
    try {
      if (!img.complete) await new Promise((resolve) => img.addEventListener('load', resolve, { once: true }));
      const scale = Math.min(1, POSTER_WIDTH / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.82);
    } catch {
      return img.src.length < 60000 ? img.src : null;
    }
  }

  // The "Add to watchlist" toggle for one title. compact: a small pill that fits on one line of text.
  function createWatchButton(entity, { compact = false } = {}) {
    const error = el(compact ? 'span' : 'div', { class: 'wl-btn-error', role: 'status' });
    const label = el('span');
    const icon = el('span', { style: 'display:inline-flex' });
    const btn = el('button', { class: compact ? 'wl-btn wl-compact' : 'wl-btn', type: 'button', 'aria-pressed': 'false' }, [icon, label]);
    const id = WL.idFor(entity);

    const render = (saved) => {
      btn.setAttribute('aria-pressed', String(saved));
      icon.innerHTML = saved ? ICONS.bookmarkFilled : ICONS.bookmark;
      label.textContent = saved ? 'On your watchlist' : 'Add to watchlist';
      btn.title = saved ? 'Remove from your watchlist' : 'Save to your watchlist';
    };

    const refresh = async () => render(await WL.has(id));

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      error.textContent = '';
      try {
        if (await WL.has(id)) await WL.remove(id);
        else await WL.add({ ...entity, id, poster: await entity.getPoster?.() });
      } catch (err) {
        error.textContent = err.message || String(err);
      }
      btn.disabled = false;
      refresh();
    });

    WL.onChange(refresh);
    refresh();
    return el('div', { class: compact ? 'wl-inline' : null }, [btn, error]);
  }

  function createCard(item, { openInNewTab }) {
    const href = WL.googleUrl(item);
    const target = openInNewTab ? '_blank' : null;
    const watched = Boolean(item.watchedAt);
    const poster = item.poster
      ? el('img', { src: item.poster, alt: '', loading: 'lazy' })
      : el('span', { class: 'wl-poster-fallback', text: item.title });

    return el('div', { class: 'wl-card', 'data-watched': String(watched) }, [
      el('a', { class: 'wl-poster', href, target, rel: target && 'noopener', tabindex: '-1', 'aria-hidden': 'true' }, poster),
      el('a', { class: 'wl-name', href, target, rel: target && 'noopener', title: item.title, text: item.title }),
      el('div', { class: 'wl-meta', text: [item.year, kindLabel(item.kind)].filter(Boolean).join(' · ') }),
      el('div', { class: 'wl-actions' }, [
        el('button', {
          class: 'wl-icon-btn', type: 'button',
          title: watched ? 'Move back to To watch' : 'Mark as watched',
          'aria-label': (watched ? 'Move back to To watch: ' : 'Mark as watched: ') + item.title,
          html: watched ? ICONS.undo : ICONS.check,
          onclick: () => WL.setWatched(item.id, !watched),
        }),
        el('button', {
          class: 'wl-icon-btn', type: 'button', title: 'Remove from watchlist',
          'aria-label': 'Remove from watchlist: ' + item.title,
          html: ICONS.close,
          onclick: () => WL.remove(item.id),
        }),
      ]),
    ]);
  }

  // Google's own saved items, where the old watchlist lives as a collection.
  const GOOGLE_SAVES_URL = 'https://www.google.com/interests/saved';

  // Shown while the list is empty: how to bring over an old Google watchlist, or start a new one.
  function createWelcome() {
    return el('div', { class: 'wl-welcome' }, [
      el('p', { class: 'wl-welcome-title', text: 'Your watchlist is empty.' }),
      el('p', {}, [
        el('strong', { text: 'Had a watchlist on Google? ' }),
        'Bring it over in a minute: open your Google saves, open the watchlist collection ' +
          '(often called “Search Watchlist” or “Google TV watchlist”), scroll to the bottom so every title loads, ' +
          'then click “Import to My Watchlist” in the bottom-right corner.',
      ]),
      el('a', { class: 'wl-welcome-button', href: GOOGLE_SAVES_URL, target: '_blank', rel: 'noopener', text: 'Open my Google saves →' }),
      el('p', { class: 'wl-welcome-alt', text: 'Or start fresh: search any movie or show on Google and press “Add to watchlist”.' }),
    ]);
  }

  // The full list with To watch / Watched tabs, a Movies / TV filter and a search box.
  // options: { heading, kind: 'all'|'movie'|'tv', openInNewTab, showSearch }
  function createListView(options = {}) {
    const state = { tab: 'towatch', kind: options.kind || 'all', query: '' };
    let items = [];

    const sub = el('span', { class: 'wl-sub' });
    const grid = el('div', { class: 'wl-grid' });
    const tabButtons = {};
    const kindButtons = {};

    const chip = (text, onclick) => el('button', { class: 'wl-chip', type: 'button', 'aria-pressed': 'false', text, onclick });

    tabButtons.towatch = chip('To watch', () => { state.tab = 'towatch'; render(); });
    tabButtons.watched = chip('Watched', () => { state.tab = 'watched'; render(); });
    kindButtons.all = chip('All', () => { state.kind = 'all'; render(); });
    kindButtons.movie = chip('Movies', () => { state.kind = 'movie'; render(); });
    kindButtons.tv = chip('TV shows', () => { state.kind = 'tv'; render(); });

    const search = options.showSearch
      ? el('input', {
          class: 'wl-search', type: 'search', placeholder: 'Search your list', 'aria-label': 'Search your list',
          oninput: (e) => { state.query = e.target.value.trim().toLowerCase(); render(); },
        })
      : null;

    const importLink = el('a', {
      class: 'wl-import-link', href: GOOGLE_SAVES_URL, target: '_blank', rel: 'noopener',
      text: 'Import from Google', title: 'Open your saved items on Google to copy your old watchlist over',
    });

    // "Adding posters and details (3 left)" while the background filler is working.
    const fillNote = el('p', { class: 'wl-fill-note', role: 'status', hidden: true });
    let fillNoteTimer = 0;
    const showFillProgress = (progress) => {
      clearTimeout(fillNoteTimer);
      const fresh = progress && Date.now() - progress.at < 30000;
      fillNote.hidden = !fresh;
      if (!fresh) return;
      fillNote.textContent = `Adding posters and details in the background (${progress.left} left)…`;
      fillNoteTimer = setTimeout(() => { fillNote.hidden = true; }, 30000);
    };
    chrome.storage.local.get('fill:progress').then((got) => showFillProgress(got['fill:progress']));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'fill:progress' in changes) showFillProgress(changes['fill:progress'].newValue);
    });

    const root = el('section', { class: 'wl-list', 'aria-label': 'Your watchlist' }, [
      el('div', { class: 'wl-head' }, [
        el('h2', { class: 'wl-title', text: options.heading || 'Your watchlist' }),
        el('span', { class: 'wl-head-side' }, [sub, importLink]),
      ]),
      fillNote,
      el('div', { class: 'wl-controls' }, [
        tabButtons.towatch, tabButtons.watched, el('span', { class: 'wl-sep' }),
        kindButtons.all, kindButtons.movie, kindButtons.tv, search,
      ]),
      grid,
    ]);

    function render() {
      const toWatch = items.filter((i) => !i.watchedAt);
      const watched = items.filter((i) => i.watchedAt);
      tabButtons.towatch.textContent = `To watch (${toWatch.length})`;
      tabButtons.watched.textContent = `Watched (${watched.length})`;
      for (const [key, b] of Object.entries(tabButtons)) b.setAttribute('aria-pressed', String(key === state.tab));
      for (const [key, b] of Object.entries(kindButtons)) b.setAttribute('aria-pressed', String(key === state.kind));
      sub.textContent = items.length === 1 ? '1 title' : `${items.length} titles`;

      let shown = state.tab === 'watched'
        ? watched.sort((a, b) => b.watchedAt - a.watchedAt)
        : toWatch;
      if (state.kind !== 'all') shown = shown.filter((i) => i.kind === state.kind);
      if (state.query) shown = shown.filter((i) => i.title.toLowerCase().includes(state.query));

      grid.replaceChildren(...shown.map((item) => createCard(item, options)));
      if (!items.length) {
        grid.replaceChildren(createWelcome());
      } else if (!shown.length) {
        let message;
        if (state.query) message = 'Nothing on your list matches that search.';
        else if (state.tab === 'watched') message = 'Nothing marked as watched yet.';
        else message = 'Nothing left to watch here.';
        grid.replaceChildren(el('p', { class: 'wl-empty', text: message }));
      }
    }

    async function load() {
      items = await WL.getAll();
      render();
    }

    WL.onChange(load);
    load();
    return root;
  }

  globalThis.WLUI = { CSS, ICONS, mount, detectTheme, el, shrinkImage, createWatchButton, createListView };
})();
