import { useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const CURRENCY_SYMBOLS = {
  MYR: 'RM',
  USD: '$',
  SGD: 'S$',
  EUR: '€',
  GBP: '£',
};

const SALARY_STEPS = [2000, 4000, 6000, 8000, 10000, 15000, 20000, 30000, 50000];

function App() {
  const [cv, setCv] = useState('');
  const [location, setLocation] = useState('');
  const [currency, setCurrency] = useState('MYR');
  const [minSalary, setMinSalary] = useState('');
  const [maxSalary, setMaxSalary] = useState('');
  const [jobs, setJobs] = useState([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!agreedToTerms) {
      setError('Please tick the Terms & Privacy Policy consent box before uploading your resume.');
      e.target.value = '';
      return;
    }

    setUploading(true);
    setError('');
    setUploadedFileName('');

    const formData = new FormData();
    formData.append('resume', file);

    try {
      const res = await fetch(`${API_BASE}/jobs/parse-resume`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to parse resume.');
      } else {
        setCv(data.text);
        setUploadedFileName(data.fileName);
      }
    } catch {
      setError('Could not upload resume to backend server.');
    } finally {
      setUploading(false);
    }
  };

  const fetchJobs = async (loc, minVal, maxVal, cvText, curr) => {
    setError('');
    const minParam = minVal !== '' ? minVal : '0';
    const maxParam = maxVal !== '' ? maxVal : '10000000';

    try {
      const params = new URLSearchParams({
        location: loc.trim(),
        minSalary: minParam,
        maxSalary: maxParam,
        cv: cvText,
        currency: curr,
      });
      const res = await fetch(`${API_BASE}/jobs?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to fetch jobs');
        setJobs([]);
      } else {
        setJobs(data);
      }
      setSearched(true);
    } catch {
      setError('Could not connect to backend server.');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!agreedToTerms) {
      setError('Please agree to the Terms & Privacy Policy before searching.');
      return;
    }
    fetchJobs(location, minSalary, maxSalary, cv, currency);
  };

  const getBadgeColor = (score) => {
    if (score >= 70) return '#2e7d32';
    if (score >= 40) return '#1565c0';
    return '#4b5563';
  };

  const symbol = CURRENCY_SYMBOLS[currency] || 'RM';

  return (
    <div style={{ maxWidth: '1160px', margin: '0 auto', padding: '36px 24px 60px' }}>
      <header style={{ textAlign: 'center', marginBottom: '32px' }}>
        <span
          style={{
            display: 'inline-block',
            fontSize: '12px',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: '#d4af37',
            fontWeight: '600',
            marginBottom: '8px',
          }}
        >
          AI-Powered Career Matching
        </span>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '8px' }}>
          <svg width="42" height="42" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="crownGold" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#fde68a" />
                <stop offset="50%" stopColor="#f0c75e" />
                <stop offset="100%" stopColor="#b4831a" />
              </linearGradient>
            </defs>
            <path d="M9 46H55L59 19L44 30L32 12L20 30L5 19L9 46Z" fill="url(#crownGold)" />
            <rect x="10" y="50" width="44" height="5" rx="2.5" fill="url(#crownGold)" />
            <circle cx="32" cy="9" r="3" fill="#fde68a" />
            <circle cx="5" cy="16" r="2.5" fill="#f0c75e" />
            <circle cx="59" cy="16" r="2.5" fill="#f0c75e" />
          </svg>
          <h1 style={{ margin: 0, fontSize: '40px', fontWeight: '800', letterSpacing: '-0.5px', background: 'linear-gradient(135deg, #ffffff 30%, #f0c75e 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            RoleCrown
          </h1>
        </div>
        <p style={{ margin: 0, color: '#9ca3af', fontSize: '15px' }}>
          Upload your resume to match roles by skill fit, location, and live monthly salary conversion.
        </p>
      </header>

      <div className="main-grid">
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '15px',
            backgroundColor: 'rgba(18, 24, 38, 0.84)',
            backdropFilter: 'blur(14px)',
            border: '1px solid rgba(212, 175, 55, 0.28)',
            borderRadius: '14px',
            padding: '22px',
            boxShadow: '0 18px 40px rgba(0, 0, 0, 0.45)',
          }}
        >
          <div
            style={{
              backgroundColor: 'rgba(212, 175, 55, 0.08)',
              border: '1px solid rgba(212, 175, 55, 0.25)',
              borderRadius: '8px',
              padding: '11px 13px',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => {
                  setAgreedToTerms(e.target.checked);
                  if (e.target.checked) setError('');
                }}
                style={{ marginTop: '3px', transform: 'scale(1.15)', accentColor: '#d4af37' }}
              />
              <span style={{ fontSize: '13px', lineHeight: '1.45', color: '#e5e7eb' }}>
                I agree to the{' '}
                <button
                  type="button"
                  onClick={() => setShowTermsModal(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#f0c75e',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: '13px',
                    fontWeight: '600',
                  }}
                >
                  Terms of Use &amp; Privacy Policy
                </button>
                . <span style={{ color: '#9ca3af' }}>(Processed in RAM only — never stored.)</span>
              </span>
            </label>
          </div>

          <div
            style={{
              border: '1px dashed rgba(212, 175, 55, 0.4)',
              borderRadius: '10px',
              padding: '13px',
              backgroundColor: 'rgba(10, 14, 23, 0.6)',
            }}
          >
            <label style={{ fontSize: '14px', fontWeight: '600', color: '#f0c75e' }}>
              Attach Resume (.pdf, .docx, .txt)
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                onChange={handleFileUpload}
                disabled={uploading}
                style={{ display: 'block', marginTop: '8px', color: '#d1d5db' }}
              />
            </label>
            {uploading && <p style={{ margin: '8px 0 0', color: '#f0c75e', fontSize: '13px' }}>Extracting text...</p>}
            {uploadedFileName && (
              <p style={{ margin: '8px 0 0', color: '#4ade80', fontSize: '13px', fontWeight: '600' }}>
                Loaded: {uploadedFileName}
              </p>
            )}
          </div>

          <label style={{ fontSize: '14px', fontWeight: '600' }}>
            Resume Text
            <textarea
              rows={5}
              value={cv}
              onChange={(e) => setCv(e.target.value)}
              placeholder="Attach a resume above or paste your CV text here..."
              style={{ width: '100%', marginTop: '6px', padding: '10px', lineHeight: '1.45' }}
            />
          </label>

          <label style={{ fontSize: '14px', fontWeight: '600' }}>
            Location (leave blank for anywhere)
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Malaysia, Singapore, Remote"
              style={{ width: '100%', marginTop: '6px', padding: '10px' }}
            />
          </label>

          <div style={{ display: 'flex', gap: '8px' }}>
            <label style={{ flex: '0 0 108px', fontSize: '13px', fontWeight: '600' }}>
              Currency
              <select
                value={currency}
                onChange={(e) => {
                  const nextCurr = e.target.value;
                  setCurrency(nextCurr);
                  if (searched && agreedToTerms) fetchJobs(location, minSalary, maxSalary, cv, nextCurr);
                }}
                style={{ width: '100%', marginTop: '6px', padding: '10px 8px' }}
              >
                {Object.keys(CURRENCY_SYMBOLS).map((code) => (
                  <option key={code} value={code}>
                    {code} ({CURRENCY_SYMBOLS[code]})
                  </option>
                ))}
              </select>
            </label>

            <label style={{ flex: 1, fontSize: '13px', fontWeight: '600' }}>
              Min Salary / mo
              <select
                value={minSalary}
                onChange={(e) => {
                  const nextMin = e.target.value;
                  const resetMax =
                    nextMin !== '' && maxSalary !== '' && Number(nextMin) > Number(maxSalary)
                      ? ''
                      : maxSalary;
                  setMinSalary(nextMin);
                  setMaxSalary(resetMax);
                  if (searched && agreedToTerms) fetchJobs(location, nextMin, resetMax, cv, currency);
                }}
                style={{ width: '100%', marginTop: '6px', padding: '10px 8px' }}
              >
                <option value="">Any Min</option>
                {SALARY_STEPS.map((step) => (
                  <option key={step} value={step}>
                    {symbol} {step.toLocaleString()}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ flex: 1, fontSize: '13px', fontWeight: '600' }}>
              Max Salary / mo
              <select
                value={maxSalary}
                onChange={(e) => {
                  const nextMax = e.target.value;
                  setMaxSalary(nextMax);
                  if (searched && agreedToTerms) fetchJobs(location, minSalary, nextMax, cv, currency);
                }}
                style={{ width: '100%', marginTop: '6px', padding: '10px 8px' }}
              >
                <option value="">Any Max</option>
                {SALARY_STEPS.map((step) => (
                  <option
                    key={step}
                    value={step}
                    disabled={minSalary !== '' && step < Number(minSalary)}
                  >
                    {symbol} {step.toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="submit"
            style={{
              marginTop: '4px',
              padding: '12px',
              fontSize: '16px',
              fontWeight: '700',
              color: '#0b0d12',
              background: 'linear-gradient(135deg, #f0c75e 0%, #c99b26 100%)',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(212, 175, 55, 0.25)',
            }}
          >
            Find Matching Jobs
          </button>

          {error && (
            <p
              style={{
                color: '#fca5a5',
                backgroundColor: 'rgba(127, 29, 29, 0.45)',
                border: '1px solid rgba(248, 113, 113, 0.4)',
                borderRadius: '8px',
                padding: '10px 12px',
                margin: 0,
                fontSize: '13px',
              }}
            >
              {error}
            </p>
          )}
        </form>

        <div>
          {!searched || error ? (
            <div
              style={{
                backgroundColor: 'rgba(18, 24, 38, 0.72)',
                backdropFilter: 'blur(14px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '14px',
                padding: '26px',
                boxShadow: '0 18px 40px rgba(0, 0, 0, 0.35)',
              }}
            >
              <h2 style={{ marginTop: 0, fontSize: '20px', color: '#f0c75e' }}>
                Ready to Match Your Profile
              </h2>
              <p style={{ color: '#9ca3af', fontSize: '14px', lineHeight: '1.6', marginBottom: '20px' }}>
                Tick the consent box on the left, attach your resume (or paste your CV), and click{' '}
                <strong style={{ color: '#f3f4f6' }}>Find Matching Jobs</strong> to rank roles by skill overlap and live monthly salary conversion.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(10, 14, 23, 0.65)',
                    borderLeft: '3px solid #d4af37',
                  }}
                >
                  <strong style={{ color: '#f3f4f6', fontSize: '14px' }}>1. Stateless RAM-Only Parsing</strong>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                    Supports PDF, DOCX, and TXT files in volatile memory with zero disk or database retention.
                  </p>
                </div>

                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(10, 14, 23, 0.65)',
                    borderLeft: '3px solid #3b82f6',
                  }}
                >
                  <strong style={{ color: '#f3f4f6', fontSize: '14px' }}>2. Weighted Skill &amp; Role Scoring</strong>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                    Evaluates technical stacks, tools, and leadership titles to calculate a transparent % match score.
                  </p>
                </div>

                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(10, 14, 23, 0.65)',
                    borderLeft: '3px solid #4ade80',
                  }}
                >
                  <strong style={{ color: '#f3f4f6', fontSize: '14px' }}>3. Flexible Min &amp; Max Monthly Salary</strong>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                    Filter by minimum floor alone or set a strict min-to-max monthly salary range in MYR, USD, SGD, EUR, or GBP.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ margin: 0, fontSize: '21px', color: '#f3f4f6' }}>
                  Matching Jobs <span style={{ color: '#d4af37' }}>({jobs.length})</span>
                </h2>
              </div>

              {jobs.length === 0 ? (
                <div
                  style={{
                    backgroundColor: 'rgba(18, 24, 38, 0.78)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '12px',
                    padding: '22px',
                    color: '#9ca3af',
                  }}
                >
                  No matching jobs found for your current filters. Try widening your min/max salary or clearing the location filter.
                </div>
              ) : (
                jobs.map((job) => (
                  <div
                    key={job.id}
                    style={{
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderLeft: '4px solid #d4af37',
                      borderRadius: '12px',
                      padding: '18px 20px',
                      marginBottom: '14px',
                      backgroundColor: 'rgba(18, 24, 38, 0.85)',
                      backdropFilter: 'blur(12px)',
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <h3 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>{job.title}</h3>
                      {job.matchScore !== null && job.matchScore !== undefined && (
                        <span
                          style={{
                            backgroundColor: getBadgeColor(job.matchScore),
                            color: '#fff',
                            padding: '4px 12px',
                            borderRadius: '999px',
                            fontSize: '12px',
                            fontWeight: '700',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {job.matchScore}% Match
                        </span>
                      )}
                    </div>

                    <p style={{ margin: '10px 0 8px', fontSize: '14px', color: '#d1d5db' }}>
                      <strong>Location:</strong> {job.location} &nbsp;|&nbsp;{' '}
                      <strong>Salary:</strong>{' '}
                      <span style={{ color: '#f0c75e', fontWeight: '600' }}>
                        {symbol} {job.convertedSalary.toLocaleString()} / mo
                      </span>
                      {job.currency !== job.displayCurrency && (
                        <span style={{ color: '#9ca3af', fontSize: '13px' }}>
                          {' '}(Original: {job.currency} {job.salary.toLocaleString()} / mo)
                        </span>
                      )}
                    </p>

                    {job.matchedSkills && job.matchedSkills.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '8px 0 10px' }}>
                        {job.matchedSkills.map((skill) => (
                          <span
                            key={skill}
                            style={{
                              backgroundColor: 'rgba(74, 222, 128, 0.14)',
                              border: '1px solid rgba(74, 222, 128, 0.35)',
                              color: '#86efac',
                              padding: '2px 9px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '500',
                            }}
                          >
                            ✓ {skill}
                          </span>
                        ))}
                      </div>
                    )}

                    <p style={{ margin: '4px 0 12px', fontSize: '13px', color: '#9ca3af' }}>
                      <strong>Required Skills:</strong> {job.skills}
                    </p>

                    <a
                      href={job.apply_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-block',
                        color: '#f0c75e',
                        fontWeight: '600',
                        fontSize: '14px',
                        textDecoration: 'none',
                      }}
                    >
                      Apply Now &rarr;
                    </a>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <footer
        style={{
          marginTop: '44px',
          paddingTop: '18px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          fontSize: '13px',
          color: '#9ca3af',
          textAlign: 'center',
        }}
      >
        Resumes are processed temporarily in RAM and never stored.{' '}
        <button
          type="button"
          onClick={() => setShowTermsModal(true)}
          style={{
            background: 'none',
            border: 'none',
            color: '#f0c75e',
            textDecoration: 'underline',
            cursor: 'pointer',
            padding: 0,
            fontSize: '13px',
          }}
        >
          Terms of Use &amp; Privacy Policy
        </button>
      </footer>

      {showTermsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.78)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#161b27',
              border: '1px solid rgba(212, 175, 55, 0.35)',
              borderRadius: '12px',
              maxWidth: '540px',
              width: '100%',
              padding: '24px',
              color: '#f3f4f6',
              lineHeight: '1.55',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
            }}
          >
            <h2 style={{ marginTop: 0, color: '#f0c75e' }}>Terms of Use &amp; Privacy Policy</h2>
            <p style={{ fontSize: '14px', color: '#d1d5db' }}>
              <strong>1. Zero Resume Storage (Stateless Processing):</strong> Uploaded resumes (.pdf, .docx, .txt) and pasted CV text are processed strictly in volatile server memory (RAM) to extract skills and match relevant job listings. Your file and personal data are discarded immediately after processing and are never written to disk or stored in any database.
            </p>
            <p style={{ fontSize: '14px', color: '#d1d5db' }}>
              <strong>2. Personal Data Protection (PDPA Notice):</strong> In accordance with Malaysia&apos;s Personal Data Protection Act (PDPA), personal details contained in your resume (such as name, contact number, email, and work history) are used solely to generate real-time job match scores during your active session and are never sold, logged, or shared with third parties.
            </p>
            <p style={{ fontSize: '14px', color: '#d1d5db' }}>
              <strong>3. Salary Conversions &amp; External Links:</strong> Multi-currency salary figures are indicative estimates based on daily reference exchange rates. External &ldquo;Apply Now&rdquo; links direct you to third-party employer or job board websites governed by their own terms and privacy policies.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                style={{
                  padding: '8px 14px',
                  backgroundColor: 'transparent',
                  color: '#d1d5db',
                  border: '1px solid #4b5563',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setAgreedToTerms(true);
                  setError('');
                  setShowTermsModal(false);
                }}
                style={{
                  padding: '8px 16px',
                  background: 'linear-gradient(135deg, #f0c75e 0%, #c99b26 100%)',
                  color: '#0b0d12',
                  fontWeight: '700',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                I Agree &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
