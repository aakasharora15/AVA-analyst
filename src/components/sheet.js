// Glass sheet on the native <dialog>: focus trap, Esc to close and inert
// background come from the browser. Bottom sheet on phones.

import { html } from '../lib/html.js';
import { icon } from './ui.js';

/**
 * openSheet({ title, body, wide, onMount }) -> { close, el }
 * `body` is an html`` result. `onMount(el, close)` wires behaviour and may
 * return a cleanup.
 */
export function openSheet({ title, body, wide = false, onMount, onClose }) {
  const dialog = document.createElement('dialog');
  dialog.className = `sheet glass${wide ? ' sheet-wide' : ''}`;
  dialog.setAttribute('aria-labelledby', 'sheet-title');
  dialog.innerHTML = String(html`<div class="sheet-head"><h2 id="sheet-title" class="sheet-title">${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div><div class="sheet-body">${body}</div>`);
  document.body.appendChild(dialog);
  let cleanup = null;
  const close = (result) => {
    if (cleanup) cleanup();
    dialog.close();
    dialog.remove();
    if (onClose) onClose(result);
  };
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) close();
  });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.showModal();
  if (onMount) cleanup = onMount(dialog, close) || null;
  return { close, el: dialog };
}

/** Polite status message for screen readers and sighted users. */
export function toast(message) {
  let region = document.getElementById('toast');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast';
    region.className = 'toast glass';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  region.textContent = message;
  region.classList.add('show');
  clearTimeout(region._t);
  region._t = setTimeout(() => region.classList.remove('show'), 3200);
}
