import { html } from '../lib/html.js';

export const notFound = {
  title: 'Page not found · AVA',
  className: 'planned-screen',
  render({ path }) {
    return html`<section class="planned" aria-labelledby="nf-title">
  <span class="lbl">404</span>
  <h1 id="nf-title" class="display-m">This page does not exist</h1>
  <p>Nothing lives at <code>${path}</code>. Check the address or start from the home page.</p>
  <a class="btn btn-primary" href="/">Back to home</a>
</section>`;
  },
};
