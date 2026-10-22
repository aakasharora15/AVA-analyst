import { html } from '../lib/html.js';
import { logo } from './logo.js';
import { icon, fmtDate, verdictTag } from './ui.js';
import { getAlerts, markAlertRead, markAllAlertsRead, unreadAlertCount, getCurrentUser } from '../data/repo.js';
import { alertTitle } from './alert-text.js';

const NAV = [
  { label: 'Portfolio', href: '/portfolio', match: ['/portfolio', '/company', '/history', '/report', '/running', '/new-analysis'] },
  { label: 'Alerts', href: '/alerts', match: ['/alerts'] },
  { label: 'Data room', href: '/data-room', match: ['/data-room'] },
  { label: 'Sources', href: '/sources', match: ['/sources'] },
  { label: 'Benchmarks', href: '/benchmarks', match: ['/benchmarks'] },
  { label: 'Outcomes', href: '/outcomes', match: ['/outcomes'] },
  { label: 'Account', href: '/account', match: ['/account', '/export'] },
];

export function appHeader({ path }) {
  const items = NAV.map((item) => {
    const current = item.match.some((m) => path === m || path.startsWith(`${m}/`));
    return html`<a class="navl" href="${item.href}"${current ? html` aria-current="page"` : ''}>${item.label}</a>`;
  });
  return html`<header class="site-header app-header wrap wrap-app" data-site-header>
  <div class="site-header-bar glass">
    ${logo({ href: '/portfolio', label: 'AVA portfolio' })}
    <nav class="capsule" id="primary-nav" aria-label="Primary">${items}</nav>
    <div class="site-header-end">
      <div class="notif">
        <button type="button" class="icon-btn notif-btn" data-notif-toggle aria-expanded="false" aria-controls="notif-panel" aria-label="Notifications">${icon('bell')}<span class="notif-count" data-notif-count hidden></span></button>
      </div>
      <a class="btn btn-primary app-new" href="/new-analysis">New analysis</a>
      <a class="avatar" href="/account" data-avatar aria-label="Account">AM</a>
      <button class="icon-btn menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="primary-nav" data-menu-toggle>${icon('menu')}</button>
    </div>
  </div>
  <div class="notif-panel glass" id="notif-panel" role="region" aria-label="Notifications" hidden></div>
</header>`;
}

function panelBody(alerts) {
  const list = alerts.filter((a) => !a.snoozed).slice(0, 6);
  const unread = alerts.filter((a) => !a.read && !a.snoozed).length;
  return html`<div class="notif-head"><b>Notifications</b>${unread ? html`<button type="button" class="link-btn" data-notif-readall>Mark all read</button>` : html`<span class="muted small">All read</span>`}</div>
  ${list.length ? html`<ul class="notif-list">${list.map((a) => html`<li class="notif-item${a.read ? '' : ' unread'}">
    <a href="${a.previousAuditId ? `/history/${a.companyId}?a=${a.previousAuditId}&b=${a.auditId}` : `/company/${a.companyId}`}" data-notif-item="${a.id}">
      <span class="notif-dot" aria-hidden="true"></span>
      <span class="notif-copy"><b>${a.company}</b><span>${alertTitle(a)}</span><span class="lbl">${fmtDate(a.date)}${a.read ? '' : ' · Unread'}</span></span>
      ${a.toDirective ? verdictTag(a.toDirective) : ''}
    </a></li>`)}</ul>` : html`<p class="muted small notif-empty">No alerts yet. They appear when a company's risk moves materially.</p>`}
  <a class="notif-all" href="/alerts">Open all alerts</a>`;
}

export function mountAppHeader(root) {
  const header = root.querySelector('[data-site-header]');
  if (!header) return () => {};
  const btn = header.querySelector('[data-notif-toggle]');
  const panel = header.querySelector('#notif-panel');
  const count = header.querySelector('[data-notif-count]');
  const avatar = header.querySelector('[data-avatar]');
  const menu = header.querySelector('[data-menu-toggle]');

  const refreshCount = async () => {
    const n = await unreadAlertCount();
    count.hidden = !n;
    count.textContent = n > 9 ? '9+' : String(n);
    btn.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
  };
  getCurrentUser().then((u) => { avatar.textContent = u.initials; avatar.setAttribute('aria-label', `Account, signed in as ${u.name}`); });
  refreshCount();

  const setOpen = async (open) => {
    btn.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    if (open) panel.innerHTML = String(panelBody(await getAlerts()));
  };
  const onBtn = () => setOpen(panel.hidden);
  const onPanel = async (e) => {
    if (e.target.closest('[data-notif-readall]')) {
      await markAllAlertsRead();
      await refreshCount();
      setOpen(true);
      return;
    }
    const item = e.target.closest('[data-notif-item]');
    if (item) { await markAlertRead(item.dataset.notifItem); refreshCount(); setOpen(false); }
  };
  const onDoc = (e) => { if (!panel.hidden && !e.target.closest('.notif, #notif-panel')) setOpen(false); };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (!panel.hidden) { setOpen(false); btn.focus(); }
    if (header.dataset.open === 'true') { header.dataset.open = 'false'; menu.setAttribute('aria-expanded', 'false'); menu.focus(); }
  };
  const onMenu = () => {
    const open = header.dataset.open !== 'true';
    header.dataset.open = String(open);
    menu.setAttribute('aria-expanded', String(open));
  };
  const onNav = (e) => { if (e.target.closest('#primary-nav a')) { header.dataset.open = 'false'; menu.setAttribute('aria-expanded', 'false'); } };
  btn.addEventListener('click', onBtn);
  panel.addEventListener('click', onPanel);
  menu.addEventListener('click', onMenu);
  header.addEventListener('click', onNav);
  document.addEventListener('click', onDoc);
  document.addEventListener('keydown', onKey);
  window.addEventListener('ava:data', refreshCount);
  return () => {
    document.removeEventListener('click', onDoc);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('ava:data', refreshCount);
  };
}
