"""Registro e suggerimento mappa: browser reale, Drive simulato, nessun dato remoto."""
import csv
import functools
import http.server
import json
import pathlib
import re
import subprocess
import tempfile
import threading
import urllib.request
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright
from browser_support import mock_admin_login

ROOT = pathlib.Path(__file__).resolve().parents[1]
KEY = 'test-only-key-not-for-production-0123456789'
ENDPOINT = re.search(r"const DEFAULT_DRIVE_URL = '([^']+)'", (ROOT / 'drive-storage.js').read_text()).group(1)
ARTIFACTS = pathlib.Path(tempfile.gettempdir()) / 'lesmo-registry'

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

def rpc(action, **payload):
    request = urllib.request.Request('http://127.0.0.1:8766/', data=json.dumps({'action': action, 'key': KEY, **payload}).encode())
    with urllib.request.urlopen(request) as response:
        return json.load(response)

def main():
    ARTIFACTS.mkdir(exist_ok=True)
    service = subprocess.Popen(['node', str(ROOT / 'tests/drive-runtime.cjs')], stdout=subprocess.PIPE, text=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        assert service.stdout.readline().strip() == 'Drive test runtime ready'
        trees = [{'id': f'LES-{i:06}', 'code': f'LESMO-A{i:04}', 'species': ['Tiglio', 'Abete', 'Quercia'][i % 3],
                  'address': ['Via Roma', 'Via Milano', 'Via Olmo'][i % 3], 'status': ['ok', 'watch', 'sick'][i % 3],
                  'lat': 45.648 if i % 2 else None, 'lon': 9.305 if i % 2 else None,
                  'date': f'2026-10-{i % 28 + 1:02}' if i % 5 else '',
                  'modified': f'2026-11-{i % 2 + 1:02}T10:00:00Z' if i % 5 else '', 'created': '',
                  'height': i % 12, 'diameter': i % 20 + 2, 'crownDiameter': i % 8, 'priority': 'high' if i % 3 == 0 else '',
                  'notes': 'Potatura già eseguita' if i % 2 else 'Verifica programmata'} for i in range(1, 68)]
        trees[0]['species'] = 'Tiglio 2'; trees[9]['species'] = 'Tiglio 10'
        trees[-1]['address'] = 'Via "Olmo" & <img src=x onerror="window.injected=1">'
        photos = [{'id': f'photo-{i}-{p}', 'treeId': f'LES-{i:06}', 'relativePath': f'Foto/{i}/{p}.png'} for i in range(1, 68) for p in range(i % 11)]
        events = [{'id': f'event-{i}-{n}', 'treeId': f'LES-{i:06}', 'type': 'censimento', 'date': f'2026-10-{i % 28 + 1:02}'} for i in range(1, 68) if i % 5 for n in range(i % 13)]
        events.extend([
            {'id':'plant1','treeId':'LES-000001','type':'piantumazione','date':'2024-04-15'},
            {'id':'plant2','treeId':'LES-000002','type':'piantumazione','date':'2025-04-15'},
            {'id':'loss1','treeId':'LES-000001','type':'morte','date':'2025-06-01'},
            {'id':'loss1-later','treeId':'LES-000001','type':'abbattimento','date':'2026-06-01'},
            {'id':'loss3','treeId':'LES-000003','type':'caduta','date':'2026-06-01'}
        ])
        seed = {'schema': 4, 'nextId': 68, 'trees': trees, 'photos': photos, 'history': events}
        for photo in photos:
            assert rpc('photoPut', revision='empty', path=photo['relativePath'], base64='aGVsbG8=', mime='image/png')['ok']
        saved = rpc('save', revision='empty', data=seed)
        assert saved['ok'], saved
        before = rpc('load')
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            errors, writes = [], []
            def new_page(mobile=False, width=1440):
                settings = {**p.devices['iPhone 13'], 'viewport': {'width': width, 'height': 844}} if mobile else {'viewport': {'width': width, 'height': 1000}}
                context = browser.new_context(**settings)
                def bridge(route):
                    if route.request.url == ENDPOINT:
                        body = route.request.post_data
                        action = json.loads(body)['action']
                        if action not in ['load', 'photoGet']: writes.append(action)
                        request = urllib.request.Request('http://127.0.0.1:8766/', data=body.encode())
                        with urllib.request.urlopen(request) as response:
                            route.fulfill(status=200, content_type='application/json', body=response.read())
                    elif route.request.url.startswith(base): route.continue_()
                    else: route.abort()
                context.route('**/*', bridge)
                mock_admin_login(context)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(base)
                page.locator('#driveKey').fill(KEY); page.locator('#driveConnect').click()
                page.wait_for_function("document.body.classList.contains('driveConnected')")
                page.evaluate("switchSection('anagrafica')")
                return page

            page = new_page()
            def cells(column): return page.locator(f'#overviewRows tr td:nth-child({column})').all_text_contents()
            def codes(): return page.locator('#overviewRows [data-tree]').all_text_contents()
            def sort(key): page.locator(f'[data-registry-sort="{key}"]').click()
            assert page.locator('#registrySummary').inner_text() == '67 di 67 schede'
            page.locator('#v21PageSize').select_option('25')
            assert len(codes()) == 25 and codes()[0] == 'LESMO-A0001'
            page.locator('#nextPage').click(); assert codes()[0] == 'LESMO-A0026'
            sort('code'); assert codes()[0] == 'LESMO-A0067'
            assert page.locator('#pageInfo').inner_text() == 'Pagina 1 di 3'
            sort('code'); page.locator('#v21PageSize').select_option('250')
            assert codes() == [f'LESMO-A{i:04}' for i in range(1, 68)]
            sort('species'); species = cells(2)
            assert species[0] == 'Abete' and species.index('Tiglio 2') < species.index('Tiglio 10')
            sort('species'); assert cells(2)[0] == 'Tiglio 10'
            sort('address'); assert [v for v in cells(3) if v in ['Via Milano', 'Via Olmo', 'Via Roma']] == sorted(v for v in cells(3) if v in ['Via Milano', 'Via Olmo', 'Via Roma'])
            sort('address'); assert cells(3)[0] == 'Via Roma'
            sort('status'); assert cells(4)[0] == 'Da monitorare'
            sort('status'); assert cells(4)[0] == 'Sano'
            sort('gps'); assert 'Mappa' in cells(5)[0] and 'Da posizionare' in cells(5)[-1]
            sort('gps'); assert 'Da posizionare' in cells(5)[0] and 'Mappa' in cells(5)[-1]
            for key, column in [('photos', 6), ('surveys', 7)]:
                sort(key); values = list(map(int, cells(column))); assert values == sorted(values, reverse=True)
                sort(key); values = list(map(int, cells(column))); assert values == sorted(values)
            for key, column in [('surveyDate', 8), ('modified', 9)]:
                for descending in [True, False]:
                    sort(key); values = cells(column); known = [v for v in values if v != '—']
                    assert known and '—' in values and values[-1] == '—'
                    assert known == sorted(known, key=lambda v: datetime.strptime(v, '%d/%m/%Y'), reverse=descending)
            header = page.locator('[data-registry-sort="code"]'); header.focus(); header.press('Enter')
            assert header.locator('..').get_attribute('aria-sort') == 'ascending'
            header.press('Space'); assert header.locator('..').get_attribute('aria-sort') == 'descending'
            print('PASS: tutte le 9 colonne, entrambe le direzioni, numeri naturali, dati mancanti in fondo, tastiera e pagine', flush=True)

            # Filtri combinati, ricerca senza distinzione di accenti e selezioni multiple.
            page.locator('#overviewStatus').evaluate("e=>{e.value='ok';e.dispatchEvent(new Event('change',{bubbles:true}))}")
            page.locator('#overviewLocation').select_option('nogeo')
            page.locator('#v21PhotoFilter').select_option('without')
            expected = [t['code'] for t in trees if t['status'] == 'ok' and t['lat'] is None and int(t['id'][-6:]) % 11 == 0]
            assert codes() == sorted(expected, reverse=True)
            assert page.locator('#registryActiveFilters button').count() == 3
            page.locator('#v21ResetFilters').click()
            assert header.locator('..').get_attribute('aria-sort') == 'descending'  # Azzera i filtri, conserva l'ordine.
            facet = page.locator('[data-registry-facet="species"]')
            facet.locator('summary').click()
            facet.locator('input[type=search]').fill('tiglio')
            assert facet.locator('.registryFacetOption').count() == 3
            facet.locator('input[value="Tiglio 2"]').check(); facet.locator('input[value="Tiglio 10"]').check()
            assert set(codes()) == {'LESMO-A0001', 'LESMO-A0010'}
            facet.locator('input[type=search]').press('Escape'); assert not facet.evaluate('e => e.open')
            page.locator('[data-registry-remove="species"][data-value="Tiglio 2"]').click()
            assert codes() == ['LESMO-A0010']
            page.locator('#v21ResetFilters').click()
            address = page.locator('[data-registry-facet="address"]'); address.locator('summary').click()
            address.locator('input[type=search]').fill('milano'); address.locator('input[type=checkbox]').check()
            assert all(v == 'Via Milano' for v in cells(3))
            assert page.locator('#overviewStatus option[value="watch"]').inner_text().endswith('(22)')
            page.locator('#overviewSearch').fill('verifica programmata'); assert all(int(c[-4:]) % 2 == 0 for c in codes())
            page.locator('#overviewSearch').fill('non-esiste-questa-ricerca')
            assert page.locator('.registryEmpty').is_visible() and page.locator('#downloadTable').is_disabled()
            page.locator('[data-registry-reset]').click(); assert len(codes()) == 67
            page.locator('#overviewSearch').fill('potatura gia'); assert len(codes()) == 34
            page.locator('#v21ResetFilters').click()
            assert page.locator('#overviewRows img').count() == 0
            address.locator('summary').click(); assert address.locator('img').count() == 0
            assert not page.evaluate('window.injected || false')
            address.locator('summary').click()
            print('PASS: ricerca, filtri combinati, specie multiple, ricerca vie, conteggi contestuali, chip e nessun risultato', flush=True)

            # L'esportazione contiene tutti i risultati, non solo la pagina corrente.
            page.locator('#v21PageSize').select_option('25')
            page.locator('#overviewStatus').evaluate("e=>{e.value='watch';e.dispatchEvent(new Event('change',{bubbles:true}))}")
            sort('code')  # crescente
            expected = [t['code'] for t in trees if t['status'] == 'watch']
            with page.expect_download() as download:
                page.locator('#downloadTable').click()
            with open(download.value.path(), encoding='utf-8-sig', newline='') as stream: exported = list(csv.reader(stream, delimiter=';'))
            assert [r[0] for r in exported[1:]] == expected
            page.locator('#v21ResetFilters').click()
            with page.expect_download() as download: page.locator('#downloadTable').click()
            with open(download.value.path(), encoding='utf-8-sig', newline='') as stream: exported = list(csv.reader(stream, delimiter=';'))
            assert len(exported) == 68 and len(codes()) == 25
            page.locator('#overviewSearch').fill('Tiglio'); page.locator('[data-registry-facet="species"] summary').click()
            page.screenshot(path=str(ARTIFACTS / 'registry-desktop.png'), full_page=False)
            page.locator('[data-registry-facet="species"] summary').click(); page.locator('#v21ResetFilters').click()
            page.locator('#overviewRows [data-tree]').first.click()
            assert page.locator('#v2DetailOverlay').is_visible(); page.locator('#v2DetailClose').click()
            page.locator('.registryColumns summary').click()
            page.locator('[data-registry-columns="all"]').click()
            assert page.locator('#overviewTable th').count() == 32
            sort('diameter')
            visible_keys=page.locator('[data-registry-sort]').evaluate_all('es=>es.map(e=>e.dataset.registrySort)')
            diameter_column=visible_keys.index('diameter')+1
            values=list(map(int,cells(diameter_column)));assert values==sorted(values)
            sort('diameter');values=list(map(int,cells(diameter_column)));assert values==sorted(values,reverse=True)
            page.locator('.registryColumns summary').click()
            page.locator('[data-registry-columns="default"]').click()
            assert page.locator('#overviewTable th').count() == 11
            page.locator('.registryColumns summary').click()
            page.locator('[data-registry-edit]').first.click()
            assert page.locator('#v2AnagOverlay').is_visible()
            page.locator('#v2AnagClose').click()
            print('PASS: CSV filtrato e ordinato su tutte le pagine, apertura scheda conservata', flush=True)

            # Statistiche: conteggi, torte, dati di dettaglio, drill-down e bilancio senza doppie perdite.
            page.locator('.mainNav [data-view="statistiche"]').click()
            page.locator('[data-mun-category="trees"]').click()
            metrics=page.locator('.analyticsMetric > strong').all_text_contents()
            assert metrics[:4] == ['67','67','45','5'], metrics
            assert sum(int(v) for v in page.locator('#analyticsHealth .analyticsLegend strong').all_text_contents()) == 67
            assert page.locator('#analyticsHealth svg').count() == 1
            page.locator('[data-species-view="pie"]').click()
            assert page.locator('#analyticsSpecies svg').count() == 1
            assert sum(int(v) for v in page.locator('#analyticsSpecies .analyticsLegend strong').all_text_contents()) == 67
            page.locator('[data-species-view="bars"]').click()
            page.locator('#analyticsActivityYear').select_option('2025')
            assert page.locator('#analyticsActivityInfo').inner_text() == '0 rilievi · 1 intervento'
            page.locator('#analyticsActivityYear').select_option('2026')
            assert page.locator('#analyticsActivity svg rect').count() == 24
            page.locator('#analyticsBalance .analyticsChartData summary').click()
            assert page.locator('#analyticsBalance tbody tr').all_text_contents() == ['202410+1','2025110','202601-1']
            page.locator('#analyticsBalance .analyticsChartData summary').click()
            assert not page.locator('#statisticsDashboard').evaluate("e=>e.innerHTML.includes('NaN') || e.innerHTML.includes('Infinity')")
            page.locator('.analyticsHeading').evaluate("e=>e.scrollIntoView({block:'start'})")
            page.screenshot(path=str(ARTIFACTS/'statistics-desktop.png'))
            page.locator('#analyticsHealth [data-value="watch"]').click()
            assert page.locator('#overviewStatus').input_value() == 'watch' and len(codes()) == 23
            page.locator('.mainNav [data-view="statistiche"]').click()
            page.locator('[data-mun-category="trees"]').click()
            page.locator('[data-analytics-filter="overviewStatus"][data-value="attention"]').click()
            assert page.locator('#overviewStatus').input_value() == 'attention'
            assert page.locator('#registrySummary').inner_text() == '45 di 67 schede'
            page.locator('#v21ResetFilters').click()
            # Zero record non deve generare percentuali o grafici non validi.
            empty_page=new_page()
            empty_page.evaluate("trees=[];photos=[];historyEvents=[];renderDashboard();switchSection('statistiche')")
            empty_page.locator('[data-mun-category="trees"]').click()
            assert empty_page.locator('.analyticsMetric > strong').all_text_contents() == ['0']*6
            assert 'NaN' not in empty_page.locator('#statisticsDashboard').inner_html()
            assert 'Infinity' not in empty_page.locator('#statisticsDashboard').inner_html()
            empty_page.context.close()
            print('PASS: statistiche, torta/barre, percentuali, anni, dati accessibili, bilancio senza doppie perdite e apertura elenco',flush=True)

            # Durata esatta del suggerimento, cursore, annullamento e apertura scheda.
            page.clock.install()
            page.clock.pause_at(datetime.now(timezone.utc) + timedelta(seconds=60))
            page.locator('.mainNav [data-view="mappa"]').click()
            page.locator('#manualHeader').click(); page.locator('#chooseMapTree').click()
            box = page.locator('#map').bounding_box(); x, y = box['x'] + box['width'] - 160, box['y'] + 300
            page.mouse.move(x, y)
            assert page.locator('#mapSelectionNotice').is_visible() and page.locator('#mapSelectionCursor').is_hidden()
            page.clock.run_for(9999)
            assert page.locator('#mapSelectionNotice').is_visible()
            page.clock.run_for(1)
            assert page.locator('#mapSelectionNotice').is_hidden() and page.locator('#mapSelectionCursor').is_visible()
            assert page.locator('#mapSelectionCursor').inner_text() == 'Seleziona albero'
            page.mouse.move(x-100, y+30)
            tip = page.locator('#mapSelectionCursor').bounding_box(); assert abs(tip['x']-(x-100+18)) < 2
            page.locator('#cancelMapAdd').click(); assert page.locator('#mapSelectionCursor').is_hidden()
            page.locator('#manualHeader').click(); page.locator('#chooseMapTree').click()
            page.locator('#cancelMapAdd').click(); page.clock.run_for(10000)
            assert page.locator('#mapSelectionNotice').is_hidden() and page.locator('#mapSelectionCursor').is_hidden()
            page.locator('#manualHeader').click(); page.locator('#chooseMapTree').click()
            page.clock.run_for(10000)
            point=page.evaluate('''() => {const map=document.getElementById('map'),r=map.getBoundingClientRect();for(const fx of [.55,.65,.75,.45])for(const fy of [.5,.6,.7]){const x=r.x+r.width*fx,y=r.y+r.height*fy,e=document.elementFromPoint(x,y);if(e&&(e===map||e.classList.contains('tile')||e.id==='tiles'||e.id==='pins'))return {x,y};}throw Error('Nessun punto libero');}''')
            page.mouse.click(point['x'],point['y'])
            page.locator('#v2AnagOverlay').wait_for(state='visible')
            assert page.locator('#v2AnagOverlay').is_visible() and page.locator('#mapSelectionCursor').is_hidden()
            print('PASS: avviso per esattamente 10 secondi, etichetta al cursore, pulizia su annullamento e selezione', flush=True)
            page.context.close()

            for width in [320, 390]:
                mobile = new_page(True, width)
                mobile.locator('#v21Sort').select_option('photos')
                assert mobile.locator('#overviewRows [data-tree]').count() == 50
                assert mobile.locator('#overviewRows [data-tree]').first.inner_text() == 'LESMO-A0010'
                mobile.locator('#registrySortDirection').click()
                assert mobile.locator('#overviewRows [data-tree]').first.inner_text() == 'LESMO-A0011'
                mobile.locator('#overviewSearch').fill('LESMO-A0001')
                assert mobile.locator('#overviewRows [data-tree]').count() == 1
                mobile.locator('#mobileRegistryFilters > summary').click()
                facet = mobile.locator('[data-registry-facet="species"]'); facet.locator('summary').click()
                rect = facet.locator('.registryFacetPanel').bounding_box(); assert rect['x'] >= 0 and rect['x'] + rect['width'] <= width
                mobile.screenshot(path=str(ARTIFACTS / f'registry-mobile-{width}.png'), full_page=False)
                assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
                mobile.locator('[data-mobile-view="statistiche"]').click()
                mobile.locator('[data-mun-category="trees"]').click()
                assert mobile.locator('#analyticsHealth svg').is_visible()
                assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
                mobile.screenshot(path=str(ARTIFACTS / f'statistics-mobile-{width}.png'))
                mobile.locator('[data-mobile-view="anagrafica"]').click()
                mobile.locator('#mAddNewTree').click(); mobile.locator('#chooseMapTree').click()
                assert mobile.locator('#mapSelectionNotice').is_hidden()
                mobile.context.close()
            assert not errors, errors
            assert not writes, writes
            assert rpc('load') == before
            print('PASS: iPhone 320/390, ordinamento schede, filtri senza overflow; nessuna scrittura su Drive', flush=True)
            browser.close()
    finally:
        server.shutdown(); service.terminate(); service.wait(timeout=10)

if __name__ == '__main__': main()
