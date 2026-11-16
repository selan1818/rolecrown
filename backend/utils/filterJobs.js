const fs = require(\x27fs\x27);
const path = require(\x27path\x27);

const FALLBACK_RATES = { USD: 1.0, MYR: 4.45, SGD: 1.34, EUR: 0.92, GBP: 0.79 };
const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cachedRates = null;
let lastFetchedAt = 0;

const JOOBLE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const joobleCache = new Map();

async function getExchangeRates() {
  const now = Date.now();
  if (cachedRates && now - lastFetchedAt < FX_CACHE_TTL_MS) {
    return { rates: cachedRates, source: \x2724h-cache\x27 };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      \x27https://api.frankfurter.app/latest?from=USD&to=MYR,SGD,EUR,GBP\x27,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) throw new Error(\x27FX HTTP \x27 + res.status);
    const data = await res.json();
    cachedRates = { ...FALLBACK_RATES, ...(data.rates || {}), USD: 1.0 };
    lastFetchedAt = now;
    return { rates: cachedRates, source: \x27live-api\x27 };
  } catch {
    clearTimeout(timeout);
    return { rates: cachedRates || FALLBACK_RATES, source: cachedRates ? \x27stale-cache\x27 : \x27fallback\x27 };
  }
}

function convertSalary(amount, fromCurrency, toCurrency, rates) {
  if (!amount || amount <= 0) return 0;
  const from = (fromCurrency || \x27USD\x27).toUpperCase();
  const to = (toCurrency || \x27MYR\x27).toUpperCase();
  return Math.round((amount / (rates[from] || 1.0)) * (rates[to] || 1.0));
}

// Advanced N-Gram Extractor with Generic Unigram Suppression & Bigram Priority
function extractResumeKeywords(cvText) {
  if (!cvText) return [\x27Executive\x27];

  const stopWords = new Set([
    \x27the\x27,\x27and\x27,\x27for\x27,\x27with\x27,\x27from\x27,\x27that\x27,\x27this\x27,\x27have\x27,\x27has\x27,\x27had\x27,\x27are\x27,\x27was\x27,\x27were\x27,
    \x27been\x27,\x27being\x27,\x27will\x27,\x27would\x27,\x27could\x27,\x27should\x27,\x27can\x27,\x27may\x27,\x27might\x27,\x27must\x27,\x27into\x27,
    \x27over\x27,\x27under\x27,\x27above\x27,\x27below\x27,\x27between\x27,\x27through\x27,\x27during\x27,\x27before\x27,\x27after\x27,\x27each\x27,
    \x27other\x27,\x27such\x27,\x27only\x27,\x27same\x27,\x27than\x27,\x27too\x27,\x27very\x27,\x27just\x27,\x27also\x27,\x27well\x27,\x27work\x27,\x27working\x27,
    \x27worked\x27,\x27experience\x27,\x27experiences\x27,\x27years\x27,\x27year\x27,\x27month\x27,\x27months\x27,\x27present\x27,\x27current\x27,
    \x27currently\x27,\x27role\x27,\x27roles\x27,\x27team\x27,\x27teams\x27,\x27project\x27,\x27projects\x27,\x27education\x27,\x27university\x27,
    \x27college\x27,\x27degree\x27,\x27bachelor\x27,\x27master\x27,\x27diploma\x27,\x27certificate\x27,\x27certified\x27,\x27certification\x27,
    \x27email\x27,\x27phone\x27,\x27address\x27,\x27linkedin\x27,\x27github\x27,\x27references\x27,\x27available\x27,\x27upon\x27,\x27request\x27,
    \x27strong\x27,\x27excellent\x27,\x27good\x27,\x27ability\x27,\x27using\x27,\x27used\x27,\x27including\x27,\x27across\x27,\x27within\x27,
    \x27based\x27,\x27new\x27,\x27high\x27,\x27key\x27,\x27company\x27,\x27organization\x27,\x27services\x27,\x27service\x27,\x27solutions\x27,
    \x27support\x27,\x27process\x27,\x27processes\x27,\x27system\x27,\x27systems\x27,\x27data\x27,\x27report\x27,\x27reports\x27,\x27reporting\x27,
    \x27client\x27,\x27clients\x27,\x27customer\x27,\x27customers\x27,\x27stakeholders\x27,\x27january\x27,\x27february\x27,\x27march\x27,\x27april\x27,
    \x27june\x27,\x27july\x27,\x27august\x27,\x27september\x27,\x27october\x27,\x27november\x27,\x27december\x27,\x27malaysia\x27,\x27kuala\x27,
    \x27lumpur\x27,\x27selangor\x27,\x27singapore\x27,\x27remote\x27,\x27hybrid\x27,\x27full\x27,\x27time\x27,\x27part\x27,\x27sdn\x27,\x27bhd\x27
  ]);

  // Generic corporate words that must NEVER act as standalone search terms
  const genericUnigrams = new Set([
    \x27management\x27, \x27manager\x27, \x27business\x27, \x27analyst\x27, \x27operations\x27,
    \x27support\x27, \x27process\x27, \x27system\x27, \x27systems\x27, \x27data\x27, \x27report\x27,
    \x27reports\x27, \x27reporting\x27, \x27client\x27, \x27clients\x27, \x27customer\x27,
    \x27customers\x27, \x27team\x27, \x27teams\x27, \x27project\x27, \x27projects\x27,
    \x27service\x27, \x27services\x27, \x27solution\x27, \x27solutions\x27, \x27work\x27,
    \x27working\x27, \x27worked\x27, \x27experience\x27, \x27experiences\x27, \x27years\x27,
    \x27year\x27, \x27month\x27, \x27months\x27, \x27role\x27, \x27roles\x27, \x27key\x27,
    \x27high\x27, \x27new\x27, \x27based\x27, \x27across\x27, \x27within\x27, \x27including\x27,
    \x27using\x27, \x27used\x27, \x27lead\x27, \x27senior\x27, \x27specialist\x27
  ]);

  const cleanText = cvText.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, \x27 \x27);
  const words = cleanText
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w) && !/^\d+$/.test(w));

  const phraseCounts = new Map();

  // 1. Prioritize Bigrams (2-word technical/domain phrases) with high weight
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = words[i] + \x27 \x27 + words[i+1];
    phraseCounts.set(bigram, (phraseCounts.get(bigram) || 0) + 5);
  }

  // 2. Count unigrams ONLY if they are specific technical/domain terms (not generic corporate filler)
  for (const w of words) {
    if (!genericUnigrams.has(w)) {
      phraseCounts.set(w, (phraseCounts.get(w) || 0) + 1);
    }
  }

  const sortedPhrases = [...phraseCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([phrase]) => phrase);

  return sortedPhrases.length > 0 ? sortedPhrases.slice(0, 3) : [\x27Executive\x27];
}

function parseJoobleSalary(salaryStr, locationStr) {
  if (!salaryStr || typeof salaryStr !== \x27string\x27) return { amount: 0, currency: \x27MYR\x27 };
  const lower = salaryStr.toLowerCase();
  let currency = \x27USD\x27;
  if (lower.includes(\x27rm\x27) || lower.includes(\x27myr\x27) || (locationStr || \x27\x27).toLowerCase().includes(\x27malaysia\x27)) currency = \x27MYR\x27;
  else if (lower.includes(\x27s$\x27) || lower.includes(\x27sgd\x27) || (locationStr || \x27\x27).toLowerCase().includes(\x27singapore\x27)) currency = \x27SGD\x27;
  else if (lower.includes(\x27€\x27) || lower.includes(\x27eur\x27)) currency = \x27EUR\x27;
  else if (lower.includes(\x27£\x27) || lower.includes(\x27gbp\x27)) currency = \x27GBP\x27;

  const nums = salaryStr.match(/\d[\d,.]*/g);
  if (!nums || nums.length === 0) return { amount: 0, currency };
  const parsedNums = nums.map((n) => Number(n.replace(/,/g, \x27\x27))).filter((n) => !isNaN(n) && n > 0);
  if (parsedNums.length === 0) return { amount: 0, currency };

  let avg = parsedNums.reduce((a, b) => a + b, 0) / parsedNums.length;
  if (lower.includes(\x27hour\x27) || lower.includes(\x27/hr\x27)) avg *= 160;
  else if (lower.includes(\x27day\x27) || lower.includes(\x27/day\x27)) avg *= 22;
  else if (lower.includes(\x27year\x27) || lower.includes(\x27annum\x27) || lower.includes(\x27/yr\x27) || avg > 45000) avg /= 12;

  return { amount: Math.round(avg), currency };
}

function stripHtml(html) {
  return (html || \x27\x27).replace(/<[^>]*>/g, \x27 \x27).replace(/&nbsp;/gi, \x27 \x27).replace(/&amp;/gi, \x27&\x27).replace(/\s+/g, \x27 \x27).trim();
}

function formatPostedAgo(updatedIso) {
  if (!updatedIso) return \x27Recent\x27;
  const ts = Date.parse(updatedIso);
  if (isNaN(ts)) return \x27Recent\x27;
  const diffHours = Math.max(1, Math.floor((Date.now() - ts) / (1000 * 60 * 60)));
  if (diffHours < 24) return diffHours + \x27h ago\x27;
  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? \x271d ago\x27 : diffDays + \x27d ago\x27;
}

async function resolveDirectApplyUrl(rawLink, title, company, location) {
  const cleanQuery = encodeURIComponent(title + \x27 \x27 + (company !== \x27Verified Employer\x27 ? company : \x27\x27) + \x27 \x27 + location.trim());
  const googleJobsFallback = \x27https://www.google.com/search?q=\x27 + cleanQuery + \x27+jobs&ibp=htl;jobs\x27;

  if (!rawLink || rawLink === \x27#\x27) return { url: googleJobsFallback, isDirect: false };
  if (!rawLink.includes(\x27jooble.org\x27)) return { url: rawLink, isDirect: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(rawLink, {
      method: \x27GET\x27,
      redirect: \x27manual\x27,
      headers: {
        \x27User-Agent\x27: \x27Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36\x27,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const locHeader = res.headers.get(\x27location\x27);
    if (locHeader && locHeader.startsWith(\x27http\x27) && !locHeader.includes(\x27jooble.org\x27)) {
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
    const normTitle = (job.title || \x27\x27).toLowerCase().replace(/[^a-z0-9]/g, \x27\x27);
    const normCompany = (job.company || \x27\x27)
      .toLowerCase()
      .replace(/\b(sdn|bhd|pte|ltd|inc|llc|corp|group|malaysia|singapore)\b/g, \x27\x27)
      .replace(/[^a-z0-9]/g, \x27\x27);
    const key = normTitle + \x27|\x27 + normCompany;
    if (!seen.has(key)) seen.set(key, job);
    else if (seen.get(key).salary === 0 && job.salary > 0) seen.set(key, job);
  }
  return Array.from(seen.values());
}

async function queryJoobleOnce(cleanKeywords, cleanLocation, apiKey) {
  const cacheKey = cleanKeywords.toLowerCase() + \x27|\x27 + cleanLocation.toLowerCase();
  const now = Date.now();
  const cached = joobleCache.get(cacheKey);
  if (cached && now - cached.timestamp < JOOBLE_CACHE_TTL_MS) return cached.jobs;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(\x27https://jooble.org/api/\x27 + apiKey, {
      method: \x27POST\x27,
      headers: { \x27Content-Type\x27: \x27application/json\x27 },
      body: JSON.stringify({ keywords: cleanKeywords, location: cleanLocation, page: 1 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(\x27Jooble HTTP \x27 + res.status);
    const data = await res.json();
    const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];

    const dedupedRaw = deduplicateJobs(
      rawJobs.map((item, idx) => {
        const cleanSnippet = stripHtml(item.snippet);
        const { amount, currency } = parseJoobleSalary(item.salary, item.location || cleanLocation);
        return {
          id: item.id || \x27jooble-\x27 + idx + \x27-\x27 + Date.now(),
          title: item.title || \x27Open Position\x27,
          company: item.company || item.source || \x27Verified Employer\x27,
          location: item.location || cleanLocation,
          salary: amount,
          rawSalaryText: item.salary || \x27\x27,
          currency,
          skills: cleanSnippet.slice(0, 180),
          snippet: cleanSnippet,
          rawLink: item.link || \x27#\x27,
          source: item.source || \x27Jooble Live\x27,
          updatedAt: item.updated || null,
          postedAgo: formatPostedAgo(item.updated),
        };
      })
    );

    const normalized = await Promise.all(
      dedupedRaw.map(async (job) => {
        const resolved = await resolveDirectApplyUrl(job.rawLink, job.title, job.company, job.location);
        const linkedinSearchUrl = \x27https://www.linkedin.com/jobs/search/?keywords=\x27 + encodeURIComponent(job.title + \x27 \x27 + job.company) + \x27&location=\x27 + encodeURIComponent(job.location);
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
    console.error(\x27Jooble API error:\x27, err.message);
    return null;
  }
}

async function fetchLiveJoobleJobs(resumeKeywords, location) {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) return [];
  const cleanLocation = (location || \x27Malaysia\x27).trim();

  const q1 = resumeKeywords[0] || \x27Executive\x27;
  const q2 = resumeKeywords[1] && resumeKeywords[1] !== q1 ? resumeKeywords[1] : null;

  const [res1, res2] = await Promise.all([
    queryJoobleOnce(q1, cleanLocation, apiKey),
    q2 ? queryJoobleOnce(q2, cleanLocation, apiKey) : Promise.resolve([]),
  ]);

  const combined = [...(res1 || []), ...(res2 || [])];
  return combined.length > 0 ? deduplicateJobs(combined) : [];
}

function matchesDateFilter(job, datePosted) {
  if (!datePosted || datePosted === \x27all\x27 || !job.updatedAt) return true;
  const ts = Date.parse(job.updatedAt);
  if (isNaN(ts)) return true;
  const ageMs = Date.now() - ts;
  const dayMs = 24 * 60 * 60 * 1000;
  if (datePosted === \x2724h\x27) return ageMs <= dayMs;
  if (datePosted === \x277d\x27) return ageMs <= 7 * dayMs;
  return true;
}

function containsTerm(text, term) {
  const cleanTerm = term.trim().toLowerCase();
  if (!cleanTerm) return false;
  const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, \x27\\\\$$\x27);
  return new RegExp(\x27(^|[^a-z0-9])\x27 + escaped + \x27($|[^a-z0-9])\x27, \x27i\x27).test(text);
}

function scoreLiveJobAgainstCV(job, resumeKeywords) {
  if (!resumeKeywords || resumeKeywords.length === 0) return { matchScore: null, matchedSkills: [] };
  const haystack = (job.title + \x27 \x27 + (job.snippet || job.skills || \x27\x27) + \x27 \x27 + (job.company || \x27\x27)).toLowerCase();
  const matched = resumeKeywords.filter((kw) => containsTerm(haystack, kw));
  if (matched.length === 0) return { matchScore: 0, matchedSkills: [] };

  const ratio = matched.length / Math.min(resumeKeywords.length, 8);
  const matchScore = Math.min(98, Math.max(50, Math.round(50 + ratio * 48)));
  return { matchScore, matchedSkills: matched.slice(0, 6).map((s) => s.toUpperCase()) };
}

async function filter(location = \x27\x27, minSalary = 0, maxSalary = 10000000, cv = \x27\x27, currency = \x27MYR\x27, datePosted = \x277d\x27) {
  const { rates, source } = await getExchangeRates();
  const cvText = cv.trim();
  const targetCurrency = (currency || \x27MYR\x27).toUpperCase();
  const resumeKeywords = extractResumeKeywords(cvText);
  const searchLocation = location.trim() || \x27Malaysia\x27;

  let jobs = await fetchLiveJoobleJobs(resumeKeywords, searchLocation);
  let datedJobs = jobs.filter((job) => matchesDateFilter(job, datePosted));
  let broadenedFrom7d = false;
  if (datePosted === \x277d\x27 && datedJobs.length === 0 && jobs.length > 0) {
    datedJobs = jobs;
    broadenedFrom7d = true;
  }

  const results = [];
  for (const job of datedJobs) {
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
    if (matchedSkills.length === 0) continue;

    results.push({
      ...job,
      convertedSalary,
      displayCurrency: targetCurrency,
      rateSource: source,
      broadenedFrom7d,
      matchScore,
      matchedSkills,
    });
  }

  if (cvText) results.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  return results;
}

module.exports = { filter };