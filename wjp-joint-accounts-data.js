/* ============================================================================
   WJP Joint Accounts Data Layer (W5)
   Phase 1: solo-managed partner debts (no real partner auth/sync yet).
   User enters partner's debts under a separate "partner" namespace.
   When view='joint', merge own debts + partner debts for display.

   appState shape extension:
     appState.partnerDebts = []   // mirror of debts[] structure with attribution
     appState.partnerIncome = []  // mirror of income[]

   Listens for wjp:joint:viewchanged event (from W2 module) and dispatches
   wjp:debts:merged with the merged dataset.
   ============================================================================ */
(function () {
  'use strict';
  if (window.WJP_JointData) return;

  const PARTNER_KEY = 'wjp.partner.data.v1';

  function loadPartner() {
    try { return JSON.parse(localStorage.getItem(PARTNER_KEY) || '{}'); }
    catch(_) { return {}; }
  }
  function savePartner(data) {
    try { localStorage.setItem(PARTNER_KEY, JSON.stringify(data)); } catch(_) {}
  }

  function mergedDebts() {
    const own = (window.appState && window.appState.debts) || [];
    const p = loadPartner();
    const partner = (p.debts || []).map(d => Object.assign({}, d, {
      _attribution: 'partner',
      _ownerName: p.partnerName || 'Partner',
      id: 'p_' + (d.id || Math.random().toString(36).slice(2, 8))
    }));
    const ownTagged = own.map(d => Object.assign({}, d, {
      _attribution: 'self',
      _ownerName: 'You'
    }));
    return [...ownTagged, ...partner];
  }

  function mergedIncome() {
    const own = (window.appState && window.appState.income) || [];
    const p = loadPartner();
    const partner = (p.income || []).map(i => Object.assign({}, i, {
      _attribution: 'partner', _ownerName: p.partnerName || 'Partner'
    }));
    return [...own.map(i => Object.assign({}, i, { _attribution: 'self' })), ...partner];
  }

  function addPartnerDebt(debt) {
    const p = loadPartner();
    if (!p.debts) p.debts = [];
    p.debts.push(Object.assign({ id: 'pd_' + Date.now() }, debt));
    savePartner(p);
    fireUpdate();
  }
  function removePartnerDebt(id) {
    const p = loadPartner();
    if (!p.debts) return;
    p.debts = p.debts.filter(d => d.id !== id);
    savePartner(p);
    fireUpdate();
  }
  function setPartnerName(name) {
    const p = loadPartner();
    p.partnerName = name;
    savePartner(p);
    fireUpdate();
  }

  function fireUpdate() {
    window.dispatchEvent(new CustomEvent('wjp:debts:merged', {
      detail: { debts: mergedDebts(), income: mergedIncome(), view: getView() }
    }));
  }

  function getView() {
    if (!window.WJP_Joint) return 'individual';
    if (!window.WJP_Joint.isEnabled() || !window.WJP_Joint.isAuthorized()) return 'individual';
    return window.WJP_Joint.view();
  }

  // Listen for view changes from W2 toggle
  window.addEventListener('wjp:joint:viewchanged', () => {
    fireUpdate();
    // Optional: trigger app-level re-render
    if (typeof window.renderApp === 'function') window.renderApp();
    if (typeof window.refreshDashboard === 'function') window.refreshDashboard();
  });

  window.WJP_JointData = {
    loadPartner, savePartner,
    mergedDebts, mergedIncome,
    addPartnerDebt, removePartnerDebt,
    setPartnerName,
    getView
  };
})();
