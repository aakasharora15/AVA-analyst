// Bot check on public forms (Cloudflare Turnstile). Off, and nothing loads,
// until VITE_TURNSTILE_SITE_KEY is set.
const KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
export const humanCheckOn = Boolean(KEY);

let loading = null;
function load() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve(window.turnstile);
      s.onerror = () => { loading = null; reject(new Error('The human check could not load. Check your connection and refresh.')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const OFF = { token: () => '', reset() {}, remove() {} };

/** Renders the check into `el`. Returns token(), reset() and remove(). */
export async function mountHumanCheck(el) {
  if (!KEY || !el) return OFF;
  const ts = await load();
  const id = ts.render(el, { sitekey: KEY, theme: 'dark', size: 'flexible' });
  return { token: () => ts.getResponse(id) || '', reset: () => ts.reset(id), remove: () => ts.remove(id) };
}
