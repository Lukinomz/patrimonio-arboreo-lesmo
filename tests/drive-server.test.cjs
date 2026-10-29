const {test} = require('node:test');
const assert = require('node:assert/strict');
const {runtime} = require('./drive-runtime.cjs');
const data = () => ({schema: 4, trees: [{id: 'LES-000001', code: 'TEST-1'}], history: [], photos: [], nextId: 2, saved: '2026-10-29'});

test('nessun accesso Drive senza chiave valida; gli errori non espongono dati', () => {
  const rt = runtime();
  assert.equal(rt.post({action: 'load', key: 'wrong'}).error.code, 'UNAUTHORIZED');
  assert.equal(rt.accesses(), 0);
  assert.equal(rt.request('unknown').error.code, 'INVALID_REQUEST');
  assert.equal(rt.accesses(), 0);
});

test('lettura senza creazione; creazione esplicita e conflitto fra due utenti', () => {
  const rt = runtime();
  const readA = rt.request('load').result, readB = rt.request('load').result;
  assert.equal(readA.data, null); assert.equal(rt.root.files.length, 0);
  const saveA = rt.request('save', {revision: readA.revision, data: data()});
  assert.equal(saveA.ok, true);
  assert.equal(rt.request('save', {revision: readB.revision, data: {...data(), trees: []}}).error.code, 'CONFLICT');
  assert.equal(rt.request('load').result.data.trees.length, 1);
  const current = rt.request('load').result;
  const next = data(); next.trees[0].species = 'Tiglio';
  assert.equal(rt.request('save', {revision: current.revision, data: next}).ok, true);
  assert.equal(rt.root.folders[0].getName(), 'Backup');
  assert.equal(JSON.parse(rt.root.folders[0].files[0].getBlob().getDataAsString()).trees[0].species, undefined);
});

test('foto: caricamento, lettura, retry identico e rifiuto sovrascrittura/percorso non valido', () => {
  const rt = runtime(); const revision = 'empty';
  const photo = {revision, path: 'Foto/LES-000001/test.png', mime: 'image/png', base64: Buffer.from('photo bytes').toString('base64')};
  assert.equal(rt.request('photoPut', photo).ok, true);
  assert.equal(rt.request('photoGet', {path: photo.path}).result.base64, photo.base64);
  assert.equal(rt.request('photoPut', photo).ok, true);
  assert.equal(rt.request('photoPut', {...photo, base64: 'b3RoZXI='}).error.code, 'PHOTO_EXISTS');
  assert.equal(rt.request('photoPut', {...photo, path: 'Foto/../leak.png'}).error.code, 'INVALID_PATH');
  const archive = data(); archive.photos.push({id: 'p1', relativePath: photo.path, removed: false});
  assert.equal(rt.request('save', {revision, data: archive}).ok, true);
  assert.equal(rt.request('photoPut', {...photo, path: 'Foto/LES-000001/new.png'}).error.code, 'CONFLICT');
});

test('archivio non valido, riferimenti mancanti e duplicati non distruggono i dati', () => {
  const rt = runtime();
  assert.equal(rt.request('save', {revision: 'empty', data: {trees: 'invalid'}}).error.code, 'INVALID_ARCHIVE');
  assert.equal(rt.root.files.length, 0);
  const archive = data(); archive.photos.push({relativePath: 'Foto/LES-000001/missing.png'});
  assert.equal(rt.request('save', {revision: 'empty', data: archive}).error.code, 'MISSING_PHOTO');
  assert.equal(rt.root.files.length, 0);
  rt.root.createFile('alberi.json', '{invalid', 'text/plain');
  assert.equal(rt.request('load').error.code, 'INVALID_ARCHIVE');
  rt.root.createFile('alberi.json', '{}', 'text/plain');
  assert.equal(rt.request('load').error.code, 'DUPLICATE');
});

test('la revisione rileva anche modifiche manuali al JSON su Drive', () => {
  const rt = runtime();
  rt.request('save', {revision: 'empty', data: data()});
  const previous = rt.request('load').result;
  const changed = data(); changed.trees[0].species = 'Quercia';
  rt.root.files[0].setContent(JSON.stringify(changed));
  assert.equal(rt.request('save', {revision: previous.revision, data: data()}).error.code, 'CONFLICT');
  assert.equal(rt.request('load').result.data.trees[0].species, 'Quercia');
});
