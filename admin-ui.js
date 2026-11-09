/* Amministrazione: una password all'ingresso, selezione multipla e cestino. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), overlay = $('adminOverlay');
  const trashKey = 'LesmoAdminV2Trash', auditKey = 'LesmoAdminV2Audit';
  let logged = false, busy = false, limit = 100, previousInert = false;
  const selection = new Set();
  window.isMunicipalAdmin=()=>logged&&overlay.classList.contains('open');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const normalized = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it-IT');
  const clone = value => structuredClone(value);
  function read(key) {
    const raw = localStorage.getItem(key);
    if (raw == null) return [];
    try { const data = JSON.parse(raw); if (Array.isArray(data)) return data; } catch (_) {}
    throw Error('Non riesco a leggere le copie conservate in questo browser. Nessun dato è stato sostituito.');
  }
  const write = (key, data) => localStorage.setItem(key, JSON.stringify(data));
  function message(text = '', error = false) { $('adminStatus').textContent = text; $('adminStatus').classList.toggle('error', error); }
  function matchingTrees() {
    const search = normalized($('adminTreeSearch').value);
    return trees.filter(tree => !search || normalized([publicCode(tree), tree.species, tree.address].join(' ')).includes(search));
  }
  function updateSelection() {
    const available = new Set(trees.map(tree => tree.id));
    for (const id of selection) if (!available.has(id)) selection.delete(id);
    const matches = matchingTrees(), selectedMatches = matches.filter(tree => selection.has(tree.id)).length;
    $('adminSelectAll').checked = matches.length > 0 && selectedMatches === matches.length;
    $('adminSelectAll').indeterminate = selectedMatches > 0 && selectedMatches < matches.length;
    $('adminSelectAll').disabled = busy || !matches.length;
    $('adminSelectAllText').textContent = 'Seleziona tutti i risultati (' + matches.length + ')';
    $('adminTreeSelect').value = selection.size === 1 ? [...selection][0] : '';
    $('adminSelectionCount').textContent = selection.size ? selection.size + (selection.size === 1 ? ' albero selezionato' : ' alberi selezionati') : 'Nessun albero selezionato';
    $('adminSelectionCount').hidden = selection.size < 2;
    $('adminDeleteTree').textContent = selection.size > 1 ? 'Rimuovi ' + selection.size + ' alberi per errore' : 'Rimuovi albero per errore';
    $('adminDeleteTree').disabled = busy || !logged || !selection.size || !folderHandle;
    $('adminClearSelection').disabled = busy || !selection.size;
    for (const input of $('adminTreeList').querySelectorAll('[data-admin-tree]')) input.checked = selection.has(input.dataset.adminTree);
  }
  function renderTrees() {
    const matches = matchingTrees();
    $('adminTreeSelect').innerHTML = '<option value="">Seleziona un albero</option>' + trees.map(tree => `<option value="${escape(tree.id)}">${escape(publicCode(tree))} · ${escape(tree.species || 'Specie non indicata')}</option>`).join('');
    $('adminTreeList').innerHTML = matches.slice(0, limit).map(tree => `<label class="adminTreeRow"><input type="checkbox" data-admin-tree="${escape(tree.id)}" ${selection.has(tree.id) ? 'checked' : ''} ${busy ? 'disabled' : ''}><span><b>${escape(publicCode(tree))} · ${escape(tree.species || 'Specie non indicata')}</b><em>${escape(tree.address || 'Località non indicata')}</em></span></label>`).join('') || '<p class="adminEmpty">' + (trees.length ? 'Nessun albero corrisponde alla ricerca.' : 'Non ci sono alberi nell’archivio.') + '</p>';
    $('adminShowMore').hidden = matches.length <= limit;
    $('adminShowMore').textContent = 'Mostra altri alberi (' + Math.min(matches.length, limit) + ' di ' + matches.length + ' visibili)';
    updateSelection();
  }
  function renderRecords() {
    const trash = read(trashKey);
    $('adminTrashList').innerHTML = trash.map((entry, index) => {
      if (!isTree(entry?.tree)) return '<p class="adminLead">Una voce del cestino non è leggibile. La copia resta conservata.</p>';
      return `<div class="adminRecord"><b>${escape(publicCode(entry.tree))}</b><small>${escape(entry.pending ? 'Salvataggio da verificare · ' : '')}${escape(entry.reason || '')} · ${escape(entry.when ? new Date(entry.when).toLocaleString('it-IT') : 'Data non disponibile')}</small><button type="button" class="btn muted" data-restore="${escape(entry.trashId || 'legacy-' + index)}" data-restore-tree="${escape(entry.tree.id)}" ${busy ? 'disabled' : ''}>Ripristina</button></div>`;
    }).join('') || '<p class="adminLead">Il cestino è vuoto.</p>';
    try {
      $('adminAuditList').innerHTML = read(auditKey).slice(-20).reverse().map(entry => `<div class="adminRecord"><b>${escape(entry?.action)} · ${escape(entry?.id)}</b><small>${escape(entry?.when ? new Date(entry.when).toLocaleString('it-IT') : '')}</small></div>`).join('') || '<p class="adminLead">Nessuna correzione registrata.</p>';
    } catch (_) { $('adminAuditList').textContent = 'Il registro delle correzioni non è disponibile in questo browser.'; }
  }
  function render() {
    if (!logged) return;
    renderTrees();
    try { renderRecords(); } catch (error) { message(error.message, true); }
  }
  function setBusy(value) {
    busy = value;
    for (const control of $('adminContent').querySelectorAll('input,select,textarea,button')) control.disabled = value;
    $('adminClose').disabled = value;
    updateSelection();
  }
  function lock() {
    logged = false; selection.clear();
    $('adminContent').classList.add('hidden'); $('adminLogin').classList.remove('hidden');
    $('adminPassword').value = ''; $('adminLoginError').classList.add('hidden');
    $('adminTreeSearch').value = ''; limit = 100; message();
    $('adminDeleteBulkDetails').open = false; $('adminDeleteReason').value = ''; $('adminDeleteNote').value = '';
  }
  function hide() {
    if (busy) return;
    overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); lock();
    $('app').inert = previousInert; $('adminOpen').focus();
  }
  function preflight() {
    if (!folderHandle) throw Error('Apri l’archivio prima di modificare gli alberi.');
    if (window.municipalBusy || quickBusy || v2AnagBusy || backupInProgress || (v2SelectedId && $('v2CensusSave').disabled && v21SurveyStaged.length)) throw Error('Attendi che il salvataggio delle foto o della copia di sicurezza sia terminato.');
    if (document.body.classList.contains('driveConnected') && $('syncStatus').classList.contains('error')) throw Error('L’app segnala modifiche non salvate. Conserva una copia e aggiorna i dati prima di riprovare.');
  }
  function rememberState() { return {trees, historyEvents, photos, seq, lastSaved}; }
  function restoreState(state) { ({trees, historyEvents, photos, seq, lastSaved} = state); }
  function audit(action, entries) {
    try {
      const log = read(auditKey);
      write(auditKey, log.concat(entries.map(entry => ({action, id: publicCode(entry.tree), reason: [entry.reason, entry.note].filter(Boolean).join(' · '), when: new Date().toISOString()}))));
    } catch (_) { /* L'errore di un registro locale non annulla un salvataggio già confermato. */ }
  }

  async function deleteSelected() {
    if (!logged || busy || !selection.size) return;
    const candidates = trees.filter(tree => selection.has(tree.id));
    if (!candidates.length) { render(); return; }
    const description = candidates.slice(0, 6).map(tree => publicCode(tree) + ' · ' + (tree.species || 'Specie non indicata')).join('\n');
    const question = candidates.length === 1 ? 'Sei sicuro di voler cancellare questo albero?' : 'Sei sicuro di voler cancellare questi ' + candidates.length + ' alberi?';
    if (!confirm(question + '\n\n' + description + (candidates.length > 6 ? '\n… e altri ' + (candidates.length - 6) : '') + '\n\nPotrai recuperarli dal cestino di questo browser.')) return;
    let previous, batchId, committed = false, staged = false;
    setBusy(true); message('Salvataggio dell’eliminazione…');
    try {
      preflight(); await saveChain; preflight();
      // Prepara tutte le copie recuperabili prima di rimuovere una sola scheda.
      const oldTrash = read(trashKey), ids = new Set(candidates.map(tree => tree.id));
      batchId = uniqueID();
      const when = new Date().toISOString();
      const reason = $('adminDeleteReason').value || 'Eliminazione dall’area amministratore', note = $('adminDeleteNote').value.trim();
      const entries = candidates.map(tree => ({trashId: uniqueID(), batchId, pending: true, tree: clone(tree), history: clone(historyEvents.filter(event => event.treeId === tree.id)), photos: clone(photos.filter(photo => photo.treeId === tree.id)), reason, note, when}));
      write(trashKey, oldTrash.concat(entries)); staged = true;
      previous = rememberState();
      trees = trees.filter(tree => !ids.has(tree.id));
      historyEvents = historyEvents.filter(event => !ids.has(event.treeId));
      photos = photos.filter(photo => !ids.has(photo.treeId));
      await saveArchive(); committed = true;
      try {
        write(trashKey, read(trashKey).map(entry => { if (entry.batchId !== batchId) return entry; const {pending, ...saved} = entry; return saved; }));
      } catch (_) { /* La copia preparata resta recuperabile anche se non si può aggiornare l'etichetta. */ }
      audit('Eliminato', entries); selection.clear(); refresh(); render();
      $('adminDeleteReason').value = ''; $('adminDeleteNote').value = '';
      message(candidates.length === 1 ? 'Albero eliminato. Puoi recuperarlo dal cestino.' : candidates.length + ' alberi eliminati. Puoi recuperarli dal cestino.');
    } catch (error) {
      if (!committed && previous) restoreState(previous);
      if (!committed && staged && error.code === 'CONFLICT') {
        try { write(trashKey, read(trashKey).filter(entry => entry.batchId !== batchId)); } catch (_) {}
      }
      refresh(); render();
      message(committed ? 'Eliminazione salvata. Riapri l’area amministratore per aggiornare l’elenco.' : 'Eliminazione non confermata: l’elenco precedente è stato mantenuto. ' + error.message + (staged && error.code !== 'CONFLICT' ? ' Le copie degli alberi restano nel cestino per consentire il recupero se il salvataggio fosse arrivato all’archivio.' : ''), true);
    } finally { setBusy(false); }
  }

  async function restoreEntry(key, treeId) {
    if (!logged || busy) return;
    let entry;
    try { entry = read(trashKey).find((candidate, index) => (candidate.trashId || 'legacy-' + index) === key && candidate.tree?.id === treeId); }
    catch (error) { message(error.message, true); return; }
    if (!entry || !isTree(entry.tree) || !Array.isArray(entry.history) || !Array.isArray(entry.photos)) { message('Questa scheda non è disponibile nel cestino.', true); return; }
    const occupied = () => trees.some(tree => tree.id === entry.tree.id || publicCodeKey(publicCode(tree)) === publicCodeKey(publicCode(entry.tree)));
    if (occupied()) { message('Il codice ' + publicCode(entry.tree) + ' è già presente nell’archivio. Nessun albero è stato sostituito.', true); return; }
    if (!confirm('Ripristinare ' + publicCode(entry.tree) + ' con le sue foto e rilevazioni?')) return;
    let previous, committed = false;
    setBusy(true); message('Ripristino dell’albero…');
    try {
      preflight(); await saveChain; preflight();
      if (occupied()) throw Error('Il codice dell’albero è già presente nell’archivio.');
      previous = rememberState();
      const historyIds = new Set(historyEvents.map(event => event.id)), photoIds = new Set(photos.map(photo => photo.id));
      trees = trees.concat(clone(entry.tree));
      historyEvents = historyEvents.concat(clone(entry.history.filter(event => event.id == null || !historyIds.has(event.id))));
      photos = photos.concat(clone(entry.photos.filter(photo => photo.id == null || !photoIds.has(photo.id))));
      seq = Math.max(seq, (Number(entry.tree.id.split('-').pop()) || 0) + 1);
      await saveArchive(); committed = true;
      try { write(trashKey, read(trashKey).filter((candidate, index) => !((candidate.trashId || 'legacy-' + index) === key && candidate.tree?.id === treeId))); } catch (_) {}
      audit('Ripristinato', [entry]); refresh(); render(); message('Albero ripristinato con le sue foto e rilevazioni.');
    } catch (error) {
      if (!committed && previous) restoreState(previous);
      refresh(); render(); message(committed ? 'Ripristino salvato. Riapri l’area amministratore per aggiornare l’elenco.' : 'Ripristino non confermato. La scheda resta nel cestino. ' + error.message, true);
    } finally { setBusy(false); }
  }

  $('adminOpen').addEventListener('click', () => {
    if (overlay.classList.contains('open')) return;
    previousInert = $('app').inert; $('app').inert = true;
    overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false'); $('adminPassword').focus();
  });
  $('adminClose').onclick = hide;
  overlay.addEventListener('click', event => { if (event.target === overlay) hide(); });
  document.addEventListener('keydown', event => {
    if (!overlay.classList.contains('open') || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') { event.preventDefault(); hide(); }
    if (event.key === 'Tab') {
      const controls = [...overlay.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(control => !control.disabled && control.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  $('adminLoginButton').onclick = () => {
    if ($('adminPassword').value !== 'Albereto71') { $('adminLoginError').classList.remove('hidden'); return; }
    logged = true; $('adminPassword').value = ''; $('adminLogin').classList.add('hidden'); $('adminContent').classList.remove('hidden');
    render(); $('adminTreeSelect').focus();
  };
  $('adminPassword').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('adminLoginButton').click(); } });
  $('adminLogout').onclick = () => { if (!busy) { lock(); $('adminPassword').focus(); } };
  $('adminTreeSearch').oninput = () => { limit = 100; renderTrees(); };
  $('adminTreeSelect').onchange = event => { selection.clear(); if (event.target.value) selection.add(event.target.value); updateSelection(); };
  $('adminTreeList').onchange = event => { const id = event.target.dataset.adminTree; if (!id) return; if (event.target.checked) selection.add(id); else selection.delete(id); updateSelection(); };
  $('adminSelectAll').onchange = event => { for (const tree of matchingTrees()) { if (event.target.checked) selection.add(tree.id); else selection.delete(tree.id); } updateSelection(); };
  $('adminClearSelection').onclick = () => { selection.clear(); updateSelection(); };
  $('adminShowMore').onclick = () => { limit += 100; renderTrees(); };
  $('adminDeleteTree').onclick = deleteSelected;
  $('adminTrashList').onclick = event => { const button = event.target.closest('[data-restore]'); if (button) restoreEntry(button.dataset.restore, button.dataset.restoreTree); };
  $('adminBackup').onclick = () => { if (logged && !busy) expJSON(); };
  const contextTile=document.createElement('article');contextTile.className='adminTile';contextTile.innerHTML='<strong>Contesti e parchi</strong><p>Crea e modifica parchi, vie e altri luoghi a cui associare alberi, arredi e giochi.</p><button class="btn main" type="button" id="adminContexts">Gestisci contesti e parchi</button>'; $('adminContent').prepend(contextTile);$('adminContexts').onclick=()=>{if(logged&&!busy)window.openMunicipalContexts?.();};
  window.addEventListener('storage', event => { if (logged && !busy && [trashKey, auditKey].includes(event.key)) render(); });
  const previousRefresh = refresh;
  refresh = function(...args) { const result = previousRefresh(...args); if (logged && !busy) render(); return result; };
})();
