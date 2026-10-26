// Only the five pages in this open reader can live here. Closing it releases them.
export function createReaderPageCache(base, { fetchPage = fetch, makeURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL } = {}) {
  const entries = new Map();
  let disposed = false;
  function remove(page) {
    const entry = entries.get(page);
    if (!entry) return;
    entry.controller.abort();
    if (entry.url) revokeURL(entry.url);
    entries.delete(page);
  }
  function get(page, retry = false) {
    if (disposed || !Number.isInteger(page) || page < 1 || page > 5) return Promise.reject(Error('Page unavailable'));
    if (retry) remove(page);
    if (entries.has(page)) return entries.get(page).promise;
    const entry = { controller: new AbortController(), url: null };
    entry.promise = fetchPage(`${base}${page}.webp`, { credentials: 'same-origin', signal: entry.controller.signal })
      .then(response => { if (!response.ok) throw Error('Page unavailable'); return response.blob(); })
      .then(blob => {
        if (disposed || entry.controller.signal.aborted) throw Error('Reader closed');
        entry.url = makeURL(blob);
        return entry.url;
      }).catch(error => { if (entries.get(page) === entry) remove(page); throw error; });
    entries.set(page, entry);
    return entry.promise;
  }
  return { get, warm: (pages = [1, 2, 3, 4, 5]) => Promise.allSettled(pages.map(page => get(page))), invalidate: remove, dispose() { disposed = true; for (const page of entries.keys()) remove(page); } };
}
