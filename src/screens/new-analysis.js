import { html } from '../lib/html.js';
import { inputProblem } from '../data/shared.js';
import { runAudit, getCompany, getOrg, can } from '../data/repo.js';
import { showAuditError } from '../components/upgrade.js';
import { canDeepAudit } from '../data/shared.js';
import { TYPE_LABEL } from '../components/ui.js';

export const INDUSTRIES = ['SaaS / Technology', 'E-Commerce / Retail', 'Food and Beverage', 'Healthcare', 'Finance / Fintech', 'Education', 'Real Estate', 'Media / Entertainment', 'Logistics / Supply Chain', 'Other'];
const DELIVERY = ['Digital / Online', 'Physical', 'Hybrid', 'SaaS', 'Marketplace'];
const BUDGETS = ['Under £10,000', '£10,000 to £50,000', '£50,000 to £100,000', '£100,000 to £500,000', '£500,000+'];
const OPTIONAL = ['model', 'city', 'target', 'price', 'delivery', 'budget', 'competitors'];

function depth(v, files) {
  const filled = OPTIONAL.filter((k) => String(v[k] || '').trim()).length;
  const pct = Math.min(100, Math.round((filled / OPTIONAL.length) * 60 + Math.min(String(v.description || '').length, 400) / 400 * 25 + Math.min(files, 3) * 5));
  return { filled, pct, label: pct < 35 ? 'Light' : pct < 70 ? 'Good' : 'Thorough' };
}

function errorsFor(v) {
  return {
    title: !String(v.title || '').trim() && 'Enter a title for the venture.',
    description: (!String(v.description || '').trim() && 'Describe the venture so the agents have something to attack.') || (String(v.title || '').trim() && inputProblem(v)),
    industry: !v.industry && 'Choose an industry.',
    country: !String(v.country || '').trim() && 'Enter a country.',
    type: !v.type && 'Choose a venture type.',
  };
}

const opt = (list, val, ph) => html`<option value="">${ph}</option>${list.map((o) => html`<option${o === val ? html` selected` : ''}>${o}</option>`)}`;

export default {
  title: 'New analysis · AVA',
  className: 'new-analysis',

  async load(ctx) {
    const companyId = ctx.query.get('company');
    const [company, org] = await Promise.all([companyId ? getCompany(companyId) : null, getOrg()]);
    return { company, deepAllowed: canDeepAudit(org) };
  },

  render(ctx, { company, deepAllowed }) {
    const v = company
      ? { title: company.title, description: company.description, industry: company.industry, country: company.country, city: company.city, model: company.model, target: company.target, type: company.type }
      : { type: 'startup' };
    const d = depth(v, 0);
    const allowed = can('runAudits');
    return html`
<div class="na">
  <aside class="na-side">
    <div class="stack-sm">
      <span class="lbl">${company ? `Re-audit · ${company.title}` : 'New analysis'}</span>
      <h1 class="page-title">Describe the venture.</h1>
      <p class="muted">Works for a startup, a strategy or a campaign. Five fields are required; type defaults to startup. Everything else sharpens the verdict.</p>
    </div>
    <div class="hero-panel na-depth">
      <div class="na-depth-head"><span class="lbl">Input detail</span><b data-depth-label>${d.label}</b></div>
      <div class="na-meter" role="img" aria-label="Input detail ${d.pct} per cent" data-depth-meter>${Array.from({ length: 20 }, (_, i) => html`<span class="${i < Math.round(d.pct / 5) ? 'on' : ''}"></span>`)}</div>
      <span class="small" data-depth-copy>${d.filled} of ${OPTIONAL.length} optional fields completed. Attach material below to go deeper still.</span>
    </div>
    <ol class="na-notes">
      <li class="card"><b>What happens next.</b><span class="muted">Six agents run in sequence. Code computes the score and directive; the Orchestrator writes the rationale last.</span></li>
      <li class="card"><b>How long.</b><span class="muted">A few minutes. You can leave and return.</span></li>
      <li class="card"><b>Confidential.</b><span class="muted">Your submission is used only for this audit, is visible only to your organisation and is never used to train AI models.</span></li>
    </ol>
  </aside>

  <form class="na-form" novalidate data-form>
    <div class="form-alert" role="alert" data-summary hidden><b>Some required fields need attention.</b><span class="small muted" data-summary-list></span></div>
    ${allowed ? '' : html`<div class="banner banner-warn" role="note"><b>Your role cannot run audits.</b><span class="small muted">Viewers can read reports and comment. Ask an Owner, Admin or Analyst to run this audit.</span></div>`}

    <fieldset class="card card-pad stack-lg">
      <legend class="card-title na-legend">Business details</legend>
      <div class="fld"><label for="f-title">Business idea title <span class="req" aria-hidden="true">*</span></label>
        <input id="f-title" name="title" class="inp" required aria-describedby="e-title" value="${v.title || ''}" placeholder="For example: Chilled last-mile delivery for independent grocers">
        <span class="err" id="e-title" data-err="title"></span></div>
      <div class="fld"><label for="f-description">Full description <span class="req" aria-hidden="true">*</span></label>
        <textarea id="f-description" name="description" class="inp" rows="6" required aria-describedby="e-description h-description" placeholder="What it does, who pays, how it makes money, what is built so far.">${v.description || ''}</textarea>
        <span class="err" id="e-description" data-err="description"></span>
        <span class="warn" id="h-description" data-thin hidden>This description is thin. Two or three more sentences on customers and revenue will give a sharper audit.</span></div>
      <div class="grid-2">
        <div class="fld"><label for="f-industry">Industry <span class="req" aria-hidden="true">*</span></label>
          <select id="f-industry" name="industry" class="inp" required aria-describedby="e-industry">${opt(INDUSTRIES, v.industry, 'Select an industry')}</select>
          <span class="err" id="e-industry" data-err="industry"></span></div>
        <div class="fld"><label for="f-type">Venture type <span class="req" aria-hidden="true">*</span></label>
          <select id="f-type" name="type" class="inp" required aria-describedby="h-type e-type">${Object.entries(TYPE_LABEL).map(([k, l]) => html`<option value="${k}"${k === v.type ? html` selected` : ''}>${l}</option>`)}</select>
          <span class="hint" id="h-type">Scores are only compared with ventures of the same type.</span>
          <span class="err" id="e-type" data-err="type"></span></div>
      </div>
      <div class="fld"><label for="f-model">Business model</label><input id="f-model" name="model" class="inp" value="${v.model || ''}" placeholder="Subscription, per-drop fee, marketplace"></div>
    </fieldset>

    <fieldset class="card card-pad stack-lg">
      <legend class="card-title na-legend">Location and market</legend>
      <div class="grid-2">
        <div class="fld"><label for="f-country">Country <span class="req" aria-hidden="true">*</span></label><input id="f-country" name="country" class="inp" required autocomplete="country-name" aria-describedby="e-country" value="${v.country || ''}" placeholder="United Kingdom"><span class="err" id="e-country" data-err="country"></span></div>
        <div class="fld"><label for="f-city">City or region</label><input id="f-city" name="city" class="inp" value="${v.city || ''}" placeholder="Leeds"></div>
      </div>
      <div class="fld"><label for="f-target">Target customer</label><input id="f-target" name="target" class="inp" value="${v.target || ''}" placeholder="Independent food retailers within 40 miles of the depot"></div>
    </fieldset>

    <fieldset class="card card-pad stack-lg">
      <legend class="card-title na-legend">Financials and operations</legend>
      <div class="grid-2">
        <div class="fld"><label for="f-price">Expected price range</label><input id="f-price" name="price" class="inp" placeholder="£6 to £11 per drop"></div>
        <div class="fld"><label for="f-delivery">Delivery mode</label><select id="f-delivery" name="delivery" class="inp">${opt(DELIVERY, '', 'Select a mode')}</select></div>
        <div class="fld"><label for="f-budget">Startup budget range</label><select id="f-budget" name="budget" class="inp">${opt(BUDGETS, '', 'Select a range')}</select></div>
      </div>
      <div class="fld"><label for="f-competitors">Known competitors</label><textarea id="f-competitors" name="competitors" class="inp" rows="3" placeholder="Name them if you can. The Predator will find the rest."></textarea></div>
    </fieldset>

    <div class="card card-pad na-files">
      <div class="stack-sm"><b class="strong">Supporting material <span class="lbl">Optional</span></b><span class="hint">Attach decks, metrics or board updates. Findings will cite them.</span><ul class="na-file-list small" data-file-list></ul></div>
      <label class="btn" for="f-files">Choose files</label>
      <input id="f-files" type="file" multiple class="sr-only" data-files accept=".pdf,.xlsx,.xls,.csv,.ppt,.pptx,.doc,.docx,.txt">
    </div>

    <div class="card card-pad na-deep">
      <label class="check"><input type="checkbox" name="depth" value="deep"${deepAllowed ? '' : html` disabled`} aria-describedby="h-deep"><span class="check-copy"><span>Deep audit</span><span class="hint" id="h-deep">${deepAllowed ? 'Extended analysis with more research and longer reasoning. Takes longer than a standard audit.' : html`Extended analysis with more research and longer reasoning. Part of the <a class="link" href="/pricing">Pro Max plan</a>.`}</span></span></label>
    </div>

    <div class="row-actions na-submit">
      <button type="submit" class="btn btn-primary btn-lg"${allowed ? '' : html` disabled`}>Run audit</button>
      <span class="hint">Required fields are marked <span class="req">*</span>.</span>
    </div>
  </form>
</div>`;
  },

  mount(root, ctx, { company }) {
    const form = root.querySelector('[data-form]');
    let files = [];
    let tried = false;
    const values = () => Object.fromEntries(new FormData(form).entries());

    const update = () => {
      const v = values();
      const d = depth(v, files.length);
      root.querySelector('[data-depth-label]').textContent = d.label;
      root.querySelector('[data-depth-copy]').textContent = `${d.filled} of ${OPTIONAL.length} optional fields completed. Attach material below to go deeper still.`;
      const meterEl = root.querySelector('[data-depth-meter]');
      meterEl.setAttribute('aria-label', `Input detail ${d.pct} per cent`);
      [...meterEl.children].forEach((s, i) => s.classList.toggle('on', i < Math.round(d.pct / 5)));
      const desc = String(v.description || '').trim();
      root.querySelector('[data-thin]').hidden = !(desc && desc.length < 120);
      if (tried) showErrors(v);
    };

    const showErrors = (v) => {
      const errs = errorsFor(v);
      Object.entries(errs).forEach(([k, msg]) => {
        const el = root.querySelector(`[data-err="${k}"]`);
        if (el) el.textContent = msg || '';
        const input = form.elements[k];
        if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      });
      const bad = Object.entries(errs).filter(([, m]) => m);
      const summary = root.querySelector('[data-summary]');
      summary.hidden = !bad.length;
      root.querySelector('[data-summary-list]').textContent = bad.map(([k]) => ({ title: 'Business idea title', description: 'Full description', industry: 'Industry', country: 'Country', type: 'Venture type' }[k])).join(', ');
      return bad;
    };

    form.addEventListener('input', update);
    form.addEventListener('change', update);
    root.querySelector('[data-files]').addEventListener('change', (e) => {
      files = [...e.target.files];
      root.querySelector('[data-file-list]').innerHTML = String(html`${files.map((f) => html`<li>${f.name}</li>`)}`);
      update();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      tried = true;
      const v = values();
      const bad = showErrors(v);
      if (bad.length) {
        form.elements[bad[0][0]].focus();
        return;
      }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Starting…';
      try {
        const { auditId } = await runAudit({ ...v, companyId: company ? company.id : null, files });
        ctx.navigate(`/running/${auditId}`);
      } catch (err) {
        showAuditError(err, ctx.navigate);
        btn.disabled = false;
        btn.textContent = 'Run audit';
      }
    });
    return null;
  },
};
