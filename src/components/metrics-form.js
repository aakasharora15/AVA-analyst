// The monthly numbers form, shared by the founder's private link and the
// team's own entry. Last month's values sit under each field as a reference.
import { html } from '../lib/html.js';
import { fmtMoney } from './ui.js';

export const METRIC_FIELDS = [
  { key: 'revenue', label: 'Revenue for the month', money: true, hint: 'Recognised revenue, not bookings.' },
  { key: 'cash', label: 'Cash in the bank at month end', money: true },
  { key: 'burn', label: 'Net monthly burn', money: true, hint: 'Cash out minus cash in. Use 0 if cash-flow positive.' },
  { key: 'headcount', label: 'Headcount', hint: 'Full-time equivalents, including founders.' },
  { key: 'customers', label: 'Paying customers' },
];

export const STATUS_LABEL = { operating: 'Operating', raising: 'Raising', acquired: 'Acquired', shut_down: 'Shut down', paused: 'Paused' };

export function metricsFields({ previous = null, current = null, currency = 'GBP', idPrefix = 'm' } = {}) {
  const v = current || {};
  return html`<div class="grid-2">${METRIC_FIELDS.map((f) => html`<div class="fld">
    <label for="${idPrefix}-${f.key}">${f.label}${f.money ? ` (${currency})` : ''}</label>
    <input id="${idPrefix}-${f.key}" name="${f.key}" class="inp num" inputmode="decimal" autocomplete="off" value="${v[f.key] ?? ''}" aria-describedby="${idPrefix}-${f.key}-h">
    <span class="hint" id="${idPrefix}-${f.key}-h">${previous && previous[f.key] != null ? `Last report: ${f.money ? fmtMoney(previous[f.key], currency, { compact: false }) : previous[f.key]}. ` : ''}${f.hint || ''}</span>
  </div>`)}
  <div class="fld"><label for="${idPrefix}-status">Company status</label><select id="${idPrefix}-status" name="status" class="inp">${Object.entries(STATUS_LABEL).map(([k, l]) => html`<option value="${k}"${(v.status || 'operating') === k ? html` selected` : ''}>${l}</option>`)}</select></div>
</div>
<div class="fld"><label for="${idPrefix}-note">Anything we should know? (optional)</label><textarea id="${idPrefix}-note" name="note" class="inp" rows="3" maxlength="2000">${v.note || ''}</textarea></div>`;
}

/** Reads the form. Returns { values } or { error, field }. Accepts "1,200", "£1.2m", "480k". */
export function readMetrics(form) {
  const values = { status: form.elements.status.value, note: form.elements.note.value.trim() };
  for (const f of METRIC_FIELDS) {
    const raw = String(form.elements[f.key].value || '').trim().toLowerCase().replace(/[£$€,\s]/g, '');
    if (!raw) { values[f.key] = null; continue; }
    const m = raw.match(/^(\d+(?:\.\d+)?)([km]?)$/);
    if (!m) return { error: `Enter ${f.label.toLowerCase()} as a number, like 48000 or 48k.`, field: f.key };
    const n = Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
    values[f.key] = f.money ? n : Math.round(n);
  }
  if (METRIC_FIELDS.every((f) => values[f.key] == null)) return { error: 'Enter at least one number.', field: 'revenue' };
  return { values };
}

/** Sanity flags as one readable sentence string. */
export const flagText = (flags) => (flags || []).map((f) => (/[.?!]$/.test(f) ? f : `${f}.`)).join(' ');
