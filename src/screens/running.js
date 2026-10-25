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
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// What each agent works through, in its own order (from its brief). Shown as
// the current step while that agent is working; the feed below it only lists
// things that actually happened.
const ACTIVITY = {
  1: ['Reading the company details and data room', 'Modelling unit economics and burn', 'Looking for operational single points of failure', 'Testing team and execution risk'],
  2: ['Searching for funded competitors', 'Comparing pricing and positioning', 'Working out how an incumbent would respond'],
  3: ['Searching for near-identical products', 'Estimating how fast the idea can be cloned', 'Checking what is genuinely hard to copy'],
  4: ['Looking for evidence of real demand', 'Testing willingness to pay', 'Checking runway against the next milestones'],
  5: ['Checking which regulations apply', 'Reviewing data protection and AI rules', 'Looking for legal and IP exposure'],
  6: ['Reading all five reports', 'Checking findings against each other', 'Writing the rationale and roadmap'],
};

function agentNote(a, agents) {
  const prev = agents[a.n - 2];
  switch (a.state) {
    case 'queued': return a.n === 6 ? 'Writes the rationale once all five reports are in.' : `Starts after ${prev ? prev.name : 'the previous agent'}.`;
    case 'working': return AGENTS[a.n - 1].mandate;
    case 'retrying': return 'The first attempt failed. Retrying once automatically.';
    case 'complete': return `${a.findings != null ? `${a.findings} finding${a.findings === 1 ? '' : 's'}${a.high ? `, ${a.high} HIGH` : ''} · ` : ''}${Math.round(a.duration)} s${a.retried ? ' after one retry' : ''}`;
    case 'failed': return a.n === 6 ? 'Failed twice. The audit cannot be scored and will not count against usage.' : 'Failed twice. Its sections show "Not run" and the audit continues as Partial.';
    default: return '';
  }
}

const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Everything that has actually happened, oldest first, as [seconds from start, kind, text].
function events(run) {
  const t0 = new Date(run.startedAt).getTime();
  const rel = (iso) => Math.max(0, (new Date(iso).getTime() - t0) / 1000);
  const out = [[0, 'sys', 'Audit started. Six agents will attack the venture in turn.']];
  run.agents.forEach((a) => {
    if (a.startedAt) out.push([rel(a.startedAt), 'start', `${a.name} started: ${AGENTS[a.n - 1].mandate}`]);
    if (a.state === 'complete' && a.finishedAt) out.push([rel(a.finishedAt), 'done', `${a.name} filed its report${a.findings != null ? `: ${a.findings} finding${a.findings === 1 ? '' : 's'}${a.high ? `, ${a.high} HIGH` : ''}` : ''}.`]);
    if (a.state === 'failed' && a.finishedAt) out.push([rel(a.finishedAt), 'fail', `${a.name} did not return a valid report.`]);
  });
  (run.found || []).forEach((f) => out.push([rel(f.at), 'src', `${host(f.url) || 'Source'}: ${f.title}`]));
  return out.sort((x, y) => x[0] - y[0]);
}

function progressOf(run) {
  const settled = run.agents.filter((a) => a.state === 'complete' || a.state === 'failed').length;
  const current = run.agents.find((a) => a.state === 'working' || a.state === 'retrying');
  return Math.min(1, (settled + (current ? current.progress || 0 : 0)) / run.agents.length);
}

function remaining(run, elapsed) {
  const typical = run.typicalAgentSeconds || 60;
  const left = run.agents.filter((a) => a.state === 'queued').length;
  const current = run.agents.find((a) => a.state === 'working' || a.state === 'retrying');
  const sec = left * typical + (current ? Math.max(10, typical - (elapsed - (new Date(current.startedAt || run.startedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)) : 0);
  if (sec <= 20) return 'Finishing up';
  return sec < 90 ? 'About a minute left' : `About ${Math.round(sec / 60)} minutes left`;
}

function liveView(run) {
  const { agents, preview } = run;
  const completeCount = agents.filter((a) => a.state === 'complete').length;
  const failed = agents.filter((a) => a.state === 'failed');
  const orchFailed = failed.some((a) => a.n === 6);
  const current = agents.find((a) => a.state === 'working' || a.state === 'retrying');
  const feed = events(run).reverse().slice(0, 40);
  const pct = Math.round(progressOf(run) * 100);
  const sources = (run.found || []).length;
  return html`
<div class="banner ${orchFailed ? 'banner-bad' : 'banner-warn'}" role="alert" ${failed.length ? '' : html`hidden`}>
  <div class="stack-sm">
    <b>${orchFailed ? 'The Orchestrator failed. This audit is Failed.' : `${failed.map((a) => a.name).join(', ')} did not run.`}</b>
    <span class="small muted">${orchFailed ? 'No score or directive is issued and the audit does not count against usage. Run it again from the company page.' : 'Each failed agent was retried once. Its sections show "Not run" with the reason, and the final directive of this Partial audit is capped at HOLD.'}</span>
  </div>
</div>
<div class="run-grid">
  <section aria-label="Agent sequence" class="run-agents">
    <ol class="run-list run-pipe">
      ${agents.map((a) => html`<li class="card run-agent run-${a.state}">
        <span class="run-node" aria-hidden="true"><span>${a.state === 'complete' ? '✓' : `0${a.n}`}</span></span>
        <div class="stack-sm">
          <span class="run-name">${a.name}</span>
          <span class="small muted">${agentNote(a, agents)}</span>
          ${a.state === 'working' || a.state === 'retrying' ? html`<span class="run-now small" data-activity="${a.n}"><span class="run-caret" aria-hidden="true"></span><span data-activity-text>${ACTIVITY[a.n][0]}</span></span>
          <div class="run-prog" role="progressbar" aria-label="${a.name} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((a.progress || 0) * 100)}"><span style="width:${Math.round((a.progress || 0) * 100)}%"></span></div>` : ''}
        </div>
        <span class="tag ${STATE[a.state].cls}">${STATE[a.state].tag}</span>
      </li>`)}
    </ol>
  </section>
  <section aria-label="Results so far" class="run-results">
    <div class="hero-panel run-hero">
      <div class="stars" aria-hidden="true"></div>
      <div class="run-radar" aria-hidden="true"><span class="run-sweep"></span><span class="run-ring r1"></span><span class="run-ring r2"></span><span class="run-ring r3"></span><span class="run-core">${completeCount}/6</span></div>
      <div class="run-hero-copy stack-sm">
        <span class="lbl">${current ? `Now · ${current.name}` : completeCount === 6 ? 'Scoring' : 'Starting'}</span>
        <span class="run-clock num" data-elapsed>${clock(run.elapsed)}</span>
        <span class="small run-elapsed"><span data-remaining>${remaining(run, run.elapsed)}</span> · ${completeCount} of 6 reports in${sources ? ` · ${sources} source${sources === 1 ? '' : 's'} found` : ''}</span>
        <div class="run-total" role="progressbar" aria-label="Audit progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
      </div>
    </div>
    <div class="card card-pad stack-sm run-feed-card">
      <div class="r-sec-head"><span class="lbl">Live activity</span><span class="run-live small"><span class="run-dot" aria-hidden="true"></span>Live</span></div>
      <ol class="run-feed" aria-label="Activity, newest first">${feed.map(([t, kind, text]) => html`<li class="run-ev run-ev-${kind}"><span class="run-ev-t">${clock(t)}</span><span>${text}</span></li>`)}</ol>
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
    let last = run;
    let fetchedAt = Date.now();
    let step = 0;
    // Redraw only when something real changed, so the motion never restarts mid-way.
    const sig = (r) => JSON.stringify([r.agents.map((a) => [a.state, a.findings, Math.round((a.progress || 0) * 20)]), r.preview.length, (r.found || []).length]);
    let shown = sig(run);
    // Between polls: the clock ticks every second and the current step moves on.
    const local = setInterval(() => {
      const el = (last.elapsed || 0) + (Date.now() - fetchedAt) / 1000;
      const c = live.querySelector('[data-elapsed]');
      if (c && !finished) c.textContent = clock(el);
      const rem = live.querySelector('[data-remaining]');
      if (rem && !finished) rem.textContent = remaining(last, el);
      step += 1;
      if (step % 4 === 0) {
        const act = live.querySelector('[data-activity]');
        if (act) {
          const list = ACTIVITY[act.dataset.activity];
          const txt = act.querySelector('[data-activity-text]');
          txt.textContent = list[(step / 4) % list.length];
          txt.classList.remove('run-fade');
          void txt.offsetWidth;
          txt.classList.add('run-fade');
        }
      }
    }, 1000);

    const tick = async () => {
      const r = await getRun(id);
      if (!r) return;
      last = r;
      fetchedAt = Date.now();
      const next = sig(r);
      if (next !== shown || r.done) { live.innerHTML = String(liveView(r)); shown = next; }
      if (r.done && !finished) {
        finished = true;
        clearInterval(timer);
        clearInterval(local);
        const status = r.audit.status;
        if (status === 'failed') {
          summary.textContent = r.audit.outcome === 'insufficient_information'
            ? 'No score issued: there was not enough real information to assess this venture.'
            : 'The audit failed. No score or directive was issued.';
          live.insertAdjacentHTML('beforeend', String(html`<div class="row-actions"><a class="btn btn-primary" href="/report/${id}">Open the failed audit</a></div>`));
          return;
        }
        summary.textContent = `Complete. Score ${r.audit.score}, directive ${r.audit.finalDirective}. Opening the report.`;
        setTimeout(() => ctx.navigate(`/report/${id}`, { replace: true }), 1400);
      }
    };

    if (run.done) {
      clearInterval(local);
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
    return () => { clearInterval(timer); clearInterval(local); };
  },
};
