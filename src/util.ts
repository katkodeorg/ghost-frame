export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

/** YYYYMMDD-HHMMSS in local time. */
export function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let toastTimer = 0;
/** Shows a transient status message, optionally with one action button. */
export function toast(message: string, action?: { label: string; run: () => void }, ms = 3500): void {
  const el = $('toast');
  el.replaceChildren(message);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      el.hidden = true;
      action.run();
    });
    el.append(btn);
    ms = Math.max(ms, 8000);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), ms);
}

export function sleepFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
