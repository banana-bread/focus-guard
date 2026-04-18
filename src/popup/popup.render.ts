/**
 * Focus Guard popup — pure helpers, render functions, and timer logic.
 *
 * No chrome.runtime.sendMessage calls here — all messaging stays in popup.ts.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function show(el: HTMLElement | null): void {
  el?.classList.remove('hidden');
}

export function hide(el: HTMLElement | null): void {
  el?.classList.add('hidden');
}

export function showError(el: HTMLElement | null, msg: string): void {
  if (!el) return;
  el.textContent = msg;
  show(el);
}

export function clearError(el: HTMLElement | null): void {
  if (!el) return;
  el.textContent = '';
  hide(el);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderBlocklist(
  domainList: HTMLElement | null,
  emptyState: HTMLElement | null,
  domains: string[],
): void {
  if (!domainList) return;
  domainList.innerHTML = '';

  if (domains.length === 0) {
    show(emptyState);
    return;
  }

  hide(emptyState);
  for (const domain of domains) {
    const li = document.createElement('li');
    li.className = 'domain-item';
    li.dataset['domain'] = domain;
    li.innerHTML = `<span class="domain-name">${escapeHtml(domain)}</span><button class="btn-delete" data-domain="${escapeHtml(domain)}" aria-label="Remove ${escapeHtml(domain)}" title="Remove">\u00d7</button>`;
    domainList.appendChild(li);
  }
}

export function setDeviceName(el: HTMLElement | null, name: string): void {
  if (el) el.textContent = `${name} registered`;
}

export function renderSettings(selectEl: HTMLSelectElement | null, durationMs: number): void {
  if (!selectEl) return;
  selectEl.value = String(durationMs);
}

export function setRegisteredState(
  statusDot: HTMLElement | null,
  sectionRegister: HTMLElement | null,
  sectionKeyStatus: HTMLElement | null,
  sectionAddDomain: HTMLElement | null,
  sectionBlocklist: HTMLElement | null,
  sectionSettings: HTMLElement | null,
): void {
  statusDot?.classList.replace('unregistered', 'registered');
  hide(sectionRegister);
  show(sectionKeyStatus);
  show(sectionAddDomain);
  show(sectionBlocklist);
  show(sectionSettings);
}

export function setUnregisteredState(
  statusDot: HTMLElement | null,
  sectionRegister: HTMLElement | null,
  sectionKeyStatus: HTMLElement | null,
  sectionAddDomain: HTMLElement | null,
  sectionBlocklist: HTMLElement | null,
  sectionSettings: HTMLElement | null,
): void {
  statusDot?.classList.replace('registered', 'unregistered');
  show(sectionRegister);
  hide(sectionKeyStatus);
  hide(sectionAddDomain);
  hide(sectionBlocklist);
  hide(sectionSettings);
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

export interface SessionResult {
  domain: string;
  expiresAt: number;
}

export function attachTimers(
  domainList: HTMLElement | null,
  sessionResults: (SessionResult | null)[],
): void {
  for (const result of sessionResults) {
    if (result === null) continue;
    const li = domainList?.querySelector<HTMLLIElement>(
      `[data-domain="${CSS.escape(result.domain)}"]`,
    );
    if (!li) continue;
    li.dataset['expiresAt'] = String(result.expiresAt);
    const timerSpan = document.createElement('span');
    timerSpan.className = 'domain-timer active';
    timerSpan.id = `timer-${result.domain}`;
    timerSpan.textContent = formatTime(result.expiresAt - Date.now());
    const btn = li.querySelector('.btn-delete');
    li.insertBefore(timerSpan, btn);
  }
}

export function startTimerInterval(domainList: HTMLElement | null): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const timerSpans = Array.from(
      domainList?.querySelectorAll<HTMLSpanElement>('[id^="timer-"]') ?? [],
    );
    for (const span of timerSpans) {
      const li = span.closest('li') as HTMLLIElement | null;
      if (!li?.dataset['expiresAt']) continue;
      const remaining = Number(li.dataset['expiresAt']) - Date.now();
      if (remaining <= 0) {
        span.remove();
        delete li.dataset['expiresAt'];
      } else {
        span.textContent = formatTime(remaining);
      }
    }
  }, 1000);
}
