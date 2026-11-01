/* Navigazione della guida: nessuna lettura o scrittura dell'archivio. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    const guide = document.getElementById('viewGuida');
    guide.addEventListener('click', event => {
      const shortcut = event.target.closest('[data-guide-section]');
      if (shortcut) {
        const section = document.getElementById(shortcut.dataset.guideSection);
        section.scrollIntoView({block: 'start'});
        section.focus({preventScroll: true});
      }
      const navigation = event.target.closest('[data-guide-view]');
      if (navigation) switchSection(navigation.dataset.guideView);
    });
    for (const label of guide.querySelectorAll('[data-guide-label]')) {
      const button = document.getElementById(label.dataset.guideLabel);
      if (button) label.textContent = button.textContent.trim().replace(/^[✓↻＋▤◈⌖▥▣⚙▧\s]+/, '');
    }
  });
})();
