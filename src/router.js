// Client-side router: History API, :param segments, deep links on refresh
// (the dev/preview server falls back to index.html), hash scrolling and
// focus management on navigation.

export function compile(path) {
  const keys = [];
  const pattern = path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { keys, regex: new RegExp(`^${pattern || '/'}/?$`) };
}

export function matchRoute(routes, pathname) {
  for (const route of routes) {
    if (!route.compiled) route.compiled = compile(route.path);
    const m = route.compiled.regex.exec(pathname);
    if (m) {
      const params = {};
      route.compiled.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(m[i + 1]);
      });
      return { route, params };
    }
  }
  return null;
}

// Should a click on this anchor be handled by the router?
export function isInternalLink(anchor, event, origin) {
  if (!anchor || !anchor.href) return false;
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download') || anchor.dataset.external !== undefined) return false;
  const url = new URL(anchor.href, origin);
  return url.origin === origin;
}

export function createRouter({ routes, notFound, render }) {
  let current = null;

  function scrollToHash(hash) {
    if (!hash) return false;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return false;
    el.scrollIntoView({ block: 'start' });
    return true;
  }

  async function resolve({ hash, fromNavigation }) {
    const { pathname, search } = window.location;
    const matched = matchRoute(routes, pathname);
    const ctx = {
      path: pathname,
      params: matched ? matched.params : {},
      query: new URLSearchParams(search),
      navigate,
    };
    current = await render(matched ? matched.route : notFound, ctx, current);
    if (!scrollToHash(hash) && fromNavigation) window.scrollTo(0, 0);
  }

  function navigate(to, { replace = false } = {}) {
    const url = new URL(to, window.location.origin);
    const samePath = url.pathname === window.location.pathname && url.search === window.location.search;
    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    if (samePath && url.hash) {
      scrollToHash(url.hash);
      return;
    }
    resolve({ hash: url.hash, fromNavigation: true });
  }

  function onClick(event) {
    const anchor = event.target.closest('a');
    if (!isInternalLink(anchor, event, window.location.origin)) return;
    event.preventDefault();
    navigate(anchor.getAttribute('href'));
  }

  function start() {
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', () => resolve({ hash: window.location.hash, fromNavigation: false }));
    resolve({ hash: window.location.hash, fromNavigation: false });
  }

  return { start, navigate };
}
