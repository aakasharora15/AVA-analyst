import { html } from '../lib/html.js';

const PATHS = [
  'M79.51,57.63L24.04,211.71h23.11v5.86H0v-5.86h14.48L93.07,0h25.27l77.66,211.71h14.18v5.86h-100.77v-5.86h21.88L79.51,57.63Z',
  'M413.87,57.63l-55.47,154.08h23.11v5.86h-47.15v-5.86h14.48L427.43,0h25.27l77.66,211.71h14.18v5.86h-100.77v-5.86h21.88l-51.77-154.08Z',
  'M353.78,7.7h-24.04V1.85h47.15v5.86h-14.48l-74.27,212.94h-25.89L183.67,7.7h-14.18V1.85h100.77v5.86h-21.88l51.77,154.08L353.78,7.7Z',
];

export function wordmarkSvg(label = 'AVA') {
  return html`<svg viewBox="0 0 544.53 220.65" role="img" aria-label="${label}">${PATHS.map((d) => html`<path d="${d}"/>`)}</svg>`;
}

// Wordmark: 36px on the home page, 24px everywhere else.
export function logo({ href = '/', large = false, label = 'AVA home' } = {}) {
  return html`<a href="${href}" class="mark${large ? ' mark-lg' : ''}" aria-label="${label}">${wordmarkSvg('AVA')}</a>`;
}
