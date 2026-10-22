import { html } from '../lib/html.js';
import { completeOnboarding } from '../data/repo.js';
import { logo } from '../components/logo.js';

const STEPS = [
  { key: 'kind', title: 'Who is AVA working for?', sub: 'This sets the language, default categories and report layout.', opts: [
    ['VC fund', 'Venture fund', 'Screening and monitoring portfolio companies.'],
    ['Corporate venture or development', 'Corporate team', 'Testing strategies, campaigns and new ventures.'],
    ['Accelerator', 'Accelerator', 'Comparing a cohort of early-stage startups.'] ] },
  { key: 'email', title: 'How often do you want to hear from us?', sub: 'AVA only alerts on material movements. This sets the rhythm.', opts: [
    ['weekly', 'Weekly digest', 'One email with every material change. Directive changes and new HIGH findings still arrive immediately.'],
    ['daily', 'Daily digest', 'One email each day there is a material change.'],
    ['off', 'In app only', 'No digest email. Check alerts when you log in.'] ] },
  { key: 'display', title: 'How should findings be shown?', sub: 'Choose the default for reports and exports.', opts: [
    ['cited', 'With citations', 'Every claim links to its source in the data room.'],
    ['brief', 'Brief', 'Score, directive and top findings only.'],
    ['full', 'Full detail', 'Every section, including skipped ones and why.'] ] },
];

export default {
  title: 'Set up AVA · AVA',
  className: 'onboarding',

  render(ctx) {
    const step = Math.min(2, Math.max(0, Number(ctx.query.get('step') || 0)));
    const answers = JSON.parse(sessionStorageGet() || '{"kind":"VC fund","email":"weekly","display":"cited","orgName":""}');
    const cur = STEPS[step];
    return html`<div class="ob">
  <div class="ob-top">${logo({ href: '/' })}<span class="lbl">Step ${step + 1} of 3</span></div>
  <div class="ob-grid">
    <section class="stack-lg ob-intro">
      <h1 class="display-l">Set AVA up for how you decide</h1>
      <p class="muted">Three short steps. You can change every answer later in Account.</p>
      <div class="ob-bars" role="img" aria-label="Step ${step + 1} of 3">${STEPS.map((_, i) => html`<span class="${i <= step ? 'on' : ''}"></span>`)}</div>
    </section>
    <form class="card card-pad stack-lg ob-card" data-ob novalidate>
      <fieldset class="stack-md">
        <legend class="stack-sm"><span class="card-title">${cur.title}</span><span class="muted small ob-sub">${cur.sub}</span></legend>
        ${cur.opts.map(([v, l, n]) => html`<label class="ob-opt"><input type="radio" name="choice" value="${v}"${answers[cur.key] === v ? html` checked` : ''}><span class="ob-opt-body"><b>${l}</b><span class="small muted">${n}</span></span><span class="ob-radio" aria-hidden="true"></span></label>`)}
      </fieldset>
      ${step === 0 ? html`<div class="fld"><label for="ob-org">Organisation name</label><input id="ob-org" class="inp" name="orgName" value="${answers.orgName}" autocomplete="organization" aria-describedby="ob-err"><span class="err" id="ob-err" data-ob-err></span></div>` : ''}
      <div class="row-actions">
        ${step > 0 ? html`<a class="btn" href="/onboarding?step=${step - 1}">Back</a>` : ''}
        <button type="submit" class="btn btn-primary">${step === 2 ? 'Open my portfolio' : 'Continue'}</button>
      </div>
    </form>
  </div>
</div>`;
  },

  mount(root, ctx) {
    const ac = new AbortController();
    const step = Math.min(2, Math.max(0, Number(ctx.query.get('step') || 0)));
    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const answers = JSON.parse(sessionStorageGet() || '{"kind":"VC fund","email":"weekly","display":"cited","orgName":""}');
      answers[STEPS[step].key] = fd.get('choice');
      if (step === 0) {
        answers.orgName = String(fd.get('orgName') || '').trim();
        if (!answers.orgName) {
          root.querySelector('[data-ob-err]').textContent = 'Enter your organisation name to continue.';
          e.target.elements.orgName.setAttribute('aria-invalid', 'true');
          e.target.elements.orgName.focus();
          return;
        }
      }
      sessionStorageSet(JSON.stringify(answers));
      if (step < 2) { ctx.navigate(`/onboarding?step=${step + 1}`); return; }
      await completeOnboarding(answers);
      ctx.navigate('/portfolio');
    }, { signal: ac.signal });
    return () => ac.abort();
  },
};

function sessionStorageGet() { try { return window.sessionStorage.getItem('ava:onboarding'); } catch { return null; } }
function sessionStorageSet(v) { try { window.sessionStorage.setItem('ava:onboarding', v); } catch { /* storage unavailable */ } }
