// Reads Google's results page: is this a movie/TV page, and is this a "my watchlist" search?
//
// Google's class names change often, so we only rely on attributes that have
// been stable for years: data-maindata / data-kpid (the Knowledge Graph entity
// behind the page) and data-attrid (which knowledge-panel fact a block shows).

(() => {
  // What was searched: the address bar's q, plus what's in the search box when the page
  // loads. They differ when Google corrects a typo ("my watchlis" → "my watchlist"): the
  // address keeps the typo while the box shows the corrected search.
  function getQueries() {
    const fromUrl = new URLSearchParams(location.search).get('q') || '';
    const box = document.querySelector('textarea[name="q"], input[name="q"]');
    return [fromUrl, box ? box.value : ''].map((q) => q.trim()).filter(Boolean);
  }

  // Every way of writing the query, without spaces: [prefix][core][suffix] → kind filter.
  const PREFIXES = ['', 'my', 'google', 'mygoogle', 'show', 'showmy'];
  const CORES = ['watchlist', 'wanttowatch', 'wanttowatchlist'];
  const SUFFIXES = {
    '': 'all', movies: 'movie', movie: 'movie', films: 'movie', film: 'movie',
    tv: 'tv', tvshows: 'tv', tvshow: 'tv', shows: 'tv', series: 'tv', tvseries: 'tv',
  };
  const TARGETS = PREFIXES.flatMap((p) => CORES.flatMap((c) => Object.entries(SUFFIXES).map(([s, kind]) => [p + c + s, kind])));

  function editDistance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = row;
    }
    return prev[b.length];
  }

  // "my watchlist", "watchlist", "my watch list tv shows", "google watchlist movies", and
  // small typos of them ("my watchlis", "my wacthlist"). Returns null when the query
  // isn't a watchlist search, else { kind: 'all' | 'movie' | 'tv' }.
  function parseWatchlistQuery(q) {
    const squashed = q.toLowerCase().replace(/[^a-z]/g, '');
    // Typos rarely lose the "w" of watch; requiring it keeps "match list" from matching.
    if (squashed.length < 6 || squashed.length > 30 || !squashed.includes('w')) return null;
    let best = null;
    for (const [target, kind] of TARGETS) {
      // One typo allowed in short targets, two in longer ones.
      const allowed = target.length >= 9 ? 2 : 1;
      if (Math.abs(target.length - squashed.length) > allowed) continue;
      const d = editDistance(squashed, target);
      if (d <= allowed && (!best || d < best.d)) best = { d, kind };
      if (best && best.d === 0) break;
    }
    return best && { kind: best.kind };
  }

  // data-maindata looks like [null, "/m/0661ql3", "Inception", "vise:/m/0661ql3", ["FILM"], ...]
  function readMainData() {
    for (const node of document.querySelectorAll('[data-maindata]')) {
      try {
        const data = JSON.parse(node.getAttribute('data-maindata'));
        const kinds = Array.isArray(data[4]) ? data[4] : [];
        const kind = kinds.includes('FILM') ? 'movie' : kinds.includes('TV') ? 'tv' : null;
        if (kind && typeof data[2] === 'string') {
          return { id: typeof data[1] === 'string' && data[1].startsWith('/') ? data[1] : null, title: data[2], kind };
        }
      } catch {
        // Not JSON we understand; try the next one.
      }
    }
    return null;
  }

  // Fallback when data-maindata is missing: the knowledge-panel facts say film or TV.
  function readAttrids() {
    const attrids = [...document.querySelectorAll('[data-attrid^="kc:/"]')].map((n) => n.getAttribute('data-attrid'));
    const kind = attrids.some((a) => a.startsWith('kc:/film/film:'))
      ? 'movie'
      : attrids.some((a) => a.startsWith('kc:/tv/tv_program:'))
        ? 'tv'
        : null;
    const titleNode = document.querySelector('[data-attrid="title"]');
    if (!kind || !titleNode) return null;
    const kpid = document.querySelector('[data-kpid^="vise:/"]')?.getAttribute('data-kpid');
    return { id: kpid ? kpid.slice('vise:'.length) : null, title: titleNode.textContent.trim(), kind };
  }

  // "CBFC: U/A 2010 ‧ Sci-fi/Action ‧ 2h 28m" or "2008 ‧ Drama ‧ 5 seasons"
  function readYear() {
    for (const node of document.querySelectorAll('[data-attrid="subtitle"]')) {
      const m = node.textContent.match(/\b(18|19|20)\d{2}\b/);
      if (m) return Number(m[0]);
    }
    return null;
  }

  function findPosterImage() {
    return (
      document.querySelector('[data-attrid="VisualDigestFirstImageResult"] img') ||
      document.querySelector('[data-attrid="image"] img') ||
      document.querySelector('.kp-wholepage g-img img, [data-attrid="kc:/film/film:media_actions_wholepage"] img')
    );
  }

  function capturePoster() {
    return WLUI.shrinkImage(findPosterImage());
  }

  // Google ships most images as a 1×1 placeholder plus a script that fills it in later:
  //   var s='data:image/jpeg;base64,…';var ii=['dimg_…'];_setImagesSrc(ii,s);
  // or, for images loaded from the web, a google.ldi={"dimg_…":"https://…"} map.
  function imageSourceIn(html, img) {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('http') || (src.startsWith('data:image/') && src.length > 200)) return src;
    if (!img.id) return null;
    const unescape = (s) => s.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const inline = /var s='(data:image\/[^']+)';var ii=\[([^\]]*)\]/g;
    let m;
    while ((m = inline.exec(html))) if (m[2].includes(`'${img.id}'`)) return unescape(m[1]);
    const web = html.match(new RegExp(`"${img.id}":"(https://[^"]+)"`));
    return web ? unescape(web[1]) : null;
  }

  async function fetchPage(href) {
    // Relative to the page we're on, so it stays on google.co.in etc.
    const url = new URL(href);
    url.searchParams.set('hl', 'en');
    const res = await fetch(url.pathname + url.search, { credentials: 'include' });
    // Google's "unusual traffic" check: tell the caller to stop for a while.
    if (res.status === 429 || new URL(res.url).pathname.startsWith('/sorry')) throw new Error('rate-limited');
    return res.ok ? res.text() : null;
  }

  // Looks up a saved title's Google page in the background: { kind, year, poster } or null.
  // Google lays the same title out in different ways. One layout has a large poster; the
  // other only a 37×56 thumbnail. If the first lookup gets only the thumbnail, a plain
  // search for the title often gets the large layout, so try that once more.
  async function fetchDetails(item, { pause = 1500 } = {}) {
    const html = await fetchPage(WL.googleUrl(item));
    const first = html && readPage(html);
    if (!first || first.largePoster || item.id.startsWith('q:')) return first;
    await new Promise((resolve) => setTimeout(resolve, pause));
    const plain = 'https://www.google.com/search?q=' + encodeURIComponent(item.title + (first.year ? ' ' + first.year : ''));
    const html2 = await fetchPage(plain);
    const second = html2 && readPage(html2);
    return second && second.largePoster && second.kind === first.kind ? { ...first, poster: second.poster } : first;
  }

  function readPage(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    let kind = null;
    for (const node of doc.querySelectorAll('[data-maindata]')) {
      try {
        const kinds = JSON.parse(node.getAttribute('data-maindata'))[4] || [];
        kind = kinds.includes('FILM') ? 'movie' : kinds.includes('TV') ? 'tv' : null;
        if (kind) break;
      } catch {
        // Not JSON we understand; try the next one.
      }
    }
    const subtitle = doc.querySelector('[data-attrid="subtitle"]')?.textContent || '';
    const year = subtitle.match(/\b(18|19|20)\d{2}\b/);

    const large = doc.querySelector('[data-attrid="VisualDigestFirstImageResult"] img');
    const small = doc.querySelector('[data-attrid="image"] img');
    const largePoster = large && imageSourceIn(html, large);
    const poster = largePoster || (small && imageSourceIn(html, small)) || null;
    return { kind, year: year ? Number(year[0]) : null, poster, largePoster: Boolean(largePoster) };
  }

  // The movie or TV show this page is about, or null.
  function findEntity() {
    const base = readMainData() || readAttrids();
    if (!base) return null;
    return { ...base, year: readYear(), getPoster: capturePoster };
  }

  // The "Watch movie" / "Watch show" section with Google's round buttons (Watch now,
  // Already watched, Want to watch). Returns each copy Google renders as
  // { row, want }: the row holding the buttons, and Google's "Want to watch" button when
  // Google shows it (it's often missing, which is the whole point of this extension).
  function findWatchActions() {
    const found = [];
    for (const section of document.querySelectorAll('[data-attrid$=":media_actions_wholepage"]')) {
      const buttons = [...section.querySelectorAll('[role="button"]')];
      const want = buttons.find((b) => /want to watch|watchlist/i.test(b.getAttribute('aria-label') || b.textContent || '')) || null;
      const row = (want || buttons[buttons.length - 1])?.parentElement;
      if (row) found.push({ row, want });
    }
    return found;
  }

  // The "2010 ‧ Sci-fi ‧ 2h 28m" line under the title; a compact button goes right after it.
  // (The header around it has a fixed height, so the button has to share this line.)
  // Google renders several copies of the header for different screen widths, so there can be more than one.
  function findSubtitles() {
    return [...document.querySelectorAll('[data-attrid="subtitle"]')];
  }

  // Where the watchlist panel goes: above everything else in the results, including the
  // AI Overview, which on wide screens sits outside the results column in #rcnt's grid.
  // Returns { place(host) } or null.
  function findPanelSpot() {
    const column = document.querySelector('#center_col');
    if (!column) {
      const fallback = document.querySelector('#rcnt') || document.querySelector('#main');
      return fallback && { place: (host) => fallback.prepend(host) };
    }
    const grid = column.parentElement;
    const first = [...grid.children].find((n) => n.tagName !== 'STYLE' && n.tagName !== 'SCRIPT');
    if (getComputedStyle(grid).display === 'grid' && first && first !== column) {
      return {
        place(host) {
          // Line up with the results column instead of spanning the whole page.
          host.style.gridColumn = getComputedStyle(column).gridColumn;
          grid.insertBefore(host, first);
        },
      };
    }
    return { place: (host) => column.prepend(host) };
  }

  globalThis.WLGoogle = { getQueries, parseWatchlistQuery, findEntity, findSubtitles, findWatchActions, findPanelSpot, fetchDetails, capturePoster };
})();
