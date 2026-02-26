const params = new URLSearchParams(window.location.search);
const domain = params.get('domain');
const domainDisplay = document.getElementById('domain-display');

if (domain) {
  domainDisplay.textContent = `${domain} is blocked by Focus Guard`;
  document.title = `${domain} — Blocked`;
} else {
  domainDisplay.textContent = 'This site is blocked by Focus Guard';
}
