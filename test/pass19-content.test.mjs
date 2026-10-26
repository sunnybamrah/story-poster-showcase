import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moves = JSON.parse(readFileSync(new URL('../content/moves.json', import.meta.url)));
const rhymes = JSON.parse(readFileSync(new URL('../content/rhymes-draft.json', import.meta.url)));
const move = id => moves.find(record => record.id === id);
const science = id => move(id).detail.science;
const text = value => typeof value === 'string' && value.trim().length > 0;

test('all fourteen tap sheets retain the checked study summary and limitation', () => {
  assert.equal(moves.length, 14);
  for (const record of moves) {
    for (const field of ['tested', 'participants', 'ages', 'result', 'limitation']) {
      const value = record.detail.science[field];
      if (value === null) {
        assert.ok(['participants', 'ages'].includes(field), `${record.id}: unavailable ${field} remains null`);
      } else {
        assert.ok(text(value), `${record.id}: ${field}`);
        assert.doesNotMatch(value, /\b(?:unknown|not stated|N\/A|TBD)\b/i, 'Keep unavailable facts null, not filled with placeholder text.');
      }
    }
    assert.ok(record.sources.length > 0, `${record.id}: keep linked citations`);
    assert.ok(text(record.source.limitation), `${record.id}: keep the guide limitation`);
  }
});

test('study titles and details point to the same already cited paper', () => {
  for (const record of moves) {
    const source = record.sources.find(item => record.detail.science.studyUrl === `https://doi.org/${item.doi}` || record.detail.science.studyUrl === `https://pubmed.ncbi.nlm.nih.gov/${item.pubmed}/`);
    assert.ok(source, record.id);
    const urls = [`https://doi.org/${source.doi}`, `https://pubmed.ncbi.nlm.nih.gov/${source.pubmed}/`];
    assert.ok(urls.includes(record.detail.science.studyUrl), record.id);
    assert.equal(record.detail.source.studyUrl, record.detail.science.studyUrl);
    assert.equal(record.detail.source.studyTitle, source.title);
    assert.equal(record.detail.science.evidenceLabel, source.fitLabel);
    for (const field of ['people', 'place', 'year']) assert.equal(record.detail.source[field], source[field]);
    for (const paper of record.sources) {
      assert.ok(text(paper.title) && text(paper.titleOriginal));
      assert.notEqual(paper.title, paper.titleOriginal);
      assert.equal(paper.titleCheckedOn, '2026-10-14');
      assert.match(paper.titleVerificationUrl, /^https:\/\//);
      assert.doesNotMatch(paper.title, /full text opened|^\w+ \d{4},/i);
    }
  }
});

test('new read-aloud words stay plain and explanations remain tied to their saved rhyme', () => {
  for (const record of moves) {
    const { science: facts, keyword, tagline } = record.detail;
    assert.ok(text(keyword.meaning) && text(keyword.example) && text(tagline.explanation), record.id);
    assert.equal(tagline.rhyme, rhymes.find(row => row.moveId === record.id).lines.join(' '));
    assert.match(tagline.explanation, /reminds us/i);
    // Exact bibliographic titles and research notes retain the authors' technical words.
    const prose = [facts.tested, facts.participants, facts.ages, facts.result, facts.limitation, keyword.meaning, keyword.example, tagline.explanation].filter(value => value !== null).join(' ');
    assert.doesNotMatch(prose, /[\u2013\u2014]|\b(?:anxiety|depression|disorders?|diagnos\w*|cortisol|amygdala|arousal|cognitive|diaphragmatic|randomi[sz]ed|meta-analysis|intervention|self-regulation|statistically|leverage|robust|seamless)\b/iu, record.id);
  }
});

test('averages, eligibility ages and study totals cannot stand in for missing participant ranges', () => {
  for (const id of ['name-it-exactly', 'long-breath-out', 'coach-voice', 'snag-plan', 'cool-off-break', 'one-brave-step', 'good-enough-is-done', 'butterflies-mean-ready']) {
    assert.equal(science(id).ages, null, id);
  }
  assert.equal(science('name-it-exactly').participants, null);
  assert.match(science('coach-voice').tested, /Study 3/);
  assert.match(science('coach-voice').participants, /\b89\b/);
  assert.match(science('dont-feed-the-fire').tested, /Study 2/);
  assert.match(science('dont-feed-the-fire').participants, /\b265\b/);
  assert.match(science('dont-feed-the-fire').ages, /10 to 16/);
  assert.match(science('butterflies-mean-ready').participants, /60.*recruited.*28.*completed/);
  assert.match(science('worry-parking-spot').participants, /227.*start/);
});

test('study limits preserve mixed findings and the gap between the study and the home move', () => {
  const limits = [
    ['name-it-exactly', /Adult.*do not show.*children/],
    ['long-breath-out', /no average benefit.*exact breathing pattern/],
    ['coach-voice', /adult.*did not test.*kind coach.*children/],
    ['snag-plan', /one school.*three steps together.*did not test.*feelings/],
    ['cool-off-break', /did not test.*ten-minute break.*children/],
    ['bring-in-my-person', /no drop.*said they felt.*did not test/],
    ['one-brave-step', /cannot show.*caused.*one small step at home/],
    ['compare-with-past-me', /one session.*does not show how long/],
    ['make-it-right', /staged.*does not show.*real friend/],
    ['good-enough-is-done', /no clear difference right after.*checking work once was not tested/],
    ['dont-feed-the-fire', /pretend chat.*did not test.*private kind message/],
    ['butterflies-mean-ready', /adult.*does not show.*children/],
    ['worry-parking-spot', /one-week.*reports.*did not test a worry box/],
    ['check-my-battery', /changed sleep.*did not test.*body/],
  ];
  for (const [id, pattern] of limits) assert.match(science(id).limitation, pattern, id);
  assert.match(science('one-brave-step').result, /was linked with/);
  assert.match(science('bring-in-my-person').result, /body stress signal.*not in the teens/);
  assert.match(science('good-enough-is-done').result, /Three months later.*had not risen/);
  assert.match(science('dont-feed-the-fire').result, /report the mean message/);
});
