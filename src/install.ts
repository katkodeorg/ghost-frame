import { $, isIOS, isStandalone, toast } from './util';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Social apps' in-app browsers can't add to the Home Screen; the user must open Safari first. */
const IN_APP = /FBAN|FBAV|Instagram|TikTok|musical_ly|Snapchat|Line\/|Twitter|Pinterest|LinkedInApp/i;

/**
 * "Install" button on the setup screen.
 * - Chromium (Android, desktop): triggers the native install prompt.
 * - iOS: there is no install API, so it opens step-by-step instructions.
 * Hidden when already running from the Home Screen or where installing isn't possible.
 */
export function initInstall(): void {
  const btn = $<HTMLButtonElement>('install');
  const sheet = $<HTMLDialogElement>('install-sheet');
  let deferred: BeforeInstallPromptEvent | null = null;

  if (isStandalone()) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own button instead of the mini-infobar
    deferred = e as BeforeInstallPromptEvent;
    btn.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    btn.hidden = true;
    toast('Ghostframe was added to your Home Screen');
  });

  if (isIOS) {
    btn.hidden = false;
    btn.setAttribute('aria-label', 'Add to Home Screen');
    $('install-inapp').hidden = !IN_APP.test(navigator.userAgent);
  }

  btn.addEventListener('click', async () => {
    if (deferred) {
      const prompt = deferred;
      deferred = null;
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') btn.hidden = true;
      return;
    }
    openSheet(sheet);
  });

  const close = () => closeSheet(sheet);
  $('install-close').addEventListener('click', close);
  $('install-done').addEventListener('click', close);
  // Tap on the backdrop closes the sheet.
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
}

function openSheet(sheet: HTMLDialogElement): void {
  if (typeof sheet.showModal === 'function') sheet.showModal();
  else sheet.setAttribute('open', '');
}

function closeSheet(sheet: HTMLDialogElement): void {
  if (typeof sheet.close === 'function') sheet.close();
  else sheet.removeAttribute('open');
}
