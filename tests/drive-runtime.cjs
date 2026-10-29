// Simula i servizi Google per esercitare il vero Code.gs senza account o rete.
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
function runtime() {
  const key = 'test-only-key-not-for-production-0123456789';
  function iterator(items) { let i = 0; return {hasNext: () => i < items.length, next: () => items[i++]}; }
  function blob(value, mime = 'application/octet-stream', name = '') {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return {getBytes: () => [...bytes], getDataAsString: () => bytes.toString('utf8'), getContentType: () => mime, getName: () => name};
  }
  function folder(name) {
    const files = [], folders = [];
    return {
      files, folders, getName: () => name,
      getFilesByName: n => iterator(files.filter(f => f.name === n)),
      getFoldersByName: n => iterator(folders.filter(f => f.getName() === n)),
      createFolder(n) { const f = folder(n); folders.push(f); return f; },
      createFile(a, text, mime) {
        const initial = typeof a === 'string' ? blob(text, mime, a) : a;
        let value = initial;
        const file = {name: initial.getName(), getBlob: () => value, setContent(s) { value = blob(s, initial.getContentType(), initial.getName()); }};
        files.push(file); return file;
      }
    };
  }
  const root = folder('Archivio di prova');
  let accesses = 0;
  const properties = {ACCESS_KEY: key, DRIVE_FOLDER_ID: 'test-folder'};
  const context = vm.createContext({
    console, Set, Date, JSON,
    PropertiesService: {getScriptProperties: () => ({getProperty: k => properties[k]})},
    LockService: {getScriptLock: () => { let held = false; return {tryLock() { held = true; return true; }, hasLock: () => held, releaseLock() { held = false; }}; }},
    DriveApp: {getFolderById(id) { accesses++; if (id !== 'test-folder') throw Error('wrong folder'); return root; }},
    MimeType: {PLAIN_TEXT: 'text/plain'},
    ContentService: {MimeType: {JSON: 'application/json'}, createTextOutput: s => ({setMimeType: () => JSON.parse(s)})},
    Utilities: {
      newBlob: (value, mime, name) => blob(Array.isArray(value) ? Buffer.from(value) : value, mime, name),
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      base64Decode: value => [...Buffer.from(value, 'base64')],
      DigestAlgorithm: {SHA_256: 'sha256'},
      computeDigest: (alg, bytes) => [...crypto.createHash(alg).update(Buffer.from(bytes)).digest()],
      getUuid: () => crypto.randomUUID()
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../google-drive/Code.gs'), 'utf8'), context);
  const post = request => context.doPost({postData: {contents: JSON.stringify(request)}});
  return {key, root, properties, post, accesses: () => accesses, request: (action, payload = {}) => post({key, action, ...payload})};
}
module.exports = {runtime};
if (require.main === module) {
  const rt = runtime();
  require('node:http').createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    try {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(rt.post(JSON.parse(body))));
    } catch (_) { res.end(JSON.stringify({ok: false, error: {code: 'BAD_REQUEST'}})); }
  }).listen(8766, '127.0.0.1', () => console.log('Drive test runtime ready'));
}
