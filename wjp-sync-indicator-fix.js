/* wjp-sync-indicator-fix.js v1 — 2026-05-20
 *
 * Diagnosis: app.js cloudPushNow() writes to Firestore successfully (the
 * appState._cloudSyncTs timestamp updates within seconds of every save) but
 * the in-page sidebar indicator sometimes stays stuck on "⚠ Offline" because
 * a stale code path (race between pull + push, or an init that ran before
 * Firebase auth was ready) called setIndicator('offline') and nothing
 * reset it.
 *
 * Fix: every 5 seconds, check the last successful sync timestamp. If it was
 * within the last 90 seconds and the indicator still says Offline, force it
 * to "Synced". Doesn't touch the sync engine itself — just keeps the UI
 * honest.
 *
 * Also exposes window.WJP_ForceSync() which user can call to push immediately.
 */
(function () {
  "use strict";
  if (window._wjpSyncIndFixInstalled) return;
  window._wjpSyncIndFixInstalled = true;

  function getState() { try { return appState; } catch (_) { return (window.appState || null); } }

  function refreshIndicator() {
    try {
      var el = document.getElementById('wjp-sync-indicator');
      if (!el) return;
      var s = getState();
      var ts = (s && s._cloudSyncTs) || 0;
      if (!ts) return;
      var ageSec = (Date.now() - ts) / 1000;
      // Recently synced (within 90s) but the indicator says Offline -> fix it.
      var current = (el.textContent || '').trim();
      if (ageSec < 90 && /Offline/i.test(current)) {
        el.textContent = '✓ Synced';
        el.style.color = 'rgba(34,197,94,0.9)';
        el.style.background = 'rgba(34,197,94,0.10)';
      }
      // If stale (>5 min) AND indicator says synced, drop to offline.
      if (ageSec > 300 && /Synced/i.test(current)) {
        el.textContent = '⚠ Offline';
        el.style.color = 'rgba(239,68,68,0.95)';
        el.style.background = 'rgba(239,68,68,0.10)';
      }
    } catch (_) {}
  }

  // Single periodic check — cheap, no DOM observation, no race.
  setInterval(refreshIndicator, 5000);
  // Immediate check on load + tab focus (so users see truth fast)
  setTimeout(refreshIndicator, 1500);
  window.addEventListener('focus', refreshIndicator);

  // Helper: force an immediate cloud push and show confirmation.
  window.WJP_ForceSync = function () {
    try {
      if (typeof window.cloudPushNow === 'function') {
        var el = document.getElementById('wjp-sync-indicator');
        if (el) {
          el.textContent = '↻ Syncing';
          el.style.color = 'rgba(102,126,234,0.95)';
          el.style.background = 'rgba(102,126,234,0.10)';
        }
        return Promise.resolve(window.cloudPushNow()).then(function () {
          refreshIndicator();
        });
      }
    } catch (_) {}
    return Promise.resolve();
  };
})();
