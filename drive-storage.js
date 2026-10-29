/* Archivio condiviso Google Drive; servizio Apps Script in google-drive/. */
(() => {
  'use strict';
  const DEFAULT_DRIVE_URL = 'https://script.google.com/macros/s/AKfycbwrv6aY7vbGae_6wT4JWLkGPHd6zsb7RulCuP_ffWryYuMK0wUqauK7IVO_ZY6qQwPJ/exec';
  const local = {
    save: saveArchive, photo: filePathHandle, writePhoto: writePhotoPath,
    backup: createBackup, importJSON: impJSON, mobileImport: mImportBackup,
    ui: updateArchiveUI, dashboard: renderDashboard
  };
  let active = null, connecting = false, busy = 0, blocked = '', statusMode = 'ready';
  let recoverySnapshot = null;
  let refreshing = false;
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
      if (endpointURL(url) !== DEFAULT_DRIVE_URL) throw Error('Questo link appartiene a un altro archivio. Usa il normale indirizzo dell’app e la password ricevuta dal responsabile.');
      incomingConnection = {url: DEFAULT_DRIVE_URL, key};
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
    try {
      await copyText(link.href);
      byId('driveFeedback').textContent = 'Link dell’app copiato. È lo stesso per tutti: comunica la password separatamente ai collaboratori autorizzati.';
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
        const error = Error(result.error?.code === 'UNAUTHORIZED' ? 'Password non corretta.' : result.error?.message || 'Operazione Drive non riuscita.');
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
    byId('driveLocal').disabled = connecting || !!active;
    for (const id of ['driveReload', 'driveRefreshRegistry']) {
      if (byId(id)) {
        byId(id).disabled = !active || !!busy || refreshing;
        byId(id).textContent = refreshing ? 'Aggiornamento…' : '↻ Aggiorna DB';
      }
    }
    for (const id of ['driveURL', 'driveKey', 'driveCreate']) byId(id).disabled = connecting || !!active;
    for (const id of localButtons) if (byId(id)) byId(id).disabled = !!active || connecting;
    const text = active ? refreshing ? 'Aggiornamento del DB da Google Drive…' : blocked || (statusMode === 'saving' ? 'Salvataggio su Google Drive…' : 'Collegato a «' + active.name + '» · ' + trees.length + ' alberi. Le modifiche vengono salvate su Drive.') : 'Archivio condiviso già configurato. Inserisci la password ricevuta dal responsabile.';
    byId('driveStatus').textContent = connecting ? 'Collegamento a Google Drive…' : text;
    byId('driveStatus').classList.toggle('error', !!blocked);
    document.body.classList.toggle('driveConnected', !!active);
    if (!active) return;
    const summary = refreshing ? '◌ Aggiornamento DB…' : blocked ? '⚠ Drive: modifiche non salvate' : statusMode === 'saving' ? '◌ Salvataggio su Drive…' : '✓ Google Drive';
    byId('syncStatus').textContent = summary;
    byId('syncStatus').className = blocked ? 'error' : 'ready';
    for (const id of ['archiveDetail', 'archiveWorkDetail', 'workFolderReminder', 'mArchiveDetail']) {
      if (byId(id)) byId(id).textContent = blocked || 'Google Drive · ' + active.name + ' · ' + trees.length + ' alberi · ' + photos.filter(p => !p.removed).length + ' foto · ' + (lastSaved ? 'salvato: ' + new Date(lastSaved).toLocaleString('it-IT') : 'archivio vuoto');
    }
    if (byId('folderName')) byId('folderName').textContent = '☁ ' + active.name;
    if (byId('folderHint')) byId('folderHint').textContent = 'Archivio condiviso Google Drive';
    if (byId('mBannerContent')) byId('mBannerContent').textContent = blocked || 'Google Drive collegato. I salvataggi aggiornano l’archivio condiviso. Usa Aggiorna DB per vedere le modifiche altrui.';
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
    if (refreshing) return Promise.reject(Error('Attendi il completamento dell’aggiornamento del DB.'));
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
    if (refreshing) throw Error('Attendi il completamento dell’aggiornamento del DB.');
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
      if (refreshing) throw Error('Attendi il completamento dell’aggiornamento del DB.');
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

  function openApplication() {
    const gate = byId('driveAccess');
    if (!gate || gate.hidden) return;
    byId('viewArchivio').prepend(byId('driveCard'));
    gate.hidden = true;
    byId('app').inert = false;
    document.body.classList.remove('driveLoginRequired');
  }

  async function refreshDatabase() {
    if (!active || refreshing || busy) return false;
    if (quickBusy || v2AnagBusy || backupInProgress || (v2SelectedId && byId('v2CensusSave').disabled && v21SurveyStaged.length)) {
      tell('Attendi la fine del salvataggio o del backup prima di aggiornare il DB.');
      return false;
    }
    if ((blocked || recoverySnapshot) && !confirm('Ci sono modifiche non salvate su Drive. Scarica prima una copia da recuperare se vuoi conservarle. Caricare ora l’archivio aggiornato e scartare le modifiche non salvate?')) return false;
    const connection = active;
    const app = byId('app');
    const wasInert = app.inert;
    refreshing = true;
    app.inert = true;
    display();
    const load = async () => {
      busy++;
      display();
      try {
        const result = await call(connection, 'load');
        validate(result.data);
        applyData(result.data);
        connection.revision = result.revision;
        connection.name = result.folderName || connection.name;
        folderHandle = {name: 'Google Drive · ' + connection.name};
        blocked = ''; recoverySnapshot = null; statusMode = 'ready';
        refresh(); updateArchiveUI();
        const message = 'DB aggiornato · ' + trees.length + ' alberi · ' + new Date().toLocaleTimeString('it-IT', {hour: '2-digit', minute: '2-digit'});
        byId('driveRefreshStatus').textContent = message;
        byId('driveFeedback').textContent = message;
        tell('DB aggiornato da Google Drive.');
        return true;
      } catch (error) {
        const message = 'Aggiornamento non riuscito: ' + error.message + ' I dati già caricati sono mantenuti.';
        byId('driveRefreshStatus').textContent = message;
        byId('driveFeedback').textContent = message;
        tell('Aggiornamento non riuscito. Puoi riprovare senza uscire.');
        return false;
      } finally {
        busy--; refreshing = false;
        app.inert = wasInert;
        display();
      }
    };
    const task = saveChain.then(load, load);
    saveChain = task.catch(() => {});
    return task;
  }

  async function connect(event) {
    event.preventDefault();
    if (connecting || active) return;
    const feedback = byId('driveFeedback'); feedback.textContent = '';
    let config;
    try {
      config = {url: DEFAULT_DRIVE_URL, key: byId('driveKey').value.trim()};
      if (config.key.length < 32) throw Error('Password non valida. Usa quella ricevuta dal responsabile.');
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
      openApplication();
      refresh(); updateArchiveUI(); tell('Google Drive collegato in lettura e scrittura.');
      return true;
    } catch (error) { feedback.textContent = error.message; return false; }
    finally { connecting = false; display(); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const section = document.createElement('section'); section.className = 'workCard driveCard'; section.id = 'driveCard';
    section.innerHTML = `
      <h2 id="driveAccessTitle">Patrimonio Arboreo Lesmo</h2>
      <p class="driveLoginOnly">Accedi all’archivio condiviso con la password ricevuta dal responsabile. Il collegamento a Google Drive è già impostato.</p>
      <form id="driveForm">
        <input type="hidden" id="driveURL">
        <label class="field driveLoginOnly">Password di accesso<input type="password" id="driveKey" name="password" required autocomplete="current-password"></label>
        <div class="archiveBtns"><button class="btn main driveLoginOnly" id="driveConnect" type="submit">Accedi</button><button class="btn driveSessionOnly" id="driveShare" type="button" disabled>Copia link dell’app</button><button class="btn driveSessionOnly" id="driveReload" type="button" disabled>↻ Aggiorna DB</button><button class="btn driveSessionOnly" id="driveDisconnect" type="button" disabled>Esci</button><button class="btn driveSessionOnly" id="driveRecovery" type="button" disabled>Scarica backup / copia da recuperare</button><button class="btn driveSessionOnly" id="driveImport" type="button" disabled>Ripristina backup su Drive</button></div>
        <input id="driveImportFile" type="file" accept=".json,application/json" hidden>
        <details id="driveSetup" class="driveLoginOnly"><summary>Prima configurazione e archivio locale</summary>
          <p class="driveHelp">Questa sezione serve al responsabile. Per accedere basta la password.</p>
          <button class="btn" id="driveGenerate" type="button">Genera e copia una nuova chiave</button>
          <p class="driveHelp">Il pulsante genera una nuova chiave da impostare nel valore ACCESS_KEY su Google Apps Script. Non cambia la password del servizio automaticamente.</p>
          <label class="driveCheck"><input type="checkbox" id="driveCreate"> Crea archivio se la cartella è vuota</label>
          <button class="btn" id="driveLocal" type="button">Apri un archivio locale senza Drive</button>
          <p><a href="https://github.com/Lukinomz/patrimonio-arboreo-lesmo/blob/main/google-drive/README.md" target="_blank" rel="noopener">Istruzioni per il responsabile</a></p>
        </details>
      </form>
      <p id="driveStatus" role="status" aria-live="polite"></p><p id="driveFeedback" role="alert"></p>
      <p class="driveSessionOnly">Ogni salvataggio aggiorna l’archivio condiviso su Google Drive. La password viene verificata dal servizio Google e resta in memoria per questa pagina. Per vedere le modifiche degli altri usa Aggiorna DB, senza ripetere l’accesso.</p>
    `;
    const gate = document.createElement('div'); gate.id = 'driveAccess';
    gate.setAttribute('role', 'dialog'); gate.setAttribute('aria-modal', 'true'); gate.setAttribute('aria-labelledby', 'driveAccessTitle');
    gate.append(section); document.body.append(gate);
    byId('app').inert = true;
    document.body.classList.add('driveLoginRequired');
    const introduction = byId('viewArchivio').querySelector('.v2Introduction');
    if (introduction) introduction.textContent = 'Scegli l’archivio condiviso Google Drive oppure un archivio locale. Il collegamento a Drive non trasferisce automaticamente i dati locali.';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'btn'; open.id = 'openDrive'; open.textContent = '☁ Collega Drive';
    open.onclick = () => { switchSection('archivio'); section.scrollIntoView({block: 'start', behavior: 'smooth'}); byId('driveKey').focus(); };
    byId('workFolderReminder').insertAdjacentElement('afterend', open);
    const refreshButton = document.createElement('button');
    refreshButton.id = 'driveRefreshRegistry'; refreshButton.type = 'button'; refreshButton.className = 'btn';
    refreshButton.textContent = '↻ Aggiorna DB'; refreshButton.disabled = true;
    refreshButton.onclick = refreshDatabase;
    const registryActions = byId('viewRiepilogo').querySelector('.v2SectionActions');
    registryActions.querySelector('.v2ActionRow').prepend(refreshButton);
    const refreshStatus = document.createElement('div');
    refreshStatus.id = 'driveRefreshStatus'; refreshStatus.className = 'driveRefreshStatus';
    refreshStatus.setAttribute('role', 'status'); refreshStatus.setAttribute('aria-live', 'polite');
    registryActions.insertAdjacentElement('afterend', refreshStatus);
    byId('driveForm').onsubmit = connect;
    byId('driveGenerate').onclick = generateKey;
    byId('driveShare').onclick = shareConnection;
    byId('driveURL').value = DEFAULT_DRIVE_URL;
    byId('driveLocal').onclick = async () => { await Promise.all(bootTasks); openApplication(); switchSection('archivio'); };
    const leave = () => {
      if (busy) return;
      if (!confirm('Uscire e tornare alla richiesta della password? Le modifiche non salvate andranno perse. Scarica prima una copia da recuperare se necessario.')) return;
      location.reload();
    };
    byId('driveDisconnect').onclick = leave;
    byId('driveReload').onclick = refreshDatabase;
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
