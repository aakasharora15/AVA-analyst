import { html } from '../lib/html.js';
import { getAudit, getUsers, can, setFindingStatus, setFindingOwner, addComment, createShareLink, revokeShareLink, getCurrentUser, challengeFinding, answerChallenge, getQuestions, askQuestion } from '../data/repo.js';
import { AGENTS, SECTIONS, CATEGORIES, DIRECTIVES } from '../engine/config.js';
import { fmtDate, fmtDateTime, verdictTag, sevTag, vClass, meter, exposureBar, TYPE_LABEL, icon, deltaText } from '../components/ui.js';
import { openSheet, toast } from '../components/sheet.js';
import { SUBJECTS, DECISIONS, labelOf, isOperating, runningMeaning } from '../data/shared.js';

const STATUS = { open: 'Open', accepted: 'Accepted', dismissed: 'Dismissed', resolved: 'Resolved' };
const CH_STATUS = { open: 'Awaiting answer', upheld: 'Upheld', rejected: 'Rejected' };
const CH_CLASS = { open: 'st-prev', upheld: 'st-resolved', rejected: 'st-dismissed' };

export function reportText(a) {
  const lines = [
    `AVA report: ${a.company.title}, ${fmtDate(a.date)}.`,
    a.score == null ? 'Audit failed: no score or directive.' : `Resilience Score ${a.score}/100. Directive: ${a.finalDirective}${a.overridden ? ` (adjusted by the Orchestrator from ${a.baseDirective})` : ''}${a.status === 'partial' ? ' (Partial audit, capped at HOLD)' : ''}.`,
    a.orchestrator?.rationale || '',
    '',
    'Top findings:',
    ...a.findings.filter((f) => f.severity === 'HIGH').slice(0, 5).map((f) => `- [${f.severity}] ${f.title}`),
    '',
    `Calibration ${a.calibrationVersion}. Prompt ${a.promptVersion}.`,
  ];
  return lines.filter((l, i) => l || lines[i - 1]).join('\n');
}

// ---------------------------------------------------------------------------
// Pieces

function citeMarkers(f, a) {
  const valid = f.sources.filter((s) => a.sourcesById[s]);
  if (!valid.length) return html`<span class="no-source">Agent reasoning, no source</span>`;
  return html`<span class="cites">${valid.map((sid) => {
    const n = a.citationOrder.indexOf(sid) + 1;
    const s = a.sourcesById[sid];
    return html`<a class="cite" href="/sources?company=${a.companyId}&source=${sid}" data-cite="${sid}" aria-label="Source ${n}: ${s.title}, ${s.type === 'uploaded' ? 'uploaded' : 'public'}, ${fmtDate(s.date)}">[${n}]</a>`;
  })}</span>`;
}

function findingRow(f, a, { compact = false, guest = false } = {}) {
  const prev = a.previouslyDismissed[f.id];
  const challenged = (a.challenges || []).some((c) => c.findingId === f.id && c.status === 'open');
  return html`<li class="finding st-${f.status}" id="f-${f.id}">
  ${sevTag(f.severity, 'finding-sev')}
  <div class="finding-body">
    <div class="finding-title"><b>${f.title}</b>${f.status !== 'open' ? html`<span class="status-chip st-${f.status}">${STATUS[f.status]}</span>` : ''}${prev ? html`<span class="status-chip st-prev" title="${prev.reason}">Previously dismissed</span>` : ''}${challenged ? html`<span class="status-chip st-prev">Challenged</span>` : ''}</div>
    ${compact ? '' : html`<p class="finding-text">${f.text}</p>`}
    ${prev && !compact ? html`<p class="hint">Dismissed in an earlier audit: ${prev.reason}</p>` : ''}
    ${f.status === 'dismissed' && f.dismissReason ? html`<p class="hint">Dismissed: ${f.dismissReason}</p>` : ''}
    <div class="finding-meta">${citeMarkers(f, a)}<span class="lbl">${f.category}</span>${f.owner ? html`<span class="small muted">Owner: ${f.owner}</span>` : ''}${f.comments.length ? html`<span class="small muted">${f.comments.length} comment${f.comments.length === 1 ? '' : 's'}</span>` : ''}</div>
  </div>
  ${guest ? '' : html`<button type="button" class="btn finding-manage" data-finding="${f.id}" aria-label="Open finding: ${f.title}">Open</button>`}
</li>`;
}

function verdictPanel(a) {
  const delta = a.previous ? a.score - a.previous.score : null;
  const ex = a.excludingDismissed;
  return html`<div class="hero-panel r-score ${vClass(a.finalDirective)}">
  <div class="stars" aria-hidden="true"></div>
  <div class="r-score-head"><span class="lbl">Resilience Score · AVA score</span>${a.status === 'partial' ? html`<span class="tag tag-on-hero">PARTIAL</span>` : ''}</div>
  <div class="r-score-nums">
    <div class="r-official"><span class="hero-num">${a.score}</span><span class="r-of">/ 100</span></div>
    <div class="r-excl">
      <span class="lbl">Score excluding dismissed findings</span>
      <span class="r-excl-num">${ex.score}</span>
      <span class="xsmall">${ex.dismissed ? `${ex.dismissed} dismissed. The AVA score above does not change.` : 'No findings dismissed.'}</span>
    </div>
  </div>
  ${meter(a.score, a.finalDirective, { tall: true, label: `Resilience score ${a.score} out of 100` })}
  <div class="r-score-foot small">${a.previous ? html`<span>${deltaText(delta)} since ${fmtDate(a.previous.date)}</span><a class="link" href="/history/${a.companyId}?a=${a.previous.id}&b=${a.id}">See what changed</a>` : html`<span>First audit. Re-audit to compare.</span>`}</div>
  <div class="r-cats">
    <span class="lbl">Exposure by category · higher is worse</span>
    ${CATEGORIES.map((c) => html`<a class="r-cat" href="#trace-${c.replace(/\W+/g, '-')}" data-trace-open="${c}"><span>${c}</span>${exposureBar(a.exposure[c], { label: `${c} exposure ${a.exposure[c]} of 100` })}<span class="mono">${a.exposure[c]}</span></a>`)}
  </div>
</div>`;
}

function directiveScale(a) {
  return html`<div class="scale" role="img" aria-label="Directive scale: Proceed, Hold, Pivot, Kill. ${a.finalDirective} is selected.">${[...DIRECTIVES].reverse().map((d) => html`<span class="scale-step ${d === a.finalDirective ? `on ${vClass(d)}` : ''}">${d}</span>`)}</div>`;
}

function banners(a) {
  const out = [];
  if (a.underReview) out.push(html`<div class="banner banner-warn" role="alert"><b>Under review</b><span class="small">This verdict is under review after a change in scoring consistency. Do not act on it until the review is complete.</span></div>`);
  if (a.overridden) {
    const cited = a.override.findingIds.map((id) => a.findings.find((f) => f.id === id)).filter(Boolean);
    out.push(html`<div class="banner banner-info r-override" role="note">
      <div class="stack-sm"><b>Adjusted by the Orchestrator</b>
      <span class="small">Score maps to ${verdictTag(a.baseDirective)}. The Orchestrator moved it one band down to ${verdictTag(a.finalDirective)}. ${a.override.reason}</span>
      <span class="small">Cited findings: ${cited.map((f, i) => html`${i ? ', ' : ''}<a class="link" href="#f-${f.id}">${f.title}</a>`)}</span></div></div>`);
  }
  if (a.overrideRejected) out.push(html`<div class="banner" role="note"><b>Override rejected and logged</b><span class="small muted">${a.overrideRejected}. The directive follows the score.</span></div>`);
  if (a.status === 'partial') {
    const failed = a.agentRuns.filter((r) => r.status === 'failed').map((r) => AGENTS[r.agent - 1].name);
    out.push(html`<div class="banner banner-warn" role="note"><div class="stack-sm"><b>Partial audit</b><span class="small">${failed.join(', ')} failed after one automatic retry. Its sections show "Not run". ${a.baseDirective !== a.finalDirective && !a.overridden ? html`The score maps to ${verdictTag(a.baseDirective)}; a Partial audit is capped at HOLD.` : 'A Partial audit is capped at HOLD; this directive is already at or below it.'}</span></div></div>`);
  }
  if (a.driftFlag) out.push(html`<div class="banner banner-warn" role="note"><b>Drift flag</b><span class="small">The score differs from an earlier audit with an identical input snapshot. Logged for review.</span></div>`);
  return out;
}

function coverageRow(a) {
  const c = a.coverage;
  return html`<div class="r-coverage" aria-label="Coverage">
  <span><b>${c.agentsRun} of ${c.agentsTotal}</b> agents run</span>
  <span><b>${c.sectionsSkipped}</b> section${c.sectionsSkipped === 1 ? '' : 's'} skipped</span>
  ${c.sectionsNotRun.length ? html`<span><b>${c.sectionsNotRun.length}</b> sections not run</span>` : ''}
  <span><b>${c.sourcesCited}</b> sources cited</span>
  <span class="muted">Calibration ${a.calibrationVersion} · prompts ${a.promptVersion}</span>
</div>`;
}

function chain(a) {
  return html`<section aria-labelledby="chain-title" class="stack-md">
  <div class="r-sec-head"><h2 id="chain-title" class="r-h2">Six agents, one chain</h2><span class="small muted">Each agent read every report before it. Total run time ${Math.floor(a.runSeconds / 60)} min ${a.runSeconds % 60} s.</span></div>
  <ol class="r-chain">
    ${AGENTS.map((ag) => {
      const run = a.agentRuns.find((r) => r.agent === ag.n) || {};
      const secs = SECTIONS.filter((s) => s.agent === ag.n);
      const skipped = a.skippedSections.filter((s) => secs.some((x) => x.id === s.section)).length;
      const failed = run.status === 'failed';
      return html`<li><a class="card r-chain-card" href="#a${ag.n}">
        <span class="r-chain-top"><span class="lbl">0${ag.n}</span>${failed ? html`<span class="tag sev-high">NOT RUN</span>` : html`<span class="tag v-proceed verdict">${run.duration} s</span>`}</span>
        <span class="r-chain-name">${ag.name}</span>
        <span class="xsmall muted">${ag.mandate}</span>
        <span class="lbl">${failed ? 'Failed after retry' : ag.n === 6 ? 'Rationale and directive check' : skipped ? `${secs.length - skipped} of ${secs.length} sections` : `${secs.length} section${secs.length === 1 ? '' : 's'}`}</span>
      </a></li>`;
    })}
  </ol>
</section>`;
}

function trace(a) {
  const w = a.categoryWeights;
  return html`<section aria-labelledby="trace-title" class="card card-pad stack-md" id="trace">
  <div class="r-sec-head"><h2 id="trace-title" class="r-h2">How this score was built</h2><span class="small muted">Score, then category exposure, then the findings and their sources.</span></div>
  <ol class="trace-steps small">
    <li><b>Exposure per category</b> is the sum of its findings: HIGH ${a.severityWeights.HIGH}, MEDIUM ${a.severityWeights.MEDIUM}, LOW ${a.severityWeights.LOW} points, capped at 100.</li>
    <li><b>Weighted exposure</b> uses ${TYPE_LABEL[a.company.type].toLowerCase()} weights. 100 minus it gives <b>${a.raw}</b>.</li>
    <li><b>Cap rule:</b> ${a.cap ? html`${a.cap.category} exposure ${a.cap.exposure} is above the threshold, so the score is limited to <b>${a.cap.limit}</b>.` : 'no category is above the threshold, so no cap applied.'}</li>
    <li><b>Directive:</b> ${a.score} maps to ${verdictTag(a.baseDirective)}${a.overridden ? html`, adjusted by the Orchestrator to ${verdictTag(a.finalDirective)}` : ''}${a.status === 'partial' ? ', then the Partial cap at HOLD' : ''}. Final: ${verdictTag(a.finalDirective)}.</li>
  </ol>
  <div class="trace-list">
    ${CATEGORIES.map((c) => {
      const ids = a.trace[c];
      const fs = ids.map((id) => a.findings.find((f) => f.id === id));
      return html`<details class="trace-cat" id="trace-${c.replace(/\W+/g, '-')}">
        <summary><span class="trace-name">${c}</span>${exposureBar(a.exposure[c])}<span class="mono">${a.exposure[c]}</span><span class="xsmall muted trace-w">weight ${Math.round(w[c] * 100)}%</span></summary>
        <ul class="trace-findings">
          ${fs.length ? fs.map((f) => html`<li><span class="mono xsmall trace-pts">+${a.severityWeights[f.severity]}</span>${sevTag(f.severity)}<a class="link" href="#f-${f.id}">${f.title}</a>${citeMarkers(f, a)}</li>`) : html`<li class="muted small">No findings in this category.</li>`}
        </ul>
      </details>`;
    })}
  </div>
</section>`;
}

function whatWouldChange(a) {
  const movers = a.effects.filter((e) => e.movesUpBand);
  const shown = (movers.length ? movers : a.effects).slice(0, 5);
  const next = DIRECTIVES[DIRECTIVES.indexOf(a.baseDirective) + 1];
  const owner = a.company.relationship === 'owner';
  return html`<section aria-labelledby="wwc-title" class="card card-pad stack-md">
  <div class="r-sec-head"><h2 id="wwc-title" class="r-h2">${owner ? 'What to fix first' : 'What would change this verdict'}</h2><span class="lbl">Individual effect, not cumulative</span></div>
  ${owner ? html`<p class="small">You told AVA you own or founded this business, so these are in the order that would lift the score most. Fix the top one, then re-audit.</p>` : ''}
  <p class="small muted">${next ? (movers.length ? `Resolving any one of these on its own would move the score into ${next}.` : `No single finding moves the score into ${next} on its own. These have the largest individual effect.`) : 'The directive is already PROCEED. These findings have the largest individual effect.'} Effects do not add up, because of averaging and the cap rule.</p>
  <ul class="wwc">
    ${shown.map((e) => {
      const f = a.findings.find((x) => x.id === e.findingId);
      return html`<li class="wwc-row"><span class="wwc-effect">+${e.effect}</span><div class="stack-sm"><a class="link" href="#f-${f.id}">${f.title}</a><span class="xsmall muted">${f.category} · score would be ${e.score}${e.movesUpBand ? html` · ${verdictTag(e.directive)}` : ''}</span></div>${sevTag(f.severity)}</li>`;
    })}
  </ul>
</section>`;
}

function agentGroups(a, guest = false) {
  return AGENTS.map((ag) => {
    const run = a.agentRuns.find((r) => r.agent === ag.n) || {};
    const secs = SECTIONS.filter((s) => s.agent === ag.n);
    return html`<section id="a${ag.n}" aria-labelledby="ah-${ag.n}" class="card r-group">
  <div class="r-group-head">
    <span class="r-badge">0${ag.n}</span>
    <h2 id="ah-${ag.n}" class="r-h2">${ag.name}</h2>
    <span class="small muted r-group-mandate">${ag.mandate}</span>
  </div>
  <div class="stack-sm">
  ${secs.map((s) => {
    const skip = a.skippedSections.find((x) => x.section === s.id);
    if (run.status === 'failed') {
      return html`<div class="r-sec r-sec-off"><span class="tag sev-high">NOT RUN</span><div class="stack-sm"><b>${s.title}</b><span class="small muted">${ag.name} failed after one automatic retry: ${run.error}</span></div></div>`;
    }
    if (skip) {
      return html`<div class="r-sec r-sec-off"><span class="tag tag-neutral">SKIPPED</span><div class="stack-sm"><b>${s.title}</b><span class="small muted">Skipped by ${ag.name}: ${skip.reason}</span></div></div>`;
    }
    if (ag.n === 6) {
      const o = a.orchestrator || {};
      if (s.id === 'inv') {
        const top = (o.topRisks || []).map((id) => a.findings.find((f) => f.id === id)).filter(Boolean);
        return html`<div class="r-sec r-sec-text"><b>${s.title}</b><p>${o.investor || o.rationale}</p>${top.length ? html`<span class="lbl">Top risks</span><ol class="r-toprisks">${top.map((f) => html`<li><a class="link" href="#f-${f.id}">${f.title}</a></li>`)}</ol>` : ''}</div>`;
      }
      return html`<div class="r-sec r-sec-text"><b>${s.title}</b><p>${o.roadmap || o.rationale}</p><p class="small muted">Final directive ${verdictTag(a.finalDirective)}${a.overridden ? html` (score maps to ${verdictTag(a.baseDirective)})` : ''}. The Orchestrator does not set the score.</p></div>`;
    }
    const fs = a.findings.filter((f) => f.section === s.id);
    const open = s.id === 'exec' || s.id === 'fin';
    return html`<details class="r-sec"${open ? html` open` : ''}>
      <summary><span class="r-sec-title"><b>${s.title}</b><span class="small muted">${fs.length} finding${fs.length === 1 ? '' : 's'}${fs.filter((f) => f.severity === 'HIGH').length ? `, ${fs.filter((f) => f.severity === 'HIGH').length} HIGH` : ''}</span></span><span class="r-sec-toggle" aria-hidden="true"></span></summary>
      ${fs.length ? html`<ul class="findings">${fs.map((f) => findingRow(f, a, { guest }))}</ul>` : html`<p class="muted small r-none">No findings in this section.</p>`}
    </details>`;
  })}
  </div>
</section>`;
  });
}

// ---------------------------------------------------------------------------
// Finding sheet (workflow, spec 4.6)

function findingSheetBody(f, a, users, me) {
  const canStatus = can('findingStatus', me);
  const canComment = can('comment', me);
  return html`<div class="inner stack-sm">
  <div class="row-actions">${sevTag(f.severity)}<span class="lbl">${f.category} · ${AGENTS[f.agent - 1].name} · ${SECTIONS.find((s) => s.id === f.section).title}</span></div>
  <p>${f.text}</p>
  <div>${citeMarkers(f, a)}</div>
</div>
<form class="stack-md" data-status-form>
  <fieldset class="stack-sm"><legend class="fld-label">Status</legend>
    <div class="seg" role="radiogroup" aria-label="Status">${Object.entries(STATUS).map(([k, l]) => html`<label class="seg-radio"><input type="radio" name="status" value="${k}"${f.status === k ? html` checked` : ''}${canStatus ? '' : html` disabled`}><span>${l}</span></label>`)}</div>
  </fieldset>
  <div class="fld" data-reason-wrap ${f.status === 'dismissed' ? '' : html`hidden`}>
    <label for="dismiss-reason">Reason for dismissing <span class="req" aria-hidden="true">*</span></label>
    <textarea id="dismiss-reason" class="inp" rows="3" name="reason" aria-describedby="dismiss-hint dismiss-err"${canStatus ? '' : html` disabled`}>${f.dismissReason || ''}</textarea>
    <span class="hint" id="dismiss-hint">Required and logged. Dismissing never changes the official AVA score.</span>
    <span class="err" id="dismiss-err" data-reason-err></span>
  </div>
  <div class="fld"><label for="owner">Owner</label>
    <select id="owner" class="inp" name="owner"${canStatus ? '' : html` disabled`}><option value="">Unassigned</option>${users.filter((u) => u.status === 'active').map((u) => html`<option${u.name === f.owner ? html` selected` : ''}>${u.name}</option>`)}</select></div>
  ${canStatus ? html`<button type="submit" class="btn btn-primary">Save</button>` : html`<p class="hint">Your role (${me.role}) can comment but cannot change status or owner.</p>`}
</form>
<div class="stack-sm">
  <h3 class="fld-label">Comments</h3>
  ${f.comments.length ? html`<ul class="comments">${f.comments.map((c) => html`<li class="inner"><span class="small"><b>${c.by}</b> · <span class="muted">${fmtDateTime(c.at)}</span></span><p>${c.text}</p></li>`)}</ul>` : html`<p class="hint">No comments yet.</p>`}
  ${canComment ? html`<form class="stack-sm" data-comment-form><label for="comment" class="sr-only">Add a comment</label><textarea id="comment" class="inp" rows="2" placeholder="Add a comment" required></textarea><button type="submit" class="btn">Comment</button></form>` : ''}
</div>
${challengesBlock(f, a, me, canStatus, canComment)}
<div class="stack-sm">
  <h3 class="fld-label">History</h3>
  ${f.history.length ? html`<ul class="history small">${[...f.history].reverse().map((h) => html`<li><span class="muted">${fmtDateTime(h.at)}</span> <b>${h.by}</b> ${h.action}${h.detail ? html`: ${h.detail}` : ''}</li>`)}</ul>` : html`<p class="hint">No changes yet. Every change is written to the audit log.</p>`}
</div>`;
}

function challengesBlock(f, a, me, canStatus, canComment) {
  const chs = (a.challenges || []).filter((c) => c.findingId === f.id);
  return html`<div class="stack-sm">
  <h3 class="fld-label">Challenges</h3>
  <p class="hint">Disagree with this finding? Challenge it with evidence. Someone else in your team answers it. The official score never changes; an upheld challenge is a reason to re-audit.</p>
  ${chs.length ? html`<ul class="comments">${chs.map((c) => html`<li class="inner stack-sm">
    <span class="small"><b>${c.by}</b> · <span class="muted">${fmtDateTime(c.at)}</span> <span class="status-chip ${CH_CLASS[c.status]}">${CH_STATUS[c.status]}</span></span>
    <p>${c.claim}</p>
    ${c.evidence ? html`<p class="small muted">Evidence: ${c.evidence}</p>` : ''}
    ${c.response ? html`<p class="small">Answer from ${c.respondedBy}: ${c.response}</p>` : ''}
    ${c.status === 'open' && canStatus && c.authorId !== me.id ? html`<form class="stack-sm" data-answer-form="${c.id}">
      <label class="sr-only" for="ans-${c.id}">Your answer</label><textarea id="ans-${c.id}" class="inp" rows="2" required placeholder="What you checked and what you found"></textarea>
      <div class="row-actions"><button type="submit" class="btn" value="upheld">Uphold</button><button type="submit" class="btn" value="rejected">Reject</button></div></form>` : ''}
  </li>`)}</ul>` : ''}
  ${canComment ? html`<details class="ch-new"><summary class="link-btn">Challenge this finding</summary>
    <form class="stack-sm" data-challenge-form>
      <div class="fld"><label for="ch-claim">What is wrong with it? <span class="req" aria-hidden="true">*</span></label><textarea id="ch-claim" class="inp" rows="2" required maxlength="2000" placeholder="For example: runway is 20 months, not 9"></textarea></div>
      <div class="fld"><label for="ch-evidence">Evidence</label><textarea id="ch-evidence" class="inp" rows="2" maxlength="4000" placeholder="What shows it: a document in the data room, a figure, a link"></textarea></div>
      <button type="submit" class="btn">Submit challenge</button>
    </form></details>` : ''}
</div>`;
}

async function openFinding(id, a, ctx) {
  const f = a.findings.find((x) => x.id === id);
  const [users, me] = await Promise.all([getUsers(), getCurrentUser()]);
  openSheet({
    title: f.title,
    body: findingSheetBody(f, a, users, me),
    onMount(el, close) {
      const form = el.querySelector('[data-status-form]');
      const wrap = el.querySelector('[data-reason-wrap]');
      form.addEventListener('change', () => { wrap.hidden = form.elements.status.value !== 'dismissed'; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = form.elements.status.value;
        const reason = form.elements.reason.value;
        if (status === 'dismissed' && !reason.trim()) {
          el.querySelector('[data-reason-err]').textContent = 'Enter a reason to dismiss this finding.';
          form.elements.reason.setAttribute('aria-invalid', 'true');
          form.elements.reason.focus();
          return;
        }
        try {
          if (status !== f.status || (status === 'dismissed' && reason.trim() !== (f.dismissReason || ''))) await setFindingStatus(a.id, f.id, status, reason);
          if ((form.elements.owner.value || null) !== (f.owner || null)) await setFindingOwner(a.id, f.id, form.elements.owner.value);
          close();
          toast(status === 'dismissed' ? 'Dismissed. Score excluding dismissed findings updated.' : 'Saved.');
          ctx.refresh();
        } catch (err) { toast(err.message); }
      });
      const reopen = async (msg) => { close(); toast(msg); await ctx.refresh(); openFinding(id, (await getAudit(a.id)), ctx); };
      const chForm = el.querySelector('[data-challenge-form]');
      if (chForm) {
        chForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const claim = chForm.querySelector('#ch-claim').value.trim();
          if (!claim) return;
          try { await challengeFinding(a.id, f.id, { claim, evidence: chForm.querySelector('#ch-evidence').value }); await reopen('Challenge recorded.'); } catch (err) { toast(err.message); }
        });
      }
      el.querySelectorAll('[data-answer-form]').forEach((form) => form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = form.querySelector('textarea').value.trim();
        if (!text) return;
        try { await answerChallenge(form.dataset.answerForm, e.submitter.value, text); await reopen(e.submitter.value === 'upheld' ? 'Challenge upheld.' : 'Challenge rejected.'); } catch (err) { toast(err.message); }
      }));
      const cform = el.querySelector('[data-comment-form]');
      if (cform) {
        cform.addEventListener('submit', async (e) => {
          e.preventDefault();
          const text = cform.querySelector('textarea').value.trim();
          if (!text) return;
          await addComment(a.id, f.id, text);
          close();
          toast('Comment added.');
          await ctx.refresh();
          openFinding(id, (await getAudit(a.id)), ctx);
        });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Share sheet (spec 4.9)

function shareBody(a, users) {
  const links = a.shareLinks;
  return html`<section class="stack-md">
  <h3 class="fld-label">Share inside your organisation</h3>
  <form class="stack-sm" data-share-internal>
    <div class="grid-2">
      <div class="fld"><label for="sh-who">Member or role</label><select id="sh-who" class="inp"><option>All Analysts</option><option>All Admins</option>${users.filter((u) => u.status === 'active').map((u) => html`<option>${u.name}</option>`)}</select></div>
      <div class="fld"><label for="sh-access">Access</label><select id="sh-access" class="inp"><option>Can view</option><option>Can comment</option></select></div>
    </div>
    <button type="submit" class="btn">Share internally</button>
  </form>
</section>
<section class="stack-md">
  <h3 class="fld-label">External view-only link</h3>
  <form class="stack-sm" data-share-external novalidate>
    <div class="fld"><label for="sh-email">Recipient email <span class="req" aria-hidden="true">*</span></label><input id="sh-email" type="email" class="inp" required autocomplete="off" aria-describedby="sh-email-err"><span class="err" id="sh-email-err" data-sh-err></span></div>
    <div class="grid-2">
      <div class="fld"><label for="sh-exp">Expires after</label><select id="sh-exp" class="inp"><option value="7">7 days</option><option value="14" selected>14 days</option><option value="30">30 days</option></select></div>
      <div class="fld"><label for="sh-pass">Password (optional)</label><input id="sh-pass" type="password" class="inp" autocomplete="new-password"></div>
    </div>
    <p class="hint">The recipient sees this report only, watermarked with their email. Every view is logged. You can revoke the link at any time.</p>
    <button type="submit" class="btn btn-primary">Create link</button>
  </form>
  ${links.length ? html`<ul class="stack-sm">${links.map((l) => html`<li class="inner share-link">
    <div class="stack-sm"><b>${l.email}</b><span class="xsmall muted">${l.revoked ? 'Revoked' : `Expires ${fmtDate(l.expires)}`}${l.passwordSet ? ' · password' : ''} · ${l.views.length} view${l.views.length === 1 ? '' : 's'}</span>
    <code class="xsmall share-url">${window.location.origin}/shared/${l.token}</code></div>
    ${l.revoked ? '' : html`<div class="row-actions"><button type="button" class="btn" data-copy-link="${l.token}">Copy link</button><button type="button" class="btn" data-revoke="${l.token}">Revoke</button></div>`}
  </li>`)}</ul>` : ''}
</section>`;
}

async function openShare(a, ctx) {
  const users = await getUsers();
  openSheet({
    title: 'Share report',
    body: shareBody(a, users),
    onMount(el, close) {
      el.querySelector('[data-share-internal]').addEventListener('submit', (e) => {
        e.preventDefault();
        toast(`Shared with ${el.querySelector('#sh-who').value} (${el.querySelector('#sh-access').value.toLowerCase()}).`);
      });
      el.querySelector('[data-share-external]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = el.querySelector('#sh-email');
        if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) {
          el.querySelector('[data-sh-err]').textContent = 'Enter the recipient\'s email.';
          email.setAttribute('aria-invalid', 'true');
          email.focus();
          return;
        }
        await createShareLink(a.id, { email: email.value.trim(), expiryDays: el.querySelector('#sh-exp').value, password: el.querySelector('#sh-pass').value });
        close();
        toast('Link created.');
        await ctx.refresh();
        openShare(await getAudit(a.id), ctx);
      });
      el.addEventListener('click', async (e) => {
        const copy = e.target.closest('[data-copy-link]');
        if (copy) {
          try { await navigator.clipboard.writeText(`${window.location.origin}/shared/${copy.dataset.copyLink}`); toast('Link copied.'); } catch { toast('Copy the link from the box above.'); }
        }
        const rev = e.target.closest('[data-revoke]');
        if (rev) { await revokeShareLink(rev.dataset.revoke); close(); toast('Link revoked.'); await ctx.refresh(); openShare(await getAudit(a.id), ctx); }
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Ask AVA: questions about this report, answered from this report only.

const suggestions = (a) => (a.company.relationship === 'owner'
  ? ['What should I fix first?', `Why ${a.finalDirective}, and what would it take to do better?`, 'Explain the biggest risk in plain English.', 'Which findings could I challenge with evidence?']
  : ['Why this directive?', 'What should I ask the founder?', 'What would move the score most?', 'Which finding rests on the least evidence?']);

function qaItem(q, a) {
  const cited = (q.findingIds || []).map((id) => a.findings.find((f) => f.id === id)).filter(Boolean);
  return html`<li class="qa stack-sm">
  <p class="qa-q"><b>${q.question}</b> <span class="xsmall muted">${q.by} · ${fmtDateTime(q.at)}</span></p>
  <p class="qa-a">${q.answer}</p>
  ${cited.length ? html`<p class="xsmall muted">Based on ${cited.map((f, i) => html`${i ? ', ' : ''}<a class="link" href="#f-${f.id}" data-ask-cite>${f.title}</a>`)}</p>` : ''}
</li>`;
}

const leftText = (left) => (left == null ? '' : `${left} question${left === 1 ? '' : 's'} left this period.`);

function askBody(a, data) {
  return html`<p class="small muted">Answers come from this report only, with the findings they rely on. AVA cannot change the score; to dispute a finding, open it and challenge it with evidence.</p>
<ol class="qa-list" data-qa-list>${data.questions.map((q) => qaItem(q, a))}</ol>
<div class="chips" data-ask-chips>${suggestions(a).map((t) => html`<button type="button" class="chip-btn" data-ask-chip>${t}</button>`)}</div>
<form class="stack-sm" data-ask-form>
  <label for="ask-q" class="fld-label">Your question</label>
  <textarea id="ask-q" class="inp" rows="2" maxlength="1000" required placeholder="Ask about any finding, the score or what to do next"></textarea>
  <div class="row-actions"><button type="submit" class="btn btn-primary">Ask AVA</button><span class="xsmall muted" data-ask-left>${leftText(data.left)}</span></div>
  <span class="err" role="alert" data-ask-err></span>
</form>`;
}

async function openAsk(a, first = '') {
  let data;
  try { data = await getQuestions(a.id); } catch (err) { toast(err.message); return; }
  openSheet({
    title: 'Ask AVA about this report',
    wide: true,
    body: askBody(a, data),
    onMount(el, close) {
      const form = el.querySelector('[data-ask-form]');
      const box = form.querySelector('textarea');
      const list = el.querySelector('[data-qa-list]');
      const send = async () => {
        const question = box.value.trim();
        if (question.length < 2) return;
        const btn = form.querySelector('[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Thinking…';
        el.querySelector('[data-ask-err]').textContent = '';
        try {
          const out = await askQuestion(a.id, question);
          list.insertAdjacentHTML('beforeend', String(qaItem(out.question, a)));
          list.lastElementChild.scrollIntoView({ block: 'nearest' });
          el.querySelector('[data-ask-left]').textContent = leftText(out.left);
          box.value = '';
        } catch (err) {
          el.querySelector('[data-ask-err]').textContent = err.code === 'question_limit' ? `${err.message} See plans at /pricing.` : err.message;
        } finally {
          btn.disabled = false;
          btn.textContent = 'Ask AVA';
        }
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
      el.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-ask-chip]');
        if (chip) { box.value = chip.textContent; send(); return; }
        const cite = e.target.closest('[data-ask-cite]');
        if (cite) {
          e.preventDefault();
          close();
          const t = document.querySelector(cite.getAttribute('href'));
          const det = t && t.closest('details');
          if (det) det.open = true;
          if (t) t.scrollIntoView({ block: 'center' });
        }
      });
      if (first) { box.value = first; send(); } else box.focus();
    },
  });
}

function askCta(a) {
  return html`<section aria-labelledby="ask-title" class="card card-pad ask-cta">
  <div class="stack-sm"><h2 id="ask-title" class="r-h2">Ask AVA about this report</h2><span class="small muted">Questions are answered from this report only, citing the findings behind each answer.</span></div>
  <div class="chips">${suggestions(a).map((t) => html`<button type="button" class="chip-btn" data-ask-open="${t}">${t}</button>`)}</div>
</section>`;
}

// ---------------------------------------------------------------------------
// Citation hover cards

function mountCitations(root, a) {
  let pop = null;
  let touchShown = null;
  const hide = () => { if (pop) { pop.remove(); pop = null; } };
  const show = (el) => {
    hide();
    const s = a.sourcesById[el.dataset.cite];
    if (!s) return;
    pop = document.createElement('div');
    pop.className = 'pop glass';
    pop.setAttribute('role', 'tooltip');
    pop.id = 'cite-pop';
    pop.innerHTML = String(html`<b>${s.title}</b><span class="xsmall muted">${s.type === 'uploaded' ? 'Uploaded' : 'Public'} · ${s.kind} · ${fmtDate(s.date)}</span><span class="xsmall">Reliability ${s.reliability}</span><span class="xsmall link">Open in Sources</span>`);
    document.body.appendChild(pop);
    const r = el.getBoundingClientRect();
    const left = Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 16);
    pop.style.left = `${Math.max(16, left)}px`;
    pop.style.top = `${window.scrollY + r.bottom + 8}px`;
    el.setAttribute('aria-describedby', 'cite-pop');
  };
  const over = (e) => { const c = e.target.closest('[data-cite]'); if (c) show(c); };
  const out = (e) => { const c = e.target.closest('[data-cite]'); if (c) { hide(); c.removeAttribute('aria-describedby'); } };
  const pointer = (e) => { root._pt = e.pointerType; };
  const click = (e) => {
    const c = e.target.closest('[data-cite]');
    if (!c || root._pt !== 'touch') return;
    if (touchShown !== c) { e.preventDefault(); touchShown = c; show(c); }
  };
  root.addEventListener('mouseover', over);
  root.addEventListener('mouseout', out);
  root.addEventListener('focusin', over);
  root.addEventListener('focusout', out);
  root.addEventListener('pointerdown', pointer);
  root.addEventListener('click', click, true);
  window.addEventListener('scroll', hide, { passive: true });
  return () => { hide(); window.removeEventListener('scroll', hide); };
}

// ---------------------------------------------------------------------------

export function reportBody(a, { guest = false } = {}) {
  if (a.status === 'failed') return failedView(a);
  const sample = a.companyId === 'northline';
  return html`
${guest ? '' : html`<div class="r-bar glass" data-report-bar>
  <span class="r-bar-name">${a.company.title}</span>
  <span class="r-bar-v ${vClass(a.finalDirective)}"><span class="lbl">Directive</span><b class="verdict-text">${a.finalDirective}</b><span class="mono">${a.score} / 100</span></span>
  <a class="btn btn-primary r-bar-pdf" href="/export?audit=${a.id}">Download PDF</a>
</div>`}
${banners(a)}
<section aria-label="Verdict" class="r-verdict">
  <div class="r-verdict-copy">
    <div class="stack-sm">
      <span class="lbl">Audit ${a.auditNumber} of ${a.auditTotal} · ${fmtDate(a.date)}${a.depth === 'deep' ? ' · Deep audit' : ''}${sample ? ' · Sample data' : ''}</span>
      <h1 class="r-title">${a.company.title}</h1>
      <p class="muted r-desc">${a.company.description}</p>
      <div class="chips"><span class="tag tag-neutral">${a.company.industry}</span><span class="tag tag-neutral">${[a.company.city, a.company.country].filter(Boolean).join(', ')}</span>${a.company.subject ? html`<span class="tag tag-neutral">${labelOf(SUBJECTS, a.company.subject)}</span>` : ''}<span class="tag tag-neutral">${a.company.decision ? labelOf(DECISIONS, a.company.decision) : TYPE_LABEL[a.company.type]}</span>${a.company.budget ? html`<span class="tag tag-neutral">${a.company.budget}</span>` : ''}</div>
    </div>
    <div class="stack-md ${vClass(a.finalDirective)}">
      <span class="lbl">Directive${a.overridden ? ' · Adjusted by the Orchestrator' : ''}</span>
      <div class="r-directive verdict-text">${a.finalDirective}</div>
      ${directiveScale(a)}
      ${isOperating(a.company.subject) ? html`<p class="small strong">For a trading business: ${runningMeaning(a.finalDirective)}</p>` : ''}
      <p class="r-rationale">${a.orchestrator?.rationale}</p>
    </div>
    ${coverageRow(a)}
  </div>
  ${verdictPanel(a)}
</section>
${chain(a)}
<div class="r-two">${whatWouldChange(a)}${trace(a)}</div>
${guest ? '' : askCta(a)}
${agentGroups(a, guest)}
${guest ? '' : html`<section aria-label="Next steps" class="hero-panel r-close">
  <div class="stars" aria-hidden="true"></div>
  <div class="stack-sm"><span class="r-close-title">Re-audit after the next material change.</span><span class="small">${a.company.title}'s record keeps every audit. Compare any two to see which findings moved and what evidence moved them.</span></div>
  <div class="row-actions"><a class="btn" href="/history/${a.companyId}">Open audit history</a><a class="btn btn-primary" href="/company/${a.companyId}?reaudit=1">Re-audit</a></div>
</section>`}`;
}

function failedView(a) {
  if (a.outcome === 'insufficient_information') {
    return html`<div class="banner banner-warn" role="alert"><div class="stack-sm"><b>No score issued: not enough to assess.</b><span class="small">${a.outcomeReason} AVA does not score a venture it cannot assess. This audit does not count against usage.</span></div><a class="btn btn-primary" href="/company/${a.companyId}">Add detail and run again</a></div>`;
  }
  return html`<div class="banner banner-bad" role="alert"><div class="stack-sm"><b>This audit failed.</b><span class="small">The Orchestrator returned no valid output after one automatic retry. No score or directive was issued, and this audit does not count against usage.</span></div><a class="btn btn-primary" href="/company/${a.companyId}?reaudit=1">Run it again</a></div>
<div class="page-head-copy"><span class="lbl">Audit ${fmtDate(a.date)} · ${a.outcome === 'insufficient_information' ? 'No score' : 'Failed'}</span><h1 class="page-title">${a.company.title}</h1></div>
<section class="card card-pad stack-md" aria-label="Agent runs">
  <h2 class="r-h2">Agent runs</h2>
  <ul class="stack-sm">${a.agentRuns.map((r) => html`<li class="run-finding"><span class="tag ${r.status === 'failed' ? 'sev-high' : 'v-proceed verdict'}">${r.status === 'failed' ? 'FAILED' : 'COMPLETE'}</span><div class="stack-sm"><b>${AGENTS[r.agent - 1].name}</b><span class="small muted">${r.status === 'failed' ? `${r.error} Output schema: ${r.schema}.` : `${r.findings} findings in ${r.duration} s.`}</span></div></li>`)}</ul>
</section>`;
}

export default {
  title: (a) => (a ? `${a.company.title} report · AVA` : 'Report · AVA'),
  className: 'report',

  async load(ctx) {
    const a = await getAudit(ctx.params.auditId);
    if (!a) throw new Error('This report does not exist.');
    if (a.status === 'running' || a.status === 'queued') ctx.navigate(`/running/${a.id}`, { replace: true });
    return a;
  },

  render(ctx, a) {
    if (a.status === 'running') return html`<div class="screen-loading"></div>`;
    return html`
<div class="r-top">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/portfolio">Portfolio</a><span aria-hidden="true">/</span><a href="/company/${a.companyId}">${a.company.title}</a><span aria-hidden="true">/</span><span>Audit ${fmtDate(a.date)}</span></nav>
  ${a.status === 'failed' ? '' : html`<div class="row-actions">
    <button type="button" class="btn btn-primary" data-ask-open="">Ask AVA</button>
    <button type="button" class="btn" data-copy>Copy as text</button>
    <button type="button" class="btn" data-share>${icon('share', { size: 18 })}Share</button>
    <a class="btn" href="/export?audit=${a.id}">Download PDF</a>
    <a class="btn" href="/history/${a.companyId}${a.previous ? `?a=${a.previous.id}&b=${a.id}` : ''}">Compare audits</a>
  </div>`}
</div>
${reportBody(a)}`;
  },

  mount(root, ctx, a) {
    if (a.status === 'failed' || a.status === 'running') return null;
    const onClick = async (e) => {
      const fbtn = e.target.closest('[data-finding]');
      if (fbtn) { openFinding(fbtn.dataset.finding, a, ctx); return; }
      if (e.target.closest('[data-share]')) { openShare(a, ctx); return; }
      const askBtn = e.target.closest('[data-ask-open]');
      if (askBtn) { openAsk(a, askBtn.dataset.askOpen); return; }
      if (e.target.closest('[data-copy]')) {
        try { await navigator.clipboard.writeText(reportText(a)); toast('Report copied as text.'); } catch { toast('Copy is not available in this browser.'); }
        return;
      }
      const tr = e.target.closest('[data-trace-open]');
      if (tr) {
        const d = root.querySelector(`#trace-${tr.dataset.traceOpen.replace(/\W+/g, '-')}`);
        if (d) d.open = true;
      }
      // Open the section containing a finding when its anchor is followed.
      const anchor = e.target.closest('a[href^="#f-"]');
      if (anchor) {
        const target = root.querySelector(anchor.getAttribute('href'));
        const det = target && target.closest('details');
        if (det) det.open = true;
      }
    };
    root.addEventListener('click', onClick);
    const cleanCites = mountCitations(root, a);
    return () => { root.removeEventListener('click', onClick); cleanCites(); };
  },
};
