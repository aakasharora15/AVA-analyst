import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens/landing.css';
import './styles/screens/pricing.css';
import './styles/screens/team.css';

import { html } from './lib/html.js';
import { createRouter } from './router.js';
import { routes } from './routes.js';
import { notFound } from './screens/planned.js';
import { siteHeader, mountSiteHeader } from './components/site-header.js';
import { siteFooter } from './components/site-footer.js';

const app = document.getElementById('app');

function frame(route, screen, ctx) {
  const body = screen.render(ctx);
  const large = Boolean(route && route.large);
  return html`${siteHeader({ path: ctx.path, large })}
<main id="main" tabindex="-1" class="wrap ${screen.className || ''}">${body}</main>
${siteFooter({ large })}`;
}

// Render a screen into #app. Returns its cleanup so the next render can run it.
function render(route, ctx, previous) {
  if (previous) previous();
  const screen = route ? route.screen : notFound;
  app.innerHTML = String(frame(route, screen, ctx));
  document.title = screen.title || 'AVA';

  const cleanups = [mountSiteHeader(app)];
  if (screen.mount) cleanups.push(screen.mount(app.querySelector('main'), ctx));

  // Move focus to the new content for keyboard and screen reader users,
  // except on first load where the browser keeps its default.
  if (previous !== undefined && previous !== null) {
    app.querySelector('main').focus({ preventScroll: true });
  }
  return () => cleanups.forEach((fn) => typeof fn === 'function' && fn());
}

const notFoundRoute = { screen: notFound };
createRouter({
  routes,
  notFound: notFoundRoute,
  render: (route, ctx, previous) => render(route, ctx, previous),
}).start();
