const fs = require('fs');
const path = require('path');

const FALLBACK_RATES = {
  USD: 1.0,
  MYR: 4.45,
  SGD: 1.34,
  EUR: 0.92,
  GBP: 0.79,
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cachedRates = null;
let lastFetchedAt = 0;

async function getExchangeRates() {
  const now = Date.now();
  if (cachedRates && now - lastFetchedAt < CACHE_TTL_MS) {
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

function loadJobs() {
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
}

function containsTerm(text, term) {
  const cleanTerm = term.trim().toLowerCase();
  if (!cleanTerm) return false;
  const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
  return regex.test(text);
}

function scoreJobAgainstCV(job, cvText) {
  const skillList = job.skills.split(',').map((s) => s.trim()).filter(Boolean);
  const matchedSkills = skillList.filter((skill) => containsTerm(cvText, skill));

  const stopWords = new Set(['and', 'or', 'the', 'for', 'of', 'in', 'to', 'a', 'an', '-']);
  const titleWords = job.title
    .toLowerCase()
    .split(/[\s,/()-]+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
  const matchedTitleWords = titleWords.filter((word) => containsTerm(cvText, word));

  const skillRatio = skillList.length > 0 ? matchedSkills.length / skillList.length : 0;
  const titleRatio = titleWords.length > 0 ? matchedTitleWords.length / titleWords.length : 0;
  const matchScore = Math.round((skillRatio * 0.8 + titleRatio * 0.2) * 100);

  return { matchScore, matchedSkills };
}

async function filter(location = '', minSalary = 0, maxSalary = 10000000, cv = '', currency = 'MYR') {
  const jobs = loadJobs();
  const { rates, source } = await getExchangeRates();
  const locQuery = location.trim().toLowerCase();
  const cvText = cv.trim();
  const targetCurrency = (currency || 'MYR').toUpperCase();
  const results = [];

  for (const job of jobs) {
    if (locQuery && !job.location.toLowerCase().includes(locQuery)) continue;

    const convertedSalary = convertSalary(job.salary, job.currency, targetCurrency, rates);
    if (convertedSalary < minSalary || convertedSalary > maxSalary) continue;

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

    const { matchScore, matchedSkills } = scoreJobAgainstCV(job, cvText);
    if (matchedSkills.length > 0 || matchScore >= 15) {
      results.push({
        ...job,
        convertedSalary,
        displayCurrency: targetCurrency,
        rateSource: source,
        matchScore,
        matchedSkills,
      });
    }
  }

  if (cvText) {
    results.sort((a, b) => b.matchScore - a.matchScore);
  }

  return results;
}

module.exports = { filter };
