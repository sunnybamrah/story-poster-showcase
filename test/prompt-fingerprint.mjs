// Prints every model-facing text built from the four original Project files,
// for the checkout at the given root (default: this checkout), as JSON.
// Usage: node test/prompt-fingerprint.mjs [repoRoot] [--full]
// test/public-copy-prompts.test.mjs pins these hashes to the private working
// repo's output, so the name substitution in the public copy changes no prompt.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function promptTexts(root) {
  const base = root ? pathToFileURL(resolve(root) + '/') : new URL('..', import.meta.url);
  const load = path => import(new URL(path, base).href);
  const source = await load('server/project-source.js');
  const rules = await load('server/story-rules.js');
  const style = await load('server/graphic-style.js');
  const looks = await load('app/picture-styles.js');
  const texts = {
    posterSource: source.projectPosterSource(null),
    storySource: source.projectStorySource(),
    originalStyleLine: source.originalStyleLine(),
    originalPosterCheck: source.originalPosterCheck().join('\n'),
    storyRules: rules.STORY_RULES,
    judgeStoryRules: rules.JUDGE_STORY_RULES,
    comicFaceRule: style.comicFaceRule,
  };
  for (const option of looks.allPictureStyleOptions) texts[`posterSource:${option.id}`] = source.projectPosterSource(style.ownLookFor(option.id));
  return texts;
}

export const sha256 = text => createHash('sha256').update(text).digest('hex');

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  const texts = await promptTexts(root);
  const full = process.argv.includes('--full');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(texts).map(([key, text]) => [key, full ? text : sha256(text)])), null, 2));
}
