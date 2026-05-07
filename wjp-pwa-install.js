/* ============================================================================
   WJP PWA Install Prompt (W4)
   Captures the browser's beforeinstallprompt event and surfaces our own
   "Install WJP" UI. Dismissible, suppressed for 30 days after dismiss.
   Hides if already installed (matchMedia(display-mode: standalone)).
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpPwaInstalled) return;
  window._wjpPwaInstalled = true;

  const DISMISS_KEY = 'wjp.pwa.installDismissedAt';
  const SUPPRESS_DAYS = 30;

  let deferred = null;

  function isInstalled() {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (navigator.standalone) return true; // iOS
    return false;
  }
  function isDismissed() {
    try {
      const at = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
      if (!at) return false;
      return (Date.now() - at) < SUPPRESS_DAYS * 86400000;
    } catch(_) { return false; }
  }
  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch(_) {}
    const b = document.getElementById('wjp-install-banner');
    if (b) b.remove();
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (isInstalled() || isDismissed()) return;
    setTimeout(showBanner, 4000); // Wait 4s so we don't interrupt initial page load
  });

  // iOS Safari: no beforeinstallprompt event. Show manual install instructions
  // for iOS users who haven't installed yet.
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function showBanner() {
    if (document.getElementById('wjp-install-banner')) return;
    const b = document.createElement('div');
    b.id = 'wjp-install-banner';
    b.style.cssText = `
      position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
      z-index: 9996; background: #fff; color: #0a0a0a;
      border: 1px solid #e5e7eb; border-radius: 14px; padding: 14px 18px;
      max-width: 460px; width: calc(100vw - 40px); display: flex; gap: 12px;
      align-items: center; box-shadow: 0 16px 40px rgba(0,0,0,0.15);
      font-family: Inter, system-ui, sans-serif; font-size: 13.5px;
    `;
    b.innerHTML = `
      <div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0;">WJP</div>
      <div style="flex:1;line-height:1.4;">
        <div style="font-weight:700;color:#0a0a0a;margin-bottom:2px;">Install WJP</div>
        <div style="font-size:12px;color:#6b7280;">Quick access from your home screen. Works offline. No app store needed.</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
        <button id="wjp-install-yes" style="background:#1f7a4a;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;">Install</button>
        <button id="wjp-install-no" style="background:transparent;color:#6b7280;border:none;cursor:pointer;font-size:11px;text-decoration:underline;padding:0;font-family:inherit;">Not now</button>
      </div>
    `;
    document.body.appendChild(b);
    document.getElementById('wjp-install-yes').addEventListener('click', async () => {
      if (!deferred) {
        if (isIOS()) {
          alert("On iOS: tap the Share button (square with arrow up) at the bottom of Safari, then 'Add to Home Screen'.");
        }
        return;
      }
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      if (outcome === 'accepted') {
        b.remove();
        try { localStorage.removeItem(DISMISS_KEY); } catch(_) {}
      } else {
        dismiss();
      }
    });
    document.getElementById('wjp-install-no').addEventListener('click', dismiss);
  }

  // Optional: show iOS-style instructions on iOS Safari only
  if (isIOS() && !isInstalled() && !isDismissed()) {
    setTimeout(() => {
      if (!document.getElementById('wjp-install-banner')) showBanner();
    }, 8000);
  }

  // Public hook for "Install" button in Settings
  window.WJP_PWAInstall = {
    canPrompt: () => !!deferred,
    isInstalled,
    isDismissed,
    dismiss,
    show: showBanner
  };
})();
