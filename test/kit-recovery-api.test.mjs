import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app-server.mjs';
import {readJSON,saveJSON,moves} from '../server/files.js';
import {offlineSample} from './offline-kit-fixture.mjs';
import {appJobClient,waitAppJob} from './app-job-client.mjs';
import {execFileSync} from 'node:child_process';
const fixture = readJSON(new URL('./fixtures/fictional-theo-exhausted-fit.json', import.meta.url));

test('terminal layout work can be kept aside, survives reload, and no longer blocks a later kit',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'kit-set-aside-'));let app,request,runs=0;
 t.after(async()=>{if(app?.server.listening)await app.close();rmSync(directory,{recursive:true,force:true});});
 const start=async()=>{app=createApp({dataDirectory:directory,sample:null,keyReader:()=> 'offline-only',transportFactory:()=>({call:async()=>assert.fail('No model calls')}),runKit:async(_transport,memory,tonight,options)=>{runs++;saveJSON(join(options.directory,'checkpoint.json'),{...fixture.checkpoint,recordAtStart:memory.exportRecord(),tonight,kit:options.kit});throw Object.assign(Error('private saved overflow details'),{code:'printed_layout_review_required',canResume:false});}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));request=appJobClient(`http://127.0.0.1:${app.server.address().port}`);};
 await start();const credentials={username:'kept_fixture',password:'fictional-password'};
 await request('signup',{...credentials,family:{real:false,nickname:'Pip',age:10,pronouns:'they/them',loves:['books','space','games'],presetId:'comet',parents:[{label:'Dad',pronouns:'he/him',hair:'short dark hair'}]}});
 const created=await request('jobs',{tonight:'Homework felt frustrating.',moveId:'name-it-exactly'});assert.equal(created.status,202);
 const failed=await waitAppJob(request,created.data.id,{interval:5,maxPolls:100});assert.equal(failed.canResume,false);assert.equal(failed.canSetAside,true);assert.doesNotMatch(failed.message,/private/);
 const db=readJSON(join(directory,'accounts.json')),job=db.jobs[0],path=join(directory,job.accountId,job.id,'checkpoint.json'),before=readFileSync(path);
 assert.equal((await request(`jobs/${job.id}/resume`,{})).status,409);assert.equal(runs,1);
 assert.equal((await request('jobs',{tonight:'Homework felt frustrating.',moveId:'name-it-exactly'})).status,409);
 assert.equal((await request(`jobs/${job.id}/set-aside`,{})).status,200);assert.deepEqual(readFileSync(path),before);
 const costs=readFileSync(join(directory,'daily-budget.json'));
 await app.close();await start();await request('login',credentials);
 const kept=await request(`jobs/${job.id}`);assert.equal(kept.data.status,'set-aside');assert.equal(kept.data.canResume,false);
 assert.equal((await request(`jobs/${job.id}/resume`,{})).status,409);assert.deepEqual(readFileSync(path),before);assert.deepEqual(readFileSync(join(directory,'daily-budget.json')),costs);
 const next=await request('jobs',{tonight:'Homework felt frustrating.',moveId:'name-it-exactly'});assert.equal(next.status,202);assert.equal(next.data.chapterNumber,job.chapterNumber+1);await waitAppJob(request,next.data.id,{interval:5,maxPolls:100});
 assert.equal(runs,2);assert.deepEqual(readFileSync(path),before);
});

test('the main HTTP download returns the actual five-page PDF and a useful filename',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'kit-pdf-http-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const sample=await offlineSample(join(directory,'sample'));
 const app=createApp({dataDirectory:join(directory,'accounts'),sample,sampleOnly:true,keyReader:()=>assert.fail('No credential reads')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.server.address().port}/api/sample/files/`;
 const response=await fetch(base+'kit_final.pdf?download=1');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('content-disposition'),'attachment; filename="tonights-five-page-kit.pdf"');
 const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual(bytes,readFileSync(join(sample.directory,'kit_final.pdf')));const downloaded=join(directory,'downloaded.pdf');writeFileSync(downloaded,bytes);assert.match(execFileSync('pdfinfo',[downloaded],{encoding:'utf8'}),/Pages:\s+5\b/);
 assert.match((await fetch(base+'kit_final.pdf')).headers.get('content-disposition'),/^inline;/);
 const poster=await fetch(base+'poster.pdf');const posterPath=join(directory,'poster.pdf');writeFileSync(posterPath,Buffer.from(await poster.arrayBuffer()));assert.notDeepEqual(readFileSync(posterPath),bytes);
});
