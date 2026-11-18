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
  if (!amt || amt <= 0) return 0;
  return Math.round((amt / (rates[(from || "USD").toUpperCase()] || 1)) * (rates[(to || "MYR").toUpperCase()] || 1));
}

async function askGemini(prompt, key) {
  if (!key) return null;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key.trim()
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) {
      console.error("Gemini HTTP Status:", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const d = await r.json();
    const parts = d?.candidates?.[0]?.content?.parts || [];
    const txt = parts.map((p) => p.text || "").join("\n").replace(/```json|```/gi, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) {
    console.error("Gemini fetch error:", e.message);
    return null;
  }
}

async function extractProfileWithAI(cv, key) {
  const ck = cv.slice(0, 250) + "|" + cv.length;
  if (aiCache.has(ck)) return aiCache.get(ck);
  const p = "Analyze this resume and return ONLY a valid JSON object (no markdown) with keys: \"primaryRole\" (short core profession title, e.g. \"IT Service Management & Operations Lead\" or \"AML / CDD Compliance Specialist\"), \"searchQueries\" (array of 6 specific job search strings/titles for this candidate), \"coreSkills\" (array of 12 domain-specific skills/acronyms from the resume, never generic words like Contract, Remote, Technology, or Data Center), \"excludedRoles\" (array of 10 unrelated career tracks to block, always including procurement, sourcing, marketing, sales, deal desk, hr, clinical, vendor onboarding unless that is the candidate primary profession). Resume: " + cv.slice(0, 3000);
  const res = await askGemini(p, key);
  if (res?.searchQueries?.length) {
    aiCache.set(ck, res);
    return res;
  }
  return null;
}

async function evaluateJobsWithAI(cv, aiProf, jobs, key) {
  if (!jobs?.length) return null;
  const batch = jobs.slice(0, 35);
  const excerpts = batch.map((j, index) => ({
    index,
    title: j.title,
    company: j.company,
    excerpt: (j.snippet || "").slice(0, 140)
  }));
  const p = "Candidate Role: " + (aiProf.primaryRole || "") + " | Core Skills: " + (aiProf.coreSkills || []).join(", ") + " | Resume Excerpt: " + cv.slice(0, 1000) + " | Reject any job from a different career track (strictly reject Procurement, Strategic Sourcing, Deal Desk, Marketing, Sales, HR, Clinical, Vendor Onboarding clerical, or Factory roles unless that is the candidate primaryRole). Return ONLY valid JSON: {\"matches\": [{\"index\": number, \"matchScore\": 70-98, \"matchedSkills\": [\"2-5 UPPERCASE SKILL BADGES\"]}]}. JOBS: " + JSON.stringify(excerpts);
  const res = await askGemini(p, key);
  if (!Array.isArray(res?.matches)) return null;
  return res.matches.filter((m) => batch[m.index]).map((m) => ({
    ...batch[m.index],
    matchScore: Math.min(98, Math.max(68, Number(m.matchScore) || 78)),
    matchedSkills: (m.matchedSkills || aiProf.coreSkills || []).slice(0, 5).map((s) => String(s).toUpperCase())
  }));
}

const ALL_EXCLUDED_ROLES = [
  "procurement", "strategic sourcing", "sourcing", "purchasing", "buyer", "merchandising",
  "marketing", "deal desk", "sales", "telesales", "account executive", "business development",
  "human resources", "recruiter", "talent acquisition", "payroll", "clinical", "nurse",
  "medical", "pharmacy", "vendor onboarding", "factory", "warehouse", "driver",
  "receptionist", "cashier", "retail", "audit", "tax", "accounts payable", "accounts receivable", "bookkeeper"
];

const STOP = new Set(["the","and","for","with","from","that","this","have","has","had","are","was","were","will","would","could","should","into","over","under","between","through","during","before","after","work","working","worked","experience","experiences","years","year","month","months","present","current","currently","education","university","college","degree","bachelor","master","diploma","certificate","certified","certification","certifications","skills","competencies","proficiency","summary","profile","professional","email","phone","address","linkedin","gmail","com","malaysia","kuala","lumpur","selangor","singapore","puchong","remote","hybrid","onsite","contract","contracts","contractor","permanent","full","part","time","sdn","bhd","berhad","inc","ltd","using","used","including","across","within","based","new","high","key","strong","excellent","good","ability","proven","results","driven","global","regional","apac","internal","external","various","multiple","daily","weekly","monthly","ongoing","effective","complex","large","scale","level","tier","first","second","end","ensure","ensuring","conduct","conducted","perform","performed","develop","deliver","drive","oversee","spearhead","liaise","resolve","prepare","analyze","validate","serve","contribute","leverage","navigate","align","overall","frontline","account","countries","netherlands","technology","technologies","data","system","systems","process","processes","business","company","organization","department","team","teams","role","roles","client","clients","customer","customers","stakeholder","stakeholders","vendor","vendors","report","reports","reporting","review","reviews","policy","policies","standard","standards","center","centre","desk","office","suite","digital","literacy","science","administration"]);

const GENERIC_TITLES = new Set(["manager","management","lead","leader","leadership","senior","junior","specialist","specialists","analyst","analysts","associate","executive","officer","director","head","supervisor","coordinator","consultant","advisor","engineer","operations","operational","service","services","support","project","projects","product","products","application","applications","enterprise","technical","governance","delivery","transition","compliance","risk","financial","banking","bank"]);

function buildProfile(cvText) {
  const clean = (cvText || "").replace(/\b(?:EDUCATION|Education)\b[\s\S]{0,600}?(?=\b(?:CERTIFICATIONS|Certifications|SKILLS|Skills|COMPETENCIES|Competencies|TECHNICAL|Technical|LANGUAGES|Languages)\b|$)/g, " ");
  const headerSample = clean.slice(0, 600).toLowerCase();
  const excludedRoles = ALL_EXCLUDED_ROLES.filter((r) => !headerSample.includes(r));

  const clauses = clean.split(/[,.;:()\[\]\n\r•·|\/\\–—&]+/);
  const wc = new Map(), bc = new Map(), scoreMap = new Map(), phraseScore = new Map();

  for (let c = 0; c < clauses.length; c++) {
    const hasLow = /[a-z]/.test(clauses[c]);
    const toks = clauses[c].replace(/[^A-Za-z0-9+#\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
    const boost = c < 10 ? 3 : 1;
    for (let i = 0; i < toks.length; i++) {
      const rw = toks[i], w = rw.toLowerCase();
      if (STOP.has(w) || excludedRoles.includes(w)) continue;
      wc.set(w, (wc.get(w) || 0) + 1);
      const isAcro = (hasLow && /^[A-Z]{2,6}$/.test(rw)) || /^[A-Z][a-z]+[A-Z][A-Za-z0-9]*$/.test(rw) || /^(itsm|itil|servicenow|dynatrace|citrix|aml|cdd|kyc|edd|sanctions|sla|cmdb|siem|soc|devops|aws|azure|sap|sql|python|java|react)$/i.test(w);
      if (!GENERIC_TITLES.has(w) || isAcro) {
        scoreMap.set(w, (scoreMap.get(w) || 0) + boost + (isAcro ? 5 : 0));
      }
      if (i < toks.length - 1) {
        const w2 = toks[i + 1].toLowerCase();
        if (STOP.has(w2) || w === w2) continue;
        const bg = w + " " + w2;
        if (excludedRoles.some((ex) => bg.includes(ex))) continue;
        bc.set(bg, (bc.get(bg) || 0) + 1);
        phraseScore.set(bg, (phraseScore.get(bg) || 0) + boost + (GENERIC_TITLES.has(w) || GENERIC_TITLES.has(w2) ? 2 : 1));
      }
    }
  }

  const specificTerms = [...scoreMap.entries()].filter(([w, s]) => (wc.get(w) || 0) >= 2 || s >= 5).sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 20);
  const rolePhrases = [...phraseScore.entries()].filter(([bg, s]) => (bc.get(bg) || 0) >= 2 || s >= 5).sort((a, b) => b[1] - a[1]).map(([bg]) => bg).slice(0, 20);
  const roleWords = [...wc.keys()].filter((w) => GENERIC_TITLES.has(w) && (wc.get(w) || 0) >= 2);

  const queries = [];
  for (let i = 0; i < 8; i++) {
    if (rolePhrases[i] && queries.length < 8) queries.push(rolePhrases[i]);
    if (specificTerms[i] && queries.length < 8) queries.push(specificTerms[i]);
  }
  return { queries: queries.length ? queries : ["Operations Manager"], specificTerms, rolePhrases, roleWords, excludedRoles };
}

function hasTerm(txt, term) {
  const esc = String(term || "").trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return esc ? new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])", "i").test(txt) : false;
}

function isRoleMatch(job, prof) {
  const fullTitle = (job.title || "").toLowerCase();
  const cleanTitle = fullTitle.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  const primaryTitlePart = cleanTitle.split(/\s+[-–—]\s+/)[0];
  const snippet = (job.snippet || job.skills || "").toLowerCase();

  for (const ex of prof.excludedRoles) {
    if (hasTerm(cleanTitle, ex)) return { match: false, matchScore: 0, matchedSkills: [] };
  }

  const titlePhraseHits = prof.rolePhrases.filter((p) => hasTerm(primaryTitlePart, p));
  const titleSpecHits = prof.specificTerms.filter((t) => hasTerm(primaryTitlePart, t));
  const titleRoleHits = prof.roleWords.filter((w) => hasTerm(primaryTitlePart, w));

  const snipPhraseHits = prof.rolePhrases.filter((p) => hasTerm(snippet, p));
  const snipSpecHits = prof.specificTerms.filter((t) => hasTerm(snippet, t));

  const hasDirectTitleMatch = titlePhraseHits.length > 0 || titleSpecHits.length > 0;
  const hasContextualRoleMatch = titleRoleHits.length >= 1 && (snipSpecHits.length >= 1 || snipPhraseHits.length >= 1 || titleRoleHits.length >= 2);

  if (!hasDirectTitleMatch && !hasContextualRoleMatch) {
    return { match: false, matchScore: 0, matchedSkills: [] };
  }

  const badges = [...new Set([...titleSpecHits, ...titlePhraseHits, ...snipSpecHits, ...snipPhraseHits, ...titleRoleHits])]
    .slice(0, 5)
    .map((s) => s.toUpperCase());

  const rawPoints = titleSpecHits.length * 10 + titlePhraseHits.length * 10 + snipSpecHits.length * 5 + snipPhraseHits.length * 4 + titleRoleHits.length * 3;
  const matchScore = Math.min(98, Math.max(70, 68 + rawPoints));
  return { match: true, matchScore, matchedSkills: badges };
}

function parseSal(s, loc) {
  if (!s || typeof s !== "string") return { amount: 0, currency: "MYR" };
  const l = s.toLowerCase(), lc = (loc || "").toLowerCase();
  const currency = l.includes("rm") || l.includes("myr") || lc.includes("malaysia") ? "MYR" : l.includes("s$") || l.includes("sgd") || lc.includes("singapore") ? "SGD" : l.includes("eur") ? "EUR" : l.includes("gbp") ? "GBP" : "USD";
  const nums = (s.match(/\d[\d,.]*/g) || []).map((n) => Number(n.replace(/,/g, ""))).filter((n) => n > 0);
  if (!nums.length) return { amount: 0, currency };
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
    if (!seen.has(k) || (seen.get(k).salary === 0 && j.salary > 0)) seen.set(k, j);
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
  if (!dp || dp === "all" || !j.updatedAt) return true;
  const ts = Date.parse(j.updatedAt);
  if (isNaN(ts)) return true;
  const age = Date.now() - ts;
  return dp === "24h" ? age <= 86400000 : dp === "7d" ? age <= 604800000 : true;
}

async function filter(location = "", minSalary = 0, maxSalary = 10000000, cv = "", currency = "MYR", datePosted = "7d") {
  const { rates, source } = await getRates();
  const cvText = (cv || "").trim(), cur = (currency || "MYR").toUpperCase(), loc = (location || "").trim() || "Malaysia";
  const gKey = process.env.GEMINI_API_KEY, jKey = process.env.JOOBLE_API_KEY;
  if (!jKey) return [];

  const fbProf = buildProfile(cvText);
  const aiProf = cvText && gKey ? await extractProfileWithAI(cvText, gKey) : null;
  const queries = (aiProf?.searchQueries || fbProf.queries || ["Operations Manager"]).slice(0, 8);
  const raw = dedup((await Promise.all(queries.map((q) => queryJooble(q, loc, jKey)))).flat());

  const salJobs = raw.map((j) => ({ ...j, convertedSalary: convSal(j.salary, j.currency, cur, rates), displayCurrency: cur, rateSource: source }))
    .filter((j) => j.convertedSalary === 0 || (j.convertedSalary >= minSalary && j.convertedSalary <= maxSalary));

  salJobs.sort((a, b) => (dateOk(b, "7d") ? 1 : 0) - (dateOk(a, "7d") ? 1 : 0));

  let rel = [];
  if (!cvText) {
    rel = salJobs.map((j) => ({ ...j, matchScore: null, matchedSkills: [] }));
  } else {
    const preFiltered = salJobs.filter((j) => {
      const cleanTitle = (j.title || "").toLowerCase();
      return !fbProf.excludedRoles.some((ex) => hasTerm(cleanTitle, ex));
    });
    const aiMatches = aiProf && gKey ? await evaluateJobsWithAI(cvText, aiProf, preFiltered, gKey) : null;
    if (aiMatches && aiMatches.length > 0) {
      rel = aiMatches;
    } else {
      rel = preFiltered.map((j) => ({ ...j, ...isRoleMatch(j, fbProf) })).filter((j) => j.match);
    }
  }

  let dated = rel.filter((j) => dateOk(j, datePosted));
  let broadenedFrom7d = false;
  if (datePosted === "7d" && dated.length < 5 && rel.length > dated.length) {
    dated = rel;
    broadenedFrom7d = true;
  }
  if (cvText) dated.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  return dated.slice(0, 25).map((j) => ({ ...j, broadenedFrom7d }));
}

module.exports = { filter, extractProfileWithAI, evaluateJobsWithAI, buildProfile, isRoleMatch };
