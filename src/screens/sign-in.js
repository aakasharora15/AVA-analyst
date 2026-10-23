import { html } from '../lib/html.js';
import { PASSWORD_RULE, passwordProblem } from '../data/shared.js';
import { MODE, signIn, signUp, getSession, requestPasswordReset, updatePassword, signInWithSso, resendVerification } from '../data/repo.js';
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
    <p class="small muted">Invited by a colleague? Use the link in your invitation email.${demo ? ' Demo: the sample account is filled in.' : ''}</p>
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
