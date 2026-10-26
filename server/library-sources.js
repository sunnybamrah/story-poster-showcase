import { createHash } from 'node:crypto';

export const sourceSearchPolicyVersion = 'required-concepts-twelve-records-v3';
export const primarySearchResultLimit = 12;
export const discoveryCandidateLimit = primarySearchResultLimit * 2;
export const discoveryPolicyVersion = 'pubmed-eric-typed-records-v1';
export const sourceBody = source => source?.bodyText ?? source?.abstract ?? '';
export const seedSourceCandidatePolicy = 'selected-seed-pubmed-v1';
export function seedPrimarySourceURLs(base) {
  const urls = [];
  for (const source of base?.sources ?? []) {
    if (typeof source.pubmed !== 'string' || !/^\d{1,10}$/.test(source.pubmed)) continue;
    const url = primarySourceURL(`https://pubmed.ncbi.nlm.nih.gov/${source.pubmed}/`);
    if (!urls.includes(url)) urls.push(url);
    if (urls.length === 2) break;
  }
  return urls;
}
export const ncbiMinimumSpacingMs = 350;
const policyURL = 'https://www.ncbi.nlm.nih.gov/home/about/policies/';
export function createNCBIScheduler({ now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let tail = Promise.resolve(), nextAt = 0, cooldownHeader = null;
  async function one(url, options, fetchImpl) {
    let release; const previous = tail; tail = new Promise(resolve => { release = resolve; }); await previous;
    try {
      while (now() < nextAt) {
        const remainingMs = nextAt - now();
        if (remainingMs > 60000) throw Object.assign(Error('NCBI cooldown is still active. Retry the saved source work later.'), { httpStatus: 429, retryAfter: cooldownHeader, remainingMs, attempts: 0, retryable: true, minimumSpacingMs: ncbiMinimumSpacingMs, policyURL });
        await wait(remainingMs);
      }
      nextAt = now() + ncbiMinimumSpacingMs;
      const response = await fetchImpl(url, { ...options, redirect: 'error' });
      const retryAfter = response.headers.get('retry-after');
      let delay = null;
      if (response.status === 429) {
        const numeric = retryAfter?.trim() && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : null;
        const date = retryAfter && numeric === null ? Date.parse(retryAfter) : NaN;
        delay = Math.max(ncbiMinimumSpacingMs, numeric ?? (Number.isFinite(date) ? date - now() : 1000));
        // Publish the server cooldown before releasing this shared queue.
        // Otherwise the next source could send while this response is handled.
        nextAt = Math.max(nextAt, now() + delay); cooldownHeader = retryAfter;
      }
      return { response, retryAfter, delay };
    } finally { release(); }
  }
  return { async request(url, options, fetchImpl = fetch) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'eutils.ncbi.nlm.nih.gov' || endpoint.port || endpoint.username || endpoint.password || !/^\/entrez\/eutils\/(?:esearch|efetch)\.fcgi$/.test(endpoint.pathname)) throw Error('Only fixed NCBI ESearch and EFetch endpoints are allowed.');
    const retries = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { response, retryAfter, delay } = await one(endpoint, options, fetchImpl);
      const receipt = { httpStatus: response.status, attempts: attempt, minimumSpacingMs: ncbiMinimumSpacingMs, policyURL, retries: [...retries], ...(retryAfter ? { retryAfter } : {}) };
      if (response.status !== 429) return { response, receipt };
      // No-key traffic is limited to three requests each second. Without a
      // Retry-After header, wait a full window before the bounded retry.
      await response.body?.cancel();
      if (attempt === 3 || delay > 60000) throw Object.assign(Error('NCBI rate limit reached. The source work is saved for a later retry.'), { ...receipt, retryable: true });
      retries.push({ httpStatus: 429, retryAfter: retryAfter ?? null, delayMs: delay });
    }
  } };
}
const ncbiScheduler = createNCBIScheduler();

const hash = value => createHash('sha256').update(value).digest('hex');
const decode = value => String(value).replace(/&#(x[\da-f]+|\d+);/gi, (_, number) => String.fromCodePoint(number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number))).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
export const sourceText = value => decode(String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
export function primarySourceURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'pubmed.ncbi.nlm.nih.gov' || url.port || url.username || url.password || url.search || url.hash || !/^\/\d{1,10}\/?$/.test(url.pathname)) throw Error('A direct PubMed article record is required.');
  return `https://pubmed.ncbi.nlm.nih.gov/${url.pathname.match(/\d+/)[0]}/`;
}
export function parsePrimarySource(html, url, fetchedAt = new Date().toISOString()) {
  url = primarySourceURL(url);
  if (typeof html !== 'string' || html.length > 1_000_000) throw Error('Source page is too large or missing.');
  const meta = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(match => [match[1].toLowerCase(), decode(match[3])]));
    const key = attrs.name ?? attrs.property;
    if (key && attrs.content) { const values = meta.get(key) ?? []; values.push(attrs.content); meta.set(key, values); }
  }
  const first = (...keys) => keys.flatMap(key => meta.get(key) ?? [])[0] ?? '';
  const pmid = url.match(/\/(\d+)\/$/)[1], declaredId = first('citation_pmid');
  if (declaredId && declaredId !== pmid) throw Error('Source identifier does not match the requested paper.');
  const title = first('citation_title'), journal = first('citation_journal_title'), date = first('citation_date', 'citation_publication_date');
  const authors = [...new Set([...(meta.get('citation_author') ?? []), ...(meta.get('citation_authors') ?? []).flatMap(value => value.split(';').map(item => item.trim()))])];
  const abstractHTML = html.match(/<div\b[^>]*class=["'][^"']*\babstract-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const abstract = abstractHTML ? sourceText(abstractHTML) : '';
  const year = Number(date.match(/\b(?:19|20)\d{2}\b/)?.[0]);
  if (!title || !journal || !authors.length || !Number.isInteger(year) || abstract.length < 80 || abstract.length > 16000) throw Error('The primary record needs a title, authors, journal, year and a bounded readable abstract.');
  const whole = sourceText(html);
  const notices = ['Retraction in', 'Retracted Publication', 'Expression of concern in', 'Erratum in', 'Correction in'].filter(label => whole.toLowerCase().includes(label.toLowerCase()));
  const doi = first('citation_doi');
  return { id: pmid, pubmed: pmid, url, title, authors: [...new Set(authors)], journal, year, ...(doi && /^10\.\d{4,9}\/\S+$/.test(doi) ? { doi } : {}), abstract, contentScope: 'PubMed abstract, not a full-paper review', notices, fetchedAt, contentHash: hash(abstract), metadataHash: hash(JSON.stringify({ title, authors, journal, year, pmid, doi })) };
}
export function searchConcepts(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3 || value.some(group => !Array.isArray(group) || !group.length || group.length > 4 || group.some(term => typeof term !== 'string' || !/^[a-z][a-z '-]{1,59}$/.test(term)))) throw Error('Search needs two or three general concepts with short alternative phrases.');
  return value.map(group => [...new Set(group.map(term => term.trim()))]);
}
export function primarySearchQuery(topic, terms, concepts) {
  if (typeof topic !== 'string' || topic.length > 160 || !/^[\p{L}][\p{L}\s'-]*$/u.test(topic)) throw Error('Search requires a checked general topic.');
  terms ??= [topic];
  if (!Array.isArray(terms) || terms.length < 1 || terms.length > 8 || terms.some(term => typeof term !== 'string' || term.length > 160 || !/^[\p{L}][\p{L}\s'-]*$/u.test(term) || !term.trim())) throw Error('Search phrases must come from the independently cleared general topic.');
  const phrases = [...new Set(terms.map(term => term.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()))];
  const subject = concepts ? searchConcepts(concepts).map(group => `(${group.map(term => `"${term}"[Title/Abstract]`).join(' OR ')})`).join(' AND ') : `(${phrases.map(term => `"${term}"[Title/Abstract]`).join(' OR ')})`;
  return `${subject} AND (child[MeSH Terms] OR adolescent[MeSH Terms] OR child*[Title/Abstract] OR adolescen*[Title/Abstract]${concepts ? ' OR school*[Title/Abstract]' : ''})`;
}
export async function searchPrimarySources(topic, { terms, concepts, fetchImpl = fetch, scheduler = ncbiScheduler } = {}) {
  const query = primarySearchQuery(topic, terms, concepts);
  const endpoint = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
  endpoint.search = new URLSearchParams({ db: 'pubmed', retmode: 'json', retmax: String(primarySearchResultLimit), sort: 'relevance', term: query }).toString();
  const { response, receipt } = await scheduler.request(endpoint, { headers: { Accept: 'application/json' } }, fetchImpl);
  if (!response.ok) throw Object.assign(Error(`The public paper search returned HTTP ${response.status}.`), receipt);
  let count = 0; const chunks = [];
  for await (const chunk of response.body) { count += chunk.length; if (count > 100000) throw Error('The paper search response is too large.'); chunks.push(chunk); }
  const answer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const ids = answer.esearchresult?.idlist;
  if (!Array.isArray(ids) || ids.length > primarySearchResultLimit || ids.some(id => typeof id !== 'string' || !/^\d{1,10}$/.test(id))) throw Error('The public search did not return a bounded list of paper identifiers.');
  return { provider: 'PubMed ESearch', policyVersion: sourceSearchPolicyVersion, ...(concepts ? { searchMethod: 'required-concepts-v1', concepts: searchConcepts(concepts) } : {}), query, urls: [...new Set(ids)].map(id => `https://pubmed.ncbi.nlm.nih.gov/${id}/`), searchedAt: new Date().toISOString(), transport: receipt };
}
export async function fetchPrimarySource(url, { fetchImpl = fetch, scheduler = ncbiScheduler } = {}) {
  url = primarySourceURL(url);
  const endpoint = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi');
  endpoint.search = new URLSearchParams({ db: 'pubmed', retmode: 'xml', id: url.match(/\/(\d+)\/$/)[1] }).toString();
  const { response, receipt } = await scheduler.request(endpoint, { headers: { Accept: 'application/xml' } }, fetchImpl);
  if (!response.ok || !/xml/i.test(response.headers.get('content-type') ?? '')) throw Object.assign(Error(`The primary source returned HTTP ${response.status} (${response.headers.get('content-type') ?? 'unknown content type'}).`), receipt);
  let count = 0; const chunks = [];
  for await (const chunk of response.body) { count += chunk.length; if (count > 1_000_000) throw Error('The primary source exceeds the safe page size.'); chunks.push(chunk); }
  try { return { ...parsePubMedXML(Buffer.concat(chunks).toString('utf8'), url), transport: receipt }; }
  catch (error) { Object.assign(error, receipt); throw error; }
}
export function parsePubMedXML(xml, url, fetchedAt = new Date().toISOString()) {
  url = primarySourceURL(url);
  if (typeof xml !== 'string' || xml.length > 1_000_000) throw Error('Source record is too large or missing.');
  const article = xml.match(/<PubmedArticle\b[^>]*>([\s\S]*?)<\/PubmedArticle>/)?.[1];
  if (!article) throw Error('The primary PubMed article was not returned.');
  const get = (name, input = article) => input.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`))?.[1] ?? '';
  const pmid = sourceText(get('PMID'));
  if (pmid !== url.match(/\/(\d+)\/$/)[1]) throw Error('Source identifier does not match the requested paper.');
  const title = sourceText(get('ArticleTitle')), journal = sourceText(get('Title', get('Journal')));
  const date = get('PubDate', get('Journal')) || get('ArticleDate');
  const year = Number(sourceText(get('Year', date) || get('MedlineDate', date)).match(/\b(?:19|20)\d{2}\b/)?.[0]);
  const authors = [...get('AuthorList').matchAll(/<Author\b[^>]*>([\s\S]*?)<\/Author>/g)].map(match => sourceText(get('CollectiveName', match[1])) || [sourceText(get('ForeName', match[1]) || get('Initials', match[1])), sourceText(get('LastName', match[1]))].filter(Boolean).join(' ')).filter(Boolean);
  const abstract = [...get('Abstract').matchAll(/<AbstractText\b[^>]*>([\s\S]*?)<\/AbstractText>/g)].map(match => sourceText(match[1])).join(' ');
  if (!title || !journal || !authors.length || !Number.isInteger(year) || abstract.length < 80 || abstract.length > 16000) throw Error('The primary record needs a title, authors, journal, year and a bounded readable abstract.');
  const doi = sourceText(article.match(/<ArticleId\b[^>]*IdType=["']doi["'][^>]*>([\s\S]*?)<\/ArticleId>/)?.[1] ?? '');
  const notices = [...article.matchAll(/<CommentsCorrections\b[^>]*RefType=["']([^"']+)["']/g)].map(match => match[1]).filter(type => /Erratum|Retract|Concern|Corrected/i.test(type));
  if (/<PublicationType\b[^>]*>\s*(?:Retracted Publication|Retraction of Publication)\s*<\/PublicationType>/.test(article)) notices.push('Retracted Publication');
  return { id: pmid, pubmed: pmid, url, title, authors, journal, year, ...(doi && /^10\.\d{4,9}\/\S+$/.test(doi) ? { doi } : {}), abstract, contentScope: 'PubMed abstract, not a full-paper review', retrieval: 'NCBI PubMed EFetch XML', notices: [...new Set(notices)], fetchedAt, contentHash: hash(abstract), metadataHash: hash(JSON.stringify({ title, authors, journal, year, pmid, doi })) };
}
export function validateSourceReceipt(source) {
  if (source?.provider === 'ERIC') return validateERICReceipt(source);
  primarySourceURL(source.url);
  if (source.pubmed !== source.url.match(/\/(\d+)\/$/)[1] || source.id !== source.pubmed || !source.title || !source.authors?.length || !source.journal || !Number.isInteger(source.year) || !source.abstract || source.contentHash !== hash(source.abstract) || !Array.isArray(source.notices)) throw Error('The fetched primary-source receipt is incomplete.');
  if (source.metadataHash !== hash(JSON.stringify({ title: source.title, authors: source.authors, journal: source.journal, year: source.year, pmid: source.pubmed, doi: source.doi ?? '' }))) throw Error('The source metadata no longer matches its receipt.');
  if (source.notices.length) throw Error('A source has a correction, concern or retraction notice and needs human review.');
  return source;
}

export function evidenceSourceURL(value) {
  const url = new URL(value);
  if (url.hostname === 'pubmed.ncbi.nlm.nih.gov') return primarySourceURL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'eric.ed.gov' || url.port || url.username || url.password || url.hash || url.pathname !== '/' || [...url.searchParams.keys()].length !== 1 || !/^E[DJ]\d{1,10}$/.test(url.searchParams.get('id') ?? '')) throw Error('A direct PubMed or ERIC record is required.');
  return `https://eric.ed.gov/?id=${url.searchParams.get('id')}`;
}
const ericMetadata = source => ({ id: source.id, url: source.url, title: source.title, authors: source.authors, publisher: source.publisher, year: source.year, sourceType: source.sourceType, contentScope: source.contentScope, peerReviewed: source.peerReviewed, educationLevel: source.educationLevel, publicationTypes: source.publicationTypes });
export function parseERICRecord(record, url, fetchedAt = new Date().toISOString()) {
  url = evidenceSourceURL(url);
  const id = new URL(url).searchParams.get('id');
  if (!id || record?.id !== id) throw Error('ERIC returned a different source record.');
  const list = value => Array.isArray(value) ? value.map(sourceText).filter(Boolean) : typeof value === 'string' && value.trim() ? [sourceText(value)] : [];
  const title = sourceText(record.title ?? ''), authors = list(record.author), publisher = sourceText(record.source ?? record.publisher ?? record.institution ?? ''), bodyText = sourceText(record.description ?? '');
  const year = Number(record.publicationdateyear);
  if (!title || !authors.length || !publisher || !Number.isInteger(year) || bodyText.length < 80 || bodyText.length > 16000) throw Error('ERIC needs a title, authors, publisher, year and readable abstract.');
  const source = { id, eric: id, provider: 'ERIC', url, title, authors, publisher, year, sourceType: 'abstract-record', bodyText, contentScope: 'ERIC metadata abstract, not a full-paper review', peerReviewed: record.peerreviewed === 'T' ? true : record.peerreviewed === 'F' ? false : null, educationLevel: list(record.educationlevel), publicationTypes: list(record.publicationtype), notices: [], noticeScope: 'ERIC metadata does not establish absence of corrections or retractions; inspect the cited publication before claiming a full-paper review.', fetchedAt, retrieval: 'ERIC metadata API', contentHash: hash(bodyText) };
  source.metadataHash = hash(JSON.stringify(ericMetadata(source)));
  return source;
}
function validateERICReceipt(source) {
  if (evidenceSourceURL(source.url) !== source.url || new URL(source.url).searchParams.get('id') !== source.id || source.eric !== source.id || source.sourceType !== 'abstract-record' || source.contentScope !== 'ERIC metadata abstract, not a full-paper review' || !source.title || !source.authors?.length || !source.publisher || !Number.isInteger(source.year) || typeof source.bodyText !== 'string' || source.bodyText.length < 80 || source.bodyText.length > 16000 || source.contentHash !== hash(source.bodyText) || source.metadataHash !== hash(JSON.stringify(ericMetadata(source))) || !Array.isArray(source.notices)) throw Error('The ERIC source receipt is incomplete or changed.');
  if (source.notices.length) throw Error('An ERIC source notice needs review.');
  return source;
}
async function ericRequest(parameters, fetchImpl) {
  // Fixed host/path and rejected redirects prevent source links becoming arbitrary fetches.
  const endpoint = new URL('https://api.ies.ed.gov/eric/');
  endpoint.search = new URLSearchParams({ format: 'json', ...parameters }).toString();
  const response = await fetchImpl(endpoint, { headers: { Accept: 'application/json' }, redirect: 'error' });
  if (!response.ok) throw Object.assign(Error(`ERIC returned HTTP ${response.status}.`), { httpStatus: response.status });
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > 1_000_000) throw Error('ERIC returned too much source data.'); chunks.push(chunk); }
  const answer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!Array.isArray(answer.response?.docs) || answer.response.docs.length > primarySearchResultLimit) throw Error('ERIC did not return a bounded source list.');
  return answer.response.docs;
}
export function ericSearchQuery(topic, terms, concepts) {
  primarySearchQuery(topic, terms, concepts); // Same cleared general-input contract, no private note parameter.
  const groups = concepts ? searchConcepts(concepts) : [[...(terms ?? [topic])]];
  return groups.map(group => `(${group.map(term => `"${term}"`).join(' OR ')})`).join(' AND ');
}
export async function searchERICSources(topic, { terms, concepts, fetchImpl = fetch } = {}) {
  const query = ericSearchQuery(topic, terms, concepts);
  const records = await ericRequest({ search: query, rows: String(primarySearchResultLimit), fields: 'id' }, fetchImpl);
  if (records.some(record => !/^E[DJ]\d{1,10}$/.test(record.id ?? ''))) throw Error('ERIC returned invalid identifiers.');
  return { provider: 'ERIC metadata search', policyVersion: discoveryPolicyVersion, query, urls: [...new Set(records.map(record => `https://eric.ed.gov/?id=${record.id}`))], searchedAt: new Date().toISOString() };
}
export async function fetchEvidenceSource(url, options = {}) {
  url = evidenceSourceURL(url);
  if (new URL(url).hostname === 'pubmed.ncbi.nlm.nih.gov') return fetchPrimarySource(url, options);
  const id = new URL(url).searchParams.get('id');
  const records = await ericRequest({ search: `id:${id}`, rows: '1', fields: 'id,title,author,source,publisher,institution,publicationdateyear,description,peerreviewed,educationlevel,publicationtype' }, options.fetchImpl ?? fetch);
  if (records.length !== 1) throw Error('The requested ERIC source was not found.');
  return parseERICRecord(records[0], url);
}
export async function searchEvidenceSources(topic, options = {}) {
  const results = await Promise.allSettled([searchPrimarySources(topic, options), searchERICSources(topic, options)]);
  const searches = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (!searches.length) throw Error(`Source searches failed: ${results.map(result => result.reason.message).join('; ')}`);
  return { provider: 'PubMed and ERIC', policyVersion: discoveryPolicyVersion, urls: [...new Set(searches.flatMap(result => result.urls))], searches, failures: results.flatMap((result, index) => result.status === 'rejected' ? [{ provider: index ? 'ERIC' : 'PubMed', reason: result.reason.message }] : []), searchedAt: new Date().toISOString() };
}
export function validateSearchReceipt(receipt) {
  const combined = receipt.provider === 'PubMed and ERIC';
  if (!combined && receipt.provider !== 'PubMed ESearch' || !Array.isArray(receipt.urls) || receipt.urls.length > (combined ? discoveryCandidateLimit : primarySearchResultLimit) || new Set(receipt.urls).size !== receipt.urls.length || receipt.urls.some(url => evidenceSourceURL(url) !== url || !combined && new URL(url).hostname !== 'pubmed.ncbi.nlm.nih.gov')) throw Error('The public search receipt is invalid.');
  return receipt;
}
