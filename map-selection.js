/* Suggerimento desktop: 10 secondi sulla mappa, poi etichetta accanto al cursore. */
(() => {
  'use strict';
  let timer = null, active = false, ready = false, pointer = null;
  let map, notice, tooltip, stage;
  function positionTooltip() {
    if (!tooltip) return;
    tooltip.hidden = true;
    if (!active || !ready || !pointer || !addMode || map.classList.contains('dragging')) return;
    const hit = document.elementFromPoint(pointer.x, pointer.y);
    if (!hit || !map.contains(hit) || hit.closest('button,[role="dialog"]')) return;
    const rect = map.getBoundingClientRect();
    tooltip.hidden = false;
    tooltip.style.left = Math.max(4, Math.min(pointer.x - rect.left + 18, rect.width - tooltip.offsetWidth - 6)) + 'px';
    tooltip.style.top = Math.max(4, Math.min(pointer.y - rect.top + 20, rect.height - tooltip.offsetHeight - 6)) + 'px';
  }
  window.clearMapSelectionInstruction = function () {
    clearTimeout(timer); timer = null; active = false; ready = false;
    if (notice) notice.hidden = true;
    if (tooltip) tooltip.hidden = true;
    stage?.classList.remove('hasMapSelectionNotice');
    if (map?.getAttribute('aria-describedby') === 'mapSelectionCursor') map.removeAttribute('aria-describedby');
  };
  window.showMapSelectionInstruction = function () {
    clearMapSelectionInstruction();
    active = true;
    notice.hidden = false;
    stage.classList.add('hasMapSelectionNotice');
    timer = setTimeout(() => {
      notice.hidden = true;
      stage.classList.remove('hasMapSelectionNotice');
      ready = true;
      map.setAttribute('aria-describedby', 'mapSelectionCursor');
      positionTooltip();
    }, 10000);
  };
  document.addEventListener('DOMContentLoaded', () => {
    map = document.getElementById('map'); stage = map.closest('.stage');
    notice = document.createElement('div'); notice.id = 'mapSelectionNotice'; notice.setAttribute('role', 'status'); notice.hidden = true;
    notice.textContent = 'Seleziona il punto sulla mappa per aggiungere l’albero. Premi “Annulla selezione” per uscire.';
    stage.appendChild(notice);
    tooltip = document.createElement('div'); tooltip.id = 'mapSelectionCursor'; tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true;
    tooltip.textContent = 'Seleziona albero'; map.appendChild(tooltip);
    map.addEventListener('pointermove', event => { pointer = {x: event.clientX, y: event.clientY}; positionTooltip(); });
    map.addEventListener('pointerenter', event => { pointer = {x: event.clientX, y: event.clientY}; positionTooltip(); });
    map.addEventListener('pointerleave', () => { pointer = null; tooltip.hidden = true; });
    map.addEventListener('pointerdown', () => { tooltip.hidden = true; });
    document.addEventListener('scroll', () => { tooltip.hidden = true; }, true);
    window.addEventListener('resize', () => { tooltip.hidden = true; });
  });
})();
