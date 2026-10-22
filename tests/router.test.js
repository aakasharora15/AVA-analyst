import { describe, it, expect } from 'vitest';
import { compile, matchRoute, isInternalLink } from '../src/router.js';
import { html, raw, esc } from '../src/lib/html.js';

const routes = [
  { path: '/' },
  { path: '/pricing' },
  { path: '/company/:id' },
  { path: '/report/:auditId' },
];

describe('router', () => {
  it('matches the root and static paths, with or without a trailing slash', () => {
    expect(matchRoute(routes, '/').route.path).toBe('/');
    expect(matchRoute(routes, '/pricing').route.path).toBe('/pricing');
    expect(matchRoute(routes, '/pricing/').route.path).toBe('/pricing');
  });

  it('extracts and decodes params', () => {
    const m = matchRoute(routes, '/report/northline%204');
    expect(m.route.path).toBe('/report/:auditId');
    expect(m.params).toEqual({ auditId: 'northline 4' });
  });

  it('returns null for unknown paths and partial matches', () => {
    expect(matchRoute(routes, '/nope')).toBeNull();
    expect(matchRoute(routes, '/company')).toBeNull();
    expect(matchRoute(routes, '/company/a/b')).toBeNull();
    expect(matchRoute(routes, '/pricingx')).toBeNull();
  });

  it('compiles param keys in order', () => {
    expect(compile('/a/:x/b/:y').keys).toEqual(['x', 'y']);
  });

  it('only intercepts plain same-origin clicks', () => {
    const origin = window.location.origin;
    const a = (href, attrs = {}) => {
      const el = document.createElement('a');
      el.href = href;
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      return el;
    };
    const click = { defaultPrevented: false, button: 0 };
    expect(isInternalLink(a('/pricing'), click, origin)).toBe(true);
    expect(isInternalLink(a('https://example.com/'), click, origin)).toBe(false);
    expect(isInternalLink(a('/pricing', { target: '_blank' }), click, origin)).toBe(false);
    expect(isInternalLink(a('/file.pdf', { download: '' }), click, origin)).toBe(false);
    expect(isInternalLink(a('/pricing'), { ...click, metaKey: true }, origin)).toBe(false);
  });
});

describe('html', () => {
  it('escapes interpolated text but not nested templates or raw()', () => {
    const name = '<b>"x"</b>';
    expect(String(html`<p>${name}</p>`)).toBe('<p>&lt;b&gt;&quot;x&quot;&lt;/b&gt;</p>');
    expect(String(html`<p>${html`<i>${'a&b'}</i>`}</p>`)).toBe('<p><i>a&amp;b</i></p>');
    expect(String(html`${raw('<br>')}`)).toBe('<br>');
    expect(String(html`${[1, 2]}${null}${false}`)).toBe('12');
    expect(esc("'")).toBe('&#39;');
  });
});
