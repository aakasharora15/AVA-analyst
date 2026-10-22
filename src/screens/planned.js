import { html } from '../lib/html.js';
import { SAMPLE_REPORT_PATH } from '../config.js';

// Placeholder for routes delivered in later build phases, so no link is dead.
export function planned({ name, phase }) {
  return {
    title: `${name} · AVA`,
    className: 'planned-screen',
    render() {
      return html`<section class="planned" aria-labelledby="planned-title">
  <span class="lbl lbl-accent">Phase ${phase}</span>
  <h1 id="planned-title" class="display-m">${name}</h1>
  <p>This screen is designed and arrives in build phase ${phase}. The route is live so links and deep links already resolve.</p>
  <div style="display:flex;gap:.625rem;flex-wrap:wrap">
    <a class="btn btn-primary" href="/">Back to home</a>
    <a class="btn" href="${SAMPLE_REPORT_PATH}">Sample report</a>
  </div>
</section>`;
    },
  };
}

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
