import { selectedRhymeFor } from '../server/rhyme.js';
import { moves, words } from '../server/files.js';
import { panelWithSpeaker } from '../server/panel-contract.js';
import { family } from './fixture.mjs';
// Synthetic parser inputs only. These are never saved as generated stories or ready kits.
export function kitText(move = moves[0], { wordCount = 600, nickname = 'Pip' } = {}) {
  const panelLines = [
    { speakerId: 'child', scene: 'The child pauses beside a table with an unfinished puzzle.', line: 'This feels hard.' },
    { speakerId: 'child', scene: 'The child looks closely at the puzzle beside the window.', line: 'I can try this.' },
    { speakerId: 'child', scene: 'The child tells the grown-up about the puzzle attempt.', line: 'Can we talk now?' },
    { speakerId: 'child', scene: 'The child places the puzzle piece near the corner.', line: 'I made a start.' },
  ];
  const start = `${panelLines.slice(0, 2).map(panel => panel.line).join('\n')}\nThe puzzle waits.\n${move.practiceScript.replaceAll('[name]', nickname)}\nonly after a grown-up says it is safe\n`;
  const pad = count => Array.from({ length: count }, (_, i) => i % 50 === 49 ? 'test.\n' : 'test').join(' ');
  const firstCount = Math.floor(wordCount / 2);
  const firstPad = firstCount - words(start).length;
  const secondStart = panelLines.slice(2).map(panel => panel.line).join('\n') + '\n';
  const secondPad = wordCount - firstCount - words(secondStart).length;
  if (Math.min(firstPad, secondPad) < 0) throw new Error('Fixture too short for fixed practice.');
  const story = start + pad(firstPad) + '\n' + secondStart + pad(secondPad);
  return { moveId: move.id, chapterTitle: 'A Small Start', tagline: selectedRhymeFor(move).tagline, story,
    panelLines, jokeIdea: 'A tiny puzzle piece wears an enormous plain hat.', feelFirst: ['That felt hard.', 'You can still feel it while we think together.'],
    tinyTryOptions: ['Name a feeling you notice now.', 'Let a grown-up say a feeling, then pick a more exact word.', 'Act out a feeling and tell a grown-up its name.'].map((text, i) => ({ text, seconds: [30, 60, 90][i], offScreen: true })),
    whereElse: { line: 'Where else could this same move work?', place: 'Beside the classroom door.' }, noticedFeeling: 'frustrated', replayCue: 'My hands tense beside the puzzle.' };
}

// Modern fake-writer envelope only. Archived fixture files stay byte-for-byte intact.
export function withSyntheticSpeakers(text, record = family) {
  const result = structuredClone(text);
  result.panelLines = result.panelLines.map(panel => ({ ...panel, speakerId: panelWithSpeaker(record, panel, result.story).speakerId ?? 'child' }));
  return result;
}
