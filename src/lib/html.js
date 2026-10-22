// Tiny tagged-template renderer. Interpolated values are escaped unless they
// come from another `html` call or `raw()`, so mock or user text can never
// inject markup.

class SafeHTML {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function raw(value) {
  return new SafeHTML(String(value));
}

function serialise(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(serialise).join('');
  if (value instanceof SafeHTML) return value.value;
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += serialise(values[i]) + strings[i + 1];
  }
  return new SafeHTML(out);
}

// Optional class list helper: cls('a', cond && 'b') -> 'a b'
export function cls(...names) {
  return names.filter(Boolean).join(' ');
}
