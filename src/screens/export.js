import { html } from '../lib/html.js';
import { getAudit, getCompanies, getOrg, getAlerts, getOutcomeRows, recordExport, SAMPLE } from '../data/repo.js';
import { CATEGORIES } from '../engine/config.js';
import { OUTCOMES } from '../engine/outcomes.js';
import { fmtDate, segmented } from '../components/ui.js';
import { reportText } from './report.js';
import { toast } from '../components/sheet.js';
import { load as loadPref, save as savePref } from '../lib/storage.js';

const REPORT_OPTS = [
  { k: 'brand', label: 'AVA attribution on the cover', note: 'Turn off for white-labelled reports.' },
  { k: 'skipped', label: 'Skipped sections', note: 'Shows a short reason instead of leaving gaps.' },
  { k: 'evidence', label: 'Evidence appendix', note: 'Lists every source cited in the report.' },
  { k: 'footer', label: 'Confidentiality footer', note: 'Added to every page.' },
];
const PACK_SECTIONS = [
  { k: 'summary', label: 'Portfolio summary' },
  { k: 'changes', label: 'Directive changes' },
  { k: 'movers', label: 'Biggest movers' },
  { k: 'companies', label: 'One page per company' },
  { k: 'outcomes', label: 'Outcomes logged' },
  { k: 'sources', label: 'Sources appendix' },
];

function quarters() {
  const out = [];
  const d = new Date();
  let y = d.getFullYear();
  let q = Math.floor(d.getMonth() / 3) + 1;
  for (let i = 0; i < 4; i += 1) {
    out.push({ key: `${y}-Q${q}`, label: `Q${q} ${y}`, from: `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`, to: `${y}-${String(q * 3).padStart(2, '0')}-31` });
    q -= 1;
    if (!q) { q = 4; y -= 1; }
  }
  return out;
}

const pageFoot = (o, n, org) => html`<div class="pdf-foot">${o.footer ? html`<span>Confidential. Prepared for ${org}.</span>` : html`<span></span>`}<span>Page ${n}</span></div>`;

function reportPages(a, o) {
  const top = a.findings.filter((f) => f.severity === 'HIGH').slice(0, 4);
  const med = a.findings.filter((f) => f.severity === 'MEDIUM').slice(0, 3);
  return html`
<div class="pdf-page">
  <div class="pdf-head"><b>${o.org}</b><span class="pl">Confidential</span></div>
  ${a.underReview ? html`<div class="pdf-review">Under review: this verdict is under review after a change in scoring consistency. Do not act on it until the review is complete.</div>` : ''}
  <div class="pdf-cover"><span class="pl">Venture risk audit · ${fmtDate(a.date)}</span><div class="pdf-title">${a.company.title}</div><div class="pdf-sub">${a.company.description}</div></div>
  <div class="pdf-verdict"><div><div class="pl">Resilience score</div><div class="pdf-big">${a.score}</div></div><div><div class="pl">Directive</div><div class="pdf-big pdf-dir">${a.finalDirective}</div>${a.overridden ? html`<div class="pdf-small">Adjusted by the Orchestrator from ${a.baseDirective}</div>` : ''}${a.status === 'partial' ? html`<div class="pdf-small">Partial audit, capped at HOLD</div>` : ''}</div></div>
  <div class="pdf-small">${a.company.industry} · ${[a.company.city, a.company.country].filter(Boolean).join(', ')} · Calibration ${a.calibrationVersion}</div>
  ${o.brand ? html`<div class="pl pdf-attr">Generated with AVA, Adversarial Venture Analyst</div>` : ''}
  ${pageFoot(o, 1, o.org)}
</div>
<div class="pdf-page">
  <div class="pdf-head"><span class="pl">Verdict</span><span class="pl">${a.company.title}</span></div>
  <p class="pdf-lead">${a.orchestrator?.rationale}</p>
  <div class="pl">Exposure by category · higher is worse</div>
  ${CATEGORIES.map((c) => html`<div class="pdf-cat"><span>${c}</span><span class="pdf-bar"><span style="width:${a.exposure[c]}%"></span></span><span>${a.exposure[c]}</span></div>`)}
  <div class="pl pdf-gap">Key findings</div>
  <ul class="pdf-list">${[...top, ...med].map((f) => html`<li><b>${f.severity}</b> ${f.title}${f.sources.length ? html` <span class="pdf-cite">[${f.sources.map((s) => a.citationOrder.indexOf(s) + 1).join(', ')}]</span>` : html` <span class="pdf-cite">Agent reasoning, no source</span>`}</li>`)}
  ${o.skipped ? a.skippedSections.map((s) => html`<li><b>N/A</b> ${s.reason}</li>`) : ''}</ul>
  <div class="pdf-small">Coverage: ${a.coverage.agentsRun} of 6 agents run, ${a.coverage.sectionsSkipped} section skipped, ${a.coverage.sourcesCited} sources cited.</div>
  ${pageFoot(o, 2, o.org)}
</div>
${o.evidence ? html`<div class="pdf-page">
  <div class="pdf-head"><span class="pl">Evidence appendix</span><span class="pl">${a.company.title}</span></div>
  <ol class="pdf-list">${a.citationOrder.map((sid) => { const s = a.sourcesById[sid]; return html`<li>${s.title} · ${s.type === 'uploaded' ? 'Uploaded' : 'Public'} · ${fmtDate(s.date)}${s.url ? html` · ${s.url}` : ''}</li>`; })}</ol>
  ${pageFoot(o, 3, o.org)}
</div>` : ''}`;
}

function packPages(data, o) {
  const { companies, alerts, outcomes, quarter } = data;
  const chosen = companies.filter((c) => c.latest && (o.all || o.selected.includes(c.id)));
  const changes = alerts.filter((a) => a.trigger === 'directive' && a.date >= quarter.from && a.date <= quarter.to && chosen.some((c) => c.id === a.companyId));
  const movers = chosen.filter((c) => c.delta !== null).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
  let n = 0;
  const page = (title, body) => { n += 1; return html`<div class="pdf-page"><div class="pdf-head"><span class="pl">${title}</span><span class="pl">${o.org} · ${quarter.label}</span></div>${body}${pageFoot(o, n, o.org)}</div>`; };
  return html`
${(() => { n += 1; return html`<div class="pdf-page"><div class="pdf-head"><b>${o.org}</b><span class="pl">Confidential</span></div><div class="pdf-cover"><span class="pl">Portfolio pack · ${quarter.label}</span><div class="pdf-title">Portfolio risk record</div><div class="pdf-sub">${chosen.length} companies</div></div>${o.brand ? html`<div class="pl pdf-attr">Generated with AVA, Adversarial Venture Analyst</div>` : ''}${pageFoot(o, n, o.org)}</div>`; })()}
${o.sections.summary ? page('Portfolio summary', html`<ul class="pdf-list">${['PROCEED', 'HOLD', 'PIVOT', 'KILL'].map((d) => html`<li><b>${d}</b> ${chosen.filter((c) => c.latest.finalDirective === d).length}</li>`)}</ul><p class="pdf-small">Scores are only comparable within a venture type.</p>`) : ''}
${o.sections.changes ? page('Directive changes', changes.length ? html`<ul class="pdf-list">${changes.map((a) => html`<li><b>${a.company}</b> ${a.fromDirective} to ${a.toDirective} · ${fmtDate(a.date)}</li>`)}</ul>` : html`<p class="pdf-small">No directive changes this quarter.</p>`) : ''}
${o.sections.movers ? page('Biggest movers', html`<ul class="pdf-list">${movers.map((c) => html`<li><b>${c.title}</b> ${c.previous.score} to ${c.latest.score} (${c.delta > 0 ? '+' : ''}${c.delta})</li>`)}</ul>`) : ''}
${o.sections.companies ? chosen.slice(0, 4).map((c) => page(c.title, html`<div class="pdf-verdict"><div><div class="pl">Score</div><div class="pdf-big">${c.latest.score}</div></div><div><div class="pl">Directive</div><div class="pdf-big pdf-dir">${c.latest.finalDirective}</div></div></div>${CATEGORIES.map((k) => html`<div class="pdf-cat"><span>${k}</span><span class="pdf-bar"><span style="width:${c.latest.exposure[k]}%"></span></span><span>${c.latest.exposure[k]}</span></div>`)}`)) : ''}
${o.sections.companies && chosen.length > 4 ? html`<p class="hint pdf-more">Preview shows 4 of ${chosen.length} company pages. The PDF includes all.</p>` : ''}
${o.sections.outcomes ? page('Outcomes logged', html`<ul class="pdf-list">${outcomes.filter((r) => r.outcome).map((r) => html`<li><b>${r.company}</b> ${r.finalDirective}: ${OUTCOMES[r.outcome.result].label} (${r.status.replace(/-/g, ' ')})</li>`)}</ul>`) : ''}
${o.sections.sources ? page('Sources appendix', html`<p class="pdf-small">Every source cited in the latest audit of each included company, grouped by company.</p>`) : ''}`;
}

export default {
  title: 'Export · AVA',
  className: 'export',

  async load(ctx) {
    const mode = ctx.query.get('mode') || 'report';
    const [org, companies] = await Promise.all([getOrg(), getCompanies()]);
    if (mode === 'pack') {
      const [alerts, outcomes] = await Promise.all([getAlerts(), getOutcomeRows()]);
      return { mode, org, companies, alerts, outcomes };
    }
    const id = ctx.query.get('audit') || SAMPLE.auditId;
    const a = await getAudit(id);
    if (!a || a.score == null) throw new Error('This audit cannot be exported: it has no score.');
    return { mode, org, companies, a };
  },

  render(ctx, d) {
    const pref = loadPref('export', {});
    const o = {
      org: pref.org || d.org.branding.coverName || d.org.name,
      brand: pref.brand ?? d.org.branding.attribution,
      skipped: pref.skipped ?? true, evidence: pref.evidence ?? true, footer: pref.footer ?? true,
      all: pref.all ?? true, selected: pref.selected || [], sections: { ...Object.fromEntries(PACK_SECTIONS.map((s) => [s.k, true])), ...(pref.sections || {}) },
      quarter: pref.quarter || quarters()[0].key,
    };
    const q = quarters().find((x) => x.key === o.quarter) || quarters()[0];
    const isPack = d.mode === 'pack';
    const pageCount = isPack ? 1 + PACK_SECTIONS.filter((s) => o.sections[s.k]).length : 2 + (o.evidence ? 1 : 0);
    return html`
<div class="ex">
  <section aria-label="Export settings" class="ex-side">
    <div class="stack-sm"><span class="lbl">${isPack ? 'Portfolio pack export' : `Report export · ${d.a.company.title}`}</span><h1 class="page-title">Prepare the PDF.</h1><p class="muted">The PDF is always light and print-safe.</p></div>
    ${segmented('mode', [{ key: 'report', label: 'Single report' }, { key: 'pack', label: 'Portfolio pack' }], d.mode, { label: 'Export type' })}
    <form class="stack-md" data-opts>
      <div class="card card-pad stack-sm">
        <span class="lbl">Branding</span>
        <div class="fld"><label for="ex-org">Organisation name</label><input id="ex-org" class="inp" name="org" value="${o.org}"></div>
        <p class="hint">Logo is set once for the whole organisation in <a class="link" href="/account?tab=brand">Account</a>.</p>
      </div>
      ${isPack ? html`<div class="card card-pad stack-sm">
        <span class="lbl">Period and companies</span>
        <div class="fld"><label for="ex-q">Quarter</label><select id="ex-q" class="inp" name="quarter">${quarters().map((x) => html`<option value="${x.key}"${x.key === o.quarter ? html` selected` : ''}>${x.label}</option>`)}</select></div>
        <label class="check"><input type="checkbox" name="all"${o.all ? html` checked` : ''}><span>All companies</span></label>
        ${o.all ? '' : html`<div class="ex-cos">${d.companies.filter((c) => c.latest).map((c) => html`<label class="check"><input type="checkbox" name="co" value="${c.id}"${o.selected.includes(c.id) ? html` checked` : ''}><span>${c.title}</span></label>`)}</div>`}
      </div>
      <div class="card card-pad stack-sm"><span class="lbl">Sections</span>${PACK_SECTIONS.map((s) => html`<label class="check"><input type="checkbox" name="sec" value="${s.k}"${o.sections[s.k] ? html` checked` : ''}><span>${s.label}</span></label>`)}</div>`
      : html`<div class="card card-pad stack-sm"><span class="lbl">Include</span>${REPORT_OPTS.map((t) => html`<label class="check"><input type="checkbox" name="${t.k}"${o[t.k] ? html` checked` : ''}><span class="check-copy"><span>${t.label}</span><span class="hint">${t.note}</span></span></label>`)}</div>`}
      <div class="card card-pad stack-sm">
        <div class="kv"><span class="muted">Format</span><b>A4, portrait</b></div>
        <div class="kv"><span class="muted">Pages</span><b>${pageCount}${isPack && o.sections.companies ? ' plus one per company' : ''}</b></div>
        <button type="button" class="btn btn-primary" data-print>Download PDF</button>
        ${isPack ? '' : html`<button type="button" class="btn" data-copy>Copy as text</button>`}
        <p class="hint">Opens your browser's print dialog. Choose "Save as PDF".</p>
      </div>
    </form>
  </section>
  <section aria-label="PDF preview" class="ex-preview">
    <div class="pdf-pages" data-pdf>${isPack ? packPages({ ...d, quarter: q }, o) : reportPages(d.a, o)}</div>
  </section>
</div>`;
  },

  mount(root, ctx, d) {
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    const form = root.querySelector('[data-opts]');
    const save = () => {
      const fd = new FormData(form);
      const prev = loadPref('export', {});
      const patch = { org: fd.get('org') };
      if (d.mode === 'pack') {
        patch.quarter = fd.get('quarter');
        patch.all = fd.get('all') === 'on';
        patch.selected = fd.getAll('co');
        patch.sections = Object.fromEntries(PACK_SECTIONS.map((s) => [s.k, fd.getAll('sec').includes(s.k)]));
      } else {
        REPORT_OPTS.forEach((t) => { patch[t.k] = fd.get(t.k) === 'on'; });
      }
      savePref('export', { ...prev, ...patch });
      ctx.refresh();
    };
    let t = null;
    form.addEventListener('change', save, opts);
    form.addEventListener('input', (e) => { if (e.target.name === 'org') { clearTimeout(t); t = setTimeout(save, 400); } }, opts);
    root.addEventListener('click', async (e) => {
      const seg = e.target.closest('[data-seg="mode"]');
      if (seg) ctx.navigate(seg.dataset.value === 'pack' ? '/export?mode=pack' : `/export?audit=${d.a ? d.a.id : SAMPLE.auditId}`, { replace: true });
      if (e.target.closest('[data-print]')) {
        await recordExport(d.a ? d.a.id : 'portfolio', d.mode === 'pack' ? 'Exported the portfolio pack PDF' : `Exported PDF for ${d.a.company.title}`);
        window.print();
      }
      if (e.target.closest('[data-copy]')) {
        try { await navigator.clipboard.writeText(reportText(d.a)); toast('Report copied as text.'); } catch { toast('Copy is not available in this browser.'); }
      }
    }, opts);
    document.body.classList.add('printing-pdf');
    return () => { clearTimeout(t); ac.abort(); document.body.classList.remove('printing-pdf'); };
  },
};

