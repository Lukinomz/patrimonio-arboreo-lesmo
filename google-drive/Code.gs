/* Backend Google Apps Script. Configurazione e distribuzione: README.md. */
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

function fail_(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function doGet() {
  return response_({ok: false, error: {code: 'POST_REQUIRED', message: 'Usa il collegamento dall’app Lesmo.'}});
}

function response_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(event) {
  let lock;
  try {
    const body = event && event.postData && event.postData.contents;
    if (!body || body.length > 20 * 1024 * 1024) fail_('INVALID_REQUEST', 'Richiesta assente o troppo grande.');
    const request = JSON.parse(body);
    const properties = PropertiesService.getScriptProperties();
    const key = properties.getProperty('ACCESS_KEY');
    const folderId = properties.getProperty('DRIVE_FOLDER_ID');
    if (!key || key.length < 32 || !folderId) fail_('NOT_CONFIGURED', 'Il proprietario deve configurare il servizio Drive.');
    if (typeof request.key !== 'string' || request.key !== key) fail_('UNAUTHORIZED', 'Chiave di accesso non valida.');
    if (!['load', 'save', 'photoGet', 'photoPut'].includes(request.action)) fail_('INVALID_REQUEST', 'Operazione non valida.');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) fail_('BUSY', 'Archivio occupato: riprova fra qualche secondo.');
    const root = DriveApp.getFolderById(folderId);
    const file = one_(root.getFilesByName('alberi.json'));
    const text = file ? file.getBlob().getDataAsString('UTF-8') : null;
    const revision = text === null ? 'empty' : hash_(text);
    let data = null;
    if (text !== null) {
      try { data = JSON.parse(text); } catch (_) { fail_('INVALID_ARCHIVE', 'alberi.json non è leggibile. Nessun dato modificato.'); }
      validateArchive_(data);
    }
    if (request.action === 'load') {
      return response_({ok: true, result: {data, revision, folderName: root.getName()}});
    }
    if (request.action === 'photoGet') {
      const photo = photoFile_(root, request.path, false);
      if (!photo) fail_('NOT_FOUND', 'Fotografia non trovata.');
      const blob = photo.getBlob();
      if (blob.getBytes().length > MAX_PHOTO_BYTES) fail_('TOO_LARGE', 'Foto oltre 12 MB: scaricala direttamente da Drive.');
      return response_({ok: true, result: {base64: Utilities.base64Encode(blob.getBytes()), mime: blob.getContentType()}});
    }
    if (request.revision !== revision) fail_('CONFLICT', 'Un’altra persona ha aggiornato l’archivio. Ricarica da Drive prima di salvare.');
    if (request.action === 'photoPut') {
      if (typeof request.base64 !== 'string' || request.base64.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.base64)) fail_('INVALID_PHOTO', 'Fotografia non valida o oltre 12 MB.');
      if (!/^(image\/(jpeg|png|webp|gif|heic|heif)|application\/octet-stream)$/.test(request.mime || '')) fail_('INVALID_PHOTO', 'Formato foto non supportato.');
      const bytes = Utilities.base64Decode(request.base64);
      const existing = photoFile_(root, request.path, false);
      if (existing) {
        if (hashBytes_(existing.getBlob().getBytes()) !== hashBytes_(bytes)) fail_('PHOTO_EXISTS', 'Esiste già una foto diversa con questo nome. Nessun file sovrascritto.');
      } else {
        const parts = photoParts_(request.path);
        const directory = childFolder_(childFolder_(root, 'Foto', true), parts[1], true);
        directory.createFile(Utilities.newBlob(bytes, request.mime, parts[2]));
      }
      return response_({ok: true, result: {revision}});
    }
    validateArchive_(request.data);
    const serialized = JSON.stringify(request.data);
    if (Utilities.newBlob(serialized).getBytes().length > MAX_ARCHIVE_BYTES) fail_('TOO_LARGE', 'Archivio oltre 8 MB: occorre un servizio con capacità maggiore.');
    const oldPaths = new Set((data && data.photos || []).filter(p => !p.removed).map(p => p.relativePath));
    for (const photo of request.data.photos || []) {
      if (!photo.removed && !oldPaths.has(photo.relativePath) && !photoFile_(root, photo.relativePath, false)) fail_('MISSING_PHOTO', 'Carica tutte le fotografie prima di salvare l’archivio.');
    }
    // Conserva la versione precedente prima di sostituire il database.
    if (file) {
      const backup = childFolder_(root, 'Backup', true);
      backup.createFile('prima_' + Date.now() + '_' + Utilities.getUuid() + '.json', text, MimeType.PLAIN_TEXT);
      file.setContent(serialized);
    } else {
      root.createFile('alberi.json', serialized, MimeType.PLAIN_TEXT);
    }
    return response_({ok: true, result: {revision: hash_(serialized), saved: request.data.saved}});
  } catch (error) {
    const code = error.code || 'SERVICE_ERROR';
    // Non esporre eccezioni Google, ID o credenziali nella risposta.
    const message = error.code ? error.message : 'Servizio Drive non disponibile. Verifica distribuzione, autorizzazioni e configurazione.';
    return response_({ok: false, error: {code, message}});
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function one_(iterator) {
  if (!iterator.hasNext()) return null;
  const result = iterator.next();
  if (iterator.hasNext()) fail_('DUPLICATE', 'File o cartelle con nomi duplicati su Drive: il proprietario deve risolverli.');
  return result;
}

function childFolder_(parent, name, create) {
  const found = one_(parent.getFoldersByName(name));
  return found || (create ? parent.createFolder(name) : null);
}

function photoParts_(path) {
  if (typeof path !== 'string' || !/^Foto\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(path) || path.includes('..')) fail_('INVALID_PATH', 'Percorso fotografia non valido.');
  return path.split('/');
}

function photoFile_(root, path, create) {
  const parts = photoParts_(path);
  const photos = childFolder_(root, 'Foto', create);
  const directory = photos && childFolder_(photos, parts[1], create);
  return directory ? one_(directory.getFilesByName(parts[2])) : null;
}

function validateArchive_(data) {
  if (!data || !Array.isArray(data.trees) || data.trees.some(t => !t || typeof t.id !== 'string' || !t.id.startsWith('LES-')) || (data.history != null && !Array.isArray(data.history)) || (data.photos != null && !Array.isArray(data.photos))) fail_('INVALID_ARCHIVE', 'Struttura archivio non valida. Nessun dato modificato.');
  const ids = data.trees.map(t => t.id);
  if (new Set(ids).size !== ids.length) fail_('INVALID_ARCHIVE', 'Identificativi albero duplicati.');
  for (const photo of data.photos || []) {
    if (!photo || typeof photo !== 'object') fail_('INVALID_ARCHIVE', 'Scheda foto non valida.');
    photoParts_(photo.relativePath);
  }
}

function hash_(text) {
  return hashBytes_(Utilities.newBlob(text).getBytes());
}

function hashBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
}
