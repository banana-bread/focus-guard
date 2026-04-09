/**
 * Blocked page script.
 *
 * Reads the `?domain=` query parameter and displays it on the page.
 */

const params = new URLSearchParams(window.location.search);
const domain = params.get('domain') ?? 'Unknown site';

const domainEl = document.getElementById('domain');
if (domainEl) {
  domainEl.textContent = domain;
}
