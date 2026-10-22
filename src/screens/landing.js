import { html } from '../lib/html.js';
import { SAMPLE_REPORT_PATH } from '../config.js';

// Illustrative content only. Client marks are placeholders, not real clients.
const CLIENT_MARKS = [
  { name: 'NORTHGATE', style: 'font-weight:800;letter-spacing:.18em;font-size:1.25rem' },
  { name: 'harbourline', style: 'font-weight:700;letter-spacing:-0.04em;font-size:1.75rem' },
  { name: 'Kestrel & Co', style: "font-family:var(--font-mark);font-size:1.75rem" },
  { name: 'LUMEN.', style: 'font-weight:800;letter-spacing:.04em;font-size:1.625rem' },
  { name: 'oakfield capital', style: 'font-weight:600;letter-spacing:-0.03em;font-size:1.5rem' },
  { name: 'STRATUS', style: 'font-family:var(--font-mono);font-weight:600;letter-spacing:.14em;font-size:1.25rem' },
  { name: 'Ferrant', style: 'font-family:var(--font-mark);font-style:italic;font-size:1.875rem' },
  { name: 'meridian', style: 'font-weight:800;letter-spacing:-0.05em;font-size:1.875rem' },
];

const AGENTS = [
  { name: 'The Saboteur', role: 'Internal failure', sev: 'HIGH', finding: 'Route density has fallen to 11 stops per run and driver cost per stop is above sector norms.' },
  { name: 'The Predator', role: 'Competitive attack', sev: 'HIGH', finding: 'A funded national courier can undercut on price in the home corridor.' },
  { name: 'The Copycat', role: 'Market saturation', sev: 'MEDIUM', finding: 'Little stops a rival copying the service within a quarter.' },
  { name: 'The Spectator', role: 'Demand and runway', sev: 'MEDIUM', finding: 'Customers value reliability, but runway is under seven months.' },
  { name: 'The Sentinel', role: 'Regulation and legal', sev: 'HIGH', finding: 'Temperature logging gaps. Legal exposure was skipped because no licence was uploaded.' },
  { name: 'The Orchestrator', role: 'Final verdict', sev: 'MEDIUM', finding: 'Weighs all five reports and issues the score and directive: pivot to denser routes first.' },
];

const PREVIEW_BARS = [
  { label: 'Competition', pct: 77, tone: 'high' },
  { label: 'Financial', pct: 71, tone: 'high' },
  { label: 'Operational', pct: 64, tone: 'medium' },
];

const FACTS = [
  { value: '6', label: 'agents, in sequence' },
  { value: '13', label: 'report sections' },
  { value: 'Minutes', label: 'from description to verdict' },
  { value: '0 to 100', label: 'Resilience Score' },
];

const EXAMPLES = [
  { meta: 'Healthcare · 2 Oct 2026', title: 'Diagnostics start-up with trial data', body: 'Clear demand and a defensible approach. Regulatory path is the main exposure.', score: 68, directive: 'PROCEED' },
  { meta: 'Logistics · 14 Oct 2026', title: 'Regional chilled delivery network', body: 'Real demand, broken route economics, and a national courier entering the market.', score: 41, directive: 'PIVOT' },
  { meta: 'Food and Beverage · 21 Sep 2026', title: 'Premium frozen meals brand', body: 'Cloneable product, thin margins, and four months of runway.', score: 33, directive: 'KILL' },
];

const FAQ = [
  { q: 'What is AVA?', a: 'A risk platform that stress-tests a venture by attacking it. Six specialist agents each try to break it from a different angle, then the Orchestrator issues a Resilience Score and a directive.', open: true },
  { q: 'How is it different from a general AI chat tool?', a: 'A chat tool answers what you ask. AVA runs a fixed adversarial process in sequence, each agent reading the last, and returns a structured, scored, cited report you can compare over time.' },
  { q: 'What does the score mean?', a: 'It runs from 0 to 100, and higher is better. It is built to be honest, not encouraging: a high score is reserved for genuinely defensible businesses.' },
  { q: 'Can I export a report?', a: 'Yes. Download a branded PDF with a cover, venture details, score, key findings and the full analysis, or copy the report as text.' },
  { q: 'How long does an audit take?', a: 'A few minutes. Results appear agent by agent, and the audit keeps running if you leave the page.' },
  { q: 'Is my submission confidential?', a: '[CONFIRM WITH LEGAL] Your submission is used to produce your audit. Final wording on data handling to be supplied before launch.' },
];

const SEV_CLASS = { HIGH: 'sev-high', MEDIUM: 'sev-medium', LOW: 'sev-low' };

// Deterministic star field so the hero looks the same on every load.
function stars(count = 170, seed = 7) {
  let s = seed;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const radii = [0.6, 0.8, 1, 1.2, 1.6];
  return Array.from({ length: count }, (_, i) => {
    const cx = Math.round(rand() * 1400);
    const cy = Math.round(rand() * 780);
    const r = radii[Math.floor(rand() * radii.length)];
    const o = (0.16 + rand() * 0.64).toFixed(2);
    return html`<circle${i % 6 === 0 ? html` class="tw"` : ''} cx="${cx}" cy="${cy}" r="${r}" opacity="${o}"/>`;
  });
}

const BEAMS = [
  ['top', 45, 34], ['top', 47.5, 22], ['top', 50, 40], ['top', 52, 16], ['top', 53.5, 30], ['top', 78, 28],
  ['bottom', 46.5, 26], ['bottom', 49, 34], ['bottom', 51, 20], ['bottom', 53, 30],
];

// Fan geometry for the agent panes.
function paneState(i, active) {
  const d = i - active;
  const on = d === 0;
  return {
    on,
    transform: on
      ? 'translateX(0px) translateY(-14px) translateZ(90px) rotateY(-28deg) scale(1.05)'
      : `translateX(${Math.sign(d) * (122 + (Math.abs(d) - 1) * 54)}px) translateZ(${-Math.abs(d) * 30}px) rotateY(-34deg)`,
    opacity: on ? 1 : Math.max(0.72, 0.96 - Math.abs(d) * 0.07),
    z: 10 - Math.abs(d),
  };
}

function applyPane(el, i, active) {
  const st = paneState(i, active);
  el.style.transform = st.transform;
  el.style.opacity = String(st.opacity);
  el.style.zIndex = String(st.z);
  el.classList.toggle('is-on', st.on);
  el.setAttribute('aria-pressed', String(st.on));
}

export default {
  title: 'AVA · Find the risk before the capital goes in',

  render() {
    const active = 1;
    const cur = AGENTS[active];
    const markSet = (hidden) => html`<div class="marq-set"${hidden ? html` aria-hidden="true"` : ''}>${CLIENT_MARKS.map((m) => html`<span class="logo-i" style="${m.style}">${m.name}</span>`)}</div>`;

    return html`
<section class="l-hero" aria-labelledby="hero-title">
  <svg class="l-hero-stars" aria-hidden="true" viewBox="0 0 1400 780" preserveAspectRatio="xMidYMid slice">${stars()}</svg>
  ${BEAMS.map(([edge, left, h]) => html`<span class="l-beam l-beam-${edge}" aria-hidden="true" style="left:${left}%;height:${h}%"></span>`)}
  <div class="l-hex l-hex-a" aria-hidden="true">
    <svg width="300" height="260" viewBox="0 0 300 260" fill="none" class="l-hex-lines"><path d="M236 96 H170 C120 96 96 108 70 140 L-20 260" stroke="rgba(255,255,255,0.38)"/><path d="M236 96 H156 C106 96 82 108 56 140 L-50 260" stroke="rgba(255,255,255,0.31)"/><path d="M236 96 H142 C92 96 68 108 42 140 L-80 260" stroke="rgba(255,255,255,0.24)"/><path d="M236 96 H128 C78 96 54 108 28 140 L-110 260" stroke="rgba(255,255,255,0.17)"/></svg>
    <div class="l-hex-badge" style="left:236px;top:34px"><svg width="112" height="124" viewBox="0 0 112 124"><defs><linearGradient id="hga" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A9B8FF" stop-opacity=".6"/><stop offset="1" stop-color="#4658D8" stop-opacity=".45"/></linearGradient></defs><polygon points="56,2 108,32 108,92 56,122 4,92 4,32" fill="url(#hga)" stroke="rgba(255,255,255,.28)" stroke-width="1.5"/><path d="M56 36 L78 45 V66 C78 80 68 88 56 92 C44 88 34 80 34 66 V45 Z" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><path d="M46 64 L53 71 L67 55" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
  </div>
  <div class="l-hex l-hex-b" aria-hidden="true">
    <svg width="300" height="260" viewBox="0 0 300 260" fill="none" class="l-hex-lines" style="right:0;left:auto"><path d="M64 150 H130 C180 150 204 138 230 110 L320 0" stroke="rgba(255,255,255,0.38)"/><path d="M64 150 H144 C194 150 218 138 244 110 L350 0" stroke="rgba(255,255,255,0.31)"/><path d="M64 150 H158 C208 150 232 138 258 110 L380 0" stroke="rgba(255,255,255,0.24)"/><path d="M64 150 H172 C222 150 246 138 272 110 L410 0" stroke="rgba(255,255,255,0.17)"/></svg>
    <div class="l-hex-badge" style="right:236px;top:100px"><svg width="112" height="124" viewBox="0 0 112 124"><defs><linearGradient id="hgb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A9B8FF" stop-opacity=".6"/><stop offset="1" stop-color="#4658D8" stop-opacity=".45"/></linearGradient></defs><polygon points="56,2 108,32 108,92 56,122 4,92 4,32" fill="url(#hgb)" stroke="rgba(255,255,255,.28)" stroke-width="1.5"/><path d="M32 78 A24 24 0 0 1 80 78" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><path d="M56 78 L68 56" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><circle cx="56" cy="78" r="4" fill="#fff"/></svg></div>
  </div>
  <h1 id="hero-title" class="l-hero-title display-xl">Find the risk before the capital goes in</h1>
  <p class="l-hero-sub">Six AI agents attack a venture from six angles. You get one score from 0 to 100 and one directive: proceed, hold, pivot or kill.</p>
  <div class="l-hero-cta">
    <a class="btn btn-tint btn-lg" href="${SAMPLE_REPORT_PATH}">Explore report</a>
    <a class="btn btn-primary btn-lg" href="/free-audit">Get started</a>
  </div>
</section>

<section class="l-clients" aria-label="Clients">
  <span class="lbl">Trusted by funds, studios and corporate teams · placeholder marks</span>
  <div class="marq"><div class="marq-t">${markSet(false)}${markSet(true)}</div></div>
</section>

<section id="how" class="l-split l-how">
  <div class="l-split-copy">
    <span class="lbl">How it works</span>
    <h2 class="display-m">A verdict, a record and an alert for every company you back.</h2>
    <ul class="l-points">
      <li><b>Verdict.</b> Score and directive in minutes.</li>
      <li><b>Record.</b> Compare any two audits over time.</li>
      <li><b>Alerts.</b> Only when a company's risk moves.</li>
    </ul>
  </div>
  <div class="l-preview v-pivot">
    <div class="l-preview-head"><span class="l-preview-name">Northline Cold Chain</span><span class="lbl">Illustrative venture</span></div>
    <div class="l-preview-nums">
      <div><div class="lbl">Resilience score</div><div class="num l-preview-score">41</div></div>
      <div><div class="lbl">Directive</div><div class="num l-preview-dir verdict-text">PIVOT</div></div>
    </div>
    <div class="meter" role="img" aria-label="Score meter, 41 of 100">${Array.from({ length: 25 }, (_, i) => (i < 10 ? html`<span class="on seg-on" style="animation-delay:${(i * 0.12).toFixed(2)}s"></span>` : html`<span></span>`))}</div>
    <div class="l-preview-bars">
      ${PREVIEW_BARS.map((b) => html`<div class="l-bar-row"><span>${b.label}</span><span class="bar"><span class="fill-${b.tone}" style="width:${b.pct}%"></span></span><span class="l-bar-pct">${b.pct}%</span></div>`)}
    </div>
  </div>
</section>

<section class="l-facts" aria-label="Key facts">
  ${FACTS.map((f) => html`<div class="card l-fact"><span class="num l-fact-value">${f.value}</span><span class="muted">${f.label}</span></div>`)}
</section>

<section id="agents" class="l-split l-agents">
  <div class="l-split-copy l-agents-copy">
    <span class="lbl">The chain</span>
    <h2 class="display-m">Each agent reads the one before.</h2>
    <p class="muted">The report builds case by case, not as six separate opinions. Every finding links to the evidence behind it.</p>
    <div class="card l-agent-card" aria-live="polite">
      <div class="l-agent-card-head"><span class="lbl" data-cur-meta>0${active + 1} · ${cur.role}</span><span class="tag ${SEV_CLASS[cur.sev]}" data-cur-sev>${cur.sev}</span></div>
      <div class="l-agent-name" data-cur-name>${cur.name}</div>
      <p class="l-agent-finding" data-cur-finding>${cur.finding}</p>
      <a class="l-agent-link" href="${SAMPLE_REPORT_PATH}">Open in the sample report <span aria-hidden="true">→</span></a>
    </div>
    <div class="l-agent-ctrl">
      <button class="btn" type="button" data-agent-step="-1" aria-label="Previous agent">← Previous</button>
      <button class="btn" type="button" data-agent-step="1" aria-label="Next agent">Next →</button>
    </div>
  </div>
  <div class="l-fan" role="group" aria-label="The six agents in order">
    <div class="l-fan-glow" aria-hidden="true"></div>
    <div class="l-fan-stage">
    ${AGENTS.map((a, i) => {
      const st = paneState(i, active);
      return html`<button type="button" class="pane${st.on ? ' is-on' : ''}" data-pane="${i}" aria-pressed="${st.on}" aria-label="${a.name}" style="transform:${st.transform};opacity:${st.opacity};z-index:${st.z}">
        <span class="lbl pane-no">0${i + 1}</span>
        <span class="pane-active"><span class="pane-name">${a.name}</span><span class="pane-role">${a.role}</span><span class="bars"><i style="width:92%"></i><i style="width:64%"></i><i style="width:78%"></i></span></span>
        <span class="vlabel">${a.name}</span>
      </button>`;
    })}
    </div>
  </div>
</section>

<section class="l-examples">
  <div class="l-examples-head"><h2 class="display-m">Example audits</h2><span class="lbl">Illustrative, not real companies</span></div>
  <div class="l-examples-grid">
    ${EXAMPLES.map((e) => html`<article class="card l-example v-${e.directive.toLowerCase()}">
      <span class="lbl">${e.meta}</span>
      <h3 class="l-example-title">${e.title}</h3>
      <p class="muted">${e.body}</p>
      <div class="l-example-foot"><span class="num l-example-score">${e.score}</span><span class="tag verdict">${e.directive}</span></div>
    </article>`)}
  </div>
</section>

<section id="faq" class="l-faq">
  <h2 class="display-m">Questions.</h2>
  <div class="faq">
    ${FAQ.map((f) => html`<details${f.open ? html` open` : ''}><summary>${f.q}</summary><p>${f.a}</p></details>`)}
  </div>
</section>

<section class="l-cta">
  <div class="l-cta-panel">
    <h2 class="display-m">Run the audit before you wire the money</h2>
    <a class="btn btn-primary btn-lg" href="/free-audit">Start free audit</a>
  </div>
</section>`;
  },

  mount(root) {
    let active = 1;
    const panes = [...root.querySelectorAll('[data-pane]')];
    const meta = root.querySelector('[data-cur-meta]');
    const sev = root.querySelector('[data-cur-sev]');
    const name = root.querySelector('[data-cur-name]');
    const finding = root.querySelector('[data-cur-finding]');

    const select = (i) => {
      active = (i + AGENTS.length) % AGENTS.length;
      const a = AGENTS[active];
      panes.forEach((el, idx) => applyPane(el, idx, active));
      meta.textContent = `0${active + 1} · ${a.role}`;
      sev.textContent = a.sev;
      sev.className = `tag ${SEV_CLASS[a.sev]}`;
      name.textContent = a.name;
      finding.textContent = a.finding;
    };

    const onClick = (e) => {
      const pane = e.target.closest('[data-pane]');
      if (pane) { select(Number(pane.dataset.pane)); return; }
      const step = e.target.closest('[data-agent-step]');
      if (step) select(active + Number(step.dataset.agentStep));
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  },
};

