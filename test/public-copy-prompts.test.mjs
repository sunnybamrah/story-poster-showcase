import test from 'node:test';
import assert from 'node:assert/strict';
import { promptTexts, sha256 } from './prompt-fingerprint.mjs';

// SHA-256 of each generated text, produced by test/prompt-fingerprint.mjs in the
// private working repo at commit 14c6fe514a9080cbe62c94e4d7cbe5a3f530e3a1 (before the public-copy name
// substitution). Equal hashes mean the public copy sends byte-identical prompts.
const privateRepoHashes = {
  "posterSource": "282536cb941a038273cdfde0b1f1f08f85ca722c4c26258c9f90bd4e9987cb10",
  "storySource": "d43ddf558010c85bb06b6747fd43649a859574d13257eaeede1b0d459dbe2478",
  "originalStyleLine": "6c959d076e14ddb7f26e1f08a204128f46529fe3a9c28e69e87a4315653c31c7",
  "originalPosterCheck": "1c488fba11d9c35192975f17d8f973f91707c30831ca5eb8f609394113854764",
  "storyRules": "d5f0d47e5e63ce9d3b1c7bb5958f85e3f3a3affc726709c9b091be278ad96c61",
  "judgeStoryRules": "ee99c2cdf2676883228ddfeda53ef6fe74ef8e8beda123abfbc74ba9149e3f85",
  "comicFaceRule": "bc00c1bb4b8dbcae0aea6cfef598fd0c7d2bc412fd5ad787ccc6f84d897d94f4",
  "posterSource:friendly-anime": "534440c1ed7960b1cb6e1141e9274b890cd4e21ba09a674cc438c3802cff87fd",
  "posterSource:adventure-comic": "8cd1fb4f7d5b014509746b7103b4a3d8c16eaf42f9e4a6daa660eb1dbd23d09d",
  "posterSource:diary-doodles": "76c76475a986baafa0a0e927318d7617407134d4842c8aba742a40120b364ed7",
  "posterSource:heritage-storybook": "282536cb941a038273cdfde0b1f1f08f85ca722c4c26258c9f90bd4e9987cb10",
  "posterSource:bold-ink-comic": "282536cb941a038273cdfde0b1f1f08f85ca722c4c26258c9f90bd4e9987cb10",
  "posterSource:anime-comic": "282536cb941a038273cdfde0b1f1f08f85ca722c4c26258c9f90bd4e9987cb10",
  "posterSource:painted-comic": "282536cb941a038273cdfde0b1f1f08f85ca722c4c26258c9f90bd4e9987cb10",
  "posterSource:classic-comic": "282536cb941a038273cdfde0b1f1f08f85ca722c4c26258c9f90bd4e9987cb10",
  "posterSource:animated-film": "282536cb941a038273cdfde0b1f1f08f85ca722c4c26258c9f90bd4e9987cb10",
  "posterSource:detailed-comic": "282536cb941a038273cdfde0b1f1f08f85ca722c4c26258c9f90bd4e9987cb10"
};

test('the public copy builds byte-identical model prompts to the private working repo', async () => {
  const texts = await promptTexts();
  assert.deepEqual(Object.keys(texts).sort(), Object.keys(privateRepoHashes).sort());
  for (const [key, text] of Object.entries(texts)) assert.equal(sha256(text), privateRepoHashes[key], key);
});
