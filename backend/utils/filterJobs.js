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

// Pure filler words that cannot appear in unigrams or bigrams
const STOP_WORDS = new Set([
  'the','and','for','with','from','that','this','have','has','had','are','was','were',
  'been','being','will','would','could','should','can','may','might','must','into',
  'over','under','above','below','between','through','during','before','after','each',
  'other','such','only','same','than','too','very','just','also','well','work','working',
  'worked','experience','experiences','years','year','month','months','present','current',
  'currently','role','roles','team','teams','education','university','college','degree',
  'bachelor','master','diploma','certificate','certified','certification','certifications',
  'email','phone','address','linkedin','github','references','available','upon','request',
  'strong','excellent','good','ability','using','used','including','across','within','based',
  'new','high','key','company','organization','january','february','march','april','june',
  'july','august','september','october','november','december','malaysia','kuala','lumpur',
  'selangor','singapore','remote','hybrid','full','time','part','sdn','bhd','berhad',
  'puchong','klang','petronas','allianz','standard','chartered','ibm','aig','upm','msu',
  'hons','cgpa','awarded','distinction','seeking','proven','seasoned','results','driven',
  'decade','global','internal','external','various','multiple','daily','weekly','monthly',
  'ongoing','clear','concise','documented','effective','effectively','closely','smoothly',
  'properly','strict','strictly','complex','large','scale','level','tier','first','second',
  'end','spearhead','conduct','conducted','oversee','ensure','ensuring','perform','performed',
  'validate','serve','develop','deliver','liaise','resolve','drive','analyze','prepare',
  'contribute','leverage','navigate','align','evolving','existing','enhancing','overall',
  'both','public','proprietary','potential','red','flags','findings','recommending',
  'summarizing','skills','competencies','proficiency','summary','professional','challenging'
]);

// Words that are TOO AMBIGUOUS as single standalone unigrams (e.g., "desk", "production", "incident"),
// but CAN combine to form valid 2-word domain bigrams (e.g., "service desk", "incident manager", "service delivery")
const CONTEXT_ONLY_UNIGRAMS = new Set([
  'desk','production','incident','incidents','problem','problems','release','releases',
  'change','changes','request','requests','ticket','tickets','backlog','backlogs',
  'service','services','delivery','management','manager','managers','managing','managed',
  'lead','leading','leader','leadership','senior','junior','specialist','specialists',
  'analyst','analysts','associate','executive','officer','director','head','supervisor',
  'coordinator','consultant','advisor','engineer','technician','operations','operational',
  'support','supporting','supported','process','processes','system','systems','data',
  'report','reports','reporting','project','projects','product','products','solution',
  'solutions','application','applications','enterprise','regional','center','centre',
  'client','clients','customer','customers','stakeholder','stakeholders','vendor','vendors',
  'business','development','analysis','analytical','review','reviews','training','coaching',
  'monitoring','tracking','planning','strategy','strategic','initiatives','performance',
  'productivity','quality','control','excellence','improvement','improvements','implementation',
  'implementations','issues','solving','attention','detail','technical','core','history',
  'background','backgrounds','environment','environments','policies','policy','guidelines',
  'procedures','requirements','standards','framework','model','tools','platforms',
  'software','hardware','network','security','cloud','server','infrastructure',
  'floor','queue','queues','shift','shifts','owners','owner','ownership','agreements',
  'budget','budgets','cost','fixed','independent','escalation','escalated','timelines',
  'timeline','priorities','assign','cases','case','workflow','forms','subject','matter',
  'expert','sme','targeted','programs','hires','members','capability','metrics','effort',
  'counts','optimize','resource','allocation','tasks','comprehensive','source','wealth',
  'funds','research','entity','structures','hierarchies','ultimate','beneficial','identify',
  'ratings','mitigation','strategies','office','suite','digital','literacy','thinking',
  'privacy','due','anti','money','counter','enhanced','major','root','cause','periodic',
  'bank','banking','financial','crime','risk','risks','assessment','gap','testing',
  'screening','onboarding','remediation','tax','documentation','legal','adverse','media',
  'politically','exposed','persons','terrorist','financing','laundering','human','procurement'
]);

// Non-specific bigrams to ignore even if both words pass STOP_WORDS
const GENERIC_BIGRAMS = new Set([
  'project management','stakeholder management','team leadership','problem solving',
  'analytical thinking','digital literacy','office suite','microsoft office',
  'data privacy','privacy management','data analysis','quality control',
  'process improvements','process improvement','operational excellence','resource allocation',
  'performance metrics','performance feedback','training programs','system implementations',
  'automation tools','research tools','remediation projects','data remediation',
  'mitigation strategies','risk ratings','legal entity','entity structures',
  'ownership hierarchies','ultimate beneficial','beneficial ownership','politically exposed',
  'exposed persons','adverse media','counter terrorist','bank negara','human resource',
  'medical laboratory','laboratory technologist','asian institute','chartered bankers'
]);

function stripEducationSection(cvText) {
  return cvText.replace(/\n\s*education\s*\n[\s\S]*?(?=\n\s*(?:certifications|skills|competencies|projects|languages|awards)\b|$)/i, '\n');
}

function extractResumeKeywords(cvText) {
  if (!cvText) return ['Executive'];

  const workingText = stripEducationSection(cvText);
  const headerSlice = workingText.slice(0, 320).toLowerCase();
  const clauses = workingText.toLowerCase().split(/[,.;:()\[\]\n\r•·|\/\\–—&]+/);

  const bigramScores = new Map();
  const unigramScores = new Map();

  for (const clause of clauses) {
    const tokens = clause
      .replace(/[^a-z0-9+#\s-]/g, ' ')
      .replace(/-/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w));

    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i];
      if (!STOP_WORDS.has(w) && !CONTEXT_ONLY_UNIGRAMS.has(w)) {
        const boost = headerSlice.includes(w) ? 3 : 1;
        unigramScores.set(w, (unigramScores.get(w) || 0) + boost);
      }

      if (i < tokens.length - 1) {
        const w1 = tokens[i];
        const w2 = tokens[i + 1];
        const bigram = w1 + ' ' + w2;
        // Do not glue two short acronyms into a single bigram (e.g. "cdd aml")
        const bothShortAcronyms = w1.length <= 4 && w2.length <= 4 && !CONTEXT_ONLY_UNIGRAMS.has(w1) && !CONTEXT_ONLY_UNIGRAMS.has(w2);
        if (
          w1 !== w2 &&
          !bothShortAcronyms &&
          !STOP_WORDS.has(w1) &&
          !STOP_WORDS.has(w2) &&
          !GENERIC_BIGRAMS.has(bigram)
        ) {
          const boost = headerSlice.includes(bigram) ? 4 : 1;
          bigramScores.set(bigram, (bigramScores.get(bigram) || 0) + boost);
        }
      }
    }
  }

  const topBigrams = [...bigramScores.entries()]
    .filter(([, score]) => score >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);

  const topUnigrams = [...unigramScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);

  // Interleave top unambiguous domain unigrams/acronyms and top domain bigrams
  const combined = [];
  const maxLen = Math.max(topUnigrams.length, topBigrams.length);
  for (let i = 0; i < maxLen; i++) {
    if (topUnigrams[i] && !combined.includes(topUnigrams[i])) combined.push(topUnigrams[i]);
    if (topBigrams[i] && !combined.includes(topBigrams[i])) combined.push(topBigrams[i]);
  }

  return combined.length > 0 ? combined.slice(0, 18) : ['Executive'];
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
  const timeout = setTimeout(() => controller.abort(), 2000);
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
        const loc = item.location || cleanLocation;
        const title = item.title || 'Open Position';
        const company = item.company || item.source || 'Verified Employer';
        const linkedinSearchUrl = 'https://www.linkedin.com/jobs/search/?keywords=' + encodeURIComponent(title + ' ' + company) + '&location=' + encodeURIComponent(loc);
        return {
          id: item.id || 'jooble-' + idx + '-' + Date.now(),
          title,
          company,
          location: loc,
          salary: amount,
          rawSalaryText: item.salary || '',
          currency,
          skills: cleanSnippet.slice(0, 180),
          snippet: cleanSnippet,
          rawLink: item.link || '#',
          applyUrl: item.link || '#',
          apply_url: item.link || '#',
          linkedinSearchUrl,
          source: item.source || 'Jooble Live',
          updatedAt: item.updated || null,
          postedAgo: formatPostedAgo(item.updated),
        };
      })
    );

    if (dedupedRaw.length > 0) joobleCache.set(cacheKey, { timestamp: now, jobs: dedupedRaw });
    return dedupedRaw;
  } catch (err) {
    clearTimeout(timeout);
    console.error('Jooble API error:', err.message);
    return [];
  }
}

async function fetchLiveJoobleJobs(resumeKeywords, location) {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) return [];
  const cleanLocation = (location || 'Malaysia').trim();

  const queries = resumeKeywords.slice(0, 5);
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

const OUT_OF_DOMAIN_TITLE_TERMS = [
  'marketing','deal desk','clinical','nurse','nursing','pharmacist','physician',
  'dental','veterinary','chef','barista','kitchen','driver','forklift','welder',
  'machinist','production quality','quality technician','plant','warehouse','videographer',
  'graphic designer','social media','tiktok','copywriter','teacher','tutor','lecturer',
  'real estate','telesales','telemarketing','beauty','therapist','hair','retail associate',
  'cashier','receptionist','front desk','accountant','bookkeeper','tax','payroll',
  'recruiter','talent acquisition','human resources','hr business partner','purchasing','procurement'
];

function scoreLiveJobAgainstCV(job, resumeKeywords, cvText) {
  if (!resumeKeywords || resumeKeywords.length === 0) return { matchScore: null, matchedSkills: [] };
  const titleLower = (job.title || '').toLowerCase();
  const snippetLower = (job.snippet || job.skills || '').toLowerCase();
  const haystack = titleLower + ' ' + snippetLower;
  const cvWorkingLower = stripEducationSection(cvText || '').toLowerCase();

  // Reject immediately if the job title is for a specific profession not present in the candidate work history
  for (const term of OUT_OF_DOMAIN_TITLE_TERMS) {
    if (containsTerm(titleLower, term) && !containsTerm(cvWorkingLower, term)) {
      return { matchScore: 0, matchedSkills: [] };
    }
  }

  const matched = resumeKeywords.filter((kw) => containsTerm(haystack, kw));
  if (matched.length === 0) return { matchScore: 0, matchedSkills: [] };

  const titleMatches = resumeKeywords.filter((kw) => containsTerm(titleLower, kw));
  // Require either a direct domain match in the job title OR at least 2 distinct domain keyword/phrase matches
  if (titleMatches.length === 0 && matched.length < 2) {
    return { matchScore: 0, matchedSkills: [] };
  }

  const scoreBase = titleMatches.length > 0 ? 64 : 54;
  const ratio = matched.length / Math.min(resumeKeywords.length, 6);
  const matchScore = Math.min(98, Math.round(scoreBase + ratio * 34));
  return { matchScore, matchedSkills: matched.slice(0, 6).map((s) => s.toUpperCase()) };
}

async function filter(location = '', minSalary = 0, maxSalary = 10000000, cv = '', currency = 'MYR', datePosted = '7d') {
  const { rates, source } = await getExchangeRates();
  const cvText = cv.trim();
  const targetCurrency = (currency || 'MYR').toUpperCase();
  const resumeKeywords = extractResumeKeywords(cvText);
  const searchLocation = location.trim() || 'Malaysia';

  const jobs = await fetchLiveJoobleJobs(resumeKeywords, searchLocation);

  // Score and filter for relevance + salary FIRST before applying the 7d window
  const relevantJobs = [];
  for (const job of jobs) {
    const convertedSalary = convertSalary(job.salary, job.currency, targetCurrency, rates);
    if (convertedSalary > 0) {
      if (minSalary > 0 && convertedSalary < minSalary) continue;
      if (convertedSalary > maxSalary) continue;
    }

    if (!cvText) {
      relevantJobs.push({ ...job, convertedSalary, displayCurrency: targetCurrency, rateSource: source, matchScore: null, matchedSkills: [] });
      continue;
    }

    const { matchScore, matchedSkills } = scoreLiveJobAgainstCV(job, resumeKeywords, cvText);
    if (matchScore === 0 || matchedSkills.length === 0) continue;

    relevantJobs.push({
      ...job,
      convertedSalary,
      displayCurrency: targetCurrency,
      rateSource: source,
      matchScore,
      matchedSkills,
    });
  }

  let datedJobs = relevantJobs.filter((job) => matchesDateFilter(job, datePosted));
  let broadenedFrom7d = false;
  if (datePosted === '7d' && datedJobs.length === 0 && relevantJobs.length > 0) {
    datedJobs = relevantJobs;
    broadenedFrom7d = true;
  }

  if (cvText) datedJobs.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));

  // Resolve direct apply links for the final matched results
  const finalResults = await Promise.all(
    datedJobs.slice(0, 25).map(async (job) => {
      const resolved = await resolveDirectApplyUrl(job.rawLink, job.title, job.company, job.location);
      return {
        ...job,
        broadenedFrom7d,
        applyUrl: resolved.url,
        apply_url: resolved.url,
        isDirectLink: resolved.isDirect,
      };
    })
  );

  return finalResults;
}

module.exports = { filter, extractResumeKeywords, scoreLiveJobAgainstCV };