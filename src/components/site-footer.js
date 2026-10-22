import { html } from '../lib/html.js';
import { logo } from './logo.js';

export function siteFooter({ large = false } = {}) {
  return html`<footer class="site-footer">
  <div class="wrap site-footer-row">
    <span class="site-footer-brand">${logo({ href: '/', large })}<span>Adversarial Venture Analyst</span></span>
    <nav class="site-footer-links" aria-label="Footer">
      <a href="/team">Team</a>
      <a href="/pricing">Pricing</a>
      <a href="/sign-in">Sign in</a>
      <span>[PRIVACY]</span>
      <span>[TERMS]</span>
    </nav>
  </div>
</footer>`;
}
