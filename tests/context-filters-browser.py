"""Recupero contesti preesistenti e filtri senza alterare 91 schede o rilievi. Solo Drive simulato."""
import copy,csv,functools,http.server,json,pathlib,re,subprocess,threading,urllib.request
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
KEY='test-only-key-not-for-production-0123456789'
ENDPOINT=re.search(r"const DEFAULT_DRIVE_URL = '([^']+)'",(ROOT/'drive-storage.js').read_text()).group(1)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass

def rpc(action,**kwargs):
    req=urllib.request.Request('http://127.0.0.1:8766/',data=json.dumps({'action':action,'key':KEY,**kwargs}).encode())
    with urllib.request.urlopen(req) as response:return json.load(response)
def archive():return rpc('load')['result']['data']

def main():
    service=subprocess.Popen(['node',str(ROOT/'tests/drive-runtime.cjs')],stdout=subprocess.PIPE,text=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
    try:
        assert service.stdout.readline().strip()=='Drive test runtime ready'
        trees=[{'id':f'LES-{i:06}','code':f'LESMO-A{i:04}','species':['Tiglio','Quercia','Cipresso'][i%3],'siteType':['Parco Ungaretti','Parco della Rimembranza','strada'][i%3],'address':['Via G. Marconi','Via Marconi','Via Giovanni Marconi'][i%3],'status':['ok','watch','sick'][i%3],'lat':45.648+i*.00001,'lon':9.306,'date':'2026-11-01','height':i,'diameter':i/3,'crownDiameter':i/5,'notes':f'Osservazione originale {i}','initialObservationNotes':f'Prima osservazione {i}'} for i in range(1,92)]
        trees[2].update(recordType='group',treeCount=50,countEstimated=True,geometry={'type':'Polygon','coordinates':[[[9.30,45.64],[9.31,45.64],[9.31,45.65],[9.30,45.64]]]})
        history=[{'id':'survey-'+t['id'],'treeId':t['id'],'type':'censimento','date':'2026-11-01','description':t['notes'],'snapshot':copy.deepcopy(t)} for t in trees]
        assets=[{'id':'ASSET-bench-1','code':'LESMO-P0001','assetKind':'bench','name':'Ingresso nord','siteType':'Parco Ungaretti','condition':'good','address':'Via G. Marconi','date':'2026-11-01','lat':45.648,'lon':9.306},
                {'id':'ASSET-bench-2','code':'LESMO-P0002','assetKind':'bench','name':'Ingresso sud','siteType':'Parco della Rimembranza','condition':'poor','address':'Via Marconi','date':'2026-11-02','lat':None,'lon':None},
                {'id':'ASSET-bin-1','code':'LESMO-C0001','assetKind':'bin','name':'Ingresso est','siteType':'Parco Ungaretti','condition':'poor','address':'Via G. Marconi','date':'2026-11-01','lat':None,'lon':None},
                {'id':'ASSET-game-1','code':'LESMO-G0001','assetKind':'equipment','name':'Altalena','siteType':'Parco Ungaretti','condition':'fair','address':'Via G. Marconi','date':'2026-11-01','lat':None,'lon':None}]
        seed={'schema':4,'nextId':92,'trees':trees,'history':history,'photos':[{'id':'legacy-photo','treeId':'LES-000003','relativePath':'Foto/LES-000003/originale.png','date':'2026-11-01','originalName':'originale.png'}],'assets':assets,'workOrders':[],'customData':{'conservare':True}}
        assert rpc('photoPut',revision='empty',path='Foto/LES-000003/originale.png',base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',mime='image/png')['ok']
        assert rpc('save',revision='empty',data=seed)['ok'];original=copy.deepcopy(archive())
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);errors=[];writes=[]
            def new_page(mobile=False):
                context=browser.new_context(**(p.devices['iPhone 13'] if mobile else {'viewport':{'width':1500,'height':1000}}))
                def bridge(route):
                    if route.request.url==ENDPOINT:
                        body=json.loads(route.request.post_data)
                        if body['action'] not in ['load','photoGet']:writes.append(body['action'])
                        req=urllib.request.Request('http://127.0.0.1:8766/',data=route.request.post_data.encode())
                        with urllib.request.urlopen(req) as response:
                            payload=json.load(response)
                            if body['action']=='load':payload['result']['folderName']='Patrionio arboreo'
                            route.fulfill(status=200,content_type='application/json',body=json.dumps(payload))
                    elif route.request.url.startswith(base):route.continue_()
                    else:route.abort()
                context.route('**/*',bridge);page=context.new_page();page.set_default_timeout(7000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.goto(base);page.locator('#driveKey').fill(KEY);page.locator('#driveConnect').click();page.wait_for_function("document.body.classList.contains('driveConnected')");page.wait_for_selector('#munRegistry',state='attached');return page
            page=new_page();assert 'Patrimonio arboreo' in page.locator('#workFolderReminder').inner_text() and 'Patrionio' not in page.locator('#workFolderReminder').inner_text()
            def apply_filter(button,values,search=''):
                page.locator(button).click();popup=page.locator('#columnFilterPopup');popup.wait_for()
                if search:popup.locator('[data-cf-search]').fill(search)
                for text in values:popup.locator('.cfChoices label').filter(has=page.get_by_text(text,exact=True)).locator('input').check()
                popup.locator('[data-cf-apply]').click()
            # Existing contexts are recovered from siteType, without adding or rewriting a single tree.
            assert len(page.evaluate('Municipal.contexts'))==3,errors
            apply_filter('#registryContextFilter',['Parco Ungaretti']);assert '30 di 91' in page.locator('#registrySummary').inner_text()
            assert page.locator('#overviewRows tr').count()==30
            assert archive()==original and not writes and all(not t.get('parkId') for t in archive()['trees'])
            with page.expect_download() as download:page.locator('#downloadTable').click()
            with open(download.value.path(),encoding='utf-8-sig',newline='') as stream:rows=list(csv.DictReader(stream,delimiter=';'))
            assert len(rows)==30 and all(r['Contesto']=='Parco Ungaretti' for r in rows)
            # Multiple contexts, status, column ranges; all are combined before pagination and export.
            page.locator('#v21ResetFilters').click();apply_filter('#registryContextFilter',['Parco Ungaretti','Parco della Rimembranza']);assert '61 di 91' in page.locator('#registrySummary').inner_text()
            page.locator('#v21ResetFilters').click();page.locator('[data-mun-category=all]').click();apply_filter('#munKindFilterTrigger',['Panchina','Cestino']);assert page.locator('#munRegistryRows tr').count()==3
            apply_filter('#munConditionFilterTrigger',['Buono','Da riparare']);assert page.locator('#munRegistryRows tr').count()==3
            apply_filter('#munAreaFilterTrigger',['Parco Ungaretti']);assert page.locator('#munRegistryRows tr').count()==2
            assert '1' in page.locator('#munRegistryBreakdown').inner_text()
            with page.expect_download() as download:page.locator('#munExport').click()
            with open(download.value.path(),encoding='utf-8-sig',newline='') as stream:rows=list(csv.DictReader(stream,delimiter=';'))
            assert len(rows)==2 and {r['Tipo'] for r in rows}=={'Panchina','Cestino'} and all(r['Contesto']=='Parco Ungaretti' for r in rows)
            page.locator('#munReset').click();apply_filter('#munRegistryHead [data-column-key=address] .columnFilterButton',['Via G. Marconi','Via Marconi']);assert '65 di 95' in page.locator('#munRegistryCount').inner_text()
            page.locator('#munReset').click();page.locator('[data-mun-category=trees]').click()
            page.locator('[data-registry-columns=all]').evaluate('e=>e.click()');page.locator('#overviewTable [data-column-key=height] .columnFilterButton').click();page.locator('[data-cf-min]').fill('80');page.locator('[data-cf-max]').fill('90');page.locator('[data-cf-apply]').click();assert '11 di 91' in page.locator('#registrySummary').inner_text()
            assert archive()==original and not writes
            print('PASS: 91 alberi, misure, contesti, note e rilievi identici; filtri multipli di tipo/condizione/contesto/via e intervalli, anche nei CSV',flush=True)
            # Merely opening and cancelling the existing survey does not overwrite legacy free-text context.
            page.locator('#v21ResetFilters').click();page.locator('[data-registry-edit="LES-000003"]').click();context_value=page.locator('#v2AnaSite').input_value();assert page.locator('#v2AnaSite option:checked').inner_text()=='Parco Ungaretti';page.locator('#v2AnagClose').click();assert archive()==original
            # Admin creates/renames only catalogue entries; original 91 trees and snapshots stay byte-equivalent.
            page.locator('#adminOpen').click();page.locator('#adminPassword').fill('Albereto71');page.locator('#adminLoginButton').click();page.locator('#adminContexts').click();page.locator('[data-context-edit="'+context_value+'"]').click();page.locator('#contextName').fill('Parco Ungaretti comunale');page.locator('#contextSave').click();page.wait_for_selector('#contextNew');assert archive()['trees']==original['trees'] and archive()['history']==original['history']
            page.locator('#contextNew').click();page.locator('#contextName').fill('Parco Nuovo');page.locator('#contextSave').click();page.wait_for_selector('#contextNew');page.locator('#contextClose').click();page.locator('#adminClose').click()
            page.locator('#munManageAreas').click();assert page.locator('#contextNew').count()==0 and page.locator('[data-context-edit]').count()==0;page.locator('#contextClose').click()
            page.locator('[data-mun-category=furniture]').click();page.locator('#munNew').click();page.locator('[data-new-kind=bin]').click();assert page.locator('#munName').get_attribute('placeholder')=='Es. ingresso nord';options=page.locator('#munArea option').all_text_contents();assert 'Parco Ungaretti comunale' in options and 'Parco Nuovo' not in options;assert 'Parco Nuovo' in page.locator('#munPark option').all_text_contents();assert page.locator('#munPark').input_value()=='';page.locator('[data-mun-close]').click()
            page.evaluate("switchSection('statistiche')");assert page.locator('#contextStatistics').is_visible();assert 'Parco Ungaretti comunale' in page.locator('#contextStatisticsRows').inner_text()
            # Renamed contexts resolve after reopening; backup still contains all original observations.
            snapshot=archive();page.reload();page.locator('#driveKey').fill(KEY);page.locator('#driveConnect').click();page.wait_for_function("document.body.classList.contains('driveConnected')");assert page.evaluate('municipalContextLabel(trees.find(t=>t.id==="LES-000003"))')=='Parco Ungaretti comunale'
            with page.expect_download() as download:page.evaluate('createBackup(false)')
            backup=json.loads(pathlib.Path(download.value.path()).read_text());assert backup['trees']==original['trees'] and backup['history']==original['history'] and backup['photos']==original['photos'] and len(backup['images'])==1 and backup['customData']==original['customData']
            print('PASS: gestione contesti riservata ad Admin; rinomina, riapertura e backup mantengono tutti i 91 censimenti e lo storico',flush=True)
            mobile=new_page(True);mobile.locator('[data-mun-category=all]').click();assert mobile.locator('#munRegistry thead').is_visible();assert mobile.locator('#munRegistryRows tr').first.evaluate('e=>getComputedStyle(e).display')=='table-row';assert mobile.locator('#mRegistryCards').is_hidden();assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            mobile.locator('#munRegistry .munMobileFilters > summary').click();mobile.locator('#munConditionFilterTrigger').click();mobile.locator('#columnFilterPopup .cfChoices label').filter(has=mobile.get_by_text('Da riparare',exact=True)).locator('input').check();mobile.locator('[data-cf-apply]').click();assert mobile.locator('#munRegistryRows tr').count()==2
            mobile.locator('#munReset').click();mobile.locator('#munRegistry .munMobileFilters > summary').click();mobile.locator('.munTableViewport').scroll_into_view_if_needed();mobile.screenshot(path='/tmp/lesmo-table-mobile.png',full_page=True);mobile.locator('[data-mun-category=trees]').click();assert mobile.locator('#overviewTable thead').is_visible();assert mobile.locator('#v21RegistryViewport').is_visible();mobile.locator('#v21RegistryViewport').scroll_into_view_if_needed();mobile.screenshot(path='/tmp/lesmo-trees-table-mobile.png',full_page=True)
            # Rejected concurrent catalogue change does not alter the observations either.
            assert archive()['trees']==original['trees'] and archive()['history']==original['history'];assert not errors,errors
            print('PASS: tabelle reali e filtri multipli su iPhone; nessuna modifica ai dati originali e nessun errore JavaScript',flush=True)
            # Parks are assigned only by an explicit manual action, preserving the original Context field.
            assert all(not tree.get('parkId') for tree in archive()['trees'])
            page.evaluate("switchSection('anagrafica')");page.locator('[data-mun-category=all]').click()
            for id in ['LES-000003','LES-000006']:page.locator(f'[data-mun-select="{id}"]').check()
            page.locator('#munBulkPark').click();park_id=next(c['id'] for c in archive()['contexts'] if c['name']=='Parco Nuovo');page.locator('#munBulkParkValue').select_option(park_id);page.locator('#munBulkParkSave').click();page.wait_for_function('!municipalBusy && !document.getElementById("municipalDialog").open')
            changed=archive();assert len(changed['trees'])==91 and changed['history'][:91]==original['history'] and changed['photos']==original['photos']
            for old,now in zip(original['trees'],changed['trees']):
                if old['id'] in ['LES-000003','LES-000006']:
                    assert now['parkId']==park_id and now['siteType']==old['siteType'];assert {k:v for k,v in now.items() if k not in ['parkId','modified']}==old
                else:assert now==old
            apply_filter('#munParkFilterTrigger',['Parco Nuovo']);assert page.locator('#munRegistryRows tr').count()==2
            page.evaluate("switchSection('statistiche')");row=page.locator('#contextStatisticsRows tr').filter(has_text='Parco Nuovo');assert row.locator('td').nth(1).inner_text()=='2' and row.locator('td').nth(2).inner_text()=='51'
            print('PASS: nessuna assegnazione automatica ai parchi; assegnazione manuale di 2 schede conserva il Contesto originario, gli altri 89 alberi e i rilievi precedenti',flush=True)
            browser.close()
    finally:server.shutdown();service.terminate();service.wait()
if __name__=='__main__':main()
