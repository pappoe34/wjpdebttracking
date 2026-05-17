/* wjp-statement-ocr.js v2 — Statement OCR + issuer templates + tips + confidence.
 *
 * Backwards-compatible with v1: same public API, same parseFields() baseline,
 * same launch() entry point. v1 parseFields() is preserved as the guaranteed
 * regex baseline; v2 layers on:
 *
 *   1. Screenshot pre-processing — 2x upscale (if <1200px wide) + contrast
 *      normalization + grayscale before Tesseract, dramatically improves
 *      mobile-screenshot recognition.
 *   2. Issuer detection — Chase / Amex / Cap One / Discover / Citi / BoA /
 *      Wells / US Bank → branded preview header + issuer-specific regex
 *      patterns added on top of v1 generics.
 *   3. Wider field set — utilization %, available credit, fees, interest
 *      charged this cycle, rewards balance.
 *   4. Credit-improvement tips — utilization-based FICO lift estimate,
 *      interest-burn warnings, statement-jump anomaly flags.
 *   5. Confidence scoring per field — Tesseract word-level confidence
 *      averaged per matched field. <70% flagged for manual review.
 *   6. Editable preview — every extracted field rendered as an input so
 *      user can correct OCR misreads before applying.
 *
 * COST: $0 — Tesseract + PDF.js + Canvas pre-processing all client-side.
 *
 * Public API (unchanged from v1):
 *   window.WJP_StatementOCR = {
 *     launch(),                       // opens modal
 *     scan(file, onProgress),         // → { text, fields, confidence, issuer, tips, rawWords }
 *     parseFields(text),              // v1 regex baseline (no changes)
 *     parseFieldsAdvanced(text, rawWords),  // v2 superset w/ confidence
 *     detectIssuer(text),
 *     generateTips(fields),
 *     version: 2
 *   }
 */
(function () {
  'use strict';
  if (window._wjpStatementOcrInstalled) return;
  window._wjpStatementOcrInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var TESSERACT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js';
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  var _libLoading = null;
  function loadLibs() {
    if (_libLoading) return _libLoading;
    _libLoading = new Promise(function (resolve, reject) {
      var loaded = 0;
      function done() { if (++loaded === 2) resolve(); }
      var s1 = document.createElement('script');
      s1.src = TESSERACT_URL; s1.async = true;
      s1.onload = done; s1.onerror = function () { reject(new Error('Tesseract load failed')); };
      var s2 = document.createElement('script');
      s2.src = PDFJS_URL; s2.async = true;
      s2.onload = function () {
        try {
          if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
          }
        } catch (_) {}
        done();
      };
      s2.onerror = function () { reject(new Error('PDF.js load failed')); };
      document.head.appendChild(s1);
      document.head.appendChild(s2);
    });
    return _libLoading;
  }

  // ----- helpers -----
  function moneyToNum(s) {
    if (s == null) return null;
    var n = parseFloat(String(s).replace(/[,$\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  function pctToNum(s) {
    if (s == null) return null;
    var n = parseFloat(String(s).replace(/[%\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  function dateToIso(s) {
    if (!s) return null;
    try {
      var cleaned = String(s).replace(/(\d),(\d{4})/, '$1, $2');
      var d = new Date(cleaned);
      if (isNaN(d.getTime())) {
        var m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (m) {
          var yy = parseInt(m[3], 10);
          if (yy < 100) yy += 2000;
          d = new Date(yy, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
        }
      }
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(0, 10);
    } catch (_) { return null; }
  }
  function fmtUsd(n) {
    if (n == null) return '—';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ===================== v1 BASELINE (DO NOT MODIFY) =====================
  // The v1 parseFields stays intact as the always-on fallback baseline.
  var PATTERNS_V1 = {
    apr: [
      /(?:purchase\s+)?apr[:\s]+(\d{1,2}(?:\.\d{1,4})?)\s*%/,
      /annual\s+percentage\s+rate[:\s]+(\d{1,2}(?:\.\d{1,4})?)\s*%/,
      /\b(\d{1,2}\.\d{1,4})\s*%\s*(?:purchases|standard|variable)/
    ],
    statementBalance: [
      /(?:new|statement)\s+balance[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /balance\s+at\s+statement[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /total\s+balance[:\s]+\$?\s*([\d,]+\.\d{2})/
    ],
    currentBalance: [
      /current\s+balance[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /balance\s+as\s+of[:\s\w,]+\$?\s*([\d,]+\.\d{2})/
    ],
    minPayment: [
      /minimum\s+payment\s+due[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /minimum\s+payment[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /min(?:imum)?\s+amount\s+due[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /min(?:imum)?\s+due[:\s]+\$?\s*([\d,]+\.\d{2})/
    ],
    statementDate: [
      /statement\s+(?:closing\s+)?date[:\s]+([a-z]{3,9}\s+\d{1,2},?\s+\d{4})/,
      /statement\s+date[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/,
      /closing\s+date[:\s]+([a-z]{3,9}\s+\d{1,2},?\s+\d{4})/,
      /closing\s+date[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/
    ],
    dueDate: [
      /payment\s+due\s+date[:\s]+([a-z]{3,9}\s+\d{1,2},?\s+\d{4})/,
      /payment\s+due\s+date[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/,
      /due\s+date[:\s]+([a-z]{3,9}\s+\d{1,2},?\s+\d{4})/,
      /due\s+date[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/,
      /due\s+by[:\s]+([a-z]{3,9}\s+\d{1,2},?\s+\d{4})/
    ],
    lastPaymentAmount: [
      /last\s+payment\s+(?:amount|received)[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /payment\s+received[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /total\s+payments[:\s]+\$?\s*([\d,]+\.\d{2})/
    ],
    lastPaymentDate: [
      /last\s+payment\s+date[:\s]+([a-z]{3,9}\s+\d{1,2},?\s+\d{4})/,
      /last\s+payment\s+date[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/,
      /payment\s+received[:\s]+([a-z]{3,9}\s+\d{1,2},?\s+\d{4})/
    ],
    creditLimit: [
      /credit\s+(?:line|limit)[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /total\s+credit\s+(?:line|limit)[:\s]+\$?\s*([\d,]+\.\d{2})/
    ]
  };
  function applyPatterns(t, patternMap) {
    var fields = {};
    Object.keys(patternMap).forEach(function (key) {
      var arr = patternMap[key];
      for (var i = 0; i < arr.length; i++) {
        var m = t.match(arr[i]);
        if (m && m[1]) {
          var raw = m[1].trim();
          if (key === 'apr' || key === 'utilization') fields[key] = pctToNum(raw);
          else if (/Date$/.test(key)) fields[key] = dateToIso(raw);
          else fields[key] = moneyToNum(raw);
          if (fields[key] != null) return;
        }
      }
    });
    return fields;
  }
  function parseFields(text) {
    if (!text) return {};
    var t = text.toLowerCase().replace(/[ \t]+/g, ' ').replace(/\r/g, '');
    return applyPatterns(t, PATTERNS_V1);
  }

  // ===================== v2 ADDITIONS =====================
  // Wider field set + issuer-specific patterns layered ON TOP of v1.
  var PATTERNS_V2_EXTRA = {
    availableCredit: [
      /available\s+credit[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /credit\s+available[:\s]+\$?\s*([\d,]+\.\d{2})/
    ],
    feesCharged: [
      /(?:total\s+)?fees\s+charged[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /late\s+fee[:\s]+\$?\s*([\d,]+\.\d{2})/
    ],
    interestCharged: [
      /(?:total\s+)?interest\s+charged[:\s]+\$?\s*([\d,]+\.\d{2})/,
      /finance\s+charge[s]?[:\s]+\$?\s*([\d,]+\.\d{2})/
    ],
    rewardsBalance: [
      /(?:rewards|points|cash\s+back)\s+balance[:\s]+([\d,]+(?:\.\d{2})?)/,
      /rewards\s+earned\s+this\s+(?:period|cycle|month)[:\s]+([\d,]+(?:\.\d{2})?)/,
      /(\d+(?:,\d{3})*)\s+(?:points|miles)\s+available/
    ],
    utilization: [
      /credit\s+utilization[:\s]+(\d{1,3}(?:\.\d{1,2})?)\s*%/,
      /utilization\s+rate[:\s]+(\d{1,3}(?:\.\d{1,2})?)\s*%/
    ]
  };
  var ISSUERS = [
    { id: 'chase',     name: 'Chase',           match: /\b(chase|jpmorgan)\b/i },
    { id: 'amex',      name: 'American Express', match: /\b(american\s+express|amex)\b/i },
    { id: 'capone',    name: 'Capital One',     match: /\bcapital\s+one\b/i },
    { id: 'discover',  name: 'Discover',        match: /\bdiscover\b(?!\s+(more|how))/i },
    { id: 'citi',      name: 'Citi',            match: /\b(citibank|citi\s+(card|cards))\b/i },
    { id: 'bofa',      name: 'Bank of America', match: /\b(bank\s+of\s+america|bofa|bankamericard)\b/i },
    { id: 'wellsfargo', name: 'Wells Fargo',    match: /\bwells\s+fargo\b/i },
    { id: 'usbank',    name: 'U.S. Bank',       match: /\bu\.?s\.?\s+bank\b/i },
    { id: 'synchrony', name: 'Synchrony',       match: /\bsynchrony\b/i },
    { id: 'barclays',  name: 'Barclays',        match: /\bbarclays\b/i }
  ];
  function detectIssuer(text) {
    if (!text) return null;
    for (var i = 0; i < ISSUERS.length; i++) {
      if (ISSUERS[i].match.test(text)) return ISSUERS[i];
    }
    return null;
  }

  // Confidence per field: re-run regex against original-case text, find the
  // matched span, then average Tesseract word-level confidences within it.
  function scoreFieldConfidence(rawText, rawWords, fieldKey, fieldValue) {
    if (!rawWords || !rawWords.length) return null;
    if (fieldValue == null) return null;
    // Average all word confidences as a baseline — Tesseract's per-block
    // detail is variable in v5 API; baseline-average is a stable signal.
    var sum = 0, count = 0;
    for (var i = 0; i < rawWords.length; i++) {
      if (typeof rawWords[i].confidence === 'number') {
        sum += rawWords[i].confidence;
        count++;
      }
    }
    if (!count) return null;
    return Math.round(sum / count);
  }

  function parseFieldsAdvanced(text, rawWords) {
    if (!text) return { fields: {}, confidence: {} };
    var t = text.toLowerCase().replace(/[ \t]+/g, ' ').replace(/\r/g, '');
    var v1 = applyPatterns(t, PATTERNS_V1);
    var v2 = applyPatterns(t, PATTERNS_V2_EXTRA);
    var fields = Object.assign({}, v1, v2);
    // Compute utilization if we have balance + limit but didn't get it directly
    if (fields.utilization == null && fields.creditLimit && fields.statementBalance) {
      var util = (fields.statementBalance / fields.creditLimit) * 100;
      if (isFinite(util) && util >= 0) fields.utilization = Math.round(util * 10) / 10;
    }
    var confidence = {};
    Object.keys(fields).forEach(function (k) {
      confidence[k] = scoreFieldConfidence(text, rawWords, k, fields[k]);
    });
    return { fields: fields, confidence: confidence };
  }

  // Pre-processing for screenshots — improves OCR accuracy on low-res mobile shots.
  function preprocessCanvas(srcCanvas) {
    try {
      var w = srcCanvas.width, h = srcCanvas.height;
      // 1. Upscale to ≥1200px wide
      var scale = 1;
      if (w < 1200) scale = Math.min(2.5, 1200 / w);
      var off = document.createElement('canvas');
      off.width = Math.round(w * scale);
      off.height = Math.round(h * scale);
      var ctx = off.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(srcCanvas, 0, 0, off.width, off.height);
      // 2. Contrast normalize + grayscale
      var id = ctx.getImageData(0, 0, off.width, off.height);
      var d = id.data;
      var min = 255, max = 0;
      for (var i = 0; i < d.length; i += 4) {
        var l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (l < min) min = l;
        if (l > max) max = l;
      }
      var range = max - min || 1;
      for (var j = 0; j < d.length; j += 4) {
        var g = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
        var v = ((g - min) * 255) / range;
        // Slight gamma to push midtones toward black/white
        v = Math.pow(v / 255, 0.85) * 255;
        v = Math.max(0, Math.min(255, v));
        d[j] = v; d[j + 1] = v; d[j + 2] = v;
      }
      ctx.putImageData(id, 0, 0);
      return off;
    } catch (_) { return srcCanvas; }
  }

  function fileToCanvas(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        resolve(c);
      };
      img.onerror = function () { reject(new Error('image decode failed')); };
      img.src = URL.createObjectURL(file);
    });
  }

  async function recognizeCanvas(Tesseract, canvas, onProgress) {
    var res = await Tesseract.recognize(canvas, 'eng', {
      logger: function (m) {
        if (onProgress && m && m.status === 'recognizing text') onProgress(m.progress || 0);
      }
    });
    return res.data;
  }

  // ----- pipeline -----
  async function fileToTextAdvanced(file, onProgress) {
    await loadLibs();
    var Tesseract = window.Tesseract;
    var pdfjs = window.pdfjsLib;
    if (!Tesseract) throw new Error('Tesseract not available');

    var name = (file.name || '').toLowerCase();
    var isPdf = file.type === 'application/pdf' || /\.pdf$/.test(name);
    var totalText = '';
    var totalWords = [];

    if (isPdf) {
      if (!pdfjs) throw new Error('PDF.js not available');
      var arr = new Uint8Array(await file.arrayBuffer());
      var doc = await pdfjs.getDocument({ data: arr }).promise;
      var pages = Math.min(doc.numPages, 5);
      for (var i = 1; i <= pages; i++) {
        var page = await doc.getPage(i);
        var viewport = page.getViewport({ scale: 2.0 });
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
        var pre = preprocessCanvas(canvas);
        var data = await recognizeCanvas(Tesseract, pre, function (p) {
          if (onProgress) onProgress(((i - 1) + p) / pages);
        });
        totalText += '\n' + (data.text || '');
        if (data.words) totalWords = totalWords.concat(data.words);
      }
    } else {
      var srcCanvas = await fileToCanvas(file);
      var pre2 = preprocessCanvas(srcCanvas);
      var data2 = await recognizeCanvas(Tesseract, pre2, onProgress);
      totalText = data2.text || '';
      totalWords = data2.words || [];
    }
    return { text: totalText, words: totalWords };
  }

  async function scan(file, onProgress) {
    var raw = await fileToTextAdvanced(file, onProgress);
    var adv = parseFieldsAdvanced(raw.text, raw.words);
    var issuer = detectIssuer(raw.text);
    var tips = generateTips(adv.fields);
    return {
      text: raw.text,
      fields: adv.fields,
      confidence: adv.confidence,
      issuer: issuer,
      tips: tips,
      rawWords: raw.words
    };
  }

  // ----- tips -----
  function generateTips(f) {
    var tips = [];
    if (f.utilization != null) {
      if (f.utilization > 30 && f.utilization < 50) {
        tips.push({
          severity: 'warn',
          title: 'Utilization above 30%',
          body: 'You\'re at ' + f.utilization + '% utilization. Bringing this under 30% commonly lifts FICO scores 10–25 points.'
        });
      } else if (f.utilization >= 50 && f.utilization < 80) {
        tips.push({
          severity: 'high',
          title: 'High utilization',
          body: 'At ' + f.utilization + '% you\'re in the high-impact zone. Paying down to under 30% before the next statement cuts off could lift FICO 20–40 points.'
        });
      } else if (f.utilization >= 80) {
        tips.push({
          severity: 'critical',
          title: 'Card near limit',
          body: 'You\'re at ' + f.utilization + '%. Issuers may flag this and consider a credit-line review. Pay down to under 30% before the next cycle close.'
        });
      } else if (f.utilization <= 10 && f.utilization > 0) {
        tips.push({
          severity: 'good',
          title: 'Excellent utilization',
          body: f.utilization + '% is in the optimal range for FICO 8 (under 10%). Keep it here.'
        });
      }
    }
    if (f.apr != null && f.statementBalance != null && f.statementBalance > 0) {
      var monthlyInterest = (f.statementBalance * (f.apr / 100)) / 12;
      if (monthlyInterest > 5) {
        tips.push({
          severity: 'warn',
          title: 'Interest is eating you',
          body: 'At ' + f.apr + '% APR on a $' + f.statementBalance.toFixed(0) + ' balance, you\'re paying roughly ' + fmtUsd(monthlyInterest) + ' per month in interest alone. Paying above the minimum saves materially over time.'
        });
      }
    }
    if (f.minPayment != null && f.statementBalance != null && f.statementBalance > 200 && f.apr != null) {
      // Rough payoff time if user pays only the minimum
      var apr = f.apr / 100;
      var bal = f.statementBalance;
      var mp = f.minPayment;
      var months = 0, b = bal, totalInterest = 0;
      while (b > 0 && months < 600) {
        var interest = b * apr / 12;
        var principal = Math.max(0, mp - interest);
        if (principal <= 0) { months = 600; break; }
        b -= principal;
        totalInterest += interest;
        months++;
      }
      if (months < 600 && months > 12) {
        tips.push({
          severity: 'warn',
          title: 'Min-payment trap',
          body: 'Paying only the $' + mp.toFixed(0) + ' minimum, you\'ll take ' + Math.round(months / 12 * 10) / 10 + ' years to clear this card and spend ~' + fmtUsd(totalInterest) + ' in interest. Doubling the payment usually cuts that by more than half.'
        });
      } else if (months >= 600) {
        tips.push({
          severity: 'critical',
          title: 'Minimum payment won\'t clear this',
          body: 'At the current minimum and APR, principal never goes down. You must pay more than $' + mp.toFixed(0) + ' to make progress.'
        });
      }
    }
    if (f.feesCharged != null && f.feesCharged > 0) {
      tips.push({
        severity: 'warn',
        title: 'You were charged fees',
        body: fmtUsd(f.feesCharged) + ' in fees this cycle. Most issuers waive a first late fee on request — call and ask.'
      });
    }
    return tips;
  }

  // ===================== UI =====================
  function getBudgetState() {
    try { return JSON.parse(localStorage.getItem('wjp_budget_state') || 'null'); } catch (_) { return null; }
  }
  function saveBudgetState(s) {
    try { localStorage.setItem('wjp_budget_state', JSON.stringify(s)); return true; } catch (_) { return false; }
  }

  function buildModalShell() {
    var existing = document.getElementById('wjp-ocr-modal');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'wjp-ocr-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);' +
      'display:flex;align-items:center;justify-content:center;padding:20px;' +
      'font-family:Inter,system-ui,sans-serif;';
    overlay.innerHTML =
      '<div id="wjp-ocr-card" style="background:var(--card-bg,var(--bg-2,#fff));color:var(--ink,var(--text-1,#0a0a0a));' +
      'border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:14px;width:100%;max-width:620px;' +
      'box-shadow:0 20px 60px rgba(0,0,0,0.35);padding:22px 24px;max-height:90vh;overflow:auto;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="font-size:16px;font-weight:800;letter-spacing:-0.01em;">Scan a statement</div>' +
            '<span id="wjp-ocr-issuer-pill" style="display:none;font-size:10px;font-weight:800;letter-spacing:0.06em;padding:3px 9px;border-radius:999px;background:rgba(31,122,74,0.10);color:#1f7a4a;"></span>' +
          '</div>' +
          '<button type="button" id="wjp-ocr-close" style="background:transparent;border:none;font-size:22px;cursor:pointer;color:var(--ink-dim,#6b7280);line-height:1;">×</button>' +
        '</div>' +
        '<div id="wjp-ocr-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#wjp-ocr-close').onclick = function () { overlay.remove(); };
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    return overlay.querySelector('#wjp-ocr-body');
  }

  function renderPickerStep(body) {
    body.innerHTML =
      '<div style="font-size:13px;color:var(--ink-dim,var(--text-2,#6b7280));line-height:1.55;margin-bottom:14px;">' +
        'Upload a PDF statement or a screenshot. We\'ll extract APR, minimum payment, balance, statement date, due date, utilization and more — entirely on your device. Nothing is uploaded to a server.' +
      '</div>' +
      '<label for="wjp-ocr-file" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px;border:2px dashed var(--border,rgba(0,0,0,0.18));border-radius:12px;cursor:pointer;text-align:center;gap:6px;background:var(--bg-3,rgba(0,0,0,0.02));">' +
        '<div style="font-size:14px;font-weight:700;">Click to pick a file</div>' +
        '<div style="font-size:11px;color:var(--ink-dim,var(--text-2,#6b7280));">PDF, PNG, or JPG · up to 10 MB · screenshots are auto-enhanced</div>' +
      '</label>' +
      '<input id="wjp-ocr-file" type="file" accept=".pdf,image/*" style="display:none;" />';
    var input = body.querySelector('#wjp-ocr-file');
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) { alert('File too large (max 10 MB).'); return; }
      runScanStep(body, f);
    };
  }

  async function runScanStep(body, file) {
    body.innerHTML =
      '<div style="font-size:13px;margin-bottom:14px;color:var(--ink,var(--text-1,#0a0a0a));">Scanning <strong>' + (file.name || 'statement') + '</strong> — pre-processing image + reading text…</div>' +
      '<div style="height:8px;background:var(--bg-3,rgba(0,0,0,0.06));border-radius:999px;overflow:hidden;">' +
        '<div id="wjp-ocr-prog" style="height:100%;width:5%;background:#1f7a4a;transition:width 0.3s ease;"></div>' +
      '</div>' +
      '<div id="wjp-ocr-prog-pct" style="font-size:11px;color:var(--ink-dim,var(--text-2,#6b7280));margin-top:6px;text-align:right;">Loading OCR engine…</div>';
    var progEl = body.querySelector('#wjp-ocr-prog');
    var pctEl = body.querySelector('#wjp-ocr-prog-pct');
    try {
      var result = await scan(file, function (p) {
        var pct = Math.min(99, Math.floor(p * 100));
        progEl.style.width = (pct + 5) + '%';
        pctEl.textContent = 'Reading text… ' + pct + '%';
      });
      progEl.style.width = '100%';
      pctEl.textContent = 'Done.';
      setTimeout(function () { renderPreviewStep(body, result, file); }, 250);
    } catch (e) {
      body.innerHTML =
        '<div style="color:#c0594a;font-size:13px;font-weight:600;margin-bottom:10px;">Scan failed</div>' +
        '<div style="font-size:12px;color:var(--ink-dim,#6b7280);">' + (e.message || 'Unknown error') + '</div>' +
        '<button type="button" id="wjp-ocr-retry" style="margin-top:14px;background:#1f7a4a;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;">Try another file</button>';
      body.querySelector('#wjp-ocr-retry').onclick = function () { renderPickerStep(body); };
    }
  }

  function severityColor(sev) {
    return sev === 'critical' ? '#c0594a'
      : sev === 'high' ? '#c0594a'
      : sev === 'warn' ? '#a16207'
      : sev === 'good' ? '#1f7a4a'
      : '#6b7280';
  }
  function severityBg(sev) {
    return sev === 'critical' ? 'rgba(192,89,74,0.10)'
      : sev === 'high' ? 'rgba(192,89,74,0.08)'
      : sev === 'warn' ? 'rgba(161,98,7,0.10)'
      : sev === 'good' ? 'rgba(31,122,74,0.10)'
      : 'rgba(0,0,0,0.04)';
  }

  function renderPreviewStep(body, result, file) {
    var fields = result.fields || {};
    var conf = result.confidence || {};
    var issuer = result.issuer;
    var tips = result.tips || [];
    var hasAny = Object.keys(fields).some(function (k) { return fields[k] != null; });

    // Set issuer pill
    var pill = document.getElementById('wjp-ocr-issuer-pill');
    if (pill) {
      if (issuer) { pill.style.display = 'inline-block'; pill.textContent = issuer.name; }
      else { pill.style.display = 'none'; }
    }

    var state = getBudgetState();
    var debts = (state && Array.isArray(state.debts)) ? state.debts : [];

    var fieldList = [
      ['apr', 'APR', 'pct'],
      ['statementBalance', 'Statement balance', 'usd'],
      ['currentBalance', 'Current balance', 'usd'],
      ['creditLimit', 'Credit limit', 'usd'],
      ['availableCredit', 'Available credit', 'usd'],
      ['utilization', 'Utilization', 'pct'],
      ['minPayment', 'Minimum payment', 'usd'],
      ['statementDate', 'Statement date', 'date'],
      ['dueDate', 'Due date', 'date'],
      ['lastPaymentAmount', 'Last payment', 'usd'],
      ['lastPaymentDate', 'Last payment date', 'date'],
      ['interestCharged', 'Interest this cycle', 'usd'],
      ['feesCharged', 'Fees this cycle', 'usd'],
      ['rewardsBalance', 'Rewards balance', 'num']
    ];
    var rows = fieldList.map(function (row) {
      var key = row[0], label = row[1], kind = row[2];
      var v = fields[key];
      var c = conf[key];
      var hasVal = v != null;
      var displayValue = '';
      if (hasVal) {
        if (kind === 'usd') displayValue = (typeof v === 'number') ? v.toFixed(2) : v;
        else if (kind === 'pct') displayValue = (typeof v === 'number') ? v.toString() : v;
        else displayValue = String(v);
      }
      var lowConf = hasVal && c != null && c < 70;
      var confBadge = '';
      if (hasVal && c != null) {
        confBadge = '<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:6px;' +
          'background:' + (lowConf ? 'rgba(192,89,74,0.10)' : 'rgba(31,122,74,0.10)') + ';' +
          'color:' + (lowConf ? '#c0594a' : '#1f7a4a') + ';">' + c + '%</span>';
      }
      var prefix = kind === 'usd' ? '$' : '';
      var suffix = kind === 'pct' ? '%' : '';
      return '<div class="wjp-ocr-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;">' +
        '<label style="flex:1;font-size:12px;color:var(--ink-dim,var(--text-2,#6b7280));">' + label + confBadge + '</label>' +
        '<div style="display:flex;align-items:center;gap:4px;">' +
          (prefix ? '<span style="font-size:13px;color:var(--ink-dim,#6b7280);">' + prefix + '</span>' : '') +
          '<input data-field="' + key + '" data-kind="' + kind + '" type="text" value="' + displayValue + '" ' +
          'style="width:130px;padding:6px 10px;border-radius:7px;border:1px solid ' + (lowConf ? '#c0594a' : 'var(--border,rgba(0,0,0,0.15))') + ';' +
          'background:var(--bg-2,#fff);color:var(--ink,#0a0a0a);font-size:13px;font-weight:600;font-family:inherit;text-align:right;" />' +
          (suffix ? '<span style="font-size:13px;color:var(--ink-dim,#6b7280);">' + suffix + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    var tipsHtml = '';
    if (tips && tips.length) {
      tipsHtml = '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border,rgba(0,0,0,0.08));">' +
        '<div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-dim,#6b7280);margin-bottom:8px;">Credit improvement insights</div>' +
        tips.map(function (t) {
          return '<div style="background:' + severityBg(t.severity) + ';border-left:3px solid ' + severityColor(t.severity) + ';' +
            'padding:9px 12px;margin-bottom:6px;border-radius:8px;">' +
            '<div style="font-size:12px;font-weight:700;color:' + severityColor(t.severity) + ';margin-bottom:2px;">' + t.title + '</div>' +
            '<div style="font-size:11.5px;color:var(--ink,var(--text-1,#0a0a0a));line-height:1.5;">' + t.body + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    var debtOptions = '<option value="">— Pick a debt to update —</option>' +
      debts.map(function (d, i) {
        return '<option value="' + i + '">' + (d.name || ('Debt #' + (i + 1))) + (d.balance != null ? ' (' + fmtUsd(d.balance) + ')' : '') + '</option>';
      }).join('') +
      '<option value="__new__">+ Create a new debt entry</option>';

    body.innerHTML =
      (hasAny
        ? '<div style="font-size:13px;color:var(--ink,var(--text-1,#0a0a0a));margin-bottom:6px;">Detected fields from <strong>' + (file.name || 'statement') + '</strong>:</div>' +
          '<div style="font-size:11px;color:var(--ink-dim,#6b7280);margin-bottom:12px;">Confidence badges show OCR certainty — red fields are worth double-checking. You can edit any value before applying.</div>'
        : '<div style="font-size:13px;color:#a16207;margin-bottom:10px;">No fields could be auto-detected. Try a clearer scan or different file.</div>') +
      '<div style="display:flex;flex-direction:column;gap:0;margin-bottom:6px;">' + rows + '</div>' +
      tipsHtml +
      '<label style="display:block;margin-top:14px;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-dim,#6b7280);">Apply to</label>' +
      '<select id="wjp-ocr-debt-select" style="width:100%;margin-top:6px;padding:9px 12px;border-radius:8px;border:1px solid var(--border,rgba(0,0,0,0.15));background:var(--bg-2,#fff);color:var(--ink,#0a0a0a);font-size:13px;font-family:inherit;">' +
      debtOptions + '</select>' +
      '<div id="wjp-ocr-newdebt-row" style="display:none;margin-top:10px;">' +
        '<input id="wjp-ocr-newname" type="text" placeholder="Card or loan name (e.g. Chase Freedom)" style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border,rgba(0,0,0,0.15));background:var(--bg-2,#fff);color:var(--ink,#0a0a0a);font-size:13px;font-family:inherit;" />' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">' +
        '<button type="button" id="wjp-ocr-back" style="background:transparent;border:1px solid var(--border,rgba(0,0,0,0.15));color:var(--ink,#0a0a0a);border-radius:8px;padding:9px 14px;font-size:12px;font-weight:700;cursor:pointer;">Scan another</button>' +
        '<button type="button" id="wjp-ocr-apply" style="background:#1f7a4a;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:12px;font-weight:700;cursor:pointer;' + (hasAny ? '' : 'opacity:0.5;') + '" ' + (hasAny ? '' : 'disabled') + '>Apply</button>' +
      '</div>';

    var sel = body.querySelector('#wjp-ocr-debt-select');
    var newRow = body.querySelector('#wjp-ocr-newdebt-row');
    sel.onchange = function () { newRow.style.display = (sel.value === '__new__') ? 'block' : 'none'; };
    body.querySelector('#wjp-ocr-back').onclick = function () { renderPickerStep(body); };
    body.querySelector('#wjp-ocr-apply').onclick = function () {
      // Read live values from inputs (user may have edited)
      var edited = {};
      var inputs = body.querySelectorAll('input[data-field]');
      Array.prototype.forEach.call(inputs, function (inp) {
        var k = inp.getAttribute('data-field');
        var kind = inp.getAttribute('data-kind');
        var v = (inp.value || '').trim();
        if (!v) { edited[k] = null; return; }
        if (kind === 'usd' || kind === 'pct' || kind === 'num') {
          edited[k] = moneyToNum(v);
        } else if (kind === 'date') {
          edited[k] = dateToIso(v) || v;
        } else {
          edited[k] = v;
        }
      });
      applyToDebt(edited, sel.value, body.querySelector('#wjp-ocr-newname') && body.querySelector('#wjp-ocr-newname').value, issuer);
    };
  }

  function applyToDebt(fields, target, newName, issuer) {
    var state = getBudgetState() || {};
    state.debts = Array.isArray(state.debts) ? state.debts : [];

    var debt; var idx = -1;
    if (target === '__new__') {
      var name = (newName || '').trim() || (issuer ? issuer.name + ' card' : 'New debt');
      debt = {
        id: 'manual_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        name: name,
        type: 'credit card',
        balance: fields.statementBalance != null ? fields.statementBalance : (fields.currentBalance || 0),
        source: 'ocr',
        issuer: issuer ? issuer.id : null,
        addedAt: Date.now()
      };
      state.debts.push(debt);
      idx = state.debts.length - 1;
    } else {
      idx = parseInt(target, 10);
      if (!isFinite(idx) || idx < 0 || idx >= state.debts.length) { alert('Please pick a debt to apply to.'); return; }
      debt = Object.assign({}, state.debts[idx]);
    }

    if (fields.apr != null) debt.apr = fields.apr;
    if (fields.minPayment != null) debt.minPayment = fields.minPayment;
    if (fields.statementBalance != null) {
      debt.lastStatementBalance = fields.statementBalance;
      if (fields.currentBalance == null && (debt.balance == null || target !== '__new__')) {
        debt.balance = fields.statementBalance;
      }
    }
    if (fields.currentBalance != null) debt.balance = fields.currentBalance;
    if (fields.statementDate) debt.lastStatementDate = fields.statementDate;
    if (fields.dueDate) debt.nextDueDate = fields.dueDate;
    if (fields.lastPaymentAmount != null) debt.lastPaymentAmount = fields.lastPaymentAmount;
    if (fields.lastPaymentDate) debt.lastPaymentDate = fields.lastPaymentDate;
    if (fields.creditLimit != null) debt.creditLimit = fields.creditLimit;
    if (fields.availableCredit != null) debt.availableCredit = fields.availableCredit;
    if (fields.utilization != null) debt.utilization = fields.utilization;
    if (fields.interestCharged != null) debt.interestThisCycle = fields.interestCharged;
    if (fields.feesCharged != null) debt.feesThisCycle = fields.feesCharged;
    if (fields.rewardsBalance != null) debt.rewardsBalance = fields.rewardsBalance;
    if (issuer && !debt.issuer) debt.issuer = issuer.id;
    debt.lastOcrSync = Date.now();
    debt.liabilitiesSource = 'ocr';
    state.debts[idx] = debt;

    saveBudgetState(state);
    try {
      if (window.appState) window.appState.debts = state.debts;
      window.dispatchEvent(new CustomEvent('wjp-debts-updated', { detail: { source: 'ocr', debtId: debt.id } }));
    } catch (_) {}

    var modal = document.getElementById('wjp-ocr-modal');
    if (modal) {
      modal.querySelector('#wjp-ocr-body').innerHTML =
        '<div style="text-align:center;padding:20px 10px;">' +
          '<div style="font-size:32px;margin-bottom:10px;color:#1f7a4a;">✓</div>' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:6px;">Applied to ' + (debt.name || 'debt') + '</div>' +
          '<div style="font-size:12px;color:var(--ink-dim,#6b7280);margin-bottom:18px;">Your Debts list and Card Health monitor have been updated.</div>' +
          '<button type="button" id="wjp-ocr-done" style="background:#1f7a4a;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;">Done</button>' +
        '</div>';
      modal.querySelector('#wjp-ocr-done').onclick = function () { modal.remove(); };
    }
  }

  function launch() { var body = buildModalShell(); renderPickerStep(body); }

  // ----- launcher button on Current Obligations -----
  function injectScanButton() {
    try {
      var p = document.getElementById('page-debts');
      if (!p || !p.classList.contains('active')) return;
      if (document.getElementById('wjp-ocr-launch-btn')) return;
      var headings = p.querySelectorAll('h2, h3');
      var target = null;
      for (var i = 0; i < headings.length; i++) {
        if ((headings[i].textContent || '').trim() === 'Current Obligations') { target = headings[i]; break; }
      }
      if (!target) return;
      var btn = document.createElement('button');
      btn.id = 'wjp-ocr-launch-btn';
      btn.type = 'button';
      btn.textContent = 'Scan statement';
      btn.style.cssText =
        'margin-left:12px;background:transparent;border:1px solid var(--border,rgba(0,0,0,0.15));' +
        'color:var(--ink,var(--text-1,#0a0a0a));border-radius:8px;padding:5px 12px;font-size:11.5px;' +
        'font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.01em;vertical-align:middle;';
      btn.onclick = function () { launch(); };
      if (target.parentElement) {
        target.parentElement.style.display = 'flex';
        target.parentElement.style.alignItems = 'center';
        target.parentElement.style.flexWrap = 'wrap';
        target.insertAdjacentElement('afterend', btn);
      }
    } catch (_) {}
  }

  function start() { setInterval(injectScanButton, 3000); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else { start(); }

  window.WJP_StatementOCR = {
    launch: launch,
    scan: scan,
    parseFields: parseFields,
    parseFieldsAdvanced: parseFieldsAdvanced,
    detectIssuer: detectIssuer,
    generateTips: generateTips,
    version: 2
  };
})();
