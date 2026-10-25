import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/app.css';
import './styles/screens/landing.css';
import './styles/screens/pricing.css';
import './styles/screens/team.css';
import './styles/screens/report.css';
import './styles/screens/screens.css';

import { html } from './lib/html.js';
import { createRouter } from './router.js';
import { routes } from './routes.js';
import { notFound } from './screens/not-found.js';
import { siteHeader, mountSiteHeader } from './components/site-header.js';
import { siteFooter } from './components/site-footer.js';
import { appHeader, mountAppHeader } from './components/app-header.js';
import { getSession, signOut, DEMO } from './data/repo.js';
import { startMonitoring } from './lib/monitoring.js';

const app = document.getElementById('app');

// Plan state the whole workspace should see: trial days left, trial or
// subscription ended, payment failing. Nothing for a healthy paid plan.
function planBar(session) {
  const o = session && session.org;
  if (!o || DEMO) return '';
  const owner = session.user && session.user.role === 'Owner';
  const act = owner ? html`<a class="btn btn-primary" href="/account?tab=billing">Choose a plan</a>` : '';
  const ask = owner ? '' : ' Ask your Owner to choose a plan.';
  if (o.subscriptionStatus === 'past_due' || o.subscriptionStatus === 'unpaid') {
    return html`<div class="plan-bar plan-bar-warn" role="alert"><span><b>Payment failed.</b> Update your card to keep your plan.${owner ? '' : ' Ask your Owner to update the card.'}</span>${owner ? html`<span class="demo-bar-actions"><a class="btn btn-primary" href="/account?tab=billing">Update card</a></span>` : ''}</div>`;
  }
  if (o.plan !== 'trial' || !o.trialEndsAt) return '';
  const days = Math.ceil((new Date(o.trialEndsAt) - Date.now()) / 86400000);
  if (days <= 0) {
    const what = o.subscriptionStatus === 'canceled' ? 'Your subscription has ended.' : 'Your free trial has ended.';
    return html`<div class="plan-bar plan-bar-warn" role="status"><span><b>${what}</b> Reports stay readable. New audits need a plan.${ask}</span>${act ? html`<span class="demo-bar-actions">${act}</span>` : ''}</div>`;
  }
  return html`<div class="plan-bar" role="status"><span><b>Free trial</b> · ${days} ${days === 1 ? 'day' : 'days'} left.${owner ? ' Choose a plan any time; everything carries over.' : ''}</span>${act ? html`<span class="demo-bar-actions">${act}</span>` : ''}</div>`;
}

function frame(route, ctx, session) {
  const layout = route.layout || 'public';
  const large = Boolean(route.large);
  const cls = route.screen.className || '';
  if (layout === 'bare') {
    return html`<main id="main" tabindex="-1" class="${cls}"><div class="screen-loading" aria-hidden="true"></div></main>`;
  }
  if (layout === 'app') {
    return html`${appHeader({ path: ctx.path })}
${planBar(session) ? html`<div class="wrap wrap-app">${planBar(session)}</div>` : ''}
${DEMO ? html`<div class="wrap wrap-app"><div class="demo-bar" role="note"><span><b>Demo workspace.</b> Sample data. Changes stay in this browser.</span><span class="demo-bar-actions"><a class="btn btn-primary" href="/free-audit">Start free audit</a><button type="button" class="btn" data-demo-exit>Exit demo</button></span></div></div>` : ''}
<main id="main" tabindex="-1" class="wrap wrap-app app-main ${cls}"><div class="screen-loading" aria-hidden="true"></div></main>`;
  }
  return html`${siteHeader({ path: ctx.path, large })}
<main id="main" tabindex="-1" class="wrap ${cls}"><div class="screen-loading" aria-hidden="true"></div></main>
${siteFooter({ large })}`;
}

function errorView(err) {
  return html`<section class="planned" role="alert"><span class="lbl">Something went wrong</span><h1 class="display-m">This screen could not load</h1><p>${err.message || 'Unknown error'}</p><a class="btn btn-primary" href="/portfolio">Back to portfolio</a></section>`;
}

// Render a route into #app. Returns its cleanup so the next render can run it.
async function render(route, ctx, previous) {
  if (previous) previous();
  const screen = route.screen;

  let session = null;
  if (route.layout === 'app' || route.auth) {
    session = await getSession();
    if (session.mfaRequired) {
      ctx.navigate(`/sign-in?state=mfa&next=${encodeURIComponent(ctx.path + window.location.search)}`, { replace: true });
      return () => {};
    }
    if (!session.signedIn) {
      ctx.navigate(`/sign-in?next=${encodeURIComponent(ctx.path + window.location.search)}`, { replace: true });
      return () => {};
    }
    // Signed in but not yet in an organisation: set one up first.
    if (!session.onboarded && route.layout === 'app') {
      ctx.navigate('/onboarding', { replace: true });
      return () => {};
    }
  }

  app.innerHTML = String(frame(route, ctx, session));
  const main = app.querySelector('main');
  const exitDemo = app.querySelector('[data-demo-exit]');
  if (exitDemo) exitDemo.addEventListener('click', async () => { ctx.navigate(await signOut()); });
  const headerCleanup = route.layout === 'app' ? mountAppHeader(app) : route.layout === 'bare' ? () => {} : mountSiteHeader(app);

  let screenCleanup = null;
  let token = 0;
  const draw = async ({ keepFocus = false } = {}) => {
    const mine = ++token;
    let data;
    try {
      data = screen.load ? await screen.load(ctx) : undefined;
    } catch (err) {
      main.innerHTML = String(errorView(err));
      return;
    }
    if (mine !== token) return;
    const active = document.activeElement;
    const focusKey = keepFocus && active && main.contains(active) ? (active.id || active.dataset.key) : null;
    const y = window.scrollY;
    if (screenCleanup) screenCleanup();
    main.innerHTML = String(screen.render(ctx, data));
    document.title = typeof screen.title === 'function' ? screen.title(data, ctx) : (screen.title || 'AVA');
    screenCleanup = screen.mount ? screen.mount(main, ctx, data) : null;
    if (keepFocus) {
      window.scrollTo(0, y);
      if (focusKey) {
        const el = main.querySelector(`#${CSS.escape(focusKey)}`) || main.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
        if (el) el.focus({ preventScroll: true });
      }
    }
    window.dispatchEvent(new CustomEvent('ava:data'));
  };
  ctx.refresh = () => draw({ keepFocus: true });
  await draw();

  // Move focus to new content after in-app navigation (not on first load).
  if (previous) main.focus({ preventScroll: true });

  return () => {
    token += 1;
    if (screenCleanup) screenCleanup();
    headerCleanup();
  };
}

startMonitoring();
createRouter({ routes, notFound: { screen: notFound, layout: 'public' }, render }).start();
