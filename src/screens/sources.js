import { html } from '../lib/html.js';
import { getCompanies, getSources, SAMPLE } from '../data/repo.js';
import { AGENTS } from '../engine/config.js';
import { fmtDate, sevTag, emptyState } from '../components/ui.js';
import { companyPicker, mountCompanyPicker } from '../components/company-picker.js';

const TABS = [['all', 'All'], ['uploaded', 'Uploaded'], ['public', 'Public']];

export default {
  title: 'Sources · AVA',
  className: 'sources',

  async load(ctx) {
    const companies = await getCompanies();
    const companyId = ctx.query.get('company') || SAMPLE.companyId;
    return { companies, companyId, sources: await getSources(companyId) };
  },

  render(ctx, { companies, companyId, sources }) {
    const company = companies.find((c) => c.id === companyId);
    const filter = ctx.query.get('origin') || 'all';
    const shown = sources.filter((s) => filter === 'all' || s.type === filter);
    const cur = sources.find((s) => s.id === ctx.query.get('source')) || shown[0];
    const latestCites = cur ? cur.citedBy.filter((f) => f.latest) : [];
    const earlier = cur ? cur.citedBy.filter((f) => !f.latest) : [];
    return html`
<div class="page-head">
  <div class="page-head-copy"><span class="lbl">${company.title}</span><h1 class="page-title">Sources</h1><p class="muted page-sub">Every claim in a report traces back to a source here. Open one to see exactly which findings rely on it.</p></div>
  ${companyPicker(companies, companyId)}
</div>
${!sources.length ? emptyState({ title: 'No sources yet.', body: 'Sources appear when you upload material to the data room or when an agent cites a public page during an audit.', action: { href: `/data-room?company=${companyId}`, label: 'Upload to the data room' } }) : html`
<div class="split">
  <aside class="side">
    <div class="chips" role="group" aria-label="Filter by origin">${TABS.map(([k, l]) => html`<button type="button" class="chip-btn" data-origin="${k}" aria-pressed="${filter === k}">${l} (${sources.filter((s) => k === 'all' || s.type === k).length})</button>`)}</div>
    <div class="card src-list">${shown.map((s) => html`<button type="button" class="list-btn" data-source="${s.id}" aria-pressed="${cur && s.id === cur.id}"><span class="stack-sm src-li"><span>${s.title}</span><span class="xsmall muted">${s.type === 'uploaded' ? 'Uploaded' : 'Public'} · ${s.kind}${s.superseded ? ' · Superseded' : ''}</span></span><span class="mono xsmall">${s.citedBy.length}</span></button>`)}</div>
  </aside>
  <section class="body" aria-live="polite">
    ${cur ? html`<div class="card card-pad stack-md">
      <span class="lbl">${cur.type === 'uploaded' ? 'Uploaded' : 'Public'} · ${cur.kind}</span>
      <h2 class="r-h2">${cur.title}</h2>
      <p class="muted">${cur.note}</p>
      ${cur.url ? html`<p class="small"><a class="link" href="${cur.url}" target="_blank" rel="noopener" data-external>${cur.url}</a> <span class="muted">· Stored copy and hash kept with the audit snapshot.</span></p>` : ''}
      <div class="src-facts">
        <div><div class="lbl">${cur.type === 'uploaded' ? 'Added' : 'Retrieved'}</div><div class="strong">${fmtDate(cur.date)}</div></div>
        <div><div class="lbl">Added by</div><div class="strong">${cur.addedBy}</div></div>
        <div><div class="lbl">Cited by</div><div class="strong">${cur.citedBy.length} finding${cur.citedBy.length === 1 ? '' : 's'}</div></div>
        <div><div class="lbl">Reliability</div><div class="strong">${cur.reliability}</div></div>
      </div>
    </div>
    <div class="card card-pad stack-sm">
      <span class="lbl">Findings in the latest audit that cite this source</span>
      ${latestCites.length ? latestCites.map((f) => html`<a class="src-find" href="/report/${f.auditId}#f-${f.id}">${sevTag(f.severity)}<span class="stack-sm"><b>${f.title}</b><span class="xsmall muted">${AGENTS[f.agent - 1].name}</span></span></a>`) : html`<p class="hint">No finding in the latest audit cites this source.</p>`}
      ${earlier.length ? html`<details class="src-earlier"><summary class="small">Cited ${earlier.length} time${earlier.length === 1 ? '' : 's'} in earlier audits</summary>${earlier.map((f) => html`<a class="src-find" href="/report/${f.auditId}#f-${f.id}">${sevTag(f.severity)}<span class="stack-sm"><b>${f.title}</b><span class="xsmall muted">${fmtDate(f.auditDate)} · ${AGENTS[f.agent - 1].name}</span></span></a>`)}</details>` : ''}
    </div>` : html`<div class="card card-pad muted">No sources match this filter.</div>`}
  </section>
</div>`}`;
  },

  mount(root, ctx) {
    const ac = new AbortController();
    const go = (patch) => {
      const q = new URLSearchParams(window.location.search);
      Object.entries(patch).forEach(([k, v]) => (v === null ? q.delete(k) : q.set(k, v)));
      ctx.navigate(`/sources?${q}`, { replace: true });
    };
    root.addEventListener('click', (e) => {
      const o = e.target.closest('[data-origin]');
      if (o) go({ origin: o.dataset.origin, source: null });
      const s = e.target.closest('[data-source]');
      if (s) go({ source: s.dataset.source });
    }, { signal: ac.signal });
    mountCompanyPicker(root, ctx, '/sources', ac.signal);
    return () => ac.abort();
  },
};
