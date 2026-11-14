"""Navigation, field-map controls and Admin archive. Only simulated data/authentication."""
import base64,copy,functools,http.server,json,pathlib,re,subprocess,threading,urllib.request
from playwright.sync_api import sync_playwright
from browser_support import ADMIN_TEST, mock_admin_login, open_archive
ROOT=pathlib.Path(__file__).resolve().parents[1]
KEY='test-only-key-not-for-production-0123456789'
ENDPOINT=re.search(r"const DEFAULT_DRIVE_URL = '([^']+)'",(ROOT/'drive-storage.js').read_text()).group(1)
ARTIFACTS=pathlib.Path('/tmp/lesmo-navigation');ARTIFACTS.mkdir(exist_ok=True)
LABELS=['Patrimonio Arboreo & Urbano','Anagrafica','Censimento e Monitoraggio','Mappa','Guida']
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
def rpc(action,**payload):
 request=urllib.request.Request('http://127.0.0.1:8766/',data=json.dumps({'action':action,'key':KEY,**payload}).encode())
 with urllib.request.urlopen(request) as response:return json.load(response)
def main():
 service=subprocess.Popen(['node',str(ROOT/'tests/drive-runtime.cjs')],stdout=subprocess.PIPE,text=True)
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 try:
  assert service.stdout.readline().strip()=='Drive test runtime ready'
  trees=[{'id':f'LES-{i:06}','code':f'LESMO-A{i:04}','species':'Tiglio','address':'Via Marconi','status':'ok','date':'2026-11-01','lat':45.648,'lon':9.306+(i-1)*.0002,'notes':f'Osservazioni {i}','diameter':30+i/3,'crownDiameter':4,'siteType':'parco'} for i in range(1,92)]
  trees[-1].update(lat=None,lon=None)
  assets=[{'id':'ASSET-'+kind,'code':'PROVA-'+kind,'assetKind':kind,'name':'Ingresso nord','condition':'good','lat':45.649,'lon':9.306,'siteType':'parco'} for kind in ['bench','bin','playground_area','equipment']]
  photo={'id':'photo','treeId':trees[0]['id'],'relativePath':'Foto/LES-000001/prova.png','date':'2026-11-01'}
  seed={'schema':4,'nextId':92,'trees':trees,'history':[{'id':'event-'+t['id'],'treeId':t['id'],'type':'censimento','date':t['date'],'description':t['notes'],'snapshot':copy.deepcopy(t)} for t in trees],'photos':[photo],'assets':assets,'workOrders':[],'customRoot':{'keep':True}}
  assert rpc('photoPut',revision='empty',path=photo['relativePath'],base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',mime='image/png')['ok'];assert rpc('save',revision='empty',data=seed)['ok'];original=rpc('load')['result']['data']
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);errors=[];writes=[]
   for name,settings in [('pc',{'viewport':{'width':1440,'height':1000}}),('laptop',{'viewport':{'width':1024,'height':800}}),('iphone',{**p.devices['iPhone 13'],'viewport':{'width':390,'height':844}}),('phone-small',{**p.devices['iPhone 13'],'viewport':{'width':320,'height':740}}),('ipad',{**p.devices['iPad Mini'],'viewport':{'width':820,'height':1180}}),('landscape',{**p.devices['iPhone 13'],'viewport':{'width':844,'height':390}})]:
    context=browser.new_context(**settings,timezone_id='Europe/Rome')
    def bridge(route):
     if route.request.url==ENDPOINT:
      action=json.loads(route.request.post_data)['action']
      if action not in ['load','photoGet']:writes.append(action)
      request=urllib.request.Request('http://127.0.0.1:8766/',data=route.request.post_data.encode())
      with urllib.request.urlopen(request) as response:route.fulfill(status=200,content_type='application/json',body=response.read())
     elif route.request.url.startswith(base):route.continue_()
     else:route.abort()
    context.route('**/*',bridge);mock_admin_login(context);page=context.new_page();page.set_default_timeout(7000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.dismiss());page.goto(base)
    page.locator('#driveKey').fill(KEY);page.locator('#driveConnect').click();page.wait_for_selector('#munStatistics',state='visible')
    assert page.evaluate('currentSection')=='statistiche' and page.evaluate('Municipal.categoryFilter')=='all'
    mobile=page.evaluate('mMobile');nav='#mFieldNav' if mobile else '.mainNav';attribute='data-mobile-view' if mobile else 'data-view'
    assert [' '.join(text.split()) for text in page.locator(nav+' button').evaluate_all("els=>els.map(e=>e.querySelector('small')?.textContent||e.querySelector('span:last-child').textContent)")]==LABELS
    assert page.locator('.mainNav [data-view=archivio],#mFieldNav [data-mobile-view=archivio]').count()==0
    if name in ['pc','iphone']:page.screenshot(path=str(ARTIFACTS/f'{name}-overview.png'),full_page=True)
    def go(section):page.locator(f'{nav} [{attribute}="{section}"]').click()
    def tappable(selector):
     target=page.locator(selector);assert target.is_visible();box=target.bounding_box()
     assert page.evaluate("p=>!!document.elementFromPoint(p.x,p.y)?.closest(p.selector)",{'x':box['x']+box['width']/2,'y':box['y']+box['height']/2,'selector':selector}),(name,selector,box)
    go('anagrafica');assert page.locator('.workspace>.workTop').is_hidden();assert page.locator('#driveRefreshRegistry').is_visible()
    page.locator('[data-mun-category=furniture]').click();go('censimento');assert page.evaluate('Municipal.categoryFilter')=='trees'
    page.locator('[data-mun-category=furniture]').click();go('anagrafica');assert page.evaluate('Municipal.categoryFilter')=='furniture'
    go('statistiche');assert page.evaluate('Municipal.categoryFilter')=='all'
    go('mappa');page.evaluate('mp.lat=45.648;mp.lon=9.306;mp.z=18;draw()')
    bounds=page.locator('#map').bounding_box();toolbar=page.locator('#mapWorkspaceToolbar').bounding_box();assert toolbar['y']+toolbar['height']<=bounds['y']+1
    assert not page.locator('#munLayersButton').evaluate("e=>!!e.closest('.stage')")
    for selector in ['#zoomIn','#zoomOut','#munLayersButton','#munMapNew']:tappable(selector)
    for selector in ['#resetMap','#streetViewMap','#newGroupAreaMap']:
     page.locator(selector).scroll_into_view_if_needed();tappable(selector)
    if mobile:tappable('#mMapGPS')
    before=page.evaluate('mp.z');page.locator('#zoomIn').click();assert page.evaluate('mp.z')==before+1;page.locator('#zoomOut').click();assert page.evaluate('mp.z')==before
    if mobile:assert bounds['y']+bounds['height']<=page.locator('#mFieldNav').bounding_box()['y']+1
    page.locator('#munLayersButton').click();assert page.locator('#munLayers').evaluate('e=>e.open')
    page.locator('#munLayersAll').uncheck();assert page.evaluate('Object.values(Municipal.layers).every(v=>!v)')
    page.locator('#munLayersAll').check();assert page.evaluate('Object.values(Municipal.layers).every(Boolean)')
    page.locator('[data-layer=bin]').uncheck();assert page.locator('#munLayersAll').evaluate('e=>e.indeterminate')
    page.locator('#munLayersTreesOnly').click();assert page.evaluate("Municipal.layers.trees&&!Municipal.layers.bench&&!Municipal.layers.bin&&!Municipal.layers.playground_area&&!Municipal.layers.equipment")
    page.locator('#munLayersAll').check();assert page.locator('#munLayers').evaluate('e=>e.scrollWidth<=e.clientWidth')
    if name in ['pc','iphone']:page.screenshot(path=str(ARTIFACTS/f'{name}-layers.png'),full_page=True)
    tappable('#munLayersClose');page.locator('#munLayersClose').click();page.locator('#munMapNew').click();assert page.locator('[data-new-kind]').count()==5;page.locator('[data-mun-close]').click()
    page.locator('#munLayersButton').click();page.locator('#munHealthFilters>summary').click();page.locator('[data-place-tree="LES-000091"]').click();assert page.locator('#munLayers').is_hidden();assert page.locator('#cancelMapAdd').is_visible();page.locator('#cancelMapAdd').click()
    if page.locator('#v2AnagOverlay').is_visible():page.locator('#v2AnagClose').click()
    page.evaluate('showTreeMapCard(trees[0])');tappable('#editTreeMapCard');page.locator('#editTreeMapCard').click();page.locator('#v2DetailCensus').click();assert page.locator('#v2CensusForm').is_visible() and page.locator('#v2CensusSave').is_visible();assert page.evaluate('Municipal.categoryFilter')=='trees'
    go('mappa');page.evaluate('showTreeMapCard(trees[0])');page.locator('#editTreeMapCard').click();page.locator('#v2DetailEvent').click();assert page.locator('#v21EventsCollapse').is_visible()
    assert page.locator('#driveRecovery').is_hidden();page.locator('#adminOpen').click();page.locator('#adminPassword').fill('wrong-test-password');page.locator('#adminLoginButton').click();assert page.locator('#adminLoginError').is_visible();page.locator('#adminPassword').fill(ADMIN_TEST);page.locator('#adminLoginButton').click();page.locator('[data-admin-panel=archive]').click();assert page.locator('#driveRecovery').is_visible();assert page.locator('#viewArchivio').evaluate("e=>!!e.closest('#adminContent')")
    for selector in ['#csvFromWork','#geoFromWork','#importCsvWork','#archiveHistoricalTools>summary']:assert page.locator(selector).is_visible()
    page.locator('#archiveHistoricalTools>summary').click();assert page.locator('#historicalImportCard').is_visible()
    page.locator('#v2PhotoTab').click();assert page.locator('#viewFoto').is_visible() and page.locator('#qPick').is_visible() and page.locator('#qFiles').count()==1;assert page.locator('#archiveDataTools').is_hidden();page.locator('#v2ArchiveTab').click();assert page.locator('#driveRecovery').is_visible() and page.locator('#geoFromWork').is_visible()
    if name=='pc':
     with page.expect_download() as downloaded:page.locator('#driveRecovery').click()
     backup=json.loads(pathlib.Path(downloaded.value.path()).read_text());assert all(backup[k]==original[k] for k in ['trees','history','photos','assets','workOrders','customRoot']);assert len(backup['images'])==1
    page.locator('#adminClose').click();page.locator('#adminOpen').click();assert page.locator('#adminLogin').is_visible() and page.locator('#adminContent').is_hidden();page.locator('#adminClose').click()
    if name in ['pc','iphone']:go('mappa');page.screenshot(path=str(ARTIFACTS/f'{name}-map.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    print('PASS: '+name+' — panoramica iniziale, cinque tab coerenti, categorie indipendenti, zoom e scheda cliccabili, livelli completi, Archivio protetto in Admin',flush=True)
    context.close()
   assert rpc('load')['result']['data']==original and not writes,writes
   assert not errors,errors
   print('PASS: 91 alberi, rilievi, foto, arredi e metadati identici; navigazione e backup senza scritture',flush=True)
   # The retained historical importer must add a visit without rewriting existing records.
   context=browser.new_context(viewport={'width':1280,'height':900});context.route('**/*',bridge);mock_admin_login(context);page=context.new_page();page.set_default_timeout(7000);page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base);page.locator('#driveKey').fill(KEY);page.locator('#driveConnect').click();page.wait_for_function("document.body.classList.contains('driveConnected')")
   historical={'name':'rilievi-precedenti.csv','mimeType':'text/csv','buffer':b'codice;data;specie;stato;diametro_cm;note;fonte\nLESMO-A0001;2020-05-10;Tiglio;watch;19.75;Rilievo storico di prova;Archivio 2020'}
   def import_history():
    open_archive(page)
    if not page.locator('#archiveHistoricalTools').evaluate('e=>e.open'):page.locator('#archiveHistoricalTools>summary').click()
    with page.expect_file_chooser() as chooser:page.locator('#importHistorical').click()
    chooser.value.set_files(historical)
   import_history();page.wait_for_function("document.getElementById('historicImportResult').textContent.includes('1 rilievi importati')")
   current=rpc('load')['result'];assert current['data']['trees']==original['trees'];assert current['data']['history'][:len(original['history'])]==original['history'];assert len(current['data']['history'])==len(original['history'])+1
   assert all(current['data'][key]==original[key] for key in ['assets','photos','workOrders','customRoot']);assert page.evaluate('currentSection')=='censimento'
   import_history();page.wait_for_function("document.getElementById('historicImportResult').textContent.includes('Nessun rilievo nuovo')");assert rpc('load')['result']['revision']==current['revision'];assert writes==['save'],writes
   assert not errors,errors;context.close();browser.close();print('PASS: importazione storica da Admin conserva i 91 alberi e i rilievi originali; seconda importazione senza duplicati o nuove scritture',flush=True)
 finally:server.shutdown();service.terminate();service.wait()
if __name__=='__main__':main()
