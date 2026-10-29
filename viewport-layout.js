/* Presentazione: mantiene i dialoghi nello spazio visibile del browser. */
(() => {
  'use strict';
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let pending = false;

  function update() {
    pending = false;
    root.style.setProperty('--dialog-viewport-height', (viewport ? viewport.height : window.innerHeight) + 'px');
    root.style.setProperty('--dialog-viewport-width', (viewport ? viewport.width : window.innerWidth) + 'px');
    root.style.setProperty('--dialog-viewport-top', (viewport ? viewport.offsetTop : 0) + 'px');
    root.style.setProperty('--dialog-viewport-left', (viewport ? viewport.offsetLeft : 0) + 'px');
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(update);
  }

  if (viewport) {
    viewport.addEventListener('resize', schedule, {passive: true});
    viewport.addEventListener('scroll', schedule, {passive: true});
  }
  window.addEventListener('resize', schedule, {passive: true});
  window.addEventListener('orientationchange', schedule, {passive: true});
  update();
})();
