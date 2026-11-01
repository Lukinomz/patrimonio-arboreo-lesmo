"""Guida e gestione singola/multipla degli alberi con Drive simulato.

Esegue il vero Code.gs su dati di prova. Nessuna credenziale o archivio reale.
"""
import base64
import copy
import functools
import http.server
import json
import pathlib
import re
import subprocess
import tempfile
import threading
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
KEY = 'test-only-key-not-for-production-0123456789'
ENDPOINT = re.search(r"const DEFAULT_DRIVE_URL = '([^']+)'", (ROOT / 'drive-storage.js').read_text()).group(1)
ADMIN = re.search(r"adminPassword'\)\.value !== '([^']+)'", (ROOT / 'admin-ui.js').read_text()).group(1)
PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='
ARTIFACTS = pathlib.Path(tempfile.gettempdir()) / 'lesmo-guide-admin'


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def rpc(action, **payload):
    request = urllib.request.Request('http://127.0.0.1:8766/', data=json.dumps({'action': action, 'key': KEY, **payload}).encode())
    with urllib.request.urlopen(request) as response:
        result = json.load(response)
    return result['result'] if action == 'load' and result['ok'] else result


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    service = subprocess.Popen(['node', str(ROOT / 'tests/drive-runtime.cjs')], stdout=subprocess.PIPE, text=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        assert service.stdout.readline().strip() == 'Drive test runtime ready'
        seed = {'schema': 4, 'nextId': 6, 'trees': [
            {'id': 'LES-000001', 'code': 'LESMO-A0001', 'species': 'Tiglio', 'address': 'Via Roma', 'status': 'ok', 'lat': None, 'lon': None, 'date': '2026-11-01', 'notes': 'Nota originale'},
            {'id': 'LES-000003', 'code': 'LESMO-A0003', 'species': 'Quercia', 'address': 'Via Roma', 'status': 'watch', 'lat': None, 'lon': None, 'date': '2026-11-01'},
            {'id': 'LES-000005', 'code': 'LESMO-A0005', 'species': 'Pino', 'address': 'Via Milano', 'status': 'ok', 'lat': None, 'lon': None, 'date': '2026-11-01'}
        ], 'history': [{'id': 'event-' + str(i), 'treeId': 'LES-' + str(i).zfill(6), 'type': 'censimento', 'date': '2026-11-01', 'description': 'Rilievo da conservare'} for i in [1, 3, 5]],
        'photos': [{'id': 'photo-' + str(i), 'treeId': 'LES-' + str(i).zfill(6), 'relativePath': 'Foto/LES-' + str(i).zfill(6) + '/foto.png', 'originalName': 'foto.png', 'date': '2026-11-01'} for i in [1, 5]]}
        for i in [1, 5]:
            # Anche i vecchi archivi possono avere eventi e foto senza un ID proprio.
            seed['history'].append({'treeId': 'LES-' + str(i).zfill(6), 'type': 'monitoraggio', 'date': '2020-01-01', 'description': 'Osservazione precedente'})
            seed['photos'].append({'treeId': 'LES-' + str(i).zfill(6), 'relativePath': 'Foto/LES-' + str(i).zfill(6) + '/precedente.png', 'originalName': 'precedente.png', 'date': '2020-01-01'})
        for photo in seed['photos']:
            assert rpc('photoPut', revision='empty', path=photo['relativePath'], base64=PNG, mime='image/png')['ok']
        assert rpc('save', revision='empty', data=seed)['ok']
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            errors = []

            def new_page(device=None):
                settings = p.devices[device] if device else {'viewport': {'width': 1440, 'height': 1000}}
                context = browser.new_context(**settings, timezone_id='Europe/Rome')
                if device == 'iPhone 13':
                    context.add_init_script("""(() => {const viewport=new EventTarget();Object.assign(viewport,{width:390,height:620,offsetTop:88,offsetLeft:0});Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});})();""")
                actions = []

                def bridge(route):
                    if route.request.url == ENDPOINT:
                        body = route.request.post_data
                        actions.append(json.loads(body)['action'])
                        request = urllib.request.Request('http://127.0.0.1:8766/', data=body.encode())
                        with urllib.request.urlopen(request) as response:
                            route.fulfill(status=200, content_type='application/json', body=response.read())
                    elif route.request.url.startswith(base):
                        route.continue_()
                    else:
                        route.abort()

                context.route('**/*', bridge)
                page = context.new_page()
                page.actions = actions
                page.dialogs = []
                page.cancel_next = False

                def dialog_handler(dialog):
                    page.dialogs.append((dialog.type, dialog.message))
                    if page.cancel_next:
                        page.cancel_next = False
                        dialog.dismiss()
                    else:
                        dialog.accept()

                page.on('dialog', dialog_handler)
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(base)
                page.locator('#driveKey').fill(KEY)
                page.locator('#driveConnect').click()
                page.wait_for_function("document.body.classList.contains('driveConnected')")
                return page

            def open_admin(page):
                page.locator('#adminOpen').click()
                page.locator('#adminPassword').fill(ADMIN)
                page.locator('#adminLoginButton').click()
                page.locator('#adminTreeSearch').wait_for(state='visible')
                assert page.locator('#adminPassword').input_value() == ''

            def pick(page, ident):
                page.locator('[data-admin-tree="' + ident + '"]').check()

            def delete(page, double=False):
                page.dialogs.clear()
                saves = page.actions.count('save')
                if double:
                    page.evaluate("document.getElementById('adminDeleteTree').click();document.getElementById('adminDeleteTree').click()")
                else:
                    page.locator('#adminDeleteTree').click()
                page.wait_for_function("!document.getElementById('adminClose').disabled")
                assert [kind for kind, _ in page.dialogs] == ['confirm'], page.dialogs
                return saves

            # La Guida non contiene comandi o istruzioni di amministrazione.
            for label, device in [('desktop', None), ('iphone', 'iPhone 13'), ('ipad', 'iPad Mini')]:
                page = new_page(device)
                nav = '[data-mobile-view="guida"]' if device else '.mainNav [data-view="guida"]'
                snapshot = page.evaluate('JSON.stringify({trees,historyEvents,photos,seq})')
                actions = len(page.actions)
                page.locator(nav).click()
                assert page.locator('#viewGuida').is_visible()
                assert page.locator(nav).get_attribute('aria-current') == 'page'
                assert page.evaluate('currentSection') == 'guida'
                assert page.locator('#viewRiepilogo').is_hidden() and page.locator('#viewArchivio').is_hidden()
                assert page.locator('#viewGuida').get_by_text('Amministrazione', exact=False).count() == 0
                assert page.locator('#viewGuida').get_by_text('cancellare', exact=False).count() == 0
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                assert len(page.actions) == actions
                if device:
                    box = page.locator(nav).bounding_box()
                    assert box['width'] >= 44 and box['height'] >= 44
                page.locator('#toast').wait_for(state='hidden')
                page.screenshot(path=str(ARTIFACTS / ('guide-' + label + '.png')), full_page=False)
                page.locator('[data-guide-section="guida-foto"]').click()
                assert page.evaluate("document.activeElement.id") == 'guida-foto'
                page.locator('[data-guide-view="censimento"]').click()
                page.evaluate('v2SelectCensus(trees[0].id)')
                page.locator('#v2CensusOperator').fill('Bozza non salvata')
                page.locator(nav).click()
                page.locator('[data-guide-view="censimento"]').click()
                assert page.locator('#v2CensusOperator').input_value() == 'Bozza non salvata'
                assert page.evaluate('JSON.stringify({trees,historyEvents,photos,seq})') == snapshot
                assert page.actions.count('save') == 0
                page.context.close()
            print('PASS: tab Guida su PC/iPhone/iPad, testi solo per utenti, collegamenti e bozze conservati senza scritture')

            page = new_page()
            page.locator('#adminOpen').click()
            page.locator('#adminPassword').fill('non-valida')
            page.locator('#adminLoginButton').click()
            assert page.locator('#adminLoginError').is_visible() and page.locator('#adminContent').is_hidden()
            page.locator('#adminPassword').fill(ADMIN)
            page.locator('#adminLoginButton').click()
            pick(page, 'LES-000001')
            before = rpc('load')['data']
            page.cancel_next = True
            delete(page)
            assert rpc('load')['data'] == before
            assert page.evaluate("localStorage.getItem('LesmoAdminV2Trash')") is None
            saves = delete(page)
            page.wait_for_function("document.getElementById('adminStatus').textContent.startsWith('Albero eliminato.')")
            assert page.actions.count('save') == saves + 1
            data = rpc('load')['data']
            assert {tree['id'] for tree in data['trees']} == {'LES-000003', 'LES-000005'}
            trash = page.evaluate("JSON.parse(localStorage.getItem('LesmoAdminV2Trash'))")
            assert trash[0]['tree'] == seed['trees'][0]
            assert trash[0]['history'] == [event for event in seed['history'] if event['treeId'] == 'LES-000001']
            assert trash[0]['photos'] == [photo for photo in seed['photos'] if photo['treeId'] == 'LES-000001']
            page.dialogs.clear()
            page.locator('[data-restore-tree="LES-000001"]').click()
            page.wait_for_function("document.getElementById('adminStatus').textContent.startsWith('Albero ripristinato')")
            assert [kind for kind, _ in page.dialogs] == ['confirm']
            restored = rpc('load')['data']
            assert [event for event in restored['history'] if event['treeId'] == 'LES-000001'] == [event for event in seed['history'] if event['treeId'] == 'LES-000001']
            assert [photo for photo in restored['photos'] if photo['treeId'] == 'LES-000001'] == [photo for photo in seed['photos'] if photo['treeId'] == 'LES-000001']
            assert rpc('photoGet', path=seed['photos'][0]['relativePath'])['result']['base64'] == PNG
            print('PASS: password solo all’ingresso, annullamento senza scritture, cancellazione e ripristino con una conferma e foto/storico conservati')

            page.locator('#adminTreeSearch').fill('Roma')
            page.locator('#adminSelectAll').check()
            assert page.locator('#adminSelectionCount').inner_text() == '2 alberi selezionati'
            saves = delete(page, double=True)
            page.wait_for_function("document.getElementById('adminStatus').textContent.startsWith('2 alberi eliminati')")
            assert page.actions.count('save') == saves + 1
            data = rpc('load')['data']
            assert data['trees'] == [seed['trees'][2]]
            assert data['history'] == [event for event in seed['history'] if event['treeId'] == 'LES-000005']
            assert data['photos'] == [photo for photo in seed['photos'] if photo['treeId'] == 'LES-000005']
            assert len(page.evaluate("JSON.parse(localStorage.getItem('LesmoAdminV2Trash'))")) == 2
            page.locator('#adminTreeSearch').fill('')
            page.screenshot(path=str(ARTIFACTS / 'admin-desktop.png'), full_page=False)
            print('PASS: selezione multipla filtrata, un solo salvataggio anche con doppio clic, alberi non selezionati invariati')

            # Un nuovo albero occupa il codice liberato: il recupero non deve sostituirlo.
            page.locator('#adminClose').click()
            page.evaluate('v2OpenAnag(null)')
            page.locator('#v2AnagOverlay').wait_for(state='visible')
            assert page.locator('#v2AnaCode').input_value() == 'LESMO-A0001'
            page.locator('#v2AnaSpecies').fill('Nuovo acero')
            page.locator('#v2AnaSave').click()
            page.wait_for_function('!v2AnagBusy && trees.length === 2')
            open_admin(page)
            page.dialogs.clear()
            page.locator('[data-restore-tree="LES-000001"]').click()
            assert 'già presente' in page.locator('#adminStatus').inner_text()
            assert page.dialogs == []
            page.locator('[data-restore-tree="LES-000003"]').click()
            page.wait_for_function('trees.length === 3')
            assert [kind for kind, _ in page.dialogs] == ['confirm']
            print('PASS: il cestino resta dopo la riapertura e un codice riutilizzato impedisce ripristini che creerebbero duplicati')

            # Un salvataggio concorrente viene respinto dal vero Code.gs.
            pick(page, 'LES-000003')
            client_before = page.evaluate('JSON.stringify({trees,historyEvents,photos,seq,lastSaved})')
            trash_before = page.evaluate("localStorage.getItem('LesmoAdminV2Trash')")
            current = rpc('load')
            remote = copy.deepcopy(current['data'])
            remote['trees'][0]['notes'] = 'Modifica di un altro collaboratore'
            assert rpc('save', revision=current['revision'], data=remote)['ok']
            delete(page)
            page.wait_for_function("document.getElementById('adminStatus').textContent.startsWith('Eliminazione non confermata')")
            assert rpc('load')['data'] == remote
            assert page.evaluate('JSON.stringify({trees,historyEvents,photos,seq,lastSaved})') == client_before
            assert page.evaluate("localStorage.getItem('LesmoAdminV2Trash')") == trash_before
            page.context.close()
            print('PASS: conflitto Drive senza cancellazioni parziali, con elenco e cestino precedenti conservati')

            # Nessuna cancellazione se il browser non può conservare la copia recuperabile.
            page = new_page()
            open_admin(page)
            pick(page, 'LES-000003')
            before = rpc('load')['data']
            page.evaluate("() => {window.oldSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='LesmoAdminV2Trash')throw Error('Memoria piena di prova');return window.oldSetItem.call(this,key,value)}}")
            saves = delete(page)
            page.wait_for_function("document.getElementById('adminStatus').textContent.includes('Memoria piena')")
            assert rpc('load')['data'] == before and page.actions.count('save') == saves
            page.evaluate('() => {Storage.prototype.setItem=window.oldSetItem}')
            print('PASS: memoria del browser esaurita blocca l’eliminazione prima di modificare i dati')

            # Il server salva ma la risposta si perde: la copia deve rimanere recuperabile.
            def lost_response(route):
                body = route.request.post_data
                if json.loads(body)['action'] == 'save':
                    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8766/', data=body.encode())) as response:
                        assert json.load(response)['ok']
                    route.abort()
                else:
                    route.fallback()
            page.route(ENDPOINT, lost_response)
            delete(page)
            page.wait_for_function("document.getElementById('adminStatus').textContent.startsWith('Eliminazione non confermata')")
            assert not any(tree['id'] == 'LES-000003' for tree in rpc('load')['data']['trees'])
            assert page.evaluate("trees.some(tree=>tree.id==='LES-000003')")
            assert page.evaluate("JSON.parse(localStorage.getItem('LesmoAdminV2Trash')).some(entry=>entry.tree.id==='LES-000003'&&entry.pending)")
            page.unroute(ENDPOINT, lost_response)
            page.locator('#adminClose').click()
            page.evaluate("switchSection('anagrafica')")
            page.locator('#driveRefreshRegistry').click()
            page.wait_for_function("!trees.some(tree=>tree.id==='LES-000003')")
            open_admin(page)
            page.locator('[data-restore-tree="LES-000003"]').click()
            page.wait_for_function("trees.some(tree=>tree.id==='LES-000003')")
            assert any(event['treeId'] == 'LES-000003' for event in rpc('load')['data']['history'])
            page.locator('#adminLogout').click()
            assert page.locator('#adminLogin').is_visible() and page.locator('#adminContent').is_hidden()
            assert not errors, errors
            print('PASS: risposta di rete persa conserva una copia recuperabile; uscire da Admin richiede un nuovo accesso')
            mobile = new_page('iPhone 13')
            open_admin(mobile)
            mobile.locator('[data-admin-tree]').nth(0).check()
            mobile.locator('[data-admin-tree]').nth(1).check()
            assert mobile.locator('#adminSelectionCount').inner_text() == '2 alberi selezionati'
            assert mobile.locator('#adminShowMore').is_hidden()
            before = rpc('load')['data']
            mobile.cancel_next = True
            delete(mobile)
            assert rpc('load')['data'] == before
            mobile.locator('.adminDialog').evaluate('e => e.scrollTop = e.scrollHeight')
            box = mobile.locator('#adminClose').bounding_box()
            assert box['width'] >= 44 and box['height'] >= 44
            assert box['y'] >= 88
            mobile.screenshot(path=str(ARTIFACTS / 'admin-iphone.png'), full_page=False)
            mobile.locator('#adminClose').click()
            assert not mobile.locator('#app').evaluate('e => e.inert')
            print('PASS: selezione multipla e annullamento su iPhone; chiusura raggiungibile dopo lo scorrimento sotto la barra URL')
            print('Anteprime:', ARTIFACTS)
            browser.close()
    finally:
        server.shutdown()
        service.terminate()
        service.wait(timeout=5)


if __name__ == '__main__':
    main()
