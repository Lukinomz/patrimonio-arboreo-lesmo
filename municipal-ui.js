/* Censimento e gestione del patrimonio comunale, con un percorso uguale su PC e telefono. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id), html=value=>esc(String(value??''));
  const categories={all:'Tutti',trees:'Alberi',furniture:'Arredo urbano',playgrounds:'Aree giochi'};
  const icons={bench:'▰',bin:'▥',equipment:'◇',playground_area:'▱'};
  const conditionColors={good:'#2d8358',fair:'#bd8a1f',poor:'#d16e36',closed:'#ba4848',removed:'#6d7880',unknown:'#859792'};
  const taskNames={open:'Da pianificare',planned:'Programmato',progress:'In corso',done:'Completato'};
  const priorities={normal:'Ordinaria',high:'Alta',urgent:'Urgente'};
  const state={sort:'code',direction:1,selected:new Set(),page:0,taskFilter:'active'};
  let columnFilters;
  const sectionCategories={anagrafica:'trees',censimento:'trees',statistiche:'all',mappa:'trees'};
  window.setMunicipalSectionCategory=(section,category)=>{if(!Object.hasOwn(categories,category))return;sectionCategories[section]=category;if(currentSection===section)Municipal.categoryFilter=category;};
  window.prepareMunicipalSection=section=>{Municipal.categoryFilter=sectionCategories[section]||'trees';};
  let dialog,returnFocus,photoUrls=[],photoToken=0,mapPickCancel=null,treePositionMeta=null;
  const label=(key,text,input,wide=false)=>`<label class="${wide?'munWide':''}" for="${key}"><span>${text}</span>${input}</label>`;
  const input=(id,value='',attrs='')=>`<input id="${id}" value="${html(value)}" ${attrs}/>`;
  const option=(value,text,selected)=>`<option value="${html(value)}" ${value===selected?'selected':''}>${html(text)}</option>`;
  const select=(id,values,value)=>`<select id="${id}">${Object.entries(values).map(([k,v])=>option(k,v,value)).join('')}</select>`;
  const fmtDate=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'—';
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('it');
  const categoryRecords=()=>allMunicipalRecords().filter(r=>Municipal.categoryFilter==='all'||Municipal.category(r)===Municipal.categoryFilter);
  const photoCountFor=id=>photos.filter(p=>p.treeId===id&&!p.removed).length;
  const inspections=id=>historyEvents.filter(e=>e.treeId===id&&['asset_rilievo','rilievo','censimento'].includes(e.type)).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.created||'').localeCompare(String(a.created||'')));
  const sites=()=>Object.entries(MUNICIPAL_CONTEXTS).map(([id,name])=>({id,name}));
  function siteOptions(id,exclude){return municipalContextOptions(id,exclude);}
  function statusBadge(record){return `<span class="munBadge" style="--badge:${conditionColors[record.condition]||MAP_MARKER_COLORS[record.status]||'#71877c'}">${html(municipalStatus(record))}</span>`;}
  function close(){if(municipalBusy)return;photoToken++;photoUrls.forEach(URL.revokeObjectURL);photoUrls=[];dialog.close();returnFocus?.focus?.({preventScroll:true});}
  function show(title,body,actions=''){
    photoToken++;photoUrls.forEach(URL.revokeObjectURL);photoUrls=[];
    if(!dialog.open)returnFocus=document.activeElement;
    dialog.innerHTML=`<header class="munDialogHead"><div><small>PATRIMONIO COMUNALE</small><h2 id="munTitle">${html(title)}</h2></div><button type="button" class="munClose" data-mun-close aria-label="Chiudi">×</button></header><div class="munDialogBody">${body}</div>${actions?`<footer class="munDialogFoot">${actions}</footer>`:''}<p id="munError" role="alert" hidden></p>`;
    if(!dialog.open)dialog.showModal();dialog.scrollTop=0;
    dialog.querySelector('[data-mun-close]').onclick=close;
    return dialog;
  }
  function error(message){$('munError').hidden=false;$('munError').textContent=message;$('munError').scrollIntoView({block:'nearest'});}
  async function action(button,work){
    if(municipalBusy)return;button.disabled=true;const text=button.textContent;button.textContent='Salvataggio…';
    try{await work();}catch(ex){error(ex.message);}finally{if(button.isConnected){button.disabled=false;button.textContent=text;}}
  }
  function setCategory(value){
    if(!Object.hasOwn(categories,value))return;
    sectionCategories[currentSection]=value;Municipal.categoryFilter=value;state.page=0;state.selected.clear();
    $('overviewStatus').value='all';window.resetRegistryFilters?.({preserveContext:true});columnFilters?.reset({preserveContext:true});
    document.body.classList.toggle('municipalOther',value!=='trees');
    document.querySelectorAll('[data-mun-category]').forEach(b=>{const active=b.dataset.munCategory===value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
    switchSection(currentSection||'anagrafica');
  }
  window.showMunicipalChoice=function(){
    const category=Municipal.categoryFilter,choices=category==='furniture'?['bench','bin']:category==='playgrounds'?['playground_area','equipment']:['tree','bench','bin','playground_area','equipment'];
    show('Aggiungi un elemento',`<div class="munChoiceGrid">${choices.map(kind=>`<button type="button" data-new-kind="${kind}"><span>${icons[kind]||'♣'}</span><strong>${kind==='tree'?'Albero':Municipal.kinds[kind]}</strong><small>${({tree:'Singolo, gruppo o fascia boschiva',bench:'Sedute e panchine',bin:'Rifiuti e raccolta differenziata',playground_area:'Perimetro e informazioni dell’area',equipment:'Altalene, scivoli e altri giochi'})[kind]}</small></button>`).join('')}</div>`);
    dialog.querySelectorAll('[data-new-kind]').forEach(b=>b.onclick=()=>{const kind=b.dataset.newKind;if(kind==='tree'){close();setCategory('trees');showAddChoice();}else openAssetForm(null,{assetKind:kind});});
  };
  window.openAssetForm=function(record=null,template={}){
    const model=record?structuredClone(record):{...template,condition:'unknown'},kind=model.assetKind||'bench';let geometry=structuredClone(model.geometry||null),positionMeta=structuredClone(model.positionMeta||null);
    if(!record&&kind==='park')return;
    const area=kind==='playground_area';
    show(record?`Modifica ${record.code}`:`Nuovo elemento · ${Municipal.kinds[kind]}`,`<form id="munAssetForm"><div class="munFormGrid">
      ${label('munCode','Codice',input('munCode',model.code||municipalNextCode(kind),'required maxlength="50"'))}
      ${label('munName',area?'Nome dell’area':'Nome / descrizione',input('munName',model.name||'','required maxlength="160" placeholder="Es. ingresso nord"'))}
      ${label('munArea','Contesto',`<select id="munArea">${siteOptions(municipalContextId(model))}</select>`)}
      ${label('munAddress','Via/Località/Parco',input('munAddress',model.address||'','maxlength="200"'))}
      ${label('munMaterial','Materiale',input('munMaterial',model.material||'','maxlength="100" list="munMaterials"'))}
      ${label('munModel','Modello / produttore',input('munModel',model.model||'','maxlength="160"'))}
      ${kind==='equipment'?label('munEquipmentType','Tipo di gioco',select('munEquipmentType',{swing:'Altalena',slide:'Scivolo',climbing:'Arrampicata',spring:'Gioco a molla',combined:'Gioco combinato',other:'Altro'},model.equipmentType||'other'))+label('munAge','Fascia d’età',input('munAge',model.ageRange||'','placeholder="Es. 3–12 anni" maxlength="60"')):''}
      ${kind==='bin'?label('munWaste','Raccolta',select('munWaste',{mixed:'Indifferenziata',separate:'Differenziata',dog:'Deiezioni canine',other:'Altro'},model.wasteType||'mixed')):''}
      ${kind==='playground_area'?label('munSurface','Pavimentazione',input('munSurface',model.surface||'','maxlength="100"'))+label('munFence','Recinzione',select('munFence',{'':'Da verificare',yes:'Presente',no:'Assente'},model.fence||'')):''}
      ${label('munInstalled','Data installazione',input('munInstalled',model.installed||'','type="date"'))}
      ${!record?label('munCondition','Condizione iniziale',select('munCondition',Municipal.conditions,model.condition))+label('munDate','Data osservazione',input('munDate',localDay(),'type="date" required')):''}
      <section class="munLocation munWide"><h3>Posizione ${area?'e perimetro':''}</h3><div class="munFormGrid">${label('munLat','Latitudine',input('munLat',model.lat??'','type="number" step="any" min="-85" max="85"'))}${label('munLon','Longitudine',input('munLon',model.lon??'','type="number" step="any" min="-180" max="180"'))}</div><p id="munPositionInfo" class="munHint"></p><div class="munActions"><button type="button" class="btn" id="munGPS">⌖ Rileva GPS</button><button type="button" class="btn" id="munPick">Scegli sulla mappa</button>${area?'<button type="button" class="btn" id="munPerimeter">Delimita area</button><button type="button" class="btn" id="munRemovePerimeter">Rimuovi perimetro</button>':''}</div><p id="munAreaInfo" class="munHint"></p></section>
      ${label('munNotes','Note della scheda',`<textarea id="munNotes" rows="3" maxlength="12000">${html(model.notes||'')}</textarea>`,true)}
      ${label('munFiles','Fotografie',input('munFiles','','type="file" accept="image/*" multiple'),true)}
      ${!record?'<label class="munCheck munWide"><input type="checkbox" id="munRepeat"/> Dopo il salvataggio inserisci un elemento simile</label>':''}
      </div><datalist id="munMaterials"><option>Legno</option><option>Metallo</option><option>Plastica riciclata</option><option>Calcestruzzo</option></datalist>
      <div class="munDialogFoot"><button class="btn" type="button" id="munAssetCancel">Annulla</button><button class="btn main" type="submit" id="munAssetSave">Salva ${Municipal.kinds[kind].toLocaleLowerCase('it')}</button></div></form>`);
    const locationInfo=()=>{$('munPositionInfo').textContent=positionMeta?.source==='gps'?`GPS · precisione stimata ±${Math.round(positionMeta.accuracy)} m · ${new Date(positionMeta.at).toLocaleString('it-IT')}`:positionMeta?.source==='manual'?'Posizione verificata sulla mappa':'Puoi salvare anche senza coordinate.';if(area){$('munAreaInfo').textContent=geometry?`Perimetro salvato nella scheda · circa ${Math.round(municipalPolygonSize(geometry)).toLocaleString('it-IT')} m²`:'Perimetro non ancora delimitato';$('munRemovePerimeter').hidden=!geometry;}};
    locationInfo();$('munAssetCancel').onclick=close;
    const assignPoint=point=>{$('munLat').value=point.lat;$('munLon').value=point.lon;positionMeta=point.positionMeta||{source:'manual',at:new Date().toISOString(),accuracy:null};if(positionMeta.source==='gps')mGpsPoint={lat:point.lat,lon:point.lon,accuracy:positionMeta.accuracy,at:positionMeta.at};locationInfo();};
    for(const id of ['munLat','munLon'])$(id).oninput=()=>{geometry=null;positionMeta={source:'manual',at:new Date().toISOString(),accuracy:null};locationInfo();};
    $('munGPS').onclick=async()=>{const point=await acquireMunicipalGPS();if(point){assignPoint(point);geometry=null;}};
    $('munPick').onclick=()=>{const point={lat:Number($('munLat').value),lon:Number($('munLon').value)};pickMapPoint(assignPoint,$('munLat').value!==''&&$('munLon').value!==''&&isValid(point)?point:null);};
    if(area){$('munPerimeter').onclick=()=>{dialog.close();beginMunicipalArea({geometry,onConfirm:shape=>{geometry=shape;assignPoint(municipalPolygonCenter(shape));dialog.showModal();locationInfo();},onCancel:()=>dialog.showModal()});};$('munRemovePerimeter').onclick=()=>{geometry=null;locationInfo();};}
    $('munAssetForm').onsubmit=e=>{e.preventDefault();action($('munAssetSave'),async()=>{
      const code=$('munCode').value.trim(),name=$('munName').value.trim(),lat=$('munLat').value===''?null:Number($('munLat').value),lon=$('munLon').value===''?null:Number($('munLon').value);
      if(!code||/[<>\r\n]/.test(code)||/^[=+@]/.test(code))throw Error('Scrivi un codice valido.');
      if(!name)throw Error('Inserisci un nome o una descrizione.');
      if(allMunicipalRecords().some(r=>r.id!==record?.id&&publicCodeKey(r.code||r.id)===publicCodeKey(code)))throw Error('Questo codice è già utilizzato. Scegline uno libero.');
      if((lat===null)!==(lon===null)||lat!==null&&(!isValid({lat,lon})||lat===0&&lon===0))throw Error('Inserisci entrambe le coordinate oppure lasciale vuote.');
      const now=new Date().toISOString(),next={...model,id:record?.id||'ASSET-'+uniqueID(),assetKind:kind,code,name,material:$('munMaterial').value.trim(),model:$('munModel').value.trim(),address:$('munAddress').value.trim(),areaId:record?.areaId||null,siteType:readMunicipalSiteType(record,$('munArea').value),installed:$('munInstalled').value||null,notes:$('munNotes').value.trim(),lat,lon,geometry,positionMeta:lat===null?null:positionMeta,modified:now,created:record?.created||now};
      if(kind==='equipment'){next.equipmentType=$('munEquipmentType').value;next.ageRange=$('munAge').value.trim();}if(kind==='bin')next.wasteType=$('munWaste').value;if(kind==='playground_area'){next.surface=$('munSurface').value.trim();next.fence=$('munFence').value;}
      if(!record){next.condition=$('munCondition').value;next.date=$('munDate').value;next.initialObservationNotes=next.notes;}
      const files=[...$('munFiles').files],repeat=$('munRepeat')?.checked;
      await municipalTransaction(async({assets})=>{await municipalUpload(files,next.id,'censimento',null,next.date);if(record)assets[assets.findIndex(r=>r.id===record.id)]=next;else assets.push(next);municipalEvent(next.id,record?'asset_anagrafica':'asset_rilievo',record?'Aggiornamento scheda':next.notes||'Prima osservazione',next);if(!record)historyEvents.at(-1).date=next.date;});
      close();tell(`${code} salvato`);if(repeat)openAssetForm(null,similarFields(next));else openMunicipalDetail(municipalRecord(next.id));
    });};
  };
  function similarFields(record){
    const keys=['assetKind','name','material','model','address','siteType','equipmentType','ageRange','wasteType','surface','fence'];
    return Object.fromEntries(keys.filter(key=>record[key]!==undefined).map(key=>[key,record[key]]));
  }
  function pickMapPoint(onConfirm,point){
    dialog.close();stopMapAdd();hideTreeCard();switchSection('mappa');
    if(point){mp.lat=Number(point.lat);mp.lon=Number(point.lon);mp.z=Math.max(18,mp.z);resetTiles();}
    $('munPointTools').hidden=false;addMode=true;$('map').classList.add('addMode');
    mapPickCancel=()=>{window.municipalMapPick=null;mapPickCancel=null;addMode=false;$('map').classList.remove('addMode');$('munPointTools').hidden=true;drawPins();dialog.showModal();};
    window.municipalMapPick=geo=>{onConfirm({lat:+geo.lat.toFixed(7),lon:+geo.lon.toFixed(7),positionMeta:{source:'manual',at:new Date().toISOString(),accuracy:null}});mapPickCancel();};draw();
  }
  window.openMunicipalDetail=function(record){
    if(!record?.assetKind){openTree(record.id);return;}
    const events=inspections(record.id),orders=Municipal.workOrders.filter(o=>o.recordId===record.id);
    const metrics=[['Tipo',Municipal.kinds[record.assetKind]],['Condizione',municipalStatus(record)],['Via/Località/Parco',record.address||'—'],['Contesto',municipalContextLabel(record)||'—'],['Materiale',record.material||'—'],['Modello / produttore',record.model||'—'],['Installazione',fmtDate(record.installed)],['Ultima osservazione',fmtDate(record.date)]];
    if(record.ageRange)metrics.push(['Età',record.ageRange]);if(record.surface)metrics.push(['Pavimentazione',record.surface]);
    show(`${record.code} · ${record.name}`,`<div class="munDetailMetrics">${metrics.map(([k,v])=>`<div><small>${html(k)}</small><strong>${html(v)}</strong></div>`).join('')}</div><h3>Note della scheda</h3><p class="munNotes">${html(record.notes||'Nessuna nota.')}</p>${record.positionMeta?`<p class="munHint">Posizione: ${record.positionMeta.source==='gps'?`GPS, precisione stimata ±${Math.round(record.positionMeta.accuracy)} m`:'indicata sulla mappa'} · ${fmtDate(record.positionMeta.at)}</p>`:''}
      <section><h3>Rilevazioni · ${events.length}</h3><div class="munHistory">${events.map(e=>`<article><header><strong>${fmtDate(e.date)}</strong><span>${html(Municipal.conditions[e.snapshot?.condition]||'')}</span></header><p class="munNotes">${html(e.description||'Nessuna osservazione')}</p>${e.operator?`<small>${html(e.operator)}</small>`:''}<button class="tinyBtn" type="button" data-reuse="${html(e.id)}">Usa come riferimento per un nuovo rilievo</button></article>`).join('')||'<p>Nessuna rilevazione.</p>'}</div></section>
      <section><h3>Interventi · ${orders.length}</h3>${orders.map(taskCard).join('')||'<p class="munHint">Nessun intervento registrato.</p>'}</section>
      <h3>Fotografie · ${photoCountFor(record.id)}</h3><div id="munPhotos" class="munPhotos"></div>`,
      `<button class="btn" id="munDetailEdit" ${record.assetKind==='park'?'disabled':''}>Modifica scheda</button><button class="btn main" id="munDetailInspect">Nuovo rilievo</button><button class="btn" id="munDetailTask">Crea intervento</button><button class="btn" id="munDetailMap" ${!isValid(record)?'disabled':''}>Mappa</button><button class="btn" id="munDetailQR">Etichetta QR</button><button class="btn" id="munDetailSimilar">Inserisci simile</button>`);
    $('munDetailEdit').onclick=()=>openAssetForm(record);$('munDetailInspect').onclick=()=>openAssetInspection(record);$('munDetailTask').onclick=()=>openTaskForm([record.id]);$('munDetailQR').onclick=()=>showQR([record]);$('munDetailSimilar').onclick=()=>openAssetForm(null,similarFields(record));
    $('munDetailMap').onclick=()=>{close();if(record.geometry)focusMunicipalArea(record.geometry);else{mp.lat=+record.lat;mp.lon=+record.lon;mp.z=18;resetTiles();}switchSection('mappa');draw();};
    dialog.querySelectorAll('[data-reuse]').forEach(b=>b.onclick=()=>openAssetInspection(record,events.find(e=>e.id===b.dataset.reuse)));
    bindTaskButtons(dialog);loadPhotos(record.id,$('munPhotos'));
  };
  async function loadPhotos(id,container,orderId){
    const token=photoToken,items=photos.filter(p=>p.treeId===id&&!p.removed&&(!orderId||p.orderId===orderId));
    container.textContent=items.length?'Caricamento fotografie…':'Nessuna fotografia.';
    const nodes=await Promise.all(items.map(async photo=>{try{const handle=await filePathHandle(photo.relativePath),file=await handle.getFile();if(token!==photoToken)return null;const url=URL.createObjectURL(file);photoUrls.push(url);const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';const img=document.createElement('img');img.src=url;img.alt=photo.originalName||'Fotografia';a.append(img);const caption=document.createElement('small');caption.textContent=`${fmtDate(photo.date)}${photo.stage==='after'?' · Dopo intervento':photo.stage==='before'?' · Prima intervento':''}`;a.append(caption);return a;}catch(_){const p=document.createElement('p');p.textContent='Fotografia non disponibile. Riprova dopo avere aggiornato il collegamento.';return p;}}));
    if(token===photoToken){container.replaceChildren(...nodes.filter(Boolean));}
  }
  function openAssetInspection(record,reference){
    const previous=reference?.snapshot||record,date=reference?.date||record.date;
    show(`Rilevazione · ${record.code}`,`<p class="munIdentity">${html(record.name)} · ${html(record.address||municipalContextLabel(record))}</p><section class="munReference"><strong>Riferimento: ${fmtDate(date)}</strong><p>${html(Municipal.conditions[previous.condition]||'Da valutare')} · ${html(reference?.description||record.surveyNotes||record.initialObservationNotes||'Nessuna osservazione precedente.')}</p><small>La nuova rilevazione avrà una data e osservazioni proprie.</small></section><form id="munInspectionForm"><div class="munFormGrid">${label('munInspectionDate','Data rilevazione',input('munInspectionDate',localDay(),'type="date" required'))}${label('munInspectionOperator','Operatore',input('munInspectionOperator','','maxlength="160"'))}${label('munInspectionCondition','Condizione rilevata',select('munInspectionCondition',Municipal.conditions,previous.condition))}${label('munNextCheck','Prossima verifica',input('munNextCheck',previous.nextCheck||'','type="date"'))}${label('munInspectionNotes','Osservazioni di questa visita',`<textarea id="munInspectionNotes" rows="4" maxlength="12000" placeholder="Danni, usura, pulizia, stabilità, accessibilità…"></textarea>`,true)}${label('munInspectionFiles','Fotografie della visita',input('munInspectionFiles','','type="file" accept="image/*" multiple'),true)}<label class="munCheck munWide"><input type="checkbox" id="munCreateTask"/> Crea un intervento dopo il salvataggio</label></div><div class="munDialogFoot"><button class="btn main" type="submit" id="munInspectionSave">Salva rilevazione</button></div></form>`);
    $('munInspectionForm').onsubmit=e=>{e.preventDefault();action($('munInspectionSave'),async()=>{
      const date=$('munInspectionDate').value;if(!date)throw Error('Indica la data della rilevazione.');
      const historical=record.date&&date<record.date;if(historical&&!confirm('Questa rilevazione è precedente all’ultima. Verrà aggiunta allo storico mantenendo la condizione attuale della scheda. Continuare?'))return;
      const snapshot={...record,condition:$('munInspectionCondition').value,nextCheck:$('munNextCheck').value||null,date,surveyNotes:$('munInspectionNotes').value.trim()},operator=$('munInspectionOperator').value.trim(),createTask=$('munCreateTask').checked,files=[...$('munInspectionFiles').files];
      await municipalTransaction(async({assets})=>{await municipalUpload(files,record.id,'rilievo',null,date);municipalEvent(record.id,'asset_rilievo',snapshot.surveyNotes||'Controllo periodico',snapshot);Object.assign(historyEvents.at(-1),{date,operator});if(!historical)assets[assets.findIndex(r=>r.id===record.id)]={...snapshot,modified:new Date().toISOString()};});
      close();tell('Rilevazione salvata nello storico.');if(createTask)openTaskForm([record.id]);else openMunicipalDetail(municipalRecord(record.id));
    });};
  }
  const commonColumns={code:'Codice',kind:'Tipo',name:'Nome / specie',area:'Contesto',address:'Via/Località/Parco',condition:'Condizione',gps:'GPS',photos:'Foto',inspections:'Rilievi',date:'Ultimo rilievo',nextCheck:'Prossima verifica',modified:'Ultima modifica'};
  const commonDefaults=Object.keys(commonColumns),commonVisible=new Set(commonDefaults);
  Object.assign(commonColumns,{material:'Materiale',model:'Modello / produttore',installed:'Installazione',equipmentType:'Tipo gioco',ageRange:'Fascia d’età',surface:'Pavimentazione',fence:'Recinzione',wasteType:'Raccolta',lat:'Latitudine',lon:'Longitudine',notes:'Note della scheda',surveyNotes:'Ultime osservazioni',geometry:'Perimetro GeoJSON'});

  function commonRows(){return categoryRecords().map(r=>({record:r,code:r.code||r.id,kind:r.assetKind?Municipal.kinds[r.assetKind]:'Alberi',name:municipalName(r),area:municipalContextLabel(r),address:r.address||'',condition:municipalStatus(r),gps:isValid(r)?1:0,photos:photoCountFor(r.id),inspections:inspections(r.id).length,date:r.date||'',nextCheck:r.nextCheck||'',modified:(r.modified||r.created||'').slice(0,10),...Object.fromEntries(['material','model','installed','equipmentType','ageRange','surface','fence','wasteType','lat','lon','notes','surveyNotes'].map(key=>[key,r[key]??''])),geometry:r.geometry?JSON.stringify(r.geometry):''}));}
  function commonBaseMatch(row){
    const tokens=normalize($('munSearch').value).split(/\s+/).filter(Boolean),location=$('munGPSFilter').value;
    return tokens.every(t=>normalize([row.code,row.name,row.address,row.area,row.record.notes,row.record.surveyNotes].join(' ')).includes(t))&&(location==='all'||Boolean(row.gps)===(location==='yes'));
  }
  function filteredCommon(){
    return commonRows().filter(row=>commonBaseMatch(row)&&(!columnFilters||columnFilters.matches(row))).sort((a,b)=>{
      const av=a[state.sort],bv=b[state.sort];if((av==='')!==(bv===''))return av===''?1:-1;
      return (typeof av==='number'?av-bv:String(av).localeCompare(String(bv),'it',{numeric:true,sensitivity:'base'}))*state.direction||a.code.localeCompare(b.code,'it',{numeric:true});
    });
  }
  function renderCommon(){
    if(!$('munRegistry'))return;
    const oldArea=$('munAreaFilter').value,oldKind=$('munKindFilter').value;
    $('munAreaFilter').innerHTML=option('all','Tutti i contesti',oldArea)+option('none','Senza contesto',oldArea)+sites().map(a=>option(a.id,a.name,oldArea)).join('');if(!$('munAreaFilter').value)$('munAreaFilter').value='all';
    const allowed=Municipal.categoryFilter==='furniture'?['bench','bin']:Municipal.categoryFilter==='playgrounds'?['playground_area','equipment']:Object.keys(Municipal.kinds);
    $('munKindFilter').innerHTML=option('all','Tutti i tipi',oldKind)+(Municipal.categoryFilter==='all'?option('trees','Alberi',oldKind):'')+allowed.map(k=>option(k,Municipal.kinds[k],oldKind)).join('');if(!$('munKindFilter').value)$('munKindFilter').value='all';
    $('munCommonSort').value=state.sort;$('munCommonDirection').textContent=state.direction===1?'↑':'↓';
    const rows=filteredCommon(),size=30,max=Math.max(1,Math.ceil(rows.length/size));state.page=Math.min(state.page,max-1);
    for(const id of state.selected)if(!municipalRecord(id))state.selected.delete(id);
    $('munRegistryBreakdown').innerHTML=municipalBreakdown(rows.map(row=>row.record));
    $('munRegistryCount').textContent=`${rows.length} di ${categoryRecords().length} schede`;
    $('munRegistryHead').innerHTML=`<th><input type="checkbox" id="munSelectPage" aria-label="Seleziona questa pagina"/></th>`+Object.entries(commonColumns).filter(([key])=>commonVisible.has(key)).map(([key,name])=>`<th aria-sort="${state.sort===key?(state.direction===1?'ascending':'descending'):'none'}"><button type="button" data-mun-sort="${key}">${name}<span>${state.sort===key?(state.direction===1?'↑':'↓'):'↕'}</span></button></th>`).join('');
    const page=rows.slice(state.page*size,(state.page+1)*size);
    $('munRegistryRows').innerHTML=page.map(row=>`<tr><td><input type="checkbox" data-mun-select="${html(row.record.id)}" ${state.selected.has(row.record.id)?'checked':''} aria-label="Seleziona ${html(row.code)}"/></td>${Object.keys(commonColumns).filter(key=>commonVisible.has(key)).map(key=>`<td data-label="${commonColumns[key]}">${key==='code'?`<button class="codeLink" data-mun-open="${html(row.record.id)}">${html(row.code)}</button>`:key==='condition'?statusBadge(row.record):key==='gps'?row.gps?`<button class="tinyBtn" data-mun-map="${html(row.record.id)}">⌖ Mappa</button>`:'Da posizionare':['date','nextCheck','modified','installed'].includes(key)?fmtDate(row[key]):html(row[key]!==''&&row[key]!==null&&row[key]!==undefined?row[key]:'—')}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="13" class="munEmpty">Nessuna scheda corrisponde ai filtri.</td></tr>';
    $('munSelectPage').checked=page.length>0&&page.every(row=>state.selected.has(row.record.id));$('munSelectPage').indeterminate=page.some(row=>state.selected.has(row.record.id))&&!$('munSelectPage').checked;
    $('munSelectPage').onchange=e=>{page.forEach(row=>e.target.checked?state.selected.add(row.record.id):state.selected.delete(row.record.id));renderCommon();};
    $('munBulkCount').textContent=`${state.selected.size} selezionati`;$('munBulkActions').hidden=!state.selected.size;
    $('munPageInfo').textContent=`${rows.length} elementi · Pagina ${state.page+1} di ${max}`;$('munPrev').disabled=!state.page;$('munNext').disabled=state.page+1>=max;
    $('munExport').disabled=!rows.length;columnFilters?.headers($('munRegistry').querySelector('table'),'data-mun-sort');columnFilters?.chips($('munFilterChips'));
  }
  function setupRegistry(){
    $('viewRiepilogo').insertAdjacentHTML('beforeend',`<section id="munRegistry" class="workCard"><div class="sectionHead"><div><h2>Elementi registrati</h2><p id="munRegistryCount"></p></div><div class="munActions"><button class="btn" id="munExport">Esporta CSV</button><button class="btn main" id="munNew">＋ Nuovo elemento</button></div></div><div class="munFilters"><label class="munSearchLabel"><span>Cerca nel registro</span><input type="search" id="munSearch" placeholder="Codice, nome, via, note…"/></label><label><span>Tipo</span><select id="munKindFilter"><option value="all">Tutti i tipi</option></select></label><label><span>Condizione</span><select id="munConditionFilter">${option('all','Tutte le condizioni','all')+Object.entries(Municipal.conditions).map(([k,v])=>option(k,v)).join('')+Object.entries(statusName).map(([k,v])=>option(k,v)).join('')}</select></label><label><span>Posizione</span><select id="munGPSFilter"><option value="all">Con e senza GPS</option><option value="yes">Con GPS</option><option value="no">Da posizionare</option></select></label><label><span>Contesto</span><select id="munAreaFilter"><option value="all">Tutti i contesti</option></select></label><button type="button" class="btn" id="munReset">Azzera filtri</button></div><div class="munTableTools"><label>Ordina per <select id="munCommonSort">${Object.entries(commonColumns).map(([key,name])=>option(key,name,'code')).join('')}</select></label><button type="button" class="btn" id="munCommonDirection" aria-label="Inverti ordinamento">↑</button><details class="munColumnMenu"><summary>Colonne</summary><div id="munCommonColumns">${Object.entries(commonColumns).map(([key,name])=>`<label><input type="checkbox" value="${key}" ${commonVisible.has(key)?'checked':''} ${key==='code'?'disabled':''}/> ${name}</label>`).join('')}</div></details></div><div class="munBulk" id="munBulkActions" hidden><strong id="munBulkCount"></strong><button type="button" id="munBulkTask">Crea interventi</button><button type="button" id="munBulkArea">Assegna contesto</button><button type="button" id="munBulkQR">Etichette QR</button><button type="button" id="munBulkClear">Deseleziona</button></div><div id="munFilterChips" class="columnFilterChips" hidden></div><div id="munRegistryBreakdown" class="contextBreakdown" role="status"></div><div class="munTableViewport"><table class="munTable"><thead><tr id="munRegistryHead"></tr></thead><tbody id="munRegistryRows"></tbody></table></div><footer class="munTableFoot"><span id="munPageInfo"></span><div><button class="btn" id="munPrev">Precedente</button><button class="btn" id="munNext">Successiva</button></div></footer></section>`);
    const columns=Object.fromEntries(Object.entries(commonColumns).map(([key,label])=>[key,{label,type:['lat','lon','photos','inspections'].includes(key)?'number':['date','nextCheck','modified','installed'].includes(key)?'date':'text'}]));
    columns.area={label:'Contesto',context:true,value:row=>municipalContextId(row.record),format:municipalAreaName};columns.gps.format=value=>value==='1'?'Con GPS':'Senza GPS';
    columnFilters=RegistryFilters.create({id:'municipal',columns,getRows:commonRows,baseMatch:commonBaseMatch,onChange:()=>{state.page=0;renderDashboard();}});
    for(const [id,key,allLabel] of [['munKindFilter','kind','Tutti i tipi'],['munConditionFilter','condition','Tutte le condizioni'],['munAreaFilter','area','Tutti i contesti']]){const select=$(id),button=document.createElement('button');button.id=id+'Trigger';select.hidden=true;select.insertAdjacentElement('afterend',button);columnFilters.quickButton(button,key,allLabel);}
    $('munCommonSort').onchange=e=>{state.sort=e.target.value;state.direction=1;renderCommon();};$('munCommonDirection').onclick=()=>{state.direction*=-1;renderCommon();};$('munCommonColumns').onchange=e=>{if(e.target.checked)commonVisible.add(e.target.value);else commonVisible.delete(e.target.value);renderCommon();};
    $('munNew').onclick=showMunicipalChoice;$('munPrev').onclick=()=>{state.page--;renderCommon();};$('munNext').onclick=()=>{state.page++;renderCommon();};
    for(const id of ['munSearch','munKindFilter','munConditionFilter','munGPSFilter','munAreaFilter'])$(id).addEventListener(id==='munSearch'?'input':'change',()=>{state.page=0;renderCommon();});
    $('munReset').onclick=()=>{columnFilters.reset();$('munSearch').value='';for(const id of ['munKindFilter','munConditionFilter','munGPSFilter','munAreaFilter'])$(id).value='all';state.page=0;renderDashboard();};
    $('munRegistry').addEventListener('click',e=>{const sort=e.target.closest('[data-mun-sort]');if(sort){if(state.sort===sort.dataset.munSort)state.direction*=-1;else{state.sort=sort.dataset.munSort;state.direction=1;}renderCommon();}
      const open=e.target.closest('[data-mun-open]');if(open)openRecord(open.dataset.munOpen);
      const map=e.target.closest('[data-mun-map]');if(map)showRecordOnMap(map.dataset.munMap);
    });
    $('munRegistry').addEventListener('change',e=>{const id=e.target.dataset.munSelect;if(id){if(e.target.checked)state.selected.add(id);else state.selected.delete(id);renderCommon();}});
    $('munBulkClear').onclick=()=>{state.selected.clear();renderCommon();};$('munBulkTask').onclick=()=>openTaskForm([...state.selected]);$('munBulkArea').onclick=assignBulkArea;$('munBulkQR').onclick=()=>showQR([...state.selected].map(municipalRecord));
    $('munExport').onclick=()=>{
      const rows=filteredCommon(),columns={...commonColumns,material:'Materiale',model:'Modello',lat:'Latitudine',lon:'Longitudine',notes:'Note',surveyNotes:'Ultime osservazioni',geometry:'Perimetro GeoJSON',positionMeta:'Fonte e accuratezza GPS'};
      const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
      const data=rows.map(row=>Object.keys(columns).map(key=>key==='gps'?(row.gps?'Con GPS':'Senza GPS'):['geometry','positionMeta'].includes(key)?JSON.stringify(row.record[key]||null):row[key]??row.record[key]??''));
      fileDownload('patrimonio_lesmo_filtrato.csv','\ufeff'+[Object.values(columns),...data].map(r=>r.map(quote).join(';')).join('\r\n'),'text/csv;charset=utf-8');tell(`${rows.length} schede esportate`);
    };
  }
  function openRecord(id){const r=municipalRecord(id);if(r?.assetKind)openMunicipalDetail(r);else if(r)openTree(id);}
  function showRecordOnMap(id){const r=municipalRecord(id);if(!r)return;if(!isValid(r)){openRecord(id);return;}close();Municipal.layers[r.assetKind||'trees']=true;mp.lat=+r.lat;mp.lon=+r.lon;mp.z=18;resetTiles();switchSection('mappa');draw();}
  function assignBulkArea(){
    const ids=[...state.selected];show(`Assegna contesto · ${ids.length} elementi`,`<p>Gli elementi selezionati saranno collegati al contesto scelto.</p><label>Contesto<select id="munBulkAreaValue">${siteOptions(null)}</select></label><details><summary>Controlla gli elementi selezionati</summary><p>${ids.map(id=>html(municipalRecord(id)?.code)).join(' · ')}</p></details>`,`<button class="btn main" id="munBulkAreaSave">Conferma assegnazione</button>`);
    $('munBulkAreaSave').onclick=()=>action($('munBulkAreaSave'),async()=>{const areaId=$('munBulkAreaValue').value||null;await municipalTransaction(()=>{for(const id of ids){const r=municipalRecord(id);applyMunicipalContext(r,areaId);r.modified=new Date().toISOString();municipalEvent(id,'assegnazione_area',areaId?'Assegnato a '+municipalAreaName(areaId):'Collegamento all’area rimosso',r);}});close();state.selected.clear();renderCommon();tell('Contesto aggiornato per '+ids.length+' elementi.');});
  }
  function taskCard(order){
    const record=municipalRecord(order.recordId),late=order.due&&order.due<localDay()&&order.status!=='done';
    return `<article class="munTask ${late?'late':''}"><div><small>${html(record?.code||order.recordCode||order.recordId)} · ${html(priorities[order.priority]||'Ordinaria')}</small><strong>${html(order.title)}</strong><span>${html(taskNames[order.status])}${order.due?' · '+fmtDate(order.due):''}${late?' · Scaduto':''}</span>${order.assignee?`<small>${html(order.assignee)}</small>`:''}</div><button type="button" class="btn" data-mun-task="${html(order.id)}">Apri</button></article>`;
  }
  function bindTaskButtons(root){root.querySelectorAll('[data-mun-task]').forEach(b=>b.onclick=()=>openTask(Municipal.workOrders.find(o=>o.id===b.dataset.munTask)));}
  function renderTasks(){
    if(!$('munTasksList'))return;
    const visibleIds=new Set(categoryRecords().filter(r=>RegistryFilters.contextMatches(municipalContextId(r))).map(r=>r.id)),now=localDay();
    const rows=Municipal.workOrders.filter(o=>(visibleIds.has(o.recordId)||!municipalRecord(o.recordId)&&Municipal.categoryFilter==='all')&&(state.taskFilter==='all'||state.taskFilter==='done'?state.taskFilter==='all'||o.status==='done':state.taskFilter==='late'?o.status!=='done'&&o.due&&o.due<now:o.status!=='done')).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||a.title.localeCompare(b.title,'it'));
    $('munTasksList').innerHTML=rows.map(taskCard).join('')||'<p class="munEmpty">Nessun intervento in questa vista.</p>';bindTaskButtons($('munTasksList'));
    $('munTasksCount').textContent=`${rows.length} interventi`;
  }
  function openTaskForm(ids){
    ids=[...new Set(ids)].filter(id=>municipalRecord(id));if(!ids.length){showPicker('task');return;}
    show(ids.length===1?'Nuovo intervento':`Crea interventi · ${ids.length} elementi`,`<section class="munReference"><strong>${ids.length===1?html(municipalRecord(ids[0]).code)+' · '+html(municipalName(municipalRecord(ids[0]))):`${ids.length} schede selezionate`}</strong><details><summary>Controlla destinatari</summary><p>${ids.map(id=>html(municipalRecord(id).code)).join(' · ')}</p></details></section><form id="munTaskForm"><div class="munFormGrid">${label('munTaskTitle','Intervento da eseguire',input('munTaskTitle','','required maxlength="200" placeholder="Es. Riparazione seduta"'),true)}${label('munTaskPriority','Priorità',select('munTaskPriority',priorities,'normal'))}${label('munTaskDue','Scadenza',input('munTaskDue','','type="date"'))}${label('munTaskAssignee','Assegnato a',input('munTaskAssignee','','maxlength="160"'))}${label('munTaskDescription','Descrizione',`<textarea id="munTaskDescription" rows="3" maxlength="12000"></textarea>`,true)}${ids.length===1?label('munTaskBefore','Foto prima dell’intervento',input('munTaskBefore','','type="file" accept="image/*" multiple'),true):''}</div><div class="munDialogFoot"><button class="btn main" id="munTaskSave" type="submit">${ids.length===1?'Crea intervento':'Conferma e crea '+ids.length+' interventi'}</button></div></form>`);
    $('munTaskForm').onsubmit=e=>{e.preventDefault();action($('munTaskSave'),async()=>{
      const title=$('munTaskTitle').value.trim();if(!title)throw Error('Descrivi l’intervento.');const due=$('munTaskDue').value||null,priority=$('munTaskPriority').value,assignee=$('munTaskAssignee').value.trim(),description=$('munTaskDescription').value.trim(),files=[...($('munTaskBefore')?.files||[])];
      await municipalTransaction(async({workOrders})=>{for(const recordId of ids){const order={id:'WORK-'+uniqueID(),recordId,recordCode:municipalRecord(recordId).code,recordName:municipalName(municipalRecord(recordId)),title,due,priority,assignee,description,status:due?'planned':'open',created:new Date().toISOString(),updates:[]};await municipalUpload(files,recordId,'before',order.id);workOrders.push(order);municipalEvent(recordId,'intervento_pianificato',title,order);}});
      const targetCategories=[...new Set(ids.map(id=>Municipal.category(municipalRecord(id))))];
      setMunicipalSectionCategory('censimento',targetCategories.length===1&&Object.hasOwn(categories,targetCategories[0])?targetCategories[0]:'all');
      state.taskFilter='active';document.querySelectorAll('[data-task-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.taskFilter==='active')));
      close();tell(`${ids.length} ${ids.length===1?'intervento creato':'interventi creati'}`);switchSection('censimento');$('munTasks').scrollIntoView({block:'start'});
    });};
  }
  function openTask(order){
    if(!order)return;
    show(order.title,`<p class="munIdentity">${html(municipalRecord(order.recordId)?.code||order.recordCode||order.recordId)} · ${html(municipalRecord(order.recordId)?municipalName(municipalRecord(order.recordId)):order.recordName||'Scheda rimossa')}</p><p class="munNotes">${html(order.description||'')}</p><form id="munTaskUpdate"><div class="munFormGrid">${label('munTaskStatus','Stato intervento',select('munTaskStatus',taskNames,order.status))}${label('munTaskUpdateDate','Data attività',input('munTaskUpdateDate',localDay(),'type="date" required'))}${label('munTaskUpdateDue','Scadenza',input('munTaskUpdateDue',order.due||'','type="date"'))}${label('munTaskUpdateAssignee','Assegnato a',input('munTaskUpdateAssignee',order.assignee||'','maxlength="160"'))}${label('munTaskOutcome','Esito / aggiornamento',`<textarea id="munTaskOutcome" rows="3" maxlength="12000" placeholder="Cosa è stato fatto e cosa resta da fare"></textarea>`,true)}${label('munTaskAfter','Foto dell’attività',input('munTaskAfter','','type="file" accept="image/*" multiple'),true)}</div><div class="munDialogFoot"><button class="btn main" type="submit" id="munTaskUpdateSave">Salva aggiornamento</button></div></form><h3>Storico dell’intervento</h3><div class="munHistory">${(order.updates||[]).slice().reverse().map(update=>`<article><strong>${fmtDate(update.date)} · ${html(taskNames[update.status])}</strong><p class="munNotes">${html(update.notes||'')}</p></article>`).join('')||'<p class="munHint">Nessun aggiornamento.</p>'}</div><h3>Fotografie prima / dopo</h3><div class="munPhotos" id="munTaskPhotos"></div>`);
    loadPhotos(order.recordId,$('munTaskPhotos'),order.id);
    $('munTaskUpdate').onsubmit=e=>{e.preventDefault();action($('munTaskUpdateSave'),async()=>{
      const status=$('munTaskStatus').value,date=$('munTaskUpdateDate').value,notes=$('munTaskOutcome').value.trim(),due=$('munTaskUpdateDue').value||null,assignee=$('munTaskUpdateAssignee').value.trim(),files=[...$('munTaskAfter').files];
      if(status==='done'&&!notes)throw Error('Indica l’esito prima di completare l’intervento.');
      await municipalTransaction(async({workOrders})=>{const current=workOrders.find(o=>o.id===order.id);await municipalUpload(files,order.recordId,status==='done'?'after':'before',order.id,date);Object.assign(current,{status,due,assignee,modified:new Date().toISOString(),completed:status==='done'?date:null});current.updates||=[];current.updates.push({status,date,notes,created:new Date().toISOString()});municipalEvent(order.recordId,status==='done'?'intervento_completato':'intervento_aggiornato',`${order.title} · ${taskNames[status]}${notes?' · '+notes:''}`,current);historyEvents.at(-1).date=date;});
      close();tell('Intervento aggiornato.');openTask(Municipal.workOrders.find(o=>o.id===order.id));
    });};
  }
  function showPicker(mode='inspect'){
    const records=categoryRecords();show(mode==='task'?'Scegli l’elemento per l’intervento':'Seleziona l’elemento da rilevare',`<label class="munSearchLabel">Cerca codice, nome o via<input type="search" id="munPickerSearch" placeholder="Cerca nell’archivio…"/></label><div id="munPickerResults" class="munPicker"></div>`);
    const render=()=>{const tokens=normalize($('munPickerSearch').value).split(/\s+/).filter(Boolean),hits=records.filter(r=>tokens.every(t=>normalize([r.code,municipalName(r),r.address].join(' ')).includes(t)));$('munPickerResults').innerHTML=hits.slice(0,100).map(r=>`<button type="button" data-pick-record="${html(r.id)}"><span><strong>${html(r.code||r.id)} · ${html(municipalName(r))}</strong><small>${html(r.address||municipalAreaName(r.areaId))}</small></span>${statusBadge(r)}</button>`).join('')+(hits.length>100?'<p>Affina la ricerca per vedere gli altri risultati.</p>':'')||'<p>Nessun elemento trovato.</p>';dialog.querySelectorAll('[data-pick-record]').forEach(b=>b.onclick=()=>{const r=municipalRecord(b.dataset.pickRecord);if(mode==='task')openTaskForm([r.id]);else if(r.assetKind)openAssetInspection(r);else{close();setCategory('trees');switchSection('censimento');v2SelectCensus(r.id);}});};
    $('munPickerSearch').oninput=render;render();$('munPickerSearch').focus();
  }
  function setupCompactRegistry(){
    const registry=document.querySelector('.v21Registry'),header=registry.querySelector('.sectionHead'),search=registry.querySelector('.registrySearchRow');
    header.querySelector('h2').remove();header.firstElementChild.className='registrySrOnly';
    search.querySelector('.registryFieldLabel').classList.add('registrySrOnly');header.prepend(search);
    const actions=document.createElement('div');actions.className='registryToolbarActions';
    if($('mHomeActions'))actions.appendChild($('mHomeActions'));
    $('downloadTable').textContent='↓ Esporta';$('downloadTable').setAttribute('aria-label','Esporta risultati CSV');actions.appendChild($('downloadTable'));header.appendChild(actions);
    const filters=document.createElement('details');filters.id='mobileRegistryFilters';filters.className='munMobileFilters registryFilterDisclosure';filters.innerHTML='<summary>Filtri</summary><div class="registryFilterContent"></div>';
    filters.querySelector('div').append(registry.querySelector('.registryFilters'),registry.querySelector('.registryMobileSort'));
    registry.querySelector('.registryOrderRow').prepend(filters);$('registryOrder').className='registrySrOnly';
    const common=$('munRegistry'),commonHeader=common.querySelector('.sectionHead'),commonFilters=common.querySelector('.munFilters'),commonSearch=commonFilters.querySelector('.munSearchLabel');
    commonHeader.querySelector('h2').remove();commonHeader.firstElementChild.className='registrySrOnly';commonSearch.querySelector('span').classList.add('registrySrOnly');commonHeader.prepend(commonSearch);
    const commonActions=commonHeader.querySelector('.munActions');commonActions.classList.add('registryToolbarActions');commonActions.prepend($('munNew'));$('munExport').textContent='↓ Esporta';$('munExport').setAttribute('aria-label','Esporta risultati CSV');
    const commonDisclosure=document.createElement('details');commonDisclosure.id='munRegistryFilters';commonDisclosure.className='munMobileFilters registryFilterDisclosure';commonDisclosure.innerHTML='<summary>Filtri</summary><div class="registryFilterContent"></div>';
    const tools=common.querySelector('.munTableTools'),sort=document.createElement('div');sort.className='registrySortOptions';sort.append($('munCommonSort').closest('label'),$('munCommonDirection'));
    commonDisclosure.querySelector('div').append(commonFilters,sort,$('munRegistryBreakdown'));tools.prepend(commonDisclosure);
    $('driveRegistrySync').classList.add('registrySrOnly');
  }
  function setupInspections(){
    $('viewCensimento').insertAdjacentHTML('afterbegin',`<section class="workCard" id="munInspectionStart"><div class="sectionHead"><div><h2>Nuova rilevazione</h2><p>Seleziona una scheda per consultare i rilievi precedenti e registrare la visita.</p></div><button class="btn main" id="munInspectionPick">Seleziona elemento</button></div></section>`);
    $('viewCensimento').insertAdjacentHTML('beforeend',`<section class="workCard" id="munTasks"><div class="sectionHead"><div><h2>Interventi e manutenzione</h2><p id="munTasksCount"></p></div><button class="btn main" id="munTaskNew">＋ Intervento</button></div><div class="munTaskTabs" role="group" aria-label="Filtra interventi">${[['active','Aperti'],['late','Scaduti'],['done','Completati'],['all','Tutti']].map(([key,name])=>`<button type="button" data-task-filter="${key}" aria-pressed="${key==='active'}">${name}</button>`).join('')}</div><div id="munTasksList"></div></section>`);
    $('munInspectionPick').onclick=()=>showPicker();$('munTaskNew').onclick=()=>showPicker('task');
    document.querySelectorAll('[data-task-filter]').forEach(b=>b.onclick=()=>{state.taskFilter=b.dataset.taskFilter;document.querySelectorAll('[data-task-filter]').forEach(btn=>btn.setAttribute('aria-pressed',btn===b));renderTasks();});
    document.addEventListener('click',e=>{if(Municipal.categoryFilter==='trees')return;if(e.target.closest('#mQuickSurvey,#v21ChangeTree,#v3OpenPicker,#v2CensusQuery')){e.preventDefault();e.stopImmediatePropagation();showPicker();}},true);
  }
  function setupMap(){
    const stage=$('map').closest('.stage');
    const toolbar=document.createElement('div');toolbar.id='mapWorkspaceToolbar';toolbar.className='mapWorkspaceToolbar';toolbar.setAttribute('aria-label','Strumenti della mappa');
    toolbar.innerHTML='<span class="mapToolbarTitle">Mappa</span><span id="munLayerSummary" role="status"></span><div class="munActions"><button type="button" class="btn" id="munLayersButton" aria-haspopup="dialog" aria-expanded="false" aria-controls="munLayers">▱ Livelli</button><button class="btn main" type="button" id="munMapNew">＋ Nuovo elemento</button></div>';
    document.querySelector('.mainNav').insertAdjacentElement('afterend',toolbar);
    const layers=document.createElement('dialog');layers.id='munLayers';layers.className='munLayers';layers.hidden=true;layers.setAttribute('aria-labelledby','munLayersTitle');
    const layerRow=(key,name)=>`<label class="munLayerChoice"><input type="checkbox" data-layer="${key}" checked/><span>${name}</span><small data-layer-count="${key}"></small></label>`;
    layers.innerHTML=`<header><h2 id="munLayersTitle">Livelli della mappa</h2><button type="button" id="munLayersClose" aria-label="Chiudi livelli">×</button></header><div class="munLayersBody"><div class="munLayerBulk"><label><input type="checkbox" id="munLayersAll" checked/> Seleziona tutto</label><button type="button" class="btn" id="munLayersTreesOnly">Solo alberi</button></div><p class="munLayerCountLabel">Posizionati sulla mappa / censiti</p><div class="munLayerChoices"><fieldset><legend>Patrimonio arboreo</legend>${layerRow('trees','Alberi, gruppi e fasce boschive')}</fieldset><fieldset><legend>Arredo urbano</legend>${layerRow('bench','Panchine')+layerRow('bin','Cestini')}</fieldset><fieldset><legend>Aree giochi</legend>${layerRow('playground_area','Aree giochi')+layerRow('equipment','Giochi')}</fieldset></div><details id="munHealthFilters"><summary>Condizione degli alberi</summary><div id="munHealthSlot"></div></details></div>`;
    document.body.appendChild(layers);
    stage.insertAdjacentHTML('beforeend','<div id="munPointTools" hidden><strong>Scegli il punto esatto sulla mappa</strong><button type="button" class="btn" id="munPointCancel">Annulla</button></div>');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='municipalAreas';$('map').appendChild(svg);
    const pins=document.createElement('div');pins.id='municipalPins';$('map').appendChild(pins);
    const accuracy=document.createElement('div');accuracy.id='munAccuracyCircle';accuracy.hidden=true;$('map').appendChild(accuracy);
    const toggle=open=>{
      $('munLayersButton').setAttribute('aria-expanded',String(open));
      if(open){layers.hidden=false;if(!layers.open)layers.showModal();}
      else{if(layers.open)layers.close();layers.hidden=true;}
    };
    window.closeMapLayers=()=>toggle(false);
    layers.addEventListener('cancel',event=>{event.preventDefault();toggle(false);});
    layers.addEventListener('close',()=>{$('munLayersButton').setAttribute('aria-expanded','false');layers.hidden=true;});
    const applyLayers=predicate=>{for(const input of layers.querySelectorAll('[data-layer]'))Municipal.layers[input.dataset.layer]=predicate(input.dataset.layer);if(!Municipal.layers.trees)hideTreeCard();drawPins();};
    $('munLayersAll').onchange=event=>applyLayers(()=>event.target.checked);
    $('munLayersTreesOnly').onclick=()=>applyLayers(key=>key==='trees');
    $('munLayersButton').onclick=()=>toggle($('munLayers').hidden);$('munLayersClose').onclick=()=>toggle(false);
    const health=$('mapStatusFilters');$('munHealthSlot').appendChild(health);health.querySelector('details').open=true;
    $('munPointCancel').onclick=()=>mapPickCancel?.();$('munMapNew').onclick=()=>{const current=Municipal.categoryFilter;if(current==='trees')Municipal.categoryFilter='all';showMunicipalChoice();Municipal.categoryFilter=current;};
    $('munLayers').onchange=e=>{if(e.target.dataset.layer){Municipal.layers[e.target.dataset.layer]=e.target.checked;if(!Municipal.layers.trees)hideTreeCard();drawPins();}};
    const openShape=e=>{const node=e.target.closest('[data-asset-map]');if(!node||addMode||isGroupAreaDrawing()||e.type==='click'&&moved)return;e.stopPropagation();openMunicipalDetail(municipalRecord(node.dataset.assetMap));};
    svg.addEventListener('click',openShape);svg.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();openShape(e);}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(mapPickCancel){e.preventDefault();mapPickCancel();}toggle(false);}});
  }
  window.drawMunicipalMap=function(){
    if(!$('municipalPins'))return;
    const map=$('map'),w=map.clientWidth,h=map.clientHeight,pins=$('municipalPins'),svg=$('municipalAreas'),fragment=document.createDocumentFragment(),areas=[];
    pins.replaceChildren();svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('width',w);svg.setAttribute('height',h);
    for(const r of Municipal.assets){
      if(!Municipal.layers[r.assetKind]||!isValid(r))continue;
      const center=mapFromLL(+r.lat,+r.lon),color=conditionColors[r.condition]||'#587c6c';
      if(r.geometry){const points=r.geometry.coordinates[0].map(([lon,lat])=>mapFromLL(lat,lon));areas.push(`<polygon points="${points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="${color}" fill-opacity=".13" stroke="${color}" stroke-width="2" stroke-dasharray="0" data-asset-map="${html(r.id)}" role="button" tabindex="0" aria-label="${html(r.code+' · '+r.name)}"/>`);}
      if(center.x<0||center.x>w||center.y<0||center.y>h)continue;
      const button=document.createElement('button');button.type='button';button.className='munMapPin';button.style.cssText=`left:${center.x}px;top:${center.y}px;--marker:${color}`;button.innerHTML=`<span aria-hidden="true">${icons[r.assetKind]}</span>`;button.title=`${r.code} · ${r.name} · ${municipalStatus(r)}`;button.setAttribute('aria-label',button.title);button.disabled=addMode||isGroupAreaDrawing();
      for(const event of ['pointerdown','pointerup'])button.addEventListener(event,e=>e.stopPropagation());button.onclick=e=>{e.stopPropagation();openMunicipalDetail(r);};fragment.appendChild(button);
    }
    pins.appendChild(fragment);svg.innerHTML=areas.join('');
    for(const [key,name] of [['trees','Alberi'],...Object.entries(Municipal.kinds).filter(([key])=>key!=='park')]){const records=key==='trees'?trees:Municipal.assets.filter(a=>a.assetKind===key),count=$('munLayers').querySelector(`[data-layer-count="${key}"]`);if(count)count.textContent=`${records.filter(isValid).length} / ${records.length}`;const check=$('munLayers').querySelector(`[data-layer="${key}"]`);if(check)check.checked=Municipal.layers[key];}
    const layerKeys=['trees','bench','bin','playground_area','equipment'],selected=layerKeys.filter(key=>Municipal.layers[key]).length;
    $('munLayersAll').checked=selected===layerKeys.length;$('munLayersAll').indeterminate=selected>0&&selected<layerKeys.length;
    $('munLayerSummary').textContent=selected?`${selected} di ${layerKeys.length} livelli visibili`:'Nessun livello selezionato';
    const circle=$('munAccuracyCircle');if(typeof mGpsPoint!=='undefined'&&mGpsPoint&&isValid(mGpsPoint)&&mGpsPoint.accuracy>0){const point=mapFromLL(mGpsPoint.lat,mGpsPoint.lon),metersPerPixel=156543.03392*Math.cos(mGpsPoint.lat*Math.PI/180)/2**mp.z,radius=Math.min(2500,mGpsPoint.accuracy/metersPerPixel);circle.hidden=false;circle.style.cssText=`left:${point.x}px;top:${point.y}px;width:${radius*2}px;height:${radius*2}px`;}else circle.hidden=true;
  };
  window.acquireMunicipalGPS=function(){
    return new Promise(resolve=>{
      const gps=$('munGpsDialog');let watch=null,timer=null,best=null,remaining=20,settled=false,stopped=false;
      gps.innerHTML=`<header class="munDialogHead"><div><small>POSIZIONE SUL CAMPO</small><h2>Rileva la posizione</h2></div><button class="munClose" id="munGpsClose" aria-label="Chiudi GPS">×</button></header><div class="munDialogBody"><p>Resta vicino all’elemento, con una buona visuale del cielo.</p><output id="munGpsAccuracy">In attesa del GPS…</output><p id="munGpsMessage" role="status">Cerco la posizione migliore per 20 secondi.</p><p class="munHint">La precisione dipende dal dispositivo e dalle condizioni sul posto. Se il punto non coincide, correggilo sulla mappa.</p></div><footer class="munDialogFoot"><button class="btn" id="munGpsCancel">Annulla</button><button class="btn main" id="munGpsUse" disabled>Usa posizione</button></footer>`;
      gps.showModal();
      const stop=()=>{stopped=true;if(watch!==null)navigator.geolocation?.clearWatch(watch);clearInterval(timer);};
      const finish=point=>{if(settled)return;settled=true;stop();gps.close();resolve(point);};
      $('munGpsClose').onclick=$('munGpsCancel').onclick=()=>finish(null);gps.oncancel=e=>{e.preventDefault();finish(null);};
      $('munGpsUse').onclick=()=>finish(best?{lat:best.lat,lon:best.lon,positionMeta:{source:'gps',accuracy:best.accuracy,at:best.at}}:null);
      if(typeof mGpsPoint!=='undefined')mGpsPoint=null;if($('mMapNewHere'))$('mMapNewHere').disabled=true;drawMunicipalMap();
      const fail=message=>{stop();$('munGpsMessage').textContent=message;if(!best){$('munGpsAccuracy').textContent='Nessuna posizione acquisita';$('munGpsUse').disabled=true;}};
      if(!navigator.geolocation||!window.isSecureContext){fail('GPS non disponibile. Puoi indicare il punto sulla mappa.');return;}
      timer=setInterval(()=>{remaining--;if(remaining<=0){stop();$('munGpsMessage').textContent=best?'Acquisizione terminata. Controlla l’accuratezza prima di usare il punto.':'Nessuna posizione disponibile. Riprova all’aperto o usa la mappa.';}else $('munGpsMessage').textContent=`Acquisizione in corso · ${remaining} secondi`},1000);
      watch=navigator.geolocation.watchPosition(pos=>{
        if(stopped||settled)return;const {latitude:lat,longitude:lon,accuracy}=pos.coords;
        if(!isValid({lat,lon})||!Number.isFinite(accuracy)||accuracy<=0||!Number.isFinite(pos.timestamp)||Date.now()-pos.timestamp>30000||pos.timestamp>Date.now()+5000)return;
        if(!best||accuracy<best.accuracy){best={lat,lon,accuracy,at:new Date(pos.timestamp).toISOString()};$('munGpsAccuracy').textContent=`± ${Math.round(accuracy)} m`;$('munGpsAccuracy').className=accuracy<=10?'good':accuracy<=25?'fair':'poor';$('munGpsUse').disabled=false;}
      },ex=>fail(mLocationError(ex)),{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    });
  };
  function setupTreeExtensions(){
    const parent=document.createElement('section');parent.className='munTreeExtra';parent.innerHTML=`<p class="munHint" id="munTreePositionInfo"></p><button type="button" class="btn" id="munTreeGPS">⌖ Rileva GPS</button>`;$('v2AnagForm').querySelector('.v2FormGrid').insertAdjacentElement('afterend',parent);
    window.loadMunicipalTreeFields=function(record,fromMap){
      const previous=fromMap?$('v2AnaSite').value:municipalContextKey(record);$('v2AnaSite').innerHTML=municipalContextOptions(previous);$('v2AnaSite').value=previous||'';if(!fromMap)treePositionMeta=structuredClone(record?.positionMeta||null);
      $('munTreePositionInfo').textContent=treePositionMeta?.source==='gps'?`GPS ±${Math.round(treePositionMeta.accuracy)} m · ${fmtDate(treePositionMeta.at)}`:treePositionMeta?.source==='manual'?'Posizione indicata sulla mappa':'';
    };
    window.readMunicipalTreeFields=prior=>({positionMeta:isValid({lat:Number($('v2AnaLat').value),lon:Number($('v2AnaLon').value)})&&$('v2AnaLat').value!==''?treePositionMeta||((prior?.lat!==Number($('v2AnaLat').value)||prior?.lon!==Number($('v2AnaLon').value))?{source:'manual',accuracy:null,at:new Date().toISOString()}:prior?.positionMeta||null):null});
    for(const id of ['v2AnaLat','v2AnaLon'])$(id).addEventListener('input',()=>{treePositionMeta={source:'manual',accuracy:null,at:new Date().toISOString()};});
    $('munTreeGPS').hidden=!!$('mAnaGPS');$('munTreeGPS').onclick=()=>mAcquireGPS('anag');if($('mAnaGPS'))$('mAnaGPS').textContent='⌖ Rileva GPS';
    const priorOpen=v2OpenAnag;v2OpenAnag=async function(record,lat,lon){const result=await priorOpen(record,lat,lon);if(result!==false&&lat!==undefined&&lon!==undefined){treePositionMeta=typeof mGpsPoint!=='undefined'&&mGpsPoint&&Math.abs(Number(lat)-mGpsPoint.lat)<1e-7&&Math.abs(Number(lon)-mGpsPoint.lon)<1e-7&&Date.now()-Date.parse(mGpsPoint.at)<60000?{source:'gps',accuracy:mGpsPoint.accuracy,at:mGpsPoint.at}:{source:'manual',accuracy:null,at:new Date().toISOString()};}return result;};
    const priorDetail=v2Detail;v2Detail=function(record){priorDetail(record);appendTreeActions(record);};
    mAcquireGPS=async function(destination='map'){
      const point=await acquireMunicipalGPS();if(!point)return;
      mGpsPoint={lat:point.lat,lon:point.lon,accuracy:point.positionMeta.accuracy,at:point.positionMeta.at};mp.lat=point.lat;mp.lon=point.lon;mp.z=Math.max(mp.z,18);placePin={lat:point.lat,lon:point.lon};resetTiles();draw();
      if(destination==='anag'){$('v2AnaLat').value=point.lat.toFixed(7);$('v2AnaLon').value=point.lon.toFixed(7);treePositionMeta=point.positionMeta;const info=`GPS ±${Math.round(point.positionMeta.accuracy)} m · verifica il punto sulla mappa`;if($('mAnaGpsInfo'))$('mAnaGpsInfo').textContent=info;$('munTreePositionInfo').textContent=info;}else{if($('mGeoInfo'))$('mGeoInfo').textContent=`GPS ±${Math.round(point.positionMeta.accuracy)} m`;if($('mMapNewHere'))$('mMapNewHere').disabled=false;}
    };

  }
  function appendTreeActions(record){
    const box=document.createElement('section');box.className='munTreeActions';box.innerHTML=`${municipalContextLabel(record)?`<p><strong>Contesto:</strong> ${html(municipalContextLabel(record))}</p>`:''}<div class="munActions"><button class="btn" id="munTreeQR">Etichetta QR</button><button class="btn" id="munTreeTask">Crea intervento</button><button class="btn" id="munTreeHistory">Rilevazioni precedenti</button><button class="btn" id="munTreeSimilar">Inserisci simile</button></div><h3>Interventi</h3>${Municipal.workOrders.filter(o=>o.recordId===record.id).map(taskCard).join('')||'<p class="munHint">Nessun intervento registrato.</p>'}`;$('v2DetailContent').appendChild(box);
    $('munTreeHistory').onclick=()=>{v2CloseDetail();showTreeReferences(record);};
    $('munTreeQR').onclick=()=>{v2CloseDetail();showQR([record]);};$('munTreeTask').onclick=()=>{v2CloseDetail();openTaskForm([record.id]);};
    $('munTreeSimilar').onclick=async()=>{v2CloseDetail();if(await v2OpenAnag(null)===false)return;for(const [id,key] of Object.entries({v2AnaSpecies:'species',v2AnaScientific:'scientificName',v2AnaAddress:'address',v2AnaSite:'siteType',v2AnaPlacement:'placement'}))$(id).value=record[key]||'';$('v2AnaSite').value=municipalContextId(record);};bindTaskButtons(box);
  }
  function showTreeReferences(record){
    const events=inspections(record.id);
    show(`Rilevazioni precedenti · ${record.code||record.id}`,`<p>Consulta le osservazioni e le misure conservate. Puoi riportare i valori di una visita nella nuova rilevazione e verificarli sul posto.</p><div class="munHistory">${events.map(event=>{const snap=event.snapshot||{};return `<article><strong>${fmtDate(event.date)}</strong><p class="munNotes">${html(event.description||snap.surveyNotes||snap.notes||'Nessuna osservazione.')}</p><p>Stato: ${html(statusName[snap.status]||'—')} · Altezza: ${html(snap.height??'—')} m · Diametro: ${html(formatTreeDiameter(snap.diameter,{...record,...snap}))} cm · Chioma: ${html(snap.crownDiameter??'—')} m</p>${event.snapshot?`<button class="tinyBtn" type="button" data-tree-reference="${html(event.id)}">Avvia rilievo con questi valori</button>`:''}</article>`;}).join('')||'<p>Nessuna rilevazione precedente.</p>'}</div>`);
    dialog.querySelectorAll('[data-tree-reference]').forEach(button=>button.onclick=()=>{
      if(v21UnsavedSurvey()&&!confirm('Iniziare una nuova rilevazione con i valori scelti? La bozza attuale sarà scartata.'))return;
      const event=events.find(e=>e.id===button.dataset.treeReference),snapshot=event.snapshot;
      close();setCategory('trees');switchSection('censimento');v2SelectCensus(record.id);
      for(const [id,key] of Object.entries({v2CensusHeight:'height',v2CensusDiameter:'diameter',v2CensusCrown:'crownDiameter',v2CensusNext:'nextCheck',v2CensusPriority:'priority'}))$(id).value=key==='diameter'&&snapshot[key]!=null&&isEquivalentDiameter({...record,...snapshot})?formatTreeDiameter(snapshot[key],{...record,...snapshot}):snapshot[key]??'';
      if(['ok','watch','sick','critical','unknown'].includes(snapshot.status))$('v2CensusState').value=snapshot.status;
      if(record.recordType==='multistem'&&snapshot.stemDiameters?.length)loadSurveyStems({...record,...snapshot});
      window.municipalSurveyReference=event.id;$('v2CensusFeedback').textContent=`Valori ripresi dal ${fmtDate(event.date)}. Verifica le misure prima di salvare. Le osservazioni precedenti restano nello storico.`;
    });
  }
  function recordURL(record){const url=new URL(location.origin+location.pathname);url.searchParams.set('record',record.id);return url.href;}
  function qrSVG(record){const qr=qrcode(0,'M');qr.addData(recordURL(record));qr.make();return qr.createSvgTag({cellSize:5,margin:20,scalable:true,alt:`QR ${record.code||record.id}`});}
  function showQR(records){
    records=records.filter(Boolean);show(`Etichette QR · ${records.length}`,`<p>Inquadra il QR con la fotocamera del telefono per aprire la scheda dopo l’accesso all’app.</p><div class="munLabels" id="munLabels">${records.map(r=>`<article><div class="munQR">${qrSVG(r)}</div><strong>${html(r.code||r.id)}</strong><span>${html(municipalName(r))}</span><small>Comune di Lesmo</small></article>`).join('')}</div>`,`<button class="btn main" id="munPrintQR">Stampa etichette</button>${records.length===1?'<button class="btn" id="munDownloadQR">Scarica SVG</button>':''}`);
    if($('munDownloadQR'))$('munDownloadQR').onclick=()=>fileDownload(`${records[0].code||records[0].id}_QR.svg`,qrSVG(records[0]),'image/svg+xml');
    $('munPrintQR').onclick=()=>{
      const frame=document.createElement('iframe');frame.title='Stampa etichette QR';frame.style.cssText='position:fixed;width:0;height:0;border:0';document.body.appendChild(frame);const doc=frame.contentDocument;doc.open();doc.write(`<!doctype html><html lang="it"><head><title>Etichette patrimonio · Lesmo</title><style>body{font:14px sans-serif}.munLabels{display:flex;flex-wrap:wrap;gap:12mm}.munLabels article{width:50mm;page-break-inside:avoid;text-align:center;border:1px solid #ccc;padding:5mm;display:flex;flex-direction:column;gap:2mm}.munQR svg{width:45mm;height:45mm}small{font-size:10px}</style></head><body>${$('munLabels').outerHTML}</body></html>`);doc.close();frame.contentWindow.focus();frame.contentWindow.print();setTimeout(()=>frame.remove(),1000);
    };
  }
  function renderStats(){
    const root=$('munStatistics');if(!root)return;
    const records=categoryRecords().filter(r=>RegistryFilters.contextMatches(municipalContextId(r))),total=records.length,needs=records.filter(r=>r.assetKind?['fair','poor','closed'].includes(r.condition):['watch','sick','critical'].includes(r.status)).length,located=records.filter(isValid).length,ids=new Set(records.map(r=>r.id)),orders=Municipal.workOrders.filter(o=>ids.has(o.recordId)),open=orders.filter(o=>o.status!=='done'),now=localDay(),late=open.filter(o=>o.due&&o.due<now).length;
    const colors=['#347b55','#92a94d','#d8ad46','#6c94a8','#a884b2','#b97155'];
    const types=[['trees','Alberi'],...Object.entries(Municipal.kinds).filter(([key])=>key!=='park')].map(([key,name],i)=>({key,name,color:colors[i%colors.length],value:records.filter(r=>key==='trees'?!r.assetKind:r.assetKind===key).length})).filter(x=>x.value);
    let offset=0;const arcs=types.map(item=>{const start=offset;offset+=item.value/(total||1)*100;return `${item.color} ${start}% ${offset}%`;});
    const conditions=new Map();for(const r of records){const label=municipalStatus(r);conditions.set(label,(conditions.get(label)||0)+1);}
    const rows=[...conditions].sort((a,b)=>b[1]-a[1]),max=Math.max(1,...rows.map(r=>r[1]));
    root.innerHTML=`<div class="munMetricGrid">${[['Schede registrate',total,`${types.length} tipi presenti`],['Da controllare / riparare',needs,`${total?Math.round(needs/total*100):0}% del totale`],['Posizionate sulla mappa',located,`${total-located} senza coordinate`],['Interventi aperti',open.length,`${late} oltre scadenza`]].map(([k,v,n])=>`<article><small>${k}</small><strong>${v.toLocaleString('it-IT')}</strong><span>${n}</span></article>`).join('')}</div><div class="munCharts"><section class="workCard"><h2>Composizione del patrimonio</h2>${total?`<div class="munDonutLayout"><div class="munDonut" role="img" aria-label="Distribuzione delle ${total} schede per tipo" style="background:conic-gradient(${arcs.join(',')})"><span><strong>${total}</strong>schede</span></div><ul class="munLegend">${types.map(t=>`<li><i style="background:${t.color}"></i><span>${t.name}</span><strong>${t.value} <small>${Math.round(t.value/total*100)}%</small></strong></li>`).join('')}</ul></div>`:'<p class="munEmpty">I grafici compariranno con i primi elementi registrati.</p>'}</section><section class="workCard"><h2>Condizioni rilevate</h2><div class="munBars">${rows.map(([name,value])=>`<div><header><span>${html(name)}</span><strong>${value}</strong></header><div class="munBarRail"><i style="width:${value/max*100}%"></i></div></div>`).join('')||'<p>Nessun dato disponibile.</p>'}</div></section><section class="workCard"><h2>Manutenzione</h2><div class="munBars">${Object.entries(taskNames).map(([key,name])=>{const n=orders.filter(o=>o.status===key).length;return `<div><header><span>${name}</span><strong>${n}</strong></header><div class="munBarRail"><i style="width:${orders.length?n/orders.length*100:0}%"></i></div></div>`;}).join('')}</div></section><section class="workCard"><h2>Rilevazioni negli ultimi 12 mesi</h2>${monthlyChart(ids)}</section></div>`;
  }
  function monthlyChart(ids){
    const date=new Date(),months=Array.from({length:12},(_,i)=>{const d=new Date(date.getFullYear(),date.getMonth()-11+i,1);return {key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,label:d.toLocaleDateString('it-IT',{month:'short',year:'2-digit'}),value:0};});
    for(const e of historyEvents)if(ids.has(e.treeId)&&['asset_rilievo','censimento','rilievo'].includes(e.type)){const m=months.find(m=>m.key===e.date?.slice(0,7));if(m)m.value++;}const max=Math.max(1,...months.map(m=>m.value));
    return `<div class="munMonthly" role="img" aria-label="${html(months.map(m=>`${m.label}: ${m.value} rilievi`).join('; '))}">${months.map(m=>`<div title="${html(m.label)}: ${m.value} rilievi"><strong>${m.value}</strong><i style="height:${Math.max(2,m.value/max*120)}px"></i><span>${m.label}</span></div>`).join('')}</div>`;
  }
  window.renderMunicipalUI=function(){
    if(!$('municipalCategories'))return;
    const category=Municipal.categoryFilter,other=category!=='trees';
    document.body.classList.toggle('municipalOther',other);
    const section=currentSection||'anagrafica';
    $('municipalCategories').hidden=!['anagrafica','riepilogo','censimento','statistiche'].includes(section);
    document.querySelectorAll('[data-mun-category]').forEach(button=>{const active=button.dataset.munCategory===category;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    for(const id of ['manualHeader','mAddNewTree'])if($(id))$(id).textContent=other&&['anagrafica','censimento'].includes(section)?'＋ Nuovo elemento':'＋ Nuovo albero';
    const refresh=$('driveRefreshRegistry'),actions=document.querySelector(other?'#munRegistry .registryToolbarActions':'.v21Registry .registryToolbarActions');
    if(refresh&&actions&&refresh.parentElement!==actions)actions.insertBefore(refresh,$(other?'munExport':'downloadTable'));
    renderCommon();renderTasks();if(other)renderStats();drawMunicipalMap();
    const target=new URL(location.href).searchParams.get('record');if(target&&!document.body.classList.contains('driveLoginRequired')&&folderHandle&&municipalRecord(target)&&dialog&&!dialog.open){const url=new URL(location.href);url.searchParams.delete('record');history.replaceState(null,'',url);setTimeout(()=>{const category=Municipal.category(municipalRecord(target));setMunicipalSectionCategory('anagrafica',Object.hasOwn(categories,category)?category:'all');switchSection('anagrafica');openRecord(target);},0);}
  };
  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{
    dialog=document.createElement('dialog');dialog.id='municipalDialog';dialog.className='munDialog';dialog.setAttribute('aria-labelledby','munTitle');dialog.addEventListener('cancel',e=>{e.preventDefault();close();});document.body.appendChild(dialog);
    const gps=document.createElement('dialog');gps.id='munGpsDialog';gps.className='munDialog munGps';gps.setAttribute('aria-label','Acquisizione GPS');document.body.appendChild(gps);
    document.querySelector('.workTop').insertAdjacentHTML('afterend',`<div id="municipalCategories"><div class="munCategories" role="group" aria-label="Categoria del patrimonio">${Object.entries(categories).map(([key,name])=>`<button type="button" data-mun-category="${key}" class="${key==='trees'?'active':''}" aria-pressed="${key==='trees'}">${name}</button>`).join('')}</div></div>`);
    document.querySelectorAll('[data-mun-category]').forEach(b=>b.onclick=()=>setCategory(b.dataset.munCategory));
    Object.assign(typeLabel,{asset_rilievo:'Rilevazione',asset_anagrafica:'Aggiornamento scheda',assegnazione_area:'Assegnazione contesto',intervento_pianificato:'Intervento pianificato',intervento_aggiornato:'Intervento aggiornato',intervento_completato:'Intervento completato'});
    setupRegistry();setupInspections();setupMap();setupTreeExtensions();
    setupCompactRegistry();
    const stats=document.createElement('section');stats.id='munStatistics';$('viewStatistiche').appendChild(stats);
    const selectCensus=v2SelectCensus;v2SelectCensus=function(...args){window.municipalSurveyReference=null;setMunicipalSectionCategory('censimento','trees');const result=selectCensus(...args);renderMunicipalUI();return result;};
    const drawHistory=v2DrawSurveyList;v2DrawSurveyList=function(...args){const result=drawHistory(...args);if(v2SelectedId&&$('v2CensusHistory')){const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Consulta e riutilizza i rilievi precedenti';button.onclick=()=>showTreeReferences(municipalRecord(v2SelectedId));$('v2CensusHistory').prepend(button);}return result;};
    const previousRender=renderDashboard;renderDashboard=function(...args){const result=previousRender(...args);renderMunicipalUI();return result;};
    const previousSwitch=switchSection;switchSection=function(...args){if(mapPickCancel&&args[0]!=='mappa')mapPickCancel();const result=previousSwitch(...args);renderMunicipalUI();return result;};
    const geoExport=expGeo;expGeo=function(){if(!Municipal.assets.length)return geoExport();const features=allMunicipalRecords().filter(r=>isValid(r)||r.geometry).map(r=>({type:'Feature',geometry:r.geometry||{type:'Point',coordinates:[+r.lon,+r.lat]},properties:{...r,geometry:undefined}}));fileDownload('patrimonio_lesmo.geojson',JSON.stringify({type:'FeatureCollection',features},null,2),'application/geo+json');};
    const guide=document.createElement('section');guide.className='guideArticle';guide.id='guida-patrimonio';guide.innerHTML='<h3>Arredi, aree giochi e manutenzione</h3><p>In Anagrafica scegli <strong>Arredo urbano</strong> o <strong>Aree giochi</strong>, poi <strong>Nuovo elemento</strong>. Il tipo scelto apre i campi pertinenti. Indica il luogo nel campo <strong>Via/Località/Parco</strong>. Per il <strong>Contesto</strong> scegli Nessun contesto, Stradale, Parco o area verde oppure Altro.</p><p>Sulla mappa apri <strong>Livelli</strong> e scegli cosa visualizzare. Per la posizione usa <strong>Rileva GPS</strong>, controlla l’accuratezza in metri e, se serve, <strong>Scegli sulla mappa</strong>.</p><p>Ogni scheda conserva le rilevazioni precedenti. Puoi usarne una come riferimento per una nuova visita. Un rilievo con data precedente resta nello storico senza cambiare lo stato attuale. Da <strong>Censimento e Monitoraggio → Interventi e manutenzione</strong> assegna un lavoro, indica una scadenza e aggiornalo fino al completamento, con esito e foto.</p><p>La vista <strong>Tutti</strong> permette selezioni multiple per assegnare un contesto, creare interventi e stampare etichette QR. <strong>Inserisci simile</strong> ripropone i campi descrittivi e il contesto; il nuovo elemento riceve un codice e una posizione propri.</p>';$('viewGuida').querySelector('.guideArticles').appendChild(guide);
    prepareMunicipalSection(currentSection);renderMunicipalUI();
  },0));
})();
