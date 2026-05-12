/* wjp-calendar-enhancements.js v1 — three new actions per event in the
 * Calendar day panel + an AI Coach footer.
 *
 *   • Edit due date    — opens a date picker that updates rp.nextDate
 *   • Scan statement   — inline OCR scanner that confirms payment + clears
 *   • Ask Coach        — opens AI Coach with context about that bill
 *
 * Plus at the bottom of the day panel:
 *   • Day AI Coach — quick-prompts ("What's due here?", "Move this", etc.)
 *     that act on the day's events on the user's behalf via WJP_ChatCore.
 */
(function () {
  'use strict';
  if (window._wjpCalEnhInstalled) return;
  window._wjpCalEnhInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  function getAppState() { try { return (typeof appState !== 'undefined') ? appState : null; } catch (_) { return null; } }
  function fmtUSD(n) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n||0); }
  function escHtml(s) { return String(s||'').replace(/[&<>"']/g, function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function showToast(msg, kind) {
    try { if (typeof window.showToast === 'function') return window.showToast(msg); } catch (_) {}
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:' + (kind === 'err' ? '#ef4444' : '#1f7a4a') + ';color:#fff;padding:10px 16px;border-radius:8px;font-weight:700;z-index:99999;';
    document.body.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 3000);
  }

  function findRecurringByName(name) {
    var s = getAppState();
    if (!s || !s.recurringPayments) return null;
    var lo = (name || '').toLowerCase();
    for (var i = 0; i < s.recurringPayments.length; i++) {
      var r = s.recurringPayments[i];
      if (r && (r.name || '').toLowerCase() === lo) return r;
    }
    return null;
  }

  // ── Date edit popover ──────────────────────────────────────────────────
  function openDateEditor(eventEl, rp) {
    // Build a tiny popover with a date input + save
    var existing = document.getElementById('wjp-cal-enh-dateedit');
    if (existing) existing.remove();
    var pop = document.createElement('div');
    pop.id = 'wjp-cal-enh-dateedit';
    var rect = eventEl.getBoundingClientRect();
    pop.style.cssText = 'position:absolute;z-index:99998;background:var(--card,#fff);border:1px solid var(--accent,#22c55e);border-radius:10px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,0.35);min-width:240px;';
    pop.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    pop.style.left = (rect.left + window.scrollX) + 'px';
    pop.innerHTML =
      '<div style="font-size:10px;color:var(--accent,#22c55e);font-weight:800;letter-spacing:0.10em;text-transform:uppercase;margin-bottom:6px;">EDIT DUE DATE</div>'
    + '<div style="font-size:13px;font-weight:700;color:var(--ink,#0a0a0a);margin-bottom:8px;">' + escHtml(rp.name) + '</div>'
    + '<input type="date" id="wjp-cal-enh-date" value="' + (rp.nextDate ? String(rp.nextDate).slice(0,10) : '') + '" style="width:100%;padding:8px 10px;border:1px solid var(--border,rgba(0,0,0,0.15));border-radius:6px;font-family:inherit;font-size:13px;">'
    + '<div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end;">'
    + '  <button id="wjp-cal-enh-cancel" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Cancel</button>'
    + '  <button id="wjp-cal-enh-save" type="button" style="background:var(--accent,#22c55e);color:#fff;border:0;padding:6px 14px;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;">Save</button>'
    + '</div>';
    document.body.appendChild(pop);
    var dateInp = pop.querySelector('#wjp-cal-enh-date');
    pop.querySelector('#wjp-cal-enh-cancel').onclick = function () { pop.remove(); };
    pop.querySelector('#wjp-cal-enh-save').onclick = function () {
      var newDate = dateInp.value;
      if (!newDate) { showToast('Pick a date first.', 'err'); return; }
      rp.nextDate = newDate;
      try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
      pop.remove();
      showToast('Due date updated to ' + new Date(newDate + 'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}), 'ok');
      // Force calendar re-render
      try { if (window.WJP_Cal && typeof window.WJP_Cal.tick === 'function') window.WJP_Cal.tick(); } catch (_) {}
      try { if (typeof window.renderUpcomingList === 'function') window.renderUpcomingList(); } catch (_) {}
    };
    // Click outside closes
    setTimeout(function () {
      function onDocClick(e) {
        if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', onDocClick, true); }
      }
      document.addEventListener('click', onDocClick, true);
    }, 50);
  }

  // ── Statement scanner — reuse the same Tesseract pattern as critical-alerts ──
  function openStatementScanner(rp) {
    var dialog = document.createElement('div');
    dialog.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px;';
    dialog.innerHTML =
      '<div style="background:var(--card,#fff);border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:14px;padding:18px;max-width:440px;width:100%;">'
    + '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
    + '    <div>'
    + '      <div style="font-size:9px;color:#a78bfa;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;">CONFIRM ' + escHtml(rp.name) + '</div>'
    + '      <div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);margin-top:2px;">Upload a statement / receipt</div>'
    + '    </div>'
    + '    <button id="wjp-calsc-close" style="background:transparent;border:0;font-size:22px;color:var(--ink-dim,#94a3b8);cursor:pointer;">×</button>'
    + '  </div>'
    + '  <div style="font-size:11px;color:var(--ink-dim,#94a3b8);margin-bottom:12px;line-height:1.5;">We OCR locally — looking for the bill amount or "paid"/"balance $0".</div>'
    + '  <div id="wjp-calsc-drop" style="border:2px dashed var(--border,rgba(255,255,255,0.20));border-radius:12px;padding:20px;text-align:center;cursor:pointer;">'
    + '    <div style="font-size:24px;">📄</div>'
    + '    <div style="font-size:12px;font-weight:700;color:var(--ink,#0a0a0a);margin-top:4px;">Click or drop an image</div>'
    + '    <input type="file" accept="image/*" id="wjp-calsc-file" style="display:none;">'
    + '  </div>'
    + '  <div style="margin-top:10px;display:flex;align-items:center;gap:10px;">'
    + '    <div style="flex:1;height:6px;background:var(--card-2,rgba(255,255,255,0.06));border-radius:999px;overflow:hidden;"><div class="wjp-calsc-bar" style="height:100%;width:0%;background:#a78bfa;transition:width 0.3s;"></div></div>'
    + '    <div class="wjp-calsc-lbl" style="font-size:11px;font-weight:700;color:var(--ink-dim,#94a3b8);min-width:120px;text-align:right;"></div>'
    + '  </div>'
    + '</div>';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.remove(); });
    dialog.querySelector('#wjp-calsc-close').addEventListener('click', function () { dialog.remove(); });

    function setProg(pct, text) {
      var bar = dialog.querySelector('.wjp-calsc-bar');
      var lbl = dialog.querySelector('.wjp-calsc-lbl');
      if (bar) bar.style.width = pct + '%';
      if (lbl) lbl.textContent = text || '';
    }
    function ensureTesseract() {
      return new Promise(function (resolve, reject) {
        if (typeof window.Tesseract !== 'undefined') return resolve();
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js';
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error('Tesseract CDN failed')); };
        document.head.appendChild(s);
      });
    }
    function processFile(file) {
      if (!file || !/^image\//.test((file.type || '').toLowerCase())) { showToast('Pick an image.', 'err'); return; }
      setProg(5, 'Loading OCR…');
      ensureTesseract()
        .then(function () { setProg(15, 'Reading…'); return window.Tesseract.recognize(file, 'eng', { logger: function (m) { if (m && typeof m.progress === 'number' && m.status === 'recognizing text') setProg(15 + m.progress * 75, 'Reading… ' + Math.round(m.progress * 100) + '%'); } }); })
        .then(function (r) {
          var text = (r && r.data && r.data.text) || '';
          var lo = text.toLowerCase();
          var amt = Math.abs(parseFloat(rp.amount) || 0);
          var matched = false;
          if (amt > 0) {
            var nums = text.match(/\d[\d,]*\.?\d{0,2}/g) || [];
            for (var i = 0; i < nums.length; i++) {
              var v = parseFloat(nums[i].replace(/,/g,''));
              if (isFinite(v) && Math.abs(v - amt) <= 1) { matched = true; break; }
            }
          }
          var paid = /\b(paid|payment\s+received|thank\s+you\s+for\s+your\s+payment|balance\s*[:$]?\s*\$?0\.?00?)\b/.test(lo);
          if (matched || paid) {
            setProg(100, 'Confirmed');
            showToast('Statement confirms ' + rp.name + ' — advancing cycle.', 'ok');
            try {
              if (window.WJP_PaymentStatus) {
                window.WJP_PaymentStatus.markPaidThrough(rp.id, new Date(Date.now() + 35*86400000).toISOString().slice(0,10));
                if (typeof window.WJP_PaymentStatus.advanceRecurringByOneCycle === 'function') window.WJP_PaymentStatus.advanceRecurringByOneCycle(rp.id);
              }
              if (typeof window.saveState === 'function') window.saveState();
            } catch (_) {}
            setTimeout(function () {
              dialog.remove();
              try { if (window.WJP_Cal && typeof window.WJP_Cal.tick === 'function') window.WJP_Cal.tick(); } catch (_) {}
            }, 800);
          } else {
            setProg(0, '');
            showToast("Couldn't confirm payment. Try a clearer crop or different document.", 'err');
          }
        })
        .catch(function (e) { setProg(0, ''); showToast('OCR failed: ' + (e && e.message || 'unknown'), 'err'); });
    }
    var drop = dialog.querySelector('#wjp-calsc-drop');
    var file = dialog.querySelector('#wjp-calsc-file');
    drop.addEventListener('click', function () { file.click(); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.style.borderColor = '#a78bfa'; });
    drop.addEventListener('dragleave', function () { drop.style.borderColor = ''; });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.style.borderColor = '';
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) processFile(f);
    });
    file.addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (f) processFile(f);
      this.value = '';
    });
  }

  // ── AI Coach helper — route through ChatCore with full event context ──
  function askCoach(prompt) {
    try {
      var fab = document.getElementById('ai-chat-fab');
      var panel = document.getElementById('ai-chat-panel');
      if (panel && !panel.classList.contains('active') && fab) fab.click();
      setTimeout(function () {
        var inp = document.getElementById('chat-input-v2') || document.getElementById('chat-input');
        if (inp) { inp.value = prompt; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        if (window.WJP_ChatCore && typeof window.WJP_ChatCore.send === 'function') {
          try { window.WJP_ChatCore.send(prompt); return; } catch (_) {}
        }
        var btn = document.getElementById('chat-send-v2') || document.getElementById('chat-send');
        if (btn) btn.click();
      }, 350);
    } catch (_) {}
  }

  function buildEventContextPrompt(rp, action) {
    var s = getAppState();
    var nextDateStr = rp.nextDate ? new Date(String(rp.nextDate).slice(0,10) + 'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : 'unset';
    var ctx = '';
    if (action === 'ask') {
      ctx = 'I have a recurring payment: ' + rp.name + ' ($' + Math.abs(rp.amount) + ', ' + (rp.frequency || 'monthly') + ', next due ' + nextDateStr + '). ';
    } else if (action === 'move') {
      ctx = 'Help me decide a new due date for: ' + rp.name + ' ($' + Math.abs(rp.amount) + ', currently due ' + nextDateStr + '). When in the month would be best given my income? After you suggest a date, I\'ll edit it in the calendar.';
    } else if (action === 'history') {
      ctx = 'Show me the recent Plaid history for ' + rp.name + '. Have I been paying it consistently? Use my real transactions.';
    }
    return ctx + ' Use my real numbers — debts, recent transactions, income.';
  }

  // ── DOM augmentation: inject Edit/Scan/Ask buttons into each event row ──
  // The host calendar renders events into a structure with the 3-dot menu pill.
  // We watch for the day panel mounting and inject our extra row of buttons.
  function augmentDayPanel() {
    try {
      var panel = document.getElementById('wjp-cal-day-panel');
      if (!panel) return;
      if (panel._wjpEnhAugmented) return;
      panel._wjpEnhAugmented = true;

      // Each event row has a 3-dot pill + amount + category badge. Identify
      // them by the cat-edit data attribute on the badge.
      var rows = panel.querySelectorAll('[data-cal-cat-edit]');
      rows.forEach(function (badge) {
        var row = badge.closest('[style*="border-radius:8px"]');
        if (!row || row._wjpActionsAdded) return;
        row._wjpActionsAdded = true;
        var eventId = badge.getAttribute('data-cal-cat-edit');
        // Find event name from row content
        var nameEl = row.querySelector('span[style*="font-weight:700"]');
        var name = nameEl ? (nameEl.textContent || '').trim().split(/[↻]/)[0].trim() : null;
        var rp = name ? findRecurringByName(name) : null;
        if (!rp) return; // skip Plaid-only rows (no editable recurring)

        var actionsBar = document.createElement('div');
        actionsBar.style.cssText = 'display:flex;gap:6px;padding:4px 12px 10px;flex-wrap:wrap;';
        actionsBar.innerHTML =
          '<button type="button" class="wjp-cal-enh-act" data-act="edit" style="background:rgba(34,197,94,0.10);color:#22c55e;border:1px solid #22c55e;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.04em;text-transform:uppercase;">✎ Edit date</button>'
        + '<button type="button" class="wjp-cal-enh-act" data-act="scan" style="background:rgba(167,139,250,0.10);color:#a78bfa;border:1px solid #a78bfa;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.04em;text-transform:uppercase;">📄 Scan</button>'
        + '<button type="button" class="wjp-cal-enh-act" data-act="ask" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.04em;text-transform:uppercase;">💬 Ask Coach</button>'
        + '<button type="button" class="wjp-cal-enh-act" data-act="move" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.04em;text-transform:uppercase;">📅 Best day?</button>';
        row.appendChild(actionsBar);
        actionsBar.querySelectorAll('.wjp-cal-enh-act').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var act = btn.getAttribute('data-act');
            if (act === 'edit') openDateEditor(btn, rp);
            else if (act === 'scan') openStatementScanner(rp);
            else if (act === 'ask') askCoach(buildEventContextPrompt(rp, 'ask') + ' Tell me what you know about it and any actions I should take.');
            else if (act === 'move') askCoach(buildEventContextPrompt(rp, 'move'));
          });
        });
      });

      // Add an AI Coach footer at the bottom of the panel
      if (!panel.querySelector('.wjp-cal-enh-coach-bar')) {
        var coach = document.createElement('div');
        coach.className = 'wjp-cal-enh-coach-bar';
        coach.style.cssText = 'margin-top:14px;padding-top:14px;border-top:1px solid var(--border,rgba(0,0,0,0.06));display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
        coach.innerHTML =
          '<div style="font-size:10px;color:#a78bfa;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;">AI COACH ·</div>'
        + '<button type="button" class="wjp-cal-enh-quickq" data-q="day" style="background:rgba(167,139,250,0.10);color:#a78bfa;border:1px solid #a78bfa;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">What\'s due here?</button>'
        + '<button type="button" class="wjp-cal-enh-quickq" data-q="overlap" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Any conflicts with my paycheck?</button>'
        + '<button type="button" class="wjp-cal-enh-quickq" data-q="reschedule" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Reschedule the lightest bill</button>';
        panel.appendChild(coach);
        coach.querySelectorAll('.wjp-cal-enh-quickq').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var q = btn.getAttribute('data-q');
            // Get the day's date from the panel header
            var headerText = (panel.querySelector('div[style*="font-size:14.5px"]') || {}).textContent || '';
            if (q === 'day') askCoach('Walk me through every bill / income line on ' + headerText + ' on my calendar. Use my real recurringPayments and Plaid transactions. Suggest any action I should take today.');
            else if (q === 'overlap') askCoach('On ' + headerText + ', do any of my bills fall before my paycheck arrives? If so, which one and what should I do?');
            else if (q === 'reschedule') askCoach('Of the bills on ' + headerText + ', pick the one with the smallest amount and suggest a better day to move it to. Walk me through how it improves cash flow.');
          });
        });
      }
    } catch (e) { try { console.warn('[wjp-calendar-enhancements] threw', e); } catch (_) {} }
  }

  function boot() {
    // Poll for day panel to mount, then augment
    setInterval(augmentDayPanel, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  else setTimeout(boot, 800);

  window.WJP_CalendarEnhancements = { augment: augmentDayPanel };
})();
