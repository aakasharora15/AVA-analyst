import { html } from '../lib/html.js';
import { getCompany, getOrg, getSources, getUsers, getTracking, toggleTodo, updateCompany, runAudit, can, effectiveCadence, getOutcomeRows } from '../data/repo.js';
import { showAuditError } from '../components/upgrade.js';
import { metricsCard, mountMetricsCard } from '../components/metrics-card.js';
import { CATEGORIES } from '../engine/config.js';
import { fmtDate, verdictTag, meter, vClass, deltaText, TYPE_LABEL, emptyState } from '../components/ui.js';
import { openSheet, toast } from '../components/sheet.js';

const CADENCE = { inherit: 'Use organisation default', off: 'Off', monthly: 'Monthly', quarterly: 'Quarterly' };

function reaudit(c, sources, ctx) {
  const last = c.latest;
  const newFiles = sources.filter((s) => s.type === 'uploaded' && last && s.date > last.date);
  openSheet({
    title: `Re-audit ${c.title}`,
    body: html`<div class="inner stack-sm small">
      <div class="kv"><span class="muted">Last audit</span><b>${last ? fmtDate(last.date) : 'None'}</b></div>
      <div class="kv"><span class="muted">Inputs changed since</span><b>${c.updatedAt && last && c.updatedAt.slice(0, 10) > last.date ? 'Company details edited' : 'None'}</b></div>
      <div class="kv"><span class="muted">New files since</span><b>${newFiles.length ? newFiles.map((f) => f.title).join(', ') : 'None'}</b></div>
      <div class="kv"><span class="muted">Usage</span><b>1 audit from this month's allowance</b></div>
    </div>
    <form class="stack-md" data-reaudit>
      <fieldset class="stack-sm"><legend class="fld-label">When</legend>
        <label class="check"><input type="radio" name="when" value="now" checked><span>Run now</span></label>
        <label class="check"><input type="radio" name="when" value="later"><span>Schedule for a date</span></label>
        <div class="fld" data-date hidden><label for="ra-date">Date</label><input id="ra-date" type="date" class="inp" name="date" min="${new Date().toISOString().slice(0, 10)}"></div>
      </fieldset>
      <label class="check"><input type="checkbox" name="notify" checked><span class="check-copy"><span>Notify the team on completion</span><span class="hint">In app and by email to everyone following ${c.title}.</span></span></label>
      <p class="hint">A failed audit does not count against usage. Unchanged inputs can still move the score because public sources are retrieved live.</p>
      <div class="row-actions"><button type="submit" class="btn btn-primary">Run audit</button><a class="btn" href="/new-analysis?company=${c.id}">Edit inputs first</a></div>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('[data-reaudit]');
      form.addEventListener('change', () => { el.querySelector('[data-date]').hidden = form.elements.when.value !== 'later'; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (form.elements.when.value === 'later') {
          const date = form.elements.date.value;
          if (!date) { form.elements.date.focus(); return; }
          await updateCompany(c.id, { cadence: { ...c.cadence }, scheduledAudit: date }, `Scheduled an audit of ${c.title} for ${date}`);
          close();
          toast(`Audit scheduled for ${fmtDate(date)}.`);
          ctx.refresh();
          return;
        }
        try {
          const { auditId } = await runAudit({ companyId: c.id, trigger: 'manual' });
          close();
          ctx.navigate(`/running/${auditId}`);
        } catch (err) { close(); showAuditError(err, ctx.navigate); }
      });
    },
  });
}

export default {
  title: (d) => (d ? `${d.c.title} · AVA` : 'Company · AVA'),
  className: 'company',

  async load(ctx) {
    const c = await getCompany(ctx.params.id);
    if (!c) throw new Error('This company does not exist.');
    const [org, sources, outcomes, tracking, users] = await Promise.all([getOrg(), getSources(c.id), getOutcomeRows(), getTracking(c.id), getUsers()]);
    return { c, org, sources, outcomes: outcomes.filter((o) => o.companyId === c.id), tracking: tracking && tracking.tracked ? { ...tracking, companyId: c.id } : null, users };
  },

  render(ctx, { c, org, sources, outcomes, tracking, users }) {
    const a = c.latest;
    const mode = effectiveCadence(c, org);
    const logged = outcomes.filter((o) => o.outcome).length;
    const worst = a ? [...CATEGORIES].sort((x, y) => a.exposure[y] - a.exposure[x]).slice(0, 2) : [];
    const canRun = can('runAudits');
    return html`
<nav class="crumbs" aria-label="Breadcrumb"><a href="/portfolio">Portfolio</a><span aria-hidden="true">/</span><span>${c.title}</span></nav>
${c.running ? html`<div class="banner banner-info" role="status"><b>An audit is running.</b><a class="btn" href="/running/${c.running.id}">Open the running audit</a></div>` : ''}
<div class="co-hero">
  <div class="co-copy">
    <span class="lbl">${c.industry} · ${[c.city, c.country].filter(Boolean).join(', ')} · ${TYPE_LABEL[c.type]}${c.id === 'northline' ? ' · Sample data' : ''}</span>
    <h1 class="r-title">${c.title}</h1>
    <p class="muted r-desc">${c.description}</p>
    <p class="small muted">${c.auditCount} audit${c.auditCount === 1 ? '' : 's'} · Deal lead ${c.dealLead || 'not set'}${c.stage ? ` · ${c.stage}` : ''}</p>
    <div class="row-actions">
      ${a ? html`<a class="btn btn-primary" href="/report/${a.id}">Open latest report</a>` : ''}
      ${canRun ? html`<button type="button" class="btn${a ? '' : ' btn-primary'}" data-reaudit>${a ? 'Run a new audit' : 'Run the first audit'}</button>` : ''}
    </div>
  </div>
  ${a ? html`<div class="hero-panel co-score ${vClass(a.finalDirective)}">
    <div class="stars" aria-hidden="true"></div>
    <div class="co-nums">
      <div><div class="lbl">Resilience score</div><div class="hero-num">${a.score}<span class="r-of"> / 100</span></div></div>
      <div><div class="lbl">Directive</div><div class="hero-dir verdict-text">${a.finalDirective}</div></div>
    </div>
    ${meter(a.score, a.finalDirective, { label: `Score ${a.score} of 100` })}
    <span class="small co-note">${c.previous ? `${deltaText(c.delta)} since ${fmtDate(c.previous.date)}. ` : 'First audit. '}Highest exposure: ${worst.map((k) => `${k.toLowerCase()} ${a.exposure[k]}`).join(' and ')}.</span>
  </div>` : ''}
</div>

${a ? html`<section aria-label="Company areas" class="co-tiles">
  <a class="tile" href="/history/${c.id}"><span class="lbl">History</span><b>${c.auditCount} audit${c.auditCount === 1 ? '' : 's'}</b><span class="small muted">${c.auditCount > 1 ? 'Compare any two.' : 'Comparison needs a second audit.'}</span></a>
  <a class="tile" href="/data-room?company=${c.id}"><span class="lbl">Data room</span><b>${c.fileCount} file${c.fileCount === 1 ? '' : 's'}</b><span class="small muted">${c.coverage.filter((x) => x.pct < 30).map((x) => x.topic).join(', ') || 'All topics'} ${c.coverage.some((x) => x.pct < 30) ? 'thin or missing.' : 'covered.'}</span></a>
  <a class="tile" href="/sources?company=${c.id}"><span class="lbl">Sources</span><b>${sources.length} registered</b><span class="small muted">See which findings rely on each.</span></a>
  <a class="tile" href="/outcomes"><span class="lbl">Outcomes</span><b>${logged ? `${logged} logged` : 'Not logged'}</b><span class="small muted">First checkpoint ${fmtDate(outcomes[outcomes.length - 1]?.firstCheckpoint)}.</span></a>
  <a class="tile" href="/alerts"><span class="lbl">Alerts</span><b>${c.unreadAlerts ? `${c.unreadAlerts} unread` : 'None unread'}</b><span class="small muted">Material movements only.</span></a>
  <a class="tile" href="/benchmarks?company=${c.id}"><span class="lbl">Benchmarks</span><b>Against ${TYPE_LABEL[c.type].toLowerCase()}s</b><span class="small muted">Same venture type only.</span></a>
</section>` : emptyState({ title: 'No audits yet.', body: 'Run the first audit to get a Resilience Score and directive. Every later audit is stored so you can see how risk moves.', action: canRun ? { href: `/new-analysis?company=${c.id}`, label: 'Run the first audit' } : null })}

${metricsCard(tracking, { canEdit: canRun, users, currency: org.currency || 'GBP' })}

<div class="co-two">
  <section class="card card-pad stack-md" aria-labelledby="cad-title">
    <h2 id="cad-title" class="card-title">Monitoring</h2>
    <form class="stack-md" data-cadence>
      <div class="fld"><label for="cad-mode">Cadence</label><select id="cad-mode" class="inp" name="mode"${canRun ? '' : html` disabled`}>${Object.entries(CADENCE).map(([k, l]) => html`<option value="${k}"${c.cadence.mode === k ? html` selected` : ''}>${k === 'inherit' ? `${l} (${org.cadence.mode})` : l}</option>`)}</select></div>
      <label class="check"><input type="checkbox" name="paused"${c.cadence.paused ? html` checked` : ''}${canRun ? '' : html` disabled`}><span>Pause scheduled audits</span></label>
      <div class="fld" data-resume ${c.cadence.paused ? '' : html`hidden`}><label for="cad-resume">Resume on (optional)</label><input id="cad-resume" type="date" class="inp" name="resumeOn" value="${c.cadence.resumeOn || ''}"></div>
      <p class="small"><span class="muted">Next audit:</span> <b>${c.cadence.paused ? 'Paused' : mode === 'off' ? 'Manual only' : fmtDate(c.cadence.nextRun)}</b>${c.scheduledAudit ? html` · <span class="muted">One-off audit scheduled for</span> <b>${fmtDate(c.scheduledAudit)}</b>` : ''}</p>
      ${canRun ? html`<button type="submit" class="btn">Save monitoring</button>` : ''}
    </form>
  </section>
  <section class="card card-pad stack-sm" aria-labelledby="todo-title">
    <div class="r-sec-head"><h2 id="todo-title" class="card-title">Open items</h2><span class="lbl">Tick to mark done</span></div>
    ${c.todos.length ? c.todos.map((t) => html`<label class="check row-line co-todo"><input type="checkbox" data-todo="${t.id}" id="todo-${t.id}"${t.done ? html` checked` : ''}><span class="check-copy"><span class="${t.done ? 'done' : ''}">${t.head}</span><span class="small muted">${t.why}</span></span></label>`) : html`<p class="muted small">Nothing open. Items appear when an audit skips a section or needs evidence.</p>`}
  </section>
</div>`;
  },

  mount(root, ctx, { c, sources, tracking, org }) {
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    mountMetricsCard(root, ctx, { t: tracking, currency: org.currency || 'GBP' });
    if (window.location.hash === '#metrics') root.querySelector('#metrics')?.scrollIntoView({ block: 'start' });
    root.addEventListener('click', (e) => { if (e.target.closest('[data-reaudit]')) reaudit(c, sources, ctx); }, opts);
    root.addEventListener('change', async (e) => {
      if (e.target.matches('[data-todo]')) { await toggleTodo(c.id, e.target.dataset.todo); ctx.refresh(); }
      if (e.target.name === 'paused') root.querySelector('[data-resume]').hidden = !e.target.checked;
    }, opts);
    const form = root.querySelector('[data-cadence]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await updateCompany(c.id, { cadence: { ...c.cadence, mode: fd.get('mode'), paused: fd.get('paused') === 'on', resumeOn: fd.get('resumeOn') || null } }, `Changed monitoring for ${c.title}`);
      toast('Monitoring saved.');
      ctx.refresh();
    }, opts);
    if (ctx.query.get('reaudit') === '1' && can('runAudits')) {
      ctx.query.delete('reaudit');
      window.history.replaceState({}, '', `/company/${c.id}`);
      reaudit(c, sources, ctx);
    }
    return () => ac.abort();
  },
};
