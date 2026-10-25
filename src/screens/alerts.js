import { html } from '../lib/html.js';
import { MODE, getAlerts, getOrg, updateOrg, markAlertRead, markAllAlertsRead, snoozeCompany, unsnoozeCompany, can } from '../data/repo.js';
import { fmtDate, verdictTag, emptyState } from '../components/ui.js';
import { alertTitle, TRIGGER_LABEL } from '../components/alert-text.js';
import { toast } from '../components/sheet.js';

const FILTERS = [['all', 'All'], ['unread', 'Unread'], ['directive', 'Directive change'], ['score', 'Score move'], ['high', 'New HIGH finding'], ['evidence', 'New evidence'], ['snoozed', 'Snoozed']];

const RULES = [
  { k: 'directive', label: 'Directive changes', note: 'Only when the score crosses a band edge by 2 or more points, or an Orchestrator override cites a HIGH finding that is new or unchanged.' },
  { k: 'score', label: 'Score moves by 5 points or more', note: 'Suppressed across calibration versions.' },
  { k: 'high', label: 'New HIGH severity finding', note: 'Any agent, any section.' },
  { k: 'evidence', label: 'New evidence added to the data room', note: 'Off by default. Can be noisy.' },
];

function why(a) {
  if (a.trigger === 'directive') {
    return a.causedByOverride
      ? `The Orchestrator moved the directive one band down, citing ${a.anchors.join(', ') || 'a HIGH finding'}. Score ${a.fromScore} to ${a.toScore}.`
      : `Score moved from ${a.fromScore} to ${a.toScore}, crossing the band edge by 2 or more points.`;
  }
  if (a.trigger === 'score') return `Score moved from ${a.fromScore} to ${a.toScore}. Directive ${a.fromDirective === a.toDirective ? `stayed ${a.toDirective}` : `changed to ${a.toDirective}`}.`;
  if (a.trigger === 'high') return a.findingTitle ? `${a.findingTitle} (${a.findingCategory}). Not HIGH in the previous audit.` : 'A new HIGH finding.';
  return 'New files were added to the data room.';
}

export default {
  title: 'Alerts · AVA',
  className: 'alerts',

  async load() {
    const [alerts, org] = await Promise.all([getAlerts(), getOrg()]);
    return { alerts, org };
  },

  render(ctx, { alerts, org }) {
    const f = ctx.query.get('filter') || 'all';
    const list = alerts.filter((a) => {
      if (f === 'snoozed') return a.snoozed;
      if (a.snoozed) return false;
      if (f === 'unread') return !a.read;
      if (f === 'all') return true;
      return a.trigger === f;
    });
    const count = (k) => alerts.filter((a) => (k === 'snoozed' ? a.snoozed : !a.snoozed && (k === 'all' || (k === 'unread' ? !a.read : a.trigger === k)))).length;
    const settings = can('settings');
    return html`
<div class="page-head">
  <div class="page-head-copy">${MODE === 'mock' ? html`<span class="lbl">Sample data</span>` : ''}<h1 class="page-title">Alerts</h1><p class="muted page-sub">Only material movements in a company's risk. Routine audits that change little stay out of this list.</p></div>
  <button type="button" class="btn" data-readall${count('unread') ? '' : html` disabled`}>Mark all as read</button>
</div>
<div class="split">
  <aside class="side">
    <form class="card card-pad stack-sm" data-rules>
      <span class="lbl">What counts as material</span>
      ${RULES.map((r) => html`<label class="check"><input type="checkbox" name="${r.k}"${org.alertRules[r.k] ? html` checked` : ''}${settings ? '' : html` disabled`}><span class="check-copy"><span>${r.label}</span><span class="hint">${r.note}</span></span></label>`)}
      ${settings ? '' : html`<p class="hint">Only Owners and Admins can change alert rules.</p>`}
    </form>
    <form class="card card-pad stack-sm" data-delivery>
      <span class="lbl">Delivery</span>
      <label class="check"><input type="checkbox" name="inApp" checked disabled><span class="check-copy"><span>In app</span><span class="hint">Always on.</span></span></label>
      <div class="fld"><label for="al-email">Email digest</label><select id="al-email" class="inp" name="email"${settings ? '' : html` disabled`}>${[['weekly', 'Weekly (default)'], ['daily', 'Daily'], ['off', 'Off']].map(([k, l]) => html`<option value="${k}"${org.delivery.email === k ? html` selected` : ''}>${l}</option>`)}</select></div>
      <label class="check"><input type="checkbox" name="immediate"${org.delivery.immediate ? html` checked` : ''}${settings ? '' : html` disabled`}><span class="check-copy"><span>Send immediately</span><span class="hint">Directive changes and new HIGH findings. Every email has settings and unsubscribe links.</span></span></label>
    </form>
    ${org.holdMode ? html`<div class="banner banner-warn"><b>Hold mode is on.</b><span class="small">Directive-change alerts are paused.</span></div>` : ''}
  </aside>
  <section class="body" aria-label="Recent alerts">
    <div class="chips" role="group" aria-label="Filter alerts">${FILTERS.map(([k, l]) => html`<button type="button" class="chip-btn" data-filter="${k}" aria-pressed="${f === k}">${l} (${count(k)})</button>`)}</div>
    ${list.length ? html`<ul class="stack-sm al-list">${list.map((a) => html`<li class="card al-item${a.read ? '' : ' unread'}">
      <span class="al-dot" aria-hidden="true"></span>
      <div class="stack-sm al-body">
        <div class="r-sec-head"><a class="strong" href="/company/${a.companyId}">${a.company}</a><span class="lbl">${TRIGGER_LABEL[a.trigger]} · ${fmtDate(a.date)}${a.read ? '' : ' · Unread'}</span></div>
        <span class="al-title">${alertTitle(a)}</span>
        <span class="small muted">${why(a)}</span>
        <div class="row-actions al-actions">
          ${a.previousAuditId ? html`<a class="btn" href="/history/${a.companyId}?a=${a.previousAuditId}&b=${a.auditId}">Compare audits</a>` : ''}
          ${a.auditId ? html`<a class="btn" href="/report/${a.auditId}">Open report</a>` : ''}
          <button type="button" class="btn" data-read="${a.id}" data-state="${a.read}">${a.read ? 'Mark unread' : 'Mark read'}</button>
          ${a.snoozed ? html`<button type="button" class="btn" data-unsnooze="${a.companyId}">Unsnooze company</button>` : html`<button type="button" class="btn" data-snooze="${a.companyId}">Snooze company 7 days</button>`}
        </div>
      </div>
      <div class="al-score"><span class="lbl">Score</span><span class="num">${a.fromScore ?? ''}${a.toScore != null ? ` → ${a.toScore}` : ''}</span>${a.toDirective ? verdictTag(a.toDirective) : ''}</div>
    </li>`)}</ul>` : emptyState({ title: f === 'all' ? 'No alerts yet.' : 'Nothing here.', body: f === 'all' ? 'Alerts appear when a company\'s risk moves materially after an audit: a directive change, a score move of 5 or more, or a new HIGH finding.' : 'Change the filter to see other alerts.', action: f === 'all' ? { href: '/portfolio', label: 'Open portfolio' } : null })}
  </section>
</div>`;
  },

  mount(root, ctx) {
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    root.addEventListener('click', async (e) => {
      const t = e.target;
      const fl = t.closest('[data-filter]');
      if (fl) { ctx.navigate(`/alerts?filter=${fl.dataset.filter}`, { replace: true }); return; }
      if (t.closest('[data-readall]')) { await markAllAlertsRead(); toast('All alerts marked as read.'); ctx.refresh(); }
      const r = t.closest('[data-read]');
      if (r) { await markAlertRead(r.dataset.read, r.dataset.state !== 'true'); ctx.refresh(); }
      const s = t.closest('[data-snooze]');
      if (s) { await snoozeCompany(s.dataset.snooze, 7); toast('Snoozed for 7 days.'); ctx.refresh(); }
      const u = t.closest('[data-unsnooze]');
      if (u) { await unsnoozeCompany(u.dataset.unsnooze); toast('Alerts restored.'); ctx.refresh(); }
    }, opts);
    root.addEventListener('change', async (e) => {
      const rules = e.target.closest('[data-rules]');
      const del = e.target.closest('[data-delivery]');
      try {
        if (rules) {
          const org = await getOrg();
          await updateOrg({ alertRules: { ...org.alertRules, [e.target.name]: e.target.checked } }, `Turned ${e.target.checked ? 'on' : 'off'} alerts for ${RULES.find((x) => x.k === e.target.name).label.toLowerCase()}`);
          toast('Alert rules saved.');
        }
        if (del) {
          const org = await getOrg();
          const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
          await updateOrg({ delivery: { ...org.delivery, [e.target.name]: v } }, 'Changed alert delivery');
          toast('Delivery saved.');
        }
      } catch (err) { toast(err.message); }
    }, opts);
    return () => ac.abort();
  },
};
