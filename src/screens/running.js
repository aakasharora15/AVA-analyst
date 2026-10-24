import { html } from '../lib/html.js';
import { MODE, DEMO, getRun, getCompany, setRunDebug, notifyOnComplete } from '../data/repo.js';
import { AGENTS } from '../engine/config.js';
import { fmtDate, sevTag } from '../components/ui.js';
import { toast } from '../components/sheet.js';

const STATE = {
  queued: { tag: 'QUEUED', cls: 'tag-neutral' },
  working: { tag: 'WORKING', cls: 'sev-low' },
  retrying: { tag: 'RETRYING', cls: 'sev-medium' },
  complete: { tag: 'COMPLETE', cls: 'v-proceed verdict' },
  failed: { tag: 'NOT RUN', cls: 'sev-high' },
};

const mmss = (s) => `${Math.floor(s / 60)} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`;

function agentNote(a, agents) {
  const prev = agents[a.n - 2];
  switch (a.state) {
    case 'queued': return a.n === 6 ? 'Writes the rationale once all five reports are in.' : `Starts after ${prev ? prev.name : 'the previous agent'}.`;
    case 'working': return a.n === 1 ? 'Reading the company fields and data room.' : `Reading the reports before it. ${AGENTS[a.n - 1].mandate}`;
    case 'retrying': return 'The first attempt failed. Retrying once automatically.';
    case 'complete': return `Finished in ${Math.round(a.duration)} s${a.retried ? ' after one retry' : ''}.`;
    case 'failed': return a.n === 6 ? 'Failed twice. The audit cannot be scored and will not count against usage.' : 'Failed twice. Its sections show "Not run" and the audit continues as Partial.';
    default: return '';
  }
}

function liveView(run) {
  const { agents, preview, elapsed, total } = run;
  const completeCount = agents.filter((a) => a.state === 'complete').length;
  const failed = agents.filter((a) => a.state === 'failed');
  const orchFailed = failed.some((a) => a.n === 6);
  return html`
<div class="banner ${orchFailed ? 'banner-bad' : 'banner-warn'}" role="alert" ${failed.length ? '' : html`hidden`}>
  <div class="stack-sm">
    <b>${orchFailed ? 'The Orchestrator failed. This audit is Failed.' : `${failed.map((a) => a.name).join(', ')} did not run.`}</b>
    <span class="small muted">${orchFailed ? 'No score or directive is issued and the audit does not count against usage. Run it again from the company page.' : 'Each failed agent was retried once. Its sections show "Not run" with the reason, and the final directive of this Partial audit is capped at HOLD.'}</span>
  </div>
</div>
<div class="run-grid">
  <section aria-label="Agent sequence" class="run-agents">
    <ol class="run-list">
      ${agents.map((a) => html`<li class="card run-agent run-${a.state}">
        <span class="lbl">0${a.n}</span>
        <div class="stack-sm">
          <span class="run-name">${a.name}</span>
          <span class="small muted">${agentNote(a, agents)}</span>
          ${a.state === 'working' || a.state === 'retrying' ? html`<div class="run-prog" role="progressbar" aria-label="${a.name} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((a.progress || 0) * 100)}"><span style="width:${Math.round((a.progress || 0) * 100)}%"></span></div>` : ''}
        </div>
        <span class="tag ${STATE[a.state].cls}">${STATE[a.state].tag}</span>
      </li>`)}
    </ol>
  </section>
  <section aria-label="Results so far" class="run-results">
    <div class="hero-panel run-hero">
      <div class="stars" aria-hidden="true"></div>
      <div class="stack-sm"><span class="lbl">Resilience score</span><span class="hero-num run-pending">--</span></div>
      <div class="stack-sm"><span class="lbl">Directive</span><span class="hero-num run-pending">Pending</span></div>
      <span class="small run-elapsed">${mmss(Math.min(elapsed, total))} elapsed. ${completeCount} of 6 agents reported.</span>
    </div>
    <div class="card card-pad stack-md">
      <span class="lbl">Findings so far · ${completeCount} of 6 agents reported</span>
      ${preview.length ? preview.map((f) => html`<div class="run-finding">
        ${sevTag(f.severity)}
        <div class="stack-sm"><b>${f.title}</b><span class="small muted">${f.text}</span><span class="lbl">${AGENTS[f.agent - 1].name}</span></div>
      </div>`) : html`<p class="muted small">Findings appear here as each agent finishes.</p>`}
    </div>
  </section>
</div>`;
}

export default {
  title: (data) => (data ? `Running: ${data.company.title} · AVA` : 'Running audit · AVA'),
  className: 'running',

  async load(ctx) {
    const run = await getRun(ctx.params.auditId);
    if (!run) throw new Error('This audit does not exist.');
    return { run, company: await getCompany(run.audit.companyId) };
  },

  render(ctx, { run, company }) {
    const a = run.audit;
    return html`
<nav class="crumbs" aria-label="Breadcrumb"><a href="/portfolio">Portfolio</a><span aria-hidden="true">/</span><a href="/company/${company.id}">${company.title}</a><span aria-hidden="true">/</span><span>Audit ${fmtDate(a.date)}</span></nav>
<div class="page-head">
  <div class="page-head-copy">
    <span class="lbl">Audit in progress · Started ${fmtDate(a.date)}</span>
    <h1 class="page-title">${company.title}</h1>
    <p class="muted page-sub" aria-live="polite" data-run-summary>Results appear here as each agent finishes. The audit keeps running if you leave this page.</p>
  </div>
  ${MODE === 'mock' && !DEMO ? html`<details class="card run-debug">
    <summary>Debug: simulate a failure</summary>
    <div class="stack-md">
      <div class="fld"><label for="dbg-agent">Agent to fail</label>
        <select id="dbg-agent" class="inp" data-dbg-agent><option value="">None</option>${AGENTS.map((ag) => html`<option value="${ag.n}">${ag.name}</option>`)}</select></div>
      <label class="check"><input type="checkbox" data-dbg-retry><span class="check-copy"><span>Retry fails too</span><span class="hint">Shows the Partial state, or Failed for the Orchestrator.</span></span></label>
      <button type="button" class="btn" data-dbg-apply>Apply</button>
    </div>
  </details>` : ''}
</div>
<div data-live>${liveView(run)}</div>
<div class="row-actions">
  <button type="button" class="btn" data-notify aria-pressed="false">Notify me when done</button>
  <a class="btn" href="/portfolio">Leave and return later</a>
</div>`;
  },

  mount(root, ctx, { run }) {
    const id = ctx.params.auditId;
    const live = root.querySelector('[data-live]');
    const summary = root.querySelector('[data-run-summary]');
    let timer = null;
    let finished = run.done;

    const tick = async () => {
      const r = await getRun(id);
      if (!r) return;
      live.innerHTML = String(liveView(r));
      if (r.done && !finished) {
        finished = true;
        clearInterval(timer);
        const status = r.audit.status;
        if (status === 'failed') {
          summary.textContent = 'The audit failed. No score or directive was issued.';
          live.insertAdjacentHTML('beforeend', String(html`<div class="row-actions"><a class="btn btn-primary" href="/report/${id}">Open the failed audit</a></div>`));
          return;
        }
        summary.textContent = `Complete. Score ${r.audit.score}, directive ${r.audit.finalDirective}. Opening the report.`;
        setTimeout(() => ctx.navigate(`/report/${id}`, { replace: true }), 1400);
      }
    };

    if (run.done) {
      ctx.navigate(`/report/${id}`, { replace: true });
      return null;
    }
    // Live audits take minutes; poll gently.
    timer = setInterval(tick, MODE === 'mock' ? 500 : 2500);

    root.querySelector('[data-dbg-apply]')?.addEventListener('click', async () => {
      const ok = await setRunDebug(id, {
        failAgent: root.querySelector('[data-dbg-agent]').value || null,
        failRetry: root.querySelector('[data-dbg-retry]').checked,
      });
      toast(ok ? 'Debug failure set.' : 'That agent has already started. Pick a later one.');
    });
    const notify = root.querySelector('[data-notify]');
    notify.addEventListener('click', async () => {
      const on = notify.getAttribute('aria-pressed') !== 'true';
      if (on) {
        try { await notifyOnComplete(id); } catch (err) { toast(err.message); return; }
      }
      notify.setAttribute('aria-pressed', String(on));
      notify.textContent = on ? 'You will be notified' : 'Notify me when done';
      toast(on ? 'We will notify you in app and by email when the audit finishes.' : 'Notification cancelled.');
    });
    return () => clearInterval(timer);
  },
};
