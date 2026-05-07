/* ============================================================================
   WJP i18n (W2)
   Lightweight translation framework. English default, Spanish initial second
   language. Add more languages by extending the STRINGS dictionary.

   Usage:
     1. Mark elements: <h1 data-i18n="hero.title">Default English</h1>
     2. Or programmatically: WJP_i18n.t('hero.title')
     3. User picks language in Settings → Language. Saved to localStorage.
        Defaults to navigator.language if first visit.
   ============================================================================ */
(function () {
  'use strict';
  if (window.WJP_i18n) return;

  const STORAGE_KEY = 'wjp.lang';
  const SUPPORTED = ['en', 'es'];
  const DEFAULT = 'en';

  // ---- Translation strings ----
  // Keys are dotted paths. Add new keys as needed across pages.
  // English is canonical; missing Spanish keys fall back to English.
  const STRINGS = {
    // Nav
    'nav.about':     { en: 'About',    es: 'Acerca de' },
    'nav.how':       { en: 'How',      es: 'Cómo funciona' },
    'nav.features':  { en: 'Features', es: 'Funciones' },
    'nav.pricing':   { en: 'Pricing',  es: 'Precios' },
    'nav.faq':       { en: 'FAQ',      es: 'Preguntas' },
    'nav.help':      { en: 'Help',     es: 'Ayuda' },
    'nav.signin':    { en: 'Sign in',  es: 'Iniciar sesión' },
    'nav.signup':    { en: 'Start free →', es: 'Comenzar gratis →' },

    // Hero
    'hero.title':      { en: 'Put a date on debt-free.', es: 'Pon una fecha a tu libertad financiera.' },
    'hero.cta.start':  { en: 'Start 14-day Pro Plus trial →', es: 'Iniciar prueba Pro Plus de 14 días →' },
    'hero.cta.signin': { en: 'Sign in', es: 'Iniciar sesión' },
    'hero.meta.free':  { en: '14 days of Pro Plus, free', es: '14 días de Pro Plus, gratis' },
    'hero.meta.nocard':{ en: 'No card during trial', es: 'Sin tarjeta durante la prueba' },
    'hero.meta.after': { en: '$11.99/mo Pro after', es: '$11.99/mes Pro después' },
    'hero.meta.cancel':{ en: 'Cancel anytime', es: 'Cancela cuando quieras' },

    // Footer
    'foot.privacy':  { en: 'Privacy', es: 'Privacidad' },
    'foot.terms':    { en: 'Terms', es: 'Términos' },
    'foot.about':    { en: 'About', es: 'Acerca de' },
    'foot.help':     { en: 'Help', es: 'Ayuda' },
    'foot.faq':      { en: 'FAQ', es: 'Preguntas' },
    'foot.support':  { en: 'Support', es: 'Soporte' },

    // Pricing tiers
    'tier.free':     { en: 'Free',    es: 'Gratis' },
    'tier.pro':      { en: 'Pro',     es: 'Pro' },
    'tier.plus':     { en: 'Pro Plus',es: 'Pro Plus' },

    // Settings
    'settings.language': { en: 'Language', es: 'Idioma' },
    'settings.language.help': { en: 'Choose your preferred language for the app interface.',
                                es: 'Elige tu idioma preferido para la interfaz.' },
  };

  function detectInitial() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch(_) {}
    try {
      const nav = (navigator.language || navigator.userLanguage || DEFAULT).toLowerCase();
      const root = nav.split('-')[0];
      if (SUPPORTED.indexOf(root) !== -1) return root;
    } catch(_) {}
    return DEFAULT;
  }

  let current = detectInitial();

  function t(key) {
    const entry = STRINGS[key];
    if (!entry) return key; // missing key — return raw
    return entry[current] || entry[DEFAULT] || key;
  }

  function set(lang) {
    if (SUPPORTED.indexOf(lang) === -1) return;
    current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch(_) {}
    apply();
    window.dispatchEvent(new CustomEvent('wjp:lang:changed', { detail: { lang } }));
  }

  function apply() {
    document.documentElement.setAttribute('lang', current);
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const txt = t(key);
      if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button')) {
        el.value = txt;
      } else if (el.hasAttribute('data-i18n-attr')) {
        const attr = el.getAttribute('data-i18n-attr');
        el.setAttribute(attr, txt);
      } else {
        el.textContent = txt;
      }
    });
  }

  // Auto-apply on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }

  window.WJP_i18n = {
    t: t,
    set: set,
    get: () => current,
    supported: () => SUPPORTED.slice(),
    apply: apply
  };
})();
