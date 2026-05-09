/* wjp-bureau-redesign.js v3 — replace the "Connect a credit bureau" card
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

  // v2: preprocess the image before OCR. Tesseract reads stylized fonts
  // poorly at native resolution; we convert to grayscale, boost contrast,
  // and 2x upscale. This single step matters more than any regex tweak.
  function preprocessImage(file) {
    return new Promise(function (resolve, reject) {
      try {
        var img = new Image();
        img.onload = function () {
          try {
            var scale = 2;
            var w = img.naturalWidth * scale;
            var h = img.naturalHeight * scale;
            // Cap at reasonable size to avoid OOM on huge screenshots
            if (w * h > 12000000) { var k = Math.sqrt(12000000 / (w * h)); w = Math.round(w * k); h = Math.round(h * k); }
            var canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            var data = ctx.getImageData(0, 0, w, h);
            var d = data.data;
            for (var i = 0; i < d.length; i += 4) {
              var lum = 0.2126 * d[i] + 0.7152 * d[i+1] + 0.0722 * d[i+2];
              // boost contrast: map [80, 200] → [0, 255]
              var v = (lum - 80) * (255 / (200 - 80));
              v = v < 0 ? 0 : v > 255 ? 255 : v;
              d[i] = d[i+1] = d[i+2] = v;
            }
            ctx.putImageData(data, 0, 0);
            resolve(canvas);
          } catch (e) { reject(e); }
        };
        img.onerror = function () { reject(new Error('image load failed')); };
        img.src = URL.createObjectURL(file);
      } catch (e) { reject(e); }
    });
  }

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

  // v3: multi-bureau aware extraction. Returns ALL plausible scores with the
  // bureau label they're associated with (proximity-based: same line or within
  // 3 lines). Caller can show a picker if multiple are found.
  function fixDigits(s) {
    return String(s)
      .replace(/[lI|]/g, '1')
      .replace(/[oO]/g, '0')
      .replace(/[Ss]/g, '5')
      .replace(/[Bb](?=\d|$)/g, '8')
      .replace(/[gG]/g, '9');
  }
  var BUREAU_PATTERNS = [
    { key: 'transunion', label: 'TransUnion', re: /trans\s*union|\btu\b|transunlon|transun1on/i },
    { key: 'equifax',    label: 'Equifax',    re: /equifax|equ1fax|\beq\b/i },
    { key: 'experian',   label: 'Experian',   re: /experian|exper1an|\bex\b/i },
    { key: 'fico',       label: 'FICO',       re: /\bfico\b/i },
    { key: 'vantage',    label: 'VantageScore', re: /vantage(score)?/i }
  ];
  function detectBureauNear(lines, lineIdx) {
    var lo = (lines[lineIdx] || '').toLowerCase();
    for (var i = 0; i < BUREAU_PATTERNS.length; i++) {
      if (BUREAU_PATTERNS[i].re.test(lo)) return BUREAU_PATTERNS[i];
    }
    // Look up to 3 lines before and after
    for (var d = 1; d <= 3; d++) {
      var prev = lineIdx - d >= 0 ? (lines[lineIdx - d] || '').toLowerCase() : '';
      var next = lineIdx + d < lines.length ? (lines[lineIdx + d] || '').toLowerCase() : '';
      for (var j = 0; j < BUREAU_PATTERNS.length; j++) {
        if (BUREAU_PATTERNS[j].re.test(prev) || BUREAU_PATTERNS[j].re.test(next)) return BUREAU_PATTERNS[j];
      }
    }
    return null;
  }

  function findAllScores(text) {
    if (!text) return [];
    var lines = text.split(/\r?\n/);
    var hits = [];
    lines.forEach(function (line, lineIdx) {
      var lo = line.toLowerCase();
      var ctxBoost = 0;
      if (/score|fico|vantagescore|vantage/.test(lo)) ctxBoost += 5;
      if (/credit/.test(lo)) ctxBoost += 1;
      if (/current|today|latest|your/.test(lo)) ctxBoost += 2;
      var bureau = detectBureauNear(lines, lineIdx);
      if (bureau) ctxBoost += 4;

      // Direct 3-digit reads
      var m, re = /(\d{3})/g;
      while ((m = re.exec(line)) !== null) {
        var v = parseInt(m[1], 10);
        if (v >= 300 && v <= 850) {
          hits.push({ value: v, bureau: bureau ? bureau.key : null, bureauLabel: bureau ? bureau.label : 'Score', ctx: ctxBoost, source: 'direct' });
        }
      }
      // Corrected reads (l→1, O→0, etc)
      var fixed = fixDigits(line);
      var re2 = /(\d{3})/g;
      while ((m = re2.exec(fixed)) !== null) {
        var v = parseInt(m[1], 10);
        if (v >= 300 && v <= 850) {
          var dup = hits.some(function (h) { return h.value === v && h.bureau === (bureau ? bureau.key : null); });
          if (!dup) hits.push({ value: v, bureau: bureau ? bureau.key : null, bureauLabel: bureau ? bureau.label : 'Score', ctx: ctxBoost, source: 'corrected' });
        }
      }
    });

    // Dedup: same (value, bureau) — keep highest ctx
    var byKey = {};
    hits.forEach(function (h) {
      var k = h.value + '|' + (h.bureau || '');
      if (!byKey[k] || byKey[k].ctx < h.ctx) byKey[k] = h;
    });
    var out = Object.values ? Object.values(byKey) : Object.keys(byKey).map(function (k) { return byKey[k]; });

    // Sort: bureau-labeled first, then in-band, then by ctx
    out.sort(function (a, b) {
      if ((b.bureau ? 1 : 0) !== (a.bureau ? 1 : 0)) return (b.bureau ? 1 : 0) - (a.bureau ? 1 : 0);
      if (b.ctx !== a.ctx) return b.ctx - a.ctx;
      var inBand = function (x) { return (x.value >= 550 && x.value <= 820) ? 1 : 0; };
      return inBand(b) - inBand(a);
    });
    return out;
  }

  function pickScore(text) {
    var hits = findAllScores(text);
    return hits.length ? hits[0] : null;
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

  function applyScoreToInput(value) {
    var inputEl = document.getElementById('cs-input-score');
    if (inputEl) {
      inputEl.value = value;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      var prev = inputEl.style.boxShadow;
      inputEl.style.transition = 'box-shadow 0.4s';
      inputEl.style.boxShadow = '0 0 0 3px #22c55e';
      setTimeout(function () { inputEl.style.boxShadow = prev || ''; }, 1500);
    }
  }
  // Persist all bureau scores so future UI can show them side by side
  function recordBureauScores(scores) {
    try {
      var cs = JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}');
      cs.bureauScores = cs.bureauScores || {};
      scores.forEach(function (h) {
        if (h.bureau) cs.bureauScores[h.bureau] = { value: h.value, capturedAt: Date.now() };
      });
      localStorage.setItem('wjp_credit_inputs', JSON.stringify(cs));
    } catch (_) {}
  }

  function showScorePicker(host, scores) {
    recordBureauScores(scores);
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px;';
    var rowsHTML = scores.map(function (h, i) {
      var color = h.value >= 740 ? '#22c55e' : h.value >= 670 ? '#84cc16' : h.value >= 580 ? '#fbbf24' : '#ef4444';
      return ''
      + '<button data-idx="' + i + '" class="wjp-br-pick" style="display:flex;align-items:center;gap:14px;width:100%;padding:14px 16px;background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:10px;cursor:pointer;font-family:inherit;color:inherit;margin-bottom:10px;text-align:left;transition:transform 0.15s,border-color 0.15s;">'
      +   '<div style="font-size:32px;font-weight:900;color:' + color + ';line-height:1;min-width:80px;">' + h.value + '</div>'
      +   '<div style="flex:1;">'
      +     '<div style="font-size:13px;font-weight:800;color:var(--ink,#0a0a0a);">' + escHtml(h.bureauLabel) + '</div>'
      +     '<div style="font-size:11px;color:var(--ink-dim,#94a3b8);font-weight:600;margin-top:2px;">'
      +       (h.value >= 740 ? 'Very good' : h.value >= 670 ? 'Good' : h.value >= 580 ? 'Fair' : 'Poor')
      +     '</div>'
      +   '</div>'
      +   '<span style="color:var(--ink-faint,#94a3b8);font-size:14px;">→</span>'
      + '</button>';
    }).join('');
    modal.innerHTML =
      '<div style="background:var(--card,#fff);border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:14px;padding:20px;max-width:440px;width:100%;">'
    + '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
    + '    <div>'
    + '      <div style="font-size:10px;color:var(--accent,#22c55e);font-weight:800;text-transform:uppercase;letter-spacing:0.10em;">MULTIPLE SCORES FOUND</div>'
    + '      <div style="font-size:15px;font-weight:800;color:var(--ink,#0a0a0a);margin-top:2px;">Pick which to save as your current</div>'
    + '    </div>'
    + '    <button id="wjp-br-pickclose" style="background:transparent;border:0;font-size:22px;color:var(--ink-dim,#94a3b8);cursor:pointer;">×</button>'
    + '  </div>'
    + '  <div style="font-size:11px;color:var(--ink-faint,#94a3b8);margin:6px 0 14px;">All scores have been saved. Pick the one you want set as your "current" — used for the engine and dashboard widgets.</div>'
    + '  ' + rowsHTML
    + '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    var x = modal.querySelector('#wjp-br-pickclose');
    if (x) x.addEventListener('click', function () { modal.remove(); });
    modal.querySelectorAll('.wjp-br-pick').forEach(function (btn) {
      btn.addEventListener('mouseenter', function () { btn.style.transform = 'translateX(2px)'; btn.style.borderColor = 'var(--accent,#22c55e)'; });
      btn.addEventListener('mouseleave', function () { btn.style.transform = ''; btn.style.borderColor = 'var(--border,rgba(255,255,255,0.10))'; });
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var pick = scores[idx];
        if (pick) {
          applyScoreToInput(pick.value);
          showToast('Saved ' + pick.bureauLabel + ' ' + pick.value + ' as current. Both bureaus stored.', 'ok');
        }
        modal.remove();
      });
    });
  }

  function showOcrTextDialog(text) {
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML =
      '<div style="background:var(--card,#fff);border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:14px;padding:18px;max-width:560px;width:100%;max-height:80vh;display:flex;flex-direction:column;">'
    + '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
    + '    <div style="font-size:13px;font-weight:800;color:var(--ink,#0a0a0a);">What the OCR read</div>'
    + '    <button id="wjp-br-ocrclose" style="background:transparent;border:0;font-size:22px;color:var(--ink-dim,#94a3b8);cursor:pointer;">×</button>'
    + '  </div>'
    + '  <pre style="background:var(--card-2,rgba(255,255,255,0.03));padding:12px;border-radius:8px;font-size:11px;color:var(--ink,#0a0a0a);white-space:pre-wrap;overflow:auto;max-height:50vh;font-family:ui-monospace,monospace;">' + escHtml(text || '(empty)') + '</pre>'
    + '  <div style="font-size:11px;color:var(--ink-dim,#94a3b8);margin-top:8px;line-height:1.5;">'
    + '    Tip: best results when the score is the LARGEST number in the image. Crop tightly around the score before uploading. If your score IS in the text above but I missed it, type it manually below — I\'ll learn that pattern next time.'
    + '  </div>'
    + '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    var x = modal.querySelector('#wjp-br-ocrclose');
    if (x) x.addEventListener('click', function () { modal.remove(); });
  }

  function processFile(host, file) {
    if (!file) return;
    if (!/^image\//.test((file.type || '').toLowerCase())) {
      showToast('Pick an image file (PNG / JPG / HEIC).', 'err');
      return;
    }
    setProgress(host, 5, 'Preprocessing…');
    Promise.resolve()
      .then(function () { return preprocessImage(file).catch(function () { return file; }); })
      .then(function (input) {
        setProgress(host, 12, 'Loading OCR…');
        return ensureTesseract().then(function () {
          setProgress(host, 18, 'Reading image…');
          return window.Tesseract.recognize(input, 'eng', {
            logger: function (m) {
              if (m && typeof m.progress === 'number' && m.status === 'recognizing text') {
                setProgress(host, 18 + m.progress * 75, 'Reading image… ' + Math.round(m.progress * 100) + '%');
              }
            }
          });
        });
      })
      .then(function (result) {
        setProgress(host, 96, 'Looking for score…');
        var text = (result && result.data && result.data.text) || '';
        var hits = findAllScores(text);
        // v3: if multiple bureau-labeled scores found, show a picker
        var labeled = hits.filter(function (h) { return h.bureau; });
        if (labeled.length >= 2) {
          setProgress(host, 100, 'Found ' + labeled.length + ' scores');
          showScorePicker(host, labeled);
          setTimeout(function () { setProgress(host, 0, ''); }, 1500);
          return;
        }
        var hit = hits[0] || null;
        if (!hit) {
          setProgress(host, 0, '');
          host._lastOcrText = text;
          var btn = host.querySelector('.wjp-br-show-ocr');
          if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'wjp-br-show-ocr';
            btn.textContent = 'Show what we read';
            btn.style.cssText = 'margin-top:8px;background:transparent;border:1px solid var(--border,rgba(255,255,255,0.20));color:var(--ink-dim,#94a3b8);padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;';
            btn.addEventListener('click', function () { showOcrTextDialog(host._lastOcrText || '(empty)'); });
            var dropZone = host.querySelector('#wjp-br-drop');
            if (dropZone && dropZone.parentNode) dropZone.parentNode.insertBefore(btn, dropZone.nextSibling);
          }
          showToast('Couldn\'t find a 3-digit score (300–850). Click "Show what we read" to see what the OCR pulled.', 'err');
          return;
        }
        if (hit.bureau) recordBureauScores([hit]);
        applyScoreToInput(hit.value);
        setProgress(host, 100, 'Detected: ' + hit.bureauLabel + ' ' + hit.value);
        showToast(hit.bureauLabel + ' ' + hit.value + ' saved. Adjust if wrong.', 'ok');
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
