import { html } from '../lib/html.js';

export function companyPicker(companies, currentId, { label = 'Company' } = {}) {
  return html`<div class="fld picker"><label for="company-picker">${label}</label>
  <select id="company-picker" class="inp" data-company-picker>${companies.map((c) => html`<option value="${c.id}"${c.id === currentId ? html` selected` : ''}>${c.title}</option>`)}</select></div>`;
}

export function mountCompanyPicker(root, ctx, path, signal) {
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-company-picker]')) ctx.navigate(`${path}?company=${e.target.value}`, { replace: true });
  }, { signal });
}
