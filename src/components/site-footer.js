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
      <a href="/help">Help</a>
      <a href="/trust">Trust centre</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </nav>
  </div>
</footer>`;
}
