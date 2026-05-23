/* wjp-credit-info-modal.js v1 — Educational info modal.
 *
 * (i) button mounted top-right of the hero. Click opens a polished modal
 * with concise explanations of:
 *   - VantageScore 3.0 vs FICO 8 (why they differ)
 *   - Score bands (Poor / Fair / Good / Very good / Exceptional)
 *   - The 3 bureaus (Equifax / Experian / TransUnion)
 *   - What affects your score (5 factors)
 *   - How utilization works + the "sweet spot"
 *
 * Public API:
 *   WJP_CreditInfoModal.open()    -> opens the modal
 *   WJP_CreditInfoModal.close()   -> closes it
 */
(function () {
  'use strict';
  if (window._wjpCreditInfoModalInstalled) return;
  window._wjpCreditInfoModalInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var MODAL_ID = 'wjp-cs-info-modal';
  var BTN_ID   = 'wjp-cs-info-btn';

  // ── Modal HTML ──────────────────────────────────────────────────────────
  function modalHTML() {
    return ''
      + '<div id="' + MODAL_ID + '-backdrop" style="'
      +   'position:fixed;inset:0;z-index:99998;'
      +   'background:rgba(0,0,0,0.45);backdrop-filter:blur(4px);'
      +   'display:flex;align-items:center;justify-content:center;padding:24px;'
      +   'animation:wjpCsFadeIn 0.2s ease;'
      + '">'
      +   '<div style="'
      +     'background:var(--card, #fff);'
      +     'border:1px solid var(--border, rgba(0,0,0,0.08));'
      +     'border-radius:16px;max-width:680px;width:100%;'
      +     'max-height:88vh;overflow-y:auto;'
      +     'padding:28px 32px;'
      +     'box-shadow:0 20px 60px rgba(0,0,0,0.30);'
      +     'animation:wjpCsSlideUp 0.25s cubic-bezier(0.4, 0, 0.2, 1);'
      +   '">'
      +     // Header
      +     '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:12px;">'
      +       '<div style="display:flex;align-items:center;gap:12px;">'
      +         '<div style="width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,#10b981,#6366f1);display:grid;place-items:center;box-shadow:0 4px 14px rgba(99,102,241,0.30);"><i class="ph-fill ph-info" style="font-size:21px;color:#fff;"></i></div>'
      +         '<div>'
      +           '<div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:#10b981;text-transform:uppercase;">How credit scores work</div>'
      +           '<h2 style="font-size:19px;font-weight:900;color:var(--text-1,#0a0a0a);margin:2px 0 0;letter-spacing:-0.01em;">Understanding your score</h2>'
      +         '</div>'
      +       '</div>'
      +       '<button type="button" data-cs-info-action="close" style="background:transparent;border:0;width:36px;height:36px;border-radius:9px;cursor:pointer;display:grid;place-items:center;color:var(--text-3,#94a3b8);font-family:inherit;" title="Close"><i class="ph ph-x" style="font-size:18px;"></i></button>'
      +     '</div>'

      +     // Section: VantageScore 3.0 vs FICO 8
      +     section('VantageScore 3.0 vs FICO 8',
      +       'Both score you 300 to 850, but they weight things differently. Most lenders use FICO 8 for decisions; VantageScore 3.0 (what we show) is widely used by Credit Karma, Experian Free, and others. Scores can differ by 10-50 points between the two models. Directionally they move together — what helps one helps the other.',
      +       'ph-scales', '#6366f1')

      +     // Section: Score bands
      +     '<div style="margin-bottom:20px;">'
      +       sectionHeader('Score bands · 300 to 850', 'ph-thermometer', '#f59e0b')
      +       bandsTable()
      +     '</div>'

      +     // Section: The 3 bureaus
      +     section('The 3 bureaus',
      +       'Equifax, Experian, and TransUnion each maintain a separate credit file on you. They can have different data (one lender may report to all 3, another to only 1). Your score at each bureau will vary slightly. Most lenders pull from one bureau when you apply.',
      +       'ph-buildings', '#a855f7')

      +     // Section: 5 factors
      +     '<div style="margin-bottom:20px;">'
      +       sectionHeader('What affects your score', 'ph-chart-pie-slice', '#10b981')
      +       factorsTable()
      +     '</div>'

      +     // Section: Utilization deep-dive
      +     section('The utilization sweet spot',
      +       'Credit utilization = balance ÷ limit. Bureaus look at both per-card AND overall utilization. Under 10% is the sweet spot — anything above 30% costs you ~10-20 points, above 50% costs ~30-60 points. The bureau sees whatever balance is on your statement closing day, so paying mid-cycle (before close) reports a lower balance even though you spent the same.',
      +       'ph-target', '#22c55e')

      +     // Footer
      +     '<div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border,rgba(0,0,0,0.06));display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">'
      +       '<span style="font-size:10.5px;color:var(--text-3,#94a3b8);font-weight:600;">VantageScore is a registered trademark of VantageScore Solutions, LLC. FICO is a registered trademark of Fair Isaac Corporation.</span>'
      +       '<button type="button" data-cs-info-action="close" style="background:var(--text-1,#0a0a0a);color:var(--card,#fff);border:0;padding:8px 18px;border-radius:9px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.02em;">Got it</button>'
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<style>'
      +   '@keyframes wjpCsFadeIn { from{opacity:0} to{opacity:1} }'
      +   '@keyframes wjpCsSlideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }'
      + '</style>';
  }

  function sectionHeader(title, icon, color) {
    return ''
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'
      +   '<i class="ph-fill ' + icon + '" style="font-size:16px;color:' + color + ';"></i>'
      +   '<h3 style="font-size:13.5px;font-weight:900;color:var(--text-1,#0a0a0a);margin:0;letter-spacing:-0.005em;">' + title + '</h3>'
      + '</div>';
  }

  function section(title, body, icon, color) {
    return ''
      + '<div style="margin-bottom:20px;">'
      +   sectionHeader(title, icon, color)
      +   '<p style="font-size:13px;color:var(--text-2,#475569);line-height:1.65;font-weight:600;margin:0;">' + body + '</p>'
      + '</div>';
  }

  function bandsTable() {
    var bands = [
      { name: 'Poor',        range: '300 – 579', color: '#ef4444', meaning: 'Few approvals · highest APRs · secured cards only' },
      { name: 'Fair',        range: '580 – 669', color: '#fbbf24', meaning: 'Some approvals · high APRs · subprime cards' },
      { name: 'Good',        range: '670 – 739', color: '#84cc16', meaning: 'Most cards · prime APRs · 0% balance transfers open up' },
      { name: 'Very good',   range: '740 – 799', color: '#22c55e', meaning: 'Best card offers · low APRs · mortgage-friendly' },
      { name: 'Exceptional', range: '800 – 850', color: '#22c55e', meaning: 'Top-tier everything · best rates available' }
    ];
    return ''
      + '<div style="border:1px solid var(--border,rgba(0,0,0,0.06));border-radius:11px;overflow:hidden;">'
      +   bands.map(function (b, i) {
            var bg = i % 2 === 0 ? 'transparent' : 'var(--card-2, rgba(0,0,0,0.02))';
            return ''
              + '<div style="display:grid;grid-template-columns:90px 100px 1fr;align-items:center;gap:12px;padding:10px 14px;background:' + bg + ';border-top:' + (i === 0 ? '0' : '1px solid var(--border,rgba(0,0,0,0.06))') + ';">'
              +   '<div style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:' + b.color + ';"></span><span style="font-size:12px;font-weight:800;color:' + b.color + ';">' + b.name + '</span></div>'
              +   '<span style="font-size:11.5px;font-weight:700;color:var(--text-1,#0a0a0a);">' + b.range + '</span>'
              +   '<span style="font-size:11.5px;color:var(--text-2,#475569);font-weight:600;">' + b.meaning + '</span>'
              + '</div>';
          }).join('')
      + '</div>';
  }

  function factorsTable() {
    var factors = [
      { name: 'Payment history',     weight: '35%', impact: 'Single biggest factor. One 30-day late drops 30-80 pts.' },
      { name: 'Credit utilization',  weight: '30%', impact: 'Balance ÷ limit. Per-card AND overall. Under 10% is ideal.' },
      { name: 'Length of history',   weight: '15%', impact: 'Average age of accounts + age of oldest. Don\'t close old cards.' },
      { name: 'Credit mix',          weight: '10%', impact: 'Revolving (cards) + installment (loans) is best. Small impact.' },
      { name: 'New credit',          weight: '10%', impact: 'Hard inquiries + new accounts in last 12 months. 2-5 pts each.' }
    ];
    return ''
      + '<div style="display:flex;flex-direction:column;gap:6px;">'
      +   factors.map(function (f) {
            return ''
              + '<div style="display:grid;grid-template-columns:140px 50px 1fr;align-items:center;gap:12px;padding:9px 12px;background:var(--card-2,rgba(0,0,0,0.02));border-radius:9px;">'
              +   '<span style="font-size:12px;font-weight:800;color:var(--text-1,#0a0a0a);">' + f.name + '</span>'
              +   '<span style="font-size:11.5px;font-weight:900;color:#10b981;">' + f.weight + '</span>'
              +   '<span style="font-size:11.5px;color:var(--text-2,#475569);font-weight:600;">' + f.impact + '</span>'
              + '</div>';
          }).join('')
      + '</div>';
  }

  // ── Open/close ──────────────────────────────────────────────────────────
  function open() {
    if (document.getElementById(MODAL_ID)) return;
    var div = document.createElement('div');
    div.id = MODAL_ID;
    div.innerHTML = modalHTML();
    document.body.appendChild(div);
    wireEvents();
  }

  function close() {
    var m = document.getElementById(MODAL_ID);
    if (m) m.remove();
  }

  function wireEvents() {
    document.querySelectorAll('[data-cs-info-action="close"]').forEach(function (btn) {
      btn.addEventListener('click', close);
    });
    var backdrop = document.getElementById(MODAL_ID + '-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) close();
      });
    }
    // ESC to close
    document.addEventListener('keydown', function escListener(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', escListener);
      }
    });
  }

  // ── (i) button injection — top-right of hero ────────────────────────────
  function injectButton() {
    var hero = document.getElementById('wjp-cs-hero-premium');
    if (!hero) return false;
    if (document.getElementById(BTN_ID)) return true;

    // The Sandbox Preview badge already sits top-right of the hero card.
    // We mount the (i) button just to the LEFT of it (or top-right if no badge).
    var heroCard = hero.querySelector('div[style*="position:relative"]');
    if (!heroCard) heroCard = hero.firstElementChild;
    if (!heroCard) return false;

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = 'How credit scores work';
    btn.setAttribute('aria-label', 'How credit scores work');
    btn.style.cssText = ''
      + 'position:absolute;top:14px;right:130px;'
      + 'width:30px;height:30px;border-radius:50%;'
      + 'background:var(--card-2, rgba(255,255,255,0.95));'
      + 'border:1px solid var(--border, rgba(0,0,0,0.10));'
      + 'cursor:pointer;display:grid;place-items:center;'
      + 'color:var(--text-2,#475569);font-family:inherit;'
      + 'box-shadow:0 2px 6px rgba(0,0,0,0.08);'
      + 'transition:transform 0.15s ease, box-shadow 0.15s ease;'
      + 'z-index:2;';
    btn.innerHTML = '<i class="ph-fill ph-info" style="font-size:16px;"></i>';
    btn.addEventListener('mouseenter', function () { btn.style.transform = 'scale(1.08)'; btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.14)'; });
    btn.addEventListener('mouseleave', function () { btn.style.transform = 'scale(1)'; btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)'; });
    btn.addEventListener('click', open);
    heroCard.appendChild(btn);
    return true;
  }

  function init() {
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (injectButton()) clearInterval(iv);
      if (attempts > 50) clearInterval(iv);
    }, 250);

    if (window.addEventListener) {
      window.addEventListener('hashchange', function () { setTimeout(injectButton, 100); });
      window.addEventListener('wjp:page-change', function () { setTimeout(injectButton, 100); });
      window.addEventListener('wjp:credit-hero-rendered', function () { setTimeout(injectButton, 50); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.WJP_CreditInfoModal = { open: open, close: close, injectButton: injectButton };
})();
