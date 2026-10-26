const stable = new Set(['welcome', 'login', 'recovery', 'access', 'join', 'invites', 'owner', 'tonight', 'shelf', 'family', 'people', 'setup', 'library']);
const jobScreens = new Set(['result', 'story', 'feedback', 'wait']);
const uuid = /^[a-f0-9-]{36}$/;

export function rememberedView(raw) {
  let value; try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const places = Object.fromEntries(Object.entries(value.places ?? {}).filter(([id, anchor]) => (uuid.test(id) || id === 'sample') && typeof anchor === 'string' && /^story-(?:page-[12]|paragraph-[12]-\d{1,3}|tiny-try)$/.test(anchor)).slice(-20));
  return { screen: ['wait', 'result', 'story'].includes(value.screen) ? value.screen : null, sample: value.sample === true, jobId: uuid.test(value.jobId ?? '') ? value.jobId : null, lastOpenedJobId: uuid.test(value.lastOpenedJobId ?? '') ? value.lastOpenedJobId : value.sample !== true && uuid.test(value.jobId ?? '') ? value.jobId : null, textSize: value.textSize === 'larger' ? 'larger' : 'standard', places };
}

export function rememberOpened(raw, { jobId, sample = false, screen = null }) {
  const saved = rememberedView(raw);
  return { ...saved, screen, sample, jobId: !sample && uuid.test(jobId ?? '') ? jobId : null, lastOpenedJobId: !sample && uuid.test(jobId ?? '') ? jobId : saved.lastOpenedJobId };
}

export function ownedJobs(session) {
  return (session?.jobs ?? []).filter(job => (job.childId ?? 'primary') === session.childId);
}

export function recentWorkFor(session, raw) {
  const jobs = ownedJobs(session), saved = rememberedView(raw);
  return jobs.find(job => job.status === 'running') ?? jobs.find(job => job.id === saved.lastOpenedJobId) ?? jobs[0];
}

export function filterKits(session, query = '', status = 'all') {
  const needle = query.normalize('NFKC').toLocaleLowerCase().trim();
  return ownedJobs(session).filter(job => {
    const matchesStatus = status === 'all' || (status === 'saved' ? ['failed', 'paused'].includes(job.status) : job.status === status);
    const words = [job.result?.chapterTitle, job.result?.move?.name, job.move?.name, 'Chapter ' + job.chapterNumber].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase();
    return matchesStatus && (!needle || words.includes(needle));
  });
}

export function createRouteGuard() {
  let epoch = 0;
  return {
    invalidate() { epoch++; },
    version() { return epoch; },
    capture() { const own = epoch; return () => own === epoch; },
    begin() { const own = ++epoch; return () => own === epoch; },
  };
}

// Routes contain only a screen and an opaque saved-job id, never family input.
export function routeHash(screen, { jobId, sample = false } = {}) {
  if (['result', 'story'].includes(screen) && sample) return `#${screen === 'result' ? 'poster' : 'story'}/sample`;
  if (jobScreens.has(screen) && uuid.test(jobId ?? '')) return `#${screen}/${jobId}`;
  return `#${screen}`;
}

export function resolveRoute(hash, session, remembered = null, { resumeWork = false } = {}) {
  const [requested, target, extra] = String(hash ?? '').replace(/^#/, '').split('/');
  const fallback = session?.needsSetup ? 'setup' : session?.record ? 'tonight' : 'welcome';
  if (session?.needsSetup) return { screen: requested === 'recovery' ? 'recovery' : requested === 'owner' && session.isOwner ? 'owner' : 'setup' };
  if (extra !== undefined) return { screen: fallback };
  if (!target && (!requested || resumeWork && ['welcome', 'login', 'tonight', 'shelf'].includes(requested))) {
    const running = ownedJobs(session).find(job => job.status === 'running');
    if (running) return { screen: 'wait', job: running };
    if (session?.libraryJobs?.some(job => job.status === 'running')) return { screen: 'library' };
    const last = rememberedView(remembered);
    const opened = !last.sample && ['wait', 'result', 'story'].includes(last.screen) && ownedJobs(session).find(job => job.id === last.jobId);
    if (opened) {
      if (opened.status === 'complete' && opened.result) return { screen: last.screen === 'story' ? 'story' : 'result', job: opened };
      if (last.screen === 'wait') return { screen: 'wait', job: opened };
    }
    if (session?.record && session.look?.pending && requested !== 'shelf') return { screen: 'people' };
    if (!requested) return { screen: fallback };
  }
  if (stable.has(requested) && !target) {
    if (requested === 'owner') return { screen: session?.isOwner ? 'owner' : session ? fallback : 'login' };
    if (!session?.record) return { screen: ['welcome', 'login', 'recovery', 'access', 'join'].includes(requested) ? requested : 'welcome' };
    return { screen: requested === 'login' ? 'tonight' : requested };
  }
  // Shared result and poster links open the complete kit. Story reading is explicit.
  if (['result', 'story', 'poster'].includes(requested) && (target === 'sample' || !target && remembered?.sample === true)) return { screen: requested === 'story' ? 'story' : 'result', sample: true };
  if (session?.record && jobScreens.has(requested)) {
    const id = target ?? (['result', 'story'].includes(requested) ? remembered?.jobId : null);
    const job = uuid.test(id ?? '') && session.jobs?.find(item => item.id === id && (item.childId ?? 'primary') === session.childId);
    if (job && (requested === 'wait' || job.status === 'complete' && job.result)) return { screen: requested === 'wait' && job.status === 'complete' ? 'result' : requested, job };
  }
  return { screen: fallback };
}
