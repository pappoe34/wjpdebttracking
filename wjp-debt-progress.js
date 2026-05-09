/* wjp-debt-progress.js v2 — animated progress bars by debt type, on the
 * Dashboard.
 *
 * Groups appState.debts into the categories Winston cares about:
 *   - Total debt destroyed (paid)
 *   - Credit cards
 *   - Student loans
 *   - Private / personal loans
 *   - Pay later (Affirm, Klarna, Afterpay, Sezzle, Zip)
 *   - Car loans
 *   - Home (mortgage)
 *
 * Only renders rows for types the user has at least one debt in. No
 * subscriptions, utilities, or recurring bills are shown — this widget is
 * strictly about debts. Container is scrollable when contents overflow.
 *
 * Mounted on the Dashboard page, just below Executive Summary.
 */
(function () {
  'use strict';
  if (window._wjpDebtProgressInstalled) return;
  window._wjpDebtProgressInstalled = true;

  if (location.pathname && location.pathname !== '/' &&
      !/index\.html?$/.test(location.pathname)) return;

  var WRAP_ID = 'wjp-debt-progress-wrap';

  function fmtUSD(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
  }

  // Classify a single debt into one of the buckets we render.
  function bucketize(d) {
    var n = String(d.name || '').toLowerCase();
    var t = String(d.type || d.category || '').toLowerCase();

    // Pay-later (BNPL) — must come BEFORE generic credit-card check because
    // some BNPLs also have "card" in the name.
    if (/\b(affirm|klarna|afterpay|sezzle|\bzip\b|paypal\s+pay\s+in\s+4)\b/.test(n)) return 'paylater';

    // Home / Mortgage
    if (/\b(mortgage|home\s+loan|house)\b/.test(n) || /mortgage|home/.test(t)) return 'home';

    // Car
    if (/\b(westlake|ally\s+auto|chase\s+auto|carmax|capital\s+one\s+auto|toyota\s+financial|honda\s+financial|gm\s+financial|ford\s+credit|nissan\s+motor)\b/.test(n)) return 'car';
    if (/\b(auto|car|vehicle)\b/.test(t)) return 'car';

    // Student loans
    if (/\b(sofi|aidadvantage|navient|nelnet|mohela|edfinancial|firstmark|great\s+lakes|sallie\s+mae)\b/.test(n)) return 'student';
    if (/student/.test(t) || /student/.test(n)) return 'student';

    // Credit cards (broad)
    if (/credit/.test(t) || /\bcard\b/.test(t) || t === 'cc') return 'creditcard';
    if (/\b(visa|mastercard|amex|discover)\b/.test(n)) return 'creditcard';
    if (/\b(capital\s+one|chase|citi|bank\s+of\s+america|bofa|wells\s+fargo|amex|barclays|synchrony|comenity|brightway|milestone|credit\s+one|concora|aspire|merrick|first\s+premier)\b/.test(n)) return 'creditcard';

    // Personal / private loan (catch-all for anything still tagged as a loan)
    if (/loan/.test(t) || /personal/.test(t) || /\bone\s+main\b/.test(n) || /\bavant\b/.test(n) || /\bupstart\b/.test(n) || /\blendingclub\b/.test(n) || /\bprosper\b/.test(n) || /\bbest\s+egg\b/.test(n)) return 'personal';

    return null; // skip — likely a subscription / non-debt
  }

  var BUCKET_META = {
    creditcard: { label: 'Credit cards',   color: '#ef4444', icon: '💳' },
    student:    { label: 'Student loans',  color: '#8b5cf6', icon: '🎓' },
    personal:   { label: 'Personal loans', color: '#0ea5e9', icon: '🏦' },
    paylater:   { label: 'Pay later',      color: '#f97316', icon: '🛒' },
    car:        { label: 'Car loans',      color: '#22c55e', icon: '🚗' },
    home:       { label: 'Home',           color: '#a78bfa', icon: '🏠' }
  };

  function compute() {
    var debts = []; try { if (typeof appState !== 'undefined' && appState && Array.isArray(appState.debts)) debts = appState.debts; } catch (_) {}
    var byBucket = {};
    var totalOrig = 0, totalCurr = 0;

    debts.forEach(function (d) {
      var bucket = bucketize(d);
      if (!bucket) return;
      var orig = parseFloat(d.originalBalance);
      if (!isFinite(orig) || orig <= 0) orig = parseFloat(d.balance) || 0;
      var curr = parseFloat(d.balance) || 0;
      if (!byBucket[bucket]) byBucket[bucket] = { orig: 0, curr: 0, count: 0 };
      byBucket[bucket].orig  += orig;
      byBucket[bucket].curr  += curr;
      byBucket[bucket].count += 1;
      totalOrig += orig;
      totalCurr += curr;
    });

    var rows = Object.keys(byBucket).map(function (k) {
      var b = byBucket[k];
      var paid = Math.max(0, b.orig - b.curr);
      var pct = b.orig > 0 ? Math.min(100, (paid / b.orig) * 100) : 0;
      return {
        key: k,
        label: BUCKET_META[k].label,
        color: BUCKET_META[k].color,
        icon: BUCKET_META[k].icon,
        count: b.count,
        paid: paid,
        owed: b.curr,
        original: b.orig,
        pct: pct
      };
    });

    // Sort: more paid (higher %) first to give a sense of progress
    rows.sort(function (a, b) { return b.pct - a.pct; });

    var totalPaid = Math.max(0, totalOrig - totalCurr);
    var totalPct = totalOrig > 0 ? Math.min(100, (totalPaid / totalOrig) * 100) : 0;

    return { totalPaid: totalPaid, totalOwed: totalCurr, totalOrig: totalOrig, totalPct: totalPct, rows: rows };
  }

  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function rowHTML(r) {
    return ''
      + '<div class="wjp-dp-row" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--rule, rgba(255,255,255,0.06));">'
      +   '<div style="font-size:18px;flex-shrink:0;width:24px;text-align:center;">' + r.icon + '</div>'
      +   '<div style="flex:1;min-width:0;">'
      +     '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">'
      +       '<div style="font-weight:700;font-size:13px;color:var(--ink, #0a0a0a);">' + escHtml(r.label) + ' <span style="font-weight:600;font-size:11px;color:var(--ink-faint, #94a3b8);margin-left:4px;">' + r.count + '</span></div>'
      +       '<div style="font-size:12px;color:var(--ink-dim, #94a3b8);font-weight:600;">' + fmtUSD(r.owed) + ' left · ' + r.pct.toFixed(0) + '% paid</div>'
      +     '</div>'
      +     '<div style="position:relative;height:8px;background:var(--card-2, rgba(255,255,255,0.06));border-radius:999px;overflow:hidden;">'
      +       '<div class="wjp-dp-bar" data-target="' + r.pct.toFixed(2) + '" '
      +         'style="position:absolute;left:0;top:0;bottom:0;width:0%;background:' + r.color + ';border-radius:999px;'
      +         'transition:width 1.4s cubic-bezier(0.22,0.61,0.36,1);"></div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function findHost() {
    var dash = document.getElementById('page-dashboard');
    if (!dash) return null;
    // v2: search broader for an anchor near the top of the dashboard. Try
    // executive summary by data attr, then by text content, then fall back
    // to the first major card on the page.
    var es = dash.querySelector('[data-card-id="executive"], #dash-executive-card, [data-card-id="exec"], [id*="executive-summary"], [class*="executive-summary"]');
    if (!es) {
      // Walk children looking for one whose text starts with "executive summary"
      var cards = dash.querySelectorAll('.card, [class*="card"]');
      for (var i = 0; i < cards.length; i++) {
        var t = (cards[i].textContent || '').trim().toLowerCase();
        if (t.indexOf('executive summary') === 0 || t.indexOf("you'll be debt-free") >= 0) { es = cards[i]; break; }
      }
    }
    if (!es) {
      // Last resort: anchor before the spending tracker card
      es = dash.querySelector('#dash-spending-card, [data-card-id="spending"]');
    }
    return { dash: dash, anchor: es };
  }

  function render() {
    try {
      if (!window.appState || !Array.isArray(window.appState.debts)) return;
      var host = findHost();
      if (!host || !host.dash) return;
      var data = compute();
      if (!data.rows.length) {
        // Hide the widget if user has no qualifying debts
        var prev = document.getElementById(WRAP_ID);
        if (prev) prev.remove();
        return;
      }

      var rowsHTML = data.rows.map(rowHTML).join('');

      var html =
        '<div id="' + WRAP_ID + '" '
        +   'style="background:var(--card, rgba(255,255,255,0.02));border:1px solid var(--border, rgba(255,255,255,0.08));'
        +     'border-radius:14px;padding:16px 18px;margin:14px 0;font-family:var(--sans, Inter, system-ui, sans-serif);">'
        +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
        +     '<div>'
        +       '<div style="font-size:9px;color:#22c55e;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;">DEBT PROGRESS</div>'
        +       '<div style="font-size:18px;font-weight:900;color:var(--ink, #0a0a0a);margin-top:2px;">'
        +         fmtUSD(data.totalPaid) + ' destroyed · '
        +         '<span style="color:#22c55e;">' + data.totalPct.toFixed(0) + '%</span>'
        +       '</div>'
        +       '<div style="font-size:11px;color:var(--ink-dim, #94a3b8);font-weight:600;">'
        +         fmtUSD(data.totalOwed) + ' left across ' + data.rows.length + ' categor' + (data.rows.length === 1 ? 'y' : 'ies')
        +       '</div>'
        +     '</div>'
        +     '<div style="position:relative;width:64px;height:64px;flex-shrink:0;">'
        +       '<svg viewBox="0 0 36 36" style="width:64px;height:64px;transform:rotate(-90deg);">'
        +         '<circle cx="18" cy="18" r="15" fill="none" stroke="var(--card-2, rgba(255,255,255,0.08))" stroke-width="3"></circle>'
        +         '<circle id="wjp-dp-ring" cx="18" cy="18" r="15" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 100" style="transition:stroke-dasharray 1.4s cubic-bezier(0.22,0.61,0.36,1);" data-target="' + data.totalPct.toFixed(2) + '"></circle>'
        +       '</svg>'
        +       '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:var(--ink, #0a0a0a);">' + data.totalPct.toFixed(0) + '%</div>'
        +     '</div>'
        +   '</div>'
        +   '<div style="max-height:280px;overflow-y:auto;padding-right:4px;">'
        +     rowsHTML
        +   '</div>'
        + '</div>';

      var existing = document.getElementById(WRAP_ID);
      if (existing) {
        existing.outerHTML = html;
      } else {
        var div = document.createElement('div');
        div.innerHTML = html;
        var node = div.firstChild;
        if (host.anchor && host.anchor.parentNode) {
          // Walk up until anchor is a direct child of dash
          var ref = host.anchor;
          while (ref.parentNode && ref.parentNode !== host.dash) ref = ref.parentNode;
          if (ref.parentNode === host.dash) {
            if (ref.nextSibling) host.dash.insertBefore(node, ref.nextSibling);
            else host.dash.appendChild(node);
          } else {
            host.dash.insertBefore(node, host.dash.firstChild);
          }
        } else {
          // No anchor — prepend
          if (host.dash.firstChild) host.dash.insertBefore(node, host.dash.firstChild);
          else host.dash.appendChild(node);
        }
      }

      // Animate the bars in
      requestAnimationFrame(function () {
        document.querySelectorAll('#' + WRAP_ID + ' .wjp-dp-bar').forEach(function (bar) {
          var target = parseFloat(bar.getAttribute('data-target')) || 0;
          bar.style.width = target.toFixed(2) + '%';
        });
        var ring = document.getElementById('wjp-dp-ring');
        if (ring) {
          var t = parseFloat(ring.getAttribute('data-target')) || 0;
          ring.setAttribute('stroke-dasharray', t.toFixed(2) + ' ' + (100 - t).toFixed(2));
        }
      });
    } catch (e) { try { console.warn('[wjp-debt-progress] threw', e); } catch (_) {} }
  }

  function whenReady(fn) {
    function ready(){ try { return typeof appState !== 'undefined' && appState && Array.isArray(appState.debts); } catch(_) { return false; } } if (ready()) return fn();
    var tries = 0;
    var iv = setInterval(function () {
      if (ready()) {
        clearInterval(iv); fn();
      } else if (++tries > 40) clearInterval(iv);
    }, 500);
  }

  function boot() {
    whenReady(render);
    // Re-render on debt changes (every 5s polled — cheap)
    setInterval(render, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 700); });
  } else {
    setTimeout(boot, 700);
  }

  window.WJP_DebtProgress = { render: render, compute: compute };
})();
