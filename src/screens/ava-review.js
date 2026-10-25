import { html } from '../lib/html.js';
import { fmtMoney, emptyState, fmtDateTime } from '../components/ui.js';
import { openSheet, toast } from '../components/sheet.js';
import { getReviewQueue, reviewMetrics } from '../data/repo.js';
import { STATUS_LABEL, METRIC_FIELDS, flagText } from '../components/metrics-form.js';

// AVA team review (AVA_STAFF_EMAILS, two-factor required): numbers that a
// client has confirmed, across every Enterprise organisation. Verify, or
// query with a note that goes to the company owner.

const TABS = [['pending', 'To review'], ['queried', 'Queried'], ['verified', 'Verified']];
const monthLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function compare(i) {
  const p = i.previous;
  return html`<table class="mt-tbl rv-tbl"><caption class="sr-only">${i.company}: this month against the previous report</caption>
  <thead><tr><th scope="col">Metric</th><th scope="col" class="num">${monthLabel(i.period)}</th><th scope="col" class="num">${p ? monthLabel(p.period) : 'Previous'}</th></tr></thead>
  <tbody>${METRIC_FIELDS.map((f) => html`<tr><th scope="row">${f.label}</th><td class="num">${f.money ? fmtMoney(i[f.key], i.currency, { compact: false }) : (i[f.key] ?? '–')}</td><td class="num muted">${p ? (f.money ? fmtMoney(p[f.key], i.currency, { compact: false }) : (p[f.key] ?? '–')) : '–'}</td></tr>`)}
  <tr><th scope="row">Runway</th><td class="num">${i.runway != null ? `${i.runway} months` : '–'}</td><td class="num muted">${p && p.runway != null ? `${p.runway} months` : '–'}</td></tr>
  <tr><th scope="row">Status</th><td class="num">${STATUS_LABEL[i.status]}</td><td class="num muted">${p ? STATUS_LABEL[p.status] : '–'}</td></tr></tbody></table>`;
}

export default {
  title: 'AVA review · AVA',
  className: 'ava-review',

  async load(ctx) {
    const status = ctx.query.get('status') || 'pending';
    try { return { status, items: await getReviewQueue(status) }; } catch (err) {
      if (err.status === 404) return { status, denied: 'This page is for the AVA review team.' };
      return { status, denied: err.message };
    }
  },

  render(ctx, d) {
    if (d.denied) return emptyState({ title: 'Not available.', body: d.denied });
    return html`<div class="page-head"><div class="page-head-copy"><span class="lbl">AVA team</span><h1 class="page-title">Metric review</h1><p class="muted page-sub">Numbers clients have confirmed. Verify them against the evidence, or query them with a note the company owner will see.</p></div></div>
<nav class="chips rv-tabs" aria-label="Review status">${TABS.map(([k, l]) => html`<a class="chip-btn" href="/ava-review?status=${k}" aria-pressed="${d.status === k}">${l}</a>`)}</nav>
${d.items.length ? html`<ul class="rv-list">${d.items.map((i) => html`<li class="card card-pad stack-md">
  <div class="r-sec-head"><div class="stack-sm"><b>${i.company}</b><span class="small muted">${i.organisation} · ${monthLabel(i.period)} · ${i.source === 'founder' ? `from ${i.submittedBy}` : 'entered by the team'} · confirmed by ${i.confirmedBy}</span></div>
    ${d.status === 'pending' || d.status === 'queried' ? html`<span class="row-actions"><button type="button" class="btn btn-primary" data-verify="${i.id}">Verify</button><button type="button" class="btn" data-query="${i.id}">Query</button></span>` : html`<span class="small muted">Verified ${i.avaReviewedAt ? fmtDateTime(i.avaReviewedAt) : ''}</span>`}</div>
  ${i.flags && i.flags.length ? html`<div class="banner banner-warn rv-check" role="note"><b>Check</b><span>${flagText(i.flags)}</span></div>` : ''}
  ${i.avaStatus === 'queried' && i.avaNote ? html`<p class="small mt-query">Query sent: ${i.avaNote}</p>` : ''}
  ${i.note ? html`<p class="small"><span class="muted">Note from the company:</span> ${i.note}</p>` : ''}
  <div class="mt-scroll">${compare(i)}</div>
</li>`)}</ul>` : emptyState({ title: d.status === 'pending' ? 'Nothing to review.' : 'Nothing here.', body: d.status === 'pending' ? 'Confirmed numbers appear here as clients confirm them.' : 'Items move here as they are reviewed.' })}`;
  },

  mount(root, ctx) {
    const ac = new AbortController();
    root.addEventListener('click', async (e) => {
      const v = e.target.closest('[data-verify]');
      if (v) {
        v.disabled = true;
        try { await reviewMetrics(v.dataset.verify, 'verify'); toast('Verified.'); ctx.refresh(); } catch (err) { toast(err.message); v.disabled = false; }
      }
      const q = e.target.closest('[data-query]');
      if (q) {
        openSheet({
          title: 'Query these numbers',
          body: html`<form class="stack-md" data-q novalidate><div class="fld"><label for="q-note">What needs checking?</label><textarea id="q-note" class="inp" rows="4" maxlength="2000" placeholder="For example: cash rose by £1.2M with no funding reported. Please confirm the bank balance."></textarea></div><span class="err" role="alert" data-q-err></span><div class="row-actions"><button type="submit" class="btn btn-primary">Send query</button><button type="button" class="btn" data-close>Cancel</button></div></form>`,
          onMount(el, close) {
            el.querySelector('[data-q]').addEventListener('submit', async (ev) => {
              ev.preventDefault();
              const note = el.querySelector('#q-note').value.trim();
              if (!note) { el.querySelector('[data-q-err]').textContent = 'Say what needs checking.'; return; }
              try { await reviewMetrics(q.dataset.query, 'query', note); close(); toast('Query sent to the company owner.'); ctx.refresh(); } catch (err) { el.querySelector('[data-q-err]').textContent = err.message; }
            });
          },
        });
      }
    }, { signal: ac.signal });
    return () => ac.abort();
  },
};
