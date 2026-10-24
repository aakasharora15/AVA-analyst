import { html } from '../lib/html.js';
import { PASSWORD_RULE, passwordProblem } from '../data/shared.js';
import { MODE, DEMO_EMAIL, DEMO_PASSWORD, signIn, signInWithProvider, signUp, getSession, requestPasswordReset, updatePassword, signInWithSso, resendVerification } from '../data/repo.js';
import { wordmarkSvg } from '../components/logo.js';

// Auth states (spec 4.12), opened with ?state=<name>. In the demo (mock data)
// every state can be opened directly so the flows can be reviewed; live, the
// same states are reached from Supabase Auth.
const demo = MODE === 'mock';

const STATES = {
  verify: { title: 'Check your email.', body: 'We sent a verification link to your work email. It expires in 1 hour.', action: 'Resend link' },
  forgot: { title: 'Reset your password.', body: 'Enter your work email and we will send a reset link.' },
  'reset-sent': { title: 'Reset link sent.', body: 'If an account exists for that email, a reset link is on its way. It expires in 1 hour.', action: 'Resend link' },
  reset: { title: 'Choose a new password.', body: PASSWORD_RULE },
  'reset-expired': { title: 'This reset link has expired.', body: 'Reset links last 1 hour. Request a new one to continue.', action: 'Send a new link' },
  'sso-not-configured': { title: 'Single sign-on is not set up for this domain.', body: 'Sign in with your email and password, or ask your organisation Owner to configure single sign-on (Enterprise plan).' },
  'sso-error': { title: 'Single sign-on failed.', body: 'Your identity provider returned an error. Contact support with this reference: AVA-SSO-[REFERENCE].' },
  'invite-expired': { title: 'This invite has expired.', body: 'Invites last 7 days. Ask the person who invited you to send a new one.' },
};

function panel(ctx) {
  const state = ctx.query.get('state');
  const mode = ctx.query.get('mode') === 'up' ? 'up' : 'in';
  if (state && STATES[state]) {
    const s = STATES[state];
    return html`<div class="si-panel stack-lg">
      <div class="stack-sm"><h2 class="si-title">${s.title}</h2><p class="muted">${s.body}</p></div>
      ${state === 'forgot' ? html`<form class="stack-md" data-forgot novalidate><div class="fld"><label for="fg-email">Work email</label><input id="fg-email" type="email" class="inp" autocomplete="email"></div><button type="submit" class="btn btn-primary">Send reset link</button></form>` : ''}
      ${state === 'reset' ? html`<form class="stack-md" data-reset novalidate><div class="fld"><label for="rs-pass">New password</label><input id="rs-pass" type="password" class="inp" autocomplete="new-password" minlength="12" aria-describedby="rs-err"><span class="err" id="rs-err" data-rs-err></span></div><button type="submit" class="btn btn-primary">Save password</button></form>` : ''}
      ${s.action ? html`<button type="button" class="btn" data-resend>${s.action}</button>` : ''}
      <span class="err" role="alert" data-state-err></span>
      <a class="link small" href="/sign-in">Back to sign in</a>
    </div>`;
  }
  const isIn = mode === 'in';
  return html`<div class="si-panel stack-lg">
    <div class="seg" role="group" aria-label="Sign in or create account"><a class="seg-btn si-tab" href="/sign-in" aria-current="${isIn ? 'page' : 'false'}">Sign in</a><a class="seg-btn si-tab" href="/sign-in?mode=up" aria-current="${isIn ? 'false' : 'page'}">Create account</a></div>
    <div class="stack-sm"><h2 class="si-title">${isIn ? 'Welcome back.' : 'Create your account.'}</h2><p class="muted">${isIn ? 'Sign in to open your portfolio.' : 'Your organisation gets one shared risk record.'}</p></div>
    <button type="button" class="btn" data-oauth="google"><svg class="si-g" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Continue with Google</button>
    <button type="button" class="btn" data-sso>Continue with single sign-on</button>
    <div class="si-or"><span></span><span class="lbl">or with email</span><span></span></div>
    <form class="stack-md" data-signin novalidate>
      ${isIn ? '' : html`<div class="fld"><label for="s-name">Full name</label><input id="s-name" class="inp" autocomplete="name"></div><div class="fld"><label for="s-org">Organisation</label><input id="s-org" class="inp" autocomplete="organization" placeholder="Fund, team or accelerator"></div>`}
      <div class="fld"><label for="s-email">Work email</label><input id="s-email" type="email" class="inp" autocomplete="email" value="${demo ? 'alex@yourfund.example' : ''}" aria-describedby="s-err"></div>
      <div class="fld"><label for="s-pass">Password</label><input id="s-pass" type="password" class="inp" autocomplete="${isIn ? 'current-password' : 'new-password'}" value="${isIn && demo ? 'prototype-only' : ''}"${isIn ? '' : html` minlength="12" aria-describedby="s-pass-hint"`}>${isIn ? '' : html`<span class="hint" id="s-pass-hint">${PASSWORD_RULE}</span>`}</div>
      <span class="err" id="s-err" role="alert" data-err></span>
      <button type="submit" class="btn btn-primary btn-lg" data-submit>${isIn ? 'Sign in' : 'Create account'}</button>
      ${isIn ? html`<a class="link small" href="/sign-in?state=forgot">Forgot password?</a>` : html`<p class="hint">[TERMS] and [PRIVACY] apply. We will send a link to verify your email.</p>`}
    </form>
    ${isIn ? html`<div class="card card-pad stack-sm si-demo" role="note">
      <b>Exploring AVA?</b>
      <span class="small muted">Sign in to the demo workspace with sample data. Nothing you do there is saved to a real account.</span>
      <span class="small si-demo-cred">Email <code>${DEMO_EMAIL}</code> · Password <code>${DEMO_PASSWORD}</code></span>
      <a class="link small" href="/demo">Open the demo in one click</a>
    </div>` : ''}
    <p class="small muted">Invited by a colleague? Use the link in your invitation email.</p>
  </div>`;
}

export default {
  title: 'Sign in · AVA',
  className: 'sign-in',

  render(ctx) {
    return html`<div class="si">
  <section class="hero-panel si-hero" aria-label="AVA">
    <div class="stars" aria-hidden="true"></div>
    <a href="/" class="mark mark-lg" aria-label="AVA home">${wordmarkSvg('AVA')}</a>
    <div class="stack-md"><h1 class="display-l si-h1">The score is honest, not encouraging</h1><p class="si-sub">Sign in to your portfolio's risk record.</p></div>
    <div class="row-actions si-sample v-pivot"><div><div class="lbl">Sample score</div><div class="hero-num">41</div></div><div><div class="lbl">Directive</div><div class="hero-dir verdict-text">PIVOT</div></div></div>
  </section>
  <section class="si-form">${panel(ctx)}<a class="link small si-back" href="/">Back to site</a></section>
</div>`;
  },

  mount(root, ctx) {
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    const after = async () => {
      const session = await getSession();
      ctx.navigate(session.onboarded ? (ctx.query.get('next') || '/portfolio') : '/onboarding');
    };
    const busy = (f, on) => { const b = f.querySelector('[type="submit"]'); if (b) b.disabled = on; };
    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.matches('[data-signin]')) {
        const email = f.querySelector('#s-email');
        const pass = f.querySelector('#s-pass');
        const err = root.querySelector('[data-err]');
        err.textContent = '';
        if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) {
          err.textContent = 'Enter your work email to continue.';
          email.setAttribute('aria-invalid', 'true');
          email.focus();
          return;
        }
        email.setAttribute('aria-invalid', 'false');
        const up = ctx.query.get('mode') === 'up';
        if (!demo && !pass.value) { err.textContent = 'Enter your password.'; pass.focus(); return; }
        busy(f, true);
        try {
          if (up) {
            await signUp({ name: f.querySelector('#s-name').value.trim(), org: f.querySelector('#s-org').value.trim(), email: email.value.trim(), password: pass.value });
            ctx.navigate(`/sign-in?state=verify&email=${encodeURIComponent(email.value.trim())}`);
            return;
          }
          await signIn(email.value.trim(), pass.value);
          await after();
        } catch (ex) {
          err.textContent = ex.message;
        } finally { busy(f, false); }
      }
      if (f.matches('[data-forgot]')) {
        const email = f.querySelector('#fg-email').value.trim();
        busy(f, true);
        try { await requestPasswordReset(email); } catch { /* same message either way: never reveal whether an account exists */ }
        ctx.navigate(`/sign-in?state=reset-sent&email=${encodeURIComponent(email)}`);
      }
      if (f.matches('[data-reset]')) {
        const p = f.querySelector('#rs-pass');
        const err = root.querySelector('[data-rs-err]');
        if (passwordProblem(p.value)) { err.textContent = passwordProblem(p.value); p.focus(); return; }
        busy(f, true);
        try {
          const r = await updatePassword(p.value);
          if (r && r.state) { ctx.navigate(`/sign-in?state=${r.state}`); return; }
          if (demo) ctx.navigate('/sign-in'); else await after();
        } catch (ex) { err.textContent = ex.message; } finally { busy(f, false); }
      }
    }, opts);
    root.addEventListener('click', async (e) => {
      const oauth = e.target.closest('[data-oauth]');
      if (oauth) {
        const err = root.querySelector('[data-err]');
        try {
          const r = await signInWithProvider(oauth.dataset.oauth, ctx.query.get('next') || '/portfolio');
          if (r && r.signedIn) await after();
        } catch (ex) { if (err) err.textContent = ex.message; }
      }
      if (e.target.closest('[data-sso]')) {
        const email = root.querySelector('#s-email');
        const r = await signInWithSso(email ? email.value.trim() : '');
        if (r.state !== 'redirecting') ctx.navigate(`/sign-in?state=${r.state}`);
      }
      const resend = e.target.closest('[data-resend]');
      if (resend) {
        const state = ctx.query.get('state');
        const email = ctx.query.get('email') || '';
        if (state === 'reset-expired' || (!email && state !== 'verify')) { ctx.navigate('/sign-in?state=forgot'); return; }
        try {
          if (state === 'verify') await resendVerification(email);
          else await requestPasswordReset(email);
          resend.textContent = 'Sent. Check your inbox.';
        } catch (ex) { root.querySelector('[data-state-err]').textContent = ex.message; }
      }
    }, opts);
    return () => ac.abort();
  },
};
