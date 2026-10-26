import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, CssBaseline, Box, Container, Stack, Typography, Button, ButtonBase, TextField, MenuItem, Card, CardContent, Chip, AppBar, Toolbar, Alert, LinearProgress, CircularProgress, Accordion, AccordionSummary, AccordionDetails, FormControl, FormLabel, FormControlLabel, RadioGroup, Radio, Checkbox, BottomNavigation, BottomNavigationAction, Dialog, DialogTitle, DialogContent, DialogActions, Link, Menu, Tabs, Tab } from '@mui/material';
import { childLooks, defaultAppearance, appearanceFrom, appearanceDraftData } from './appearance.js';
import { appTheme } from './theme';
import { guideReaderLimitation, guideReaderClaim } from './reader-notes.js';
import FamilyPortraits from './FamilyPortraits';
import FamilySetup, { familySetupIssue } from './FamilySetup';
import TeachingLibrary, { GuideSources } from './TeachingLibrary';
import PosterReader from './PosterReader';
import KitFeedback from './KitFeedback';
import StoryReader from './StoryReader';
import SampleNarration from './SampleNarration';
import JobProgress, { savedProgress } from './JobProgress';
import PrintOptions from './PrintOptions';
import PracticePlan from './PracticePlan';
import GuideHelp from './GuideHelp';
import AboutStoryPoster from './AboutStoryPoster';
import MomentInput from './MomentInput';
import AccountRecovery from './AccountRecovery';
import OwnerKits from './OwnerKits';
import { AccessRequest, ApprovedSignup, FamilyInvites } from './FamilyAccess';
import DataPolicyConsent, { DataPolicyNotice } from './DataPolicyConsent';
import FamilyStylePicker, { StoryStylePicker } from './FamilyStylePicker';
import FamilyCast, { useFamilyPeople } from './FamilyCast';
import { createRouteGuard, resolveRoute, routeHash, rememberedView, rememberOpened, recentWorkFor, filterKits } from './navigation.js';
import './screens.css';
import { createReadCache } from './read-cache.js';
import { savedTagline, storyHonestyLabel } from './story-presentation.js';
import { defaultPictureStyleId, pictureStyleOptions, pictureStyleIdFor, pictureStyleOptionFor, lookFlowVersion } from './picture-styles.js';
import { dataPolicyNotice, dataPolicyVersion, dataPolicyConsentLabel, dataPolicyURL, childDataNotice, needsChildDataProtection, hasCurrentDataConsent } from './data-policy.js';

const screenReads = createReadCache();
async function requestAPI(path, body, method = body === undefined ? 'GET' : 'POST', accountId) {
  if (method !== 'GET') screenReads.clear();
  if (method === 'GET' && /^(portraits(?:\?|$)|story-looks$|library$|sample$)/.test(path)) return screenReads.read(`${accountId ?? 'guest'}:${path}`, () => fetchAPI(path, body, method, accountId));
  return fetchAPI(path, body, method, accountId);
}
async function fetchAPI(path, body, method, accountId) {
  let response;
  try { response = await fetch('/api/' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(accountId ? { 'X-Story-Poster-Account': accountId } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new Error('The app is not reachable. Your words stay here. Reconnect and try again.'); }
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message ?? 'Please try again.'), { status: response.status, data });
  return data;
}
const defaultFamily = { real: false, pictureStyleId: defaultPictureStyleId, nickname: '', age: 10, schoolGrade: null, pronouns: 'he/him', loves: ['drawing comics', 'soccer', 'space'], presetId: 'comet', appearance: defaultAppearance, familyContext: '', parents: [{ label: 'Dad', pronouns: 'he/him', hair: undefined }] };
const browserRead = key => { try { return typeof key === 'string' ? sessionStorage.getItem(key) : null; } catch { return null; } };
const browserWrite = (key, value) => { try { if (typeof key !== 'string') return false; sessionStorage.setItem(key, value); return true; } catch { return false; } };
const browserRemove = key => { if (typeof key !== 'string') return; try { sessionStorage.removeItem(key); } catch {} if (key.startsWith('sp-view-')) { try { localStorage.removeItem(key); } catch {} } };
// Only validated opaque view metadata persists after closing a tab. Draft words stay in session storage.
const readView = key => { try { return typeof key === 'string' ? localStorage.getItem(key) ?? browserRead(key) : null; } catch { return browserRead(key); } };
const writeView = (key, value) => { const safe = JSON.stringify(rememberedView(value)); browserWrite(key, safe); try { if (typeof key === 'string') localStorage.setItem(key, safe); return true; } catch { return false; } };
const familyFrom = (record, presets) => ({ real: record.real, pictureStyleId: pictureStyleIdFor(record), nickname: record.hero.nickname, age: record.hero.age, schoolGrade: record.hero.schoolGrade ?? null, pronouns: record.hero.pronouns, loves: record.hero.loves, familyContext: record.familyContext, dataPolicyConsent: record.dataPolicyConsent, appearance: appearanceFrom(record), presetId: record.hero.outfitChoice === 'custom' ? 'custom' : presets.find(p => JSON.stringify(p.outfit) === JSON.stringify(record.hero.lockedOutfit))?.id ?? 'custom', customOutfit: record.hero.lockedOutfit.join('; '), parents: (record.cast ?? []).filter(p => p.role === 'grown-up').map((p, i) => ({ label: record.storyPeople?.[i]?.storyName ?? record.parentLabel, pronouns: p.pronouns, hair: p.description.find(d => d.includes('hair')), customOutfit: p.outfit.join('; ') })) });
const ownerKey = saved => saved?.accountId ? saved.accountId + ':' + (saved.childId ?? 'setup') : saved?.record ? null : 'guest';
const draftKey = saved => ownerKey(saved) && saved?.record ? 'sp-draft-v2-' + ownerKey(saved) : null;
const viewKey = saved => saved?.record ? ownerKey(saved) ? 'sp-view-v2-' + ownerKey(saved) : null : 'sp-view-guest';
const defaultKitContext = () => ({ focusPersonId: 'child', storyMode: 'inspired', siblingChildIds: [], remembranceChildLed: false });
const intro = 'Revisit one difficult moment from your child’s day when you are both calm. Read, connect and learn together how to handle moments like it. Keep the poster as a reminder.';
function Panel({ children, tint = false }) { return <Card className={'content-panel' + (tint ? ' tinted' : '')}><CardContent><Stack spacing={2}>{children}</Stack></CardContent></Card>; }
function Heading({ title, children }) { return <Stack spacing={1.25} className="screen-heading"><Typography component="h1" variant="h1" tabIndex={-1} data-heading sx={{ '&:focus': { outline: 'none' } }}>{title}</Typography>{children && <Typography color="text.secondary">{children}</Typography>}</Stack>; }
function SharedRhyme({ result }) { const line = savedTagline(result); return line ? <Box className="shared-rhyme"><Typography component="p" variant="body2">A line to share, if you like</Typography><Typography component="p" className="shared-rhyme-line">{line}</Typography></Box> : null; }
function FirstStorySteps({ active, onStep }) { return <Box component="nav" className="first-story-steps" aria-label="Your first story">{['Account', 'People and pictures', 'Story'].map((label, index) => <Button key={label} aria-current={active === index + 1 ? 'step' : undefined} onClick={() => onStep?.(index + 1)}><span className="step-number">{index + 1}</span><span>{label}</span></Button>)}</Box>; }

function Receipt({ move }) { return <Accordion className="source-disclosure"><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography variant="body2" fontWeight={800}>Why this move?</Typography></AccordionSummary><AccordionDetails><Stack spacing={2}><Typography>{guideReaderClaim(move.id, move.science.claim)}</Typography><Typography variant="body2">{guideReaderLimitation(move.id, move.science.limitation)}</Typography>{move.science.wordingNote && <Alert severity="info">{move.science.wordingNote}</Alert>}<GuideSources sources={move.sources} /></Stack></AccordionDetails></Accordion>; }
function Privacy({ config = {} }) { return <Accordion className="source-disclosure"><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography variant="body2" fontWeight={800}>What gets sent, and what stays here</Typography></AccordionSummary><AccordionDetails><Stack spacing={1.5}><Typography variant="body2">{config.dataPolicyNotice ?? dataPolicyNotice}</Typography>{config.generationRoute !== 'subscription' && <Typography variant="body2">{childDataNotice}</Typography>}<Typography variant="body2">Picture setup sends your photo or appearance description to OpenAI to make the story drawings. Later pictures use your chosen drawings, without the day’s private sentence, family notes or names.</Typography><Typography variant="body2">The app keeps your login, notes, drawings, stories and check records. Deleting the family removes those saved records. Downloaded copies are separate. General teaching guides contain no family details and stay in the shared library.</Typography><Link href={config.dataPolicyURL ?? dataPolicyURL} target="_blank" rel="noreferrer">Read OpenAI’s data rules</Link></Stack></AccordionDetails></Accordion>; }
function RadioChoices({ label, value, options, onChange, name }) { return <FormControl className="choice-group"><FormLabel id={name + '-label'}>{label}</FormLabel><RadioGroup aria-labelledby={name + '-label'} name={name} value={value} onChange={event => onChange(event.target.value)}>{options.map(([id, title]) => <FormControlLabel key={id} value={id} control={<Radio />} label={title} />)}</RadioGroup></FormControl>; }

function SiteHeader({ mode, busy, screen, session, config, onHome, onShelf, onFamily, onOwner, onSignOut, readSample, onTheme, activity }) {
  const [accountAnchor, setAccountAnchor] = useState(null);
  const count = (session?.jobs ?? []).length;
  const choose = action => { setAccountAnchor(null); action(); };
  return <AppBar className={'app-header' + (screen === 'welcome' ? ' welcome-header' : '')} position="sticky" color="transparent" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider', pt: 'env(safe-area-inset-top)' }}><Container className="header-inner"><Toolbar disableGutters className="site-toolbar">
    <Box className="header-brand-row"><Button className="site-brand" color="inherit" onClick={onHome}>Story Poster</Button><Stack direction="row" spacing={.5} className="header-shortcuts">
      <Button size="small" onClick={onShelf} aria-label={count ? `Saved stories: ${count}` : 'No saved stories'}><span aria-hidden="true" className="stories-icon">📚</span>{count ? 'Stories' : 'No stories'}</Button>
      {session?.accountId && <Button size="small" onClick={event => setAccountAnchor(event.currentTarget)} aria-haspopup="menu" aria-expanded={Boolean(accountAnchor)} aria-label="Account and sign out"><span className="account-icon" aria-hidden="true">☰</span><span className="account-label">Account</span></Button>}
    </Stack></Box>
    <Stack direction="row" spacing={.5} className="header-navigation"><Button size="small" onClick={onHome}>Home</Button><GuideHelp compact requiresInvitation={config?.signup?.requiresInvitation === true || config?.signup?.mode === 'request'} /><Button size="small" onClick={onTheme} aria-label={mode === 'light' ? 'Use dark theme' : 'Use light theme'}>{mode === 'light' ? 'Dark' : 'Light'}</Button><AboutStoryPoster readSample={readSample} sampleAvailable={config?.sampleAvailable === true} /></Stack>
    <Menu anchorEl={accountAnchor} open={Boolean(accountAnchor)} onClose={() => setAccountAnchor(null)}><MenuItem onClick={() => choose(onFamily)}>Family and settings</MenuItem>{session?.isOwner && <MenuItem onClick={() => choose(onOwner)}>Review access requests</MenuItem>}<MenuItem disabled={busy} onClick={() => choose(onSignOut)}>Sign out</MenuItem></Menu>
  </Toolbar>{activity && <Box className="global-activity" data-active={activity.active} role="status"><span aria-hidden="true">{activity.active ? '●' : '○'}</span> {activity.message}</Box>}</Container></AppBar>;
}

function App() {
  const [mode, setMode] = useState(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const theme = useMemo(() => appTheme(mode), [mode]);
  const [config, setConfig] = useState(null), [session, storeSession] = useState(null), [screen, setScreen] = useState('welcome'), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [setupSection, setSetupSection] = useState('child'), [familySection, setFamilySection] = useState('people');
  const [editingPeople, setEditingPeople] = useState(false), [addingChild, setAddingChild] = useState(false);
  const peopleReturn = useRef('family');
  const [portraitActivity, setPortraitActivity] = useState(null);
  const activityOwner = ownerKey(session);
  const onPortraitActivity = useCallback(status => setPortraitActivity(previous => status ? { owner: activityOwner, ...status } : previous?.owner === activityOwner ? null : previous), [activityOwner]);
  const peopleInputMemory = useRef({}), familyBaseline = useRef('');
  const [reuseGrownUps, setReuseGrownUps] = useState(true);
  const [family, setFamily] = useState(structuredClone(defaultFamily)), [setupStep, setSetupStep] = useState(1), [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [accountLink, setAccountLink] = useState(() => { const query = new URLSearchParams(location.search); return query.has('reset') ? { kind: 'reset', token: query.get('reset') } : query.has('verify') ? { kind: 'verify', token: query.get('verify') } : null; });
  const [listening, setListening] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [notifyWhenReady, setNotifyWhenReady] = useState(false);
  const [openPosterInitially, setOpenPosterInitially] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const shelfReturn = useRef(location.hash === '#shelf' || browserRead('sp-shelf-return') === 'yes');
  const ownerReturn = useRef(location.hash === '#owner');
  const [entryLink, setEntryLink] = useState(() => {
    const query = new URLSearchParams(location.search);
    if (query.has('invite')) return { kind: 'invite', token: query.get('invite') };
    if (query.has('referral')) return { kind: 'referral', token: query.get('referral') };
    if (query.has('reset') || query.has('verify') || !['#join', '#access'].includes(location.hash)) return null;
    try { const saved = JSON.parse(browserRead('sp-entry-link-v1')); return saved && ['invite', 'referral'].includes(saved.kind) && typeof saved.token === 'string' && saved.token.length <= 200 ? saved : null; } catch { return null; }
  });
  useEffect(() => { if (entryLink) browserWrite('sp-entry-link-v1', JSON.stringify(entryLink)); else browserRemove('sp-entry-link-v1'); }, [entryLink]);
  const [clarification, setClarification] = useState(null), [clarificationAnswer, setClarificationAnswer] = useState('');
  const [kitContext, setKitContext] = useState(defaultKitContext);
  const [tonight, setTonight] = useState(''), [allowRepeat, setAllowRepeat] = useState(false), [pick, setPick] = useState(null), [choice, setChoice] = useState(0), [parentReply, setParentReply] = useState(null);
  const [shelfQuery, setShelfQuery] = useState(''), [shelfStatus, setShelfStatus] = useState('all'), [exploreBeyond, setExploreBeyond] = useState(false);
  const [job, setJob] = useState(null), [result, setResult] = useState(null), [triedMove, setTriedMove] = useState(''), [didItHelp, setDidItHelp] = useState(''), [wallChoice, setWallChoice] = useState(''), [notes, setNotes] = useState(''), [confirmDelete, setConfirmDelete] = useState(false), [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const sessionRef = useRef(session); sessionRef.current = session;
  const routeGuard = useRef(createRouteGuard());
  const sessionReads = useRef(0);
  const momentVersion = useRef(0);
  const setSession = (next, restoring = false, preservePeople = false) => {
    const previous = sessionRef.current;
    if (ownerKey(next) !== ownerKey(previous)) {
      if (!preservePeople) { peopleInputMemory.current = {}; familyBaseline.current = ''; }
      if (!restoring) routeGuard.current.invalidate();
      setBusy(false); setError(''); setNotice(''); setConfirmDelete(false); setEditingPeople(false); setAddingChild(false); setSetupSection('child'); setFamilySection('people'); setSetupStep(1); setPassword(''); setUsername('');
      setSuggestion(null); setJob(null); setResult(null); setPick(null); setChoice(0); setParentReply(null); setTriedMove(''); setDidItHelp(''); setWallChoice(''); setAllowRepeat(false); setFamily(structuredClone(defaultFamily));
      setShelfQuery(''); setShelfStatus('all'); setExploreBeyond(false); setKitContext(defaultKitContext()); setClarification(null); setClarificationAnswer(''); setListening(false); setPeopleOpen(false); setNotifyWhenReady(false);
      setTonight(next?.record ? browserRead(draftKey(next)) ?? '' : ''); setNotes(next?.record?.familyContext ?? '');
      setScreen(next?.needsSetup ? 'setup' : next?.record ? 'tonight' : 'welcome'); history.replaceState(null, '', next?.needsSetup ? '#setup' : next?.record ? '#tonight' : '#welcome'); if (next?.needsSetup) setSetupStep(2);
    }
    sessionReads.current++; sessionRef.current = next; storeSession(next);
  };
  const api = async (...args) => {
    const owner = ownerKey(sessionRef.current), accountId = sessionRef.current?.accountId;
    const stale = () => Object.assign(new Error('This family view changed before the request returned.'), { code: 'STALE_OWNER' });
    if (owner === null) throw stale();
    let data;
    try { data = await requestAPI(args[0], args[1], args[2], accountId); } catch (error) {
      if (error.status === 409 && error.data?.code === 'FAMILY_SESSION_CHANGED') { const returnHash = location.hash; setSession(null); await load(returnHash); throw stale(); }
      if (owner !== ownerKey(sessionRef.current)) throw stale(); throw error;
    }
    if (owner !== ownerKey(sessionRef.current)) throw stale();
    return data;
  };
  const { people, loaded: peopleLoaded } = useFamilyPeople(api, session, kitContext.pictureStyleId ?? session?.record?.pictureStyleId);
  const navigate = (next, options = {}) => {
    setSuggestion(null);
    if (next === 'welcome') { window.scrollTo(0, 0); shelfReturn.current = false; browserRemove('sp-shelf-return'); }
    if (entryLink && !['join', 'access'].includes(next)) setEntryLink(null);
    if (sessionRef.current?.needsSetup && !['recovery', 'owner', 'setup'].includes(next)) next = 'setup';
    routeGuard.current.invalidate();
    setError(''); setNotice(''); setScreen(next);
    if (next !== 'result') setOpenPosterInitially(false);
    const destination = { jobId: options.jobId ?? job?.id, sample: options.sample ?? (['result', 'story'].includes(next) && result?.sample) };
    const hash = routeHash(next, destination);
    // Persist the return point before exposing the new URL or allowing a tab to close.
    if (['wait', 'result', 'story'].includes(next)) { const key = viewKey(sessionRef.current); writeView(key, rememberOpened(readView(key), { ...destination, screen: next })); }
    else if (sessionRef.current?.accountId) { const key = viewKey(sessionRef.current); writeView(key, rememberOpened(readView(key), { jobId: null, screen: null })); }
    if (location.hash !== hash) history[options.replace ? 'replaceState' : 'pushState'](null, '', hash);
  };
  const signOut = () => action(async () => { await api('logout', {}); setEntryLink(null); setSession(null); setPassword(''); setJob(null); setResult(null); setTonight(''); setPick(null); setParentReply(null); navigate('welcome'); });
  const openShelf = () => action(async () => { if (sessionRef.current?.record) { navigate('shelf'); await refresh(); } else { shelfReturn.current = true; browserWrite('sp-shelf-return', 'yes'); navigate('login'); } });
  const refresh = async () => {
    const previous = sessionRef.current, read = ++sessionReads.current, next = await api('session');
    if (read !== sessionReads.current || ownerKey(previous) !== ownerKey(sessionRef.current)) return next;
    setSession(next.accountId ? next : null); return next;
  };
  async function restore(saved, hash = location.hash, current = routeGuard.current.begin(), resumeWork = false) {
    let remembered; try { remembered = JSON.parse(readView(viewKey(saved.record ? saved : null))); } catch {}
    if (!saved.accountId && hash === '#shelf') { shelfReturn.current = true; browserWrite('sp-shelf-return', 'yes'); }
    const route = resolveRoute(!saved.accountId && hash === '#shelf' ? '#login' : hash, saved.accountId ? saved : null, remembered, { resumeWork });
    if (saved.accountId && hash === '#shelf') { shelfReturn.current = false; browserRemove('sp-shelf-return'); }
    const sampleResult = route.sample ? await api('sample') : null;
    if (!current()) return;
    if (['wait', 'result', 'story'].includes(route.screen) && (route.job || route.sample)) { const key = viewKey(saved); writeView(key, rememberOpened(readView(key), { screen: route.screen, sample: route.sample === true, jobId: route.job?.id })); }
    else if (saved.accountId) { const key = viewKey(saved); writeView(key, rememberOpened(readView(key), { jobId: null, screen: null })); }
    setPick(null); setParentReply(null); setJob(route.job ?? null); setResult(sampleResult ?? route.job?.result ?? null);
    if (route.screen === 'feedback') { setTriedMove(route.job.feedback?.triedMove ?? ''); setDidItHelp(route.job.feedback?.didItHelp ?? ''); setWallChoice(route.job.feedback?.wallChoice ?? ''); }
    setScreen(route.screen);
    history.replaceState(null, '', routeHash(route.screen, { jobId: route.job?.id, sample: route.sample }));
  }
  async function load(returnHash) {
    const current = routeGuard.current.begin(), hash = typeof returnHash === 'string' ? returnHash : location.hash;
    setLoading(true); setError('');
    try {
      const [settings, saved] = await Promise.all([api('config'), api('session')]); setConfig(settings);
      if (!current()) return;
      setSession(saved.accountId ? saved : null, true);
      if (saved.record) { setTonight(browserRead(draftKey(saved)) ?? ''); setNotes(saved.record.familyContext); }
      if (accountLink) { setScreen('recovery'); history.replaceState(null, '', location.pathname + '#recovery'); } else if (entryLink && !saved.accountId) { setScreen(entryLink.kind === 'invite' ? 'join' : 'access'); history.replaceState(null, '', location.pathname + (entryLink.kind === 'invite' ? '#join' : '#access')); } else if (entryLink && saved.accountId) { setEntryLink(null); browserRemove('sp-entry-link-v1'); await restore(saved, '#tonight', current, true); } else await restore(saved, hash, current, true);
    } catch (err) { if (current()) setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (accountLink) history.replaceState(null, '', location.pathname + '#recovery'); load(); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const previousScroll = history.scrollRestoration; history.scrollRestoration = 'manual';
    const back = async () => {
      const current = routeGuard.current.begin(), hash = location.hash;
      setError(''); setNotice('');
      try {
        const cached = sessionRef.current;
        if (cached) await restore(cached, hash, current);
        const saved = await api('session');
        if (!current()) return;
        if (!saved.record) { setTonight(''); setPassword(''); }
        setSession(saved.accountId ? saved : null, true); await restore(saved, hash, current);
      } catch (err) { if (current()) setError(err.message); }
    };
    window.addEventListener('popstate', back);
    return () => { window.removeEventListener('popstate', back); history.scrollRestoration = previousScroll; };
  }, []);
  useEffect(() => { if (session?.accountId) browserWrite(draftKey(session), tonight); }, [tonight, session?.accountId, session?.childId]);
  useEffect(() => { if (!loading && ['result', 'story', 'wait'].includes(screen) && (result || job)) writeView(viewKey(session), JSON.stringify(rememberOpened(readView(viewKey(session)), { screen, sample: screen !== 'wait' && result?.sample === true, jobId: job?.id }))); }, [loading, screen, result, job?.id, session?.accountId, session?.childId]);
  useEffect(() => { if (screen === 'story') return; window.scrollTo(0, 0); const timer = setTimeout(() => { if (!document.activeElement?.matches('input, textarea, select, [role=combobox]')) document.querySelector('[data-heading]')?.focus({ preventScroll: true }); }, 70); return () => clearTimeout(timer); }, [screen, setupStep]);
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    let live = true, polling = false;
    const poll = async () => {
      if (polling || !live) return;
      polling = true;
      try {
        const updated = await api('jobs/' + job.id); if (!live) return; setJob(updated);
        if (updated.status === 'complete') {
          // Present the result before awaiting shelf refresh: setting complete
          // cleans up this polling effect at the next render.
          if (screen === 'wait') { setResult(updated.result); navigate('result', { jobId: updated.id, sample: false }); }
          else setNotice('Your new kit is ready in Our stories.');
          await refresh();
        }
        else if (updated.status !== 'running') await refresh();
      } catch (err) { if (live && err.code !== 'STALE_OWNER') setError(err.message); }
      finally { polling = false; }
    };
    const timer = setInterval(poll, 1800); const onVisible = () => { if (!document.hidden) poll(); }; document.addEventListener('visibilitychange', onVisible); poll();
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [job?.id, job?.status, screen]);
  useEffect(() => { if (['people', 'setup'].includes(screen) && session?.record && config?.presets && !addingChild) { const savedDraft = familyFrom(session.record, config.presets); if (peopleInputMemory.current.newChildDraft) peopleInputMemory.current = {}; setFamily({ ...savedDraft, ...(peopleInputMemory.current.familyDraft ?? {}), dataPolicyConsent: savedDraft.dataPolicyConsent }); familyBaseline.current = JSON.stringify(savedDraft); setEditingPeople(true); setSetupStep(2); } }, [screen, session?.accountId, session?.childId]);
  const goSetupStep = step => {
    if (step === 1) { if (session?.record) { setFamilySection('account'); navigate('family'); } else { setSetupStep(1); navigate('setup'); } }
    else if (step === 2) { if (['setup', 'people'].includes(screen)) { setSetupStep(2); window.scrollTo({ top: 0, behavior: 'smooth' }); } else if (session?.record) openPeopleEditor(); else { setSetupStep(2); navigate('setup'); } }
    else action(async () => { if (['setup', 'people'].includes(screen)) await persistFamily(); if (sessionRef.current?.record) navigate('tonight'); });
  };
  async function action(run) { const owner = ownerKey(sessionRef.current); setBusy(true); setError(''); setNotice(''); try { await run(); } catch (err) { if (owner !== ownerKey(sessionRef.current) || err.code === 'STALE_OWNER') return; setError(err.message); if (err.status === 401 && session) { setSession(null); setPick(null); setParentReply(null); setResult(null); setJob(null); setTonight(''); setScreen('login'); history.replaceState(null, '', '#login'); } } finally { if (mounted.current && owner === ownerKey(sessionRef.current)) setBusy(false); } }
  const beginFamily = () => { peopleInputMemory.current = {}; familyBaseline.current = ''; const savedStyle = browserRead('sp-setup-picture-style'); setFamily({ ...structuredClone(defaultFamily), pictureStyleId: pictureStyleOptions.some(style => style.id === savedStyle) ? savedStyle : defaultPictureStyleId, real: config?.realFamilySetupAllowed === true && !config?.syntheticPortraits }); setUsername(''); setPassword(''); setEditingPeople(false); setAddingChild(false); setSetupSection('child'); setFamilySection('people'); setSetupStep(1); navigate('setup'); };
  const sample = (openPoster = false) => action(async () => { setResult(await api('sample')); setOpenPosterInitially(openPoster); navigate('result', { sample: true }); });
  const setField = (key, value) => { setError(''); if (key === 'pictureStyleId' && !session) browserWrite('sp-setup-picture-style', value); setFamily(previous => { const next = { ...previous, [key]: value }; peopleInputMemory.current.familyDraft = { ...peopleInputMemory.current.familyDraft, [key]: value }; return next; }); };
  const saveInputDescriptions = async saved => {
    const entries = Object.entries(peopleInputMemory.current.descriptions ?? {});
    if (!entries.length) return saved;
    let changed = false;
    let list = await api('portraits?childId=' + encodeURIComponent(saved.childId));
    for (const [id, description] of entries) {
      const person = list.people.find(p => p.id === id);
      if (!person || description.trim() === (person.draft?.description ?? '')) continue;
      const base = peopleInputMemory.current.descriptionBases?.[id];
      list = await api('portraits/' + id + '/draft', { childId: saved.childId, ...appearanceDraftData(person, description, base) }, 'PATCH');
      changed = true;
      const stored = list.people.find(p => p.id === id); peopleInputMemory.current.descriptionBases[id] = { personIdentity: stored.personIdentity, revision: stored.draft.revision };
    }
    return changed ? await refresh() : saved;
  };
  const persistFamily = async (saveDescriptions = true) => {
    const issue = familySetupIssue(family);
    if (issue) { setSetupSection(issue.section); setError(issue.message); requestAnimationFrame(() => { const field = document.getElementById(issue.field); field?.closest('.MuiAccordion-root')?.querySelector('[aria-expanded=false]')?.click(); field?.focus(); }); throw new Error(issue.message); }
    if (family.real && !config.zeroRetentionApproved && (needsChildDataProtection({ real: true, hero: { age: family.age } }, config.generationRoute) || !(family.dataPolicyConsent?.accepted === true && family.dataPolicyConsent?.version === (config.dataPolicyVersion ?? dataPolicyVersion)))) throw new Error('Read the family data notice and check the parent or guardian box.');
    const draftMoment = tonight, draftPick = pick;
    const snapshot = structuredClone(family), signature = JSON.stringify(snapshot);
    if (sessionRef.current?.record && !addingChild && signature === familyBaseline.current) return saveDescriptions ? saveInputDescriptions(sessionRef.current) : sessionRef.current;
    setBusy(true);
    try {
      const input = { ...snapshot, pictureStyleId: sessionRef.current?.record && !addingChild ? sessionRef.current.pictureStyleId ?? sessionRef.current.record.pictureStyleId : snapshot.pictureStyleId, appearanceMode: 'photo-or-description' };
      const versions = Object.entries(peopleInputMemory.current.descriptionBases ?? {}).filter(([id]) => Object.hasOwn(peopleInputMemory.current.descriptions ?? {}, id)).map(([id, version]) => ({ id, ...version }));
      const saved = addingChild ? await api('children', { family: input, ...(reuseGrownUps ? { reuseGrownUpsFromChildId: session.childId } : {}) }) : sessionRef.current?.record ? await api('family', { family: input, childId: sessionRef.current.childId, appearanceDraftVersions: versions }, 'PATCH') : sessionRef.current?.needsSetup ? await api('family/setup', { family: input, lookFlow: lookFlowVersion }) : await api('signup', { username, password, family: input, lookFlow: lookFlowVersion });
      const localInputs = peopleInputMemory.current;
      setSession(saved, false, true); peopleInputMemory.current = localInputs;
      const remaining = Object.fromEntries(Object.entries(localInputs.familyDraft ?? {}).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(snapshot[key])));
      localInputs.familyDraft = remaining; delete localInputs.newChildDraft; setFamily({ ...snapshot, ...remaining }); familyBaseline.current = signature; setSetupStep(2); setEditingPeople(true); setAddingChild(false); setPassword(''); setNotes(saved.record.familyContext);
      setScreen(screen); history.replaceState(null, '', screen === 'people' ? '#people' : '#setup');
      if (!addingChild) { setTonight(draftMoment); setPick(draftPick); }
      if (versions.length) {
        const updated = await api('portraits?childId=' + encodeURIComponent(saved.childId));
        for (const version of versions) { const person = updated.people.find(item => item.id === version.id); if (person && version.personIdentity !== person.personIdentity) peopleInputMemory.current.descriptionBases[version.id] = { personIdentity: person.personIdentity, revision: person.draft?.revision ?? 0 }; }
      }
      return saveDescriptions ? await saveInputDescriptions(saved) : saved;
    } finally { if (mounted.current) setBusy(false); }
  };
  const saveFamily = event => { event.preventDefault(); action(async () => { await persistFamily(); setNotice('Details saved. Your pictures are here on this page.'); }); };

  const pickTonight = async (repeat, libraryJobId) => { const selected = await api(session ? 'pick' : 'quick-pick', { tonight, kitContext, allowRepeat: repeat, childId: session?.childId, ...(libraryJobId ? { libraryJobId } : {}) }); if (selected.status !== 'eligible') { setPick(null); setParentReply(selected); navigate('parent'); } else { setPick(selected); setChoice(0); navigate('move'); } };
  const checkTonight = (event, useOriginal = false) => { event.preventDefault(); action(async () => {
    if (!session) { beginFamily(); return; }
    if (config.sampleOnly) { await pickTonight(allowRepeat); return; }
    if (drawingsNeeded) { finishDrawings(); return; }
    const version = momentVersion.current, routeCurrent = routeGuard.current.capture();
    const answers = [...(clarification?.answers ?? []), ...(clarification?.status === 'question' && clarificationAnswer.trim() ? [{ question: clarification.question, answer: clarificationAnswer.trim() }] : [])];
    const checked = useOriginal ? null : await api('moment/clarify', { childId: session.childId, tonight, kitContext, answers, ...(clarification?.draftId ? { draftId: clarification.draftId } : {}) });
    if (momentVersion.current !== version || !routeCurrent()) return;
    if (checked) { setClarification({ ...checked, answers: checked.answers ?? answers }); setClarificationAnswer(''); }
    if (checked && checked.status !== 'ready') return;
    const next = await api('jobs', { tonight, kitContext, ...(notifyWhenReady && session.readyEmailEligible ? { notifyWhenReady: true } : {}), allowRepeat: true, childId: session.childId, ...(checked?.draftId ? { clarificationId: checked.draftId } : {}) });
    if (['parentResponse', 'noMatch'].includes(next.status)) { setPick(null); setParentReply(next); navigate('parent'); }
    else { setNotifyWhenReady(false); setJob(next); navigate('wait', { jobId: next.id }); await refresh(); }
  }); };
  const makeKit = () => { if (!pick?.suggestions?.[choice]) return; if (!session) { beginFamily(); return; } if (drawingsNeeded) { finishDrawings(); return; } action(async () => { const next = await api('jobs', { tonight, kitContext, ...(notifyWhenReady && session.readyEmailEligible ? { notifyWhenReady: true } : {}), allowRepeat, childId: session.childId, moveId: pick.suggestions[choice].id, ...(pick.libraryJobId ? { libraryJobId: pick.libraryJobId } : {}) }); if (['parentResponse', 'noMatch'].includes(next.status)) { setPick(null); setParentReply(next); navigate('parent'); } else { setNotifyWhenReady(false); setJob(next); navigate('wait', { jobId: next.id }); await refresh(); } }); };
  const openJob = (item, target = 'result') => { setJob(item); if (item.status === 'complete') { setResult(item.result); navigate(target === 'story' ? 'story' : 'result', { jobId: item.id, sample: false }); } else navigate('wait', { jobId: item.id }); };
  const switchChild = id => action(async () => {
    routeGuard.current.invalidate();
    const saved = await api('children/current', { childId: id }, 'PATCH');
    setSession(saved); setNotes(saved.record.familyContext); setTonight(browserRead(draftKey(saved)) ?? '');
    setPick(null); setParentReply(null); setResult(null);
    const running = saved.jobs.find(item => item.status === 'running'); setJob(running ?? null); navigate(running ? 'wait' : 'tonight', { jobId: running?.id });
  });
  const addChild = () => { peopleInputMemory.current = { newChildDraft: true }; familyBaseline.current = '';
    setPeopleOpen(false);
    peopleReturn.current = screen;
    const shared = familyFrom(session.record, config.presets);
    setFamily({ ...structuredClone(defaultFamily), pictureStyleId: shared.pictureStyleId, real: shared.real, parents: shared.parents, familyContext: shared.familyContext });
    setReuseGrownUps(true); setSetupSection('child'); setAddingChild(true); setEditingPeople(false); setSetupStep(2); navigate('setup');
  };
  // New families, and families still choosing, pick the look from real drawings later.
  const lookPending = !editingPeople && !addingChild || session?.look?.pending === true;
  const currentMove = pick?.suggestions[choice];
  const supportingOnly = session?.record && (session.record.hero.supportingOnly === true || session.record.hero.age < 8 || session.record.hero.age > 13);
  const learningChild = session?.children?.find(child => child.age >= 8 && child.age <= 13);
  const assetsBase = result?.sample ? '/api/sample/files/' : '/api/jobs/' + job?.id + '/files/';
  async function savePoster() {
    const owner = ownerKey(sessionRef.current);
    const response = await fetch(assetsBase + 'poster.png', { headers: sessionRef.current?.accountId ? { 'X-Story-Poster-Account': sessionRef.current.accountId } : {} }); if (!response.ok) throw new Error('The poster file could not be opened. Try again.');
    const blob = await response.blob(); if (owner !== ownerKey(sessionRef.current)) return;
    const file = new File([blob], 'tonights-poster.png', { type: 'image/png' });
    const download = () => {
      const href = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = href; anchor.download = 'tonights-poster.png'; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(href), 10000);
    };
    const mobile = navigator.userAgentData?.mobile || /iPhone|iPad|Android/i.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    if (mobile && navigator.canShare?.({ files: [file] })) {
      // The OS owns its share sheet. Do not leave the app in a busy state while
      // waiting for a native dialog that may stay open indefinitely.
      try { navigator.share({ files: [file], title: result.move.name }).catch(err => { if (err.name !== 'AbortError') download(); }); return; } catch { /* Download is always available. */ }
    }
    download();
  }
  const pendingFeedback = session?.jobs?.find(item => item.status === 'complete' && !item.feedback && new Date(item.createdAt).toDateString() !== new Date().toDateString());
  const recentWork = recentWorkFor(session, readView(viewKey(session)));
  const shelfJobs = filterKits(session, shelfQuery, shelfStatus);
  const changeTonight = value => { momentVersion.current++; setTonight(value); setClarification(null); setClarificationAnswer(''); setKitContext(current => ({ ...current, remembranceChildLed: false })); setPick(null); setExploreBeyond(false); };
  const openLibrary = (beyond = false) => { setExploreBeyond(beyond); navigate('library'); };
  const libraryOwner = ownerKey(session);
  const showLibraryPick = selected => { if (ownerKey(sessionRef.current) !== libraryOwner) return; setPick(selected); setChoice(0); navigate('move'); };
  const readerOwner = ownerKey(session), readerRoute = routeGuard.current.capture(), readerId = result?.sample ? 'sample' : job?.id;
  const readerCurrent = () => readerRoute() && ownerKey(sessionRef.current) === readerOwner;
  const readerView = rememberedView(readView(viewKey(session)));
  const saveReaderPlace = (anchor, textSize) => { if (!readerCurrent() || !readerId) return false; const key = viewKey(session), saved = rememberedView(readView(key)); return writeView(key, JSON.stringify({ ...saved, textSize, places: Object.fromEntries([...Object.entries(saved.places).filter(([id]) => id !== readerId), [readerId, anchor]].slice(-20)) })); };
  const feedback = item => { setJob(item); setTriedMove(item.feedback?.triedMove ?? ''); setDidItHelp(item.feedback?.didItHelp ?? ''); setWallChoice(item.feedback?.wallChoice ?? ''); navigate('feedback', { jobId: item.id }); };

  const grownUps = (session?.record?.cast ?? []).filter(person => person.role === 'grown-up');
  const selectedGrownUpIds = kitContext.selectedGrownUpIds ?? grownUps.map(person => person.id);
  const storyPersonChoices = session?.record ? [{ id: 'child', label: session.record.hero.nickname }, ...grownUps.filter(person => selectedGrownUpIds.includes(person.id)).map(person => ({ id: person.id, label: session.record.storyPeople?.find(item => item.castId === person.id)?.storyName ?? person.label }))] : [];
  const missingStoryPeople = storyPersonChoices.filter(person => !people.some(saved => saved.id === person.id && saved.selectedUrl));
  const drawingsNeeded = Boolean(session?.record && !config?.sampleOnly && (!peopleLoaded || missingStoryPeople.length));
  const finishDrawings = () => { navigate('people'); };
  const changeKitContext = change => { momentVersion.current++; setKitContext(current => ({ ...current, ...change })); setPick(null); setClarification(null); setClarificationAnswer(''); };
  const openPeopleEditor = () => { setPeopleOpen(false); peopleReturn.current = screen; setEditingPeople(true); setAddingChild(false); setSetupSection('child'); const savedDraft = familyFrom(session.record, config.presets); if (peopleInputMemory.current.newChildDraft) peopleInputMemory.current = {}; setFamily({ ...savedDraft, ...(peopleInputMemory.current.familyDraft ?? {}), dataPolicyConsent: savedDraft.dataPolicyConsent }); familyBaseline.current = JSON.stringify(savedDraft); setSetupStep(2); navigate('setup'); };
  const storyPeople = session?.record && <Box className="story-people-picker"><Typography component="h2" variant="h3">Who joins this story?</Typography><Typography variant="body2" color="text.secondary">Each kit needs one child and at least one grown-up, with a chosen drawing for both. Choose who shared the moment or will read together.</Typography>{grownUps.map(person => <FormControlLabel key={person.id} control={<Checkbox checked={selectedGrownUpIds.includes(person.id)} disabled={selectedGrownUpIds.includes(person.id) && selectedGrownUpIds.length === 1} onChange={event => { const selected = event.target.checked ? [...selectedGrownUpIds, person.id] : selectedGrownUpIds.filter(id => id !== person.id); changeKitContext({ selectedGrownUpIds: selected, ...(kitContext.focusPersonId !== 'child' && !selected.includes(kitContext.focusPersonId) ? { focusPersonId: 'child' } : {}) }); }} />} label={session.record.storyPeople?.find(item => item.castId === person.id)?.storyName ?? person.label} />)}<Button variant="outlined" onClick={openPeopleEditor}>Add or edit people</Button><Button onClick={addChild}>Add another child</Button></Box>;
  const storyChoices = session?.record && <Accordion><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography>Who is learning, and what kind of story?</Typography></AccordionSummary><AccordionDetails><Stack spacing={2.5}>
    <TextField select label="Who will practise the move?" value={kitContext.focusPersonId} onChange={event => changeKitContext({ focusPersonId: event.target.value })}><MenuItem value="child">{session.record.hero.nickname}</MenuItem>{(session.record.cast ?? [{ id: 'grown-up-one', role: 'grown-up', label: session.record.parentLabel ?? 'Dad' }]).filter(person => person.role === 'grown-up' && selectedGrownUpIds.includes(person.id)).map(person => <MenuItem key={person.id} value={person.id}>{session.record.storyPeople?.find(item => item.castId === person.id)?.storyName ?? person.label}</MenuItem>)}</TextField>
    {kitContext.focusPersonId !== 'child' && <Typography variant="body2">This is the grown-up’s practice. Your child does not need to calm or coach you.</Typography>}
    <FormControlLabel control={<Checkbox checked={allowRepeat} onChange={e => setAllowRepeat(e.target.checked)} />} label="It’s okay to revisit a move we’ve used" />
    <RadioChoices label="How should we tell it?" name="story-mode" value={kitContext.storyMode} onChange={storyMode => changeKitContext({ storyMode })} options={[[ 'inspired', 'An inspired story, with made-up details clearly labelled' ], [ 'factual', 'Only the facts I share, without invented words or events' ]]} />
    {kitContext.storyMode === 'factual' && <Typography variant="body2">Share the facts you want included. A short note makes a short retelling. The drawings illustrate it; they are not photos of what happened.</Typography>}
    {(session.children ?? []).filter(child => child.id !== session.childId).map(child => <FormControlLabel key={child.id} control={<Checkbox checked={kitContext.siblingChildIds.includes(child.id)} disabled={child.hasChosenLook === false} onChange={event => changeKitContext({ siblingChildIds: event.target.checked ? [...kitContext.siblingChildIds, child.id] : kitContext.siblingChildIds.filter(id => id !== child.id) })} />} label={`Include ${child.nickname}, who was part of this moment${child.hasChosenLook === false ? '. Choose their drawing in Family first' : ''}`} />)}
    {/\b(?:died|death|grief|missing|misses|moved away|remembering)\b/i.test(tonight) && <FormControlLabel control={<Checkbox checked={kitContext.remembranceChildLed} onChange={event => changeKitContext({ remembranceChildLed: event.target.checked })} />} label="My child asked to remember someone. They can stop or keep it off the wall." />}
  </Stack></AccordionDetails></Accordion>;
  const creationAllowed = session?.creationEnabled !== false;
  const readyEmailChoice = session?.readyEmailEligible && !config?.sampleOnly ? <FormControlLabel control={<Checkbox checked={notifyWhenReady} onChange={event => setNotifyWhenReady(event.target.checked)} disabled={busy || !creationAllowed} />} label="Email me when it is ready" /> : null;
  const sentenceForm = <Box component="form" className="moment-form" onSubmit={checkTonight}><Stack spacing={2.5}>
    {!creationAllowed && <Alert severity="info">New stories are turned off for this account. Your saved stories and downloads are still in Our stories.</Alert>}
    {session?.storyAllowance?.remaining === 0 && creationAllowed && <Alert severity="info">You have reached today’s story limit. You can make another tomorrow. Your saved stories are still here to read and download.</Alert>}
    {session?.record && drawingsNeeded && <Alert severity="info">{peopleLoaded ? `Choose a drawing for ${missingStoryPeople.map(person => person.label).join(' and ')} before making the story.` : 'Checking your chosen drawings…'} One child and at least one grown-up are needed.<Button onClick={finishDrawings}>Finish choosing drawings</Button></Alert>}
    <MomentInput key={ownerKey(session)} owner={ownerKey(session)} value={tonight} onChange={changeTonight} disabled={busy || !creationAllowed} onListeningChange={setListening} />
    {session?.record && <StoryStylePicker key={'style-' + ownerKey(session)} api={api} value={kitContext.pictureStyleId ?? session.record.pictureStyleId} onChange={pictureStyleId => changeKitContext({ pictureStyleId })} onPeople={() => navigate('people')} disabled={busy || !creationAllowed} />}
    {clarification?.status === 'question' && <Box className="inline-question"><Stack spacing={1.5}><Typography component="h2" variant="h3">One detail before we begin</Typography><Typography>{clarification.question}</Typography><TextField required label="Your answer" multiline minRows={2} value={clarificationAnswer} onChange={event => setClarificationAnswer(event.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} /><Typography variant="body2" color="text.secondary">Your original moment stays above. You can still edit it.</Typography></Stack></Box>}
    {clarification?.status === 'unavailable' && <Alert severity="info">The follow-up check is unavailable. Your words are kept. Try Create again, or use your original note.<Button type="button" disabled={busy || listening || !creationAllowed} onClick={event => checkTonight(event, true)}>Create from my note</Button></Alert>}
    {readyEmailChoice}
    <Button className="create-story-button" variant="contained" type="submit" disabled={busy || listening || !creationAllowed || drawingsNeeded || !tonight.trim() || clarification?.status === 'question' && !clarificationAnswer.trim()}>{clarification?.status === 'question' ? 'Use my answer and create' : 'Create our story'}</Button>
    <Typography variant="body2" color="text.secondary">A story to read together and a poster to keep. Ordinary moments are welcome too.</Typography>{storyChoices}
  </Stack></Box>;
  const sampleCredit = result?.sample ? <Typography variant="body2" color="text.secondary" className="sample-credit">Made with Story Poster. Pip and Dad are a made-up family.</Typography> : null;
  let content;
  if (loading) content = <><Heading title="Opening your evening…">Your saved stories will be here in a moment.</Heading><CircularProgress aria-label="Opening your stories" /></>;
  else if (!config) content = <><Heading title="Let’s reconnect">The app could not be opened.</Heading><Button variant="contained" onClick={load}>Try again</Button></>;
  else if (screen === 'welcome') content = <>
    <Box className="welcome-scene">
      <Box component="img" src="/art/evening-reading.png" alt="A drawn parent and child reading together beside a warm lamp" />
      <Stack spacing={2.5} className="welcome-scene-copy">
        <Heading title={<><span className="welcome-promise-line">One moment.</span>{' '}<span className="welcome-promise-line">One skill.</span>{' '}<span className="welcome-promise-line">One rhyme.</span></>}><span className="brand-tagline">A story to read together, with faces your child knows.</span></Heading>
        <Box className="welcome-actions">{session?.record ? <><Button variant="contained" onClick={() => navigate('tonight')}>Make a story</Button><Button onClick={() => openLibrary()}>Browse teaching guides</Button></> : <><Button variant="contained" onClick={() => config.signup?.requiresInvitation || config.signup?.mode === 'request' ? navigate('access') : beginFamily()}>{config.signup?.requiresInvitation || config.signup?.mode === 'request' ? 'Request access' : 'Start our first story'}</Button><Button aria-label="Sign in" onClick={() => navigate('login')}>Already have an account? Sign in</Button></>}</Box>
        <Typography variant="body2" color="text.secondary">For parents and children aged 8 to 13.</Typography><Typography variant="body2" color="text.secondary">For shared learning about everyday feelings. This is not therapy or emergency help.</Typography>
      </Stack>
    </Box>
    {config.sampleAvailable && <Box className="output-preview"><ButtonBase onClick={() => sample(true)} disabled={busy} aria-label="Open the five-page example" sx={{ borderRadius: 2, overflow: 'hidden' }}><Box component="img" src="/api/sample/previews/poster.webp" alt="Pip and Dad’s saved example poster" /></ButtonBase><Box><Typography component="h2" variant="h2">A story. A rhyme.<br />A poster to keep.</Typography><Typography>See a made-up family’s story.</Typography><Button onClick={() => sample()} disabled={busy} sx={{ px: 0, justifyContent: 'flex-start' }}>Try the saved sample</Button></Box></Box>}
    <Privacy config={config} />
    <Typography component="footer" variant="body2" color="text.secondary" sx={{ mt: 2 }}>© 2026 Sunny Bamrah · Decision Council</Typography>
  </>;
  else if (screen === 'access') content = <AccessRequest key={entryLink?.token ?? 'access'} api={api} referralToken={entryLink?.kind === 'referral' ? entryLink.token : undefined} enabled={config.accessRequests?.enabled !== false} onInvalid={() => browserRemove('sp-entry-link-v1')} onBack={() => { setEntryLink(null); navigate(session?.record ? 'tonight' : 'welcome'); }} onSignIn={() => { setEntryLink(null); navigate('login'); }} />;
  else if (screen === 'join') content = <ApprovedSignup api={api} onInvalid={() => browserRemove('sp-entry-link-v1')} token={entryLink?.kind === 'invite' ? entryLink.token : ''} onJoined={saved => { setEntryLink(null); setSession(saved); setFamily({ ...structuredClone(defaultFamily), real: config.realFamilySetupAllowed === true && !config.syntheticPortraits }); setSetupStep(2); navigate(saved.needsSetup ? 'setup' : 'tonight'); }} onRequest={() => { setEntryLink(null); navigate('access'); }} onSignIn={() => { setEntryLink(null); navigate('login'); }} />;
  else if (screen === 'invites' && session?.record) content = <FamilyInvites key={ownerKey(session)} api={api} session={session} onBack={() => navigate('family')} />;
  else if (screen === 'login') content = <><Box className="signin-intro"><Typography className="eyebrow">Your next chapter</Typography><Heading title="Welcome back">Sign in to return to your people and saved stories.</Heading></Box><Box component="form" className="signin-form" onSubmit={event => { event.preventDefault(); action(async () => { const saved = await api('login', { username, password }); setSession(saved); setPassword(''); setNotes(saved.record?.familyContext ?? ''); setTonight(browserRead(draftKey(saved)) ?? ''); setPick(null); setParentReply(null); setResult(null); setJob(null); if (saved.isOwner && ownerReturn.current) { ownerReturn.current = false; navigate('owner'); } else if (saved.needsSetup) { setSetupStep(2); navigate('setup'); } else { const returnHash = shelfReturn.current ? '#shelf' : '#tonight'; shelfReturn.current = false; browserRemove('sp-shelf-return'); await restore(saved, returnHash, routeGuard.current.begin(), true); } }); }}><Stack spacing={3}><TextField required label="Email or existing family login" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" /><TextField required label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /><Button type="submit" variant="contained" disabled={busy}>Sign in</Button><Button onClick={() => navigate('recovery')}>Forgot password?</Button><Button onClick={() => navigate('welcome')}>Back</Button></Stack></Box></>;
  else if (screen === 'recovery') content = <AccountRecovery key={ownerKey(session) + (accountLink?.kind ?? 'forgot')} api={api} token={accountLink?.token} kind={accountLink?.kind ?? 'forgot'} onDone={() => refresh()} onBack={() => { setAccountLink(null); navigate(session?.needsSetup ? 'setup' : session?.record ? 'tonight' : 'login'); }} />;
  else if (screen === 'owner' && session?.isOwner) content = <OwnerKits key={ownerKey(session)} api={api} accessRequestsEnabled={config.accessRequests?.enabled === true} />;
  else if (screen === 'setup' || screen === 'people') content = <>
    <FirstStorySteps active={setupStep === 1 && screen !== 'people' ? 1 : 2} onStep={goSetupStep} />
    <Heading title={setupStep === 1 ? 'A place for your family’s stories' : editingPeople ? 'Your story people' : 'Who’s in your story?'}>{setupStep === 1 ? 'Use your email and choose a password.' : 'Add each person’s details and picture here. Your child comes first, then the grown-up.'}</Heading>
    <Box component="form" className={'setup-form' + (setupStep === 2 ? ' style-step' : '')} noValidate={setupStep === 2} onSubmit={event => { event.preventDefault(); if (setupStep === 1) { action(async () => { if (config.signup?.enabled && !session?.accountId) { const saved = await api('signup', { email: username, password }); setSession(saved); setFamily(family); setPassword(''); } setSetupStep(2); navigate('setup'); window.scrollTo(0, 0); }); } else saveFamily(event); }}><Stack spacing={3}>
    {setupStep === 1 && (session?.accountId ? <Typography>Your account is ready. {session.email ?? session.username}</Typography> : <><TextField required type={config.signup?.enabled ? 'email' : 'text'} label={config.signup?.enabled ? 'Your email address' : 'Choose a family login'} value={username} onChange={e => setUsername(e.target.value)} autoComplete={config.signup?.enabled ? 'email' : 'username'} autoCapitalize="none" helperText={config.signup?.enabled ? 'Use an email address you already have.' : '3 to 32 letters, numbers, _ or -. Use a made-up login.'} slotProps={{ htmlInput: config.signup?.enabled ? { maxLength: 254 } : { pattern: '[a-zA-Z0-9_\\-]{3,32}' } }} /><TextField required label="Choose a password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" helperText="At least 8 characters." slotProps={{ htmlInput: { minLength: 8, maxLength: 128 } }} />{!config.signup?.enabled && <Typography variant="body2" color="text.secondary">This local preview uses a made-up family login. Email signup is not open here.</Typography>}{config.signup?.available === false && <Alert severity="info">The showcase is full for now. Existing families can still sign in.</Alert>}</>)}

    {setupStep === 2 && <FamilySetup family={family} setField={setField} config={config} busy={busy} editing={editingPeople} addingChild={addingChild} session={addingChild ? null : session} api={api} onSaved={refresh} ensureSaved={() => persistFamily(false)} onActivity={onPortraitActivity} inputMemory={peopleInputMemory} onContinue={() => goSetupStep(3)} pictureStyleId={kitContext.pictureStyleId ?? session?.record?.pictureStyleId ?? family.pictureStyleId} onStyleChange={pictureStyleId => { if (!session?.record || addingChild) setField('pictureStyleId', pictureStyleId); changeKitContext({ pictureStyleId }); }} consent={<Box id="setup-consent">
      {!(!addingChild && session?.record && hasCurrentDataConsent(session.record, config.dataPolicyVersion)) && <><DataPolicyNotice config={config} />{family.real && !config.zeroRetentionApproved && !needsChildDataProtection({ real: family.real, hero: { age: family.age } }, config.generationRoute) && <FormControlLabel control={<Checkbox checked={family.dataPolicyConsent?.accepted === true && family.dataPolicyConsent?.version === (config.dataPolicyVersion ?? dataPolicyVersion)} onChange={event => setField('dataPolicyConsent', { accepted: event.target.checked, version: config.dataPolicyVersion ?? dataPolicyVersion })} />} label={dataPolicyConsentLabel} />}</>}
    </Box>} />}
    {setupStep === 1 && <Button type="submit" variant="contained" disabled={busy || config.signup?.available === false}>Continue to our people</Button>}{!session?.needsSetup && <Button onClick={() => setupStep > 1 && !editingPeople && !addingChild && !session?.accountId ? setSetupStep(1) : navigate(editingPeople || addingChild ? peopleReturn.current : pick ? 'move' : 'welcome')}>Back</Button>}
    </Stack></Box>{session?.needsSetup && <Button disabled={busy} onClick={() => action(async () => { await api('logout', {}); setEntryLink(null); setSession(null); navigate('welcome'); })}>Sign out and finish later</Button>}
  </>;
  else if (screen === 'tonight') content = <>
    {!session.jobs.length && session.look?.pending === false && <FirstStorySteps active={3} onStep={goSetupStep} />}
    {session.record.real && <DataPolicyConsent key={ownerKey(session)} api={api} session={session} config={config} onSaved={refresh} />}
    <Box className="tonight-heading"><Typography className="eyebrow">Tonight, with {session.record.hero.nickname}</Typography><Heading title="One moment, together.">Read and talk when you are both calm.</Heading><Box className="tonight-people">{storyPersonChoices.map(person => <Button key={person.id} className="story-person-chip" color="inherit" onClick={() => people.some(item => item.id === person.id) ? setPeopleOpen(true) : finishDrawings()}>{people.find(item => item.id === person.id)?.selectedUrl && <Box component="img" src={people.find(item => item.id === person.id).selectedUrl} alt={'Chosen story drawing of ' + person.label} />}{people.some(item => item.id === person.id) && <span aria-hidden="true">✓</span>}{person.label}{!people.some(item => item.id === person.id) && <span className="person-needs-drawing"> · Needs a drawing</span>}</Button>)}<Button className="story-person-chip" color="inherit" onClick={() => setPeopleOpen(true)} aria-label="Change who joins this story">Change</Button></Box></Box>
    {session?.otherRunningChild && <Panel tint><Typography>{session.otherRunningChild.nickname}’s kit is still being made. You can share another moment now, then make its kit when that one has finished.</Typography><Button variant="outlined" onClick={() => switchChild(session.otherRunningChild.id)}>Return to {session.otherRunningChild.nickname}’s kit</Button></Panel>}

    {supportingOnly ? <Panel><Typography component="h2" variant="h2">Can join another story</Typography><Typography>{session.record.hero.nickname} can join a sibling’s story with their own saved drawing. New learning kits are for ages 8 to 13.</Typography>{learningChild && <Button variant="contained" onClick={() => switchChild(learningChild.id)}>Make a kit for {learningChild.nickname}</Button>}<Button onClick={() => navigate('family')}>See this child’s saved profile</Button></Panel> : sentenceForm}
    {recentWork && <Box className={'return-card' + (recentWork.status === 'complete' ? '' : ' no-cover')}>{recentWork.status === 'complete' && <Box component="img" src={'/api/jobs/' + recentWork.id + '/previews/poster.webp'} alt={'Saved poster for ' + recentWork.result.move.name} />}<Stack spacing={.5}><Typography className="eyebrow">{recentWork.status === 'complete' ? 'A story to revisit together' : recentWork.status === 'running' ? 'Your work is still being made' : 'Waiting on your shelf'}</Typography><Typography component="h2" variant="h3">{recentWork.result?.chapterTitle ?? recentWork.move?.name ?? 'Tonight’s kit'}</Typography><Button onClick={() => openJob(recentWork)} sx={{ alignSelf: 'flex-start', px: 0 }}>{recentWork.status === 'complete' ? 'Open this kit' : 'Return to saved work'}</Button></Stack></Box>}
    {pendingFeedback && <Box className="feedback-reminder"><Typography variant="body2">Want to tell us about last time? You can leave this for later.</Typography><Button onClick={() => feedback(pendingFeedback)} sx={{ px: 0 }}>Tell us about last time</Button></Box>}
    <Typography variant="body2" color="text.secondary">For parents. Everyday feelings, not therapy or emergency help.</Typography>
    {config.sampleAvailable && <Button onClick={() => sample()} disabled={busy}>Or open the saved sample</Button>}
    {!config.sampleOnly && !supportingOnly && <Button onClick={() => openLibrary()}>Browse teaching guides</Button>}
  </>;
  else if (screen === 'move' && currentMove) content = <>
    <Button sx={{ alignSelf: 'flex-start' }} onClick={() => navigate(session ? 'tonight' : 'welcome')}>← Edit tonight’s sentence</Button>
    <Heading title="Tonight’s move">One option to try together. You decide whether it fits.</Heading>
    <Panel tint><Chip label={`Option ${choice + 1} of ${pick.suggestions.length}`} size="small" sx={{ alignSelf: 'flex-start' }} /><Typography variant="h2" component="h2">{currentMove.name}</Typography><Typography variant="body2" color="text.secondary">{currentMove.reason}</Typography><Typography>{currentMove.positiveAction}</Typography><Typography variant="h3" component="h3">Read this practice together, if it fits</Typography><Typography>{currentMove.practiceScript}</Typography><Typography variant="body2">This is the move’s prepared practice, not a retelling of tonight. You can stop here.</Typography><Receipt move={currentMove} /></Panel>
    {currentMove.repeated && <Alert severity="info">You have used this move before. You chose to see fitting moves again.</Alert>}
    {config.sampleOnly ? <><Alert severity="info">New kits are turned off in this preview. You can explore a completed sample.</Alert><Button variant="contained" onClick={sample} disabled={busy || !config.sampleAvailable}>Open the saved sample</Button></> : <><Typography variant="body2">Your work is saved as we go. You can return to Our stories later.</Typography>{readyEmailChoice}<Button variant="contained" onClick={makeKit} disabled={busy}>{drawingsNeeded ? "Finish choosing drawings" : session ? "Make our evening story and poster" : "Meet our people and make our kit"}</Button></>}
    {pick.suggestions.length > 1 && <Button variant="outlined" onClick={() => setChoice((choice + 1) % pick.suggestions.length)}>Show me another</Button>}
    {session && !config.sampleOnly && <Button variant="outlined" onClick={() => openLibrary(true)}>None of these fits. Check a new topic</Button>}
    <Button onClick={() => navigate(session ? 'tonight' : 'welcome')}>Not tonight</Button>
    <Typography variant="body2" color="text.secondary">The child can always say “not tonight.”</Typography>
  </>;
  else if (screen === 'library' && session) content = <><Heading title="Browse teaching guides">Choose a guide, or let the story choose from your saved teaching material.</Heading><TeachingLibrary key={ownerKey(session)} api={api} session={session} config={config} kitContext={kitContext} tonight={tonight} onTonightChange={changeTonight} allowRepeat={allowRepeat} onAllowRepeatChange={setAllowRepeat} allowBeyond={exploreBeyond} onRefresh={refresh} onParent={next => { if (ownerKey(sessionRef.current) !== libraryOwner) return; setParentReply(next); navigate('parent'); }} onPick={showLibraryPick} onEditFamily={() => navigate('family')} /><Button onClick={() => navigate('tonight')}>Back to tonight</Button></>;
  else if (screen === 'parent' && parentReply?.status === 'noMatch') content = <><Heading title={parentReply.canRepeat ? 'You have used the fitting moves' : 'No prepared move fits yet'}>{parentReply.canRepeat ? 'Choose whether to try one again.' : 'We will not guess what your child needs.'}</Heading><Panel><Typography>{parentReply.message}</Typography></Panel>{parentReply.canRepeat && <Button variant="contained" disabled={busy} onClick={() => action(async () => { setAllowRepeat(true); await pickTonight(true, parentReply.libraryJobId); })}>Show fitting moves again</Button>}<Button variant={parentReply.canRepeat ? 'outlined' : 'contained'} onClick={() => navigate(session ? 'tonight' : 'welcome')}>Edit today’s moment</Button>{session && !config.sampleOnly && <Button variant="outlined" onClick={() => navigate('library')}>Check a new teaching topic</Button>}<Button onClick={() => navigate(session ? 'tonight' : 'welcome')}>Leave it here tonight</Button></>;
  else if (screen === 'parent' && parentReply) content = <><Heading title="Stay with them tonight">This moment does not need a child’s poster.</Heading><Panel>{parentReply.lines.map((line, index) => <Typography key={index}>{line}</Typography>)}</Panel>{parentReply.guidance && <Panel tint><Typography variant="h2" component="h2">{parentReply.guidance.title}</Typography>{parentReply.guidance.lines.map((line, index) => <Typography key={index}>{line}</Typography>)}{parentReply.guidance.resources.map(resource => <Link key={resource.url} href={resource.url} target="_blank" rel="noreferrer">{resource.title}</Link>)}</Panel>}<Button variant="contained" onClick={() => navigate(session ? 'tonight' : 'welcome')}>Back to tonight</Button></>;
  else if (screen === 'wait' && job) content = <>
    <Heading title={savedProgress(job).active ? 'Making tonight’s kit' : job.status === 'failed' && job.canResume !== false ? 'One step needs another try' : 'Your work is saved'} />
    <JobProgress job={job} />
    {job.status === 'failed' && job.message && job.message !== savedProgress(job).message && <Alert severity="warning">{job.message}</Alert>}
    <Box role="group" aria-label="People in this saved kit"><Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>In this story</Typography><FamilyCast people={job.people ?? people} compact /></Box>
    <Typography color="text.secondary">Your work is saved. You can close this page and return to Our stories.</Typography>{job.readyEmail?.enabled && <Typography variant="body2">We’ll email you when it is ready.</Typography>}
    {job.canResume && <Button variant="contained" disabled={busy} onClick={() => action(async () => { setJob(await api('jobs/' + job.id + '/resume', {})); })}>Resume saved work</Button>}
    {job.canSetAside && <Button variant="outlined" disabled={busy} onClick={() => action(async () => { setSession(await api('jobs/' + job.id + '/set-aside', {})); setJob(null); navigate('tonight'); })}>Keep this kit and set it aside</Button>}
    {job.canRepairLayout && <Button variant="outlined" disabled={busy} onClick={() => action(async () => { setJob(await api('jobs/' + job.id + '/repair-layout', {})); })}>Fix the poster’s writing space</Button>}
    {config.sampleAvailable && <Button variant="outlined" onClick={sample} disabled={busy}>Use a sample instead</Button>}
    {job.status === 'running' && <Button onClick={() => action(async () => { setJob(await api('jobs/' + job.id + '/pause', {})); })} disabled={busy}>{savedProgress(job).active ? 'Pause after this step' : 'Pause this saved request'}</Button>}
    <Button onClick={async () => { navigate('shelf'); await refresh(); }}>Go to Our stories</Button>
  </>;
  else if ((screen === 'result' || screen === 'story') && result) content = <>
    <Button onClick={() => screen === 'story' ? navigate('result') : navigate(session ? 'shelf' : 'welcome')} sx={{ alignSelf: 'flex-start' }}>{screen === 'story' && result.sample ? 'Poster and pages →' : '← ' + (screen === 'story' ? 'Back to the poster' : session ? 'Our stories' : 'Back')}</Button>
    {screen === 'result' ? <>
      <Box className="result-heading"><Typography className="eyebrow">Your story is ready</Typography><Heading title={result.chapterTitle}>{result.move.name}</Heading><SharedRhyme result={result} /></Box>
      <Stack spacing={2} className="result-intro"><Button variant="contained" onClick={() => navigate('story')}>Sit together and read our story</Button></Stack>
      <Box className="result-spread"><Box><PosterReader key={assetsBase + String(openPosterInitially)} result={result} assetsBase={assetsBase} openInitially={openPosterInitially} onSuggestChange={!result.sample && job?.status === 'complete' ? page => setSuggestion({ owner: ownerKey(session), jobId: job.id, page }) : undefined} /></Box><Stack spacing={3} className="result-actions"><Typography color="text.secondary">A story from your day, ready whenever you want to return.</Typography><Stack spacing={2}><PrintOptions key={assetsBase} api={api} jobId={job?.id} assetsBase={assetsBase} sample={result.sample === true} sampleCopy={result.printCopy} /><Accordion className="source-disclosure"><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography variant="body2" fontWeight={800}>More poster files</Typography></AccordionSummary><AccordionDetails><Stack spacing={2}><Button variant="outlined" onClick={() => action(savePoster)} disabled={busy}>Save our poster</Button><Link href={assetsBase + 'poster.png'} download="tonights-poster.png">Download poster image directly</Link><Link href={assetsBase + 'poster.pdf'} target="_blank" rel="noreferrer">Open printable poster</Link></Stack></AccordionDetails></Accordion></Stack><Typography variant="body2" color="text.secondary">Read the story and drawings together before printing. {result.sample ? 'These checks belong to the saved run. No new check was made here.' : 'Model checks are saved with this kit. They can still miss things; read it together before you print.'}</Typography></Stack></Box>
      {sampleCredit}
      <Receipt move={result.move} /><Typography variant="body2">Reading together can be enough. Try the practice only if you want to. The child chooses whether and where the poster hangs.</Typography>{session && <Button onClick={() => navigate('shelf')}>Done for tonight</Button>}
      {!result.sample && <><Button onClick={() => setSuggestion({ owner: ownerKey(session), jobId: job.id, page: null })}>Suggest a change</Button><Button onClick={() => feedback(job)}>Tomorrow: did you try it?</Button></>}
    </> : <>
      <Heading title={result.chapterTitle}>{!result.sample && <>{result.nickname} · {storyHonestyLabel(result)}</>}</Heading>
      {!result.sample && <><SharedRhyme result={result} /><Typography color="text.secondary">Read at your own pace. Pause wherever your child wants to talk.</Typography></>}
      {result.sample && result.narration?.src && <SampleNarration key={result.narration.src} src={result.narration.src} seconds={result.narration.seconds} />}
      <StoryReader key={readerOwner + ':' + readerId + ':' + routeGuard.current.version()} result={result} assetsBase={assetsBase} planEditor={!result.sample && session?.record && job?.status === 'complete' ? <PracticePlan key={readerOwner + ':' + job.id} api={api} jobId={job.id} /> : null} savedPlace={readerView.places[readerId]} textSize={readerView.textSize} onSavePlace={saveReaderPlace} isCurrent={readerCurrent} onPoster={() => { if (readerCurrent()) navigate('result'); }} onShelf={session ? () => { if (readerCurrent()) navigate('shelf'); } : null} />
      {sampleCredit}
    </>}
  </>;
  else if (screen === 'shelf') content = <>
    <Heading title="Our stories">Earlier nights, ready when you want them.</Heading>
    {!session?.jobs.length && <Panel><Typography>Your first story starts with one moment from the day.</Typography><Button variant="contained" onClick={() => navigate('tonight')}>Start tonight</Button></Panel>}
    {session?.jobs.length > 0 && <Box><Box component="details" className="story-search"><Box component="summary">Find a story{(shelfQuery || shelfStatus !== 'all') ? ' · filters on' : ''}</Box><Box className="shelf-filters"><TextField fullWidth label="Find a story" value={shelfQuery} onChange={event => setShelfQuery(event.target.value)} helperText="Search story titles or topics." sx={{ minWidth: 0 }} /><TextField select label="Show stories" value={shelfStatus} onChange={event => setShelfStatus(event.target.value)} sx={{ minWidth: 0 }}>{[['all', 'All stories'], ['complete', 'Ready'], ['running', 'Making it'], ['saved', 'Saved work'], ['set-aside', 'Kept aside']].map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField></Box></Box>{(shelfQuery || shelfStatus !== 'all') && <Box className="active-story-search"><Typography variant="body2" role="status">{shelfJobs.length} {shelfJobs.length === 1 ? 'story' : 'stories'} shown{shelfQuery ? ` for “${shelfQuery}”` : ''}{shelfStatus !== 'all' ? ' with a status filter' : ''}.</Typography><Button onClick={() => { setShelfQuery(''); setShelfStatus('all'); }} sx={{ px: 0 }}>Clear search and filters</Button></Box>}</Box>}
    {session?.jobs.length > 0 && !shelfJobs.length && <Panel><Typography>No saved stories match this search and filter.</Typography><Button onClick={() => { setShelfQuery(''); setShelfStatus('all'); }}>Show all stories</Button></Panel>}
    <Box className="kit-grid">{shelfJobs.map((item, index) => <Box key={item.id} className={'kit-card' + (item.status === 'complete' ? '' : ' no-cover') + (index === 0 && item.status === 'complete' && !shelfQuery && shelfStatus === 'all' ? ' featured-story' : '')}>{item.status === 'complete' && <ButtonBase className="kit-cover-button" aria-label={'Open kit ' + (item.result.chapterTitle ?? item.result.move.name)} onClick={() => openJob(item)}><Box component="img" className="kit-cover" src={'/api/jobs/' + item.id + '/previews/poster.webp'} alt={'Saved poster for ' + item.result.move.name} onError={event => { if (!event.currentTarget.dataset.fallback) { event.currentTarget.dataset.fallback = 'true'; event.currentTarget.src = '/api/jobs/' + item.id + '/previews/poster.webp'; } }} /></ButtonBase>}<Stack spacing={1.5}>{item.status !== 'complete' && <Chip size="small" sx={{ alignSelf: 'flex-start' }} label={item.status === 'running' ? 'Making it' : item.status === 'set-aside' ? 'Kept aside' : item.status === 'failed' ? 'Needs another try' : 'Saved work'} />}<Typography variant="h2" component="h2">{item.result?.chapterTitle ?? item.move?.name ?? 'Tonight’s kit'}</Typography>{index === 0 && item.status === 'complete' && savedTagline(item.result) && <Typography className="shelf-rhyme">{savedTagline(item.result)}</Typography>}<Typography variant="body2" color="text.secondary">{new Date(item.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</Typography><Button variant="outlined" onClick={() => openJob(item)}>{item.status === 'complete' ? 'Open this kit' : item.status === 'running' ? 'Return to progress' : 'Open saved work'}</Button>{item.canSetAside && <Button onClick={() => action(async () => { setSession(await api('jobs/' + item.id + '/set-aside', {})); })}>Keep this kit and set it aside</Button>}</Stack></Box>)}</Box>
    {config.sampleAvailable && <Button onClick={() => sample()} disabled={busy}>Open the saved sample</Button>}
  </>;
  else if (screen === 'feedback' && job) content = <>
    <Heading title="How did it go?">A small try counts, even when the feeling stays.</Heading>
    <Box className="feedback-context"><Box component="img" src={'/api/jobs/' + job.id + '/previews/poster.webp'} alt={'Saved poster for ' + job.result.move.name} /><Box><Typography className="eyebrow">Chapter {job.chapterNumber}</Typography><Typography component="h2" variant="h3">{job.result.chapterTitle}</Typography></Box></Box>
    <RadioChoices label="Did your child try the move?" name="tried" value={triedMove} options={[[ 'yes', 'Yes, we tried it' ], [ 'no', 'Not yet' ]]} onChange={setTriedMove} />
    <RadioChoices label="Did it help?" name="helped" value={didItHelp} options={[[ 'yes', 'Yes' ], [ 'a little', 'A little' ], [ 'no', 'Not yet' ], [ 'not for us', 'This one is not for us' ]]} onChange={setDidItHelp} />
    <RadioChoices label="Where does your child want the poster?" name="wall" value={wallChoice} options={[[ 'Yes', 'Somewhere they choose' ], [ 'Keep it off the wall', 'Keep it private, or not tonight' ], [ 'Change it', 'Change it before putting it up' ]]} onChange={setWallChoice} />
    <Button variant="contained" disabled={busy || !triedMove || !didItHelp || !wallChoice} onClick={() => action(async () => { setSession(await api('jobs/' + job.id + '/feedback', { triedMove, didItHelp, wallChoice })); navigate('tonight'); setNotice('Saved.'); })}>Save and start tonight</Button><Button onClick={() => navigate('tonight')}>Leave this for later</Button>
  </>;
  else if (screen === 'family') content = <>
    <Heading title="Your family’s story record">Choose the section you want to change.</Heading>
    <Tabs value={familySection} onChange={(_, value) => setFamilySection(value)} variant="fullWidth" aria-label="Family settings" className="setup-tabs"><Tab value="people" label="People" /><Tab value="notes" label="Notes" /><Tab value="account" label="Account" /></Tabs>
    {familySection === 'people' && <>
    <Button variant="contained" onClick={() => navigate('people')}>Upload photo or describe a person</Button>    <FamilyCast people={people} /><Button variant="outlined" onClick={addChild}>Add another child</Button>
    <Panel><Typography variant="h2" component="h2">{session?.record.hero.nickname}, {session?.record.hero.age}</Typography><Typography variant="body2">{session?.record.hero.pronouns} · loves {session?.record.hero.loves.join(', ')}</Typography><Typography variant="body2">With {(session?.record.storyPeople ?? [{storyName: session?.record.parentLabel}]).map(person => person.storyName).join(' and ')}. Choose a look for each new story. Saved stories keep their own drawings.</Typography><Button variant="outlined" onClick={openPeopleEditor}>Edit people and hero</Button></Panel>

    </>}
    {familySection === 'notes' && <>
    <Typography component="h2" variant="h2" className="account-section">Notes for another evening</Typography><TextField label="Family notes for future stories" multiline minRows={6} value={notes} onChange={e => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 4000 } }} helperText="Saving clears story summaries made from older notes. Existing downloads are unchanged." />
    <Button variant="contained" disabled={busy} onClick={() => action(async () => { const saved = await api('family', { familyContext: notes, childId: session.childId }, 'PATCH'); setSession(saved); setNotice('Notes saved. The next story uses this version.'); })}>Save notes</Button>
    </>}
    {familySection === 'account' && <>
    <Box className="invite-family-entry"><Typography component="h2" variant="h2">Share a story night</Typography><Typography variant="body2">Invite another parent to try Story Poster with their family.</Typography><Button variant="outlined" onClick={() => navigate('invites')}>Invite a family</Button></Box><Typography component="h2" variant="h2" className="account-section">Privacy and permission</Typography><DataPolicyConsent settings key={ownerKey(session)} api={api} session={session} config={config} onSaved={refresh} /><Privacy config={config} /><Typography component="h2" variant="h2" className="account-section">Family login</Typography><Typography variant="body2" color="text.secondary">Family login: {session?.email ?? session?.username}. Your chosen story drawings stay with this family.</Typography>
    {session?.isOwner && <Button variant="outlined" onClick={() => navigate('owner')}>Review finished kits and access</Button>}
    <Button variant="outlined" disabled={busy} onClick={signOut}>Sign out</Button><Box className="account-section"><Button color="error" onClick={() => setConfirmDelete(true)}>Delete this saved family</Button></Box>
    </>}
  </>;
  else content = <><Heading title="Let’s start tonight" /><Button variant="contained" onClick={() => navigate(session ? 'tonight' : 'welcome')}>Continue</Button></>;

  const runningKit = job?.status === 'running' ? job : session?.jobs?.find(item => item.status === 'running' && item.id !== job?.id);
  const kitActivity = runningKit ? savedProgress(runningKit) : null;
  const headerActivity = kitActivity ? { active: kitActivity.active, message: kitActivity.active ? 'Making your kit. Your work is being saved.' : kitActivity.state === 'queued' ? 'Your kit is waiting its turn.' : kitActivity.state === 'worker-unavailable' ? 'Story making is offline. Your work is saved.' : 'Your kit request is saved.' } : portraitActivity?.owner === activityOwner ? portraitActivity : null;
  return <ThemeProvider theme={theme}><CssBaseline /><Box className={'app-frame route-' + screen} sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <SiteHeader activity={screen === 'wait' ? null : headerActivity} mode={mode} busy={busy} screen={screen} session={session} config={config} onHome={() => navigate('welcome')} onShelf={openShelf} onFamily={() => navigate(session?.record ? 'family' : 'setup')} onOwner={() => navigate('owner')} onSignOut={signOut} readSample={() => api('sample')} onTheme={() => { const next = mode === 'light' ? 'dark' : 'light'; setMode(next); document.documentElement.dataset.theme = next; try { localStorage.setItem('story-poster-theme', next); } catch {} }} />
    <Container component="main" className={'app-main screen-' + screen} sx={{ flex: 1 }}><Stack spacing={3.5} useFlexGap className="screen-stack">
      {session?.email && session.emailVerified === false && screen !== 'recovery' && <Alert severity="info">{config?.signup?.emailAvailable === false ? 'Email delivery is not ready yet. Your account and family details stay saved.' : 'Check your email to finish verifying your account. Your family details stay saved.'}<Button disabled={busy || config?.signup?.emailAvailable === false} onClick={() => action(async () => { const reply = await api('auth/resend-verification', {}); setNotice(reply.message ?? 'Check your inbox and spam folder for the verification link.'); })}>Send email again</Button></Alert>}
      {config && !config.realFamilySetupAllowed && screen !== 'welcome' && <Typography variant="body2" color="text.secondary">{config.sampleOnly ? 'Local preview · made-up families · no paid calls' : 'Local app · made-up families only'}</Typography>}
      {error && <Alert severity="error" onClose={() => setError('')} role="alert">{error}</Alert>}{notice && <Alert severity="success" role="status" onClose={() => setNotice('')}>{notice}</Alert>}{busy && <LinearProgress aria-label="Saving your choice" />}{session?.children?.length > 1 && screen !== 'setup' && <TextField select label="Tonight is for" value={session.childId} onChange={e => switchChild(e.target.value)} disabled={busy}>{session.children.map(child => <MenuItem key={child.id} value={child.id}>{child.nickname} · age {child.age}{child.age < 8 || child.age > 13 ? ' · can join another story' : ''}</MenuItem>)}</TextField>}{content}
    </Stack></Container>
    {session?.record && !loading && <Box component="nav" className="app-nav" aria-label="Main navigation" sx={{ borderTop: '1px solid', borderColor: 'divider', pb: 'env(safe-area-inset-bottom)' }}><Container className="nav-inner"><BottomNavigation showLabels value={['tonight', 'shelf', 'family'].includes(screen) ? screen : false} onChange={(event, value) => action(async () => { if (value === 'family') setNotes(session.record.familyContext); navigate(value); if (value === 'shelf') await refresh(); })}><BottomNavigationAction label="Tonight" value="tonight" /><BottomNavigationAction label="Our stories" value="shelf" /><BottomNavigationAction label="Family" value="family" /></BottomNavigation></Container></Box>}
    <KitFeedback key={ownerKey(session) + ':' + (suggestion?.jobId ?? '')} api={api} jobId={suggestion?.owner === ownerKey(session) ? suggestion.jobId : undefined} page={suggestion?.page} open={Boolean(suggestion && suggestion.owner === ownerKey(session) && ['result', 'story'].includes(screen) && suggestion.jobId === job?.id && !result?.sample)} onClose={() => setSuggestion(null)} />
    <Dialog open={peopleOpen} onClose={() => setPeopleOpen(false)} fullWidth maxWidth="sm" aria-labelledby="story-people-dialog-title"><DialogTitle id="story-people-dialog-title">Who joins this story?</DialogTitle><DialogContent>{storyPeople}</DialogContent><DialogActions><Button onClick={() => setPeopleOpen(false)}>Done</Button></DialogActions></Dialog>
    <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}><DialogTitle>Delete this saved family?</DialogTitle><DialogContent><Typography>Its notes, login and saved kits will be removed. Copies you already downloaded and provider records are not removed.</Typography></DialogContent><DialogActions><Button onClick={() => setConfirmDelete(false)}>Keep family</Button><Button color="error" onClick={() => action(async () => { await api('family', {}, 'DELETE'); for (const child of session.children ?? [{id: 'primary'}]) { browserRemove(draftKey({ ...session, childId: child.id })); browserRemove(viewKey({ ...session, childId: child.id })); } setConfirmDelete(false); setSession(null); setJob(null); setResult(null); setTonight(''); navigate('welcome'); })}>Delete family</Button></DialogActions></Dialog>
  </Box></ThemeProvider>;
}
createRoot(document.getElementById('root')).render(<App />);
