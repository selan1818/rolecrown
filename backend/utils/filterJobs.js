const fs = require('fs');
const path = require('path');

const FALLBACK_RATES = {
  USD: 1.0,
  MYR: 4.45,
  SGD: 1.34,
  EUR: 0.92,
  GBP: 0.79,
};

const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cachedRates = null;
let lastFetchedAt = 0;

// 6-hour Jooble search cache to conserve the 100 req/day quota
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

    if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
    const data = await res.json();

    cachedRates = {
      ...FALLBACK_RATES,
      ...(data.rates || {}),
      USD: 1.0,
    };
    lastFetchedAt = now;
    return { rates: cachedRates, source: 'live-api' };
  } catch {
    clearTimeout(timeout);
    if (cachedRates) {
      return { rates: cachedRates, source: 'stale-cache' };
    }
    return { rates: FALLBACK_RATES, source: 'fallback' };
  }
}

function convertSalary(amount, fromCurrency, toCurrency, rates) {
  if (!amount || amount <= 0) return 0;
  const from = (fromCurrency || 'USD').toUpperCase();
  const to = (toCurrency || 'MYR').toUpperCase();
  const fromRate = rates[from] || 1.0;
  const toRate = rates[to] || 1.0;
  return Math.round((amount / fromRate) * toRate);
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
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
      headers.forEach((header, idx) => {
        job[header] = values[idx] || '';
      });
      job.salary = Number(job.salary) || 0;
      job.currency = (job.currency || 'USD').toUpperCase();
      return job;
    });
  } catch {
    return [];
  }
}

// Extract top domain & role keywords from any industry resume
function extractResumeKeywords(cvText) {
  if (!cvText) return [];

  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'has', 'had',
    'are', 'was', 'were', 'been', 'being', 'will', 'would', 'could', 'should',
    'can', 'may', 'might', 'must', 'into', 'over', 'under', 'above', 'below',
    'between', 'through', 'during', 'before', 'after', 'each', 'other', 'such',
    'only', 'same', 'than', 'too', 'very', 'just', 'also', 'well', 'work',
    'working', 'worked', 'experience', 'experiences', 'years', 'year', 'month',
    'months', 'present', 'current', 'currently', 'role', 'roles', 'team', 'teams',
    'project', 'projects', 'management', 'manager', 'managing', 'managed',
    'responsible', 'responsibilities', 'duties', 'skills', 'summary', 'profile',
    'education', 'university', 'college', 'degree', 'bachelor', 'master',
    'diploma', 'certificate', 'certified', 'certification', 'email', 'phone',
    'address', 'linkedin', 'github', 'references', 'available', 'upon', 'request',
    'strong', 'excellent', 'good', 'ability', 'using', 'used', 'including',
    'across', 'within', 'based', 'new', 'high', 'key', 'company', 'organization',
    'business', 'services', 'service', 'solutions', 'support', 'operations',
    'process', 'processes', 'system', 'systems', 'data', 'report', 'reports',
    'reporting', 'client', 'clients', 'customer', 'customers', 'stakeholders',
    'january', 'february', 'march', 'april', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr',
    'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'malaysia', 'kuala', 'lumpur',
    'selangor', 'singapore', 'remote', 'hybrid', 'full', 'time', 'part'
  ]);

  const rolePatterns = [
    /\b(credit risk|aml|kyc|trade finance|wealth management|investment banking|corporate banking|retail banking|treasury|auditor|accountant|financial analyst|chartered accountant|actuary)\b/gi,
    /\b(registered nurse|pharmacist|medical officer|physiotherapist|clinical|healthcare|dentist|doctor)\b/gi,
    /\b(civil engineer|mechanical engineer|electrical engineer|chemical engineer|quantity surveyor|architect|site engineer|project engineer|qa qc)\b/gi,
    /\b(supply chain|procurement|logistics|warehouse|freight|inventory|operations manager)\b/gi,
    /\b(digital marketing|brand manager|content creator|seo|sem|public relations|sales executive|account executive|business development)\b/gi,
    /\b(human resources|talent acquisition|recruiter|payroll|hr business partner|legal counsel|paralegal|compliance officer)\b/gi,
    /\b(product manager|project manager|scrum master|business analyst|data analyst|data scientist|software engineer|devops|cloud architect|cybersecurity|network engineer|it support|servicenow|sap)\b/gi,
  ];

  const priorityTerms = [];
  for (const pattern of rolePatterns) {
    const matches = cvText.match(pattern);
    if (matches) {
      for (const m of matches) {
        const clean = m.trim().toLowerCase();
        if (!priorityTerms.includes(clean)) priorityTerms.push(clean);
      }
    }
  }

  const words = cvText
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w) && !/^\d+$/.test(w));

  const freq = new Map();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  const topFrequent = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .filter((w) => !priorityTerms.some((p) => p.includes(w)));

  return [...priorityTerms.slice(0, 5), ...topFrequent.slice(0, 10)];
}

function parseJoobleSalary(salaryStr, locationStr) {
  if (!salaryStr || typeof salaryStr !== 'string') {
    return { amount: 0, currency: 'MYR' };
  }

  const lower = salaryStr.toLowerCase();
  let currency = 'USD';
  if (lower.includes('rm') || lower.includes('myr') || (locationStr || '').toLowerCase().includes('malaysia')) {
    currency = 'MYR';
  } else if (lower.includes('s$') || lower.includes('sgd') || (locationStr || '').toLowerCase().includes('singapore')) {
    currency = 'SGD';
  } else if (lower.includes('€') || lower.includes('eur')) {
    currency = 'EUR';
  } else if (lower.includes('£') || lower.includes('gbp')) {
    currency = 'GBP';
  }

  const nums = salaryStr.match(/\d[\d,.]*/g);
  if (!nums || nums.length === 0) return { amount: 0, currency };

  const parsedNums = nums
    .map((n) => Number(n.replace(/,/g, '')))
    .filter((n) => !isNaN(n) && n > 0);

  if (parsedNums.length === 0) return { amount: 0, currency };

  let avg = parsedNums.reduce((a, b) => a + b, 0) / parsedNums.length;

  if (lower.includes('hour') || lower.includes('/hr')) {
    avg = avg * 160;
  } else if (lower.includes('day') || lower.includes('/day')) {
    avg = avg * 22;
  } else if (lower.includes('year') || lower.includes('annum') || lower.includes('/yr') || avg > 45000) {
    avg = avg / 12;
  }

  return { amount: Math.round(avg), currency };
}

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchLiveJoobleJobs(keywords, location) {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) return null;

  const cleanKeywords = (keywords || 'executive').trim();
  const cleanLocation = (location || 'Malaysia').trim();
  const cacheKey = `${cleanKeywords.toLowerCase()}|${cleanLocation.toLowerCase()}`;

  const now = Date.now();
  const cached = joobleCache.get(cacheKey);
  if (cached && now - cached.timestamp < JOOBLE_CACHE_TTL_MS) {
    return cached.jobs;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`https://jooble.org/api/${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keywords: cleanKeywords,
        location: cleanLocation,
        page: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`Jooble HTTP ${res.status}`);
    const data = await res.json();
    const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];

    const normalized = rawJobs.map((item, idx) => {
      const cleanSnippet = stripHtml(item.snippet);
      const { amount, currency } = parseJoobleSalary(item.salary, item.location || cleanLocation);

      return {
        id: item.id || `jooble-${idx}-${Date.now()}`,
        title: item.title || 'Open Position',
        company: item.company || item.source || 'Verified Employer',
        location: item.location || cleanLocation,
        salary: amount,
        rawSalaryText: item.salary || '',
        currency,
        skills: cleanSnippet.slice(0, 180),
        snippet: cleanSnippet,
        applyUrl: item.link || '#',
        source: item.source || 'Jooble Live',
      };
    });

    if (normalized.length > 0) {
      joobleCache.set(cacheKey, { timestamp: now, jobs: normalized });
    }
    return normalized;
  } catch (err) {
    clearTimeout(timeout);
    console.error('Jooble API fallback triggered:', err.message);
    return null;
  }
}

function containsTerm(text, term) {
  const cleanTerm = term.trim().toLowerCase();
  if (!cleanTerm) return false;
  const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
  return regex.test(text);
}

function scoreLiveJobAgainstCV(job, resumeKeywords) {
  if (!resumeKeywords || resumeKeywords.length === 0) {
    return { matchScore: null, matchedSkills: [] };
  }

  const haystack = `${job.title} ${job.snippet || job.skills || ''} ${job.company || ''}`;
  const matched = resumeKeywords.filter((kw) => containsTerm(haystack, kw));

  const ratio = matched.length / Math.min(resumeKeywords.length, 8);
  const matchScore = Math.min(98, Math.max(45, Math.round(45 + ratio * 55)));

  return {
    matchScore,
    matchedSkills: matched.slice(0, 6).map((s) => s.toUpperCase()),
  };
}

async function filter(location = '', minSalary = 0, maxSalary = 10000000, cv = '', currency = 'MYR') {
  const { rates, source } = await getExchangeRates();
  const cvText = cv.trim();
  const targetCurrency = (currency || 'MYR').toUpperCase();
  const resumeKeywords = extractResumeKeywords(cvText);

  const searchQuery = resumeKeywords.slice(0, 3).join(' ') || 'Executive';
  const searchLocation = location.trim() || 'Malaysia';

  let jobs = await fetchLiveJoobleJobs(searchQuery, searchLocation);
  let isLiveFeed = true;

  if (!jobs || jobs.length === 0) {
    jobs = loadFallbackCSVJobs();
    isLiveFeed = false;
  }

  const results = [];

  for (const job of jobs) {
    if (!isLiveFeed && location.trim() && !job.location.toLowerCase().includes(location.trim().toLowerCase())) {
      continue;
    }

    const convertedSalary = convertSalary(job.salary, job.currency, targetCurrency, rates);

    if (minSalary > 0 && convertedSalary < minSalary) continue;
    if (convertedSalary > 0 && convertedSalary > maxSalary) continue;

    if (!cvText) {
      results.push({
        ...job,
        convertedSalary,
        displayCurrency: targetCurrency,
        rateSource: source,
        matchScore: null,
        matchedSkills: [],
      });
      continue;
    }

    const { matchScore, matchedSkills } = scoreLiveJobAgainstCV(job, resumeKeywords);
    results.push({
      ...job,
      convertedSalary,
      displayCurrency: targetCurrency,
      rateSource: source,
      matchScore,
      matchedSkills,
    });
  }

  if (cvText) {
    results.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  }

  return results;
}

module.exports = { filter };
