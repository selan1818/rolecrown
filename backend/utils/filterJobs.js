const fs = require('fs');
const path = require('path');

const FALLBACK_RATES = { USD: 1.0, MYR: 4.45, SGD: 1.34, EUR: 0.92, GBP: 0.79 };
const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cachedRates = null;
let lastFetchedAt = 0;

const JOOBLE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const joobleCache = new Map();

async function getExchangeRates() {
  const now = Date.now();
  if (cachedRates && now - lastFetchedAt < FX_CACHE_TTL_MS) {
    return { rates: cachedRates, source: '24h-cache' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      'https://api.frankfurter.app/latest?from=USD&to=MYR,SGD,EUR,GBP',
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) throw new Error('FX HTTP ' + res.status);
    const data = await res.json();
    cachedRates = { ...FALLBACK_RATES, ...(data.rates || {}), USD: 1.0 };
    lastFetchedAt = now;
    return { rates: cachedRates, source: 'live-api' };
  } catch {
    clearTimeout(timeout);
    return { rates: cachedRates || FALLBACK_RATES, source: cachedRates ? 'stale-cache' : 'fallback' };
  }
}

function convertSalary(amount, fromCurrency, toCurrency, rates) {
  if (!amount || amount <= 0) return 0;
  const from = (fromCurrency || 'USD').toUpperCase();
  const to = (toCurrency || 'MYR').toUpperCase();
  return Math.round((amount / (rates[from] || 1.0)) * (rates[to] || 1.0));
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else current += char;
  }
  result.push(current.trim());
  return result;
}

function loadFallbackCSVJobs() {
  try {
    const csvPath = path.join(__dirname, '..', 'data', 'jobs.csv');
    const raw = fs.readFileSync(csvPath, 'utf-8').trim();
    const lines = raw.split(/\r?\n/);
    const headers = parseCSVLine(lines[0]);
    return lines.slice(1).map((line) => {
      const values = parseCSVLine(line);
      const job = {};
      headers.forEach((h, idx) => { job[h] = values[idx] || ''; });
      job.salary = Number(job.salary) || 0;
      job.currency = (job.currency || 'USD').toUpperCase();
      job.apply_url = job.applyUrl || job.apply_url || '#';
      job.postedAgo = 'Recent';
      job.updatedAt = null;
      return job;
    });
  } catch {
    return [];
  }
}

// Universal Dynamic N-Gram Extractor
function extractResumeKeywords(cvText) {
  if (!cvText) return ['Executive'];

  const stopWords = new Set([
    'the','and','for','with','from','that','this','have','has','had','are','was','were',
    'been','being','will','would','could','should','can','may','might','must','into',
    'over','under','above','below','between','through','during','before','after','each',
    'other','such','only','same','than','too','very','just','also','well','work','working',
    'worked','experience','experiences','years','year','month','months','present','current',
    'currently','role','roles','team','teams','project','projects','management','manager',
    'managing','managed','responsible','responsibilities','duties','skills','summary',
    'profile','education','university','college','degree','bachelor','master','diploma',
    'certificate','certified','certification','email','phone','address','linkedin','github',
    'references','available','upon','request','strong','excellent','good','ability','using',
    'used','including','across','within','based','new','high','key','company','organization',
    'business','services','service','solutions','support','operations','process','processes',
    'system','systems','data','report','reports','reporting','client','clients','customer',
    'customers','stakeholders','january','february','march','april','june','july','august',
    'september','october','november','december','malaysia','kuala','lumpur','selangor',
    'singapore','remote','hybrid','full','time','part','sdn','bhd'
  ]);

  const cleanText = cvText.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, ' ');
  const words = cleanText
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w) && !/^\d+$/.test(w));

  const phraseCounts = new Map();

  for (const w of words) {
    phraseCounts.set(w, (phraseCounts.get(w) || 0) + 1);
  }

  for (let i = 0; i < words.length - 1; i++) {
    const bigram = words[i] + ' ' + words[i+1];
    phraseCounts.set(bigram, (phraseCounts.get(bigram) || 0) + 3);
  }

  const sortedPhrases = [...phraseCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([phrase]) => phrase);

  return sortedPhrases.length > 0 ? sortedPhrases.slice(0, 4) : ['Executive'];
}

function parseJoobleSalary(salaryStr, locationStr) {
  if (!salaryStr || typeof salaryStr !== 'string') return { amount: 0, currency: 'MYR' };
  const lower = salaryStr.toLowerCase();
  let currency = 'USD';
  if (lower.includes('rm') || lower.includes('myr') || (locationStr || '').toLowerCase().includes('malaysia')) currency = 'MYR';
  else if (lower.includes('s$') || lower.includes('sgd') || (locationStr || '').toLowerCase().includes('singapore')) currency = 'SGD';
  else if (lower.includes('€') || lower.includes('eur')) currency = 'EUR';
  else if (lower.includes('£') || lower.includes('gbp')) currency = 'GBP';

  const nums = salaryStr.match(/\d[\d,.]*/g);
  if (!nums || nums.length === 0) return { amount: 0, currency };
  const parsedNums = nums.map((n) => Number(n.replace(/,/g, ''))).filter((n) => !isNaN(n) && n > 0);
  if (parsedNums.length === 0) return { amount: 0, currency };

  let avg = parsedNums.reduce((a, b) => a + b, 0) / parsedNums.length;
  if (lower.includes('hour') || lower.includes('/hr')) avg *= 160;
  else if (lower.includes('day') || lower.includes('/day')) avg *= 22;
  else if (lower.includes('year') || lower.includes('annum') || lower.includes('/yr') || avg > 45000) avg /= 12;

  return { amount: Math.round(avg), currency };
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function formatPostedAgo(updatedIso) {
  if (!updatedIso) return 'Recent';
  const ts = Date.parse(updatedIso);
  if (isNaN(ts)) return 'Recent';
  const diffHours = Math.max(1, Math.floor((Date.now() - ts) / (1000 * 60 * 60)));
  if (diffHours < 24) return diffHours + 'h ago';
  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? '1d ago' : diffDays + 'd ago';
}

async function resolveDirectApplyUrl(rawLink, title, company, location) {
  const cleanQuery = encodeURIComponent(title + ' ' + (company !== 'Verified Employer' ? company : '') + ' ' + location.trim());
  const googleJobsFallback = 'https://www.google.com/search?q=' + cleanQuery + '+jobs&ibp=htl;jobs';

  if (!rawLink || rawLink === '#') return { url: googleJobsFallback, isDirect: false };
  if (!rawLink.includes('jooble.org')) return { url: rawLink, isDirect: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(rawLink, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const locHeader = res.headers.get('location');
    if (locHeader && locHeader.startsWith('http') && !locHeader.includes('jooble.org')) {
      return { url: locHeader, isDirect: true };
    }
  } catch {
    clearTimeout(timeout);
  }

  return { url: googleJobsFallback, isDirect: false };
}

function deduplicateJobs(jobs) {
  const seen = new Map();
  for (const job of jobs) {
    const normTitle = (job.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normCompany = (job.company || '')
      .toLowerCase()
      .replace(/\b(sdn|bhd|pte|ltd|inc|llc|corp|group|malaysia|singapore)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
    const key = normTitle + '|' + normCompany;
    if (!seen.has(key)) seen.set(key, job);
    else if (seen.get(key).salary === 0 && job.salary > 0) seen.set(key, job);
  }
  return Array.from(seen.values());
}

async function queryJoobleOnce(cleanKeywords, cleanLocation, apiKey) {
  const cacheKey = cleanKeywords.toLowerCase() + '|' + cleanLocation.toLowerCase();
  const now = Date.now();
  const cached = joobleCache.get(cacheKey);
  if (cached && now - cached.timestamp < JOOBLE_CACHE_TTL_MS) return cached.jobs;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://jooble.org/api/' + apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: cleanKeywords, location: cleanLocation, page: 1 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('Jooble HTTP ' + res.status);
    const data = await res.json();
    const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];

    const dedupedRaw = deduplicateJobs(
      rawJobs.map((item, idx) => {
        const cleanSnippet = stripHtml(item.snippet);
        const { amount, currency } = parseJoobleSalary(item.salary, item.location || cleanLocation);
        return {
          id: item.id || 'jooble-' + idx + '-' + Date.now(),
          title: item.title || 'Open Position',
          company: item.company || item.source || 'Verified Employer',
          location: item.location || cleanLocation,
          salary: amount,
          rawSalaryText: item.salary || '',
          currency,
          skills: cleanSnippet.slice(0, 180),
          snippet: cleanSnippet,
          rawLink: item.link || '#',
          source: item.source || 'Jooble Live',
          updatedAt: item.updated || null,
          postedAgo: formatPostedAgo(item.updated),
        };
      })
    );

    const normalized = await Promise.all(
      dedupedRaw.map(async (job) => {
        const resolved = await resolveDirectApplyUrl(job.rawLink, job.title, job.company, job.location);
        const linkedinSearchUrl = 'https://www.linkedin.com/jobs/search/?keywords=' + encodeURIComponent(job.title + ' ' + job.company) + '&location=' + encodeURIComponent(job.location);
        return {
          ...job,
          applyUrl: resolved.url,
          apply_url: resolved.url,
          isDirectLink: resolved.isDirect,
          linkedinSearchUrl,
        };
      })
    );

    if (normalized.length > 0) joobleCache.set(cacheKey, { timestamp: now, jobs: normalized });
    return normalized;
  } catch (err) {
    clearTimeout(timeout);
    console.error('Jooble API error:', err.message);
    return null;
  }
}

async function fetchLiveJoobleJobs(resumeKeywords, location) {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) return null;
  const cleanLocation = (location || 'Malaysia').trim();

  const q1 = resumeKeywords[0] || 'Executive';
  const q2 = resumeKeywords[1] && resumeKeywords[1] !== q1 ? resumeKeywords[1] : null;

  const [res1, res2] = await Promise.all([
    queryJoobleOnce(q1, cleanLocation, apiKey),
    q2 ? queryJoobleOnce(q2, cleanLocation, apiKey) : Promise.resolve([]),
  ]);

  const combined = [...(res1 || []), ...(res2 || [])];
  return combined.length > 0 ? deduplicateJobs(combined) : (res1 || res2 || []);
}

function matchesDateFilter(job, datePosted) {
  if (!datePosted || datePosted === 'all' || !job.updatedAt) return true;
  const ts = Date.parse(job.updatedAt);
  if (isNaN(ts)) return true;
  const ageMs = Date.now() - ts;
  const dayMs = 24 * 60 * 60 * 1000;
  if (datePosted === '24h') return ageMs <= dayMs;
  if (datePosted === '7d') return ageMs <= 7 * dayMs;
  return true;
}

function containsTerm(text, term) {
  const cleanTerm = term.trim().toLowerCase();
  if (!cleanTerm) return false;
  const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$$');
  return new RegExp('(^|[^a-z0-9])' + escaped + '($|[^a-z0-9])', 'i').test(text);
}

function scoreLiveJobAgainstCV(job, resumeKeywords) {
  if (!resumeKeywords || resumeKeywords.length === 0) return { matchScore: null, matchedSkills: [] };
  const haystack = job.title + ' ' + (job.snippet || job.skills || '') + ' ' + (job.company || '');
  const matched = resumeKeywords.filter((kw) => containsTerm(haystack, kw));
  const ratio = matched.length / Math.min(resumeKeywords.length, 8);
  const matchScore = Math.min(98, Math.max(48, Math.round(48 + ratio * 52)));
  return { matchScore, matchedSkills: matched.slice(0, 6).map((s) => s.toUpperCase()) };
}

async function filter(location = '', minSalary = 0, maxSalary = 10000000, cv = '', currency = 'MYR', datePosted = '7d') {
  const { rates, source } = await getExchangeRates();
  const cvText = cv.trim();
  const targetCurrency = (currency || 'MYR').toUpperCase();
  const resumeKeywords = extractResumeKeywords(cvText);
  const searchLocation = location.trim() || 'Malaysia';

  let jobs = await fetchLiveJoobleJobs(resumeKeywords, searchLocation);
  let isLiveFeed = true;
  if (!jobs || jobs.length === 0) {
    jobs = loadFallbackCSVJobs();
    isLiveFeed = false;
  }

  let datedJobs = isLiveFeed ? jobs.filter((job) => matchesDateFilter(job, datePosted)) : jobs;
  let broadenedFrom7d = false;
  if (isLiveFeed && datePosted === '7d' && datedJobs.length === 0 && jobs.length > 0) {
    datedJobs = jobs;
    broadenedFrom7d = true;
  }

  const results = [];
  for (const job of datedJobs) {
    if (!isLiveFeed && location.trim() && !job.location.toLowerCase().includes(location.trim().toLowerCase())) continue;
    const convertedSalary = convertSalary(job.salary, job.currency, targetCurrency, rates);
    if (convertedSalary > 0) {
      if (minSalary > 0 && convertedSalary < minSalary) continue;
      if (convertedSalary > maxSalary) continue;
    }

    if (!cvText) {
      results.push({ ...job, convertedSalary, displayCurrency: targetCurrency, rateSource: source, broadenedFrom7d, matchScore: null, matchedSkills: [] });
      continue;
    }

    const { matchScore, matchedSkills } = scoreLiveJobAgainstCV(job, resumeKeywords);
    results.push({ ...job, convertedSalary, displayCurrency: targetCurrency, rateSource: source, broadenedFrom7d, matchScore, matchedSkills });
  }

  if (cvText) results.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  return results;
}

module.exports = { filter };