// Hand-written fiction and simple vector humans. No model calls or generated-art claims.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { family, sentences } from './fixture.mjs';
import { moves, saveJSON, words } from '../server/files.js';
import { posterBoxes, tinyTryOptionsFor, splitStory } from '../server/format.js';
import { selectedRhymeFor } from '../server/rhyme.js';
import { lockedCast } from '../server/cast.js';
import { geometryRects, legacyPosterTemplate as posterTemplate, posterTypePlan } from '../server/poster-template.js';
import { printedLines } from '../server/printed-type.js';
import { copyFonts, escapeHTML as esc } from '../server/layout.js';
import { launchMeasurementBrowser } from '../server/layout-fit.js';

export function readableKitText() {
  const move = moves.find(move => move.id === 'name-it-exactly');
  const paragraphs = [
    'The door bangs against the rubber stop.',
    'Pip drops his school bag beside the chair.',
    '“I said leave it.”',
    'Dee stops beside the kettle. “You want some space.” Pip nods, then shakes his head. His bag zip catches on a folded sheet.',
    'He tugs again. “Everyone is annoying.” Dee sets the kettle down. “That sounds like a rough afternoon.”',
    'The sheet comes free. It is his comic, with a huge empty speech bubble. He turns it face down. “I do not want questions about school.”',
    '“All right.” Dee moves a chair back. Pip stands for a moment, then sits on its edge. “Can you just sit here?”',
    'Dee sits. Pip rolls a pencil toward the folded paper. “Bad,” he says. “That is the only word I have.”',
    '“You can keep it, or look for one that fits closer.” Pip wants him there, but he is reluctant to explain. The words crowd the doorway together.',
    '“Can I have an example? Without telling the whole thing?” Dee nods. “You choose how much to say.” He waits until Pip puts the pencil down.',
    move.practiceScript,
    'Pip looks at the clock. “That was a lot of words.” Dee smiles. “You only need the one that fits you.”',
    'Pip draws a tiny hat on the empty speech bubble. He snorts. “That bubble is doing better than me. It has a hat.”',
    'On the back, he writes furious, then crosses it out. Too big. Baffled is closer: he cannot work out why the afternoon still stings.',
    'He touches his pencil to left out. “I think it is left out.” Dee looks at him, rather than reaching for the paper.',
    '“The knot is still here,” Pip says. “Left out and annoyed.” He gives it a number. Dee repeats his words once.',
    'Pip pushes the paper toward the middle of the table, keeping the comic face down. There is still something he wants to keep to himself.',
    '“Does the word fix it?” he asks. “Naming feelings helped adults feel less upset in studies,” Dee says. “That does not tell us whether this practice helps children your age, or whether it brings quick relief.”',
    'Pip turns the comic over and draws the bubble a small pair of shoes. “I am still annoyed.” Dee nods. The bubble is still empty.',
    '“But those are my words.” Pip puts the pencil beside his school bag and pulls his chair closer. School can wait for another conversation. Dee stays.',
  ];
  const panelLines = [
    { scene: 'The child stands beside his dropped school bag near the kitchen door. Grown-up-one stops beside the kettle and listens.', line: 'I said leave it.' },
    { scene: 'The child sits on the edge of a chair at the table. Grown-up-one sits beside him with his hands still on the table.', line: 'Can you just sit here?' },
    { scene: 'The child touches his pencil to his own paper on the table. Grown-up-one looks at him and listens.', line: 'The knot is still here.' },
    { scene: 'The child puts his pencil beside the school bag and draws his chair closer to grown-up-one at the kitchen table.', line: 'But those are my words.' },
  ];
  const story = paragraphs.join('\n');
  const text = { moveId: move.id, chapterTitle: 'The Empty Bubble', tagline: selectedRhymeFor(move).tagline, story, panelLines,
    jokeIdea: 'An empty comic speech bubble has a tiny plain party hat and little shoes.', feelFirst: ['That sounds like a rough afternoon.', 'You can choose how much to tell me.'],
    tinyTryOptions: tinyTryOptionsFor(move), whereElse: { line: 'Where else could this same move work?', place: 'By the classroom door.' }, noticedFeeling: 'left out', replayCue: 'My stomach feels tight after school.' };
  text.pagination = splitStory(story, panelLines);
  return text;
}

const person = (adult = false, x = 0, y = 0, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})" stroke="#26364b" stroke-width="2.5" stroke-linejoin="round"><path fill="${adult ? '#446cac' : '#4c8955'}" d="M-25 62 Q-37 75 -32 124 L32 124 Q37 75 25 62Z"/><path fill="#324357" d="M-30 124 H-3 L-6 174 H-28ZM3 124 H30 L28 174 H6Z"/><path fill="${adult ? '#8a6247' : '#cb4e42'}" d="M-30 172 H-5 V183 H-36 Q-39 175 -30 172ZM5 172 H30 Q39 175 36 183 H5Z"/><ellipse fill="#cc976d" cx="0" cy="35" rx="28" ry="33"/><path fill="#342c29" d="M-28 35 Q-39 -3 0 -4 Q35 -3 28 35 L18 14 Q-7 24 -26 17Z"/><circle cx="-10" cy="36" r="2"/><circle cx="10" cy="36" r="2"/><path d="M-7 51 Q0 56 8 51" fill="none"/>${adult ? '' : '<g fill="none"><circle cx="-11" cy="36" r="10"/><circle cx="11" cy="36" r="10"/><path d="M-1 36 H1"/></g><path d="M8 79 H19 L12 87 H22 L7 103 L11 90 H3Z" fill="#efc94d" stroke-width="1"/>'}<path fill="#cc976d" d="M-31 80 Q-43 104 -32 126 Q-22 132 -18 123 L-23 96ZM31 80 Q43 104 32 126 Q22 132 18 123 L23 96Z"/></g>`;
const scene = (line, number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 300"><rect x="2" y="2" width="376" height="296" rx="2" fill="#f6dfb5" stroke="#26364b" stroke-width="3"/><rect x="240" y="20" width="110" height="100" fill="#aed6e1" stroke="#26364b" stroke-width="3"/><path d="M295 20 V120 M240 70 H350" stroke="#fff9ed" stroke-width="5"/><path d="M2 244 H378" stroke="#c8a97b" stroke-width="3"/><path fill="#ad7954" stroke="#26364b" stroke-width="3" d="M25 220 H354 V235 H25ZM50 235 V298 M330 235 V298"/>${person(false, 110 + number * 3, 97, .9)}${person(true, 280, 61, 1.05)}<ellipse cx="112" cy="54" rx="102" ry="29" fill="#fffefa" stroke="#26364b" stroke-width="2"/><path d="M120 80 L126 101 L142 80" fill="#fffefa" stroke="#26364b" stroke-width="2"/><text x="112" y="60" text-anchor="middle" font-family="Nunito" font-size="16" fill="#26364b">${esc(line)}</text></svg>`;
function fixtureHTML(svg, panel = false) {
  return `<!doctype html><html><meta charset="utf-8"><style>@font-face{font-family:Nunito;src:url('fonts/Nunito-Variable.ttf')}@font-face{font-family:Baloo;src:url('fonts/Baloo2-Variable.ttf')}*{box-sizing:border-box}body{margin:0;background:#fff9ed}.sheet.poster{width:${panel ? 760 : 816}px;height:${panel ? 600 : 1056}px}svg{width:100%;height:100%;display:block}</style><div class="sheet poster">${svg}</div><script>document.fonts.ready.then(()=>document.documentElement.dataset.fitted='true')</script></html>`;
}
function posterSVG(move, text) {
  const boxes = posterBoxes(move, text), plan = posterTypePlan(move, text, posterTemplate), r = posterTemplate;
  const label = (words, x, y, size = 14, anchor = 'start', width = 148, family = 'Nunito', color = '#26364b') => printedLines(words, width, size, family === 'Baloo' ? 'Baloo2' : family).map((line, i) => `<text x="${x}" y="${y + i * size * 1.12}" font-family="${family}" font-size="${size}" text-anchor="${anchor}" fill="${color}">${esc(line)}</text>`).join('');
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 792"><rect width="612" height="792" fill="#fff9ed"/><rect x="36" y="36" width="540" height="56" rx="16" fill="#4c8955"/>${label(move.name,306,73,28,'middle',510,'Baloo','#fff9ed')}<rect x="80" y="104" width="452" height="34" rx="17" fill="#f3d6a0"/>${label(text.tagline,306,127,17,'middle',430,'Baloo')}<rect x="36" y="150" width="540" height="180" rx="16" fill="#dfebdf"/>${person(false,240,159,.85)}${person(true,380,153,.9)}`;
  for (const id of ['tinyTry','science','plan','remember','source']) {
    const box = boxes.find(b => b.id === ({tinyTry:'tiny',plan:'move'}[id] ?? id)), c = r.regions[id], p = plan.cards[id];
    svg += `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="14" fill="#fffefa" stroke="#4c8955" stroke-width="2"/>${label(box.title,c.x+12,c.y+22,p.heading.fontPoints,'start',148,'Baloo')}`;
    if(id==='plan') svg += label('When I notice',c.x+12,c.y+65,12)+`<path d="M${c.x+12} ${c.y+88} h148 M${c.x+12} ${c.y+120} h148" stroke="#a7a58a"/>`+label('I',c.x+12,c.y+106,12)+label('Backup: '+moves.find(m=>m.id===move.approvedBackup).name,c.x+12,c.y+145,12);
    else svg += label(box.text,c.x+12,c.y+p.bodyTop+13,p.body.fontPoints,'start',148);
  }
  svg += `<circle cx="490" cy="612" r="59" fill="#f3d6a0" stroke="#4c8955" stroke-width="2"/>${label(move.keyWord,490,620,24,'middle',116,'Baloo')}<rect x="36" y="720" width="540" height="36" rx="10" fill="#f3d6a0"/></svg>`;
  return svg;
}

export async function createReadableOfflineKit(directory) {
  mkdirSync(directory, { recursive: true }); copyFonts(directory);
  const text = readableKitText(), move = moves.find(move => move.id === text.moveId);
  const record = { ...structuredClone(family), cast: lockedCast(family) };
  saveJSON(join(dirname(directory), 'family.json'), record);
  saveJSON(join(directory, 'checkpoint.json'), { recordAtStart: record, stages: {} });
  saveJSON(join(directory, 'kit-text-final.json'), text);
  saveJSON(join(directory, 'offline-fixture.json'), { fixture: true, handWritten: true, modelCalls: 0, wordCount: words(text.story).length, concern: sentences[0], art: 'Simple vector humans, not model art or a picture-check verdict.' });
  const images = [['poster-art', posterSVG(move, text)], ...text.panelLines.map((panel,i)=>[`panel-${i+1}`,scene(panel.line,i)])];
  const browser = await launchMeasurementBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
    for(const [name,svg] of images) {
      const panel = name.startsWith('panel-'), htmlPath=join(directory,`${name}-fixture.html`);
      writeFileSync(htmlPath,fixtureHTML(svg, panel));
      await page.goto(pathToFileURL(htmlPath).href);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('svg').screenshot({ path:join(directory,`${name}.png`) });
    }
  } finally { await browser.close(); }
  saveJSON(join(directory,'poster-fit.json'),{ ready:true, fixture:true, templateVersion:posterTemplate.version, coordinateSpace:{unit:'source-pixels',width:816,height:1056}, placement:{scale:.75,offset:{x:0,y:0},bounds:{x:36,y:36,w:540,h:720}},exported:geometryRects(posterTemplate) });
  return directory;
}
