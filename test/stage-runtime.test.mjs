import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const script = new URL('../scripts/stage-runtime.mjs', import.meta.url).pathname;
test('staging exports committed bytes, preserves executable files and refuses private paths or receipt overwrite', t => {
  const dir=mkdtempSync(join(tmpdir(),'stage-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  mkdirSync(join(dir,'context'));mkdirSync(join(dir,'app'));
  writeFileSync(join(dir,'package.json'),'original package');writeFileSync(join(dir,'app/main.js'),'reviewed code');writeFileSync(join(dir,'app/run.sh'),'echo ready\n');chmodSync(join(dir,'app/run.sh'),0o755);writeFileSync(join(dir,'.env'),'fictional-secret');symlinkSync('main.js',join(dir,'app/link.js'));
  const git=args=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});git(['init','-q']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture']);
  const manifest=join(dir,'context/base.json');const set=paths=>writeFileSync(manifest,JSON.stringify({files:paths.map(path=>({path}))}));
  const run=out=>execFileSync(process.execPath,[script,manifest,'HEAD',out],{cwd:dir,stdio:'pipe'});
  set(['package.json','app/main.js','app/run.sh']);writeFileSync(join(dir,'app/main.js'),'unreviewed changes');
  const result=JSON.parse(run('context/release').toString());t.after(()=>rmSync(result.directory,{recursive:true,force:true}));
  assert.equal(readFileSync(join(result.directory,'app/main.js'),'utf8'),'reviewed code');assert.ok(statSync(join(result.directory,'app/run.sh')).mode&0o111);
  assert.throws(()=>run('.'));assert.equal(readFileSync(join(dir,'package.json'),'utf8'),'original package');
  for(const name of ['.env','context/private.txt','app/link.js','../outside','..\\outside']){set([name]);assert.throws(()=>run('context/rejected'));}
});
