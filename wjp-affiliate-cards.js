/* ============================================================================
   WJP Affiliate Cards (W6) — Balance-transfer card suggestions.
   Detects high-APR debts and surfaces balance-transfer card options with
   honest disclosure. Affiliate URLs are configurable; replace placeholders
   with your actual partner links once approved.
   ============================================================================ */
(function () {
  'use strict';
  if (window.WJP_Affiliate) return;

  // Trigger threshold — only suggest when at least one card APR >= this
  const TRIGGER_APR = 18;

  // Card catalog — replace with real partner offers.
  // Each: { name, intro, transferFee, regularApr, annualFee, referralUrl, ctaText }
  const CARDS = [
    {
      id: 'citi-double-cash',
      name: 'Citi® Double Cash',
      intro: '0% intro APR for 18 months on balance transfers',
      transferFee: '3% (or $5, whichever is greater)',
      regularApr: '18.49% – 28.49% Variable',
      annualFee: '$0',
      pros: ['Long intro APR window', 'No annual fee', 'Earn 2% cash back after transfer paid off'],
      referralUrl: 'https://wjpdebttracking.com/go/citi-double-cash', // placeholder — replace with real affiliate URL
      ctaText: 'See offer details'
    },
    {
      id: 'wells-fargo-reflect',
      name: 'Wells Fargo Reflect®',
      intro: '0% intro APR for 21 months on balance transfers (qualifying)',
      transferFee: '5% (or $5 minimum)',
      regularApr: '17.49% – 28.99% Variable',
      annualFee: '$0',
      pros: ['Longest intro APR window', 'No annual fee', 'Auto cell phone protection'],
      referralUrl: 'https://wjpdebttracking.com/go/wells-fargo-reflect',
      ctaText: 'See offer details'
    },
    {
      id: 'discover-it',
      name: 'Discover it® Balance Transfer',
      intro: '0% intro APR for 18 months on balance transfers',
      transferFee: '3% intro / 5% later',
      regularApr: '17.24% – 28.24% Variable',
      annualFee: '$0',
      pros: ['Cashback Match year 1', 'No penalty APR', 'No foreign transaction fee'],
      referralUrl: 'https://wjpdebttracking.com/go/discover-it',
      ctaText: 'See offer details'
    }
  ];

  function getHighAprDebts() {
    const debts = (window.appState && window.appState.debts) || [];
    return debts.filter(d => Number(d.apr) >= TRIGGER_APR);
  }

  function shouldSuggest() {
    return getHighAprDebts().length > 0;
  }

  function projectSavings(debt, card) {
    // Rough estimate: balance × (current APR - 0%) / 12 × intro months — transfer fee
    const balance = Number(debt.balance) || 0;
    const apr = Number(debt.apr) || 0;
    const introMonths = parseInt((card.intro.match(/(\d+)\s*month/i) || [])[1]) || 12;
    const monthlyInterest = balance * (apr / 100) / 12;
    const grossSavings = monthlyInterest * introMonths;
    const feePct = parseFloat((card.transferFee.match(/(\d+(?:\.\d+)?)\s*%/) || [])[1]) || 3;
    const fee = balance * (feePct / 100);
    return Math.max(0, Math.round(grossSavings - fee));
  }

  function renderInto(el) {
    if (!el) return;
    if (!shouldSuggest()) {
      el.innerHTML = '';
      return;
    }
    const debt = getHighAprDebts().sort((a, b) => Number(b.apr) - Number(a.apr))[0];
    const debtBal = Number(debt.balance) || 0;
    const debtApr = Number(debt.apr) || 0;

    const cards = CARDS.map(c => {
      const savings = projectSavings(debt, c);
      return `
        <div style="background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:14px;padding:20px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:10px;">
            <div>
              <h4 style="margin:0 0 4px;font-size:15px;font-weight:700;color:var(--ink,#0a0a0a);font-family:var(--sans,Inter,system-ui);">${escapeHtml(c.name)}</h4>
              <div style="font-size:13px;color:#1f7a4a;font-weight:700;">${escapeHtml(c.intro)}</div>
            </div>
            ${savings > 0 ? `<div style="text-align:right;flex-shrink:0;"><div style="font-size:11px;color:var(--ink-dim,#6b7280);text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Could save</div><div style="font-size:18px;font-weight:800;color:#1f7a4a;">$${savings.toLocaleString()}</div></div>` : ''}
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px 14px;font-size:12px;color:var(--ink-dim,#6b7280);margin-bottom:10px;">
            <div><strong style="color:var(--ink);font-weight:700;">Transfer fee:</strong> ${escapeHtml(c.transferFee)}</div>
            <div><strong style="color:var(--ink);font-weight:700;">Regular APR:</strong> ${escapeHtml(c.regularApr)}</div>
            <div><strong style="color:var(--ink);font-weight:700;">Annual fee:</strong> ${escapeHtml(c.annualFee)}</div>
          </div>
          <ul style="font-size:12px;color:var(--ink-dim,#6b7280);margin:8px 0;padding-left:18px;line-height:1.5;">${c.pros.map(p => '<li>' + escapeHtml(p) + '</li>').join('')}</ul>
          <a href="${escapeHtml(c.referralUrl)}" target="_blank" rel="noopener nofollow sponsored" style="display:inline-block;background:#1f7a4a;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;font-family:inherit;">${escapeHtml(c.ctaText)} &rarr;</a>
        </div>
      `;
    }).join('');

    el.innerHTML = `
      <div style="background:linear-gradient(135deg,rgba(31,122,74,0.06),rgba(201,154,42,0.04));border:1px solid var(--border,#e5e7eb);border-radius:16px;padding:22px;font-family:var(--sans,Inter,system-ui);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px;flex-wrap:wrap;">
          <div>
            <h3 style="font-family:var(--sans,Inter,system-ui,sans-serif);font-size:20px;margin:0 0 6px;letter-spacing:-0.02em;">Your <strong style="color:#c0594a;">${escapeHtml(debt.name||'card')}</strong> is at ${debtApr}% APR.</h3>
            <p style="margin:0;color:var(--ink-dim,#6b7280);font-size:13.5px;line-height:1.5;">A balance transfer to a 0% intro card could pause that interest. Below: 3 honest options based on your $${debtBal.toLocaleString()} balance.</p>
          </div>
          <button id="wjp-aff-dismiss" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,#d8d3c4);border-radius:8px;padding:6px 12px;font-size:11px;cursor:pointer;font-family:inherit;">Hide</button>
        </div>
        ${cards}
        <p style="font-size:10.5px;color:var(--ink-dim,#6b7280);margin:14px 0 0;line-height:1.5;border-top:1px solid var(--border,#e5e7eb);padding-top:12px;">
          <strong>Disclosure:</strong> WJP earns a commission if you open a card through these links, at no cost to you. We only show offers that mathematically benefit you given your current APRs and balance. We do NOT show cards designed to extend your debt — only cards that pause it long enough to pay it down. If you ignore the intro period and end up at the regular APR, you'll be no better off — please make sure you can pay the balance before the intro ends.
        </p>
      </div>
    `;
    const dis = document.getElementById('wjp-aff-dismiss');
    if (dis) dis.addEventListener('click', () => { el.innerHTML = ''; try { sessionStorage.setItem('wjp.affiliate.dismissed', '1'); } catch(_) {} });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function tryRender() {
    if (sessionStorage.getItem('wjp.affiliate.dismissed') === '1') return;
    const el = document.querySelector('[data-wjp-affiliate]');
    if (el) renderInto(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryRender);
  else tryRender();
  window.addEventListener('wjp:appstate:loaded', tryRender);

  window.WJP_Affiliate = { render: renderInto, getHighAprDebts, shouldSuggest, projectSavings };
})();
