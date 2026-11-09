"""Persistenza osservazioni, gruppi georiferiti e diametro equivalente. Solo Drive simulato."""
import base64
import csv
import functools
import http.server
import json
import math
import pathlib
import re
import subprocess
import tempfile
import threading
import urllib.request
from playwright.sync_api import sync_playwright

ROOT=pathlib.Path(__file__).resolve().parents[1]
KEY='test-only-key-not-for-production-0123456789'
ENDPOINT=re.search(r"const DEFAULT_DRIVE_URL = '([^']+)'",(ROOT/'drive-storage.js').read_text()).group(1)
ARTIFACTS=pathlib.Path(tempfile.gettempdir())/'lesmo-groups'
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_): pass

def rpc(action,**payload):
    request=urllib.request.Request('http://127.0.0.1:8766/',data=json.dumps({'action':action,'key':KEY,**payload}).encode())
    with urllib.request.urlopen(request) as response:return json.load(response)
def data():return rpc('load')['result']['data']

def main():
    ARTIFACTS.mkdir(exist_ok=True)
    service=subprocess.Popen(['node',str(ROOT/'tests/drive-runtime.cjs')],stdout=subprocess.PIPE,text=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    try:
        assert service.stdout.readline().strip()=='Drive test runtime ready'
        original='Primo rilievo: cipresso vicino al cancello.\nPresenza di edera.'
        seed={'schema':4,'nextId':2,'trees':[{'id':'LES-000001','code':'LESMO-A0001','species':'Cipresso','status':'ok','notes':'Nota più recente','crownDiameter':7.5,'siteType':'parco','nextCheck':'2026-12-20','date':'2026-10-20','lat':None,'lon':None}],
              'history':[{'id':'first','treeId':'LES-000001','type':'censimento','date':'2026-10-10','description':original,'snapshot':{'notes':original}},
                         {'id':'later','treeId':'LES-000001','type':'rilievo','date':'2026-10-20','description':'Nota più recente'}],'photos':[]}
        assert rpc('save',revision='empty',data=seed)['ok']
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            errors=[]
            def page_new(mobile=False):
                context=browser.new_context(**(p.devices['iPhone 13'] if mobile else {'viewport':{'width':1440,'height':1000}}))
                def bridge(route):
                    if route.request.url==ENDPOINT:
                        request=urllib.request.Request('http://127.0.0.1:8766/',data=route.request.post_data.encode())
                        with urllib.request.urlopen(request) as response:route.fulfill(status=200,content_type='application/json',body=response.read())
                    elif route.request.url.startswith(base):route.continue_()
                    else:route.abort()
                context.route('**/*',bridge)
                page=context.new_page();page.set_default_timeout(7000);page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base);page.locator('#driveKey').fill(KEY);page.locator('#driveConnect').click()
                page.wait_for_function("document.body.classList.contains('driveConnected')")
                return page
            page=page_new()
            with page.expect_download() as download:page.evaluate('expCSV()')
            with open(download.value.path(),encoding='utf-8-sig',newline='') as stream:exported=list(csv.DictReader(stream,delimiter=';'))
            assert exported[0]['initialObservationNotes']==original
            def saved():
                try:page.locator('#v2AnagOverlay').wait_for(state='hidden')
                except Exception:
                    print('SAVE DIAGNOSTIC',page.locator('#toast').inner_text(),page.locator('#v2AnagForm :invalid').evaluate_all('els=>els.map(e=>[e.id,e.validationMessage,e.value])'),errors,flush=True)
                    raise
            def manual():
                page.locator('#manualHeader').click();page.locator('#chooseManualTree').click()
            page.locator('#overviewRows [data-tree="LES-000001"]').click()
            metrics=page.locator('#v2DetailContent .v2DetailCell').evaluate_all('cells=>Object.fromEntries(cells.map(c=>[c.querySelector("small").textContent,c.querySelector("b").textContent]))')
            assert metrics['Contesto']=='Parco o area verde' and metrics['Diametro chioma']=='7,5 m'
            assert 'Eventi' not in metrics and metrics['Prossima verifica']=='2026-12-20'
            page.locator('#v2DetailClose').click()
            page.locator('[data-registry-edit="LES-000001"]').click()
            assert page.locator('#v21InitialNotes').is_visible()
            assert page.locator('#v21InitialNotes').input_value()==original
            corrected=original+'\nControllare la base.'
            page.locator('#v21InitialNotes').fill(corrected);page.locator('#v2AnaSave').click();saved()
            record=data()['trees'][0]
            assert record['initialObservationNotes']==corrected and record['notes']=='Nota più recente'
            assert next(e for e in data()['history'] if e['id']=='first')['description']==original
            page.locator('[data-registry-edit="LES-000001"]').click();assert page.locator('#v21InitialNotes').input_value()==corrected
            page.locator('#v2AnagClose').click()
            print('PASS: osservazioni del primo rilievo recuperate dallo storico, visibili in Anagrafica e salvate anche modificando solo quelle',flush=True)

            # Gruppo di 50: bozze conservate andando sulla mappa, forma chiusa e codice unico.
            manual();page.locator('#v2AnaSpecies').fill('Cipressini');page.locator('#groupRecordType').select_option('group')
            page.locator('#groupTreeCount').fill('50');page.locator('#v2AnaSite').select_option(label='Parco o area verde');page.locator('#v21InitialCrown').fill('7,5');page.locator('#v21InitialNotes').fill('Filare di 50 cipressini lungo il confine.')
            code=page.locator('#v2AnaCode').input_value()
            page.locator('#v2AnaPhotoFiles').set_input_files({'name':'gruppo.png','mimeType':'image/png','buffer':base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==')})
            page.locator('#groupDrawArea').click()
            rect=page.locator('#map').bounding_box()
            for fx,fy in [(.4,.5),(.65,.5),(.65,.75),(.4,.75)]:page.mouse.click(rect['x']+rect['width']*fx,rect['y']+rect['height']*fy)
            assert page.locator('#groupAreaPointCount').inner_text().startswith('4 vertici')
            page.locator('#groupAreaConfirm').click()
            assert page.locator('#v2AnaSpecies').input_value()=='Cipressini'
            assert page.locator('#groupTreeCount').input_value()=='50'
            assert page.locator('#v21InitialNotes').input_value()=='Filare di 50 cipressini lungo il confine.'
            page.locator('#v2AnaSave').click();saved()
            group=next(t for t in data()['trees'] if t['code']==code)
            assert group['recordType']=='group' and group['treeCount']==50 and not group['countEstimated']
            assert group['geometry']['type']=='Polygon' and group['geometry']['coordinates'][0][0]==group['geometry']['coordinates'][0][-1]
            assert len(group['geometry']['coordinates'][0])==5
            assert sum(p['treeId']==group['id'] for p in data()['photos'])==1
            page.locator('.mainNav [data-view="mappa"]').click()
            page.locator('#groupAreas [data-group-id]').wait_for(state='visible')
            page.evaluate('(id)=>mapPopupDetail(trees.find(t=>t.id===id))',group['id'])
            map_metrics=page.locator('#treeMapCard .mapCardCell').evaluate_all('cells=>Object.fromEntries(cells.map(c=>[c.querySelector("small").textContent,c.querySelector("b").textContent]))')
            assert map_metrics['Contesto']=='Parco o area verde' and map_metrics['Diametro chioma']=='7,5 m'
            assert 'Eventi registrati' not in map_metrics
            page.evaluate('hideTreeCard()')
            page.screenshot(path=str(ARTIFACTS/'group-area-desktop.png'))
            with page.expect_download() as download:page.evaluate('expGeo()')
            exported=json.loads(pathlib.Path(download.value.path()).read_text())
            feature=next(feature for feature in exported['features'] if feature['properties']['id']==group['id'])
            assert feature['geometry']==group['geometry']
            page.locator('.mainNav [data-view="anagrafica"]').click()
            page.locator(f'[data-registry-edit="{group["id"]}"]').click()
            page.locator('#groupCountEstimated').check();page.locator('#v2AnaSave').click();saved()
            print('PASS: gruppo di 50 con codice unico, perimetro persistito, bozza conservata e GeoJSON poligonale',flush=True)

            # Fusti: inserimento dinamico, calcolo non arrotondato nel DB, misure individuali conservate.
            manual();page.locator('#v2AnaSpecies').fill('Carpino');page.locator('#groupRecordType').select_option('multistem')
            page.locator('#groupStemCount').fill('2')
            assert page.locator('#groupStemInputs input').count()==2
            page.locator('#groupStemInputs input').nth(0).fill('30');page.locator('#groupStemInputs input').nth(1).fill('0')
            before_invalid=len(data()['trees']);page.locator('#v2AnaSave').click()
            assert page.locator('#v2AnagOverlay').is_visible() and len(data()['trees'])==before_invalid
            page.locator('#groupStemInputs input').nth(1).fill('40')
            assert page.locator('#groupStemResult').inner_text()=='Diametro equivalente: 50 cm'
            page.locator('#v21InitialNotes').fill('Due fusti dalla stessa ceppaia.')
            multi_code=page.locator('#v2AnaCode').input_value();page.locator('#v2AnaSave').click();saved()
            multi=next(t for t in data()['trees'] if t['code']==multi_code)
            assert multi['treeCount']==1 and multi['stemCount']==2 and multi['stemDiameters']==[30,40] and multi['diameter']==50
            page.locator(f'[data-registry-edit="{multi["id"]}"]').click()
            page.locator('#groupStemCount').fill('');page.locator('#groupStemCount').fill('3');assert page.locator('#groupStemInputs input').count()==3
            assert page.locator('#groupStemInputs input').nth(0).input_value()=='30'
            page.locator('#groupStemInputs input').nth(2).fill('12,5')
            assert page.locator('#groupStemResult').inner_text()=='Diametro equivalente: 51,5 cm'
            assert page.locator('#v21InitialDiameter').input_value()=='51,5'
            page.screenshot(path=str(ARTIFACTS/'multistem-form.png'))
            page.locator('#v2AnaSave').click();saved()
            multi=next(t for t in data()['trees'] if t['id']==multi['id'])
            assert math.isclose(multi['diameter'],math.sqrt(30**2+40**2+12.5**2),rel_tol=1e-12)
            assert multi['stemDiameters']==[30,40,12.5]
            print('PASS: n campi per n fusti, virgola decimale, formula √Σd², singole misure e diametro equivalente nel DB',flush=True)

            # Rilievo successivo: aggiorna i fusti e conserva il primo rilievo.
            page.locator(f'#overviewRows [data-tree="{multi["id"]}"]').click()
            assert page.locator('.v2DetailCell').filter(has=page.locator('small',has_text='Diametro equivalente')).locator('b').inner_text()=='51,5 cm'
            page.locator('#v2DetailCensus').click()
            assert page.locator('#surveyStemBox').is_visible()
            for input,value in zip(page.locator('#surveyStemInputs input').all(),['35','45','15']):input.fill(value)
            assert page.locator('#surveyStemResult').inner_text()=='Diametro equivalente: 58,9 cm'
            assert page.locator('#v2CensusDiameter').input_value()=='58,9'
            page.locator('#v2CensusNote').fill('Controllo successivo dei tre fusti.')
            page.locator('#v2CensusSave').click()
            page.wait_for_function("document.getElementById('v2CensusFeedback').textContent.includes('salvata')")
            multi=next(t for t in data()['trees'] if t['id']==multi['id'])
            assert math.isclose(multi['diameter'],math.sqrt(35**2+45**2+15**2),rel_tol=1e-12)
            assert multi['initialObservationNotes']=='Due fusti dalla stessa ceppaia.'
            assert multi['notes']=='Due fusti dalla stessa ceppaia.' and multi['surveyNotes']=='Controllo successivo dei tre fusti.'
            assert any(e['treeId']==multi['id'] and e.get('snapshot',{}).get('stemDiameters')==[35,45,15] for e in data()['history'])
            page.locator('.mainNav [data-view="anagrafica"]').click()
            page.locator(f'[data-registry-edit="{multi["id"]}"]').click()
            assert page.locator('#v21InitialNotes').input_value()=='Due fusti dalla stessa ceppaia.'
            page.locator('#v2AnagClose').click()
            print('PASS: rilevazioni policormiche aggiornano il diametro equivalente senza sovrascrivere le osservazioni iniziali',flush=True)

            # Fascia senza numero: non equivale ad un solo albero nei totali.
            manual();page.locator('#v2AnaSpecies').fill('Specie miste');page.locator('#groupRecordType').select_option('woodland')
            page.locator('#v2AnaSave').click();saved()
            unknown=next(t for t in data()['trees'] if t['species']=='Specie miste')
            assert unknown['treeCount'] is None
            page.locator('.mainNav [data-view="statistiche"]').click()
            assert page.locator('.analyticsMetric > strong').all_text_contents()[:2]==['4','52']
            assert '50 stimati' in page.locator('.analyticsMetric').nth(1).inner_text() and '1 gruppo senza quantità' in page.locator('.analyticsMetric').nth(1).inner_text()
            page.locator('.mainNav [data-view="mappa"]').click();page.locator('#newGroupAreaMap').click();page.locator('#groupAreaTools').wait_for(state='visible')
            rect=page.locator('#map').bounding_box()
            for fx,fy in [(.4,.5),(.65,.75),(.4,.75),(.65,.5)]:page.mouse.click(rect['x']+rect['width']*fx,rect['y']+rect['height']*fy)
            page.locator('#groupAreaConfirm').click()
            assert 'non valido' in page.locator('#groupAreaPointCount').inner_text()
            page.locator('#groupAreaUndo').click();assert page.locator('#groupAreaPointCount').inner_text().startswith('3 vertici')
            page.locator('#groupAreaCancel').click();page.locator('#v2AnagOverlay').wait_for(state='visible');page.locator('#v2AnagClose').click()
            assert len(data()['trees'])==4
            print('PASS: perimetri incrociati rifiutati, annullamento punti e diametri non validi senza scritture',flush=True)
            with page.expect_download() as download:page.evaluate('expCSV()')
            with open(download.value.path(),encoding='utf-8-sig',newline='') as stream:exported=list(csv.DictReader(stream,delimiter=';'))
            assert json.loads(next(row for row in exported if row['id']==group['id'])['geometry'])==group['geometry']
            assert json.loads(next(row for row in exported if row['id']==multi['id'])['stemDiameters'])==[35,45,15]
            page.context.close()

            # Nuova sessione iPhone: caricamento reale da Drive simulato e geometrie/fusti intatti.
            page=page_new(True)
            page.locator('#overviewSearch').fill(multi_code)
            page.locator('#overviewRows [data-tree]').click();page.locator('#v2DetailAnag').click()
            assert page.locator('#v21InitialNotes').is_visible() and page.locator('#v21InitialNotes').input_value()=='Due fusti dalla stessa ceppaia.'
            assert page.locator('#groupStemInputs input').count()==3
            assert [input.input_value() for input in page.locator('#groupStemInputs input').all()]==['35','45','15']
            page.locator('#v2AnagClose').click()
            page.locator('[data-mobile-view="mappa"]').click();page.locator('#newGroupAreaMap').click();page.locator('#groupAreaTools').wait_for(state='visible')
            box=page.locator('#map').bounding_box()
            for fx,fy in [(.35,.55),(.7,.55),(.6,.8)]:page.touchscreen.tap(box['x']+box['width']*fx,box['y']+box['height']*fy)
            page.screenshot(path=str(ARTIFACTS/'drawing-iphone.png'))
            assert page.locator('#groupAreaPointCount').inner_text().startswith('3 vertici'),(page.locator('#groupAreaPointCount').inner_text(),box,page.evaluate('[...pointers.keys()]'),errors)
            page.locator('#groupAreaConfirm').click();page.locator('#v2AnagOverlay').wait_for(state='visible');assert page.locator('#groupAreaInfo').inner_text().startswith('Area delimitata')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(ARTIFACTS/'area-form-iphone.png'))
            page.locator('#v2AnagClose').click()
            assert len(data()['trees'])==4
            assert not errors,errors
            print('PASS: riapertura da iPhone, note/fusti/aree recuperati da Drive; disegno touch e nessun salvataggio con Annulla',flush=True)
            browser.close()
    finally:
        server.shutdown();service.terminate();service.wait(timeout=10)
if __name__=='__main__':main()
