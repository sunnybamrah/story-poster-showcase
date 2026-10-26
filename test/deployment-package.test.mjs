import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, cpSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { root } from '../server/files.js';

// Audit the actual relative-import closure, not a hand-picked module list.
test('both deployment manifests include every server relative import without the private archive', () => {
  for (const name of ['.dockerignore', '.railwayignore']) {
    const rules = readFileSync(resolve(root, name), 'utf8').split('\n');
    const trees = rules.filter(line => /^![^/]+\/\*\*$/.test(line)).map(line => line.slice(1, -3));
    const files = new Set(rules.filter(line => line.startsWith('!') && !line.includes('*') && !line.endsWith('/')).map(line => line.slice(1)));
    const included = file => files.has(file) || trees.some(tree => file.startsWith(tree + '/'));
    const pending = [resolve(root, 'server/app-server.mjs')], visited = new Set();
    while (pending.length) {
      const file = pending.pop(); if (visited.has(file)) continue; visited.add(file);
      const local = relative(root, file);
      assert.ok(!local.startsWith('..') && included(local), `${name} omits runtime module ${local}`);
      assert.ok(existsSync(file), `Runtime module is missing: ${local}`);
      const text = readFileSync(file, 'utf8');
      const imports = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|new URL\(\s*)['"](\.[^'"]+)['"]/g)].map(match => match[1]);
      for (const specifier of imports) {
        const target = resolve(dirname(file), specifier);
        if (/\.(?:m?js|json)$/.test(target)) pending.push(target);
      }
    }
    assert.ok(visited.size > 40, 'The audit should traverse the real server graph.');
    for (const privatePath of ['context/local-app/accounts.json', '.env', 'devpost/learner-profile.md', 'war-room/HIS-WORDS-ALL.md', 'war-room/research/chatgpt-growth-project/project-files/FAMILY-FACTS.txt']) assert.equal(included(privatePath), false, `${name} includes ${privatePath}`);
    for (const source of ['STYLE.txt', 'FORMAT.txt', 'PROJECT-INSTRUCTIONS.txt', 'POSTER-CHECK.txt']) assert.ok(included('war-room/research/chatgpt-growth-project/project-files/' + source));
  }
});

test('the filtered runtime package boots with no private checkout or general test archive', t => {
  const temporary = mkdtempSync(resolve(tmpdir(), 'story-deploy-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const rules = readFileSync(resolve(root, '.dockerignore'), 'utf8').split('\n');
  const trees = rules.filter(line => /^![^/]+\/\*\*$/.test(line)).map(line => line.slice(1, -3));
  const files = rules.filter(line => line.startsWith('!') && !line.includes('*') && !line.endsWith('/')).map(line => line.slice(1));
  for (const file of [...trees, ...files]) {
    if (!existsSync(resolve(root, file))) continue;
    mkdirSync(dirname(resolve(temporary, file)), { recursive: true });
    cpSync(resolve(root, file), resolve(temporary, file), { recursive: true });
  }
  symlinkSync(resolve(root, 'node_modules'), resolve(temporary, 'node_modules'), 'dir');
  assert.equal(existsSync(resolve(temporary, 'war-room/HIS-WORDS-ALL.md')), false);
  const moduleURL = pathToFileURL(resolve(temporary, 'server/app-server.mjs')).href;
  const code = `const {createApp}=await import(${JSON.stringify(moduleURL)}); const app=createApp({sampleOnly:true,sample:null,dataDirectory:${JSON.stringify(resolve(temporary, 'private-test-state'))}}); await app.close();`;
  execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: temporary, stdio: 'pipe', env: { ...process.env, STORY_POSTER_HOSTED: '0', STORY_POSTER_WORKER_SECRET: '' } });
});
