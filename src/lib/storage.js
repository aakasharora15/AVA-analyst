// localStorage for light conveniences only. Every access is guarded: private
// windows, blocked storage and previews can throw or return nothing.

const PREFIX = 'ava:';

export function load(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(PREFIX + key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable */
  }
}
