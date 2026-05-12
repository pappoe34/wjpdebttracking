/* wjp-calendar-enhancements.js v10 — MutationObserver remount (no flicker). */
(function () {
  'use strict';
  if (window._wjpCalEnhInstalled) return;
  window._wjpCalEnhInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var FOOTER_ID = 'wjp-cal-day-tools';

  function getAppState() { try { return (typeof appState !== 'undefined') ? appState : null; } catch (e) { return null; } }
  function fmtUSD(n) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0); }
  function escHtml(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function showToast(msg, kind) {
    try { if (typeof window.showToast === 'function') return window.showToast(msg); } catch (e) {}
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:' + (kind === 'err' ? '#ef4444' : '#1f7a4a') + ';color:#fff;padding:10px 16px;border-radius:8px;font-weight:700;z-index:99999;';
    document.body.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (e) {} }, 3000);
  }

  function parseDayPanelDate() {
    var panel = document.getElementById('wjp-cal-day-panel');
    if (!panel) return null;
    var headerEl = panel.querySelector('div[style*="font-size:14.5px"]');
    if (!headerEl) return null;
    var d = new Date((headerEl.textContent || '').trim());
    return isNaN(d.getTime()) ? null : d;
  }

  function findEventForRow(rowEl, date) {
    if (!rowEl) return null;
    var nameEl = rowEl.querySelector('span[style*="font-weight:700"]');
    if (!nameEl) return null;
    var name = (nameEl.textContent || '').replace(/[↻↑↓]/g, '').trim();
    if (!name) return null;
    var srcEl = rowEl.querySelector('span[style*="font-size:10.5px"]');
    var srcText = srcEl ? (srcEl.textContent || '').toLowerCase() : '';
    var isPlaid = srcText.indexOf('plaid') >= 0;

    var s = getAppState();
    if (s && s.recurringPayments) {
      var lo = name.toLowerCase();
      var rec = s.recurringPayments.find(function (r) { return (r.name || '').toLowerCase() === lo; });
      if (rec) return { kind: 'recurring', rp: rec, name: name, date: date };
    }

    if (isPlaid && s && s.transactions) {
      var ymd = date.toISOString().slice(0, 10);
      var amtEl = rowEl.querySelector('span[style*="white-space:nowrap"]:last-of-type');
      var amtText = amtEl ? (amtEl.textContent || '') : '';
      var amt = parseFloat(amtText.replace(/[^0-9.\-]/g, '') || '0');
      var match = s.transactions.find(function (t) {
        if (!t) return false;
        if (String(t.date).slice(0, 10) !== ymd) return false;
        var n = (t.merchant || '').toLowerCase();
        var lname = name.toLowerCase();
        if (n !== lname && n.indexOf(lname) < 0 && lname.indexOf(n.split(' ')[0] || '') < 0) return false;
        if (amt > 0 && Math.abs(Math.abs(t.amount) - amt) > 1) return false;
        return true;
      });
      return { kind: 'plaid', tx: match || null, name: name, date: date };
    }

    return { kind: 'unknown', name: name, date: date };
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
          try { window.WJP_ChatCore.send(prompt); return; } catch (e) {}
        }
        var btn = document.getElementById('chat-send-v2') || document.getElementById('chat-send');
        if (btn) btn.click();
      }, 350);
    } catch (e) {}
  }

  function openDateEditor(rp) {
    try { console.log('[wjp-cal-enh v9] openDateEditor invoked for', rp && rp.name); } catch (x) {}
    var pop = document.createElement('div');
    pop.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;';
    var isRecurring = !!(rp.frequency);
    pop.innerHTML =
      '<div style="background:var(--card,#fff);border:1px solid var(--accent,#22c55e);border-radius:12px;padding:18px;min-width:300px;max-width:380px;">' +
      '<div style="font-size:10px;color:var(--accent,#22c55e);font-weight:800;letter-spacing:0.10em;text-transform:uppercase;margin-bottom:6px;">EDIT DUE DATE</div>' +
      '<div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);margin-bottom:4px;">' + escHtml(rp.name) + '</div>' +
      '<div style="font-size:11px;color:var(--ink-dim,#94a3b8);font-weight:600;margin-bottom:12px;">' + (isRecurring ? (rp.frequency + ' recurring') : 'one-time') + '</div>' +
      '<label style="display:block;font-size:10px;color:var(--ink-dim,#94a3b8);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;">New date</label>' +
      '<input type="date" id="wjp-cal-date-inp" value="' + (rp.nextDate ? String(rp.nextDate).slice(0, 10) : '') + '" style="width:100%;padding:9px 11px;border:1px solid var(--border,rgba(0,0,0,0.15));border-radius:6px;font-family:inherit;font-size:13px;color:var(--ink,#0a0a0a);background:var(--card,#fff);">' +
      (isRecurring
        ? '<fieldset style="border:0;padding:0;margin:12px 0 0;"><legend style="font-size:10px;color:var(--ink-dim,#94a3b8);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:0;margin-bottom:6px;">Apply to</legend>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink,#0a0a0a);padding:6px 0;cursor:pointer;"><input type="radio" name="wjp-cal-scope" value="this" checked style="accent-color:#22c55e;"> Just this occurrence</label>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink,#0a0a0a);padding:6px 0;cursor:pointer;"><input type="radio" name="wjp-cal-scope" value="series" style="accent-color:#22c55e;"> This and all future (move the series)</label>' +
          '</fieldset>'
        : '<div style="font-size:11px;color:var(--ink-dim,#94a3b8);margin-top:8px;line-height:1.5;">This is a one-time entry. Saving will change the due date.</div>') +
      '<div style="display:flex;gap:8px;margin-top:14px;justify-content:space-between;align-items:center;flex-wrap:wrap;">' +
      '<button id="wjp-cal-date-delete" type="button" style="background:transparent;color:#ef4444;border:1px solid #ef4444;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Delete</button>' +
      '<div style="display:flex;gap:8px;"><button id="wjp-cal-date-cancel" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:7px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Cancel</button>' +
      '<button id="wjp-cal-date-save" type="button" style="background:var(--accent,#22c55e);color:#fff;border:0;padding:7px 18px;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;">Save</button></div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(pop);
    pop.addEventListener('click', function (e) { if (e.target === pop) pop.remove(); });
    pop.querySelector('#wjp-cal-date-cancel').onclick = function () { pop.remove(); };

    pop.querySelector('#wjp-cal-date-delete').onclick = function () {
      if (!confirm('Delete ' + rp.name + '? This removes the recurring entry from your bill list.')) return;
      try {
        var s = getAppState();
        if (s && Array.isArray(s.recurringPayments)) {
          s.recurringPayments = s.recurringPayments.filter(function (r) { return r && r.id !== rp.id; });
          if (typeof window.saveState === 'function') window.saveState();
        }
      } catch (e) {}
      pop.remove();
      showToast(rp.name + ' deleted.', 'ok');
    };

    pop.querySelector('#wjp-cal-date-save').onclick = function () {
      var newDate = pop.querySelector('#wjp-cal-date-inp').value;
      if (!newDate) { showToast('Pick a date first.', 'err'); return; }
      var scopeRadio = pop.querySelector('input[name="wjp-cal-scope"]:checked');
      var scope = scopeRadio ? scopeRadio.value : 'series';
      try {
        var s = getAppState();
        if (scope === 'this' && isRecurring) {
          // Add a per-date override on the recurring entry. Don't move the series.
          rp.dateOverrides = rp.dateOverrides || {};
          rp.dateOverrides[String(rp.nextDate).slice(0, 10)] = newDate;
        } else {
          // Move the whole series — change nextDate (anchor)
          rp.nextDate = newDate;
        }
        if (typeof window.saveState === 'function') window.saveState();
      } catch (e) {}
      pop.remove();
      var prettyDate = new Date(newDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      showToast(rp.name + ' (' + (scope === 'this' ? 'this occurrence' : 'series') + ') -> ' + prettyDate, 'ok');
    };
  }

  function openStatementScanner(rp) {
    var dialog = document.createElement('div');
    dialog.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px;';
    dialog.innerHTML =
      '<div style="background:var(--card,#fff);border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:14px;padding:18px;max-width:440px;width:100%;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      '<div><div style="font-size:9px;color:#a78bfa;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;">CONFIRM ' + escHtml(rp.name) + '</div><div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);margin-top:2px;">Upload a statement / receipt</div></div>' +
      '<button id="wjp-cal-sc-close" style="background:transparent;border:0;font-size:22px;color:var(--ink-dim,#94a3b8);cursor:pointer;">x</button>' +
      '</div>' +
      '<div id="wjp-cal-sc-drop" style="border:2px dashed var(--border,rgba(255,255,255,0.20));border-radius:12px;padding:20px;text-align:center;cursor:pointer;margin-top:8px;"><div style="font-size:24px;">Image</div><div style="font-size:12px;font-weight:700;color:var(--ink,#0a0a0a);margin-top:4px;">Click or drop an image</div><input type="file" accept="image/*" id="wjp-cal-sc-file" style="display:none;"></div>' +
      '<div style="margin-top:10px;display:flex;align-items:center;gap:10px;"><div style="flex:1;height:6px;background:var(--card-2,rgba(255,255,255,0.06));border-radius:999px;overflow:hidden;"><div class="wjp-cal-sc-bar" style="height:100%;width:0%;background:#a78bfa;transition:width 0.3s;"></div></div><div class="wjp-cal-sc-lbl" style="font-size:11px;font-weight:700;color:var(--ink-dim,#94a3b8);min-width:120px;text-align:right;"></div></div>' +
      '</div>';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.remove(); });
    dialog.querySelector('#wjp-cal-sc-close').onclick = function () { dialog.remove(); };

    function setProg(pct, text) {
      var bar = dialog.querySelector('.wjp-cal-sc-bar');
      var lbl = dialog.querySelector('.wjp-cal-sc-lbl');
      if (bar) bar.style.width = pct + '%';
      if (lbl) lbl.textContent = text || '';
    }
    function ensureTesseract() {
      return new Promise(function (res, rej) {
        if (typeof window.Tesseract !== 'undefined') return res();
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js';
        s.onload = function () { res(); };
        s.onerror = function () { rej(new Error('Tesseract CDN failed')); };
        document.head.appendChild(s);
      });
    }
    function processFile(file) {
      if (!file || !/^image\//.test((file.type || '').toLowerCase())) { showToast('Pick an image.', 'err'); return; }
      setProg(5, 'Loading OCR...');
      ensureTesseract().then(function () {
        setProg(15, 'Reading...');
        return window.Tesseract.recognize(file, 'eng', { logger: function (m) { if (m && typeof m.progress === 'number' && m.status === 'recognizing text') setProg(15 + m.progress * 75, 'Reading... ' + Math.round(m.progress * 100) + '%'); } });
      }).then(function (r) {
        var text = (r && r.data && r.data.text) || '';
        var lo = text.toLowerCase();
        var amt = Math.abs(parseFloat(rp.amount) || 0);
        var matched = false;
        if (amt > 0) {
          var nums = text.match(/\d[\d,]*\.?\d{0,2}/g) || [];
          for (var i = 0; i < nums.length; i++) {
            var v = parseFloat(nums[i].replace(/,/g, ''));
            if (isFinite(v) && Math.abs(v - amt) <= 1) { matched = true; break; }
          }
        }
        var paid = /\b(paid|payment\s+received|thank\s+you\s+for\s+your\s+payment|balance\s*[:$]?\s*\$?0\.?00?)\b/.test(lo);
        if (matched || paid) {
          setProg(100, 'Confirmed');
          showToast('Confirmed - ' + rp.name + ' marked paid + cycle advanced.', 'ok');
          try {
            if (window.WJP_PaymentStatus) {
              window.WJP_PaymentStatus.markPaidThrough(rp.id, new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10));
              if (typeof window.WJP_PaymentStatus.advanceRecurringByOneCycle === 'function') window.WJP_PaymentStatus.advanceRecurringByOneCycle(rp.id);
            }
            if (typeof window.saveState === 'function') window.saveState();
          } catch (e) {}
          setTimeout(function () { dialog.remove(); }, 800);
        } else {
          setProg(0, '');
          showToast("Couldn't confirm payment. Try a clearer crop.", 'err');
        }
      }).catch(function (e) { setProg(0, ''); showToast('OCR failed: ' + (e && e.message || 'unknown'), 'err'); });
    }
    var drop = dialog.querySelector('#wjp-cal-sc-drop');
    var file = dialog.querySelector('#wjp-cal-sc-file');
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

  function openEventDialog(hit) {
    try {
      var name = hit.name;
      var subtitle = '';
      var actionsHTML = '';
      if (hit.kind === 'recurring' && hit.rp) {
        var rp = hit.rp;
        subtitle = fmtUSD(Math.abs(rp.amount)) + ' / ' + (rp.frequency || 'monthly') + ' / next due ' + (rp.nextDate || 'unset');
        actionsHTML =
          '<button id="wjp-cal-evt-edit" type="button" style="background:rgba(34,197,94,0.10);color:#22c55e;border:1px solid #22c55e;padding:10px 14px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;text-align:left;">Edit due date<span style="display:block;font-size:10.5px;font-weight:600;color:var(--ink-dim,#94a3b8);margin-top:2px;">Change when this bill is due</span></button>' +
          '<button id="wjp-cal-evt-scan" type="button" style="background:rgba(167,139,250,0.10);color:#a78bfa;border:1px solid #a78bfa;padding:10px 14px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;text-align:left;">Scan statement<span style="display:block;font-size:10.5px;font-weight:600;color:var(--ink-dim,#94a3b8);margin-top:2px;">OCR confirms payment</span></button>' +
          '<button id="wjp-cal-evt-ask" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:10px 14px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;text-align:left;">Ask AI Coach about this bill<span style="display:block;font-size:10.5px;font-weight:600;color:var(--ink-dim,#94a3b8);margin-top:2px;">History, suggestions, tips</span></button>';
      } else if (hit.kind === 'plaid') {
        var tx = hit.tx;
        subtitle = tx ? ((tx.method || 'Plaid') + ' / ' + tx.date) : 'Plaid transaction (historical)';
        actionsHTML =
          '<button id="wjp-cal-evt-ask" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:10px 14px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;text-align:left;">Ask AI Coach about this transaction<span style="display:block;font-size:10.5px;font-weight:600;color:var(--ink-dim,#94a3b8);margin-top:2px;">Is it normal? Any pattern?</span></button>' +
          '<div style="padding:8px 12px;background:var(--card-2,rgba(255,255,255,0.04));border-radius:8px;font-size:11px;color:var(--ink-dim,#94a3b8);line-height:1.5;">Historical Plaid records cant be edited. To change the category, click the colored pill on the event row.</div>';
      } else {
        subtitle = 'Event details';
        actionsHTML = '<button id="wjp-cal-evt-ask" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:10px 14px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;text-align:left;">Ask AI Coach about this event</button>';
      }

      var dialog = document.createElement('div');
      dialog.id = 'wjp-cal-evt-dialog';
      dialog.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;';
      dialog.innerHTML =
        '<div style="background:var(--card,#fff);border:1px solid var(--accent,#22c55e);border-radius:14px;padding:18px 20px;max-width:380px;width:100%;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
        '<div><div style="font-size:9px;color:var(--accent,#22c55e);font-weight:800;letter-spacing:0.10em;text-transform:uppercase;">EVENT ACTIONS</div><div style="font-size:15px;font-weight:800;color:var(--ink,#0a0a0a);margin-top:2px;">' + escHtml(name) + '</div><div style="font-size:11px;color:var(--ink-dim,#94a3b8);font-weight:600;margin-top:2px;">' + escHtml(subtitle) + '</div></div>' +
        '<button id="wjp-cal-evt-close" style="background:transparent;border:0;font-size:22px;color:var(--ink-dim,#94a3b8);cursor:pointer;line-height:1;">x</button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">' + actionsHTML + '</div>' +
        '</div>';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.remove(); });
      dialog.querySelector('#wjp-cal-evt-close').onclick = function () { dialog.remove(); };
      if (hit.kind === 'recurring' && hit.rp) {
        var rp2 = hit.rp;
        dialog.querySelector('#wjp-cal-evt-edit').onclick = function () { try { dialog.remove(); openDateEditor(rp2); } catch (err) { try { console.error('[wjp-cal-enh v9] edit onclick threw', err); } catch (x) {} showToast('Edit failed: ' + (err && err.message || 'unknown'), 'err'); } };
        dialog.querySelector('#wjp-cal-evt-scan').onclick = function () { dialog.remove(); openStatementScanner(rp2); };
        dialog.querySelector('#wjp-cal-evt-ask').onclick = function () {
          dialog.remove();
          askCoach('Tell me about my "' + rp2.name + '" bill (' + fmtUSD(Math.abs(rp2.amount)) + ', ' + (rp2.frequency || 'monthly') + ', next due ' + (rp2.nextDate || 'unset') + '). Have I been paying it on time? Suggest improvements.');
        };
      } else if (hit.kind === 'plaid') {
        var tx2 = hit.tx;
        dialog.querySelector('#wjp-cal-evt-ask').onclick = function () {
          dialog.remove();
          var amt = tx2 ? Math.abs(parseFloat(tx2.amount)) : 0;
          askCoach('Tell me about my transaction "' + name + '" (' + (tx2 ? fmtUSD(amt) + ' on ' + tx2.date : 'Plaid record') + '). Is this normal for me?');
        };
      } else {
        dialog.querySelector('#wjp-cal-evt-ask').onclick = function () {
          dialog.remove();
          askCoach('Tell me about the event "' + name + '" on my calendar on ' + hit.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '.');
        };
      }
    } catch (e) {
      try { console.warn('[wjp-cal-enh v7] openEventDialog threw', e); } catch (x) {}
      showToast('Could not open event dialog: ' + (e && e.message || 'unknown'), 'err');
    }
  }

  function onClick(e) {
    try {
      var panel = document.getElementById('wjp-cal-day-panel');
      if (!panel || !panel.contains(e.target)) return;
      var ignore = e.target.closest('[data-cal-close], [data-cal-cat-edit], [data-cal-cat-pick], [data-cal-cat-clear], [data-cal-note], [data-cal-reminder], [data-cal-save], [data-cal-delete], #' + FOOTER_ID);
      if (ignore) return;
      var node = e.target;
      var row = null;
      while (node && node !== panel) {
        if (node.nodeType === 1 && node.querySelector && node.querySelector('[data-cal-cat-edit]')) {
          row = node;
          break;
        }
        node = node.parentNode;
      }
      if (!row) return;
      var date = parseDayPanelDate();
      if (!date) return;
      var hit = findEventForRow(row, date);
      if (!hit) return;
      e.stopPropagation();
      openEventDialog(hit);
    } catch (err) {
      try { console.warn('[wjp-cal-enh v7] click handler threw', err); } catch (e) {}
    }
  }

  function dayCtxPrompt(date, events, action) {
    var pretty = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    var evtLines = events.length ? events.map(function (r) { return '- ' + r.name + ' (' + fmtUSD(Math.abs(r.amount)) + ', ' + (r.frequency || 'monthly') + ')'; }).join('\n') : '(no scheduled bills)';
    var prefix = action;
    if (action === 'whats_due') prefix = 'Walk me through every bill due on ' + pretty + '. Use my real numbers. Tell me what to do today, in priority order.';
    else if (action === 'conflicts') prefix = 'On ' + pretty + ', do any of my bills fall before my paycheck arrives? If so which one and what should I do?';
    else if (action === 'reschedule') prefix = 'Of the bills on ' + pretty + ', pick the one with the smallest amount and suggest a better day. Walk me through how it improves cash flow.';
    else if (action === 'history') prefix = 'For each bill due on ' + pretty + ', tell me whether I have been paying it consistently based on my Plaid data over the past 90 days.';
    return prefix + '\n\nBills due ' + pretty + ':\n' + evtLines;
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
        '<details style="border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:10px;background:rgba(167,139,250,0.04);">' +
        '<summary style="cursor:pointer;list-style:none;padding:10px 14px;display:flex;align-items:center;gap:10px;font-size:12px;font-weight:800;color:#a78bfa;outline:none;">' +
        '<div style="width:24px;height:24px;border-radius:6px;background:rgba(167,139,250,0.20);display:grid;place-items:center;flex-shrink:0;"><i class="ph-fill ph-robot" style="font-size:13px;color:#a78bfa;"></i></div>' +
        '<div style="flex:1;text-align:left;">Ask AI Coach about this day</div>' +
        '<span style="font-size:14px;color:#a78bfa;">v</span>' +
        '</summary>' +
        '<div style="padding:12px 14px;border-top:1px solid var(--border,rgba(0,0,0,0.10));display:flex;flex-direction:column;gap:8px;">' +
        '<button data-q="whats_due" class="wjp-cal-tools-q" type="button" style="background:rgba(167,139,250,0.10);color:#a78bfa;border:1px solid #a78bfa;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;">Whats due here?</button>' +
        '<button data-q="conflicts" class="wjp-cal-tools-q" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;">Any conflicts with my paycheck?</button>' +
        '<button data-q="reschedule" class="wjp-cal-tools-q" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;">Reschedule the lightest bill</button>' +
        '<button data-q="history" class="wjp-cal-tools-q" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;">Have I been paying these consistently?</button>' +
        '</div>' +
        '</details>';
      panel.appendChild(footer);

      var events = recurringForDay(date);
      footer.querySelectorAll('.wjp-cal-tools-q').forEach(function (btn) {
        btn.onclick = function () { askCoach(dayCtxPrompt(date, events, btn.getAttribute('data-q'))); };
      });
    } catch (e) { try { console.warn('[wjp-cal-enh v7] mount threw', e); } catch (x) {} }
  }

  function boot() {
    document.addEventListener('click', onClick, false);

    // Initial mount attempt
    mountFooter();

    // MutationObserver: react instantly when the host renders/removes the day panel.
    // Cheap because we only call mountFooter when our footer is missing.
    try {
      var observer = new MutationObserver(function (muts) {
        var panel = document.getElementById('wjp-cal-day-panel');
        if (panel) {
          if (!panel.querySelector('#' + FOOTER_ID)) {
            mountFooter();
          }
        } else {
          var orphan = document.getElementById(FOOTER_ID);
          if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) { try { console.warn('[wjp-cal-enh v10] observer failed, falling back to interval', e); } catch (x) {} }

    // Safety-net: low-frequency check (5s) in case observer misses something.
    setInterval(mountFooter, 5000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  else setTimeout(boot, 800);

  window.WJP_CalendarEnhancements = { mountFooter: mountFooter, openEventDialog: openEventDialog, findEventForRow: findEventForRow, openDateEditor: openDateEditor };
})();
