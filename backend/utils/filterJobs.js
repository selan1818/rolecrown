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

const STOP_WORDS = new Set([
  'the','and','for','with','from','that','this','have','has','had','are','was','were',
  'been','being','will','would','could','should','can','may','might','must','into',
  'over','under','above','below','between','through','during','before','after','each',
  'other','such','only','same','than','too','very','just','also','well','work','working',
  'worked','experience','experiences','years','year','month','months','present','current',
  'currently','role','roles','team','teams','education','university','college','degree',
  'bachelor','master','diploma','certificate','certified','certification','email','phone',
  'address','linkedin','github','references','available','upon','request','strong',
  'excellent','good','ability','using','used','including','across','within','based',
  'new','high','key','company','organization','client','clients','customer','customers',
  'stakeholders','january','february','march','april','june','july','august','september',
  'october','november','december','malaysia','kuala','lumpur','selangor','singapore',
  'remote','hybrid','full','time','part','sdn','bhd','berhad','puchong','klang','petronas',
  'allianz','standard','chartered','ibm','aig','upm','msu','hons','cgpa','awarded',
  'distinction','seeking','proven','seasoned','results','driven','decade','global',
  'internal','external','various','multiple','daily','weekly','monthly','biweekly',
  'ongoing','clear','concise','documented','effective','effectively','closely','smoothly',
  'properly','strict','strictly','complex','large','scale','level','tier','first','second'
]);

const GENERIC_UNIGRAMS = new Set([
  'management','manager','managers','managing','managed','business','analyst','analysts',
  'operations','operational','support','supporting','supported','process','processes',
  'system','systems','data','report','reports','reporting','project','projects',
  'service','services','solution','solutions','lead','leading','leader','leadership',
  'senior','specialist','specialists','associate','executive','officer','director',
  'head','supervisor','supervising','coordinator','consultant','consulting','advisor',
  'development','analysis','analytical','review','reviews','training','coaching',
  'monitoring','tracking','planning','delivery','strategy','strategic','initiatives',
  'performance','productivity','quality','control','excellence','improvement',
  'improvements','implementation','implementations','issues','problem','problems',
  'solving','attention','detail','skills','competencies','proficiency','technical',
  'core','summary','professional','history','background','environment','environments',
  'policies','policy','guidelines','procedures','requirements','standards','framework',
  'model','tools','platforms','software','hardware','applications','application',
  'enterprise','regional','center','centre','floor','queue','queues','shift','shifts',
  'vendors','vendor','stakeholder','owners','owner','agreements','budget','budgets',
  'cost','fixed','independent','founded','helped','built','took','ownership',
  'escalation','escalated','timelines','timeline','set','setting','step','stepped',
  'run','running','led','directed','aligning','priorities','conducted','conduct',
  'spearhead','oversee','assign','cases','workflow','validate','forms','serve',
  'subject','matter','expert','sme','develop','targeted','programs','hires','existing',
  'members','enhancing','overall','capability','liaise','resolve','drive','metrics',
  'effort','counts','optimize','resource','allocation','tasks','perform','comprehensive',
  'backgrounds','source','wealth','funds','public','proprietary','research','entity',
  'structures','hierarchies','ultimate','beneficial','identify','potential','red','flags',
  'junior','prepare','summarizing','findings','recommending','ratings','mitigation',
  'strategies','office','suite','digital','literacy','thinking','privacy','due','anti',
  'money','counter','enhanced','major','root','cause','periodic','bank','banking'
]);

function extractResumeKeywords(cvText) {
  if (!cvText) return ['Executive'];

  const clauses = cvText.toLowerCase().split(/[,.;:()\[\]\n\r•·|\/\\–—-]+/);
  const bigramCounts = new Map();
  const unigramCounts = new Map();

  for (const clause of clauses) {
    const tokens = clause
      .replace(/[^a-z0-9+#\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w));

    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i];
      if (!STOP_WORDS.has(w) && !GENERIC_UNIGRAMS.has(w)) {
        unigramCounts.set(w, (unigramCounts.get(w) || 0) + 1);
      }
      if (i < tokens.length - 1) {
        const w1 = tokens[i];
        const w2 = tokens[i + 1];
        if (
          w1 !== w2 &&
          !STOP_WORDS.has(w1) &&
          !STOP_WORDS.has(w2) &&
          !(GENERIC_UNIGRAMS.has(w1) && GENERIC_UNIGRAMS.has(w2))
        ) {
          const bigram = w1 + ' ' + w2;
          bigramCounts.set(bigram, (bigramCounts.get(bigram) || 0) + 1);
        }
      }
    }
  }

  const recurringBigrams = [...bigramCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);

  const allUnigrams = [...unigramCounts.entries()].sort((a, b) => b[1] - a[1]);
  const recurringUnigrams = allUnigrams.filter(([, count]) => count >= 2).map(([w]) => w);
  const topUnigrams = recurringUnigrams.length >= 3 ? recurringUnigrams : allUnigrams.map(([w]) => w);

  const combined = [];
  if (recurringBigrams[0]) combined.push(recurringBigrams[0]);
  if (topUnigrams[0] && !combined.includes(topUnigrams[0])) combined.push(topUnigrams[0]);
  if (recurringBigrams[1] && !combined.includes(recurringBigrams[1])) combined.push(recurringBigrams[1]);
  if (topUnigrams[1] && !combined.includes(topUnigrams[1])) combined.push(topUnigrams[1]);

  for (const u of topUnigrams.slice(2, 16)) {
    if (!combined.includes(u)) combined.push(u);
  }
  for (const b of recurringBigrams.slice(2, 8)) {
    if (!combined.includes(b)) combined.push(b);
  }

  return combined.length > 0 ? combined : ['Executive'];
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
  if (!apiKey) return [];
  const cleanLocation = (location || 'Malaysia').trim();

  const queries = resumeKeywords.slice(0, 4);
  if (queries.length === 0) queries.push('Executive');

  const responses = await Promise.all(
    queries.map((q) => queryJoobleOnce(q, cleanLocation, apiKey))
  );

  const combined = responses.flatMap((r) => r || []);
  return combined.length > 0 ? deduplicateJobs(combined) : [];
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
  const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + escaped + '($|[^a-z0-9])', 'i').test(text);
}

function scoreLiveJobAgainstCV(job, resumeKeywords) {
  if (!resumeKeywords || resumeKeywords.length === 0) return { matchScore: null, matchedSkills: [] };
  const haystack = (job.title + ' ' + (job.snippet || job.skills || '') + ' ' + (job.company || '')).toLowerCase();

  const highSignalKeywords = resumeKeywords.filter((kw) => !GENERIC_UNIGRAMS.has(kw) && kw.length >= 3);
  const highSignalMatched = highSignalKeywords.filter((kw) => containsTerm(haystack, kw));

  if (highSignalKeywords.length > 0 && highSignalMatched.length === 0) {
    return { matchScore: 0, matchedSkills: [] };
  }

  const matched = highSignalMatched.length > 0 ? highSignalMatched : resumeKeywords.filter((kw) => containsTerm(haystack, kw));
  if (matched.length === 0) return { matchScore: 0, matchedSkills: [] };

  const ratio = matched.length / Math.min(highSignalKeywords.length || resumeKeywords.length, 6);
  const matchScore = Math.min(98, Math.max(55, Math.round(55 + ratio * 43)));
  return { matchScore, matchedSkills: matched.slice(0, 6).map((s) => s.toUpperCase()) };
}

async function filter(location = '', minSalary = 0, maxSalary = 10000000, cv = '', currency = 'MYR', datePosted = '7d') {
  const { rates, source } = await getExchangeRates();
  const cvText = cv.trim();
  const targetCurrency = (currency || 'MYR').toUpperCase();
  const resumeKeywords = extractResumeKeywords(cvText);
  const searchLocation = location.trim() || 'Malaysia';

  const jobs = await fetchLiveJoobleJobs(resumeKeywords, searchLocation);
  let datedJobs = jobs.filter((job) => matchesDateFilter(job, datePosted));
  let broadenedFrom7d = false;
  if (datePosted === '7d' && datedJobs.length === 0 && jobs.length > 0) {
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
    if (matchScore === 0 || matchedSkills.length === 0) continue;

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