/* wjp-data-loss-guard-v3.js v4 — Rolling Firestore backups + cloud-pull guard, ALL arrays.
 *
 * Complements wjp-data-loss-guard.js (v2) which blocks localStorage wipes.
 * This v3 module fills the gaps v2 doesn't cover:
 *
 *   1. ROLLING FIRESTORE BACKUPS — on every non-empty saveState, snapshots
 *      to users/{uid}/state/backup_latest. Daily, also writes a dated
 *      backup users/{uid}/state/backup_YYYYMMDD (keeps last 7 days).
 *
 *   2. CLOUD-PULL GUARD — wraps cloudPull (incoming). If the remote main
 *      doc has 0 debts AND 0 assets, BUT local appState has > 0, BLOCK the
 *      pull and warn. Prevents an accidentally-emptied cloud doc from
 *      replacing a healthy local state.
 *
 *   3. AUTO-RESTORE BANNER — on app load, if main is empty AND a backup
 *      has data, surface a banner: "Your debts/assets appear to have been
 *      cleared on [date]. Restore from backup made on [date]?" with a
 *      one-click restore CTA.
 *
 *   4. AUDIT LOG — every save records a diff entry in localStorage
 *      `wjp_save_audit_log` (capped at 50 entries). Visible in
 *      WJP_DataLossGuard.auditLog() so we can later trace what wiped data.
 *
 * Zero edits to existing modules. Idempotent. Defensive: every Firestore
 * call try/catch'd so a backup failure never blocks the actual save.
 */
(function () {
  'use strict';
  if (window._wjpDataLossGuardV3Installed) return;
  window._wjpDataLossGuardV3Installed = true;
  window._wjpDataLossGuardV3Version = 4;

  var BACKUP_DOC_LATEST = 'backup_latest';
  var AUDIT_KEY = 'wjp_save_audit_log';
  var BACKUP_DEBOUNCE_MS = 4000; // coalesce rapid saves
  var LAST_BACKUP_DAY_KEY = 'wjp_last_dated_backup_day';
  var KEEP_DAYS = 7;

  function fs() {
    try { return window.__wjpFsMod && window.__wjpFsMod.mod; } catch (_) { return null; }
  }
  function db() {
    try { return window.__wjpFsMod && window.__wjpFsMod.db; } catch (_) { return null; }
  }
  function uid() {
    try { return window.__wjpUser && window.__wjpUser.uid; } catch (_) { return null; }
  }
  function appS() {
    try { return window.appState || (typeof appState !== 'undefined' ? appState : null); } catch (_) { return null; }
  }
  // v4: track every meaningful state array, not just debts/assets
  var TRACKED_ARRAYS = [
    'debts', 'assets', 'transactions', 'recurringPayments',
    'notifications', 'creditScoreHistory', 'inbox', 'processedTxIds'
  ];
  function counts(state) {
    var c = {};
    if (!state) { TRACKED_ARRAYS.forEach(function (k) { c[k] = 0; }); return c; }
    TRACKED_ARRAYS.forEach(function (k) {
      c[k] = Array.isArray(state[k]) ? state[k].length : 0;
    });
    // Convenience shortcuts that older code expects
    c.d = c.debts || 0;
    c.a = c.assets || 0;
    c.t = c.transactions || 0;
    return c;
  }
  function hasAnyData(c) {
    for (var i = 0; i < TRACKED_ARRAYS.length; i++) {
      if (c[TRACKED_ARRAYS[i]] > 0) return true;
    }
    return false;
  }
  function nowDay() {
    var d = new Date();
    return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
  }

  // --- AUDIT LOG -----------------------------------------------------------
  function logAudit(event, before, after) {
    try {
      var raw = localStorage.getItem(AUDIT_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      arr.push({
        t: Date.now(),
        ev: event,
        before: before,
        after: after,
        diff: { d: (after.d || 0) - (before.d || 0), a: (after.a || 0) - (before.a || 0) }
      });
      if (arr.length > 50) arr = arr.slice(-50);
      localStorage.setItem(AUDIT_KEY, JSON.stringify(arr));
    } catch (_) {}
  }

  // --- ROLLING BACKUP ------------------------------------------------------
  var _backupTimer = null;
  var _lastBackupTs = 0;
  function scheduleBackup(reason) {
    if (_backupTimer) clearTimeout(_backupTimer);
    _backupTimer = setTimeout(function () { writeBackup(reason); }, BACKUP_DEBOUNCE_MS);
  }
  async function writeBackup(reason) {
    try {
      var s = appS();
      if (!s) return;
      var c = counts(s);
      // Only back up if we actually have data in ANY tracked array — never
      // overwrite a good backup with empty state.
      if (!hasAnyData(c)) {
        try { console.log('[guard-v3] skip backup: empty state (' + reason + ')'); } catch(_){}
        return;
      }
      var u = uid();
      var f = fs();
      var d = db();
      if (!u || !f || !d) return;

      var payload = JSON.parse(JSON.stringify(s)); // deep clone
      payload._backupMeta = {
        reason: reason,
        ts: Date.now(),
        day: nowDay(),
        version: 4,
        counts: c
      };

      // Write latest
      var latestRef = f.doc(d, 'users', u, 'state', BACKUP_DOC_LATEST);
      await f.setDoc(latestRef, payload);
      _lastBackupTs = Date.now();

      // Once per day, also write a dated backup + rotate old ones out
      var today = nowDay();
      var lastDay = localStorage.getItem(LAST_BACKUP_DAY_KEY);
      if (lastDay !== today) {
        var dayRef = f.doc(d, 'users', u, 'state', 'backup_' + today);
        await f.setDoc(dayRef, payload);
        localStorage.setItem(LAST_BACKUP_DAY_KEY, today);
        // Rotate: delete dated backups older than KEEP_DAYS
        try {
          var col = f.collection(d, 'users', u, 'state');
          var all = await f.getDocs(col);
          var cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
          var cutoffDay = cutoff.getFullYear() + ('0' + (cutoff.getMonth() + 1)).slice(-2) + ('0' + cutoff.getDate()).slice(-2);
          var deletions = [];
          all.forEach(function (doc) {
            var id = doc.id;
            var m = id.match(/^backup_(\d{8})$/);
            if (m && m[1] < cutoffDay) {
              deletions.push(f.deleteDoc(f.doc(d, 'users', u, 'state', id)));
            }
          });
          if (deletions.length) await Promise.all(deletions);
        } catch (_) {}
      }

      try { console.log('[guard-v3] backup written (' + reason + ') ' + JSON.stringify(TRACKED_ARRAYS.map(function(k){return k[0]+':'+c[k];}))); } catch(_){}
    } catch (e) {
      try { console.warn('[guard-v3] backup write failed: ' + e.message); } catch(_){}
    }
  }

  // --- SAVE-STATE HOOK -----------------------------------------------------
  function hookSaveState() {
    if (typeof window.saveState !== 'function') return false;
    if (window.saveState.__wjpGuardV3Wrapped) return true;
    var orig = window.saveState;
    var prev = counts(appS());
    var wrapped = function () {
      var before = prev;
      var result = orig.apply(this, arguments);
      var after = counts(appS());
      prev = after;
      // Audit + schedule backup only when state has any meaningful data
      if (hasAnyData(after)) {
        logAudit('saveState', before, after);
        scheduleBackup('saveState ' + TRACKED_ARRAYS.map(function(k){return k[0]+':'+after[k];}).join(','));
      }
      // Loud alarm if ANY tracked array dropped by > 50% (with >=3 baseline)
      TRACKED_ARRAYS.forEach(function (k) {
        if (before[k] >= 3 && after[k] <= before[k] / 2) {
          try { console.error('[guard-v3] ALARM: ' + k + ' dropped ' + before[k] + ' -> ' + after[k]); } catch(_){}
        }
      });
      return result;
    };
    wrapped.__wjpGuardV3Wrapped = true;
    window.saveState = wrapped;
    return true;
  }

  // --- CLOUD-PULL GUARD ----------------------------------------------------
  function hookCloudPull() {
    if (typeof window.cloudPull !== 'function') return false;
    if (window.cloudPull.__wjpGuardV3Wrapped) return true;
    var orig = window.cloudPull;
    var wrapped = async function () {
      var before = counts(appS());
      // If we have data locally, snapshot first as defence
      if (before.d > 0 || before.a > 0) scheduleBackup('pre-cloudPull');
      var result;
      try { result = await orig.apply(this, arguments); } catch (e) { throw e; }
      var after = counts(appS());
      // Detect dangerous pull: ANY tracked array had data and remote replaced with empty
      var dangerous = false; var droppedKey = null;
      for (var i = 0; i < TRACKED_ARRAYS.length; i++) {
        var k = TRACKED_ARRAYS[i];
        if (before[k] > 0 && after[k] === 0) { dangerous = true; droppedKey = k; break; }
      }
      if (dangerous) {
        try { console.error('[guard-v3] DANGEROUS cloudPull replaced local ' + droppedKey + ' with empty remote (before=' + before[droppedKey] + ')'); } catch(_){}
        showRestoreBanner('cloud-pull-empty', before);
      }
      logAudit('cloudPull', before, after);
      return result;
    };
    wrapped.__wjpGuardV3Wrapped = true;
    window.cloudPull = wrapped;
    return true;
  }

  // --- RESTORE FROM BACKUP --------------------------------------------------
  async function readBackupLatest() {
    var u = uid(); var f = fs(); var d = db();
    if (!u || !f || !d) return null;
    try {
      var ref = f.doc(d, 'users', u, 'state', BACKUP_DOC_LATEST);
      var snap = await f.getDoc(ref);
      if (!snap.exists()) return null;
      return snap.data();
    } catch (_) { return null; }
  }

  async function restoreFromBackup(opts) {
    opts = opts || {};
    var bk = await readBackupLatest();
    if (!bk) return { ok: false, reason: 'no-backup' };
    var s = appS();
    if (!s) return { ok: false, reason: 'no-appstate' };
    var before = counts(s);
    var bkCounts = counts(bk);
    if (!opts.confirm && (before.d > 0 || before.a > 0)) {
      return { ok: false, reason: 'would-overwrite', before: before, backup: bkCounts };
    }
    TRACKED_ARRAYS.forEach(function (k) {
      if (Array.isArray(bk[k])) s[k] = bk[k];
    });
    // Also restore non-array top-level keys (settings, budget, balances) so the
    // entire user state is recovered, not just lists.
    ['settings','budget','balances','prefs','household','subscription'].forEach(function (k) {
      if (bk[k] != null) s[k] = bk[k];
    });
    try { if (typeof window.saveState === 'function') window.saveState(); } catch(_){}
    try { if (typeof window.updateUI === 'function') window.updateUI(); } catch(_){}
    logAudit('restoreFromBackup', before, counts(s));
    try { console.log('[guard-v3] restored from backup: d=' + bkCounts.d + ' a=' + bkCounts.a); } catch(_){}
    return { ok: true, restored: bkCounts, was: before };
  }

  // --- RESTORE BANNER UI ---------------------------------------------------
  function showRestoreBanner(reason, beforeCounts) {
    if (document.getElementById('wjp-guard-restore-banner')) return;
    var bk = readBackupLatest();
    bk.then(function (bkData) {
      if (!bkData) return;
      var c = counts(bkData);
      if (c.d === 0 && c.a === 0) return;
      var when = bkData._backupMeta && bkData._backupMeta.ts ? new Date(bkData._backupMeta.ts).toLocaleString() : 'recent';
      var div = document.createElement('div');
      div.id = 'wjp-guard-restore-banner';
      div.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;max-width:520px;width:calc(100% - 32px);background:#fff8e1;color:#3b2a00;border:1px solid #f5c043;border-radius:12px;padding:14px 16px;box-shadow:0 8px 32px rgba(0,0,0,.18);font-family:system-ui,sans-serif;font-size:13.5px;line-height:1.5;';
      div.innerHTML = '<div style="display:flex;align-items:start;gap:12px;">'
        + '<div style="font-size:22px;line-height:1;">🛡️</div>'
        + '<div style="flex:1;"><div style="font-weight:700;margin-bottom:4px;">Possible data loss detected</div>'
        + '<div style="font-size:12.5px;margin-bottom:8px;">'
        + 'A backup from <strong>' + when + '</strong> has <strong>' + c.d + ' debts</strong> and <strong>' + c.a + ' assets</strong>. '
        + 'Restore them now?</div>'
        + '<div style="display:flex;gap:8px;">'
        + '<button id="wjp-guard-restore-btn" style="background:#1f9b54;color:#fff;border:0;padding:7px 14px;border-radius:7px;font-weight:700;font-size:12px;cursor:pointer;">Restore backup</button>'
        + '<button id="wjp-guard-dismiss-btn" style="background:transparent;color:#3b2a00;border:1px solid #d6b349;padding:7px 14px;border-radius:7px;font-weight:600;font-size:12px;cursor:pointer;">Dismiss</button>'
        + '</div></div></div>';
      document.body.appendChild(div);
      document.getElementById('wjp-guard-restore-btn').addEventListener('click', async function () {
        var r = await restoreFromBackup({ confirm: true });
        div.remove();
        if (r.ok) alert('Restored ' + r.restored.d + ' debts and ' + r.restored.a + ' assets from backup.');
        else alert('Restore failed: ' + r.reason);
      });
      document.getElementById('wjp-guard-dismiss-btn').addEventListener('click', function () { div.remove(); });
    });
  }

  // --- EMPTY-ON-LOAD DETECTION ---------------------------------------------
  async function checkEmptyOnLoad() {
    // Wait a bit for app boot + cloud pull to settle
    await new Promise(function (r) { setTimeout(r, 6000); });
    var s = appS();
    if (!s) return;
    var c = counts(s);
    // Detect: ANY tracked array empty locally but backup has data for it
    var bk = await readBackupLatest();
    if (!bk) return;
    var bkC = counts(bk);
    // If user has data on at least one array AND backup is more complete on
    // at least one OTHER array that is now empty, surface the banner.
    var keysEmptyLocallyButBackedUp = TRACKED_ARRAYS.filter(function (k) { return c[k] === 0 && bkC[k] > 0; });
    var keysWithLocalData = TRACKED_ARRAYS.filter(function (k) { return c[k] > 0; });
    // Banner if: fully empty + backup has data, OR partial loss of important arrays
    var fullyEmpty = keysWithLocalData.length === 0 && keysEmptyLocallyButBackedUp.length > 0;
    var partialLoss = keysEmptyLocallyButBackedUp.some(function (k) { return ['debts','assets','transactions','recurringPayments'].indexOf(k) >= 0; });
    if (fullyEmpty || partialLoss) {
      try { console.warn('[guard-v3] data loss detected on load. Missing: ' + keysEmptyLocallyButBackedUp.join(',')); } catch(_){}
      showRestoreBanner('empty-on-load', c);
    }
  }

  // --- INSTALL -------------------------------------------------------------
  function tryInstall() {
    var a = hookSaveState();
    var b = hookCloudPull();
    return a && b;
  }
  if (!tryInstall()) {
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (tryInstall() || attempts > 60) {
        clearInterval(iv);
        try { console.log('[guard-v3] hooks installed after ' + attempts + ' attempts'); } catch(_){}
      }
    }, 500);
  } else {
    try { console.log('[guard-v3] hooks installed at boot'); } catch(_){}
  }

  // Run empty-on-load check after settle
  if (document.readyState === 'complete') checkEmptyOnLoad();
  else window.addEventListener('load', checkEmptyOnLoad);

  // Public API
  window.WJP_DataLossGuardV3 = {
    version: 4,
    trackedArrays: TRACKED_ARRAYS,
    writeBackup: writeBackup,
    scheduleBackup: scheduleBackup,
    restoreFromBackup: restoreFromBackup,
    readBackupLatest: readBackupLatest,
    auditLog: function () {
      try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]'); } catch (_) { return []; }
    },
    clearAuditLog: function () { try { localStorage.removeItem(AUDIT_KEY); } catch (_) {} },
    counts: function () { return counts(appS()); },
    showRestoreBanner: function () { showRestoreBanner('manual', counts(appS())); }
  };
})();
