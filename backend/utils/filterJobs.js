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
      headers: { "Content-Type": "application/json", "X-goog-api-key": key.trim() },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
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
    console.error("Gemini error:", e.message);
    return null;
  }
}

async function extractProfileWithAI(cv, key) {
  const ck = cv.slice(0, 250) + "|" + cv.length;
  if (aiCache.has(ck)) return aiCache.get(ck);
  const p = "Return ONLY a valid JSON object (no markdown) with keys: \"primaryRole\" (1-sentence summary of candidate core profession), \"searchQueries\" (array of 6 strings: 4 job titles and 2 domain acronyms for this candidate), \"coreSkills\" (array of 12 domain skills/tools, never Contract, Remote, Technology, or Data Center unless primary profession). Resume: " + cv.slice(0, 3000);
  const res = await askGemini(p, key);
  if (res?.searchQueries?.length) { aiCache.set(ck, res); return res; }
  return null;
}

async function evaluateJobsWithAI(cv, prof, jobs, key) {
  if (!jobs?.length) return null;
  const batch = jobs.slice(0, 35);
  const list = batch.map((j, index) => ({ index, title: j.title, company: j.company, snippet: (j.snippet || "").slice(0, 160) }));
  const p = "Candidate Role: " + (prof.primaryRole || "") + ". Skills: " + (prof.coreSkills || []).join(", ") + ". Reject any job from a different career track (reject Procurement, Sourcing, Deal Desk, Marketing, Sales, HR, Clinical, Vendor Onboarding clerical, or Factory roles unless that is the candidate primary profession). Return ONLY JSON: {\"matches\": [{\"index\": number, \"matchScore\": 68-98, \"matchedSkills\": [\"2-5 UPPERCASE SKILL BADGES\"]}]}. Jobs: " + JSON.stringify(list);
  const res = await askGemini(p, key);
  if (!Array.isArray(res?.matches)) return null;
  return res.matches.filter((m) => batch[m.index]).map((m) => ({
    ...batch[m.index],
    matchScore: Math.min(98, Math.max(65, Number(m.matchScore) || 75)),
    matchedSkills: (m.matchedSkills || prof.coreSkills || []).slice(0, 5).map((s) => String(s).toUpperCase())
  }));
}

const STOP = new Set(["the","and","for","with","from","that","this","have","has","had","are","was","were","will","would","could","should","into","over","under","between","through","during","before","after","work","working","worked","experience","experiences","years","year","month","months","present","current","currently","education","university","college","degree","bachelor","master","diploma","certificate","certified","certification","certifications","skills","competencies","proficiency","summary","profile","professional","email","phone","address","linkedin","gmail","com","malaysia","kuala","lumpur","selangor","singapore","puchong","remote","hybrid","onsite","contract","contracts","contractor","permanent","full","part","time","sdn","bhd","berhad","inc","ltd","using","used","including","across","within","based","new","high","key","strong","excellent","good","ability","proven","results","driven","global","regional","apac","internal","external","various","multiple","daily","weekly","monthly","ongoing","effective","complex","large","scale","level","tier","first","second","end","ensure","ensuring","conduct","conducted","perform","performed","develop","deliver","drive","oversee","spearhead","liaise","resolve","prepare","analyze","validate","serve","contribute","leverage","navigate","align","overall","frontline","account","countries","netherlands","candidate","candidacy","interview","hiring","proposal","proposals"]);
const VAGUE = new Set(["management","manager","managers","managing","managed","lead","leading","leader","leadership","senior","junior","specialist","specialists","analyst","analysts","associate","executive","officer","director","head","supervisor","coordinator","consultant","advisor","engineer","engineering","technician","representative","role","roles","team","teams","company","organization","department","business","operations","operational","support","supporting","service","services","system","systems","process","processes","project","projects","product","products","solution","solutions","application","applications","enterprise","technology","technologies","technical","data","report","reports","reporting","client","clients","customer","customers","stakeholder","stakeholders","vendor","vendors","quality","control","performance","productivity","strategy","strategic","development","analysis","analytical","review","reviews","training","coaching","monitoring","tracking","planning","delivery","implementation","implementations","improvement","improvements","excellence","problem","problems","solving","request","ticket","tickets","backlog","backlogs","desk","center","centre","production","environment","policy","policies","guidelines","procedures","requirements","standards","framework","model","tools","platforms","software","hardware","risk","risks","assessment","testing","remediation","documentation","office","suite","digital","literacy","thinking","attention","detail","privacy","core","history","background","backgrounds","source","wealth","funds","research","entity","structures","hierarchies","ultimate","beneficial","ratings","mitigation","strategies","programs","capability","metrics","resource","allocation","tasks","comprehensive","potential","findings","cases","case","workflow","forms","subject","matter","expert","due","anti","money","counter","enhanced","major","root","cause","periodic","bank","banking","international","institute","association","science","human","financial","crime","legal","adherence","landscapes","stability","routing","queue","shift","agreements","budget","cost","escalation","timelines","priorities","adverse","media","politically","exposed","persons","terrorist","financing","laundering","negara","allianz","petronas","standard","chartered","agtien","procurement","sourcing","marketing","sales"]);
const BOILER = new Set(["project management","stakeholder management","team leadership","problem solving","analytical thinking","digital literacy","office suite","microsoft office","data privacy","privacy management","data analysis","quality control","process improvement","process improvements","operational excellence","resource allocation","performance metrics","training programs","system implementations","automation tools","research tools","remediation projects","data remediation","mitigation strategies","risk ratings","legal entity","entity structures","ownership hierarchies","ultimate beneficial","beneficial ownership","periodic review","periodic reviews","review process","internal policies","operational standards","politically exposed","exposed persons","adverse media","counter terrorist","terrorist financing","money laundering","anti money","bank negara","science technology","business administration","business owner","delivery center","data center","ticket backlogs","repeat incidents"]);

function buildFallbackProfile(cvText) {
  const clean = (cvText || "").replace(/\b(?:EDUCATION|Education)\b[\s\S]{0,650}?(?=\b(?:CERTIFICATIONS|Certifications|SKILLS|Skills|COMPETENCIES|Competencies|TECHNICAL|Technical|LANGUAGES|Languages)\b|$)/g, " ");
  const minC = clean.trim().split(/\s+/).length <= 120 ? 1 : 2;
  const clauses = clean.split(/[,.;:()\[\]\n\r•·|\/\\–—&]+/);
  const wc = new Map(), bc = new Map(), us = new Map(), bs = new Map();
  for (let c = 0; c < clauses.length; c++) {
    const hasLow = /[a-z]/.test(clauses[c]);
    const toks = clauses[c].replace(/[^A-Za-z0-9+#\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
    const boost = c < 8 ? 2 : 1;
    for (let i = 0; i < toks.length; i++) {
      const rw = toks[i], w = rw.toLowerCase();
      if (STOP.has(w)) continue;
      wc.set(w, (wc.get(w) || 0) + 1);
      const isAcro = hasLow && (/^[A-Z]{2,6}$/.test(rw) || /^[A-Z][a-z]+[A-Z][A-Za-z0-9]*$/.test(rw));
      if (!VAGUE.has(w) || isAcro) us.set(w, (us.get(w) || 0) + boost + (isAcro ? 3 : 0));
      if (i < toks.length - 1) {
        const w2 = toks[i + 1].toLowerCase();
        if (STOP.has(w2) || w === w2) continue;
        const bg = w + " " + w2;
        if (BOILER.has(bg) || (w.length <= 4 && w2.length <= 4 && !VAGUE.has(w) && !VAGUE.has(w2))) continue;
        bc.set(bg, (bc.get(bg) || 0) + 1);
        bs.set(bg, (bs.get(bg) || 0) + boost);
      }
    }
  }
  const uni = [...us.entries()].filter(([w, s]) => (wc.get(w) || 0) >= minC || s >= 4).sort((a, b) => b[1] - a[1]).map(([w]) => w);
  const bi = [...bs.entries()].filter(([bg]) => (bc.get(bg) || 0) >= minC).sort((a, b) => b[1] - a[1]).map(([bg]) => bg);
  const q = [];
  for (let i = 0; i < Math.max(bi.length, uni.length); i++) {
    if (bi[i] && !q.includes(bi[i])) q.push(bi[i]);
    if (uni[i] && !q.includes(uni[i])) q.push(uni[i]);
  }
  const matchers = [...new Set([...uni, ...bi])].slice(0, 24);
  return { searchQueries: q.length ? q.slice(0, 8) : ["Executive"], matchers };
}

function hasTerm(txt, term) {
  const esc = term.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return esc ? new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])", "i").test(txt) : false;
}

function scoreFallback(job, fbProf) {
  const roleBeforeHyphen = (job.title || "").split(/\s+[-–—]\s+/)[0].replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ").toLowerCase();
  if (/\b(procurement|sourcing|purchasing|buyer|marketing|deal desk|sales|telesales|vendor onboarding|clinical|nurse|factory|production quality)\b/i.test(roleBeforeHyphen)) {
    return { matchScore: 0, matchedSkills: [] };
  }
  const tHits = fbProf.matchers.filter((m) => hasTerm(roleBeforeHyphen, m));
  if (!tHits.length) return { matchScore: 0, matchedSkills: [] };
  const hay = roleBeforeHyphen + " " + (job.snippet || "").toLowerCase();
  const allHits = [...new Set([...tHits, ...fbProf.matchers.filter((m) => hasTerm(hay, m))])];
  return { matchScore: Math.min(98, Math.round(70 + (allHits.length / 6) * 28)), matchedSkills: allHits.slice(0, 5).map((s) => s.toUpperCase()) };
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

  const fbProf = buildFallbackProfile(cvText);
  const aiProf = cvText && gKey ? await extractProfileWithAI(cvText, gKey) : null;
  const queries = (aiProf?.searchQueries || fbProf.searchQueries || ["Executive"]).slice(0, 8);
  const raw = dedup((await Promise.all(queries.map((q) => queryJooble(q, loc, jKey)))).flat());

  const salJobs = raw.map((j) => ({ ...j, convertedSalary: convSal(j.salary, j.currency, cur, rates), displayCurrency: cur, rateSource: source }))
    .filter((j) => j.convertedSalary === 0 || (j.convertedSalary >= minSalary && j.convertedSalary <= maxSalary));

  salJobs.sort((a, b) => (dateOk(b, "7d") ? 1 : 0) - (dateOk(a, "7d") ? 1 : 0));

  let rel = [];
  if (!cvText) {
    rel = salJobs.map((j) => ({ ...j, matchScore: null, matchedSkills: [] }));
  } else {
    const aiMatches = aiProf && gKey ? await evaluateJobsWithAI(cvText, aiProf, salJobs, gKey) : null;
    if (aiMatches && aiMatches.length > 0) {
      rel = aiMatches;
    } else {
      rel = salJobs.map((j) => ({ ...j, ...scoreFallback(j, fbProf) })).filter((j) => j.matchScore > 0);
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

module.exports = { filter, extractProfileWithAI, evaluateJobsWithAI, buildFallbackProfile, scoreFallback };
