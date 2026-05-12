/* wjp-calendar-enhancements.js v4 — click any event to edit, AI Coach in its
 * own collapsible footer.
 *
 * Mechanism: a single click listener delegated on the day panel intercepts
 * clicks on event rows. Opens a per-event action dialog with Edit date /
 * Scan statement / Ask Coach. No row mutation, no DOM walking — just listens.
 *
 * Below, a separate collapsible "Ask AI Coach about this day" dropdown for
 * day-level questions.
 */
(function () {
  'use strict';
  if (window._wjpCalEnhInstalled) return;
  window._wjpCalEnhInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var FOOTER_ID = 'wjp-cal-day-tools';

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

  function parseDayPanelDate() {
    var panel = document.getElementById('wjp-cal-day-panel');
    if (!panel) return null;
    var headerEl = panel.querySelector('div[style*="font-size:14.5px"]');
    if (!headerEl) return null;
    var d = new Date((headerEl.textContent || '').trim());
    return isNaN(d.getTime()) ? null : d;
  }

  function recurringForDay(date) {
    var s = getAppState();
    if (!s || !s.recurringPayments || !date) return [];
    var ymd = date.toISOString().slice(0, 10);
    return s.recurringPayments.filter(function (r) {
      if (!r || !r.nextDate) return false;
      return String(r.nextDate).slice(0, 10) === ymd;
    });
  }

  // Find the recurringPayment that matches a clicked event row's name + amount
  function findEventForRow(rowEl, date) {
    if (!rowEl) return null;
    var nameEl = rowEl.querySelector('span[style*="font-weight:700"]');
    if (!nameEl) return null;
    // Strip the ↻ "moved" marker and other suffixes
    var name = (nameEl.textContent || '').replace(/↻/g, '').trim();
    if (!name) return null;
    var candidates = recurringForDay(date);
    // First try exact match
    var hit = candidates.find(function (r) { return (r.name || '').trim() === name; });
    if (hit) return hit;
    // Fallback: case-insensitive match
    var lo = name.toLowerCase();
    return candidates.find(function (r) { return (r.name || '').toLowerCase() === lo; }) || null;
  }

  // ── Per-event action dialog ─────────────────────────────────────────
  function openEventDialog(rp) {
    var dialog = document.createElement('div');
    dialog.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;';
    dialog.innerHTML =
      '<div style="background:var(--card,#fff);border:1px solid var(--accent,#22c55e);border-radius:14px;padding:18px 20px;max-width:380px;width:100%;">'
    + '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
    + '    <div>'
    + '      <div style="font-size:9px;color:var(--accent,#22c55e);font-weight:800;letter-spacing:0.10em;text-transform:uppercase;">EVENT ACTIONS</div>'
    + '      <div style="font-size:15px;font-weight:800;color:var(--ink,#0a0a0a);margin-top:2px;">' + escHtml(rp.name) + '</div>'
    + '      <div style="font-size:11px;color:var(--ink-dim,#94a3b8);font-weight:600;margin-top:2px;">' + fmtUSD(Math.abs(rp.amount)) + ' · ' + (rp.frequency || 'monthly') + ' · next due ' + (rp.nextDate || 'unset') + '</div>'
    + '    </div>'
    + '    <button id="wjp-cal-evt-close" style="background:transparent;border:0;font-size:22px;color:var(--ink-dim,#94a3b8);cursor:pointer;line-height:1;">×</button>'
    + '  </div>'
    + '  <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">'
    + '    <button id="wjp-cal-evt-edit" type="button" style="background:rgba(34,197,94,0.10);color:#22c55e;border:1px solid #22c55e;padding:10px 14px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;text-align:left;">'
    + '      ✎ Edit due date'
    + '      <span style="display:block;font-size:10.5px;font-weight:600;color:var(--ink-dim,#94a3b8);margin-top:2px;">Change when this bill is due</span>'
    + '    </button>'
    + '    <button id="wjp-cal-evt-scan" type="button" style="background:rgba(167,139,250,0.10);color:#a78bfa;border:1px solid #a78bfa;padding:10px 14px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;text-align:left;">'
    + '      📄 Scan statement / receipt'
    + '      <span style="display:block;font-size:10.5px;font-weight:600;color:var(--ink-dim,#94a3b8);margin-top:2px;">Upload an image — we\\'ll mark it paid if confirmed</span>'
    + '    </button>'
    + '    <button id="wjp-cal-evt-ask" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:10px 14px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;text-align:left;">'
    + '      💬 Ask AI Coach about this bill'
    + '      <span style="display:block;font-size:10.5px;font-weight:600;color:var(--ink-dim,#94a3b8);margin-top:2px;">Pay history, suggestions, payoff tips</span>'
    + '    </button>'
    + '  </div>'
    + '</div>';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.remove(); });
    dialog.querySelector('#wjp-cal-evt-close').onclick = function () { dialog.remove(); };
    dialog.querySelector('#wjp-cal-evt-edit').onclick = function () { dialog.remove(); openDateEditor(rp); };
    dialog.querySelector('#wjp-cal-evt-scan').onclick = function () { dialog.remove(); openStatementScanner(rp); };
    dialog.querySelector('#wjp-cal-evt-ask').onclick = function () {
      dialog.remove();
      askCoach('Tell me about my "' + rp.name + '" bill (' + fmtUSD(Math.abs(rp.amount)) + ' · ' + (rp.frequency || 'monthly') + ' · next due ' + (rp.nextDate || 'unset') + '). Have I been paying it on time based on my Plaid data? Suggest any improvements.');
    };
  }

  function openDateEditor(rp) {
    var pop = document.createElement('div');
    pop.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;';
    pop.innerHTML =
      '<div style="background:var(--card,#fff);border:1px solid var(--accent,#22c55e);border-radius:12px;padding:16px;min-width:280px;max-width:340px;">'
    + '  <div style="font-size:10px;color:var(--accent,#22c55e);font-weight:800;letter-spacing:0.10em;text-transform:uppercase;margin-bottom:6px;">EDIT DUE DATE</div>'
    + '  <div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);margin-bottom:10px;">' + escHtml(rp.name) + '</div>'
    + '  <input type="date" id="wjp-cal-enh-date" value="' + (rp.nextDate ? String(rp.nextDate).slice(0,10) : '') + '" style="width:100%;padding:9px 11px;border:1px solid var(--border,rgba(0,0,0,0.15));border-radius:6px;font-family:inherit;font-size:13px;color:var(--ink,#0a0a0a);background:var(--card,#fff);">'
    + '  <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">'
    + '    <button id="wjp-cal-enh-cancel" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:7px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Cancel</button>'
    + '    <button id="wjp-cal-enh-save" type="button" style="background:var(--accent,#22c55e);color:#fff;border:0;padding:7px 18px;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;">Save</button>'
    + '  </div>'
    + '</div>';
    document.body.appendChild(pop);
    pop.addEventListener('click', function (e) { if (e.target === pop) pop.remove(); });
    var dateInp = pop.querySelector('#wjp-cal-enh-date');
    pop.querySelector('#wjp-cal-enh-cancel').onclick = function () { pop.remove(); };
    pop.querySelector('#wjp-cal-enh-save').onclick = function () {
      var newDate = dateInp.value;
      if (!newDate) { showToast('Pick a date first.', 'err'); return; }
      rp.nextDate = newDate;
      try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
      pop.remove();
      showToast(rp.name + ' moved to ' + new Date(newDate + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' }), 'ok');
    };
  }

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
    + '  <div id="wjp-calsc-drop" style="border:2px dashed var(--border,rgba(255,255,255,0.20));border-radius:12px;padding:20px;text-align:center;cursor:pointer;margin-top:8px;">'
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
    dialog.querySelector('#wjp-calsc-close').onclick = function () { dialog.remove(); };

    function setProg(pct, text) {
      var bar = dialog.querySelector('.wjp-calsc-bar'); var lbl = dialog.querySelector('.wjp-calsc-lbl');
      if (bar) bar.style.width = pct + '%'; if (lbl) lbl.textContent = text || '';
    }
    function ensureTesseract() {
      return new Promise(function (resolve, reject) {
        if (typeof window.Tesseract !== 'undefined') return resolve();
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js';
        s.onload = function () { resolve(); }; s.onerror = function () { reject(new Error('Tesseract CDN failed')); };
        document.head.appendChild(s);
      });
    }
    function processFile(file) {
      if (!file || !/^image\//.test((file.type || '').toLowerCase())) { showToast('Pick an image.', 'err'); return; }
      setProg(5, 'Loading OCR…');
      ensureTesseract()
        .then(function () { setProg(15, 'Reading…'); return window.Tesseract.recognize(file, 'eng', { logger: function (m) { if (m && typeof m.progress === 'number' && m.status === 'recognizing text') setProg(15 + m.progress * 75, 'Reading… ' + Math.round(m.progress * 100) + '%'); } }); })
        .then(function (r) {
          var text = (r && r.data && r.data.text) || ''; var lo = text.toLowerCase();
          var amt = Math.abs(parseFloat(rp.amount) || 0); var matched = false;
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
            showToast('Confirmed — ' + rp.name + ' marked paid + cycle advanced.', 'ok');
            try {
              if (window.WJP_PaymentStatus) {
                window.WJP_PaymentStatus.markPaidThrough(rp.id, new Date(Date.now() + 35*86400000).toISOString().slice(0,10));
                if (typeof window.WJP_PaymentStatus.advanceRecurringByOneCycle === 'function') window.WJP_PaymentStatus.advanceRecurringByOneCycle(rp.id);
              }
              if (typeof window.saveState === 'function') window.saveState();
            } catch (_) {}
            setTimeout(function () { dialog.remove(); }, 800);
          } else { setProg(0, ''); showToast("Couldn't confirm payment. Try a clearer crop.", 'err'); }
        })
        .catch(function (e) { setProg(0, ''); showToast('OCR failed: ' + (e && e.message || 'unknown'), 'err'); });
    }
    var drop = dialog.querySelector('#wjp-calsc-drop'); var file = dialog.querySelector('#wjp-calsc-file');
    drop.onclick = function () { file.click(); };
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.style.borderColor = '#a78bfa'; });
    drop.addEventListener('dragleave', function () { drop.style.borderColor = ''; });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.style.borderColor = '';
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) processFile(f);
    });
    file.addEventListener('change', function () { var f = this.files && this.files[0]; if (f) processFile(f); this.value = ''; });
  }

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

  function dayCtxPrompt(date, events, action) {
    var pretty = date.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric', year:'numeric' });
    var evtLines = events.length ? events.map(function (r) { return '  • ' + r.name + ' · ' + fmtUSD(Math.abs(r.amount)) + ' · ' + (r.frequency || 'monthly'); }).join('\n') : '  (no scheduled bills)';
    var prefix = action;
    if (action === 'whats_due') prefix = 'Walk me through every bill due on ' + pretty + '. Use my real numbers. Tell me what to do today, in priority order.';
    else if (action === 'conflicts') prefix = 'On ' + pretty + ', do any of my bills fall before my paycheck arrives? If so, which one and what should I do?';
    else if (action === 'reschedule') prefix = 'Of the bills on ' + pretty + ', pick the one with the smallest amount and suggest a better day to move it to. Walk me through how it improves cash flow.';
    else if (action === 'history') prefix = 'For each bill due on ' + pretty + ', tell me whether I have paid it consistently based on my Plaid data over the past 90 days.';
    return prefix + '\n\nBills due ' + pretty + ':\n' + evtLines;
  }

  // ── Footer mount (AI Coach only) ─────────────────────────────────────
  function mountFooter() {
    try {
      var panel = document.getElementById('wjp-cal-day-panel');
      if (!panel) {
        var stale = document.getElementById(FOOTER_ID);
        if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
        return;
      }
      if (panel.querySelector('#' + FOOTER_ID)) return;
      var orphan = document.getElementById(FOOTER_ID);
      if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);

      var date = parseDayPanelDate();
      if (!date) return;

      var footer = document.createElement('div');
      footer.id = FOOTER_ID;
      footer.style.cssText = 'margin-top:14px;padding-top:14px;border-top:1px solid var(--border,rgba(0,0,0,0.06));';
      footer.innerHTML =
        '<details style="border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:10px;background:rgba(167,139,250,0.04);">'
      + '  <summary style="cursor:pointer;list-style:none;padding:10px 14px;display:flex;align-items:center;gap:10px;font-size:12px;font-weight:800;color:#a78bfa;outline:none;">'
      + '    <div style="width:24px;height:24px;border-radius:6px;background:rgba(167,139,250,0.20);display:grid;place-items:center;flex-shrink:0;"><i class="ph-fill ph-robot" style="font-size:13px;color:#a78bfa;"></i></div>'
      + '    <div style="flex:1;text-align:left;">Ask AI Coach about this day</div>'
      + '    <span style="font-size:14px;color:#a78bfa;">▾</span>'
      + '  </summary>'
      + '  <div style="padding:12px 14px;border-top:1px solid var(--border,rgba(0,0,0,0.10));display:flex;flex-direction:column;gap:8px;">'
      + '    <button data-q="whats_due" class="wjp-cal-tools-q" type="button" style="background:rgba(167,139,250,0.10);color:#a78bfa;border:1px solid #a78bfa;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;">What\'s due here?</button>'
      + '    <button data-q="conflicts" class="wjp-cal-tools-q" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;">Any conflicts with my paycheck?</button>'
      + '    <button data-q="reschedule" class="wjp-cal-tools-q" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;">Reschedule the lightest bill</button>'
      + '    <button data-q="history" class="wjp-cal-tools-q" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;">Have I been paying these consistently?</button>'
      + '  </div>'
      + '</details>';
      panel.appendChild(footer);

      var events = recurringForDay(date);
      footer.querySelectorAll('.wjp-cal-tools-q').forEach(function (btn) {
        btn.onclick = function () { askCoach(dayCtxPrompt(date, events, btn.getAttribute('data-q'))); };
      });
    } catch (e) { try { console.warn('[wjp-calendar-enhancements v4] mount threw', e); } catch (_) {} }
  }

  // ── Single click delegate on document — opens event dialog on row click ──
  function onDocClick(e) {
    try {
      var panel = document.getElementById('wjp-cal-day-panel');
      if (!panel || !panel.contains(e.target)) return;
      // Ignore clicks on existing controls (close button, category pill, picker, save button etc.)
      var ignore = e.target.closest('[data-cal-close], [data-cal-cat-edit], [data-cal-cat-pick], [data-cal-cat-clear], [data-cal-note], [data-cal-reminder], [data-cal-save], [data-cal-delete], [data-cal-3dot], .wjp-cal-cat-picker, .wjp-cal-tools-q, #' + FOOTER_ID + ', details, summary');
      if (ignore) return;
      // Find the event row that the click landed in
      var row = e.target.closest('[style*="border-radius:8px"]');
      if (!row || !panel.contains(row)) return;
      // Ensure this is an event row inside the panel (has the inner structure)
      if (!row.querySelector('span[style*="font-weight:700"]')) return;
      var date = parseDayPanelDate();
      if (!date) return;
      var rp = findEventForRow(row, date);
      if (!rp) return;
      e.stopPropagation();
      openEventDialog(rp);
    } catch (_) {}
  }

  function boot() {
    document.addEventListener('click', onDocClick, true);
    setInterval(mountFooter, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  else setTimeout(boot, 800);

  window.WJP_CalendarEnhancements = { mountFooter: mountFooter };
})();
