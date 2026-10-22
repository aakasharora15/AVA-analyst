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
import { getSession } from './data/repo.js';

const app = document.getElementById('app');

function frame(route, ctx) {
  const layout = route.layout || 'public';
  const large = Boolean(route.large);
  const cls = route.screen.className || '';
  if (layout === 'bare') {
    return html`<main id="main" tabindex="-1" class="${cls}"><div class="screen-loading" aria-hidden="true"></div></main>`;
  }
  if (layout === 'app') {
    return html`${appHeader({ path: ctx.path })}
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

  if (route.layout === 'app' || route.auth) {
    const session = await getSession();
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

  app.innerHTML = String(frame(route, ctx));
  const main = app.querySelector('main');
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

createRouter({ routes, notFound: { screen: notFound, layout: 'public' }, render }).start();
