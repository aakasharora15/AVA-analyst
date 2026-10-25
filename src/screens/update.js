import { html } from '../lib/html.js';
import { wordmarkSvg } from '../components/logo.js';
import { getMetricRequest, submitMetricRequest } from '../data/repo.js';
import { metricsFields, readMetrics } from '../components/metrics-form.js';

// The founder's monthly update: a private link, no account. Two minutes.

function done(title, body) {
  return html`<div class="card card-pad stack-md upd-done" role="status"><h2 class="card-title">${title}</h2><p class="muted">${body}</p></div>`;
}

export default {
  title: 'Monthly update · AVA',
  className: 'update-screen',

  async load(ctx) {
    try { return { r: await getMetricRequest(ctx.params.token) }; } catch (err) { return { error: err.message }; }
  },

  render(ctx, d) {
    const r = d.r;
    let body;
    if (d.error) body = done('This link does not work', d.error);
    else if (r.state === 'expired') body = done('This link has expired', `Ask ${r.organisation} to send a new one.`);
    else if (r.state === 'confirmed') body = done('Already received', `${r.organisation} has confirmed ${r.company}'s numbers for ${r.periodLabel}. Thank you.`);
    else {
      body = html`<form class="card card-pad stack-lg" data-upd novalidate>
  ${r.state === 'submitted' ? html`<div class="banner banner-info" role="note"><span>You have already sent these numbers. You can correct them until ${r.organisation} confirms them.</span></div>` : ''}
  ${metricsFields({ previous: r.previous, current: r.current, currency: r.currency, idPrefix: 'u' })}
  <span class="err" role="alert" data-upd-err></span>
  <div class="row-actions"><button type="submit" class="btn btn-primary btn-lg">Send to ${r.organisation}</button></div>
  <p class="hint">Only ${r.organisation} and AVA's review team see these numbers. They are used to monitor ${r.company}, never shared further or used to train AI models. <a class="link" href="/privacy">Privacy policy</a></p>
</form>`;
    }
    return html`<div class="upd wrap">
  <a href="/" class="mark upd-mark" aria-label="AVA home">${wordmarkSvg('AVA')}</a>
  <header class="stack-sm upd-head">
    <span class="lbl">Monthly update${r ? ` · ${r.periodLabel}` : ''}</span>
    <h1 class="display-m">${r ? `${r.company}: how did ${r.periodLabel.split(' ')[0]} go?` : 'Monthly update'}</h1>
    ${r && !d.error ? html`<p class="muted">${r.organisation} asked for a few numbers. Fill in what you have; at least one number is needed. About two minutes.</p>` : ''}
  </header>
  <div data-upd-body>${body}</div>
</div>`;
  },

  mount(root, ctx, d) {
    const form = root.querySelector('[data-upd]');
    if (!form) return null;
    const ac = new AbortController();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = root.querySelector('[data-upd-err]');
      const out = readMetrics(form);
      if (out.error) { err.textContent = out.error; form.elements[out.field].focus(); return; }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        await submitMetricRequest(ctx.params.token, out.values);
        root.querySelector('[data-upd-body]').innerHTML = String(done('Thank you. Your numbers are in.', `${d.r.organisation} will review them. If something needs correcting, open this link again before they confirm.`));
        window.scrollTo(0, 0);
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    }, { signal: ac.signal });
    return () => ac.abort();
  },
};
