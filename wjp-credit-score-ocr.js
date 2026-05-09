/* wjp-credit-score-ocr.js v1 — OCR a Credit Karma / Experian / myFICO
 * screenshot and pre-fill the manual credit score field.
 *
 * Reuses the Tesseract.js CDN already loaded by the statement-scan flow.
 * Strategy:
 *   - Detect when the credit-score input (`#cs-input-score`) is on screen.
 *   - Inject an "Upload screenshot" zone next to it.
 *   - On file pick, run Tesseract on the image, extract candidate scores
 *     (any 3-digit number between 300 and 850 — FICO range), pick the
 *     largest-font number near a "score"-related word if possible, else
 *     the most prominent 3-digit hit.
 *   - Pre-fill the input, dispatch the change event so the host save logic
 *     picks it up, and show a "Scanned: 712 — adjust if wrong" confirmation.
 *
 * Privacy: image stays in the browser. Tesseract runs in a Web Worker
 * locally — nothing uploaded to a server.
 */
(function () {
  'use strict';
  if (window._wjpCreditScoreOcrInstalled) return;
  window._wjpCreditScoreOcrInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js';
  var INJECTED_ID = 'wjp-credit-score-ocr-zone';

  function ensureTesseract() {
    return new Promise(function (resolve, reject) {
      if (typeof window.Tesseract !== 'undefined') return resolve();
      var s = document.createElement('script');
      s.src = TESSERACT_CDN;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Tesseract CDN failed to load')); };
      document.head.appendChild(s);
    });
  }

  // Extract the most likely FICO score from raw OCR text.
  // Strategy: collect every standalone integer in 300–850, then prefer the
  // one closest to a line containing "score" / "FICO" / "VantageScore".
  function pickScore(text) {
    if (!text) return null;
    var lines = text.split(/\r?\n/);
    var hits = []; // { value, lineIdx, contextScore }
    var lineIdx = 0;
    lines.forEach(function (line) {
      var clean = line.replace(/[^\dA-Za-z\s]/g, ' ');
      var m, re = /\b(\d{3})\b/g;
      while ((m = re.exec(clean)) !== null) {
        var v = parseInt(m[1], 10);
        if (v >= 300 && v <= 850) {
          var ctx = 0;
          var lo = clean.toLowerCase();
          if (/\bscore\b|\bfico\b|\bvantagescore\b|\bvantage\b/.test(lo)) ctx += 5;
          if (/\bcredit\b/.test(lo)) ctx += 1;
          if (/\bcurrent\b|\btoday\b|\blatest\b/.test(lo)) ctx += 2;
          hits.push({ value: v, lineIdx: lineIdx, ctx: ctx, line: line });
        }
      }
      lineIdx++;
    });
    if (!hits.length) return null;

    // Sort: highest context first, then prefer values in the typical user
    // band (550–800) over edge cases.
    hits.sort(function (a, b) {
      if (b.ctx !== a.ctx) return b.ctx - a.ctx;
      // Prefer values in the most-typical band
      var inBand = function (x) { return (x.value >= 550 && x.value <= 820) ? 1 : 0; };
      var ab = inBand(a), bb = inBand(b);
      if (ab !== bb) return bb - ab;
      // Tiebreak: pick the one earliest on the page (usually shown big)
      return a.lineIdx - b.lineIdx;
    });
    return hits[0];
  }

  function showToast(msg, kind) {
    try {
      if (typeof window.showToast === 'function') return window.showToast(msg);
    } catch (_) {}
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:' + (kind === 'err' ? '#ef4444' : '#1f7a4a') + ';color:#fff;padding:10px 16px;border-radius:8px;font-weight:700;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,0.3);';
    document.body.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 3500);
  }

  function setProgress(host, pct, label) {
    var bar = host.querySelector('.wjp-cso-bar');
    var lbl = host.querySelector('.wjp-cso-lbl');
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (lbl) lbl.textContent = label || ('' + Math.round(pct) + '%');
  }

  function processFile(host, file) {
    if (!file) return;
    var fileType = (file.type || '').toLowerCase();
    if (!/^image\//.test(fileType)) {
      showToast('Pick an image (PNG/JPG/HEIC).', 'err');
      return;
    }
    setProgress(host, 5, 'Loading OCR…');
    ensureTesseract()
      .then(function () {
        setProgress(host, 12, 'Reading image…');
        return window.Tesseract.recognize(file, 'eng', {
          logger: function (m) {
            if (m && typeof m.progress === 'number' && m.status === 'recognizing text') {
              setProgress(host, 12 + m.progress * 80, 'Reading image… ' + Math.round(m.progress * 100) + '%');
            }
          }
        });
      })
      .then(function (result) {
        setProgress(host, 96, 'Looking for score…');
        var text = (result && result.data && result.data.text) || '';
        var hit = pickScore(text);
        if (!hit) {
          setProgress(host, 0, '');
          showToast('Couldn\'t find a 3-digit score (300–850) in that image. Try a clearer crop.', 'err');
          return;
        }
        var input = document.getElementById('cs-input-score');
        if (input) {
          input.value = hit.value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          // Brief flash so user sees it
          var prev = input.style.boxShadow;
          input.style.transition = 'box-shadow 0.4s';
          input.style.boxShadow = '0 0 0 3px #22c55e';
          setTimeout(function () { input.style.boxShadow = prev || ''; }, 1500);
        }
        setProgress(host, 100, 'Scanned: ' + hit.value);
        showToast('Score detected: ' + hit.value + '. Adjust if wrong.', 'ok');
        // Reset progress label after a moment
        setTimeout(function () { setProgress(host, 0, ''); }, 2500);
      })
      .catch(function (e) {
        try { console.warn('[wjp-credit-score-ocr] error', e); } catch (_) {}
        setProgress(host, 0, '');
        showToast('OCR failed: ' + (e && e.message ? e.message : 'unknown error'), 'err');
      });
  }

  function injectZone() {
    var input = document.getElementById('cs-input-score');
    if (!input) return false;
    if (document.getElementById(INJECTED_ID)) return true;

    // Find the field's <label> wrapper so we can append our zone underneath
    var label = input.closest('label') || input.parentNode;
    if (!label || !label.parentNode) return false;

    var zone = document.createElement('div');
    zone.id = INJECTED_ID;
    zone.style.cssText = 'grid-column:1 / -1;margin-top:6px;padding:10px 12px;border:1px dashed var(--border, rgba(255,255,255,0.18));border-radius:10px;background:var(--card-2, rgba(255,255,255,0.02));font-family:var(--sans, Inter, system-ui, sans-serif);';
    zone.innerHTML = ''
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">'
      +   '<div>'
      +     '<div style="font-size:10px;color:var(--accent, #22c55e);font-weight:800;text-transform:uppercase;letter-spacing:0.10em;">SCAN FROM SCREENSHOT</div>'
      +     '<div style="font-size:12px;color:var(--ink-dim, #94a3b8);font-weight:600;margin-top:2px;">'
      +       'Drop a Credit Karma / Experian / myFICO screenshot — we read the score locally on your device.'
      +     '</div>'
      +   '</div>'
      +   '<label style="display:inline-flex;align-items:center;gap:6px;background:var(--accent, #22c55e);color:#0b0f1a;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;">'
      +     '📸 Pick image'
      +     '<input type="file" accept="image/*" style="display:none;" id="wjp-cso-file">'
      +   '</label>'
      + '</div>'
      + '<div style="margin-top:10px;display:flex;align-items:center;gap:10px;">'
      +   '<div style="flex:1;height:6px;background:var(--card, rgba(255,255,255,0.06));border-radius:999px;overflow:hidden;">'
      +     '<div class="wjp-cso-bar" style="height:100%;width:0%;background:#22c55e;transition:width 0.3s;"></div>'
      +   '</div>'
      +   '<div class="wjp-cso-lbl" style="font-size:11px;font-weight:700;color:var(--ink-dim, #94a3b8);min-width:120px;text-align:right;"></div>'
      + '</div>';

    // Insert AFTER the score input's label
    if (label.nextSibling) label.parentNode.insertBefore(zone, label.nextSibling);
    else label.parentNode.appendChild(zone);

    var file = zone.querySelector('#wjp-cso-file');
    if (file) {
      file.addEventListener('change', function () {
        var f = this.files && this.files[0];
        if (f) processFile(zone, f);
        this.value = ''; // allow same file again
      });
    }

    // Drag & drop on the whole zone
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.style.borderColor = '#22c55e'; });
    zone.addEventListener('dragleave', function () { zone.style.borderColor = ''; });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.style.borderColor = '';
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) processFile(zone, f);
    });
    return true;
  }

  // Poll until the credit-score input shows up (it's only mounted when the
  // user opens the credit-score subtab in Settings or wherever it lives).
  function boot() {
    setInterval(injectZone, 1500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  } else {
    setTimeout(boot, 800);
  }

  window.WJP_CreditScoreOCR = { injectZone: injectZone, pickScore: pickScore };
})();
