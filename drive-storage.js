/* Archivio condiviso Google Drive; servizio Apps Script in google-drive/. */
(() => {
  'use strict';
  const local = {
    save: saveArchive, photo: filePathHandle, writePhoto: writePhotoPath,
    backup: createBackup, importJSON: impJSON, mobileImport: mImportBackup,
    ui: updateArchiveUI, dashboard: renderDashboard
  };
  let active = null, connecting = false, busy = 0, blocked = '', statusMode = 'ready';
  let recoverySnapshot = null;
  let incomingConnection = null, incomingError = '';
  const bootTasks = [];
  const originalRestore = restoreFolderShortcut;
  restoreFolderShortcut = function(...args) {
    const task = originalRestore(...args); bootTasks.push(task); return task;
  };
  const originalMobileOpen = mOpenLocal;
  mOpenLocal = function(...args) {
    const task = originalMobileOpen(...args); bootTasks.push(task); return task;
  };
  const byId = id => document.getElementById(id);
  const localButtons = ['chooseFolder', 'chooseFolderTools', 'folderWork', 'connectFromArchive', 'mImportButton'];

  function endpointURL(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash || url.username || url.password) {
      throw Error('Incolla l’indirizzo della distribuzione Google Apps Script che termina con /exec.');
    }
    return url.href;
  }

  // Il frammento non viene inviato ai server HTTP. Lo togliamo subito
  // dall'indirizzo e dalla voce corrente della cronologia.
  const linkParameters = new URLSearchParams(location.hash.slice(1));
  if (linkParameters.has('drive')) {
    const url = linkParameters.get('drive');
    const key = linkParameters.get('key') || '';
    history.replaceState(null, '', location.pathname + location.search);
    try {
      if (key.length < 32) throw Error('Il link di accesso è incompleto. Chiedi un nuovo link al responsabile.');
      incomingConnection = {url: endpointURL(url), key};
    } catch (error) { incomingError = error.message; }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const field = document.createElement('textarea');
      field.value = text;
      field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.append(field); field.select();
      const copied = document.execCommand('copy'); field.remove();
      if (!copied) throw Error('Il browser ha bloccato la copia. Consenti l’accesso agli appunti e riprova.');
    }
  }

  async function generateKey() {
    const feedback = byId('driveFeedback');
    if (byId('driveKey').value && !confirm('Generare una nuova chiave? Se il servizio Google è già configurato, dovrai aggiornare anche il valore ACCESS_KEY nelle proprietà script.')) return;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const key = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    byId('driveKey').value = key;
    try {
      await copyText(key);
      feedback.textContent = 'Chiave generata e copiata. Incollala nel campo Valore della proprietà ACCESS_KEY su Google Apps Script, poi salva.';
    } catch (error) { feedback.textContent = error.message; }
  }

  async function shareConnection() {
    if (!active) return;
    const link = new URL(location.origin + location.pathname);
    link.searchParams.set('v', 'drive2');
    link.hash = new URLSearchParams({drive: active.url, key: active.key}).toString();
    try {
      await copyText(link.href);
      byId('driveFeedback').textContent = 'Link di accesso copiato. Chi lo riceve può leggere e modificare l’archivio: invialo solo ai collaboratori autorizzati.';
    } catch (error) { byId('driveFeedback').textContent = error.message; }
  }

  async function call(config, action, payload = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      // text/plain evita il preflight CORS, non supportato dalle Web App Apps Script.
      const response = await fetch(config.url, {
        method: 'POST', credentials: 'omit', redirect: 'follow',
        headers: {'Content-Type': 'text/plain;charset=UTF-8'},
        body: JSON.stringify({...payload, action, key: config.key}), signal: controller.signal
      });
      if (!response.ok) throw Error('Servizio Drive non raggiungibile (HTTP ' + response.status + ').');
      let result;
      try { result = await response.json(); } catch (_) {
        throw Error('Risposta non valida: controlla che la Web App sia distribuita con accesso “Chiunque”.');
      }
      if (!result.ok) {
        const error = Error(result.error?.message || 'Operazione Drive non riuscita.');
        error.code = result.error?.code; throw error;
      }
      if (!result.result || typeof result.result.revision !== 'string' && action !== 'photoGet') throw Error('Risposta Drive incompleta.');
      return result.result;
    } catch (error) {
      if (error.name === 'AbortError') throw Error('Tempo scaduto: il salvataggio potrebbe essere arrivato a Drive. Ricollega prima di riprovare.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function validate(data) {
    if (!data || !Array.isArray(data.trees) || data.trees.some(t => !isTree(t)) || data.history != null && !Array.isArray(data.history) || data.photos != null && !Array.isArray(data.photos)) {
      throw Error('L’archivio Drive non è valido. I dati correnti non sono stati sostituiti.');
    }
    if ((data.photos || []).some(p => !p || !safePath(p.relativePath))) throw Error('L’archivio contiene percorsi foto non validi.');
  }

  function display() {
    if (!byId('driveStatus')) return;
    byId('driveConnect').disabled = connecting || !!active;
    byId('driveDisconnect').disabled = !active || !!busy;
    byId('driveReload').disabled = !active || !!busy;
    byId('driveRecovery').disabled = !active || !!busy;
    byId('driveImport').disabled = !active || !!busy || !!blocked;
    byId('driveGenerate').disabled = connecting || !!active;
    byId('driveShare').disabled = !active || !!busy;
    for (const id of ['driveURL', 'driveKey', 'driveCreate']) byId(id).disabled = connecting || !!active;
    for (const id of localButtons) if (byId(id)) byId(id).disabled = !!active || connecting;
    const text = active ? blocked || (statusMode === 'saving' ? 'Salvataggio su Google Drive…' : 'Collegato a «' + active.name + '» · ' + trees.length + ' alberi. Le modifiche vengono salvate su Drive.') : 'Non collegato. L’archivio attuale resta locale finché non colleghi Drive.';
    byId('driveStatus').textContent = connecting ? 'Collegamento a Google Drive…' : text;
    byId('driveStatus').classList.toggle('error', !!blocked);
    document.body.classList.toggle('driveConnected', !!active);
    if (!active) return;
    const summary = blocked ? '⚠ Drive: modifiche non salvate' : statusMode === 'saving' ? '◌ Salvataggio su Drive…' : '✓ Google Drive';
    byId('syncStatus').textContent = summary;
    byId('syncStatus').className = blocked ? 'error' : 'ready';
    for (const id of ['archiveDetail', 'archiveWorkDetail', 'workFolderReminder', 'mArchiveDetail']) {
      if (byId(id)) byId(id).textContent = blocked || 'Google Drive · ' + active.name + ' · ' + trees.length + ' alberi · ' + photos.filter(p => !p.removed).length + ' foto · ' + (lastSaved ? 'salvato: ' + new Date(lastSaved).toLocaleString('it-IT') : 'archivio vuoto');
    }
    if (byId('folderName')) byId('folderName').textContent = '☁ ' + active.name;
    if (byId('folderHint')) byId('folderHint').textContent = 'Archivio condiviso Google Drive';
    if (byId('mBannerContent')) byId('mBannerContent').textContent = blocked || 'Google Drive collegato. I salvataggi aggiornano l’archivio condiviso. Ricollega per vedere le modifiche altrui.';
  }

  function stopWrites(error) {
    blocked = error.code === 'CONFLICT'
      ? 'Un’altra persona ha aggiornato Drive. Nessun dato altrui è stato sovrascritto. Scarica una copia da recuperare, poi ricollega e ripeti le tue modifiche.'
      : 'Operazione Drive non confermata: ' + error.message + ' Scarica una copia da recuperare e ricollega prima di continuare.';
    display();
  }

  function writable() {
    if (blocked) throw Error(blocked);
  }

  saveArchive = function() {
    if (!active) return local.save();
    const snapshot = JSON.parse(JSON.stringify(dataSnapshot()));
    const connection = active;
    const write = async () => {
      writable(); busy++; statusMode = 'saving'; display();
      try {
        const result = await call(connection, 'save', {revision: connection.revision, data: snapshot});
        connection.revision = result.revision; lastSaved = snapshot.saved; statusMode = 'ready';
      } catch (error) { recoverySnapshot ||= snapshot; stopWrites(error); throw error; }
      finally { busy--; display(); }
    };
    const task = saveChain.then(write, write); saveChain = task.catch(() => {}); return task;
  };

  filePathHandle = async function(path, create = false) {
    if (!active) return local.photo(path, create);
    if (!safePath(path)) throw Error('Percorso foto non valido.');
    const connection = active;
    return {getFile: async () => {
      const result = await call(connection, 'photoGet', {path});
      return new File([base64ToUint8(result.base64)], path.split('/').pop(), {type: result.mime});
    }};
  };

  writePhotoPath = async function(path, blob) {
    if (!active) return local.writePhoto(path, blob);
    writable();
    if (!safePath(path)) throw Error('Percorso foto non valido.');
    if (blob.size > 12 * 1024 * 1024) throw Error('Per Drive usa foto fino a 12 MB. Riduci l’originale e riprova.');
    const connection = active;
    busy++; display();
    try {
      await call(connection, 'photoPut', {revision: connection.revision, path, base64: await mBlobBase64(blob), mime: blob.type || 'application/octet-stream'});
    } catch (error) { stopWrites(error); throw error; }
    finally { busy--; display(); }
  };

  createBackup = async function(silent = false) {
    if (!active) return local.backup(silent);
    if (backupInProgress) throw Error('Backup già in corso.');
    backupInProgress = true; busy++; display();
    // Il download include anche le modifiche in memoria, utile dopo un conflitto.
    const snapshot = JSON.parse(JSON.stringify(recoverySnapshot || dataSnapshot()));
    try {
      const images = [];
      for (const photo of snapshot.photos.filter(p => !p.removed)) {
        const file = await (await filePathHandle(photo.relativePath)).getFile();
        images.push({relativePath: photo.relativePath, mime: file.type, base64: await mBlobBase64(file)});
      }
      const name = 'lesmo_drive_completo_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      fileDownload(name, JSON.stringify({...snapshot, images}), 'application/json');
      if (!silent) tell('Backup completo scaricato sul dispositivo.');
      return name;
    } finally { backupInProgress = false; busy--; display(); }
  };

  async function importDrive(file) {
    if (!active) return local.importJSON(file);
    try {
      writable();
      const data = JSON.parse(await file.text()); validate(data);
      const images = data.images || [];
      if (!Array.isArray(images)) throw Error('Immagini del backup non valide.');
      const paths = new Set(images.map(p => p.relativePath));
      if ((data.photos || []).some(p => !p.removed && !paths.has(p.relativePath))) throw Error('Usa un backup completo con tutte le foto.');
      for (const image of images) {
        if (!safePath(image.relativePath) || typeof image.base64 !== 'string') throw Error('Foto del backup non valida.');
      }
      if (!confirm('Sostituire l’archivio CONDIVISO su Drive con questo backup (' + data.trees.length + ' alberi)? Questa operazione riguarda tutti gli utenti.')) return;
      for (const image of images) await writePhotoPath(image.relativePath, new Blob([base64ToUint8(image.base64)], {type: image.mime || 'application/octet-stream'}));
      // Cambia la vista solo dopo la conferma del server.
      await saveChain; writable(); busy++; display();
      try {
        const next = {...data, photos: data.photos || [], history: data.history || [], saved: new Date().toISOString()};
        delete next.images;
        const result = await call(active, 'save', {revision: active.revision, data: next});
        active.revision = result.revision; applyData(next); refresh(); updateArchiveUI();
        tell('Backup ripristinato nell’archivio Drive condiviso.');
      } catch (error) { stopWrites(error); throw error; }
      finally { busy--; display(); }
    } catch (error) { tell('Importazione non riuscita: ' + error.message); }
  }
  impJSON = function(file) { return active ? importDrive(file) : local.importJSON(file); };
  mImportBackup = function(file) { return active ? importDrive(file) : local.mobileImport(file); };

  function applyData(data) {
    trees = data.trees; historyEvents = data.history || []; photos = data.photos || [];
    seq = trees.reduce((n, t) => Math.max(n, (Number(t.id.split('-').pop()) || 0) + 1), Math.max(Number(data.nextId) || 1, 1));
    lastSaved = data.saved || '';
  }

  updateArchiveUI = function(mode = 'ready') {
    if (!active) return local.ui(mode);
    statusMode = mode; display();
  };
  renderDashboard = function(...args) {
    const result = local.dashboard(...args); display(); return result;
  };

  async function connect(event) {
    event.preventDefault();
    if (connecting || active) return;
    const feedback = byId('driveFeedback'); feedback.textContent = '';
    let config;
    try {
      config = {url: endpointURL(byId('driveURL').value.trim()), key: byId('driveKey').value.trim()};
      if (config.key.length < 32) throw Error('La chiave deve contenere almeno 32 caratteri.');
    } catch (error) { feedback.textContent = error.message; return false; }
    connecting = true; display();
    try {
      await Promise.all(bootTasks); await saveChain;
      if (trees.length && !confirm('Aprire l’archivio condiviso di Drive? I dati locali restano nel loro archivio e NON vengono caricati automaticamente. Per trasferirli usa un backup completo.')) return;
      const result = await call(config, 'load');
      let data = result.data;
      if (data === null) {
        if (!byId('driveCreate').checked) throw Error('La cartella non contiene alberi.json. Se è la cartella giusta, seleziona “Crea archivio se la cartella è vuota” e ricollega.');
        data = {schema: 4, app: 'Comune di Lesmo Patrimonio Arboreo', saved: new Date().toISOString(), nextId: 1, trees: [], history: [], photos: []};
        const created = await call(config, 'save', {revision: result.revision, data});
        result.revision = created.revision;
      }
      validate(data);
      active = {...config, name: result.folderName || 'Archivio Lesmo', revision: result.revision};
      blocked = ''; statusMode = 'ready'; applyData(data);
      folderHandle = {name: 'Google Drive · ' + active.name};
      try { localStorage.setItem('LesmoDriveEndpoint', config.url); } catch (_) {}
      byId('driveKey').value = ''; // La chiave resta soltanto nella memoria della sessione.
      refresh(); updateArchiveUI(); tell('Google Drive collegato in lettura e scrittura.');
      return true;
    } catch (error) { feedback.textContent = error.message; return false; }
    finally { connecting = false; display(); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const section = document.createElement('section'); section.className = 'workCard driveCard'; section.id = 'driveCard';
    section.innerHTML = `
      <h2>☁ Archivio condiviso Google Drive</h2>
      <p>Collega la stessa cartella da PC e telefono. Ogni salvataggio aggiorna Drive. Ricollega per caricare le modifiche delle altre persone; un conflitto blocca la scrittura senza sovrascriverle.</p>
      <form id="driveForm">
        <label class="field">Indirizzo del servizio Drive<input type="url" id="driveURL" required placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" spellcheck="false"></label>
        <label class="field">Chiave di accesso condivisa<input type="password" id="driveKey" required minlength="32" autocomplete="off"></label>
        <button class="btn" id="driveGenerate" type="button">Genera e copia una nuova chiave</button>
        <p class="driveHelp">Solo per la prima configurazione o per cambiare la chiave: il pulsante genera 32 caratteri e li copia, pronti da incollare in ACCESS_KEY su Google Apps Script.</p>
        <label class="driveCheck"><input type="checkbox" id="driveCreate"> Crea archivio se la cartella è vuota</label>
        <div class="archiveBtns"><button class="btn main" id="driveConnect" type="submit">Collega Google Drive</button><button class="btn main" id="driveShare" type="button" disabled>Copia link di accesso per i collaboratori</button><button class="btn" id="driveReload" type="button" disabled>Ricollega / aggiorna</button><button class="btn" id="driveDisconnect" type="button" disabled>Scollega</button><button class="btn" id="driveRecovery" type="button" disabled>Scarica backup / copia da recuperare</button><button class="btn" id="driveImport" type="button" disabled>Ripristina backup su Drive</button></div>
        <input id="driveImportFile" type="file" accept=".json,application/json" hidden>
      </form>
      <p id="driveStatus" role="status" aria-live="polite"></p><p id="driveFeedback" role="alert"></p>
      <p>Il link riservato apre e collega automaticamente l’archivio. Contiene la chiave di accesso: chi lo possiede può leggere e modificare i dati. Condividilo privatamente e conservalo per riaprire l’app. L’app ricorda solo l’indirizzo del servizio; senza il link, dopo una ricarica devi reinserire la chiave. Senza rete il salvataggio su Drive non è disponibile.</p>
      <a href="https://github.com/Lukinomz/patrimonio-arboreo-lesmo/blob/main/google-drive/README.md" target="_blank" rel="noopener">Prima configurazione della cartella Drive</a>
    `;
    byId('viewArchivio').prepend(section);
    const introduction = byId('viewArchivio').querySelector('.v2Introduction');
    if (introduction) introduction.textContent = 'Scegli l’archivio condiviso Google Drive oppure un archivio locale. Il collegamento a Drive non trasferisce automaticamente i dati locali.';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'btn'; open.id = 'openDrive'; open.textContent = '☁ Collega Drive';
    open.onclick = () => { switchSection('archivio'); section.scrollIntoView({block: 'start', behavior: 'smooth'}); byId('driveURL').focus(); };
    byId('workFolderReminder').insertAdjacentElement('afterend', open);
    byId('driveForm').onsubmit = connect;
    byId('driveGenerate').onclick = generateKey;
    byId('driveShare').onclick = shareConnection;
    try { byId('driveURL').value = localStorage.getItem('LesmoDriveEndpoint') || ''; } catch (_) {}
    const leave = () => {
      if (busy) return;
      if (!confirm('Scollegare Drive e ricaricare la pagina? Le modifiche non salvate andranno perse. Scarica prima una copia da recuperare se necessario. Dopo la ricarica reinserisci la chiave per ricollegare Drive.')) return;
      location.reload();
    };
    byId('driveDisconnect').onclick = leave;
    byId('driveReload').onclick = leave;
    byId('driveRecovery').onclick = async () => { try { await createBackup(); } catch (error) { byId('driveFeedback').textContent = 'Copia non completata: ' + error.message; } };
    byId('driveImport').onclick = () => byId('driveImportFile').click();
    byId('driveImportFile').onchange = event => { const file = event.target.files[0]; event.target.value = ''; if (file) importDrive(file); };
    window.addEventListener('beforeunload', event => { if (busy || blocked) { event.preventDefault(); event.returnValue = ''; } });
    display();
    if (incomingConnection) {
      byId('driveURL').value = incomingConnection.url;
      byId('driveKey').value = incomingConnection.key;
      incomingConnection = null;
      connect({preventDefault() {}}).then(connected => {
        if (!connected) switchSection('archivio');
      });
    } else if (incomingError) {
      byId('driveFeedback').textContent = incomingError;
      switchSection('archivio');
    }
  });
})();
