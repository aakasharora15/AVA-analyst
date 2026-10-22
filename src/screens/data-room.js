import { html } from '../lib/html.js';
import { getCompanies, getSources, uploadFiles, can, SAMPLE } from '../data/repo.js';
import { AGENTS, SECTIONS } from '../engine/config.js';
import { fmtDate, icon, emptyState } from '../components/ui.js';
import { companyPicker, mountCompanyPicker } from '../components/company-picker.js';
import { toast } from '../components/sheet.js';

const level = (pct) => (pct >= 70 ? ['COVERED', 'v-proceed verdict'] : pct >= 40 ? ['PARTIAL', 'sev-medium'] : pct > 0 ? ['THIN', 'sev-high'] : ['NOT COVERED', 'sev-high']);

export default {
  title: 'Data room · AVA',
  className: 'data-room',

  async load(ctx) {
    const companies = await getCompanies();
    const companyId = ctx.query.get('company') || SAMPLE.companyId;
    return { companies, companyId, sources: (await getSources(companyId)).filter((s) => s.type === 'uploaded') };
  },

  render(ctx, { companies, companyId, sources }) {
    const company = companies.find((c) => c.id === companyId);
    const cur = sources.find((s) => s.id === ctx.query.get('file')) || sources.find((s) => s.citedBy.length) || sources[0];
    const thin = company.coverage.filter((c) => c.pct < 40).map((c) => c.topic);
    const allowed = can('upload');
    return html`
<div class="page-head">
  <div class="page-head-copy"><span class="lbl">${company.title}</span><h1 class="page-title">Data room</h1><p class="muted page-sub">Everything AVA has read about this company, and which findings rely on it.</p></div>
  <div class="row-actions">${companyPicker(companies, companyId)}${allowed ? html`<label class="btn btn-primary dr-upload" for="dr-files">${icon('upload', { size: 18 })}Upload files</label>` : ''}</div>
</div>
<input id="dr-files" type="file" multiple class="sr-only" data-dr-files accept=".pdf,.xlsx,.xls,.csv,.ppt,.pptx,.doc,.docx,.txt">
<div class="split">
  <aside class="side">
    <div class="card card-pad stack-sm">
      <span class="lbl">Coverage by topic</span>
      ${company.coverage.map((c) => { const [l, cls] = level(c.pct); return html`<div class="dr-cov"><span class="small">${c.topic}</span><span class="tag ${cls}">${l}</span><span class="bar"><span class="fill-${c.pct >= 70 ? 'low' : c.pct >= 40 ? 'medium' : 'high'}" style="width:${c.pct}%"></span></span></div>`; })}
    </div>
    ${thin.length ? html`<div class="banner banner-warn"><div class="stack-sm"><b>Add material on: ${thin.join(', ')}.</b><span class="small">Thin topics weaken the audit. The Sentinel skips legal and IP when no material is supplied.</span></div></div>` : ''}
  </aside>
  <section class="body" aria-label="Files">
    ${allowed ? html`<div class="card card-pad dr-drop" data-drop tabindex="-1">
      <div class="stack-sm"><b>Drop decks, metrics or board updates here</b><span class="small muted">PDF, spreadsheet, slides. New files are read before the next audit.</span></div>
      <label class="btn" for="dr-files">Choose files</label>
    </div>` : html`<div class="banner"><b>Your role can view the data room but not upload.</b></div>`}
    ${!sources.length ? emptyState({ title: 'No files yet.', body: 'Upload the deck, financial model and board updates. Findings will cite them, and coverage by topic fills in as AVA reads them.' }) : html`
    <div class="dr-table">
      <div class="dr-row lbl" aria-hidden="true"><span>File</span><span>Added</span><span>Status</span><span>Cited by</span></div>
      <ul class="dr-list" aria-label="Files">
      ${sources.map((s) => html`<li><button type="button" class="card dr-row" data-file="${s.id}" aria-pressed="${cur && s.id === cur.id}">
        <span class="stack-sm"><span class="strong">${s.title}</span><span class="xsmall muted">${s.kind} · ${s.addedBy}</span></span>
        <span class="small">${fmtDate(s.date)}</span>
        <span><span class="tag ${s.status === 'reading' ? 'sev-low' : s.superseded ? 'tag-neutral' : 'v-proceed verdict'}">${s.status === 'reading' ? 'READING' : s.superseded ? 'SUPERSEDED' : 'READ'}</span></span>
        <span class="small">${s.citedBy.filter((f) => f.latest).length} findings</span>
      </button></li>`)}
      </ul>
    </div>
    ${cur ? html`<div class="card card-pad stack-sm" aria-live="polite">
      <div class="r-sec-head"><b class="strong">${cur.title}</b><span class="lbl">Findings that cite this file</span></div>
      ${cur.citedBy.filter((f) => f.latest).map((u) => html`<a class="src-find" href="/report/${u.auditId}#f-${u.id}"><span class="tag tag-neutral">${AGENTS[u.agent - 1].name}</span><span class="stack-sm"><b>${SECTIONS.find((x) => x.id === u.section).title}</b><span class="small muted">${u.title}</span></span></a>`)}
      ${cur.citedBy.filter((f) => f.latest).length ? '' : html`<p class="hint">${cur.status === 'reading' ? 'AVA is reading this file. It will be used in the next audit.' : 'No finding in the current audit relies on this file. It may have been used in an earlier snapshot.'}</p>`}
    </div>` : ''}`}
  </section>
</div>`;
  },

  mount(root, ctx, { companyId }) {
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    const doUpload = async (list) => {
      if (!list.length) return;
      try {
        await uploadFiles(companyId, [...list].map((f) => ({ name: f.name, size: f.size })));
        toast(`${list.length} file${list.length === 1 ? '' : 's'} uploaded. Reading now.`);
        ctx.refresh();
        setTimeout(() => ctx.refresh(), 2700);
      } catch (err) { toast(err.message); }
    };
    root.addEventListener('change', (e) => { if (e.target.matches('[data-dr-files]')) doUpload(e.target.files); }, opts);
    root.addEventListener('click', (e) => {
      const f = e.target.closest('[data-file]');
      if (f) ctx.navigate(`/data-room?company=${companyId}&file=${f.dataset.file}`, { replace: true });
    }, opts);
    const drop = root.querySelector('[data-drop]');
    if (drop) {
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); }, opts);
      drop.addEventListener('dragleave', () => drop.classList.remove('over'), opts);
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); doUpload(e.dataTransfer.files); }, opts);
    }
    mountCompanyPicker(root, ctx, '/data-room', ac.signal);
    return () => ac.abort();
  },
};
