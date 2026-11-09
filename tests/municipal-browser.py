"""Percorsi comuni PC/iPhone su archivio Drive simulato, mai sul DB reale."""
import base64,csv,functools,http.server,json,pathlib,re,subprocess,tempfile,threading,urllib.request
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
KEY='test-only-key-not-for-production-0123456789'
ENDPOINT=re.search(r"const DEFAULT_DRIVE_URL = '([^']+)'",(ROOT/'drive-storage.js').read_text()).group(1)
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass

def rpc(action,**kwargs):
    req=urllib.request.Request('http://127.0.0.1:8766/',data=json.dumps({'action':action,'key':KEY,**kwargs}).encode())
    with urllib.request.urlopen(req) as r:return json.load(r)
def data():return rpc('load')['result']['data']
def main():
    service=subprocess.Popen(['node',str(ROOT/'tests/drive-runtime.cjs')],stdout=subprocess.PIPE,text=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
    try:
        assert service.stdout.readline().strip()=='Drive test runtime ready'
        seed={'schema':4,'nextId':2,'trees':[{'id':'LES-000001','code':'LESMO-A0001','species':'Tiglio','status':'ok','lat':45.648,'lon':9.306,'date':'2026-10-20','notes':'Nota precedente','crownDiameter':5,'siteType':'parco'}],'history':[{'id':'old-survey','treeId':'LES-000001','date':'2026-10-20','type':'censimento','description':'Vecchia rilevazione da conservare','snapshot':{'diameter':32,'crownDiameter':5}}],'photos':[],'assets':[{'id':'ASSET-parent','code':'LESMO-AG0001','assetKind':'playground_area','name':'Parco Test','condition':'unknown','lat':None,'lon':None,'date':'2026-09-01'}],'customRoot':{'keep':'yes'}}
        assert rpc('save',revision='empty',data=seed)['ok']
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);errors=[]
            def page_new(mobile=False,url=''):
                context=browser.new_context(**(p.devices['iPhone 13'] if mobile else {'viewport':{'width':1440,'height':1000}}))
                def bridge(route):
                    if route.request.url==ENDPOINT:
                        req=urllib.request.Request('http://127.0.0.1:8766/',data=route.request.post_data.encode())
                        with urllib.request.urlopen(req) as response:route.fulfill(status=200,content_type='application/json',body=response.read())
                    elif route.request.url.startswith(base):route.continue_()
                    else:route.abort()
                context.route('**/*',bridge);page=context.new_page();page.set_default_timeout(7000);page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+url);page.locator('#driveKey').fill(KEY);page.locator('#driveConnect').click();page.wait_for_function("document.body.classList.contains('driveConnected')");page.wait_for_selector('#municipalCategories');return page
            page=page_new();page.on('dialog',lambda d:d.accept())
            # Parent area drawn on the actual map, then a bench with original photo.
            page.evaluate("openAssetForm(municipalRecord('ASSET-parent'))");page.locator('#munName').fill('Parco Test');page.locator('#munPerimeter').click()
            bounds=page.locator('#map').bounding_box()
            for x,y in [(0.4,0.45),(0.65,0.45),(0.65,0.7),(0.4,0.7)]:page.mouse.click(bounds['x']+bounds['width']*x,bounds['y']+bounds['height']*y)
            page.locator('#groupAreaConfirm').click();assert page.locator('#municipalDialog').is_visible();page.locator('#munAssetSave').click();page.wait_for_selector('#munDetailEdit');park=data()['assets'][0];assert park['geometry']['coordinates'][0][0]==park['geometry']['coordinates'][0][-1]
            page.locator('[data-mun-close]').click();page.evaluate("switchSection('anagrafica')");page.locator('[data-mun-category=furniture]').click();page.locator('#munNew').click();page.locator('[data-new-kind=bench]').click()
            page.locator('#munName').fill('Panchina ingresso');page.locator('#munArea').select_option(park['id']);page.locator('#munMaterial').fill('Legno');page.locator('#munLat').fill('45.648');page.locator('#munLon').fill('9.306');page.locator('#munNotes').fill('Vernice da controllare');page.locator('#munDate').fill('2026-09-01');page.locator('#munRepeat').check();page.locator('#munFiles').set_input_files({'name':'prima.png','mimeType':'image/png','buffer':PNG});page.locator('#munAssetSave').click();page.wait_for_function("document.getElementById('munName')?.value==='Panchina ingresso' && !municipalBusy && document.getElementById('munLat')?.value===''")
            assert page.locator('#munArea').input_value()==park['id'];assert not page.locator('#munFiles').input_value();assert page.locator('#munCondition').input_value()=='unknown';assert page.locator('#munNotes').input_value()==''
            page.locator('#munName').fill('Panchina secondo ingresso');page.locator('#munAssetSave').click();page.wait_for_selector('#munDetailEdit');bench=data()['assets'][1];assert data()['photos'][0]['treeId']==bench['id'];assert data()['customRoot']==seed['customRoot'];assert data()['history'][0]==seed['history'][0]
            print('PASS: area da mappa, collegamenti, foto e inserimento simile senza copiare posizione, stato o note',flush=True)
            # Current and older inspections, usable as explicit references.
            page.locator('[data-mun-close]').click();page.evaluate('(id)=>openMunicipalDetail(municipalRecord(id))',bench['id']);page.locator('#munDetailInspect').click();page.locator('#munInspectionDate').fill('2026-11-08');page.locator('#munInspectionCondition').select_option('poor');page.locator('#munInspectionNotes').fill('Seduta rotta');page.locator('#munInspectionSave').click();page.wait_for_selector('#munDetailInspect');assert data()['assets'][1]['condition']=='poor'
            page.locator('#munDetailInspect').click();page.locator('#munInspectionDate').fill('2026-09-02');page.locator('#munInspectionCondition').select_option('good');page.locator('#munInspectionNotes').fill('Vecchia visita: integra');page.locator('#munInspectionSave').click();page.wait_for_selector('#munDetailInspect');assert data()['assets'][1]['condition']=='poor';assert len([e for e in data()['history'] if e['treeId']==bench['id'] and e['type']=='asset_rilievo'])==3
            old=page.locator('.munHistory article').filter(has_text='Vecchia visita: integra');old.locator('[data-reuse]').click();assert page.locator('#munInspectionCondition').input_value()=='good';assert page.locator('#munInspectionNotes').input_value()=='';page.locator('[data-mun-close]').click()
            print('PASS: vecchi rilievi consultabili e riutilizzabili; inserimento retrodatato conserva lo stato più recente',flush=True)
            # Sort/filter/export across all records, selected task preview and completion.
            page.locator('[data-mun-category=all]').click();page.locator('#munSearch').fill('Panchina');assert page.locator('#munRegistryRows tr').count()==2
            page.locator('[data-mun-sort=name]').click();page.locator('#munSelectPage').check();page.locator('#munBulkTask').click();assert '2 elementi' in page.locator('#munTitle').inner_text();page.locator('#munTaskTitle').fill('Ripristino seduta');page.locator('#munTaskDue').fill('2026-11-01');page.locator('#munTaskSave').click();page.wait_for_function('!municipalBusy && !document.getElementById("municipalDialog").open');assert len(data()['workOrders'])==2
            page.locator('[data-mun-task]').first.click();page.locator('#munTaskStatus').select_option('done');page.locator('#munTaskOutcome').fill('Doghe sostituite');page.locator('#munTaskAfter').set_input_files({'name':'dopo.png','mimeType':'image/png','buffer':PNG});page.locator('#munTaskUpdateSave').click();page.wait_for_function('!municipalBusy && document.querySelector(".munHistory")?.textContent.includes("Doghe sostituite")');assert len([o for o in data()['workOrders'] if o['status']=='done'])==1;assert any(p.get('stage')=='after' for p in data()['photos']);page.locator('[data-mun-close]').click()
            page.evaluate("switchSection('anagrafica')")
            with page.expect_download() as download:page.locator('#munExport').click()
            with open(download.value.path(),encoding='utf-8-sig',newline='') as stream:rows=list(csv.DictReader(stream,delimiter=';'))
            assert len(rows)==2 and rows[0]['Contesto']=='Parco Test'
            print('PASS: tabella ordinabile e filtrabile, CSV, interventi multipli e completamento con foto',flush=True)
            # Tree edit must not strip assets/work orders/root fields, nor old surveys.
            page.locator('[data-mun-category=trees]').click();page.locator('[data-registry-edit="LES-000001"]').click();page.locator('#v2AnaSite').select_option(park['id']);page.locator('#v2AnaSave').click();page.locator('#v2AnagOverlay').wait_for(state='hidden');assert len(data()['assets'])==3 and len(data()['workOrders'])==2;assert data()['trees'][0]['siteType']==park['id'];assert data()['history'][0]==seed['history'][0]
            # Historical tree measurements can explicitly seed a new visit, preserving the original.
            page.locator('#overviewRows [data-tree="LES-000001"]').click();page.locator('#munTreeHistory').click();page.locator('[data-tree-reference="old-survey"]').click();assert page.locator('#v2CensusDiameter').input_value()=='32';assert page.locator('#v2CensusCrown').input_value()=='5';assert page.locator('#v2CensusNote').input_value()=='';assert data()['history'][0]==seed['history'][0]
            # QR is local SVG with only record ID; authenticated deep link resolves asset.
            page.evaluate('(id)=>openMunicipalDetail(municipalRecord(id))',bench['id']);page.locator('#munDetailQR').click();assert page.locator('.munQR svg').count()==1
            with page.expect_download() as download:page.locator('#munDownloadQR').click()
            assert pathlib.Path(download.value.path()).read_text().startswith('<svg')
            page.locator('[data-mun-close]').click();linked=page_new(url='?record='+bench['id']);linked.wait_for_selector('#munDetailInspect');assert bench['code'] in linked.locator('#munTitle').inner_text();linked.context.close()
            # Reload, full backup and import conserve new and existing records/photos/history.
            with page.expect_download() as download:page.evaluate('createBackup(false)')
            backup=json.loads(pathlib.Path(download.value.path()).read_text());assert len(backup['assets'])==3 and len(backup['workOrders'])==2 and len(backup['images'])==2
            page.evaluate('(backup)=>impJSON(new File([JSON.stringify(backup)],"backup.json",{type:"application/json"}))',backup);assert len(data()['assets'])==3;assert data()['history'][0]==seed['history'][0]
            print('PASS: modifica alberi, riapertura, QR e backup/ripristino conservano schede nuove e rilievi storici',flush=True)
            # Assisted GPS: choose best new fix, preserve measured precision, reject stale fixes.
            page.evaluate("switchSection('anagrafica')")
            page.locator('[data-mun-category=furniture]').click();page.locator('#munNew').click();page.locator('[data-new-kind=bin]').click();page.locator('#munName').fill('Cestino GPS')
            page.evaluate('''() => {window.cleared=[];navigator.geolocation.watchPosition=(ok)=>{setTimeout(()=>ok({coords:{latitude:45.648,longitude:9.306,accuracy:45},timestamp:Date.now()}),50);setTimeout(()=>ok({coords:{latitude:45.6481,longitude:9.3061,accuracy:6},timestamp:Date.now()}),100);return 77};navigator.geolocation.clearWatch=id=>window.cleared.push(id)}''')
            page.locator('#munGPS').click();page.wait_for_function('document.getElementById("munGpsAccuracy").textContent.includes("6 m")');page.locator('#munGpsUse').click();assert page.locator('#munLat').input_value()=='45.6481';assert page.evaluate('window.cleared.includes(77)');page.locator('#munAssetSave').click();page.wait_for_selector('#munDetailEdit');assert data()['assets'][-1]['positionMeta']['accuracy']==6;page.locator('[data-mun-close]').click()
            page.locator('#munNew').click();page.locator('[data-new-kind=bin]').click();page.evaluate('''() => {navigator.geolocation.watchPosition=(ok,fail)=>{setTimeout(()=>ok({coords:{latitude:45.7,longitude:9.4,accuracy:1},timestamp:Date.now()-90000}),20);setTimeout(()=>fail({code:2}),40);return 78}}''');page.locator('#munGPS').click();page.wait_for_function('document.getElementById("munGpsMessage").textContent.includes("non disponibile")');assert page.locator('#munGpsUse').is_disabled();page.locator('#munGpsCancel').click();assert page.locator('#munLat').input_value()=='';page.locator('[data-mun-close]').click()
            print('PASS: GPS assistito usa il fix migliore, salva accuratezza, arresta il watcher e scarta posizioni scadute',flush=True)
            # Dedicated playground/equipment fields and parent-child links.
            page.locator('[data-mun-category=playgrounds]').click();page.locator('#munNew').click();page.locator('[data-new-kind=playground_area]').click();page.locator('#munName').fill('Area giochi Test');page.locator('#munSurface').fill('Gomma antitrauma');page.locator('#munArea').select_option(park['id']);page.locator('#munFence').select_option('yes');page.locator('#munAssetSave').click();page.wait_for_selector('#munDetailEdit');playground=data()['assets'][-1];page.locator('[data-mun-close]').click()
            page.locator('#munNew').click();page.locator('[data-new-kind=equipment]').click();page.locator('#munName').fill('Altalena doppia');page.locator('#munEquipmentType').select_option('swing');page.locator('#munAge').fill('3–12 anni');page.locator('#munArea').select_option(park['id']);page.locator('#munAssetSave').click();page.wait_for_selector('#munDetailEdit');assert data()['assets'][-1]['equipmentType']=='swing';assert data()['assets'][-1]['siteType']==park['id'];page.locator('[data-mun-close]').click()
            print('PASS: aree giochi e giochi hanno campi dedicati e collegamenti persistenti',flush=True)
            # Manual map correction keeps unsaved fields and original files, and Cancel writes nothing.
            count_before=len(data()['assets']);page.locator('[data-mun-category=furniture]').click();page.locator('#munNew').click();page.locator('[data-new-kind=bench]').click();page.locator('#munName').fill('Bozza da mappa');page.locator('#munNotes').fill('Nota da mantenere');page.locator('#munFiles').set_input_files({'name':'bozza.png','mimeType':'image/png','buffer':PNG});page.locator('#munPick').click();bounds=page.locator('#map').bounding_box();page.mouse.click(bounds['x']+bounds['width']*.5,bounds['y']+bounds['height']*.6);assert page.locator('#munLat').input_value();assert page.locator('#munNotes').input_value()=='Nota da mantenere';assert page.locator('#munFiles').evaluate('e=>e.files.length')==1;page.locator('[data-mun-close]').click();assert len(data()['assets'])==count_before
            page.evaluate("switchSection('anagrafica')")
            # iPhone same categories/forms, layer toggles, history and layout.
            mobile=page_new(mobile=True);mobile.locator('[data-mun-category=furniture]').click();assert mobile.locator('#munRegistryRows tr').count()==3
            mobile.screenshot(path='/tmp/lesmo-municipal-mobile.png',full_page=True);assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
            mobile.evaluate("switchSection('mappa')");mobile.locator('#munLayersButton').click();assert mobile.locator('#munLayers').is_visible();mobile.locator('[data-layer=trees]').uncheck();assert mobile.locator('#pins button').count()==0;mobile.locator('[data-layer=bench]').uncheck();assert mobile.locator('.munMapPin[title*="Panchina"]').count()==0;mobile.screenshot(path='/tmp/lesmo-municipal-layers.png',full_page=True)
            mobile.locator('#munLayersClose').click();mobile.evaluate("switchSection('anagrafica')");mobile.locator('#munNew').click();mobile.locator('[data-new-kind=bench]').click();assert mobile.locator('#munMaterial').is_visible();mobile.screenshot(path='/tmp/lesmo-municipal-form.png',full_page=True);mobile.evaluate('document.documentElement.style.setProperty("--dialog-viewport-height","350px")');assert mobile.locator('#municipalDialog').bounding_box()['height']<=333;mobile.locator('#municipalDialog').evaluate('e=>e.scrollTop=e.scrollHeight');assert mobile.locator('[data-mun-close]').is_visible();mobile.locator('[data-mun-close]').click()
            assert all(mobile.locator(f'[data-mobile-view={name}]').is_visible() for name in ['anagrafica','censimento','mappa','statistiche','archivio','guida'])
            page.evaluate("switchSection('statistiche')");page.locator('[data-mun-category=all]').click();assert page.locator('.munDonut').is_visible();page.screenshot(path='/tmp/lesmo-municipal-stats.png',full_page=True)
            # Existing local mobile mode also restores the complete extended backup and reopens it.
            local_context=browser.new_context(**p.devices['iPhone 13']);local_context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort());local=local_context.new_page();local.on('dialog',lambda d:d.accept());local.on('pageerror',lambda e:errors.append(str(e)));local.goto(base);local.wait_for_function('mArchiveReady');local.locator('#driveSetup').evaluate('e=>e.open=true');local.locator('#driveLocal').click();local.evaluate('(backup)=>mImportBackup(new File([JSON.stringify(backup)],"backup.json",{type:"application/json"}))',backup);assert local.evaluate('Municipal.assets.length')==3;assert local.evaluate('Municipal.workOrders.length')==2;local.reload();local.wait_for_function('mArchiveReady');assert local.evaluate('Municipal.assets.length')==3;assert local.evaluate('historyEvents[0].id')=='old-survey';local_context.close()
            print('PASS: backup esteso ripristinato e riaperto anche nell’archivio locale mobile esistente',flush=True)
            # A concurrent write rejects a stale form atomically; its draft remains available.
            page.evaluate("switchSection('anagrafica')");page.locator('[data-mun-category=furniture]').click();page.locator('#munNew').click();page.locator('[data-new-kind=bin]').click();page.locator('#munName').fill('Bozza in conflitto')
            current=rpc('load')['result'];changed=current['data'];changed['trees'][0]['address']='Aggiornato da altro operatore';assert rpc('save',revision=current['revision'],data=changed)['ok'];before_count=len(changed['assets'])
            page.locator('#munAssetSave').click();page.locator('#munError').wait_for();assert len(data()['assets'])==before_count;assert page.evaluate('Municipal.assets.length')==before_count;assert page.locator('#munName').input_value()=='Bozza in conflitto';page.locator('[data-mun-close]').click()
            print('PASS: conflitto tra operatori rifiutato senza sovrascrivere dati, bozza conservata e memoria ripristinata',flush=True)
            assert not errors,errors
            print('PASS: PC e iPhone condividono categorie e schede; livelli indipendenti e grafici basati sui dati, nessun errore JavaScript',flush=True)
            browser.close()
    finally:server.shutdown();service.terminate();service.wait()
if __name__=='__main__':main()
