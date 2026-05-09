/* wjp-bureau-redesign.js v1 — replace the "Connect a credit bureau" card
 * with a 2-pane layout:
 *   - LEFT  "Automatic"  → Coming soon. Lists future bureau integrations.
 *   - RIGHT "Manual"     → Picture / document scanner + manual input.
 *
 * The manual pane includes an inline Tesseract.js drop zone — drop a
 * screenshot from Credit Karma / Experian / myFICO, OCR runs locally, the
 * 3-digit FICO score auto-fills the existing #cs-input-score field. No
 * server upload.
 */
(function () {
  'use strict';
  if (window._wjpBureauRedesignInstalled) return;
  window._wjpBureauRedesignInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var WRAP_ID = 'wjp-bureau-redesign-card';
  var TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js';

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

  function pickScore(text) {
    if (!text) return null;
    var lines = text.split(/\r?\n/);
    var hits = [];
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
          hits.push({ value: v, lineIdx: lineIdx, ctx: ctx });
        }
      }
      lineIdx++;
    });
    if (!hits.length) return null;
    hits.sort(function (a, b) {
      if (b.ctx !== a.ctx) return b.ctx - a.ctx;
      var inBand = function (x) { return (x.value >= 550 && x.value <= 820) ? 1 : 0; };
      var ab = inBand(a), bb = inBand(b);
      if (ab !== bb) return bb - ab;
      return a.lineIdx - b.lineIdx;
    });
    return hits[0];
  }

  function showToast(msg, kind) {
    try { if (typeof window.showToast === 'function') return window.showToast(msg); } catch (_) {}
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:' + (kind === 'err' ? '#ef4444' : '#1f7a4a') + ';color:#fff;padding:10px 16px;border-radius:8px;font-weight:700;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,0.3);';
    document.body.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 3500);
  }

  function setProgress(host, pct, label) {
    var bar = host.querySelector('.wjp-br-bar');
    var lbl = host.querySelector('.wjp-br-lbl');
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (lbl) lbl.textContent = label || '';
  }

  function processFile(host, file) {
    if (!file) return;
    if (!/^image\//.test((file.type || '').toLowerCase())) {
      showToast('Pick an image file (PNG / JPG / HEIC).', 'err');
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
          showToast('Couldn\'t find a 3-digit score (300–850). Try a clearer crop.', 'err');
          return;
        }
        var input = document.getElementById('cs-input-score');
        if (input) {
          input.value = hit.value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          var prev = input.style.boxShadow;
          input.style.transition = 'box-shadow 0.4s';
          input.style.boxShadow = '0 0 0 3px #22c55e';
          setTimeout(function () { input.style.boxShadow = prev || ''; }, 1500);
        }
        setProgress(host, 100, 'Detected: ' + hit.value);
        showToast('Score detected: ' + hit.value + '. Adjust if wrong.', 'ok');
        setTimeout(function () { setProgress(host, 0, ''); }, 2500);
      })
      .catch(function (e) {
        setProgress(host, 0, '');
        showToast('OCR failed: ' + (e && e.message ? e.message : 'unknown error'), 'err');
      });
  }

  function findExistingBureauCard() {
    // Anchor on the unique button id "cs-connect-bureau"
    var btn = document.getElementById('cs-connect-bureau');
    if (btn) {
      var card = btn.closest('.card');
      if (card) return card;
    }
    // Fallback: search by header text
    var cs = document.getElementById('credit-score-tab-content');
    if (!cs) return null;
    var cards = cs.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      var t = (cards[i].textContent || '').toLowerCase();
      if (/connect a credit bureau|connect bureau/.test(t)) return cards[i];
    }
    return null;
  }

  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function buildHTML() {
    return ''
    + '<div class="card" id="' + WRAP_ID + '" style="grid-column:1 / -1; padding:0; overflow:hidden;">'
    +   '<div style="display:grid; grid-template-columns:1fr 1fr; gap:0;" class="wjp-br-grid">'
    // ---- AUTOMATIC pane ----
    +     '<div style="padding:24px 28px; border-right:1px solid var(--border, rgba(255,255,255,0.10));">'
    +       '<div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">'
    +         '<div style="width:36px; height:36px; border-radius:10px; background:rgba(102,126,234,0.15); display:grid; place-items:center;"><i class="ph-fill ph-lightning" style="font-size:18px; color:#667eea;"></i></div>'
    +         '<div>'
    +           '<div style="font-size:9px; letter-spacing:0.12em; font-weight:800; color:#667eea; text-transform:uppercase;">AUTOMATIC</div>'
    +           '<div style="font-size:16px; font-weight:800; color:var(--ink, #0a0a0a);">Live bureau sync</div>'
    +         '</div>'
    +         '<span style="margin-left:auto; background:rgba(167,139,250,0.15); color:#a78bfa; font-size:9px; font-weight:900; padding:4px 8px; border-radius:6px; letter-spacing:0.06em;">COMING SOON</span>'
    +       '</div>'
    +       '<p style="font-size:12px; color:var(--ink-dim, #94a3b8); line-height:1.6; margin:0 0 14px;">'
    +         'Pull your live FICO / VantageScore on demand from a bureau partner. We\'re integrating Array (Equifax / TransUnion) for Pro Plus members.'
    +       '</p>'
    +       '<ul style="list-style:none; padding:0; margin:0 0 16px; display:flex; flex-direction:column; gap:8px;">'
    +         '<li style="display:flex; align-items:center; gap:10px; font-size:12px; color:var(--ink-dim, #94a3b8);"><i class="ph ph-check-circle" style="color:#22c55e; font-size:14px;"></i> No credit hit (soft pull)</li>'
    +         '<li style="display:flex; align-items:center; gap:10px; font-size:12px; color:var(--ink-dim, #94a3b8);"><i class="ph ph-check-circle" style="color:#22c55e; font-size:14px;"></i> Refreshes monthly</li>'
    +         '<li style="display:flex; align-items:center; gap:10px; font-size:12px; color:var(--ink-dim, #94a3b8);"><i class="ph ph-check-circle" style="color:#22c55e; font-size:14px;"></i> Full factor breakdown</li>'
    +       '</ul>'
    +       '<button id="wjp-br-notify" type="button" style="background:transparent; border:1px solid var(--border, rgba(255,255,255,0.20)); color:var(--ink, #0a0a0a); padding:9px 14px; border-radius:8px; font-size:11px; font-weight:800; cursor:pointer; letter-spacing:0.05em;">NOTIFY ME WHEN READY</button>'
    +     '</div>'
    // ---- MANUAL pane ----
    +     '<div style="padding:24px 28px;">'
    +       '<div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">'
    +         '<div style="width:36px; height:36px; border-radius:10px; background:rgba(34,197,94,0.15); display:grid; place-items:center;"><i class="ph-fill ph-camera" style="font-size:18px; color:#22c55e;"></i></div>'
    +         '<div>'
    +           '<div style="font-size:9px; letter-spacing:0.12em; font-weight:800; color:#22c55e; text-transform:uppercase;">MANUAL</div>'
    +           '<div style="font-size:16px; font-weight:800; color:var(--ink, #0a0a0a);">Scan a screenshot</div>'
    +         '</div>'
    +         '<span style="margin-left:auto; background:rgba(34,197,94,0.15); color:#22c55e; font-size:9px; font-weight:900; padding:4px 8px; border-radius:6px; letter-spacing:0.06em;">AVAILABLE</span>'
    +       '</div>'
    +       '<p style="font-size:12px; color:var(--ink-dim, #94a3b8); line-height:1.6; margin:0 0 14px;">'
    +         'Drop a screenshot from Credit Karma / Experian / myFICO. We\'ll OCR your score on this device — nothing uploaded to a server.'
    +       '</p>'
    +       '<div id="wjp-br-drop" style="border:2px dashed var(--border, rgba(255,255,255,0.20)); border-radius:12px; padding:20px; text-align:center; cursor:pointer; transition:border-color 0.18s, background 0.18s;">'
    +         '<div style="font-size:24px; margin-bottom:6px;">📸</div>'
    +         '<div style="font-size:13px; font-weight:700; color:var(--ink, #0a0a0a); margin-bottom:4px;">Drop image here or click to pick</div>'
    +         '<div style="font-size:11px; color:var(--ink-faint, #94a3b8);">PNG · JPG · HEIC up to ~10 MB</div>'
    +         '<input type="file" accept="image/*" id="wjp-br-file" style="display:none;">'
    +       '</div>'
    +       '<div style="margin-top:12px; display:flex; align-items:center; gap:10px;">'
    +         '<div style="flex:1; height:6px; background:var(--card-2, rgba(255,255,255,0.06)); border-radius:999px; overflow:hidden;">'
    +           '<div class="wjp-br-bar" style="height:100%; width:0%; background:#22c55e; transition:width 0.3s;"></div>'
    +         '</div>'
    +         '<div class="wjp-br-lbl" style="font-size:11px; font-weight:700; color:var(--ink-dim, #94a3b8); min-width:120px; text-align:right;"></div>'
    +       '</div>'
    +       '<div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--rule, rgba(255,255,255,0.06)); font-size:11px; color:var(--ink-faint, #94a3b8);">'
    +         'Or scroll down to type your score directly into the form.'
    +       '</div>'
    +     '</div>'
    +   '</div>'
    + '</div>';
  }

  function wireDropZone() {
    var drop = document.getElementById('wjp-br-drop');
    var file = document.getElementById('wjp-br-file');
    if (!drop || !file) return;
    drop.addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (f) processFile(document.getElementById(WRAP_ID), f);
      this.value = '';
    });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.style.borderColor = '#22c55e'; drop.style.background = 'rgba(34,197,94,0.05)'; });
    drop.addEventListener('dragleave', function () { drop.style.borderColor = ''; drop.style.background = ''; });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.style.borderColor = ''; drop.style.background = '';
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) processFile(document.getElementById(WRAP_ID), f);
    });

    // Notify me button — record interest in localStorage
    var notify = document.getElementById('wjp-br-notify');
    if (notify) notify.addEventListener('click', function () {
      try { localStorage.setItem('wjp.bureauNotifyInterest', new Date().toISOString()); } catch (_) {}
      notify.textContent = "✓ WE'LL LET YOU KNOW";
      notify.style.borderColor = '#22c55e';
      notify.style.color = '#22c55e';
      showToast('We\'ll notify you when live bureau sync is ready.', 'ok');
    });
  }

  function render() {
    try {
      var cst = document.getElementById('credit-score-tab-content');
      if (!cst || cst.offsetParent === null) return;
      if (document.getElementById(WRAP_ID)) return; // already mounted

      var existing = findExistingBureauCard();
      if (!existing) return;

      // Replace the existing bureau card with our redesigned card
      var newDiv = document.createElement('div');
      newDiv.innerHTML = buildHTML();
      var newCard = newDiv.firstChild;
      if (existing.parentNode) {
        existing.parentNode.replaceChild(newCard, existing);
      }
      wireDropZone();

      // Responsive: stack on narrow screens
      try {
        var w = newCard.offsetWidth;
        if (w < 640) {
          var grid = newCard.querySelector('.wjp-br-grid');
          if (grid) grid.style.gridTemplateColumns = '1fr';
        }
      } catch (_) {}
    } catch (e) { try { console.warn('[wjp-bureau-redesign] threw', e); } catch (_) {} }
  }

  function whenReady(fn) {
    function ready() { return !!document.getElementById('credit-score-tab-content'); }
    if (ready()) return fn();
    var tries = 0;
    var iv = setInterval(function () {
      if (ready()) { clearInterval(iv); fn(); }
      else if (++tries > 60) clearInterval(iv);
    }, 400);
  }

  function boot() {
    whenReady(function () {
      render();
      // Re-render if the host re-renders the tab (poll cheaply)
      setInterval(render, 3000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  } else {
    setTimeout(boot, 800);
  }

  window.WJP_BureauRedesign = { render: render };
})();
