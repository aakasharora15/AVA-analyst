import { html } from '../lib/html.js';
import { getOutcomeRows, logOutcome, can } from '../data/repo.js';
import { OUTCOMES, AGREES_WITH, agreementRate } from '../engine/outcomes.js';
import { OUTCOME_WINDOW } from '../engine/config.js';
import { fmtDate, verdictTag, emptyState, TYPE_LABEL } from '../components/ui.js';
import { openSheet, toast } from '../components/sheet.js';

const STATUS = {
  'too-early': ['Too early', 'tag-neutral'],
  awaiting: ['Awaiting outcome', 'sev-low'],
  agrees: ['Agrees', 'v-proceed verdict'],
  'not-yet-resolved': ['Not yet resolved', 'sev-medium'],
  disagrees: ['Disagrees', 'sev-high'],
};
const FILTERS = [['all', 'All'], ['awaiting', 'Awaiting'], ['agrees', 'Agrees'], ['disagrees', 'Disagrees'], ['not-yet-resolved', 'Not yet resolved'], ['too-early', 'Too early']];

function openLog(row, ctx) {
  const today = new Date().toISOString().slice(0, 10);
  openSheet({
    title: `Log outcome: ${row.company}`,
    body: html`<div class="inner small stack-sm">
      <div class="kv"><span class="muted">Audit</span><b>${fmtDate(row.date)} · ${row.score} · ${row.finalDirective}</b></div>
      <div class="kv"><span class="muted">Checkpoints (fixed at issue)</span><b>${fmtDate(row.firstCheckpoint)} and ${fmtDate(row.finalCheckpoint)}</b></div>
      <div class="kv"><span class="muted">Agrees with ${row.finalDirective}</span><b>${AGREES_WITH[row.finalDirective].map((k) => OUTCOMES[k].label).join(' or ')}</b></div>
    </div>
    <form class="stack-md" data-outcome novalidate>
      <fieldset class="stack-sm"><legend class="fld-label">What happened <span class="req" aria-hidden="true">*</span></legend>
        ${Object.entries(OUTCOMES).map(([k, o]) => html`<label class="check"><input type="radio" name="result" value="${k}"${row.outcome?.result === k ? html` checked` : ''}><span class="check-copy"><span>${o.label}${o.terminal ? ' · final whenever logged' : ''}</span><span class="hint">${o.definition}</span></span></label>`)}
      </fieldset>
      <label class="check" data-below hidden><input type="checkbox" name="below"><span class="check-copy"><span>Sold below the last valuation</span><span class="hint">An acquisition below the last valuation is always Written down or distressed sale.</span></span></label>
      <div class="grid-2">
        <div class="fld"><label for="oc-date">Outcome date <span class="req" aria-hidden="true">*</span></label><input id="oc-date" type="date" class="inp" name="date" max="${today}" value="${row.outcome?.date || today}"></div>
        <div class="fld"><label for="oc-kind">Evidence type</label><select id="oc-kind" class="inp" name="kind"><option value="note">Note</option><option value="link">Link</option><option value="document">Document</option></select></div>
      </div>
      <div class="fld"><label for="oc-ev">Evidence <span class="req" aria-hidden="true">*</span></label><textarea id="oc-ev" class="inp" rows="3" name="evidence" aria-describedby="oc-err">${row.outcome?.evidence?.value || ''}</textarea></div>
      <p class="err" id="oc-err" data-oc-err role="alert"></p>
      <p class="hint">Logged with your name and the time. Changes go to the audit log.</p>
      <button type="submit" class="btn btn-primary">Save outcome</button>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('[data-outcome]');
      const sync = () => { el.querySelector('[data-below]').hidden = form.elements.result.value !== 'exited'; };
      sync();
      form.addEventListener('change', sync);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = el.querySelector('[data-oc-err]');
        const fd = new FormData(form);
        if (!fd.get('result')) { err.textContent = 'Choose what happened.'; return; }
        if (!fd.get('date')) { err.textContent = 'Enter the outcome date.'; return; }
        if (!String(fd.get('evidence') || '').trim()) { err.textContent = 'Add evidence: a note, link or document name.'; form.elements.evidence.focus(); return; }
        if (fd.get('result') === 'exited' && fd.get('below') === 'on') { err.textContent = 'An acquisition below the last valuation is logged as Written down or distressed sale.'; return; }
        try {
          await logOutcome(row.auditId, { result: fd.get('result'), date: fd.get('date'), evidence: { kind: fd.get('kind'), value: String(fd.get('evidence')).trim() } });
          close();
          toast('Outcome logged.');
          ctx.refresh();
        } catch (ex) { err.textContent = ex.message; }
      });
    },
  });
}

export default {
  title: 'Outcomes · AVA',
  className: 'outcomes',

  async load() { return { rows: await getOutcomeRows() }; },

  render(ctx, { rows }) {
    const f = ctx.query.get('filter') || 'all';
    const list = rows.filter((r) => f === 'all' || r.status === f).sort((a, b) => a.firstCheckpoint.localeCompare(b.firstCheckpoint));
    const rate = agreementRate(rows.map((r) => r.status));
    const n = 12;
    const filled = rate.counted ? Math.round((rate.agreed / rate.counted) * n) : 0;
    const canLog = can('findingStatus');
    return html`
<div class="page-head"><div class="page-head-copy"><span class="lbl">Sample data</span><h1 class="page-title">Outcomes</h1><p class="muted page-sub">Record what actually happened after each verdict. AVA compares it with the final directive, so you can see how far to trust it.</p></div></div>
<div class="split">
  <aside class="side">
    <div class="hero-panel oc-rate">
      <div class="stars" aria-hidden="true"></div>
      <span class="lbl">Directive and outcome agreed</span>
      <div class="oc-big"><span class="hero-num">${rate.agreed}</span><span class="r-of"> of ${rate.counted}</span></div>
      <div class="oc-segs" role="img" aria-label="${rate.agreed} of ${rate.counted} resolved outcomes agreed with the final directive">${Array.from({ length: n }, (_, i) => html`<span class="${i < filled ? 'on' : ''}"></span>`)}</div>
      <span class="small">${rows.filter((r) => r.status === 'too-early').length} too early and ${rows.filter((r) => r.status === 'not-yet-resolved' || r.status === 'awaiting').length} unresolved are excluded.</span>
    </div>
    <div class="card card-pad stack-sm">
      <span class="lbl">How agreement is read</span>
      ${Object.entries(AGREES_WITH).reverse().map(([d, ks]) => html`<div class="kv">${verdictTag(d)}<span class="small">${ks.map((k) => OUTCOMES[k].label).join(' or ')}</span></div>`)}
      <p class="hint">Measured against the final directive, after any override. AVA sets the window, not the user: checkpoints at ${OUTCOME_WINDOW.firstMonths} and ${OUTCOME_WINDOW.finalMonths} months, written when the audit is issued and never edited. Small samples mislead; treat this as a trend.</p>
    </div>
  </aside>
  <section class="body" aria-label="Audits">
    <div class="chips" role="group" aria-label="Filter audits">${FILTERS.map(([k, l]) => html`<button type="button" class="chip-btn" data-filter="${k}" aria-pressed="${f === k}">${l} (${rows.filter((r) => k === 'all' || r.status === k).length})</button>`)}</div>
    ${list.length ? html`<ul class="stack-sm">${list.map((r) => html`<li class="card oc-row">
      <div class="r-sec-head"><span class="stack-sm"><a class="strong" href="/history/${r.companyId}">${r.company}</a><span class="lbl">Audited ${fmtDate(r.date)} · score ${r.score} · ${TYPE_LABEL[r.type]}</span></span><span class="row-actions">${verdictTag(r.finalDirective)}<span class="tag ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span></span></div>
      <div class="oc-meta small"><span><span class="muted">First checkpoint</span> ${fmtDate(r.firstCheckpoint)}</span><span><span class="muted">Final checkpoint</span> ${fmtDate(r.finalCheckpoint)}</span><span class="muted">Window ${r.outcomeWindowVersion}</span></div>
      ${r.outcome ? html`<div class="inner small stack-sm"><span><b>${OUTCOMES[r.outcome.result].label}</b> on ${fmtDate(r.outcome.date)} · logged by ${r.outcome.loggedBy}</span><span class="muted">${r.outcome.evidence.kind === 'link' ? html`<a class="link" href="${r.outcome.evidence.value}" target="_blank" rel="noopener" data-external>${r.outcome.evidence.value}</a>` : r.outcome.evidence.value}</span></div>` : ''}
      ${r.status === 'disagrees' ? html`<p class="small warn">The outcome differed from the directive. Compare the audits to see what the agents missed or weighted differently.</p>` : ''}
      ${canLog ? html`<div class="row-actions"><button type="button" class="btn" data-log="${r.auditId}">${r.outcome ? 'Change outcome' : 'Log outcome'}</button></div>` : ''}
    </li>`)}</ul>` : emptyState({ title: 'Nothing here.', body: 'Change the filter to see other audits. Outcomes become due at each audit\'s first checkpoint.' })}
  </section>
</div>`;
  },

  mount(root, ctx, { rows }) {
    const ac = new AbortController();
    root.addEventListener('click', (e) => {
      const fl = e.target.closest('[data-filter]');
      if (fl) ctx.navigate(`/outcomes?filter=${fl.dataset.filter}`, { replace: true });
      const lg = e.target.closest('[data-log]');
      if (lg) openLog(rows.find((r) => r.auditId === lg.dataset.log), ctx);
    }, { signal: ac.signal });
    return () => ac.abort();
  },
};
