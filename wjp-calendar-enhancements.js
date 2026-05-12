/* wjp-calendar-enhancements.js v3 — Calendar additions, conservative version.
 *
 * v1 broke the calendar by walking and mutating each event row's DOM, which
 * clashed with the host's tight render loop. v2 disabled everything.
 *
 * v3 adds the same functionality WITHOUT touching existing event rows.
 * Approach: a single "Day Tools" footer appended to the day panel ONCE per
 * mount, removed and re-added when the host re-renders the panel. The footer
 * has:
 *   - A picker that lists today's events
 *   - 3 actions on the selected event: ✎ Edit date · 📄 Scan statement · 💬 Ask Coach
 *   - 3 AI Coach quick-prompts for the whole day (What's due / Conflicts / Reschedule)
 *
 * No per-event DOM injection. No walking of event rows. Single, well-defined
 * mount point.
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
  function escAttr(s) { return escHtml(s).replace(/\s/g, '_'); }
  function showToast(msg, kind) {
    try { if (typeof window.showToast === 'function') return window.showToast(msg); } catch (_) {}
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:' + (kind === 'err' ? '#ef4444' : '#1f7a4a') + ';color:#fff;padding:10px 16px;border-radius:8px;font-weight:700;z-index:99999;';
    document.body.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 3000);
  }

  // ── Find the selected day from the panel ────────────────────────────────
  function parseDayPanelDate() {
    var panel = document.getElementById('wjp-cal-day-panel');
    if (!panel) return null;
    var headerEl = panel.querySelector('div[style*="font-size:14.5px"]');
    if (!headerEl) return null;
    // Format: "Friday, May 1, 2026"
    var t = (headerEl.textContent || '').trim();
    var d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }

  // List recurring payments that match the selected day
  function recurringForDay(date) {
    var s = getAppState();
    if (!s || !s.recurringPayments || !date) return [];
    var ymd = date.toISOString().slice(0, 10);
    return s.recurringPayments.filter(function (r) {
      if (!r || !r.nextDate) return false;
      return String(r.nextDate).slice(0, 10) === ymd;
    });
  }

  // ── Date editor ─────────────────────────────────────────────────────────
  function openDateEditor(rp) {
    var existing = document.getElementById('wjp-cal-enh-dateedit');
    if (existing) existing.remove();
    var pop = document.createElement('div');
    pop.id = 'wjp-cal-enh-dateedit';
    pop.style.cssText = 'position:fixed;z-index:99998;background:var(--card,#fff);border:1px solid var(--accent,#22c55e);border-radius:10px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,0.35);min-width:260px;left:50%;top:30%;transform:translate(-50%,-50%);';
    pop.innerHTML =
      '<div style="font-size:10px;color:var(--accent,#22c55e);font-weight:800;letter-spacing:0.10em;text-transform:uppercase;margin-bottom:6px;">EDIT DUE DATE</div>'
    + '<div style="font-size:13px;font-weight:700;color:var(--ink,#0a0a0a);margin-bottom:8px;">' + escHtml(rp.name) + '</div>'
    + '<input type="date" id="wjp-cal-enh-date" value="' + (rp.nextDate ? String(rp.nextDate).slice(0,10) : '') + '" style="width:100%;padding:8px 10px;border:1px solid var(--border,rgba(0,0,0,0.15));border-radius:6px;font-family:inherit;font-size:13px;color:var(--ink,#0a0a0a);background:var(--card,#fff);">'
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
      showToast('Due date for ' + rp.name + ' moved to ' + new Date(newDate + 'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'}), 'ok');
    };
  }

  // ── Statement scanner (Tesseract) ─────────────────────────────────────
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
    + '  <div style="font-size:11px;color:var(--ink-dim,#94a3b8);margin-bottom:12px;line-height:1.5;">OCR locally — looks for the bill amount or "paid"/"balance $0".</div>'
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
            showToast('Confirmed — ' + rp.name + ' marked paid + cycle advanced.', 'ok');
            try {
              if (window.WJP_PaymentStatus) {
                window.WJP_PaymentStatus.markPaidThrough(rp.id, new Date(Date.now() + 35*86400000).toISOString().slice(0,10));
                if (typeof window.WJP_PaymentStatus.advanceRecurringByOneCycle === 'function') window.WJP_PaymentStatus.advanceRecurringByOneCycle(rp.id);
              }
              if (typeof window.saveState === 'function') window.saveState();
            } catch (_) {}
            setTimeout(function () { dialog.remove(); }, 800);
          } else {
            setProg(0, '');
            showToast("Couldn't confirm payment. Try a clearer crop.", 'err');
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

  // ── AI Coach helper ───────────────────────────────────────────────────
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
    var s = getAppState();
    var pretty = date.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric', year:'numeric' });
    var evtLines = events.length ? events.map(function (r) {
      return '  • ' + r.name + ' · ' + fmtUSD(Math.abs(r.amount)) + ' · ' + (r.frequency || 'monthly');
    }).join('\n') : '  (none yet)';

    var prefix;
    if (action === 'whats_due') {
      prefix = 'Walk me through every bill due on ' + pretty + '. Use my real numbers. Tell me what to do today, in priority order.';
    } else if (action === 'conflicts') {
      prefix = 'On ' + pretty + ', do any of my bills fall before my paycheck arrives? If so, which one and what should I do?';
    } else if (action === 'reschedule') {
      prefix = 'Of the bills on ' + pretty + ', pick the one with the smallest amount and suggest a better day to move it to. Walk me through how it improves cash flow.';
    } else {
      prefix = action || 'Tell me what to do on ' + pretty + '.';
    }
    return prefix + '\n\nBills due ' + pretty + ':\n' + evtLines;
  }

  // ── Footer mount ─────────────────────────────────────────────────────
  function mountFooter() {
    try {
      var panel = document.getElementById('wjp-cal-day-panel');
      if (!panel) {
        // Panel gone → remove any leftover footer
        var stale = document.getElementById(FOOTER_ID);
        if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
        return;
      }
      // If footer already in this panel and panel hasn't been re-rendered, skip
      var existing = panel.querySelector('#' + FOOTER_ID);
      if (existing) return;
      // Remove any orphan footer outside this panel (panel re-rendered)
      var orphan = document.getElementById(FOOTER_ID);
      if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);

      var date = parseDayPanelDate();
      if (!date) return;
      var events = recurringForDay(date);

      var footer = document.createElement('div');
      footer.id = FOOTER_ID;
      footer.style.cssText = 'margin-top:14px;padding-top:14px;border-top:1px solid var(--border,rgba(0,0,0,0.06));display:flex;flex-direction:column;gap:10px;';

      var eventPickerHTML = '';
      if (events.length) {
        eventPickerHTML =
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
        + '  <div style="font-size:10px;color:var(--accent,#22c55e);font-weight:800;letter-spacing:0.10em;text-transform:uppercase;">ACTIONS · </div>'
        + '  <select id="wjp-cal-tools-pick" style="background:var(--card,#fff);color:var(--ink,#0a0a0a);border:1px solid var(--border,rgba(0,0,0,0.15));border-radius:6px;padding:5px 8px;font-family:inherit;font-size:11.5px;font-weight:600;flex:1;min-width:120px;max-width:260px;">'
        +    events.map(function (r, i) { return '<option value="' + i + '">' + escHtml(r.name) + ' · ' + fmtUSD(Math.abs(r.amount)) + '</option>'; }).join('')
        + '  </select>'
        + '  <button id="wjp-cal-tools-edit" type="button" title="Edit due date" style="background:rgba(34,197,94,0.10);color:#22c55e;border:1px solid #22c55e;padding:5px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">✎ Edit date</button>'
        + '  <button id="wjp-cal-tools-scan" type="button" title="Scan statement" style="background:rgba(167,139,250,0.10);color:#a78bfa;border:1px solid #a78bfa;padding:5px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">📄 Scan</button>'
        + '  <button id="wjp-cal-tools-ask" type="button" title="Ask AI Coach about this bill" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:5px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">💬 Ask Coach</button>'
        + '</div>';
      }

      var coachStripHTML =
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
        + '  <div style="font-size:10px;color:#a78bfa;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;">AI COACH · </div>'
        + '  <button data-q="whats_due" class="wjp-cal-tools-q" type="button" style="background:rgba(167,139,250,0.10);color:#a78bfa;border:1px solid #a78bfa;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">What\'s due here?</button>'
        + '  <button data-q="conflicts" class="wjp-cal-tools-q" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Any conflicts with my paycheck?</button>'
        + '  <button data-q="reschedule" class="wjp-cal-tools-q" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Reschedule the lightest bill</button>'
        + '</div>';

      footer.innerHTML = eventPickerHTML + coachStripHTML;
      panel.appendChild(footer);

      // Wire bill-specific actions (only if there are events)
      if (events.length) {
        var picker = footer.querySelector('#wjp-cal-tools-pick');
        function selectedRp() {
          var idx = parseInt(picker.value, 10);
          return events[idx] || events[0];
        }
        footer.querySelector('#wjp-cal-tools-edit').onclick = function () { openDateEditor(selectedRp()); };
        footer.querySelector('#wjp-cal-tools-scan').onclick = function () { openStatementScanner(selectedRp()); };
        footer.querySelector('#wjp-cal-tools-ask').onclick = function () {
          var rp = selectedRp();
          askCoach('Tell me about my "' + rp.name + '" bill (' + fmtUSD(Math.abs(rp.amount)) + ' · ' + (rp.frequency || 'monthly') + ' · next due ' + (rp.nextDate || 'unset') + '). Have I been paying it on time based on my Plaid data? Suggest any improvements.');
        };
      }

      // Wire day-level coach prompts
      footer.querySelectorAll('.wjp-cal-tools-q').forEach(function (btn) {
        btn.onclick = function () {
          var act = btn.getAttribute('data-q');
          askCoach(dayCtxPrompt(date, events, act));
        };
      });
    } catch (e) { try { console.warn('[wjp-calendar-enhancements v3] mount threw', e); } catch (_) {} }
  }

  function boot() {
    // Light, non-conflicting poll. The host calendar re-renders the panel
    // every ~2.5s; we just check if the footer is missing and add it back.
    setInterval(mountFooter, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  else setTimeout(boot, 800);

  window.WJP_CalendarEnhancements = { mountFooter: mountFooter };
})();
