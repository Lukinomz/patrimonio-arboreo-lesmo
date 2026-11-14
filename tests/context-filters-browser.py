"""Quattro contesti fissi e rimozione gestione parchi. Drive simulato, 91 schede e storico intatti."""
import copy,csv,functools,http.server,json,pathlib,re,subprocess,threading,urllib.request
from playwright.sync_api import sync_playwright
from browser_support import ADMIN_TEST, mock_admin_login, open_registry_filters
ROOT=pathlib.Path(__file__).resolve().parents[1]
KEY='test-only-key-not-for-production-0123456789'
ENDPOINT=re.search(r"const DEFAULT_DRIVE_URL = '([^']+)'",(ROOT/'drive-storage.js').read_text()).group(1)
OPTIONS=[['','Nessun contesto'],['strada','Stradale'],['parco','Parco o area verde'],['altro','Altro']]
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass

def rpc(action,**kwargs):
    request=urllib.request.Request('http://127.0.0.1:8766/',data=json.dumps({'action':action,'key':KEY,**kwargs}).encode())
    with urllib.request.urlopen(request) as response:return json.load(response)
def archive():return rpc('load')['result']['data']
def options(page,id):return page.locator(id+' option').evaluate_all('els=>els.map(e=>[e.value,e.textContent])')

def main():
    service=subprocess.Popen(['node',str(ROOT/'tests/drive-runtime.cjs')],stdout=subprocess.PIPE,text=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
    try:
        assert service.stdout.readline().strip()=='Drive test runtime ready'
        trees=[{'id':f'LES-{i:06}','code':f'LESMO-A{i:04}','species':'Tiglio','siteType':['strada','parco','altro',''][i%4],'address':['Via G. Marconi','Via Marconi','Via Giovanni Marconi'][i%3],'status':'ok','height':i,'diameter':i/3,'crownDiameter':i/5,'notes':f'Nota {i}','initialObservationNotes':f'Primo rilievo {i}','date':'2026-11-01','lat':45.648,'lon':9.306} for i in range(1,92)]
        trees[0].update(siteType='CTX-old',parkId='CTX-old',areaId='old-area')
        trees[1]['siteType']='giardino';trees[2]['siteType']='boschivo'
        history=[{'id':'survey-'+t['id'],'treeId':t['id'],'type':'censimento','date':'2026-11-01','description':t['notes'],'snapshot':copy.deepcopy(t)} for t in trees]
        assets=[{'id':'ASSET-'+kind,'code':'CODE-'+kind,'assetKind':kind,'name':'Ingresso nord','siteType':'parco','condition':'good','notes':'Nota elemento','lat':None,'lon':None,'parkId':'CTX-old','areaId':'old-area'} for kind in ['bench','bin','playground_area','equipment']]
        photo={'id':'photo','treeId':trees[0]['id'],'relativePath':'Foto/LES-000001/originale.png','date':'2026-11-01'}
        seed={'schema':4,'nextId':92,'trees':trees,'history':history,'assets':assets,'workOrders':[],'photos':[photo],'contexts':[{'id':'CTX-old','name':'Parco precedente','type':'park','legacyValues':['parco'],'notes':'Metadati da conservare'}],'customData':{'preservare':True}}
        assert rpc('photoPut',revision='empty',path=photo['relativePath'],base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',mime='image/png')['ok'];assert rpc('save',revision='empty',data=seed)['ok'];original=copy.deepcopy(archive())
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);errors=[];writes=[]
            def new_page(mobile=False):
                context=browser.new_context(**(p.devices['iPhone 13'] if mobile else {'viewport':{'width':1500,'height':1000}}))
                def bridge(route):
                    if route.request.url==ENDPOINT:
                        body=json.loads(route.request.post_data)
                        if body['action'] not in ['load','photoGet']:writes.append(body['action'])
                        request=urllib.request.Request('http://127.0.0.1:8766/',data=route.request.post_data.encode())
                        with urllib.request.urlopen(request) as response:route.fulfill(status=200,content_type='application/json',body=response.read())
                    elif route.request.url.startswith(base):route.continue_()
                    else:route.abort()
                context.route('**/*',bridge);mock_admin_login(context);page=context.new_page();page.set_default_timeout(7000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.goto(base);page.locator('#driveKey').fill(KEY);page.locator('#driveConnect').click();page.wait_for_function("document.body.classList.contains('driveConnected')");page.wait_for_selector('#munRegistry',state='attached');page.evaluate("switchSection('anagrafica')");return page
            def check_ui(page,mobile=False):
                assert page.locator('#munManageAreas,#contextStatistics,#contextDialog,#munBulkPark,#registryParkFilter,#munParkFilterTrigger').count()==0
                assert page.evaluate('typeof municipalParks')=='undefined'
                page.evaluate('v2OpenAnag(null)');page.locator('#v2AnagOverlay').wait_for(state='visible');assert options(page,'#v2AnaSite')==OPTIONS
                assert page.locator('#v2AnaAddress').evaluate('e=>e.closest("label").firstChild.textContent.trim()')=='Via/Località/Parco'
                assert page.locator('#munTreePark').count()==0
                assert page.locator('#mAnaGPS' if mobile else '#munTreeGPS').is_visible();page.locator('#v2AnagClose').click()
                for kind in ['bench','bin','playground_area','equipment']:
                    page.evaluate('(kind)=>openAssetForm(null,{assetKind:kind})',kind);assert options(page,'#munArea')==OPTIONS
                    assert page.locator('#munAddress').evaluate('e=>e.closest("label").querySelector("span").textContent')=='Via/Località/Parco'
                    assert page.locator('#munPark').count()==0 and page.locator('#munGPS').is_visible();assert page.locator('#munName').get_attribute('placeholder')=='Es. ingresso nord'
                    if kind=='bin':page.screenshot(path='/tmp/lesmo-fixed-context-'+('mobile' if mobile else 'pc')+'.png',full_page=True)
                    page.locator('[data-mun-close]').click()
                page.locator('#adminOpen').click();page.locator('#adminPassword').fill(ADMIN_TEST);page.locator('#adminLoginButton').click();assert page.locator('#adminContexts').count()==0
                assert 'Gestisci contesti' not in page.locator('#adminContent').inner_text() and 'parchi' not in page.locator('#adminContent').inner_text().lower();page.locator('#adminClose').click()
                page.evaluate("switchSection('mappa')");page.locator('#munLayersButton').click();assert page.locator('[data-layer=park]').count()==0;page.locator('#munLayersClose').click();page.evaluate("switchSection('anagrafica')")
            page=new_page();check_ui(page);assert archive()==original and not writes
            # Taxonomy filters and exports still operate on complete results, including old stored IDs.
            open_registry_filters(page)
            page.locator('#registryContextFilter').click();page.locator('#columnFilterPopup .cfChoices label').filter(has=page.get_by_text('Parco o area verde',exact=True)).locator('input').check();page.locator('[data-cf-apply]').click()
            expected=sum(page.evaluate('(t)=>municipalContextKey(t)',tree)=='parco' for tree in trees)
            assert page.locator('#overviewRows [data-tree]').count()==expected
            with page.expect_download() as download:page.locator('#downloadTable').click()
            with open(download.value.path(),encoding='utf-8-sig',newline='') as stream:rows=list(csv.DictReader(stream,delimiter=';'))
            assert len(rows)==expected and 'Parco' not in rows[0] and all(r['Contesto']=='Parco o area verde' for r in rows)
            page.locator('#v21ResetFilters').click()
            with page.expect_download() as download:page.evaluate('createBackup(false)')
            backup=json.loads(pathlib.Path(download.value.path()).read_text());assert backup['trees']==original['trees'] and backup['history']==original['history'] and backup['assets']==original['assets'] and backup['contexts']==original['contexts'] and backup['photos']==original['photos'] and len(backup['images'])==1
            assert archive()==original and not writes
            print('PASS: schede PC uniformate, gestione parchi rimossa da Admin/filtri/mappe/statistiche; lettura e backup conservano identici i 91 alberi e lo storico',flush=True)
            mobile=new_page(True);check_ui(mobile,True);assert archive()==original and not writes;mobile.context.close()
            print('PASS: quattro opzioni esatte, Via/Località/Parco e GPS presenti anche su iPhone, nessun campo Parco separato',flush=True)
            # Editing one observation does not clear old hidden metadata or rewrite its Context.
            page.locator('[data-registry-edit="LES-000001"]').click();assert page.locator('#v2AnaSite').input_value()=='parco';page.locator('#v21InitialNotes').fill('Osservazione corretta');page.locator('#v2AnaSave').click();page.locator('#v2AnagOverlay').wait_for(state='hidden')
            current=archive();assert len(current['trees'])==91 and current['trees'][1:]==original['trees'][1:] and current['history'][:91]==original['history'] and current['photos']==original['photos']
            assert current['trees'][0]['siteType']=='CTX-old' and current['trees'][0]['parkId']=='CTX-old' and current['trees'][0]['areaId']=='old-area' and current['contexts']==original['contexts']
            page.evaluate("openAssetForm(municipalRecord('ASSET-bench'))");page.locator('#munNotes').fill('Nota panchina corretta');page.locator('#munAssetSave').click();page.wait_for_selector('#munDetailEdit');assert archive()['assets'][0]['parkId']=='CTX-old' and archive()['assets'][0]['areaId']=='old-area';page.locator('[data-mun-close]').click()
            assert not errors,errors
            print('PASS: modifiche esplicite alle note conservano Contesto originale, metadati precedenti, altri 90 alberi, foto e rilievi storici',flush=True)
            browser.close()
    finally:server.shutdown();service.terminate();service.wait()
if __name__=='__main__':main()
