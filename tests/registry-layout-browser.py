"""Registry density and reachable controls on PC and phones; read-only fake data."""
import argparse,functools,http.server,json,pathlib,re,tempfile,threading
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path(tempfile.gettempdir())/'lesmo-registry-layout';OUT.mkdir(exist_ok=True);ENDPOINT=re.search(r"const DEFAULT_DRIVE_URL = '([^']+)'",(ROOT/'drive-storage.js').read_text()).group(1)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
seed={'schema':4,'nextId':92,'trees':[{'id':f'LES-{i:06}','code':f'LESMO-A{i:04}','species':'Tiglio','status':'ok','lat':45.648,'lon':9.306,'address':'Via Marconi'} for i in range(1,92)],'history':[],'photos':[],'assets':[{'id':'ASSET-'+kind,'code':'TEST-'+kind,'assetKind':kind,'name':'Ingresso nord','condition':'good','address':'Via Marconi','lat':45.648,'lon':9.306} for kind in ['bench','bin','playground_area','equipment']]}
parser=argparse.ArgumentParser();parser.add_argument('--baseline',action='store_true');args=parser.parse_args();result=[];errors=[];writes=[]
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for name,width,height in [('pc',1440,1000),('laptop',1024,800),('iphone',390,844),('small',320,740)]:
   context=browser.new_context(**({**p.devices['iPhone 13'],'viewport':{'width':width,'height':height}} if name in ['iphone','small'] else {'viewport':{'width':width,'height':height}}))
   def bridge(route):
    if route.request.url==ENDPOINT:
     action=json.loads(route.request.post_data)['action']
     if action!='load':writes.append(action)
     route.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'result':{'revision':'layout-test','folderName':'Archivio di prova','data':seed}}))
    elif route.request.url.startswith(base):route.continue_()
    else:route.abort()
   context.route('**/*',bridge);page=context.new_page();page.set_default_timeout(6000);page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base);page.locator('#driveKey').fill('test-only-key-not-for-production-0123456789');page.locator('#driveConnect').click();page.wait_for_selector('#municipalCategories');page.wait_for_function("document.body.classList.contains('driveConnected')");page.evaluate("switchSection('anagrafica')")
   for category in ['trees','all','furniture','playgrounds']:
    page.locator(f'[data-mun-category={category}]').click()
    table='#overviewTable' if category=='trees' else '#munRegistry .munTable'
    box=page.locator(table).bounding_box();cat=page.locator('#municipalCategories').bounding_box()
    row={'device':name,'category':category,'tableTop':round(box['y'],1),'afterCategories':round(box['y']-cat['y']-cat['height'],1)};result.append(row)
    if not args.baseline:
     assert page.locator('#workFolderReminder').is_hidden() and page.locator('#mArchiveBanner').is_hidden()
     assert page.locator('#v2AnaSelectMap').count()==0
     assert page.locator('#driveRefreshRegistry').is_visible() and page.locator('#driveRefreshRegistry').is_enabled()
     assert row['afterCategories']<=(235 if width<740 else 160),row
     assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     assert not page.locator('#mobileRegistryFilters' if category=='trees' else '#munRegistryFilters').evaluate('e=>e.open')
     page.locator('#driveRefreshRegistry').click();page.wait_for_function("!document.getElementById('driveRefreshRegistry').disabled")
     assert page.locator('#driveRefreshStatus').inner_text().startswith('DB aggiornato')
    if category in ['trees','furniture']:page.screenshot(path=str(OUT/f'{"before" if args.baseline else "after"}-{name}-{category}.png'),full_page=True)
   print(name,[r for r in result if r['device']==name],flush=True);context.close()
  assert not errors,errors;assert not writes,writes;browser.close()
finally:
 (OUT/('baseline.json' if args.baseline else 'result.json')).write_text(json.dumps(result,indent=2));server.shutdown()
