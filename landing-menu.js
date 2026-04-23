// ============================================================
// Mobile nav menu — hamburger + full-screen overlay
// Injects a menu button on mobile, clones nav-links into an overlay.
// Runs on every landing page without needing per-page markup changes.
// ============================================================
(function(){
  const nav = document.querySelector('nav.top');
  if (!nav) return;
  const navLinks = nav.querySelector('.nav-links');
  if (!navLinks) return;

  // Menu button
  const btn = document.createElement('button');
  btn.className = 'nav-menu-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>';

  // Full-screen overlay (cloned nav-links)
  const overlay = document.createElement('div');
  overlay.className = 'nav-menu-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Navigation menu');
  overlay.innerHTML =
    '<div class="nav-menu-inner">' +
      '<div class="nav-menu-top">' +
        '<span class="nav-menu-title">Menu</span>' +
        '<button class="nav-menu-close" type="button" aria-label="Close menu">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M6 18L18 6"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="nav-menu-content"></div>' +
    '</div>';

  const content = overlay.querySelector('.nav-menu-content');
  content.innerHTML = navLinks.innerHTML;

  nav.appendChild(btn);
  document.body.appendChild(overlay);

  function open(){
    overlay.classList.add('open');
    document.body.classList.add('menu-open');
    btn.setAttribute('aria-expanded', 'true');
  }
  function close(){
    overlay.classList.remove('open');
    document.body.classList.remove('menu-open');
    btn.setAttribute('aria-expanded', 'false');
  }
  btn.addEventListener('click', open);
  overlay.querySelector('.nav-menu-close').addEventListener('click', close);
  // Tap outside inner panel closes
  overlay.addEventListener('click', function(e){
    if (e.target === overlay) close();
  });
  // Clicking any link inside the overlay closes it (before navigation)
  content.querySelectorAll('a').forEach(function(a){
    a.addEventListener('click', close);
  });
  // Esc to close
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && overlay.classList.contains('open')) close();
  });
})();
