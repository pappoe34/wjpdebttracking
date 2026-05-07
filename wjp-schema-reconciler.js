/* ============================================================================
   WJP Schema Reconciler (W2)
   Runtime auto-fixes JSON-LD inconsistencies before search engines see them.
   - Normalizes brand name to "WJP Debt Tracking" everywhere
   - Ensures pricing offers match canonical values ($11.99 Pro, $24.99 Pro Plus)
   - Fixes any leftover "Budgetting" / "Budgeting" typos in structured data
   This runs CLIENT-SIDE on page load. Search crawlers using JS rendering
   (Googlebot, Bingbot) will see the corrected data.
   ============================================================================ */
(function () {
  'use strict';

  const CANONICAL_NAME = 'WJP Debt Tracking';
  const CANONICAL_PRICES = {
    'Free': '0',
    'Pro Monthly': '11.99',
    'Pro Yearly': '99.00',
    'Pro Plus Monthly': '24.99',
    'Pro Plus Yearly': '199.00'
  };

  function normalize(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.map(normalize);
    }
    Object.keys(obj).forEach(k => {
      const v = obj[k];
      if (typeof v === 'string') {
        // Brand normalization
        let s = v.replace(/WJP Budgett?ing/g, CANONICAL_NAME);
        // Standalone (in brand contexts)
        if (k === 'name' && (s === 'WJP Budgetting' || s === 'WJP Budgeting' || s === 'Budgetting' || s === 'Budgeting')) {
          s = CANONICAL_NAME;
        }
        obj[k] = s;
      } else if (typeof v === 'object') {
        // Pricing offers normalization
        if (v && v['@type'] === 'Offer' && v.name && CANONICAL_PRICES[v.name]) {
          v.price = CANONICAL_PRICES[v.name];
          v.priceCurrency = 'USD';
        }
        normalize(v);
      }
    });
    return obj;
  }

  function reconcile() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach(s => {
      try {
        const orig = s.textContent;
        const data = JSON.parse(orig);
        const fixed = normalize(data);
        const out = JSON.stringify(fixed, null, 2);
        if (out !== orig) {
          s.textContent = out;
          // Optional: dispatch event for monitoring
          if (window.console && console.debug) console.debug('[schema] reconciled', s);
        }
      } catch(_) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reconcile);
  } else {
    reconcile();
  }

  window.WJP_SchemaReconciler = { run: reconcile };
})();
