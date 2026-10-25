// Verified metrics on the company page (Enterprise): latest numbers, monthly
// history with who reported, confirmed and verified each month, and the
// founder link settings.
import { html } from '../lib/html.js';
import { fmtDate, fmtMoney } from './ui.js';
import { openSheet, toast } from './sheet.js';
import { metricsFields, readMetrics, STATUS_LABEL, flagText } from './metrics-form.js';
import { setTracking, requestFounderUpdate, enterMetrics, confirmMetrics } from '../data/repo.js';

const monthLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function trail(m) {
  const steps = [html`<span class="tag tag-neutral">${m.source === 'founder' ? 'Founder' : 'Team'}</span>`];
  if (m.confirmedAt) steps.push(html`<span class="tag tag-neutral" title="Confirmed by ${m.confirmedBy}">Confirmed</span>`);
  if (m.avaStatus === 'verified') steps.push(html`<span class="tag v-proceed verdict">AVA verified</span>`);
  else if (m.avaStatus === 'queried') steps.push(html`<span class="tag v-hold verdict">AVA query</span>`);
  else if (m.confirmedAt) steps.push(html`<span class="tag tag-neutral">AVA review pending</span>`);
  return html`<span class="mt-trail">${steps}</span>`;
}

function change(cur, prev, { inverse = false } = {}) {
  if (cur == null || prev == null || Number(prev) === 0) return '';
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (!pct) return html`<span class="small delta-flat">flat</span>`;
  const good = inverse ? pct < 0 : pct > 0;
  return html`<span class="small ${good ? 'delta-up' : 'delta-down'}">${pct > 0 ? '+' : ''}${pct}% on last month</span>`;
}

function statusLine(t) {
  const latest = t.rows[0];
  if (latest && latest.period === t.period) {
    if (!latest.confirmedAt) return html`<b>${t.periodLabel} numbers received.</b> Check them, then confirm.`;
    if (latest.avaStatus === 'queried') return html`<b>AVA has a question about ${t.periodLabel}:</b> ${latest.avaNote}`;
    return html`<b>${t.periodLabel} is in.</b> ${latest.avaStatus === 'verified' ? 'Verified by AVA.' : 'Waiting for AVA review.'}`;
  }
  if (t.request && t.request.kind === 'founder') return html`<b>${t.periodLabel} requested</b> from ${t.request.email} on ${fmtDate(t.request.sentAt.slice(0, 10))}${t.request.remindedAt ? ', reminded once' : ''}.`;
  if (!t.founderEmail) return html`<b>Add the founder's email</b> and AVA will ask them for the numbers each month.`;
  return html`<b>${t.periodLabel} not requested yet.</b> Requests go out on the 1st, or ask now.`;
}

export function metricsCard(t, { canEdit, users, currency }) {
  if (!t || !t.tracked) return '';
  const [m, p] = t.rows;
  const kpis = m ? [
    ['Revenue', fmtMoney(m.revenue, currency), change(m.revenue, p && p.revenue)],
    ['Cash', fmtMoney(m.cash, currency), change(m.cash, p && p.cash)],
    ['Net burn', fmtMoney(m.burn, currency), change(m.burn, p && p.burn, { inverse: true })],
    ['Runway', m.runway != null ? `${m.runway} mo` : '–', m.runway != null && m.runway < 6 ? html`<span class="small delta-down">under 6 months</span>` : ''],
    ['Headcount', m.headcount ?? '–', change(m.headcount, p && p.headcount)],
    ['Customers', m.customers ?? '–', change(m.customers, p && p.customers)],
  ] : [];
  return html`<section class="card card-pad stack-lg mt-card" id="metrics" aria-labelledby="mt-title">
  <div class="r-sec-head"><h2 id="mt-title" class="card-title">Verified metrics</h2><span class="lbl">${m ? `Latest: ${monthLabel(m.period)}` : 'Monthly'}</span></div>
  <p class="small mt-status">${statusLine(t)}</p>
  ${m ? html`<div class="mt-kpis">${kpis.map(([l, v, c]) => html`<div class="mt-kpi"><span class="lbl">${l}</span><span class="num mt-kpi-n">${v}</span>${c}</div>`)}</div>` : html`<p class="muted">No numbers yet. They arrive monthly from the founder, or your team can enter them.</p>`}
  ${t.rows.length ? html`<div class="mt-scroll"><table class="mt-tbl">
    <caption class="sr-only">Monthly metrics history</caption>
    <thead><tr><th scope="col">Month</th><th scope="col" class="num">Revenue</th><th scope="col" class="num">Cash</th><th scope="col" class="num">Burn</th><th scope="col" class="num">Runway</th><th scope="col" class="num">Team</th><th scope="col" class="num">Customers</th><th scope="col">Checked</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${t.rows.map((r) => html`<tr>
      <th scope="row">${monthLabel(r.period)}${r.status !== 'operating' ? html`<br><span class="small muted">${STATUS_LABEL[r.status]}</span>` : ''}</th>
      <td class="num">${fmtMoney(r.revenue, currency)}</td><td class="num">${fmtMoney(r.cash, currency)}</td><td class="num">${fmtMoney(r.burn, currency)}</td>
      <td class="num">${r.runway != null ? `${r.runway} mo` : '–'}</td><td class="num">${r.headcount ?? '–'}</td><td class="num">${r.customers ?? '–'}</td>
      <td>${trail(r)}${r.flags && r.flags.length ? html`<span class="small muted mt-flags">${flagText(r.flags)}</span>` : ''}${r.avaStatus === 'queried' && r.avaNote ? html`<span class="small mt-query">AVA: ${r.avaNote}</span>` : ''}</td>
      <td>${canEdit && r.avaStatus !== 'verified' ? (r.confirmedAt
        ? html`<button type="button" class="link-btn small" data-mt-edit="${r.period}">Correct</button>`
        : html`<button type="button" class="btn btn-primary mt-btn" data-mt-confirm="${r.id}">Confirm</button>`) : ''}</td>
    </tr>`)}</tbody></table></div>` : ''}
  ${canEdit ? html`<div class="row-actions"><button type="button" class="btn" data-mt-edit="">Enter numbers</button>${t.founderEmail ? html`<button type="button" class="btn" data-mt-ask>Ask ${t.founderEmail} now</button>` : ''}</div>
  <details class="mt-settings"><summary>Who reports and who owns this company</summary>
    <form class="stack-md" data-mt-settings novalidate>
      <div class="grid-2">
        <div class="fld"><label for="mt-founder">Founder's email</label><input id="mt-founder" type="email" class="inp" name="founderEmail" value="${t.founderEmail || ''}" autocomplete="off" aria-describedby="mt-founder-h"><span class="hint" id="mt-founder-h">Gets a private link on the 1st of each month. No account needed.</span></div>
        <div class="fld"><label for="mt-owner">Company owner on your team</label><select id="mt-owner" class="inp" name="ownerId"><option value="">The organisation Owner</option>${users.filter((u) => u.status === 'active').map((u) => html`<option value="${u.id}"${t.ownerId === u.id ? html` selected` : ''}>${u.name}</option>`)}</select><span class="hint">Confirms the numbers and gets reminders.</span></div>
      </div>
      <span class="err" role="alert" data-mt-err></span>
      <div><button type="submit" class="btn">Save</button></div>
    </form>
  </details>` : ''}
</section>`;
}

export function mountMetricsCard(root, ctx, { t, currency }) {
  const card = root.querySelector('#metrics');
  if (!card) return;
  const settings = card.querySelector('[data-mt-settings]');
  if (settings) {
    settings.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(settings);
      try { await setTracking(t.companyId, { founderEmail: String(fd.get('founderEmail') || '').trim(), ownerId: fd.get('ownerId') }); toast('Saved.'); ctx.refresh(); } catch (err) { card.querySelector('[data-mt-err]').textContent = err.message; }
    });
  }
  card.addEventListener('click', async (e) => {
    const conf = e.target.closest('[data-mt-confirm]');
    if (conf) {
      conf.disabled = true;
      try { const r = await confirmMetrics(conf.dataset.mtConfirm); toast(r.alerts && r.alerts.length ? `Confirmed. Alert raised: ${r.alerts.join('; ')}.` : 'Confirmed. AVA will verify them next.'); ctx.refresh(); } catch (err) { toast(err.message); conf.disabled = false; }
    }
    const ask = e.target.closest('[data-mt-ask]');
    if (ask) {
      ask.disabled = true;
      try { const r = await requestFounderUpdate(t.companyId); toast(`Link sent to ${r.to}.`); ctx.refresh(); } catch (err) { toast(err.message); ask.disabled = false; }
    }
    const edit = e.target.closest('[data-mt-edit]');
    if (edit) {
      const months = [];
      const d = new Date(`${t.period}T00:00:00Z`);
      for (let i = 0; i < 6; i += 1) { months.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() - 1); }
      const chosen = edit.dataset.mtEdit || t.period;
      const paint = (period) => {
        const cur = t.rows.find((r) => r.period === period) || null;
        const prev = t.rows.find((r) => r.period < period) || null;
        return metricsFields({ previous: prev, current: cur, currency, idPrefix: 'me' });
      };
      openSheet({
        title: 'Enter numbers',
        wide: true,
        body: html`<form class="stack-md" data-me novalidate>
  <div class="fld"><label for="me-period">Month</label><select id="me-period" class="inp ac-inline" name="period">${months.map((p) => html`<option value="${p}"${p === chosen ? html` selected` : ''}>${monthLabel(p)}</option>`)}</select></div>
  <div data-me-fields>${paint(chosen)}</div>
  <p class="hint">Saving confirms these numbers in your name. AVA then verifies them.</p>
  <span class="err" role="alert" data-me-err></span>
  <div class="row-actions"><button type="submit" class="btn btn-primary">Save and confirm</button><button type="button" class="btn" data-close>Cancel</button></div>
</form>`,
        onMount(el, close) {
          const form = el.querySelector('[data-me]');
          form.elements.period.addEventListener('change', () => { el.querySelector('[data-me-fields]').innerHTML = String(paint(form.elements.period.value)); });
          form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const out = readMetrics(form);
            const err = el.querySelector('[data-me-err]');
            if (out.error) { err.textContent = out.error; form.elements[out.field].focus(); return; }
            try {
              const r = await enterMetrics(t.companyId, { ...out.values, period: form.elements.period.value });
              close();
              toast(r.alerts && r.alerts.length ? `Saved. Alert raised: ${r.alerts.join('; ')}.` : 'Saved and confirmed.');
              ctx.refresh();
            } catch (ex) { err.textContent = ex.message; }
          });
        },
      });
    }
  });
}
