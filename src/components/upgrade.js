import { html } from '../lib/html.js';
import { openSheet, toast } from './sheet.js';

/**
 * Show why an audit could not start. A plan limit ("upgrade") gets a proper
 * next step instead of a passing toast; anything else is a toast.
 */
export function showAuditError(err, navigate) {
  if (err && err.code === 'upgrade') {
    openSheet({
      title: 'Choose a plan to keep going',
      body: html`<p>${err.message}</p><p class="small muted">Your companies, reports and history are kept whatever you choose.</p><div class="row-actions"><button type="button" class="btn btn-primary" data-go="/account?tab=billing">Choose a plan</button><button type="button" class="btn" data-go="/pricing">Compare plans</button></div>`,
      onMount(el, close) {
        el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { close(); navigate(b.dataset.go); }));
      },
    });
    return;
  }
  toast(err.message);
}
