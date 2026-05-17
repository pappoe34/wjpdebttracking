/* wjp-statement-ocr.js v1 — Client-side statement OCR (no Plaid cost).
 *
 * Accepts a credit-card or loan statement (PDF / PNG / JPG / screenshot),
 * runs Tesseract.js OCR fully in-browser, then regex-extracts the critical
 * fields the user would otherwise need Plaid Liabilities for:
 *
 *   - apr (purchase APR percentage)
 *   - statementBalance / lastStatementBalance
 *   - currentBalance / newBalance
 *   - minPayment
 *   - statementDate (last statement issue date)
 *   - dueDate (next payment due date)
 *   - lastPaymentAmount
 *   - lastPaymentDate
 *   - creditLimit
 *
 * Then opens a preview modal where the user picks which existing debt to
 * patch (or creates a new one), confirms the extracted values, and applies.
 *
 * COST: $0 — Tesseract + PDF.js run client-side, no API calls.
 * Free tier path; available to all paid tiers as well.
 *
 * Surfaces public API:
 *   window.WJP_StatementOCR = {
 *     launch(),               // opens the picker + modal
 *     scan(file),             // promise → { text, fields }
 *     parseFields(text),      // pure: extracts the field map from raw text
 *     version: 1
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

  // ----- CDN locations (lazy-loaded) -----
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

  // ----- field extraction -----
  function moneyToNum(s) {
    if (!s) return null;
    var n = parseFloat(String(s).replace(/[,$\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  function pctToNum(s) {
    if (!s) return null;
    var n = parseFloat(String(s).replace(/[%\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  function dateToIso(s) {
    if (!s) return null;
    try {
      // Normalize OCR oddities — "Jan 5,2026" → "Jan 5, 2026"
      var cleaned = String(s).replace(/(\d),(\d{4})/, '$1, $2');
      var d = new Date(cleaned);
      if (isNaN(d.getTime())) {
        // try mm/dd/yy
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

  // Each pattern produces a candidate; we pick the first match by priority.
  // The text is lower-cased + collapsed whitespace before matching.
  var PATTERNS = {
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

  function parseFields(text) {
    if (!text) return {};
    var t = text.toLowerCase().replace(/[ \t]+/g, ' ').replace(/\r/g, '');
    var fields = {};
    Object.keys(PATTERNS).forEach(function (key) {
      var arr = PATTERNS[key];
      for (var i = 0; i < arr.length; i++) {
        var m = t.match(arr[i]);
        if (m && m[1]) {
          var raw = m[1].trim();
          if (key === 'apr') fields.apr = pctToNum(raw);
          else if (key === 'statementDate' || key === 'dueDate' || key === 'lastPaymentDate') fields[key] = dateToIso(raw);
          else fields[key] = moneyToNum(raw);
          if (fields[key] != null) return;
        }
      }
    });
    return fields;
  }

  // ----- file → text -----
  async function fileToText(file, onProgress) {
    await loadLibs();
    var Tesseract = window.Tesseract;
    var pdfjs = window.pdfjsLib;
    if (!Tesseract) throw new Error('Tesseract not available');

    var name = (file.name || '').toLowerCase();
    var isPdf = file.type === 'application/pdf' || /\.pdf$/.test(name);

    if (isPdf) {
      if (!pdfjs) throw new Error('PDF.js not available');
      var arr = new Uint8Array(await file.arrayBuffer());
      var doc = await pdfjs.getDocument({ data: arr }).promise;
      var pages = Math.min(doc.numPages, 5); // statements are rarely >5 pages
      var totalText = '';
      for (var i = 1; i <= pages; i++) {
        var page = await doc.getPage(i);
        var viewport = page.getViewport({ scale: 2.0 }); // 2x for OCR clarity
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        var ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        var res = await Tesseract.recognize(canvas, 'eng', {
          logger: function (m) {
            if (onProgress && m && m.status === 'recognizing text') {
              onProgress(((i - 1) + (m.progress || 0)) / pages);
            }
          }
        });
        totalText += '\n' + (res.data.text || '');
      }
      return totalText;
    } else {
      var res2 = await Tesseract.recognize(file, 'eng', {
        logger: function (m) {
          if (onProgress && m && m.status === 'recognizing text') onProgress(m.progress || 0);
        }
      });
      return res2.data.text || '';
    }
  }

  async function scan(file, onProgress) {
    var text = await fileToText(file, onProgress);
    var fields = parseFields(text);
    return { text: text, fields: fields };
  }

  // ----- UI: modal launcher -----
  function getBudgetState() {
    try {
      var raw = localStorage.getItem('wjp_budget_state');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function saveBudgetState(s) {
    try { localStorage.setItem('wjp_budget_state', JSON.stringify(s)); return true; } catch (_) { return false; }
  }

  function fmtUsd(n) {
    if (n == null) return '—';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function buildModalShell() {
    var existing = document.getElementById('wjp-ocr-modal');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'wjp-ocr-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);' +
      'display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,sans-serif;';
    overlay.innerHTML =
      '<div style="background:var(--card-bg,var(--bg-2,#fff));color:var(--ink,var(--text-1,#0a0a0a));' +
      'border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:14px;width:100%;max-width:540px;' +
      'box-shadow:0 20px 60px rgba(0,0,0,0.35);padding:22px 24px;max-height:90vh;overflow:auto;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
          '<div style="font-size:16px;font-weight:800;letter-spacing:-0.01em;">Scan a statement</div>' +
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
        'Upload a PDF statement or a screenshot of your statement. We\'ll extract APR, minimum payment, balance, statement date, and due date — entirely on your device. Nothing is uploaded to a server.' +
      '</div>' +
      '<label for="wjp-ocr-file" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px;border:2px dashed var(--border,rgba(0,0,0,0.18));border-radius:12px;cursor:pointer;text-align:center;gap:6px;background:var(--bg-3,rgba(0,0,0,0.02));">' +
        '<div style="font-size:14px;font-weight:700;">Click to pick a file</div>' +
        '<div style="font-size:11px;color:var(--ink-dim,var(--text-2,#6b7280));">PDF, PNG, or JPG · up to 10 MB</div>' +
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
      '<div style="font-size:13px;margin-bottom:14px;color:var(--ink,var(--text-1,#0a0a0a));">Scanning <strong>' + (file.name || 'statement') + '</strong>…</div>' +
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
      setTimeout(function () { renderPreviewStep(body, result, file); }, 300);
    } catch (e) {
      body.innerHTML =
        '<div style="color:#c0594a;font-size:13px;font-weight:600;margin-bottom:10px;">Scan failed</div>' +
        '<div style="font-size:12px;color:var(--ink-dim,#6b7280);">' + (e.message || 'Unknown error') + '</div>' +
        '<button type="button" id="wjp-ocr-retry" style="margin-top:14px;background:#1f7a4a;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;">Try another file</button>';
      body.querySelector('#wjp-ocr-retry').onclick = function () { renderPickerStep(body); };
    }
  }

  function renderPreviewStep(body, result, file) {
    var fields = result.fields || {};
    var hasAny = Object.keys(fields).some(function (k) { return fields[k] != null; });

    var state = getBudgetState();
    var debts = (state && Array.isArray(state.debts)) ? state.debts : [];

    var fieldList = [
      ['apr', 'APR', function (v) { return v != null ? v + '%' : '—'; }],
      ['statementBalance', 'Statement balance', fmtUsd],
      ['currentBalance', 'Current balance', fmtUsd],
      ['minPayment', 'Minimum payment', fmtUsd],
      ['statementDate', 'Statement date', function (v) { return v || '—'; }],
      ['dueDate', 'Due date', function (v) { return v || '—'; }],
      ['lastPaymentAmount', 'Last payment amount', fmtUsd],
      ['lastPaymentDate', 'Last payment date', function (v) { return v || '—'; }],
      ['creditLimit', 'Credit limit', fmtUsd]
    ];
    var rows = fieldList.map(function (row) {
      var key = row[0], label = row[1], fmt = row[2];
      var v = fields[key];
      var hasVal = v != null;
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;background:' + (hasVal ? 'rgba(31,122,74,0.06)' : 'rgba(0,0,0,0.03)') + ';">' +
        '<span style="font-size:12px;color:var(--ink-dim,var(--text-2,#6b7280));">' + label + '</span>' +
        '<span style="font-size:13px;font-weight:' + (hasVal ? 700 : 500) + ';color:' + (hasVal ? 'var(--accent,#1f7a4a)' : 'var(--ink-dim,#6b7280)') + ';">' + fmt(v) + '</span>' +
      '</div>';
    }).join('');

    var debtOptions = '<option value="">— Pick a debt to update —</option>' +
      debts.map(function (d, i) {
        return '<option value="' + i + '">' + (d.name || ('Debt #' + (i + 1))) + (d.balance != null ? ' (' + fmtUsd(d.balance) + ')' : '') + '</option>';
      }).join('') +
      '<option value="__new__">+ Create a new debt entry</option>';

    body.innerHTML =
      (hasAny
        ? '<div style="font-size:13px;color:var(--ink,var(--text-1,#0a0a0a));margin-bottom:10px;">Detected fields from <strong>' + (file.name || 'statement') + '</strong>:</div>'
        : '<div style="font-size:13px;color:#a16207;margin-bottom:10px;">No fields could be auto-detected. Try a clearer scan or different file.</div>') +
      '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px;">' + rows + '</div>' +
      '<label style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-dim,#6b7280);">Apply to</label>' +
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
    sel.onchange = function () {
      newRow.style.display = (sel.value === '__new__') ? 'block' : 'none';
    };
    body.querySelector('#wjp-ocr-back').onclick = function () { renderPickerStep(body); };
    body.querySelector('#wjp-ocr-apply').onclick = function () {
      applyToDebt(fields, sel.value, body.querySelector('#wjp-ocr-newname') && body.querySelector('#wjp-ocr-newname').value);
    };
  }

  function applyToDebt(fields, target, newName) {
    var state = getBudgetState() || {};
    state.debts = Array.isArray(state.debts) ? state.debts : [];

    var debt;
    var idx = -1;
    if (target === '__new__') {
      var name = (newName || '').trim() || 'New debt';
      debt = {
        id: 'manual_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        name: name,
        type: 'credit card',
        balance: fields.statementBalance != null ? fields.statementBalance : (fields.currentBalance || 0),
        source: 'ocr',
        addedAt: Date.now()
      };
      state.debts.push(debt);
      idx = state.debts.length - 1;
    } else {
      idx = parseInt(target, 10);
      if (!isFinite(idx) || idx < 0 || idx >= state.debts.length) {
        alert('Please pick a debt to apply to.');
        return;
      }
      debt = Object.assign({}, state.debts[idx]);
    }

    if (fields.apr != null) debt.apr = fields.apr;
    if (fields.minPayment != null) debt.minPayment = fields.minPayment;
    if (fields.statementBalance != null) {
      debt.lastStatementBalance = fields.statementBalance;
      // If user didn't pick a current balance, use statement balance
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
          '<div style="font-size:32px;margin-bottom:10px;">✓</div>' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:6px;">Applied to ' + (debt.name || 'debt') + '</div>' +
          '<div style="font-size:12px;color:var(--ink-dim,#6b7280);margin-bottom:18px;">Your Debts list and Card Health monitor have been updated.</div>' +
          '<button type="button" id="wjp-ocr-done" style="background:#1f7a4a;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;">Done</button>' +
        '</div>';
      modal.querySelector('#wjp-ocr-done').onclick = function () { modal.remove(); };
    }
  }

  function launch() {
    var body = buildModalShell();
    renderPickerStep(body);
  }

  // ----- entry-point button on Current Obligations area -----
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
      // Append next to the heading (inline)
      if (target.parentElement) {
        target.parentElement.style.display = 'flex';
        target.parentElement.style.alignItems = 'center';
        target.parentElement.style.flexWrap = 'wrap';
        target.insertAdjacentElement('afterend', btn);
      }
    } catch (_) {}
  }

  function start() {
    setInterval(injectScanButton, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.WJP_StatementOCR = {
    launch: launch,
    scan: scan,
    parseFields: parseFields,
    version: 1
  };
})();
