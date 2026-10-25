// Search (⌘K / Ctrl+K, or "/"): jump to any company or screen from anywhere
// in the workspace. Results are ordinary links, so the router handles them.
import { html } from '../lib/html.js';
import { icon, verdictTag } from './ui.js';
import { getCompanies } from '../data/repo.js';

const PLACES = [
  ['New analysis', '/new-analysis', 'Run an audit on a new or existing company'],
  ['Portfolio', '/portfolio', 'Every company and its current verdict'],
  ['Alerts', '/alerts', 'Material risk movements'],
  ['Data room', '/data-room', 'Files the agents read'],
  ['Sources', '/sources', 'Every source and what cites it'],
  ['Benchmarks', '/benchmarks', 'Scores against comparable ventures'],
  ['Outcomes', '/outcomes', 'What happened after each verdict'],
  ['Billing and usage', '/account?tab=billing', 'Plan, audits used, invoices'],
  ['Team and roles', '/account?tab=team', 'Invite colleagues, change roles'],
  ['Security', '/account?tab=security', 'Two-factor sign-in, sessions'],
  ['Audit log', '/account?tab=log', 'Who did what, when'],
  ['Help and contact', '/help', 'How AVA works, and how to reach us'],
];

const norm = (s) => String(s || '').toLowerCase();

function results(q, companies) {
  const t = norm(q).trim();
  const cos = companies
    .filter((c) => !t || norm(c.title).includes(t) || norm(c.industry).includes(t) || norm(c.country).includes(t))
    .sort((a, b) => (norm(a.title).startsWith(t) ? 0 : 1) - (norm(b.title).startsWith(t) ? 0 : 1) || a.title.localeCompare(b.title))
    .slice(0, t ? 8 : 5)
    .map((c) => ({ label: c.title, href: `/company/${c.id}`, note: [c.industry, c.country].filter(Boolean).join(' · '), directive: c.latest && c.latest.finalDirective }));
  const places = PLACES.filter(([l, , n]) => !t || norm(l).includes(t) || norm(n).includes(t)).map(([label, href, note]) => ({ label, href, note }));
  return { cos, places };
}

function listHtml({ cos, places }) {
  if (!cos.length && !places.length) return html`<p class="muted small cmd-empty">Nothing matches. Try a company name, industry or screen.</p>`;
  const item = (r) => html`<li role="option" aria-selected="false"><a href="${r.href}" class="cmd-item" tabindex="-1"><span class="cmd-copy"><b>${r.label}</b><span class="small muted">${r.note}</span></span>${r.directive ? verdictTag(r.directive) : ''}</a></li>`;
  return html`${cos.length ? html`<div class="lbl cmd-group">Companies</div><ul class="cmd-list" role="listbox" aria-label="Companies">${cos.map(item)}</ul>` : ''}
${places.length ? html`<div class="lbl cmd-group">Go to</div><ul class="cmd-list" role="listbox" aria-label="Screens">${places.map(item)}</ul>` : ''}`;
}

let open = false;

export async function openCommand() {
  if (open) return;
  open = true;
  const companies = await getCompanies().catch(() => []);
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet glass cmd';
  dialog.setAttribute('aria-label', 'Search');
  dialog.innerHTML = String(html`<div class="cmd-bar">${icon('search')}<label class="sr-only" for="cmd-q">Search companies and screens</label><input id="cmd-q" class="cmd-input" type="search" placeholder="Search companies and screens" autocomplete="off" spellcheck="false"><kbd class="cmd-kbd">Esc</kbd></div><div class="cmd-results" data-cmd-results></div>`);
  document.body.appendChild(dialog);
  const input = dialog.querySelector('#cmd-q');
  const box = dialog.querySelector('[data-cmd-results]');
  let active = 0;
  const links = () => [...box.querySelectorAll('.cmd-item')];
  const mark = () => links().forEach((a, i) => { a.parentElement.setAttribute('aria-selected', String(i === active)); if (i === active) a.scrollIntoView({ block: 'nearest' }); });
  const paint = () => { box.innerHTML = String(listHtml(results(input.value, companies))); active = 0; mark(); };
  const close = () => { open = false; dialog.close(); dialog.remove(); };
  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => {
    const n = links().length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); active = (active + 1) % n; mark(); }
    if (e.key === 'ArrowUp' && n) { e.preventDefault(); active = (active - 1 + n) % n; mark(); }
    if (e.key === 'Enter' && n) { e.preventDefault(); const a = links()[active]; close(); a.click(); }
  });
  box.addEventListener('click', (e) => { if (e.target.closest('.cmd-item')) close(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.showModal();
  paint();
  input.focus();
}

/** Keyboard shortcut. Returns its cleanup. */
export function bindCommandKey() {
  const onKey = (e) => {
    const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey)) {
      e.preventDefault();
      openCommand();
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
