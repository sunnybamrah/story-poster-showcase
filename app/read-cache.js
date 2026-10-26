// A short, account-scoped memory cache avoids duplicate screen reads. Nothing is
// stored on disk. Mutations invalidate both settled and in-flight reads.
export function createReadCache({ now = Date.now, ttl = 15000 } = {}) {
  const entries = new Map(); let generation = 0;
  return {
    clear() { generation++; entries.clear(); },
    read(key, load) {
      const previous = entries.get(key);
      if (previous && previous.expires > now()) return previous.promise;
      const version = generation, entry = { expires: Infinity };
      entry.promise = Promise.resolve().then(load).then(value => {
        if (version === generation && entries.get(key) === entry) {
          const running = value.people?.some(person => ['running', 'queued'].includes(person.job?.status));
          if (running) entries.delete(key); else entry.expires = now() + ttl;
        }
        return value;
      }, error => { if (entries.get(key) === entry) entries.delete(key); throw error; });
      entries.set(key, entry);
      if (entries.size > 30) entries.delete(entries.keys().next().value);
      return entry.promise;
    },
  };
}
