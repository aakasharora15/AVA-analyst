// Browser error reporting (Sentry). Loaded only when VITE_SENTRY_DSN is set,
// so visitors download nothing extra otherwise. No personal data, no form or
// page content: just the error, the route and the browser.
const DSN = import.meta.env.VITE_SENTRY_DSN || '';

export async function startMonitoring() {
  if (!DSN) return;
  try {
    const Sentry = await import('@sentry/browser');
    Sentry.init({
      dsn: DSN,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      // Strip query strings: they can carry share tokens, emails or auth errors.
      beforeSend(event) {
        if (event.request && event.request.url) event.request.url = event.request.url.split(/[?#]/)[0];
        if (event.user) delete event.user;
        return event;
      },
      beforeBreadcrumb(crumb) {
        if (crumb.category === 'ui.input') return null;
        if (crumb.data && crumb.data.url) crumb.data.url = String(crumb.data.url).split(/[?#]/)[0];
        if (crumb.data && crumb.data.to) crumb.data.to = String(crumb.data.to).split(/[?#]/)[0];
        if (crumb.data && crumb.data.from) crumb.data.from = String(crumb.data.from).split(/[?#]/)[0];
        return crumb;
      },
    });
  } catch { /* monitoring must never break the app */ }
}
