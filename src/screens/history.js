import { html } from '../lib/html.js';
import { getAudits, getCompany, getSources } from '../data/repo.js';
import { CALIBRATION, AGENTS } from '../engine/config.js';
import { scoreAudit } from '../engine/score.js';
import { matchFindings, categoryMovement, sourcesAdded } from '../engine/compare.js';
import { fmtDate, verdictTag, sevTag, vClass, meter } from '../components/ui.js';

const sign = (d) => (d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : '0');

function chart(audits, ai, bi) {
  const W = 1000; const H = 260; const pad = 70;
  const x = (i) => (audits.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (audits.length - 1));
  const y = (s) => H - 24 - (s / 100) * (H - 48);
  const pts = audits.map((a, i) => `${x(i)},${y(a.score)}`).join(' ');
  const bands = [[65, 'PROCEED'], [45, 'HOLD'], [35, 'PIVOT']];
  return html`<svg class="h-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score over time: ${audits.map((a) => `${fmtDate(a.date)} ${a.score} ${a.finalDirective}`).join('; ')}">
    ${bands.map(([v, d]) => html`<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="h-band"/><text x="2" y="${y(v) - 6}" text-anchor="start" class="h-band-t">${d} ${v}</text>`)}
    <polyline points="${pts}" class="h-line"/>
    ${audits.map((a, i) => html`<g class="h-pt ${vClass(a.finalDirective)}${i === ai ? ' is-a' : ''}${i === bi ? ' is-b' : ''}">
      <circle cx="${x(i)}" cy="${y(a.score)}" r="${i === ai || i === bi ? 11 : 7}"/>
      <text x="${x(i)}" y="${y(a.score) - 20}" text-anchor="middle" class="h-pt-score">${a.score}</text>
      <text x="${x(i)}" y="${H - 4}" text-anchor="middle" class="h-pt-date">${fmtDate(a.date)}${i === ai ? ' · A' : i === bi ? ' · B' : ''}</text>
    </g>`)}
  </svg>`;
}

function compare(A, B, company, sources, rescored) {
  const left = rescored || A;
  const m = matchFindings(A.findings, B.findings);
  const cats = categoryMovement(left.exposure, B.exposure);
  const added = sourcesAdded(A.sourceIds || [], sources.filter((s) => (B.sourceIds || []).includes(s.id)));
  const delta = B.score - left.score;
  const diffCal = A.calibrationVersion !== B.calibrationVersion && !rescored;
  const moved = m.unchanged.filter((u) => u.severityMove !== 'same');
  const dismissals = [...A.findings, ...B.findings].filter((f) => f.status === 'dismissed');
  const list = (items, empty, render) => (items.length ? html`<ul class="h-flist">${items.map(render)}</ul>` : html`<p class="hint">${empty}</p>`);
  return html`
<section aria-labelledby="cmp-title" class="stack-lg">
  ${diffCal ? html`<div class="banner banner-warn" role="note"><div class="stack-sm"><b>Different calibration version: movement may reflect the scoring change</b><span class="small">Baseline ${A.calibrationVersion}, compare ${B.calibrationVersion}. Score-move and directive alerts are suppressed across this boundary.</span></div><button type="button" class="btn" data-rescore>Re-score on current version</button></div>` : ''}
  ${rescored ? html`<div class="banner banner-info" role="note"><div class="stack-sm"><b>Like-for-like compare</b><span class="small">The baseline was re-scored on ${CALIBRATION.version} from its stored snapshot (a re-score shadow run). The original audit is unchanged: it still reads ${A.score} ${A.finalDirective}.</span></div><button type="button" class="btn" data-original>Show original</button></div>` : ''}
  <div class="hero-panel h-cmp">
    <div class="stars" aria-hidden="true"></div>
    <div class="stack-sm"><span class="lbl">${fmtDate(A.date)} to ${fmtDate(B.date)}</span><h2 id="cmp-title" class="h-cmp-title">${delta < 0 ? 'Risk rose between these audits.' : delta > 0 ? 'Risk fell between these audits.' : 'The score held between these audits.'}</h2></div>
    <div class="h-cmp-grid">
      <div><span class="lbl">Score</span><span class="h-big">${left.score} → ${B.score}</span></div>
      <div><span class="lbl">Change</span><span class="h-big ${delta < 0 ? 'delta-down' : delta > 0 ? 'delta-up' : ''}">${sign(delta)}</span></div>
      <div><span class="lbl">Base directive</span><span class="row-actions">${verdictTag(left.baseDirective)}<span aria-hidden="true">→</span>${verdictTag(B.baseDirective)}</span></div>
      <div><span class="lbl">Final directive</span><span class="row-actions">${verdictTag(left.finalDirective)}<span aria-hidden="true">→</span>${verdictTag(B.finalDirective)}</span></div>
      <div><span class="lbl">Calibration</span><span class="small">${rescored ? CALIBRATION.version : A.calibrationVersion} → ${B.calibrationVersion}</span></div>
    </div>
    ${B.overridden ? html`<p class="small">The compare audit was adjusted by the Orchestrator from ${B.baseDirective} to ${B.finalDirective}.</p>` : ''}
  </div>

  <div class="h-three">
    <div class="card card-pad stack-sm"><div class="r-sec-head"><h3 class="card-title">New</h3><span class="tag sev-high">${m.added.length}</span></div>
      ${list(m.added, 'No new findings.', (f) => html`<li>${sevTag(f.severity)}<span><b>${f.title}</b><span class="xsmall muted">${AGENTS[f.agent - 1].name} · ${f.category}</span></span></li>`)}</div>
    <div class="card card-pad stack-sm"><div class="r-sec-head"><h3 class="card-title">Resolved</h3><span class="tag v-proceed verdict">${m.resolved.length}</span></div>
      ${list(m.resolved, 'Nothing resolved.', (f) => html`<li>${sevTag(f.severity)}<span><b>${f.title}</b><span class="xsmall muted">${AGENTS[f.agent - 1].name} · ${f.category}</span></span></li>`)}</div>
    <div class="card card-pad stack-sm"><div class="r-sec-head"><h3 class="card-title">Unchanged</h3><span class="tag tag-neutral">${m.unchanged.length}</span></div>
      <p class="xsmall muted">${moved.length} changed severity: ${moved.filter((u) => u.severityMove === 'up').length} up, ${moved.filter((u) => u.severityMove === 'down').length} down.</p>
      ${list(moved, 'No severity changes.', (u) => html`<li>${sevTag(u.after.severity)}<span><b>${u.after.title}</b><span class="xsmall muted">Was ${u.before.severity} · severity ${u.severityMove}</span></span></li>`)}</div>
  </div>

  <div class="co-two">
    <div class="card card-pad stack-sm">
      <div class="r-sec-head"><h3 class="card-title">Category movement</h3><span class="lbl">Exposure, higher is worse</span></div>
      ${cats.map((c) => html`<div class="h-cat">
        <span class="small">${c.category}</span>
        <div class="h-cat-bars"><span class="bar h-bar-a" role="img" aria-label="Baseline ${c.before}"><span style="width:${c.before}%"></span></span><span class="bar h-bar-b" role="img" aria-label="Compare ${c.after}"><span style="width:${c.after}%"></span></span></div>
        <span class="small strong ${c.delta > 0 ? 'delta-down' : c.delta < 0 ? 'delta-up' : 'delta-flat'}">${c.delta === 0 ? 'no change' : `${sign(c.delta)} ${c.delta > 0 ? 'worse' : 'better'}`}</span>
      </div>`)}
      <p class="xsmall muted"><span class="key key-a"></span> Baseline <span class="key key-b"></span> Compare</p>
    </div>
    <div class="stack-md">
      <div class="card card-pad stack-sm">
        <h3 class="card-title">Sources added since the baseline</h3>
        ${added.length ? html`<ul class="h-flist">${added.map((s) => html`<li><span class="tag ${s.type === 'uploaded' ? 'tag-info' : 'tag-neutral'}">${s.type === 'uploaded' ? 'Uploaded' : 'Public'}</span><a class="link" href="/sources?company=${company.id}&source=${s.id}">${s.title}</a><span class="xsmall muted">${fmtDate(s.date)}</span></li>`)}</ul>` : html`<p class="hint">No new sources.</p>`}
      </div>
      <div class="card card-pad stack-sm">
        <h3 class="card-title">Disagreement record</h3>
        ${dismissals.length ? html`<ul class="h-flist">${dismissals.map((f) => html`<li><span class="status-chip st-dismissed">Dismissed</span><span><b>${f.title}</b><span class="xsmall muted">${(f.history.find((h) => h.action === 'Dismissed') || {}).by || 'A team member'}: ${f.dismissReason}</span></span></li>`)}</ul>` : html`<p class="hint">No findings were dismissed or overruled in these audits.</p>`}
      </div>
    </div>
  </div>
  <div class="row-actions"><a class="btn" href="/report/${A.id}">Open baseline report</a><a class="btn btn-primary" href="/report/${B.id}">Open compare report</a></div>
</section>`;
}

export default {
  title: (d) => (d ? `${d.company.title} history · AVA` : 'History · AVA'),
  className: 'history',

  async load(ctx) {
    const company = await getCompany(ctx.params.companyId);
    if (!company) throw new Error('This company does not exist.');
    const [all, sources] = await Promise.all([getAudits(company.id), getSources(company.id)]);
    return { company, audits: all.filter((a) => a.status === 'complete' || a.status === 'partial'), sources };
  },

  render(ctx, { company, audits, sources }) {
    const crumbs = html`<nav class="crumbs" aria-label="Breadcrumb"><a href="/portfolio">Portfolio</a><span aria-hidden="true">/</span><a href="/company/${company.id}">${company.title}</a><span aria-hidden="true">/</span><span>History</span></nav>`;
    if (audits.length < 2) {
      const a = audits[0];
      return html`${crumbs}
<div class="page-head-copy"><span class="lbl">Risk record · ${audits.length} audit</span><h1 class="page-title">${company.title}</h1></div>
${a ? html`<section class="co-hero" aria-label="First audit">
  <div class="hero-panel co-score ${vClass(a.finalDirective)}"><div class="stars" aria-hidden="true"></div><span class="lbl">First audit · ${fmtDate(a.date)}</span><div class="co-nums"><div><div class="lbl">Score</div><div class="hero-num">${a.score}</div></div><div><div class="lbl">Directive</div><div class="hero-dir verdict-text">${a.finalDirective}</div></div></div>${meter(a.score, a.finalDirective)}<span class="small">This is the baseline. There is nothing to compare it with yet.</span></div>
  <div class="card empty-state"><h2 class="empty-title">Your record starts here.</h2><p class="muted">Run another audit after new data, a quarter or a market change. AVA will chart the direction of travel and show which findings moved.</p><div class="row-actions"><a class="btn btn-primary" href="/company/${company.id}?reaudit=1">Run a second audit</a><a class="btn" href="/alerts">Set alert rules</a></div></div>
</section>` : html`<div class="card empty-state"><h2 class="empty-title">No audits yet.</h2><p class="muted">The record starts with the first audit.</p><a class="btn btn-primary" href="/new-analysis?company=${company.id}">Run the first audit</a></div>`}`;
    }
    const ids = audits.map((a) => a.id);
    let ai = ids.indexOf(ctx.query.get('a'));
    let bi = ids.indexOf(ctx.query.get('b'));
    if (bi < 0) bi = audits.length - 1;
    if (ai < 0 || ai === bi) ai = bi > 0 ? bi - 1 : 1;
    const lo = Math.min(ai, bi); const hi = Math.max(ai, bi);
    const A = audits[lo]; const B = audits[hi];
    const rescored = ctx.query.get('rescore') === '1' && A.calibrationVersion !== B.calibrationVersion
      ? { ...scoreAudit({ findings: A.findings, type: company.type, status: A.status, override: A.override }, CALIBRATION) }
      : null;
    const first = audits[0]; const last = audits[audits.length - 1];
    return html`${crumbs}
<section class="page-head" aria-label="Company record">
  <div class="page-head-copy"><span class="lbl">Risk record · ${audits.length} audits · ${fmtDate(first.date)} to ${fmtDate(last.date)}</span><h1 class="page-title">${company.title}</h1><p class="muted">${company.industry} · ${[company.city, company.country].filter(Boolean).join(', ')}</p></div>
  <div class="row-actions"><span class="tag tag-neutral">Now ${last.score}</span>${verdictTag(last.finalDirective)}</div>
</section>
<section aria-labelledby="dir-title" class="card card-pad stack-md">
  <div class="r-sec-head"><h2 id="dir-title" class="r-h2">Direction of travel</h2><span class="small muted">Pick two audits below. The earlier one becomes the baseline.</span></div>
  ${chart(audits, lo, hi)}
</section>
<section aria-label="Audit snapshots">
  <ol class="h-snaps">${audits.map((a, i) => html`<li class="card h-snap${i === lo ? ' is-a' : ''}${i === hi ? ' is-b' : ''}">
    <div class="r-sec-head"><span class="lbl">${fmtDate(a.date)}</span>${verdictTag(a.finalDirective)}</div>
    <div class="row-actions"><span class="num h-snap-n">${a.score}</span><span class="xsmall muted">${i ? `${sign(a.score - audits[i - 1].score)} vs previous` : 'First audit'}</span></div>
    <span class="xsmall muted">${a.calibrationVersion}${a.status === 'partial' ? ' · Partial' : ''}</span>
    <div class="row-actions"><button type="button" class="btn h-pick" data-pick-a="${a.id}" aria-pressed="${i === lo}">Baseline</button><button type="button" class="btn h-pick" data-pick-b="${a.id}" aria-pressed="${i === hi}">Compare</button></div>
  </li>`)}</ol>
</section>
${compare(A, B, company, sources, rescored)}`;
  },

  mount(root, ctx, { audits }) {
    if (audits.length < 2) return null;
    const ac = new AbortController();
    const go = (patch) => {
      const q = new URLSearchParams(window.location.search);
      Object.entries(patch).forEach(([k, v]) => (v === null ? q.delete(k) : q.set(k, v)));
      ctx.navigate(`${window.location.pathname}?${q}`, { replace: true });
    };
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-pick-a]');
      const b = e.target.closest('[data-pick-b]');
      const q = new URLSearchParams(window.location.search);
      const cur = { a: q.get('a'), b: q.get('b') };
      if (a) go({ a: a.dataset.pickA, b: cur.b || audits[audits.length - 1].id, rescore: null });
      if (b) go({ b: b.dataset.pickB, a: cur.a || audits[Math.max(0, audits.length - 2)].id, rescore: null });
      if (e.target.closest('[data-rescore]')) go({ rescore: '1' });
      if (e.target.closest('[data-original]')) go({ rescore: null });
    }, { signal: ac.signal });
    return () => ac.abort();
  },
};
