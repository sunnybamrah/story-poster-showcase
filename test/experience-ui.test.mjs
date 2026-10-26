import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { createApp } from '../server/app-server.mjs';
import { passwordFields } from '../server/accounts.js';
import { root, readJSON, saveJSON } from '../server/files.js';
import { launchMeasurementBrowser } from '../server/layout-fit.js';

// Real app and local owned HTTP storage, saved fictional artwork. Injected PDF
// output proves UI routing only; backend separately checks actual PDF rendering.
const privateCheckpoint = join(root, 'context/age8-shared-story-2026-10-19/kit-1/checkpoint.json');
test('saved progress, email return, print choices and private plan work on phone in both themes', { skip: !existsSync(privateCheckpoint) && 'Needs the excluded file context/age8-shared-story-2026-10-19/kit-1/checkpoint.json from the private fictional kit.' }, async t => {
  const output = join(root, 'context/experience-followthrough-2026-10-20/ui'); mkdirSync(output, { recursive: true });
  const source = join(root, 'context/age8-shared-story-2026-10-19/kit-1'), checkpoint = readJSON(join(source, 'checkpoint.json'));
  assert.equal(checkpoint.recordAtStart.real, false);
  const directory = mkdtempSync(join(output, 'private-')), password = 'fictional-ui-password', id = randomUUID();
  const accounts = ['one', 'two'].map(name => ({ id: randomUUID(), username: name, email: name + '@example.test', emailVerified: true, creationEnabled: true, ...passwordFields(password), childIds: ['primary'], activeChildId: 'primary' }));
  const db = { accounts, jobs: [], sessions: [] };
  for (const account of accounts) saveJSON(join(directory, account.id, 'family.json'), checkpoint.recordAtStart);
  const destination = join(directory, accounts[0].id, id); mkdirSync(destination, { recursive: true });
  for (const file of ['poster.png', 'poster.pdf', 'kit_final.pdf', 'panel-1.png', 'panel-2.png', 'panel-3.png', 'panel-4.png']) copyFileSync(join(source, file), join(destination, file));
  for (const file of ['poster.html', 'kit_final.html']) writeFileSync(join(destination, file), '<html><body>Saved fictional print fixture</body></html>');
  let renders = 0;
  const app = createApp({ dataDirectory: directory, sample: { directory: source, text: checkpoint.stages.text, record: checkpoint.recordAtStart }, sampleOnly: false, generationRoute: 'subscription', allowSyntheticPortraits: true,
    publicOrigin: 'http://localhost', stateStore: { initialState: db, assertWritable() {}, save() {}, flush: async () => {} },
    sendMail: Object.assign(async () => assert.fail('No email sends in this proof.'), { available: true }), autoDeliverAccess: false,
    transportFactory: () => ({ call() { assert.fail('No generation in this proof.'); } }),
    printCopyRenderer: async ({ outputRoot }) => { renders++; const directory = join(outputRoot, 'ui-fixture'); mkdirSync(directory, { recursive: true }); const outputs = {}; for (const name of ['poster-bw.pdf', 'kit-bw.pdf']) { writeFileSync(join(directory, name), 'UI fixture PDF'); outputs[name] = createHash('sha256').update('UI fixture PDF').digest('hex'); } return { directory, receipt: { outputs } }; },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const target = 'http://127.0.0.1:' + app.server.address().port;
  const result = await fetch(target + '/api/sample').then(r => r.json()); result.sample = false;
  db.jobs.push({ id, accountId: accounts[0].id, childId: 'primary', status: 'complete', stage: 'ready', chapterNumber: 1, moveId: checkpoint.stages.text.moveId, result, createdAt: new Date().toISOString() });
  const vite = await createServer({ configFile: false, root: join(root, 'app'), publicDir: join(root, 'public'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target, changeOrigin: true, configure: proxy => proxy.on('proxyReq', request => request.setHeader('origin', 'http://localhost')) } } } });
  await vite.listen(); t.after(() => vite.close());
  const base = 'http://127.0.0.1:' + vite.httpServer.address().port, browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage(); const screenshots = [], errors = [], requests = [], contrasts = [], nativeFonts = [], fontResponses = [];
  page.on('response', response => { if (/\.woff2(?:[?#]|$)/.test(response.url())) fontResponses.push({url:response.url(),status:response.status()}); });
  const cdp = await context.newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (request.url().includes('/api/')) requests.push({ path: new URL(request.url()).pathname, method: request.method() }); });
  const both = async name => { for (const theme of ['light', 'dark']) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole('button', { name: theme === 'dark' ? 'Use dark theme' : 'Use light theme', exact: true }).click();
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, name + ' fits');
    const ratios = await page.locator('.brand-tagline,.saved-job-progress p,.practice-plan label,.print-options p').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().height).map(node => {
      const rgb = x => x.match(/[\d.]+/g).map(Number), mix = (a,b) => a.slice(0,3).map((x,i) => x*(a[3] ?? 1)+b[i]*(1-(a[3] ?? 1))), lum = a => a.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
      const parents=[]; for(let n=node;n;n=n.parentElement)parents.unshift(n); const bg=parents.reduce((a,n)=>mix(rgb(getComputedStyle(n).backgroundColor),a),[255,255,255]), fg=mix(rgb(getComputedStyle(node).color),bg), v=[lum(fg),lum(bg)].sort((a,b)=>b-a);return {text:node.textContent,ratio:(v[0]+.05)/(v[1]+.05)};
    })); for(const item of ratios)assert.ok(item.ratio>=4.5, JSON.stringify(item)); contrasts.push({name,theme,ratios});
    if(name === 'welcome') {
      const faces = await page.evaluate(()=>[...document.fonts].map(face=>({family:face.family.replaceAll('"',''),weight:face.weight,status:face.status})));
      assert.equal(faces.length,6,'Six distinct font faces must be registered.');
      assert.deepEqual(faces.filter(face=>face.family==='Plus Jakarta Sans').map(face=>face.weight).sort(),['400','600','700','800']);
      assert.ok(faces.some(face=>face.family==='Nunito'&&face.weight==='200 1000'));assert.ok(faces.some(face=>face.family==='Baloo 2'&&face.weight==='400 800'));
      const {root:doc}=await cdp.send('DOM.getDocument');const rendered={};
      for(const [label,selector,family] of [['tagline','.brand-tagline','Plus Jakarta Sans'],['button','.welcome-actions button','Plus Jakarta Sans'],['heading','h1','Georgia']]){
        const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:doc.nodeId,selector}); const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId}); rendered[label]=fonts;
        assert.ok(fonts.some(font=>font.glyphCount>0&&font.familyName.startsWith(family)),label+' must draw with '+family+': '+JSON.stringify(fonts));
        assert.ok(fonts.filter(font=>font.glyphCount>0).every(font=>font.familyName.startsWith(family)),label+' must not silently fall back.');
      }
      assert.ok(fontResponses.some(response=>response.url.includes('jakarta')&&response.status===200),'Visible Jakarta text must load its bundled font.');nativeFonts.push({theme,faces,rendered});
    }
    const path=join(output,name+'-'+theme+'.png'); await page.screenshot({path,fullPage:true,animations:'disabled'});screenshots.push(path);
    const focus = name.startsWith('plan-') ? '.practice-plan' : name.startsWith('print-') || name==='sample-saved-print' ? '.print-options' : null;
    if(focus){await page.locator(focus).scrollIntoViewIfNeeded();const close=join(output,name+'-'+theme+'-phone.png');await page.screenshot({path:close,animations:'disabled'});screenshots.push(close);}

  }};
  const login = async name => { await page.getByLabel(/^Email or existing family login/).fill(name+'@example.test'); await page.getByLabel(/^Password/).fill(password); await page.getByRole('button',{name:'Sign in',exact:true}).click(); };
  // This existing progress/mail fixture has saved drawings but no portrait index.
  // Supply its ready people explicitly; portrait readiness has separate real-route tests.
  await page.route('**/api/portraits?**', route => route.fulfill({ json: { people: checkpoint.recordAtStart.cast.map(person => ({ id: person.id, selectedUrl: '/api/sample/previews/poster.webp' })) } }));
  await page.goto(base); await page.getByText('One moment. One skill. One rhyme.',{exact:true}).waitFor(); await both('welcome');
  const spacing = await page.addStyleTag({content:'p,button,label,a,h1,h2,h3,span { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }'}); await both('welcome-text-spacing'); await spacing.evaluate(node=>node.remove());
  await page.goto(base+'/#shelf'); await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor(); await page.reload(); await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor(); await login('one'); await page.waitForURL('**/#shelf');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('sp-shelf-return')),null);
  await page.goto(base+'/#tonight'); await page.getByLabel('Email me when it is ready',{exact:true}).waitFor(); assert.equal(await page.getByLabel('Email me when it is ready',{exact:true}).isChecked(),false); await page.getByLabel('Email me when it is ready',{exact:true}).check(); await both('tonight-email');
  let submitted;
  await page.route('**/api/moment/clarify', route => route.fulfill({json:{status:'ready'}}));
  await page.route('**/api/jobs', route => { submitted=route.request().postDataJSON(); return route.fulfill({json:{status:'noMatch',message:'UI fixture chooses no guide.',canRepeat:false}}); });
  await page.getByRole('textbox',{name:'What stayed with you today?',exact:true}).fill('We had a hard time taking turns.');
  await page.getByRole('button',{name:'Create our story',exact:true}).click(); await page.getByText('UI fixture chooses no guide.',{exact:true}).waitFor(); assert.equal(submitted.notifyWhenReady,true);
  await page.unroute('**/api/jobs'); await page.unroute('**/api/moment/clarify');
  await page.goto(base+'/#result/'+id); await page.getByRole('heading',{name:'Print or save',exact:true}).waitFor(); await page.getByRole('radio',{name:'Black and white',exact:true}).check(); assert.equal(renders,0); await both('print-prepare');
  await page.getByRole('button',{name:'Prepare black-and-white copy',exact:true}).click(); await page.getByRole('link',{name:'Download black-and-white PDF',exact:true}).waitFor(); assert.equal(renders,1); await both('print-ready');
  // Verified old downloads remain visible separately from refresh progress.
  for (const state of ['available', 'preparing', 'failed']) {
    const copy = {status:state === 'preparing' ? 'preparing' : 'available',assets:{kitPdf:`/api/jobs/${id}/files/kit-bw.pdf`,posterPdf:`/api/jobs/${id}/files/poster-bw.pdf`},refresh:{status:state,message:state === 'failed' ? 'The clearer copy stopped. Your saved black-and-white copy is still here. You can try again.' : 'Your saved black-and-white copy is still here.'}};
    copy.message = copy.refresh.message;
    await page.route('**/api/jobs/'+id+'/print-copy', route => route.fulfill({json:copy}));
    await page.reload(); await page.getByRole('radio',{name:'Black and white',exact:true}).check();
    const link=page.getByRole('link',{name:'Download black-and-white PDF',exact:true});await link.waitFor();
    assert.match(await link.getAttribute('href'),/kit-bw\.pdf\?download=1$/);
    await page.getByRole('link',{name:'Open black-and-white poster',exact:true}).waitFor();
    if(state === 'preparing') await page.getByRole('status').filter({hasText:copy.message}).waitFor();
    else await page.getByRole('button',{name:state === 'failed' ? 'Try the clearer copy again' : 'Make a clearer copy',exact:true}).waitFor();
    if(state === 'failed') assert.equal(await page.getByRole('alert').innerText(),copy.message);
    await both('print-refresh-'+state);
    await page.unroute('**/api/jobs/'+id+'/print-copy');
  }
  await page.getByRole('radio',{name:'Colour',exact:true}).check(); assert.match(await page.getByRole('link',{name:'Download full five-page PDF',exact:true}).getAttribute('href'),/kit_final\.pdf/); assert.equal(renders,1);
  const openPlan = async () => { await page.goto(base+'/#story/'+id); await page.getByRole('button',{name:'Type our plan (optional)',exact:true}).click(); await page.getByLabel('When I notice',{exact:true}).waitFor(); };
  await openPlan(); await page.getByLabel('When I notice',{exact:true}).fill('My hands feel tight.'); await page.getByLabel('I',{exact:true}).fill('Ask for a turn.'); await page.getByRole('button',{name:'Save our plan',exact:true}).click(); await page.getByText('Your plan is saved with this story.',{exact:true}).waitFor(); await both('plan-saved');
  await page.reload(); await page.getByRole('button',{name:'Type our plan (optional)',exact:true}).click(); await page.getByLabel('I',{exact:true}).waitFor(); assert.equal(await page.getByLabel('I',{exact:true}).inputValue(),'Ask for a turn.');
  const fail = route => route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Fixture connection failed. Your words stay here.'})}):route.continue();
  await page.route('**/practice',fail); await page.getByLabel('I',{exact:true}).fill('Keep my draft.'); await page.getByRole('button',{name:'Save our plan',exact:true}).click(); await page.getByText('Fixture connection failed. Your words stay here.',{exact:true}).waitFor(); assert.equal(await page.getByLabel('I',{exact:true}).inputValue(),'Keep my draft.'); await page.unroute('**/practice',fail);
  const current = await context.request.get(base+'/api/jobs/'+id+'/practice').then(r=>r.json()); await context.request.put(base+'/api/jobs/'+id+'/practice',{data:{revision:current.revision,answers:{notice:'Other saved words.',action:'Other plan.'}}});
  await page.getByRole('button',{name:'Save our plan',exact:true}).click(); await page.getByRole('button',{name:'Save my words',exact:true}).waitFor(); assert.equal(await page.getByLabel('I',{exact:true}).inputValue(),'Keep my draft.'); await both('plan-conflict'); await page.getByRole('button',{name:'Save my words',exact:true}).click(); await page.getByText('Your plan is saved with this story.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Clear our plan',exact:true}).click(); await page.getByText('Your saved plan is cleared. The story stays the same.',{exact:true}).waitFor(); assert.equal(await page.getByLabel('I',{exact:true}).inputValue(),'');
  // Existing reading-place navigation remains usable alongside the new closed editor.
  await page.getByRole('button',{name:'Type our plan (optional)',exact:true}).click(); await page.getByText('Reading options',{exact:true}).click(); await page.getByRole('button',{name:'Larger text',exact:true}).click(); await page.reload(); await page.getByText('Reading options',{exact:true}).click(); assert.equal(await page.getByRole('button',{name:'Larger text',exact:true}).getAttribute('aria-pressed'),'true');
  await page.goto(base+'/?proof=sample#story/sample'); await page.getByRole('button',{name:'See the poster and pages',exact:true}).waitFor(); assert.equal(await page.getByRole('button',{name:'Type our plan (optional)',exact:true}).count(),0); await both('sample-reader');
  const sampleReply = {...result,sample:true,printCopy:{status:'ready',assets:{kitPdf:'/api/sample/files/kit-bw.pdf',posterPdf:'/api/sample/files/poster-bw.pdf'}}};
  await page.route('**/api/sample', route => route.fulfill({json:sampleReply})); await page.goto(base+'/?proof=sample-print#poster/sample'); await page.getByRole('radio',{name:'Black and white',exact:true}).check(); await page.getByRole('link',{name:'Download black-and-white PDF',exact:true}).waitFor(); assert.equal(await page.getByRole('button',{name:'Prepare black-and-white copy',exact:true}).count(),0); await both('sample-saved-print'); await page.unroute('**/api/sample');
  await openPlan(); await page.getByLabel('I',{exact:true}).fill('Words for a late response.');
  let release; const gate = new Promise(resolve=>{release=resolve;}); let arrived; const pending=new Promise(resolve=>{arrived=resolve;});
  await page.route('**/practice', async route=>{ if(route.request().method()!=='PUT')return route.continue(); arrived(); await gate; await route.fulfill({json:{prompts:{notice:'When I notice',action:'I'},answers:{notice:'',action:'Late old-family words.'},revision:99,maxLength:500}}).catch(()=>{}); });
  await page.getByRole('button',{name:'Save our plan',exact:true}).click(); await pending; await page.getByRole('button',{name:'Tonight',exact:true}).click(); release(); await page.getByRole('button',{name:'Create our story',exact:true}).waitFor(); assert.equal(await page.getByText('Late old-family words.',{exact:true}).count(),0); await page.unroute('**/practice');

  // Inject only public progress states, keeping the real page/HTTP/auth flow.
  for (const [state,message,active] of [['queued','Your story is saved and waiting its turn.',false],['worker-unavailable','Story making is offline right now; your work is saved.',false],['working','We are checking the story.',true],['paused','Your work is saved. Resume when you are ready.',false]]) {
    const status=state==='paused'?'paused':'running'; const fixture={...db.jobs[0],status,progress:{state,message,active},canResume:status==='paused',canSetAside:status==='paused',readyEmail:{enabled:true,status:'waiting'}};
    await page.route('**/api/session',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({response,json:{...data,jobs:[fixture]}});}); await page.route('**/api/jobs/'+id,route=>route.fulfill({json:fixture}));
    await page.goto(base+'/#wait/'+id); await page.getByText(message,{exact:true}).waitFor(); assert.equal(await page.locator('.saved-job-progress').getAttribute('data-active'),String(active)); assert.equal(await page.getByText(message,{exact:true}).count(),1); await page.getByRole('heading',{name:active?'Making tonight’s kit':'Your work is saved',exact:true}).waitFor(); if(status==='running') await page.getByRole('button',{name:active?'Pause after this step':'Pause this saved request',exact:true}).waitFor(); assert.doesNotMatch(await page.locator('body').innerText(),/10 minutes|percent|\d+%/); await both('wait-'+state);
    assert.equal(await page.locator('.working-bar').count(), active ? 1 : 0); if(active){assert.ok((await page.locator('.working-bar').boundingBox()).height >= 10);assert.notEqual(await page.locator('.saved-job-progress').evaluate(n=>getComputedStyle(n).animationName),'none');await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.saved-job-progress').evaluate(n=>getComputedStyle(n).animationName),'none');assert.equal(await page.locator('.working-bar .MuiLinearProgress-bar').first().evaluate(n=>getComputedStyle(n).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});}
    await page.unroute('**/api/session'); await page.unroute('**/api/jobs/'+id);
  }
  await context.request.post(base+'/api/logout',{data:{}}); await page.goto(base+'/#shelf'); await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor(); await login('two'); await page.waitForURL('**/#shelf'); assert.equal(await page.getByText(result.chapterTitle,{exact:true}).count(),0); await page.goto(base+'/#story/'+id); await page.waitForURL('**/#tonight'); assert.equal(await page.getByRole('button',{name:'Type our plan (optional)',exact:true}).count(),0);
  assert.equal((await context.request.get(base+'/api/jobs/'+id+'/practice')).status(),404);
  assert.equal(requests.filter(r=>r.path==='/api/jobs'&&r.method==='POST').length,1, 'Only the intercepted opt-in payload was submitted.'); assert.deepEqual(errors,[]);
  saveJSON(join(output,'proof.json'),{status:'pass',screenshots,contrasts,nativeFonts,fontResponses,requests,fixture:'Local accounts, saved fictional art, injected PDF output and explicit progress-state responses. No model generation, real mail or deployment.',checks:['ready email shelf return survives login refresh','email opt-in off by default','B/W only explicit prepare and original colour kept','private plan saves/reloads/clears; network and conflict preserve draft','normal saved reader and sample no editor','actual progress one sentence, queue/offline static, reduced motion','other account cannot read plan or kit']});
});
