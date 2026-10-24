import { html } from '../lib/html.js';
import { MODE, DEMO, getCompanies, getOrg, importCompanies, existingTitles, can, effectiveCadence } from '../data/repo.js';
import { fmtDate, verdictTag, deltaText, deltaClass, vClass, TYPE_LABEL, segmented, icon } from '../components/ui.js';
import { openSheet, toast } from '../components/sheet.js';
import { DIRECTIVES, VENTURE_TYPES } from '../engine/config.js';
import { INDUSTRIES } from './new-analysis.js';
import { load as loadPref, save as savePref } from '../lib/storage.js';

const FILTERS = [{ key: 'ALL', label: 'All' }, ...[...DIRECTIVES].reverse().map((d) => ({ key: d, label: d[0] + d.slice(1).toLowerCase() }))];
const SORTS = { score: 'Lowest score first', change: 'Biggest fall first', date: 'Most recent audit', name: 'Name' };

function sortRows(rows, sort) {
  const r = rows.slice();
  if (sort === 'score') r.sort((a, b) => (a.latest?.score ?? 999) - (b.latest?.score ?? 999));
  if (sort === 'change') r.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
  if (sort === 'date') r.sort((a, b) => (b.latest?.date || '').localeCompare(a.latest?.date || ''));
  if (sort === 'name') r.sort((a, b) => a.title.localeCompare(b.title));
  return r;
}

function nextAuditLabel(c, org) {
  const mode = effectiveCadence(c, org);
  if (c.cadence.paused) return html`<span class="tag tag-neutral">Paused</span>${c.cadence.resumeOn ? html`<span class="xsmall muted">until ${fmtDate(c.cadence.resumeOn)}</span>` : ''}`;
  if (mode === 'off' || !c.cadence.nextRun) return html`<span class="muted small">Manual only</span>`;
  return html`<span class="small">${fmtDate(c.cadence.nextRun)}</span>`;
}

function rowsView(rows, org) {
  if (!rows.length) return html`<div class="card card-pad muted">No companies match this filter. <button type="button" class="link-btn" data-clear>Clear the filters</button></div>`;
  return html`<div class="pf-table">
  <div class="pf-row pf-headrow lbl" aria-hidden="true"><span>Company</span><span>Score</span><span>Directive</span><span>Since last audit</span><span>Last audit</span><span>Next audit</span></div>
  <ul class="pf-list" aria-label="Companies">
  ${rows.map((c) => html`<li><a class="card pf-row ${c.latest ? vClass(c.latest.finalDirective) : ''}" href="/company/${c.id}">
    <span class="pf-name"><b>${c.title}</b><span class="xsmall muted">${c.industry} · ${TYPE_LABEL[c.type]}</span></span>
    <span class="pf-score">${c.latest ? html`<span class="num pf-num">${c.latest.score}</span><span class="bar pf-bar"><span style="width:${c.latest.score}%;background:var(--v)"></span></span>` : html`<span class="muted small">Not audited</span>`}</span>
    <span>${c.running ? html`<span class="tag sev-low">RUNNING</span>` : c.latest ? verdictTag(c.latest.finalDirective) : html`<span class="tag tag-neutral">NONE</span>`}${c.latest && c.latest.status === 'partial' ? html` <span class="xsmall muted">Partial</span>` : ''}</span>
    <span class="small strong ${deltaClass(c.delta)}">${c.latest ? deltaText(c.delta, { long: true }) : ''}</span>
    <span class="small muted">${c.latest ? fmtDate(c.latest.date) : ''}</span>
    <span class="pf-next">${nextAuditLabel(c, org)}</span>
  </a></li>`)}
  </ul>
</div>`;
}

// ---------------------------------------------------------------------------
// CSV import wizard (spec 4.5)

const FIELDS = [
  { key: 'title', label: 'Title', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'industry', label: 'Industry', required: true },
  { key: 'country', label: 'Country', required: true },
  { key: 'type', label: 'Type' },
  { key: 'city', label: 'City or region' },
  { key: 'stage', label: 'Stage' },
];
const TEMPLATE = 'title,description,industry,country,type,city,stage\nExample Ltd,What it does and who pays,SaaS / Technology,United Kingdom,startup,London,Seed\n';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const COUNTRIES_OK = (v) => /^[A-Za-z][A-Za-z .'-]{1,55}$/.test(v);

export function validateRows(rows, existing) {
  const seen = new Map();
  return rows.map((r, i) => {
    const issues = [];
    FIELDS.filter((f) => f.required).forEach((f) => { if (!String(r[f.key] || '').trim()) issues.push(`Missing ${f.label.toLowerCase()}`); });
    if (r.industry && !INDUSTRIES.includes(r.industry)) issues.push(`Unknown industry "${r.industry}"`);
    if (r.country && !COUNTRIES_OK(r.country)) issues.push(`Unknown country "${r.country}"`);
    if (r.type && !VENTURE_TYPES.includes(r.type)) issues.push(`Unknown type "${r.type}"`);
    const t = String(r.title || '').trim().toLowerCase();
    if (t && existing.includes(t)) issues.push('Duplicate of an existing company');
    if (t && seen.has(t)) issues.push(`Duplicate of row ${seen.get(t) + 1}`);
    if (t) seen.set(t, i);
    return { ...r, type: r.type || 'startup', row: i, issues };
  });
}

function openImport(ctx) {
  const state = { step: 1, fileName: '', header: [], data: [], map: {}, rows: [], skip: new Set() };
  const steps = ['Upload', 'Map columns', 'Validate', 'Review and create'];

  const bodyFor = () => {
    const stepper = html`<ol class="wiz-steps" aria-label="Import steps">${steps.map((s, i) => html`<li class="${i + 1 === state.step ? 'on' : i + 1 < state.step ? 'done' : ''}"${i + 1 === state.step ? html` aria-current="step"` : ''}><span class="mono">${i + 1}</span>${s}</li>`)}</ol>`;
    if (state.step === 1) {
      return html`${stepper}<div class="inner stack-md">
        <p class="small">Upload a CSV with one company per row. Title, description, industry and country are required. Type defaults to startup.</p>
        <div class="row-actions"><label class="btn btn-primary" for="imp-file">${icon('upload', { size: 18 })}Choose CSV</label><input id="imp-file" type="file" accept=".csv,text/csv" class="sr-only" data-imp-file><a class="btn" data-external download="ava-import-template.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}">Download template</a></div>
        <p class="hint">Or <button type="button" class="link-btn" data-imp-sample>use a sample file</button> to try the flow.</p>
        <p class="err" data-imp-err></p>
      </div>`;
    }
    if (state.step === 2) {
      const isMapped = (k) => state.map[k] !== undefined && state.map[k] !== '';
      const missing = FIELDS.filter((f) => f.required && !isMapped(f.key));
      return html`${stepper}<form class="stack-md" data-imp-map>
        <p class="small muted">${state.fileName}: ${state.data.length} rows. Match each AVA field to a column.</p>
        <div class="grid-2">${FIELDS.map((f) => html`<div class="fld"><label for="map-${f.key}">${f.label}${f.required ? html` <span class="req" aria-hidden="true">*</span>` : ''}</label>
          <select id="map-${f.key}" class="inp" data-map="${f.key}"><option value="">Not mapped</option>${state.header.map((h, i) => html`<option value="${i}"${String(state.map[f.key]) === String(i) ? html` selected` : ''}>${h}</option>`)}</select>
          ${f.key === 'type' && !isMapped('type') ? html`<span class="hint">Not mapped: every row will be imported as a startup.</span>` : ''}</div>`)}</div>
        ${missing.length ? html`<p class="err" role="alert">Map the required fields to continue: ${missing.map((f) => f.label).join(', ')}.</p>` : ''}
        <div class="row-actions"><button type="button" class="btn" data-imp-back>Back</button><button type="submit" class="btn btn-primary"${missing.length ? html` disabled` : ''}>Validate rows</button></div>
      </form>`;
    }
    if (state.step === 3) {
      const bad = state.rows.filter((r) => r.issues.length && !state.skip.has(r.row));
      return html`${stepper}<div class="stack-md">
        <p class="small"><b>${state.rows.filter((r) => !r.issues.length).length}</b> valid, <b>${state.rows.filter((r) => r.issues.length).length}</b> with problems. Fix a row inline or skip it.</p>
        <ul class="stack-sm">${state.rows.map((r) => html`<li class="inner imp-row${r.issues.length ? ' bad' : ''}${state.skip.has(r.row) ? ' skipped' : ''}">
          <div class="imp-row-head"><b>Row ${r.row + 1}: ${r.title || 'Untitled'}</b>${r.issues.length ? (state.skip.has(r.row) ? html`<button type="button" class="link-btn" data-unskip="${r.row}">Include</button>` : html`<button type="button" class="link-btn" data-skip="${r.row}">Skip row</button>`) : html`<span class="tag v-proceed verdict">VALID</span>`}</div>
          ${r.issues.length && !state.skip.has(r.row) ? html`<ul class="err small">${r.issues.map((x) => html`<li>${x}</li>`)}</ul>
          <div class="grid-2">${['title', 'industry', 'country', 'type'].map((k) => html`<div class="fld"><label for="fix-${r.row}-${k}">${k[0].toUpperCase() + k.slice(1)}</label>${k === 'industry' ? html`<select id="fix-${r.row}-${k}" class="inp" data-fix="${r.row}" data-k="${k}"><option value="">Select</option>${INDUSTRIES.map((o) => html`<option${o === r[k] ? html` selected` : ''}>${o}</option>`)}</select>` : k === 'type' ? html`<select id="fix-${r.row}-${k}" class="inp" data-fix="${r.row}" data-k="${k}">${VENTURE_TYPES.map((o) => html`<option${o === r[k] ? html` selected` : ''}>${o}</option>`)}</select>` : html`<input id="fix-${r.row}-${k}" class="inp" data-fix="${r.row}" data-k="${k}" value="${r[k] || ''}">`}</div>`)}</div>` : ''}
        </li>`)}</ul>
        <div class="row-actions"><button type="button" class="btn" data-imp-back>Back</button><button type="button" class="btn" data-imp-revalidate>Re-check</button><button type="button" class="btn btn-primary" data-imp-next${bad.length ? html` disabled` : ''}>Continue</button></div>
        ${bad.length ? html`<p class="hint">Fix or skip ${bad.length} row${bad.length === 1 ? '' : 's'} to continue.</p>` : ''}
      </div>`;
    }
    const ok = state.rows.filter((r) => !r.issues.length && !state.skip.has(r.row));
    return html`${stepper}<form class="stack-md" data-imp-create>
      <p class="small">Creates <b>${ok.length}</b> compan${ok.length === 1 ? 'y' : 'ies'}. ${state.skip.size ? `${state.skip.size} row${state.skip.size === 1 ? '' : 's'} skipped.` : ''} Import creates companies, not audits.</p>
      <ul class="inner stack-sm small">${ok.map((r) => html`<li><b>${r.title}</b> · ${r.industry} · ${r.country} · ${TYPE_LABEL[r.type]}</li>`)}</ul>
      <div class="fld"><label for="imp-cad">Monitoring cadence for all</label><select id="imp-cad" class="inp" name="cadence"><option value="">Use organisation default</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="off">Off</option></select></div>
      <label class="check"><input type="checkbox" name="auditAll"><span class="check-copy"><span>Audit all now</span><span class="hint">Uses ${ok.length} audit${ok.length === 1 ? '' : 's'} from this month's allowance.</span></span></label>
      <div class="row-actions"><button type="button" class="btn" data-imp-back>Back</button><button type="submit" class="btn btn-primary">Create companies</button></div>
    </form>`;
  };

  const sheet = openSheet({ title: 'Import companies', body: bodyFor(), wide: true, onMount: (el, close) => {
    const rerender = () => { el.querySelector('.sheet-body').innerHTML = String(bodyFor()); };
    const fromRows = async (rows) => {
      state.header = rows[0];
      state.data = rows.slice(1);
      state.map = {};
      const SYNONYMS = { title: ['title', 'name', 'company', 'companyname', 'venture'], description: ['description', 'summary', 'about'], industry: ['industry', 'sector'], country: ['country'], type: ['type', 'venturetype'], city: ['city', 'region', 'cityorregion', 'location'], stage: ['stage', 'round'] };
      const norm = (h) => h.trim().toLowerCase().replace(/[^a-z]/g, '');
      FIELDS.forEach((f) => {
        const i = state.header.findIndex((h) => SYNONYMS[f.key].includes(norm(h)));
        if (i >= 0) state.map[f.key] = i;
      });
      state.step = 2;
      rerender();
    };
    const validate = async () => {
      const existing = await existingTitles();
      state.rows = validateRows(state.data.map((cells, i) => {
        const prev = state.rows.find((r) => r.row === i);
        if (prev && prev.edited) return prev;
        return Object.fromEntries(FIELDS.map((f) => [f.key, state.map[f.key] !== undefined && state.map[f.key] !== '' ? String(cells[state.map[f.key]] || '').trim() : '']));
      }), existing);
    };
    el.addEventListener('change', async (e) => {
      if (e.target.matches('[data-imp-file]')) {
        const file = e.target.files[0];
        if (!file) return;
        state.fileName = file.name;
        const rows = parseCsv(await file.text());
        if (rows.length < 2) { el.querySelector('[data-imp-err]').textContent = 'That file has no data rows.'; return; }
        fromRows(rows);
      }
      if (e.target.matches('[data-map]')) { state.map[e.target.dataset.map] = e.target.value; rerender(); }
      if (e.target.matches('[data-fix]')) {
        const r = state.rows.find((x) => x.row === Number(e.target.dataset.fix));
        r[e.target.dataset.k] = e.target.value;
        r.edited = true;
      }
    });
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-imp-sample]')) {
        state.fileName = 'sample-portfolio.csv';
        fromRows(parseCsv('Company name,Description,Industry,Country,City\nFernway Robotics,Warehouse picking robots leased per month,SaaS / Technology,United Kingdom,Sheffield\nHarlow Kitchens,Dark kitchen brand for office lunches,Food and Beverage,United Kingdom,London\nQuillpay,Duplicate test row,Finance / Fintech,United Kingdom,London\nTidewater Labs,,Healthcare,United Kingdom,Bristol\nNimbus Lettings,Lettings platform for students,Property,United Kingdom,Leeds\n'));
      }
      if (e.target.closest('[data-imp-back]')) { state.step -= 1; rerender(); }
      if (e.target.closest('[data-skip]')) { state.skip.add(Number(e.target.closest('[data-skip]').dataset.skip)); rerender(); }
      if (e.target.closest('[data-unskip]')) { state.skip.delete(Number(e.target.closest('[data-unskip]').dataset.unskip)); rerender(); }
      if (e.target.closest('[data-imp-revalidate]')) {
        const existing = await existingTitles();
        state.rows = validateRows(state.rows, existing).map((r) => ({ ...r, edited: true }));
        rerender();
      }
      if (e.target.closest('[data-imp-next]')) { state.step = 4; rerender(); }
    });
    el.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (e.target.matches('[data-imp-map]')) { await validate(); state.step = 3; rerender(); }
      if (e.target.matches('[data-imp-create]')) {
        const ok = state.rows.filter((r) => !r.issues.length && !state.skip.has(r.row));
        const fd = new FormData(e.target);
        const { created } = await importCompanies(ok, { fileName: state.fileName, cadence: fd.get('cadence') || null, auditAll: fd.get('auditAll') === 'on' });
        close();
        toast(`Imported ${created.length} compan${created.length === 1 ? 'y' : 'ies'}.`);
        ctx.refresh();
      }
    });
  } });
  return sheet;
}

// ---------------------------------------------------------------------------

export default {
  title: 'Portfolio · AVA',
  className: 'portfolio',

  async load() {
    const [companies, org] = await Promise.all([getCompanies(), getOrg()]);
    return { companies, org };
  },

  render(ctx, { companies, org }) {
    const pref = loadPref('portfolio', { filter: 'ALL', sort: 'score', type: 'all', view: 'list' });
    const empty = (MODE === 'mock' && !DEMO && pref.view === 'empty') || companies.length === 0;
    const scored = companies.filter((c) => c.latest);
    const mix = Object.fromEntries(DIRECTIVES.map((d) => [d, scored.filter((c) => c.latest.finalDirective === d).length]));
    const avg = scored.length ? (scored.reduce((s, c) => s + c.latest.score, 0) / scored.length).toFixed(1) : '–';
    const down = scored.filter((c) => c.delta < 0).length;
    const movers = scored.filter((c) => c.delta !== null).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
    const unread = companies.reduce((s, c) => s + c.unreadAlerts, 0);
    let rows = companies.filter((c) => (pref.filter === 'ALL' || c.latest?.finalDirective === pref.filter) && (pref.type === 'all' || c.type === pref.type));
    rows = sortRows(rows, pref.sort);

    return html`
<div class="page-head">
  <div class="page-head-copy"><h1 class="page-title">Portfolio risk overview</h1><p class="muted page-sub">Every monitored company, its current verdict and which way it is moving. Sample data.</p></div>
  <div class="row-actions">
    ${can('runAudits') ? html`<button type="button" class="btn" data-import>${icon('upload', { size: 18 })}Import CSV</button>` : ''}
    ${MODE === 'mock' && !DEMO ? segmented('view', [{ key: 'list', label: 'Populated' }, { key: 'empty', label: 'First use' }], empty ? 'empty' : 'list', { label: 'Preview state' }) : ''}
  </div>
</div>
${empty ? html`
<section aria-label="First use" class="pf-first">
  <div class="card pf-first-card">
    <h2 class="empty-title">No companies yet.</h2>
    <p class="muted">Add a company to run its first audit, or import your portfolio from a CSV. Every later audit is stored as a dated snapshot, so you can see how its risk moves over time.</p>
    <div class="row-actions"><a class="btn btn-primary btn-lg" href="/new-analysis">Run the first audit</a><button type="button" class="btn btn-lg" data-import>Import a CSV</button></div>
  </div>
  <ol class="pf-steps">
    <li class="card"><span class="lbl">01</span><span><b>Describe the company.</b><br><span class="muted small">Five required fields. More detail gives a sharper audit.</span></span></li>
    <li class="card"><span class="lbl">02</span><span><b>Six agents attack it in sequence.</b><br><span class="muted small">Each reads the findings before it. Typical run time is a few minutes.</span></span></li>
    <li class="card"><span class="lbl">03</span><span><b>Read the verdict, then re-audit.</b><br><span class="muted small">Comparison needs two audits, so the first one sets the baseline.</span></span></li>
  </ol>
</section>` : html`
<section aria-label="Portfolio at a glance" class="pf-glance">
  <div class="hero-panel pf-mix">
    <div class="stars" aria-hidden="true"></div>
    <div class="pf-mix-head"><span class="lbl">Directive mix</span>${unread ? html`<a href="/alerts" class="tag tag-on-hero">${unread} unread alert${unread === 1 ? '' : 's'}</a>` : ''}</div>
    <div class="pf-mix-big"><span class="hero-num">${scored.length}</span><span class="pf-mix-copy">companies scored. ${down} moved down since their last audit.</span></div>
    <div class="pf-mix-bar" role="img" aria-label="Directive mix: ${[...DIRECTIVES].reverse().map((d) => `${mix[d]} ${d}`).join(', ')}">${[...DIRECTIVES].reverse().map((d) => (mix[d] ? html`<span class="${vClass(d)}" style="flex:${mix[d]}"></span>` : ''))}</div>
    <div class="pf-mix-grid">${[...DIRECTIVES].reverse().map((d) => html`<div class="${vClass(d)}"><div class="lbl">${d[0] + d.slice(1).toLowerCase()}</div><div class="pf-mix-n">${mix[d]}</div></div>`)}</div>
  </div>
  <div class="pf-stats">
    <div class="card pf-stat"><span class="lbl">Average score</span><span class="num pf-stat-n">${avg}</span><span class="xsmall muted">Across ${scored.length} scored companies. Types are not compared.</span></div>
    <div class="card pf-stat"><span class="lbl">Moved down</span><span class="num pf-stat-n">${down} <span class="pf-of">of ${scored.length}</span></span><span class="xsmall muted">Since their last audit</span></div>
  </div>
</section>

<section aria-labelledby="movers-title" class="stack-sm">
  <span class="lbl" id="movers-title">Biggest movers since last audit</span>
  <div class="pf-movers">${movers.map((c) => html`<a href="/company/${c.id}" class="card pf-mover">
    <b>${c.title}</b>
    <span class="row-actions"><span class="num pf-mover-n">${c.previous.score} → ${c.latest.score}</span>${verdictTag(c.latest.finalDirective)}</span>
    <span class="xsmall ${deltaClass(c.delta)}">${deltaText(c.delta)}${c.previous.calibrationVersion !== c.latest.calibrationVersion ? html`<span class="muted"> · different calibration version</span>` : ''}</span>
  </a>`)}</div>
</section>

<section aria-label="Companies" class="stack-md">
  <div class="pf-controls">
    <div class="chips" role="group" aria-label="Filter by directive">${FILTERS.map((f) => html`<button type="button" class="chip-btn" data-filter="${f.key}" aria-pressed="${pref.filter === f.key}">${f.label}</button>`)}</div>
    <div class="row-actions">
      <label class="pf-select small">Type <select class="inp" data-type-filter id="pf-type">${[['all', 'All types'], ...Object.entries(TYPE_LABEL)].map(([k, l]) => html`<option value="${k}"${pref.type === k ? html` selected` : ''}>${l}</option>`)}</select></label>
      <label class="pf-select small">Sort <select class="inp" data-sort id="pf-sort">${Object.entries(SORTS).map(([k, l]) => html`<option value="${k}"${pref.sort === k ? html` selected` : ''}>${l}</option>`)}</select></label>
    </div>
  </div>
  ${rowsView(rows, org)}
</section>`}`;
  },

  mount(root, ctx) {
    const set = (patch) => {
      savePref('portfolio', { ...loadPref('portfolio', { filter: 'ALL', sort: 'score', type: 'all', view: 'list' }), ...patch });
      ctx.refresh();
    };
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    root.addEventListener('click', (e) => {
      const f = e.target.closest('[data-filter]');
      if (f) set({ filter: f.dataset.filter });
      if (e.target.closest('[data-clear]')) set({ filter: 'ALL', type: 'all' });
      const seg = e.target.closest('[data-seg="view"]');
      if (seg) set({ view: seg.dataset.value });
      if (e.target.closest('[data-import]')) openImport(ctx);
    }, opts);
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-sort]')) set({ sort: e.target.value });
      if (e.target.matches('[data-type-filter]')) set({ type: e.target.value });
    }, opts);
    return () => ac.abort();
  },
};
