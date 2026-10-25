// Runs on Google's saved-items pages (google.com/interests/saved): adds an
// "Import to My Watchlist" button that copies the titles shown on the page.
//
// Each title on a collection page links to a Google search such as
//   /search?q=At+Midnight&stick=H4sIAAAAAAAAAONgVuLV…
// q is the title. stick is gzipped, base64-encoded data that holds the title's
// Knowledge Graph id (/m/… or /g/…), plus sometimes a hint of film or TV.
// Older pages may link with kgmid=/m/… directly instead.

(() => {
  const { el } = WLUI;

  // Returns { id, kind } from a stick value, or null if it can't be read.
  async function readStick(stick) {
    try {
      // URLSearchParams turns "+" into " "; undo that, and accept the URL-safe alphabet too.
      let b64 = stick.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const text = new TextDecoder('latin1').decode(await new Response(stream).arrayBuffer());
      const ids = text.match(/\/[mg]\/[0-9a-z_]{2,}/g);
      if (!ids) return null;
      // When a link carries two ids (the page it came from, then the title), the title is last.
      const kind = /\/tv\/|tv_program/.test(text) ? 'tv' : /\/film\//.test(text) ? 'movie' : null;
      return { id: ids[ids.length - 1], kind };
    } catch {
      return null;
    }
  }

  // The poster for a link: an image inside it, or in the card around it.
  function posterImageFor(link) {
    const usable = (img) => img && img.src && img.naturalWidth >= 50;
    const inside = [...link.querySelectorAll('img')].find(usable);
    if (inside) return inside;
    let node = link.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      // Stop before we reach a container that holds other titles' cards too.
      if (node.querySelectorAll('a[href*="stick="], a[href*="kgmid="]').length > 1) break;
      const img = [...node.querySelectorAll('img')].find(usable);
      if (img) return img;
    }
    return null;
  }

  async function scan() {
    const found = new Map();
    for (const link of document.querySelectorAll('a[href*="stick="], a[href*="kgmid="]')) {
      let url;
      try {
        url = new URL(link.href, location.href);
      } catch {
        continue;
      }
      if (!url.pathname.endsWith('/search')) continue;
      const title = (url.searchParams.get('q') || '').trim();
      if (!title) continue;

      let id = url.searchParams.get('kgmid');
      let kind = null;
      if (!id || !/^\/[mg]\//.test(id)) {
        const stick = url.searchParams.get('stick');
        const info = stick ? await readStick(stick) : null;
        id = info ? info.id : null;
        kind = info ? info.kind : null;
      }

      const item = { id, title, year: null, kind };
      const key = WL.idFor(item);
      if (found.has(key)) continue;
      item.poster = await WLUI.shrinkImage(posterImageFor(link));
      found.set(key, item);
    }
    return [...found.values()];
  }

  const host = document.createElement('div');
  const root = WLUI.mount(host);
  root.classList.add('wl-floating');
  const status = el('div', { class: 'wl-btn-error', role: 'status', style: 'color:var(--wl-text);background:var(--wl-bg);padding:4px 8px;border-radius:8px;max-width:280px' });
  const btn = el('button', { class: 'wl-btn', type: 'button', html: WLUI.ICONS.bookmark + '<span>Import to My Watchlist</span>' });
  root.append(btn, status);
  document.body.append(host);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = 'Reading this page…';
    try {
      const items = await scan();
      if (!items.length) {
        status.textContent = 'No movies or shows found on this page. Open your watchlist collection, scroll to the bottom so every title loads, then try again.';
        return;
      }
      status.textContent = '';
      if (!confirm(`Copy ${items.length} titles from this page into My Watchlist?`)) return;
      const r = await WL.addMany(items);
      status.textContent = `Imported ${r.added} titles` +
        (r.skipped ? `, ${r.skipped} were already on your list` : '') + '. ' +
        'Missing posters and years fill in by themselves over the next few minutes. Search “my watchlist” on Google to see your list.';
      WLFiller.start();
    } catch (err) {
      status.textContent = 'Import failed: ' + (err.message || err);
    } finally {
      btn.disabled = false;
    }
  });
})();
