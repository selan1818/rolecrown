const RATES = { USD: 1, MYR: 4.45, SGD: 1.34, EUR: 0.92, GBP: 0.79 };
let fxCache = null, fxTs = 0;
const joobleCache = new Map(), aiCache = new Map();

async function getRates() {
  if (fxCache && Date.now() - fxTs < 86400000) return { rates: fxCache, source: "24h-cache" };
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=MYR,SGD,EUR,GBP", { signal: AbortSignal.timeout(4000) });
    const d = await r.json();
    fxCache = { ...RATES, ...(d.rates || {}), USD: 1 };
    fxTs = Date.now();
    return { rates: fxCache, source: "live-api" };
  } catch { return { rates: fxCache || RATES, source: "fallback" }; }
}

function convSal(amt, from, to, rates) {
  if ((amt || 0) <= 0) return 0;
  return Math.round((amt / (rates[(from || "USD").toUpperCase()] || 1)) * (rates[(to || "MYR").toUpperCase()] || 1));
}

async function askGemini(prompt, key) {
  if (Boolean(key) === false) return null;
  const cleanKey = key.trim();
  const models = ["gemini-3.0-flash", "gemini-flash-latest"];
  for (const model of models) {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": cleanKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } }),
        signal: AbortSignal.timeout(20000)
      });
      if (r.ok === false) {
        console.error("Gemini " + model + " HTTP " + r.status + ":", (await r.text()).slice(0, 200));
        continue;
      }
      const d = await r.json();
      const parts = d?.candidates?.[0]?.content?.parts || [];
      const txt = parts.map((p) => p.text || "").join("\n").replace(/\`\`\`json|\`\`\`/gi, "").trim();
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
    } catch (e) { console.error("Gemini " + model + " error:", e.message); }
  }
  return null;
}

async function extractProfileWithAI(cv, key) {
  const ck = cv.slice(0, 300) + "|" + cv.length;
  if (aiCache.has(ck)) return aiCache.get(ck);
  const prompt = "You are an expert executive technical recruiter. Read this candidate resume carefully.\nReturn ONLY a valid JSON object (no markdown) with this exact structure:\n{\"primaryRole\": \"1-sentence description of the candidate exact profession, seniority, and domain\", \"searchQueries\": [\"6 specific job title search strings to find matching jobs on a job board for this candidate\"], \"coreSkills\": [\"10 specific technical/domain skills, tools, frameworks, or certifications from this resume\"]}\n\nResume:\n" + cv.slice(0, 4000);
  const res = await askGemini(prompt, key);
  if (res?.searchQueries?.length) { aiCache.set(ck, res); return res; }
  return null;
}

async function evaluateJobsWithAI(cv, aiProf, jobs, key) {
  if ((jobs?.length || 0) === 0) return [];
  const batch = jobs.slice(0, 40);
  const jobList = batch.map((j, index) => ({ index, title: j.title, company: j.company, snippet: (j.snippet || "").slice(0, 180) }));
  const prompt = "You are an expert recruiter matching a candidate to live job listings.\nCandidate Profile: " + aiProf.primaryRole + "\nCandidate Core Skills: " + (aiProf.coreSkills || []).join(", ") + "\nCandidate Resume Excerpt: " + cv.slice(0, 1500) + "\nTask:\n1. SELECT ONLY jobs that genuinely belong to the candidate profession and career track.\n2. STRICTLY REJECT jobs from unrelated professions (e.g. if candidate is in IT Service Management or AML Compliance, reject Procurement, Sourcing, Financial Accountant, Bookkeeping, Marketing, Sales, HR, Clinical, or Factory roles).\n3. For each selected job, provide matchScore (70 to 98) and 2 to 5 specific domain matchedSkills (never generic words like SENIOR or FINANCIAL alone).\nReturn ONLY valid JSON: {\"matches\": [{\"index\": 0, \"matchScore\": 88, \"matchedSkills\": [\"SKILL 1\", \"SKILL 2\"]}]}\nJob Listings:\n" + JSON.stringify(jobList);
  const res = await askGemini(prompt, key);
  if (Array.isArray(res?.matches) === false) return [];
  return res.matches.filter((m) => Boolean(batch[m.index])).map((m) => ({
    ...batch[m.index],
    matchScore: Math.min(98, Math.max(70, Number(m.matchScore) || 80)),
    matchedSkills: (Array.isArray(m.matchedSkills) && m.matchedSkills.length ? m.matchedSkills : (aiProf.coreSkills || []).slice(0, 4)).slice(0, 5).map((s) => String(s).toUpperCase())
  }));
}

function parseSal(s, loc) {
  if (typeof s !== "string" || s.length === 0) return { amount: 0, currency: "MYR" };
  const l = s.toLowerCase(), lc = (loc || "").toLowerCase();
  const currency = l.includes("rm") || l.includes("myr") || lc.includes("malaysia") ? "MYR" : l.includes("s$") || l.includes("sgd") || lc.includes("singapore") ? "SGD" : l.includes("eur") ? "EUR" : l.includes("gbp") ? "GBP" : "USD";
  const nums = (s.match(/\d[\d,.]*/g) || []).map((n) => Number(n.replace(/,/g, ""))).filter((n) => n > 0);
  if (nums.length === 0) return { amount: 0, currency };
  let avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (l.includes("hour") || l.includes("/hr")) avg *= 160;
  else if (l.includes("day") || l.includes("/day")) avg *= 22;
  else if (l.includes("year") || l.includes("annum") || l.includes("/yr") || avg > 45000) avg /= 12;
  return { amount: Math.round(avg), currency };
}

function ago(iso) {
  const ts = Date.parse(iso || "");
  if (isNaN(ts)) return "Recent";
  const h = Math.max(1, Math.floor((Date.now() - ts) / 3600000));
  return h < 24 ? h + "h ago" : Math.floor(h / 24) + "d ago";
}

function dedup(jobs) {
  const seen = new Map();
  for (const j of jobs) {
    const k = (j.title || "").toLowerCase().replace(/[^a-z0-9]/g, "") + "|" + (j.company || "").toLowerCase().replace(/\b(sdn|bhd|pte|ltd|inc|llc|corp|group|malaysia|singapore)\b/g, "").replace(/[^a-z0-9]/g, "");
    if (seen.has(k) === false || (seen.get(k).salary === 0 && j.salary > 0)) seen.set(k, j);
  }
  return [...seen.values()];
}

async function queryJooble(keywords, location, key) {
  const ck = keywords.toLowerCase() + "|" + location.toLowerCase();
  const c = joobleCache.get(ck);
  if (c && Date.now() - c.ts < 21600000) return c.jobs;
  try {
    const r = await fetch("https://jooble.org/api/" + key.trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords, location, page: 1 }),
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    const jobs = dedup((d.jobs || []).map((it, i) => {
      const snip = (it.snippet || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
      const loc = it.location || location, title = it.title || "Open Position", company = it.company || it.source || "Verified Employer";
      const { amount, currency } = parseSal(it.salary, loc);
      return {
        id: it.id || "jb-" + i + "-" + Date.now(), title, company, location: loc, salary: amount, rawSalaryText: it.salary || "", currency,
        skills: snip.slice(0, 180), snippet: snip, rawLink: it.link || "#", applyUrl: it.link || "#", apply_url: it.link || "#",
        linkedinSearchUrl: "https://www.linkedin.com/jobs/search/?keywords=" + encodeURIComponent(title + " " + company) + "&location=" + encodeURIComponent(loc),
        source: it.source || "Jooble Live", updatedAt: it.updated || null, postedAgo: ago(it.updated)
      };
    }));
    if (jobs.length) joobleCache.set(ck, { ts: Date.now(), jobs });
    return jobs;
  } catch { return []; }
}

function dateOk(j, dp) {
  if (Boolean(dp) === false || dp === "all" || Boolean(j.updatedAt) === false) return true;
  const ts = Date.parse(j.updatedAt);
  if (isNaN(ts)) return true;
  const age = Date.now() - ts;
  return dp === "24h" ? age <= 86400000 : dp === "7d" ? age <= 604800000 : true;
}

async function filter(location = "", minSalary = 0, maxSalary = 10000000, cv = "", currency = "MYR", datePosted = "7d") {
  const { rates, source } = await getRates();
  const cvText = (cv || "").trim(), cur = (currency || "MYR").toUpperCase(), loc = (location || "").trim() || "Malaysia";
  const gKey = process.env.GEMINI_API_KEY, jKey = process.env.JOOBLE_API_KEY;
  if (Boolean(jKey) === false) return [];
  if (Boolean(cvText) === false) {
    const raw = await queryJooble("Manager", loc, jKey);
    return raw.slice(0, 25).map((j) => ({ ...j, convertedSalary: convSal(j.salary, j.currency, cur, rates), displayCurrency: cur, rateSource: source, matchScore: null, matchedSkills: [] }));
  }
  const aiProf = await extractProfileWithAI(cvText, gKey);
  if (Boolean(aiProf) === false || Boolean(aiProf.searchQueries?.length) === false) return [];
  const queries = aiProf.searchQueries.slice(0, 6);
  const raw = dedup((await Promise.all(queries.map((q) => queryJooble(q, loc, jKey)))).flat());
  const salJobs = raw.map((j) => ({ ...j, convertedSalary: convSal(j.salary, j.currency, cur, rates), displayCurrency: cur, rateSource: source }))
    .filter((j) => j.convertedSalary === 0 || (j.convertedSalary >= minSalary && j.convertedSalary <= maxSalary));
  salJobs.sort((a, b) => (dateOk(b, "7d") ? 1 : 0) - (dateOk(a, "7d") ? 1 : 0));
  const rel = await evaluateJobsWithAI(cvText, aiProf, salJobs, gKey);
  let dated = rel.filter((j) => dateOk(j, datePosted));
  let broadenedFrom7d = false;
  if (datePosted === "7d" && dated.length < 5 && rel.length > dated.length) { dated = rel; broadenedFrom7d = true; }
  dated.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  return dated.slice(0, 25).map((j) => ({ ...j, broadenedFrom7d }));
}

module.exports = { filter, extractProfileWithAI, evaluateJobsWithAI };
