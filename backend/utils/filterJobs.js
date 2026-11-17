const FALLBACK_RATES = { USD: 1.0, MYR: 4.45, SGD: 1.34, EUR: 0.92, GBP: 0.79 };
const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cachedRates = null;
let lastFetchedAt = 0;

const JOOBLE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const joobleCache = new Map();

async function getExchangeRates() {
  const now = Date.now();
  if (cachedRates && now - lastFetchedAt < FX_CACHE_TTL_MS) return { rates: cachedRates, source: "24h-cache" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=MYR,SGD,EUR,GBP", { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error("FX HTTP " + res.status);
    const data = await res.json();
    cachedRates = { ...FALLBACK_RATES, ...(data.rates || {}), USD: 1.0 };
    lastFetchedAt = now;
    return { rates: cachedRates, source: "live-api" };
  } catch {
    clearTimeout(timeout);
    return { rates: cachedRates || FALLBACK_RATES, source: cachedRates ? "stale-cache" : "fallback" };
  }
}

function convertSalary(amount, fromCurrency, toCurrency, rates) {
  if (!amount || amount <= 0) return 0;
  const from = (fromCurrency || "USD").toUpperCase();
  const to = (toCurrency || "MYR").toUpperCase();
  return Math.round((amount / (rates[from] || 1.0)) * (rates[to] || 1.0));
}

// 1. Standard English grammar, calendar, location, and resume section headers ONLY
const STOP_WORDS = new Set([
  "the","and","for","with","from","that","this","have","has","had","are","was","were","been","being",
  "will","would","could","should","can","may","might","must","into","over","under","above","below",
  "between","through","during","before","after","each","other","such","only","same","than","too","very",
  "just","also","well","both","all","any","more","most","some","many","work","working","worked",
  "experience","experiences","years","year","month","months","present","current","currently","education",
  "university","college","degree","bachelor","master","diploma","certificate","certified","certification",
  "certifications","skills","competencies","proficiency","summary","profile","professional","references",
  "available","upon","request","email","phone","address","linkedin","github","gmail","com","january",
  "february","march","april","june","july","august","september","october","november","december",
  "malaysia","kuala","lumpur","selangor","singapore","remote","hybrid","full","part","time","sdn","bhd",
  "berhad","hons","cgpa","awarded","distinction","using","used","including","across","within","based",
  "new","high","key","strong","excellent","good","ability","proven","seasoned","results","driven",
  "seeking","challenging","decade","global","regional","apac","internal","external","various","multiple",
  "daily","weekly","monthly","ongoing","clear","concise","documented","effective","effectively","closely",
  "smoothly","properly","strict","strictly","complex","large","scale","level","tier","first","second",
  "end","ensure","ensuring","conduct","conducted","perform","performed","develop","developed","deliver",
  "delivered","drive","driving","oversee","spearhead","liaise","resolve","prepare","analyze","validate",
  "serve","contribute","leverage","navigate","align","evolving","existing","enhancing","overall"
]);

// 2. Generic corporate/role words: blocked as 1-word matches, but allowed to form 2-word phrases (e.g. "service desk", "data center")
const GENERIC_NOUNS = new Set([
  "management","manager","managers","managing","managed","lead","leading","leader","leadership","senior",
  "junior","specialist","specialists","analyst","analysts","associate","executive","officer","director",
  "head","supervisor","coordinator","consultant","advisor","engineer","engineering","technician","role",
  "roles","team","teams","company","organization","department","business","operations","operational",
  "support","supporting","supported","service","services","system","systems","process","processes",
  "project","projects","product","products","solution","solutions","application","applications",
  "enterprise","technology","technologies","technical","data","report","reports","reporting","client",
  "clients","customer","customers","stakeholder","stakeholders","vendor","vendors","quality","control",
  "performance","productivity","strategy","strategic","development","analysis","analytical","review",
  "reviews","training","coaching","monitoring","tracking","planning","delivery","transition","governance",
  "implementation","implementations","improvement","improvements","excellence","problem","problems",
  "solving","incident","incidents","release","change","request","ticket","tickets","backlog","backlogs",
  "desk","center","centre","production","environment","environments","policy","policies","guidelines",
  "procedures","requirements","standards","framework","model","tools","platforms","software","hardware",
  "risk","risks","assessment","testing","screening","onboarding","remediation","documentation","office",
  "suite","digital","literacy","thinking","attention","detail","privacy","core","history","background",
  "backgrounds","source","wealth","funds","research","entity","structures","hierarchies","ultimate",
  "beneficial","ratings","mitigation","strategies","programs","hires","members","capability","metrics",
  "effort","counts","optimize","resource","allocation","tasks","comprehensive","potential","findings",
  "recommending","summarizing","cases","case","workflow","forms","subject","matter","expert","sme",
  "due","anti","money","counter","enhanced","major","root","cause","periodic","bank","banking",
  "international","institute","association","science","sciences","human","financial","crime","legal"
]);

// 3. Universal soft-skill / boilerplate bigrams to ignore
const BOILERPLATE_BIGRAMS = new Set([
  "project management","stakeholder management","team leadership","problem solving","analytical thinking",
  "digital literacy","office suite","microsoft office","data privacy","privacy management","data analysis",
  "quality control","process improvement","process improvements","operational excellence","resource allocation",
  "performance metrics","performance feedback","training programs","system implementations","automation tools",
  "research tools","remediation projects","data remediation","mitigation strategies","risk ratings",
  "legal entity","entity structures","ownership hierarchies","ultimate beneficial","beneficial ownership",
  "periodic review","periodic reviews","review process","internal policies","operational standards"
]);

function stripEducationSection(cvText) {
  return (cvText || "").replace(
    /\b(?:EDUCATION|Education)\b[\s\S]{0,650}?(?=\b(?:CERTIFICATIONS|Certifications|SKILLS|Skills|COMPETENCIES|Competencies|TECHNICAL|Technical|LANGUAGES|Languages|PROJECTS|Projects)\b|$)/g,
    " "
  );
}

function buildResumeProfile(cvText) {
  if (!cvText || !cvText.trim()) {
    return { searchQueries: ["Executive"], skillKeywords: [], titleMatchers: [] };
  }

  const workingText = stripEducationSection(cvText);
  const totalWords = workingText.trim().split(/\s+/).length;
  const minCount = totalWords <= 120 ? 1 : 2;
  const clauses = workingText.toLowerCase().split(/[,.;:()\[\]\n\r•·|\/\\–—&]+/);

  const wordCounts = new Map();
  const bigramCounts = new Map();
  const unigramScores = new Map();
  const bigramScores = new Map();

  for (let cIdx = 0; cIdx < clauses.length; cIdx++) {
    const tokens = clauses[cIdx]
      .replace(/[^a-z0-9+#\s-]/g, " ")
      .replace(/-/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w));

    const boost = cIdx < 8 ? 2 : 1;

    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i];
      if (!STOP_WORDS.has(w)) {
        wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
        if (!GENERIC_NOUNS.has(w)) {
          unigramScores.set(w, (unigramScores.get(w) || 0) + boost);
        }
      }

      if (i < tokens.length - 1) {
        const w1 = tokens[i];
        const w2 = tokens[i + 1];
        if (STOP_WORDS.has(w1) || STOP_WORDS.has(w2) || w1 === w2) continue;
        const bigram = w1 + " " + w2;
        if (BOILERPLATE_BIGRAMS.has(bigram)) continue;

        const bothShortAcronyms = w1.length <= 4 && w2.length <= 4 && !GENERIC_NOUNS.has(w1) && !GENERIC_NOUNS.has(w2);
        if (bothShortAcronyms) continue;

        bigramCounts.set(bigram, (bigramCounts.get(bigram) || 0) + 1);
        bigramScores.set(bigram, (bigramScores.get(bigram) || 0) + boost);
      }
    }
  }

  const domainUnigrams = [...unigramScores.entries()]
    .filter(([w]) => (wordCounts.get(w) || 0) >= minCount)
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);

  const domainBigrams = [...bigramScores.entries()]
    .filter(([bg]) => {
      if ((bigramCounts.get(bg) || 0) >= minCount) return true;
      const [w1, w2] = bg.split(" ");
      return (wordCounts.get(w1) || 0) >= 2 && (wordCounts.get(w2) || 0) >= 2;
    })
    .sort((a, b) => b[1] - a[1])
    .map(([bg]) => bg);

  const searchQueries = [];
  const maxLen = Math.max(domainBigrams.length, domainUnigrams.length);
  for (let i = 0; i < maxLen; i++) {
    if (domainBigrams[i] && !searchQueries.includes(domainBigrams[i])) searchQueries.push(domainBigrams[i]);
    if (domainUnigrams[i] && !searchQueries.includes(domainUnigrams[i])) searchQueries.push(domainUnigrams[i]);
  }
  if (searchQueries.length === 0) searchQueries.push("Executive");

  const skillKeywords = [...new Set([...domainUnigrams, ...domainBigrams])].slice(0, 24);
  const titleMatchers = [...new Set([...domainUnigrams, ...domainBigrams])];

  return { searchQueries: searchQueries.slice(0, 8), skillKeywords, titleMatchers };
}

function extractResumeKeywords(cvText) {
  return buildResumeProfile(cvText).searchQueries;
}

function parseJoobleSalary(salaryStr, locationStr) {
  if (!salaryStr || typeof salaryStr !== "string") return { amount: 0, currency: "MYR" };
  const lower = salaryStr.toLowerCase();
  let currency = "USD";
  if (lower.includes("rm") || lower.includes("myr") || (locationStr || "").toLowerCase().includes("malaysia")) currency = "MYR";
  else if (lower.includes("s$") || lower.includes("sgd") || (locationStr || "").toLowerCase().includes("singapore")) currency = "SGD";
  else if (lower.includes("€") || lower.includes("eur")) currency = "EUR";
  else if (lower.includes("£") || lower.includes("gbp")) currency = "GBP";

  const nums = salaryStr.match(/\d[\d,.]*/g);
  if (!nums || nums.length === 0) return { amount: 0, currency };
  const parsedNums = nums.map((n) => Number(n.replace(/,/g, ""))).filter((n) => !isNaN(n) && n > 0);
  if (parsedNums.length === 0) return { amount: 0, currency };

  let avg = parsedNums.reduce((a, b) => a + b, 0) / parsedNums.length;
  if (lower.includes("hour") || lower.includes("/hr")) avg *= 160;
  else if (lower.includes("day") || lower.includes("/day")) avg *= 22;
  else if (lower.includes("year") || lower.includes("annum") || lower.includes("/yr") || avg > 45000) avg /= 12;
  return { amount: Math.round(avg), currency };
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function formatPostedAgo(updatedIso) {
  if (!updatedIso) return "Recent";
  const ts = Date.parse(updatedIso);
  if (isNaN(ts)) return "Recent";
  const diffHours = Math.max(1, Math.floor((Date.now() - ts) / (1000 * 60 * 60)));
  if (diffHours < 24) return diffHours + "h ago";
  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? "1d ago" : diffDays + "d ago";
}

async function resolveDirectApplyUrl(rawLink, title, company, location) {
  const cleanQuery = encodeURIComponent(title + " " + (company !== "Verified Employer" ? company : "") + " " + location.trim());
  const googleJobsFallback = "https://www.google.com/search?q=" + cleanQuery + "+jobs&ibp=htl;jobs";
  if (!rawLink || rawLink === "#") return { url: googleJobsFallback, isDirect: false };
  if (!rawLink.includes("jooble.org")) return { url: rawLink, isDirect: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(rawLink, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const locHeader = res.headers.get("location");
    if (locHeader && locHeader.startsWith("http") && !locHeader.includes("jooble.org")) return { url: locHeader, isDirect: true };
  } catch {
    clearTimeout(timeout);
  }
  return { url: googleJobsFallback, isDirect: false };
}

function deduplicateJobs(jobs) {
  const seen = new Map();
  for (const job of jobs) {
    const normTitle = (job.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const normCompany = (job.company || "").toLowerCase().replace(/\b(sdn|bhd|pte|ltd|inc|llc|corp|group|malaysia|singapore)\b/g, "").replace(/[^a-z0-9]/g, "");
    const key = normTitle + "|" + normCompany;
    if (!seen.has(key)) seen.set(key, job);
    else if (seen.get(key).salary === 0 && job.salary > 0) seen.set(key, job);
  }
  return Array.from(seen.values());
}

async function queryJoobleOnce(cleanKeywords, cleanLocation, apiKey) {
  const cacheKey = cleanKeywords.toLowerCase() + "|" + cleanLocation.toLowerCase();
  const now = Date.now();
  const cached = joobleCache.get(cacheKey);
  if (cached && now - cached.timestamp < JOOBLE_CACHE_TTL_MS) return cached.jobs;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://jooble.org/api/" + apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords: cleanKeywords, location: cleanLocation, page: 1 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error("Jooble HTTP " + res.status);
    const data = await res.json();
    const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];

    const dedupedRaw = deduplicateJobs(
      rawJobs.map((item, idx) => {
        const cleanSnippet = stripHtml(item.snippet);
        const { amount, currency } = parseJoobleSalary(item.salary, item.location || cleanLocation);
        const loc = item.location || cleanLocation;
        const title = item.title || "Open Position";
        const company = item.company || item.source || "Verified Employer";
        const linkedinSearchUrl = "https://www.linkedin.com/jobs/search/?keywords=" + encodeURIComponent(title + " " + company) + "&location=" + encodeURIComponent(loc);
        return {
          id: item.id || "jooble-" + idx + "-" + Date.now(),
          title,
          company,
          location: loc,
          salary: amount,
          rawSalaryText: item.salary || "",
          currency,
          skills: cleanSnippet.slice(0, 180),
          snippet: cleanSnippet,
          rawLink: item.link || "#",
          applyUrl: item.link || "#",
          apply_url: item.link || "#",
          linkedinSearchUrl,
          source: item.source || "Jooble Live",
          updatedAt: item.updated || null,
          postedAgo: formatPostedAgo(item.updated),
        };
      })
    );

    if (dedupedRaw.length > 0) joobleCache.set(cacheKey, { timestamp: now, jobs: dedupedRaw });
    return dedupedRaw;
  } catch (err) {
    clearTimeout(timeout);
    console.error("Jooble API error:", err.message);
    return [];
  }
}

async function fetchLiveJoobleJobs(searchQueries, location) {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) return [];
  const cleanLocation = (location || "Malaysia").trim();
  const queries = (searchQueries || []).slice(0, 8);
  if (queries.length === 0) queries.push("Executive");

  const responses = await Promise.all(queries.map((q) => queryJoobleOnce(q, cleanLocation, apiKey)));
  const combined = responses.flatMap((r) => r || []);
  return combined.length > 0 ? deduplicateJobs(combined) : [];
}

function matchesDateFilter(job, datePosted) {
  if (!datePosted || datePosted === "all" || !job.updatedAt) return true;
  const ts = Date.parse(job.updatedAt);
  if (isNaN(ts)) return true;
  const ageMs = Date.now() - ts;
  const dayMs = 24 * 60 * 60 * 1000;
  if (datePosted === "24h") return ageMs <= dayMs;
  if (datePosted === "7d") return ageMs <= 7 * dayMs;
  return true;
}

function containsTerm(text, term) {
  const cleanTerm = term.trim().toLowerCase();
  if (!cleanTerm) return false;
  const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^a-z0-9])" + escaped + "($|[^a-z0-9])", "i").test(text);
}

function scoreLiveJobAgainstCV(job, profileOrKeywords, cvText = "") {
  const profile = Array.isArray(profileOrKeywords)
    ? buildResumeProfile(cvText || profileOrKeywords.join(" "))
    : profileOrKeywords;

  const { skillKeywords, titleMatchers } = profile;
  if (!skillKeywords || skillKeywords.length === 0) return { matchScore: null, matchedSkills: [] };

  const titleLower = (job.title || "").toLowerCase();
  const snippetLower = (job.snippet || job.skills || "").toLowerCase();
  const haystack = titleLower + " " + snippetLower;

  // Universal Rule: The Job Title MUST contain at least one recurring domain term or 2-word role phrase from the resume
  const titleMatches = titleMatchers.filter((tm) => containsTerm(titleLower, tm));
  if (titleMatches.length === 0) {
    return { matchScore: 0, matchedSkills: [] };
  }

  const matched = skillKeywords.filter((kw) => containsTerm(haystack, kw));
  const badges = [...new Set([...titleMatches, ...matched])];
  const ratio = badges.length / Math.min(skillKeywords.length, 6);
  const matchScore = Math.min(98, Math.round(68 + ratio * 30));

  return {
    matchScore,
    matchedSkills: badges.slice(0, 6).map((s) => s.toUpperCase()),
  };
}

async function filter(location = "", minSalary = 0, maxSalary = 10000000, cv = "", currency = "MYR", datePosted = "7d") {
  const { rates, source } = await getExchangeRates();
  const cvText = cv.trim();
  const targetCurrency = (currency || "MYR").toUpperCase();
  const profile = buildResumeProfile(cvText);
  const searchLocation = location.trim() || "Malaysia";

  const jobs = await fetchLiveJoobleJobs(profile.searchQueries, searchLocation);

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

    const { matchScore, matchedSkills } = scoreLiveJobAgainstCV(job, profile, cvText);
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
  if (datePosted === "7d" && datedJobs.length === 0 && relevantJobs.length > 0) {
    datedJobs = relevantJobs;
    broadenedFrom7d = true;
  }

  if (cvText) datedJobs.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));

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

module.exports = { filter, extractResumeKeywords, buildResumeProfile, scoreLiveJobAgainstCV };