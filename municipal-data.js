/* Estensioni dell'archivio: i censimenti arborei conservano il formato esistente. */
(() => {
  'use strict';
  let assets=[], workOrders=[], extras={};
  const kinds={bench:'Panchina',bin:'Cestino',playground_area:'Area giochi',equipment:'Gioco',park:'Parco / area verde'};
  const conditions={unknown:'Da valutare',good:'Buono',fair:'Da controllare',poor:'Da riparare',closed:'Fuori servizio',removed:'Rimosso'};
  const category=record=>!record?.assetKind?'trees':['bench','bin'].includes(record.assetKind)?'furniture':record.assetKind==='park'?'areas':'playgrounds';
  const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id);
  const core=new Set(['trees','history','photos','schema','app','saved','nextId','images','assets','workOrders']);
  window.Municipal={kinds,conditions,category,get assets(){return assets;},get workOrders(){return workOrders;},categoryFilter:'trees',layers:{trees:true,bench:true,bin:true,playground_area:true,equipment:true,park:true}};
  window.municipalBusy=false;
  window.municipalValidate=function(data){
    if(!data||typeof data!=='object')throw Error('Archivio non valido.');
    if(data.assets!=null&&!Array.isArray(data.assets)||data.workOrders!=null&&!Array.isArray(data.workOrders))throw Error('Archivio non valido: arredi, aree o interventi non sono leggibili.');
    const ids=new Set(),codes=new Set();
    for(const record of [...(data.trees||[]),...(data.assets||[])]){
      if(!record||!safeId(record.id)||ids.has(record.id))throw Error('Archivio non valido: identificativi mancanti o duplicati.');ids.add(record.id);
      const code=publicCodeKey(String(record.code||record.id).trim());
      if(codes.has(code))throw Error('Archivio non valido: codice duplicato '+code);codes.add(code);
    }
    for(const asset of data.assets||[]){
      if(!Object.hasOwn(kinds,asset.assetKind)||typeof asset.name!=='string'||!asset.name.trim()||!Object.hasOwn(conditions,asset.condition))throw Error('Scheda arredo / area non valida: '+asset.id);
      if((asset.lat!=null||asset.lon!=null)&&(!Number.isFinite(asset.lat)||!Number.isFinite(asset.lon)||Math.abs(asset.lat)>85||Math.abs(asset.lon)>180))throw Error('Coordinate non valide: '+asset.id);
      if(asset.geometry&&(!window.validMunicipalPolygon||!validMunicipalPolygon(asset.geometry)))throw Error('Perimetro area non valido: '+asset.id);
    }
    const sites=new Set((data.assets||[]).filter(a=>['park','playground_area'].includes(a.assetKind)).map(a=>a.id));
    for(const record of [...(data.trees||[]),...(data.assets||[])])if(record.areaId&&(!sites.has(record.areaId)||record.areaId===record.id))throw Error('Area di appartenenza non valida: '+record.id);
    const parents=new Map((data.assets||[]).map(a=>[a.id,a.areaId]));
    for(const asset of data.assets||[]){const seen=new Set([asset.id]);let parent=asset.areaId;while(parent){if(seen.has(parent))throw Error('Le aree non possono contenersi a vicenda.');seen.add(parent);parent=parents.get(parent);}}
    const orderIds=new Set();
    for(const order of data.workOrders||[]){
      if(!order||!safeId(order.id)||orderIds.has(order.id)||!safeId(order.recordId)||!['open','planned','progress','done'].includes(order.status)||typeof order.title!=='string'||!order.title.trim())throw Error('Intervento non valido o senza scheda associata.');orderIds.add(order.id);
    }
  };
  window.loadMunicipalData=function(data){
    municipalValidate(data);assets=structuredClone(data.assets||[]);workOrders=structuredClone(data.workOrders||[]);
    extras=Object.fromEntries(Object.entries(data).filter(([key])=>!core.has(key)));
  };
  window.municipalSnapshot=()=>({...extras,assets:structuredClone(assets),workOrders:structuredClone(workOrders)});
  window.municipalDataFrom=function(data){municipalValidate(data);return {...Object.fromEntries(Object.entries(data).filter(([key])=>!core.has(key))),assets:data.assets||[],workOrders:data.workOrders||[]};};
  window.allMunicipalRecords=()=>[...trees,...assets];
  window.municipalRecord=id=>trees.find(t=>t.id===id)||assets.find(a=>a.id===id);
  window.municipalName=record=>record?.assetKind?record.name:record?.species||'Non identificata';
  window.municipalStatus=record=>record?.assetKind?conditions[record.condition]:(statusName[record?.status]||'Non valutato');
  window.municipalAreaName=id=>assets.find(a=>a.id===id)?.name||'';
  window.municipalNextCode=function(kind){
    const prefix={bench:'P',bin:'C',playground_area:'AG',equipment:'G',park:'V'}[kind],used=new Set(allMunicipalRecords().map(r=>String(r.code||r.id).toUpperCase()));let n=1;
    while(used.has(`LESMO-${prefix}${String(n).padStart(4,'0')}`))n++;return `LESMO-${prefix}${String(n).padStart(4,'0')}`;
  };
  window.municipalTransaction=async function(change){
    if(municipalBusy||quickBusy||v2AnagBusy||backupInProgress)throw Error('Attendi il salvataggio in corso.');
    if(!folderHandle)throw Error('Accedi all’archivio prima di salvare.');
    const before={...municipalSnapshot(),trees:structuredClone(trees),history:structuredClone(historyEvents),photos:structuredClone(photos)};
    window.municipalBusy=true;
    try{await change({assets,workOrders});municipalValidate({...dataSnapshot()});await saveArchive();}
    catch(error){trees=before.trees;historyEvents=before.history;photos=before.photos;loadMunicipalData(before);throw error;}
    finally{window.municipalBusy=false;refresh();window.renderMunicipalUI?.();}
  };
  window.municipalEvent=(recordId,type,description,snapshot)=>historyEvents.push({id:uniqueID(),treeId:recordId,type,date:localDay(),created:new Date().toISOString(),description,source:'Patrimonio comunale',snapshot:structuredClone(snapshot)});
  window.municipalUpload=async function(files,recordId,stage,orderId,date){
    for(const file of files){
      const blob=await preparePhoto(file),ext=(file.name.split('.').pop()||'jpg').toLowerCase(),name=uniqueID()+'.'+(['jpg','jpeg','png','webp','heic','heif','gif'].includes(ext)?ext:'jpg'),relativePath=`Foto/${recordId}/${name}`;
      await writePhotoPath(relativePath,blob);
      photos.push({id:uniqueID(),treeId:recordId,relativePath,date:date||localDay(),originalName:file.name,mime:file.type||'image/jpeg',created:new Date().toISOString(),stage:stage||'censimento',orderId:orderId||null});
    }
  };
})();
