import { html } from '../lib/html.js';
import { logo } from './logo.js';
import { SAMPLE_REPORT_PATH } from '../config.js';

const NAV = [
  { label: 'Home', href: '/' },
  { label: 'How it works', href: '/#how' },
  { label: 'Agents', href: '/#agents' },
  { label: 'Live demo', href: `/sign-in?demo=1&next=${encodeURIComponent(SAMPLE_REPORT_PATH)}` },
  { label: 'Pricing', href: '/pricing' },
  { label: 'FAQ', href: '/#faq' },
  { label: 'Team', href: '/team' },
];

const bolt = html`<svg class="btn-ico" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>`;
const menuIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;

// Public site header: glass bar, centred capsule nav, active item underlined.
export function siteHeader({ path, large = false }) {
  const items = NAV.map((item) => {
    const current = item.href === path;
    return html`<a class="navl" href="${item.href}"${current ? html` aria-current="page"` : ''}>${item.label}</a>`;
  });
  return html`<header class="site-header wrap" data-site-header>
  <div class="site-header-bar glass">
    ${logo({ href: '/', large })}
    <nav class="capsule" id="primary-nav" aria-label="Primary">${items}<a class="navl navl-login-menu" href="/sign-in">Login</a></nav>
    <div class="site-header-end">
      <a class="navl navl-login" href="/sign-in">Login</a>
      <a class="btn btn-primary" href="/free-audit">${bolt}Free audit</a>
      <button class="icon-btn menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="primary-nav" data-menu-toggle>${menuIcon}</button>
    </div>
  </div>
</header>`;
}

export function mountSiteHeader(root) {
  const header = root.querySelector('[data-site-header]');
  if (!header) return () => {};
  const toggle = header.querySelector('[data-menu-toggle]');
  const setOpen = (open) => {
    header.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  const onToggle = () => setOpen(header.dataset.open !== 'true');
  const onKey = (e) => { if (e.key === 'Escape' && header.dataset.open === 'true') { setOpen(false); toggle.focus(); } };
  const onNavClick = (e) => { if (e.target.closest('a')) setOpen(false); };
  toggle.addEventListener('click', onToggle);
  header.addEventListener('keydown', onKey);
  header.addEventListener('click', onNavClick);
  return () => {
    toggle.removeEventListener('click', onToggle);
    header.removeEventListener('keydown', onKey);
    header.removeEventListener('click', onNavClick);
  };
}
