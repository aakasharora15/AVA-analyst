// Small shared view helpers. Verdicts and severities always carry the word,
// never colour alone.

import { html, raw } from '../lib/html.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${fmtDate(iso)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const vClass = (d) => (d ? `v-${d.toLowerCase()}` : '');

export function verdictTag(d, extra = '') {
  if (!d) return html`<span class="tag tag-neutral">No directive</span>`;
  return html`<span class="tag verdict ${vClass(d)} ${extra}">${d}</span>`;
}

export function sevTag(s, extra = '') {
  return html`<span class="tag sev-${s.toLowerCase()} ${extra}">${s}</span>`;
}

export function deltaText(d, { long = false } = {}) {
  if (d === null || d === undefined) return long ? 'First audit' : '';
  if (d === 0) return 'No change';
  return `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)}`;
}

export function deltaClass(d) {
  if (!d) return 'delta-flat';
  return d > 0 ? 'delta-up' : 'delta-down';
}

// Shown wherever a score or verdict is shown (terms: "AVA is decision support, not advice").
export const ADVICE_NOTE = 'AVA is decision support, not investment, financial or legal advice. Verdicts are automated opinions on the material supplied and can be wrong; use them alongside your own judgement.';

export const TYPE_LABEL = { startup: 'Startup', strategy: 'Strategy', campaign: 'Campaign' };

/** 25-segment score meter in the directive's colour. */
export function meter(score, directive, { label, tall = false } = {}) {
  const on = Math.round((score || 0) / 4);
  return html`<div class="meter ${vClass(directive)}${tall ? ' meter-tall' : ''}" role="img" aria-label="${label || `Score ${score} out of 100`}">${Array.from({ length: 25 }, (_, i) => (i < on ? raw('<span class="on"></span>') : raw('<span></span>')))}</div>`;
}

/** Exposure bar, 0 to 100, higher is worse. */
export function exposureBar(value, { label } = {}) {
  const tone = value >= 65 ? 'high' : value >= 45 ? 'medium' : 'low';
  return html`<span class="bar" role="img" aria-label="${label || `Exposure ${value} of 100`}"><span class="fill-${tone}" style="width:${value}%"></span></span>`;
}

export function emptyState({ title, body, action, secondary }) {
  return html`<section class="card empty-state">
  <h2 class="empty-title">${title}</h2>
  <p class="muted">${body}</p>
  <div class="row-actions">${action ? html`<a class="btn btn-primary" href="${action.href}">${action.label}</a>` : ''}${secondary ? html`<a class="btn" href="${secondary.href}">${secondary.label}</a>` : ''}</div>
</section>`;
}

/** Segmented control. Items: { key, label }. */
export function segmented(name, items, active, { label } = {}) {
  return html`<div class="seg" role="group" aria-label="${label || name}">${items.map((it) => html`<button type="button" class="seg-btn" data-seg="${name}" data-value="${it.key}" aria-pressed="${it.key === active}">${it.label}</button>`)}</div>`;
}

export function initials(name = '') {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export function pageHead({ label, title, sub, actions }) {
  return html`<div class="page-head">
  <div class="page-head-copy">
    ${label ? html`<span class="lbl">${label}</span>` : ''}
    <h1 class="page-title">${title}</h1>
    ${sub ? html`<p class="muted page-sub">${sub}</p>` : ''}
  </div>
  ${actions ? html`<div class="row-actions">${actions}</div>` : ''}
</div>`;
}

const ICONS = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};

/** Money in the organisation's currency, compact for tables: £1.2M, £480K. */
export function fmtMoney(n, currency = 'GBP', { compact = true } = {}) {
  if (n == null || Number.isNaN(Number(n))) return '–';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(Number(n));
  } catch { return String(n); }
}

export function icon(name, { size = 20 } = {}) {
  return raw(`<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);
}
