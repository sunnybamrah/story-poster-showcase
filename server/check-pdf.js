import { spawnSync } from 'node:child_process';

export function pdfTextMargins(bbox) {
  return [...bbox.matchAll(/<page\b[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g)].map((page, index) => {
    const boxes = [...page[3].matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"/g)].map(word => word.slice(1).map(Number));
    if (!boxes.length) return { page: index + 1, textMargins: null };
    return { page: index + 1, textMargins: { top: Math.min(...boxes.map(b => b[1])), bottom: Number(page[2]) - Math.max(...boxes.map(b => b[3])), left: Math.min(...boxes.map(b => b[0])), right: Number(page[1]) - Math.max(...boxes.map(b => b[2])) } };
  });
}

export function validatePDFText(text) {
  const pages = text.split('\f');
  if (!pages.at(-1).trim()) pages.pop();
  if (pages.length !== 5) throw new Error(`PDF must have five pages, found ${pages.length}.`);
  if (/Light or dark|Kit pages|Layout preview only|Poster\s+Story\s+Try it\s+For you|Story and artwork have not been generated/i.test(text)) throw new Error('PDF contains navigation, controls or a preview notice.');
  if (!pages[0].includes("'s Confidence Guide")) throw new Error('Poster footer missing from PDF.');
  for (const [index, titles] of [[1, ['Chapter ']], [2, ['Chapter ']], [3, ['TRY IT']], [4, ['CARDS + PARENT STRIP', 'CARDS + GROWN-UP GUIDE']]]) {
    if (!titles.some(title => pages[index].includes(title)) || !pages[index].includes(`${index + 1}/5`)) throw new Error(`PDF page ${index + 1} is missing its title or footer.`);
  }
  return { pages: 5, navigationText: false };
}

export function inspectKitPDF(path, { posterOnly = false } = {}) {
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`PDF inspection ${command}: ${result.error?.message ?? result.stderr}`);
    return result.stdout;
  };
  const text = run('pdftotext', ['-layout', path, '-']);
  const check = posterOnly ? validatePosterPDFText(text) : validatePDFText(text);
  const info = run('pdfinfo', [path]);
  if (!/Page size:\s+612 x 792 pts/.test(info)) throw new Error('PDF is not US Letter portrait.');
  const fonts = run('pdffonts', [path]);
  for (const font of (posterOnly ? ['Baloo2'] : ['Baloo2', 'Nunito'])) if (!fonts.split('\n').some(line => line.includes(font) && /\byes\s+yes\b/.test(line))) throw new Error(`PDF font missing or not embedded: ${font}`);
  const bbox = run('pdftotext', ['-bbox', path, '-']);
  const measurements = assertPDFTextMargins(bbox);

  return { ...check, letter: true, fontsEmbedded: true, textInsideMargins: true, measurements };
}
export function validatePosterPDFText(text) {
  const pages = text.split('\f').filter(page => page.trim());
  if (pages.length !== 1 || !pages[0].includes("'s Confidence Guide")) throw new Error('Print poster must be one page with its approved footer.');
  if (/Read larger|Print poster|Save on this device|Play demonstration|Layout preview|When I notice/.test(text)) throw new Error('Print poster contains controls, saved answers or preview text.');
  return { pages: 1, navigationText: false };
}
export const inspectPosterPDF = path => inspectKitPDF(path, { posterOnly: true });

// Poppler reports the font envelope, which can extend beyond visible glyph ink.
// Layout reserves that envelope too. Name it accurately in any failure receipt.
export function assertPDFTextMargins(bbox) {
  const measurements = pdfTextMargins(bbox);
  for (const page of measurements) if (page.textMargins && Object.values(page.textMargins).some(value => value < 35.5)) {
    const outside = Object.entries(page.textMargins).filter(([, value]) => value < 35.5).map(([side, value]) => `${side} ${value.toFixed(2)}pt`).join(', ');
    throw new Error(`PDF page ${page.page} extracted text box crosses the 36 point margin (${outside}). Font boxes can exceed visible ink.`);
  }
  return measurements;
}
