import { html } from '../lib/html.js';
import { checkWorkEmail, runFreeAudit, sendFreeAudit } from '../data/repo.js';
import { humanCheckOn, mountHumanCheck } from '../lib/turnstile.js';
import { inputProblem } from '../data/shared.js';
import { BUSINESS, contactHref } from '../content/business.js';
import { AGENTS } from '../engine/config.js';
import { meter, sevTag, vClass, icon } from '../components/ui.js';
import { toast } from '../components/sheet.js';
import { INDUSTRIES } from './new-analysis.js';

// r.top: the three findings shown in full. r.locked: counts of the rest by
// severity; their text never reaches the browser.
function resultView(r) {
  const { top, locked } = r;
  const counts = ['HIGH', 'MEDIUM', 'LOW'].map((s) => [s, locked[s]]).filter(([, n]) => n);
  return html`
<div class="hero-panel fa-score ${vClass(r.directive)}">
  <div class="stars" aria-hidden="true"></div>
  <span class="lbl">Free audit result · ${r.inputs.title}</span>
  <div class="co-nums"><div><div class="lbl">Resilience Score</div><div class="hero-num">${r.score}<span class="r-of"> / 100</span></div></div><div><div class="lbl">Directive</div><div class="hero-dir verdict-text">${r.directive}</div></div></div>
  ${meter(r.score, r.directive)}
  <span class="small">${r.status === 'partial' ? 'Five of six agents reported. One section did not run, so the directive is capped at HOLD.' : 'All six agents ran.'}${r.prototype ? ' Demo result: the live product runs the full agent chain on your inputs.' : ''}</span>
</div>
<div class="card card-pad stack-sm">
  <span class="lbl">Top three findings</span>
  ${top.map((f) => html`<div class="run-finding">${sevTag(f.severity)}<div class="stack-sm"><b>${f.title}</b><span class="small muted">${f.text}</span><span class="row-actions"><span class="lbl">${AGENTS[f.agent - 1].name} · ${f.category}</span><span class="no-source">Agent reasoning, no source</span></span></div></div>`)}
</div>
<div class="card card-pad stack-md fa-locked">
  <div class="row-actions">${icon('lock')}<b>${locked.total} more findings are locked.</b></div>
  <div class="chips">${counts.map(([s, n]) => html`<span class="tag sev-${s.toLowerCase()}">${n} ${s}</span>`)}</div>
  <ul class="fa-ghosts" aria-hidden="true">${Array.from({ length: Math.min(3, locked.total) }, () => html`<li><span></span><span></span></li>`)}</ul>
  <p class="small muted">The full product shows every finding with citations, the score trace, history and a PDF report.</p>
  <div class="row-actions">${BUSINESS.salesEmail ? html`<a class="btn btn-primary" href="${contactHref(BUSINESS.salesEmail, '', 'AVA walkthrough')}" data-external>Book a walkthrough</a>` : html`<a class="btn btn-primary" href="/sign-in?demo=1">Explore the live demo</a>`}<a class="btn" href="/pricing">See pricing</a></div>
</div>
<form class="card card-pad stack-sm" data-send novalidate>
  <b>Founder? Send this result to an investor.</b>
  <div class="fa-send"><div class="fld"><label for="fa-inv">Investor email</label><input id="fa-inv" type="email" class="inp" autocomplete="off"></div><button type="submit" class="btn">Send result</button></div>
</form>`;
}

export default {
  title: 'Free audit · AVA',
  className: 'free-audit',

  render() {
    return html`
<div class="fa">
  <section class="fa-intro">
    <span class="lbl lbl-accent">Free audit</span>
    <h1 class="display-l">Four fields. One honest score.</h1>
    <p class="muted fa-sub">For investors checking a deal in their pipeline. All six agents run. You get a score, a directive and your top three findings in full.</p>
    <ul class="fa-points small"><li>One free audit per company email domain each month.</li><li>Work email required. Your result is kept if your organisation signs up.</li></ul>
  </section>
  <div class="fa-grid">
    <form class="card card-pad stack-md fa-form" data-fa novalidate>
      <span class="lbl">The venture</span>
      <div class="fld"><label for="fa-title">Title</label><input id="fa-title" name="title" class="inp" aria-describedby="fa-e-title"><span class="err" id="fa-e-title" data-e="title"></span></div>
      <div class="fld"><label for="fa-desc">Description</label><textarea id="fa-desc" name="description" class="inp" rows="5" aria-describedby="fa-e-description fa-count"></textarea><span class="err" id="fa-e-description" data-e="description"></span><span class="hint" id="fa-count" data-count>0 characters. Specific details give better findings.</span></div>
      <div class="grid-2">
        <div class="fld"><label for="fa-ind">Industry</label><select id="fa-ind" name="industry" class="inp" aria-describedby="fa-e-industry"><option value="">Choose one</option>${INDUSTRIES.map((i) => html`<option>${i}</option>`)}</select><span class="err" id="fa-e-industry" data-e="industry"></span></div>
        <div class="fld"><label for="fa-cty">Country</label><input id="fa-cty" name="country" class="inp" autocomplete="country-name" aria-describedby="fa-e-country"><span class="err" id="fa-e-country" data-e="country"></span></div>
      </div>
      <div class="fld"><label for="fa-mail">Work email</label><input id="fa-mail" name="email" type="email" class="inp" autocomplete="email" aria-describedby="fa-e-email fa-mail-h"><span class="err" id="fa-e-email" data-e="email"></span><span class="hint" id="fa-mail-h">We send your result here. Free email addresses are not accepted.</span></div>
      ${humanCheckOn ? html`<div class="fld"><div class="fa-human" data-human></div><span class="err" data-e-human role="alert"></span></div>` : ''}
      <button type="submit" class="btn btn-primary btn-lg">Run free audit</button>
      <p class="hint">Your submission is used only to produce this audit and is never used to train AI models. <a class="link" href="/privacy">Privacy policy</a></p>
    </form>
    <section class="fa-result" aria-live="polite" data-result>
      <div class="hero-panel fa-wait"><div class="stars" aria-hidden="true"></div><span class="lbl">Resilience Score</span><div class="hero-num run-pending">--</div><p class="small">Fill in the four fields and your work email, then run the audit. Your result appears here.</p></div>
    </section>
  </div>
</div>`;
  },

  mount(root) {
    const ac = new AbortController();
    const form = root.querySelector('[data-fa]');
    const out = root.querySelector('[data-result]');
    let tried = false;
    let result = null;
    const human = mountHumanCheck(root.querySelector('[data-human]')).catch((err) => {
      const e = root.querySelector('[data-e-human]');
      if (e) e.textContent = err.message;
      return null;
    });
    const errs = (v) => {
      const mail = checkWorkEmail(v.email || '');
      return {
        title: !String(v.title || '').trim() && 'Enter a title.',
        description: !!String(v.title || '').trim() && inputProblem(v),
        industry: !v.industry && 'Choose an industry.',
        country: !String(v.country || '').trim() && 'Enter a country.',
        email: !mail.ok && mail.reason,
      };
    };
    const show = () => {
      const v = Object.fromEntries(new FormData(form));
      const e = errs(v);
      Object.entries(e).forEach(([k, m]) => {
        root.querySelector(`[data-e="${k}"]`).textContent = tried && m ? m : '';
        form.elements[k].setAttribute('aria-invalid', tried && m ? 'true' : 'false');
      });
      root.querySelector('[data-count]').textContent = `${String(v.description || '').length} characters. Specific details give better findings.`;
      return { v, bad: Object.entries(e).filter(([, m]) => m) };
    };
    form.addEventListener('input', show, { signal: ac.signal });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      tried = true;
      const { v, bad } = show();
      if (bad.length) { form.elements[bad[0][0]].focus(); return; }
      const check = await human;
      if (humanCheckOn) {
        v.turnstileToken = check ? check.token() : '';
        root.querySelector('[data-e-human]').textContent = v.turnstileToken ? '' : 'Complete the check that you are human.';
        if (!v.turnstileToken) return;
      }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      const paint = (i) => {
        out.innerHTML = String(html`<div class="hero-panel fa-wait"><div class="stars" aria-hidden="true"></div><span class="lbl">Running · ${i + 1} of 6</span><div class="hero-dir">${AGENTS[i].name}</div><div class="run-prog"><span style="width:${Math.round(((i + 1) / 6) * 100)}%"></span></div><p class="small">${AGENTS[i].mandate}</p></div>`);
      };
      paint(0);
      try {
        const r = await runFreeAudit(v, { onProgress: paint });
        result = r;
        out.innerHTML = String(resultView(r));
        out.querySelector('.hero-panel').scrollIntoView({ block: 'nearest' });
      } catch (err) {
        out.innerHTML = String(html`<div class="banner banner-bad" role="alert"><b>${err.message}</b></div>`);
      }
      btn.disabled = false;
      if (check) check.reset();
    }, { signal: ac.signal });
    out.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = out.querySelector('#fa-inv');
      if (!/^\S+@\S+\.\S+$/.test(input.value.trim())) { input.setAttribute('aria-invalid', 'true'); input.focus(); toast('Enter the investor\'s email.'); return; }
      try {
        await sendFreeAudit(result.id, input.value.trim());
        toast(`Result sent to ${input.value.trim()}.`);
        input.value = '';
      } catch (err) { toast(err.message); }
    }, { signal: ac.signal });
    return () => { ac.abort(); human.then((h) => h && h.remove()); };
  },
};
