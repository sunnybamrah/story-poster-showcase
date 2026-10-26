import { REGION_IDS, EVIDENCE_LABELS, percentRect, targetClipPath, availableDemonstration, wallQuestion, wallChoices, wallInstructions } from '../web/interactive.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const paragraph = value => value ? `<p>${escape(value)}</p>` : '';
const list = values => Array.isArray(values) && values.length ? `<ol>${values.map(value => `<li>${escape(value)}</li>`).join('')}</ol>` : '';
const safeURL = value => typeof value === 'string' && !/^[\s]*(?:javascript|data|vbscript):/i.test(value) ? escape(value) : '#';
const studyLink = url => /^https:\/\//i.test(url ?? '') ? `<a class="button" href="${safeURL(url)}" target="_blank" rel="noopener noreferrer">Open study</a>` : '';
const field = (label, value) => value !== undefined && value !== null && value !== '' ? `<dt>${escape(label)}</dt><dd>${escape(Array.isArray(value) ? value.join(', ') : value)}</dd>` : '';
const wallChoiceHTML = () => `<div class="wall-choice">${paragraph(wallInstructions)}<p role="group" aria-label="${wallQuestion}">${wallQuestion} ${wallChoices.map(choice => `<button type="button" data-wall-choice="${choice}" aria-pressed="false">${choice}</button>`).join(' / ')}</p><p role="status" data-wall-status></p></div>`;

function cropHTML(bundle, rect, description) {
  const canvas = bundle.map.canvas;
  if (!rect || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(rect[key])) || rect.x < 0 || rect.y < 0 || rect.w <= 0 || rect.h <= 0 || rect.x + rect.w > canvas.width || rect.y + rect.h > canvas.height) return '';
  return `<div class="crop" style="aspect-ratio:${rect.w}/${rect.h}"><img data-poster-crop src="${safeURL(bundle.image.url)}" alt="${escape(description)}" style="width:${100 * canvas.width / rect.w}%;left:${-100 * rect.x / rect.w}%;top:${-100 * rect.y / rect.h}%"></div>`;
}

function sectionHTML(id, section, bundle) {
  if (id === 'tinyTry') return `${paragraph(section.instruction)}${paragraph(section.validation)}${list(section.steps)}${section.choices?.length ? '<h3>Choose a way to practise</h3>' + list(section.choices) : ''}${paragraph(section.realWorldAction)}`;
  if (id === 'science') return `${paragraph(section.readerClaim ?? section.claim)}<dl>${field('What researchers tested', section.tested)}${field('Who took part', section.participants)}${field('Ages', section.ages)}</dl><div class="evidence">${paragraph(section.result)}${section.limitation ? `<p><strong>What this does not tell us</strong> ${escape(section.limitation)}</p>` : ''}${EVIDENCE_LABELS[section.evidenceLabel] ? `<p><strong>${escape(section.evidenceLabel)}</strong>${escape(EVIDENCE_LABELS[section.evidenceLabel])}</p>` : ''}${paragraph(section.evidenceClaim)}</div>${studyLink(section.studyUrl)}`;
  if (id === 'source') return `<dl>${field('People', section.people)}${field('Place', section.place)}${field('Year', section.year)}${field('Study title', section.studyTitle)}${field('Search words', section.searchPhrase)}</dl>${paragraph(section.description)}${studyLink(section.studyUrl)}`;
  if (id === 'plan') return `<p>Write your own plan. It stays on this device only when you press Save.</p><label class="plan-label" for="notice-field">When I notice…</label><textarea id="notice-field" name="notice" rows="2" autocomplete="off" autocorrect="off" spellcheck="false" data-gramm="false"></textarea><label class="plan-label" for="action-field">I will…</label><textarea id="action-field" name="action" rows="2" autocomplete="off" autocorrect="off" spellcheck="false" data-gramm="false"></textarea>${section.backup ? `<p><strong>Backup:</strong> ${escape(section.backup)}</p>` : ''}<div class="plan-actions"><button type="button" class="primary" data-plan="save">Save on this device</button><button type="button" data-plan="edit" hidden>Edit</button><button type="button" data-plan="clear">Clear</button></div><p role="status" aria-live="polite" data-plan-status></p>`;
  if (id === 'remember') {
    const demo = availableDemonstration(section);
    return `<p class="rhyme">${escape(section.rhyme)}</p>${paragraph(section.bodyAction)}${demo ? `<p data-motion-note hidden>The written version is ready below. Play only if you want to watch.</p><video playsinline preload="none" hidden ${demo.stillUrl ? `poster="${safeURL(demo.stillUrl)}"` : ''} src="${safeURL(demo.url)}" aria-label="${escape(demo.caption)}">${escape(demo.caption)}</video><div class="media-controls"><button type="button" data-media="play">Play demonstration</button><button type="button" data-media="pause">Pause</button><button type="button" data-media="replay">Replay</button><button type="button" data-media="still">Still and text</button></div>${demo.stillUrl ? `<img class="demonstration-still" src="${safeURL(demo.stillUrl)}" alt="${escape(demo.caption)}">` : ''}<p>${escape(demo.caption)}</p><p role="status" data-media-status></p>` : ''}`;
  }
  if (id === 'hero') return `${wallChoiceHTML()}${cropHTML(bundle, section.crop ?? bundle.map.regions.hero, section.moveSentence)}${paragraph(section.moveSentence)}${section.jokeCrop ? `<figure>${cropHTML(bundle, section.jokeCrop, section.jokeExplanation)}<figcaption>${escape(section.jokeExplanation)}</figcaption></figure>` : paragraph(section.jokeExplanation)}`;
  if (id === 'keyword') return `<p class="rhyme">${escape(section.word)}</p>${paragraph(section.meaning)}${section.example ? `<p><strong>For example:</strong> ${escape(section.example)}</p>` : ''}`;
  if (id === 'tagline') return `<p class="rhyme" data-rhyme-answer>${escape(section.rhyme)}</p><p data-rhyme-explanation>${escape(section.explanation)}</p>${section.recallEnabled ? '<p>Remember first, then check. You can see the rhyme whenever you want.</p><button type="button" data-recall="hide">Remember first</button><button type="button" data-recall="show" hidden>Show the rhyme</button>' : ''}`;
  return '';
}

export function renderInteractiveHTML(bundle, { assetPrefix = '.', preview = false } = {}) {
  const { map, content } = bundle;
  const targetButtons = REGION_IDS.map(id => {
    const rect = map.regions?.[id];
    if (!rect) return '';
    const style = Object.entries(percentRect(rect, map.canvas)).map(([key, value]) => `${key}:${value}`).join(';');
    const clip = targetClipPath(id, map);
    return `<button type="button" class="image-target" data-region="${id}" aria-label="${escape(content.sections[id]?.title)}" style="${style}${clip ? ';clip-path:' + escape(clip) : ''}" disabled></button>`;
  }).join('');
  const actionButtons = REGION_IDS.map(id => `<button type="button" data-region="${id}">${escape(content.sections[id]?.title)}</button>`).join('');
  const printed = content.printed.map(item => `<section class="printed-section">${item.title ? `<h3>${escape(item.title)}</h3>` : ''}<p>${escape(item.text)}</p></section>`).join('');
  const templates = REGION_IDS.map(id => `<template id="section-${id}">${sectionHTML(id, content.sections[id] ?? {}, bundle)}</template>`).join('');
  const json = JSON.stringify(bundle).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return `<!doctype html>
<html lang="en" data-theme="light">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(content.title)} | Story Poster</title>
<script>try{document.documentElement.dataset.theme=localStorage.getItem('story-poster:theme')==='dark'?'dark':'light'}catch{}</script>
<link rel="stylesheet" href="${safeURL(assetPrefix)}/interactive.css"></head>
<body><main id="poster-main"><nav aria-label="Poster"><span>Story Poster</span><button type="button" id="theme-toggle" aria-pressed="false">Dark mode</button></nav>
<h1>${escape(content.title)}</h1><p class="intro">Tap a card, picture, word or rhyme.</p>
${wallChoiceHTML()}
${preview ? '<p class="status">Layout preview only. This is not an approved poster.</p>' : ''}
<p class="status" id="poster-status" role="status">Checking the picture. The text and print link are ready below.</p>
<div class="poster-wrapper" id="poster-wrapper"><img id="poster-image" class="poster-image" src="${safeURL(bundle.image.url)}" width="${Number(bundle.image.width)}" height="${Number(bundle.image.height)}" alt="Illustrated poster. Use the buttons to read each part.">${targetButtons}</div>
<div class="toolbar poster-equivalents" aria-label="Word and rhyme"><button type="button" data-region="keyword">Key word</button><button type="button" data-region="tagline">Rhyme</button></div>
<div class="toolbar"><button type="button" id="read-larger" aria-controls="larger-text">Read larger</button><a class="button" id="print-poster" href="${safeURL(bundle.pdf.url)}" target="_blank" rel="noopener">Print poster</a></div>
<section id="larger-text" class="text-view" aria-labelledby="text-title"><h2 id="text-title" tabindex="-1">Read larger</h2>${printed}<h2>Explore the poster</h2><div class="action-list">${actionButtons}</div></section>
</main><dialog id="poster-sheet" aria-modal="true" aria-labelledby="sheet-title"><header class="sheet-header" id="sheet-header"><h2 id="sheet-title"></h2><button type="button" id="sheet-close">Close</button></header><div class="sheet-body" id="sheet-body"></div></dialog>
${templates}<script type="application/json" id="poster-bundle">${json}</script><script type="module" src="${safeURL(assetPrefix)}/interactive.js"></script></body></html>`;
}
