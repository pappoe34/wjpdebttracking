// wjp-analytics.js — lightweight client helper for WJP event tracking.
// Single global: window.wjp.track(event, props)
//
// - Auto-fires `page_view` on load
// - Attaches an anonymous UUID (localStorage) and a session UUID (sessionStorage)
//   so we can build funnels for users BEFORE they sign up
// - If Firebase Auth is present and a user is signed in, includes their ID token
//   so the server enriches the event with uid/email
// - Sends events via navigator.sendBeacon where possible (survives navigation)
// - Silently drops errors — analytics must never break the app
(function(){
  'use strict';

  var ENDPOINT = '/.netlify/functions/log-event';
  var ANON_KEY = 'wjp_anon_id';
  var SESS_KEY = 'wjp_session_id';

  function uuid(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getAnonId(){
    try {
      var id = localStorage.getItem(ANON_KEY);
      if (!id) { id = uuid(); localStorage.setItem(ANON_KEY, id); }
      return id;
    } catch(e) { return null; }
  }
  function getSessionId(){
    try {
      var id = sessionStorage.getItem(SESS_KEY);
      if (!id) { id = uuid(); sessionStorage.setItem(SESS_KEY, id); }
      return id;
    } catch(e) { return null; }
  }

  function getIdTokenOrNull(){
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        return firebase.auth().currentUser.getIdToken().catch(function(){ return null; });
      }
    } catch(e) {}
    return Promise.resolve(null);
  }

  function send(payload, token){
    var url = ENDPOINT;
    var body = JSON.stringify(payload);

    // Prefer sendBeacon when no auth header is needed (survives page unload)
    if (!token && navigator.sendBeacon) {
      try {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return;
      } catch(e) {}
    }
    // Fallback: fetch with keepalive
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    fetch(url, { method: 'POST', headers: headers, body: body, keepalive: true })
      .catch(function(){});
  }

  function track(event, props){
    try {
      var payload = {
        event: event,
        anon_id: getAnonId(),
        session_id: getSessionId(),
        page: location.pathname + (location.search || ''),
        referrer: document.referrer || null,
        viewport: (window.innerWidth || 0) + 'x' + (window.innerHeight || 0),
        props: props || {}
      };
      var tokenPromise = getIdTokenOrNull();
      if (tokenPromise && tokenPromise.then) {
        tokenPromise.then(function(t){ send(payload, t || null); });
      } else {
        send(payload, null);
      }
    } catch(e) { /* analytics must never throw */ }
  }

  // Expose
  window.wjp = window.wjp || {};
  window.wjp.track = track;

  // Auto page_view on load (debounced so client-side nav only fires once)
  var _lastPath = null;
  function firePageView(){
    var p = location.pathname;
    if (_lastPath === p) return;
    _lastPath = p;
    track('page_view', {
      title: (document.title || '').slice(0, 120)
    });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(firePageView, 0);
  } else {
    document.addEventListener('DOMContentLoaded', firePageView);
  }

  // If the app uses history.pushState for tab navigation, also re-fire.
  window.addEventListener('popstate', firePageView);
})();
