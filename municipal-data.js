/* Estensioni dell'archivio: i censimenti arborei conservano il formato esistente. */
(() => {
  'use strict';
  let assets=[], workOrders=[], contexts=[], extras={};
  const kinds={bench:'Panchina',bin:'Cestino',playground_area:'Area giochi',equipment:'Gioco',park:'Parco / area verde'};
  const conditions={unknown:'Da valutare',good:'Buono',fair:'Da controllare',poor:'Da riparare',closed:'Fuori servizio',removed:'Rimosso'};
  const category=record=>!record?.assetKind?'trees':['bench','bin'].includes(record.assetKind)?'furniture':record.assetKind==='park'?'areas':'playgrounds';
  const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id);
  const core=new Set(['trees','history','photos','schema','app','saved','nextId','images','assets','workOrders','contexts']);
  window.Municipal={kinds,conditions,category,get assets(){return assets;},get workOrders(){return workOrders;},get contexts(){return contexts;},categoryFilter:'trees',layers:{trees:true,bench:true,bin:true,playground_area:true,equipment:true,park:true}};
  window.municipalBusy=false;
  // Le aree della versione precedente diventano contesti senza cambiare gli ID dei collegamenti.
  const contextKey=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('it');
  const legacyContext=record=>[record?.siteType,record?.context,record?.contesto].find(value=>typeof value==='string'&&value.trim())||'';
  const contextNames={strada:'Alberatura stradale',parco:'Parco o area verde',giardino:'Giardino',boschivo:'Area boschiva',altro:'Altro'};
  window.municipalContextsFrom=function(data){
    const result=structuredClone(data.contexts||[]);
    if(data.contexts==null){
      for(const area of (data.assets||[]).filter(a=>['park','playground_area'].includes(a.assetKind))){
        const name=result.some(c=>contextKey(c.name)===contextKey(area.name))?`${area.name} (${area.code||area.id})`:area.name;
        result.push({id:area.id,name,type:area.assetKind==='park'?'park':'playground',address:area.address||'',notes:area.notes||'',geometry:area.geometry||null,created:area.created||null,legacyAssetId:area.id});
      }
    }
    // Riconosce il campo Contesto già presente negli archivi, senza cambiare le schede o gli snapshot.
    for(const record of [...(data.trees||[]),...(data.assets||[])]){
      if(record.areaId&&result.some(c=>c.id===record.areaId))continue;
      const raw=legacyContext(record);if(!raw)continue;
      let match=result.find(c=>c.id===raw||contextKey(c.name)===contextKey(contextNames[raw]||raw)||(c.legacyValues||[]).some(v=>contextKey(v)===contextKey(raw)));
      if(!match){let hash=2166136261;for(const char of contextKey(raw)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}let id='CTX-legacy-'+(hash>>>0).toString(36);while(result.some(c=>c.id===id))id+='x';match={id,name:contextNames[raw]||raw,type:({strada:'street',parco:'park',giardino:'garden',boschivo:'park'})[raw]||(/^parco\b/i.test(raw)?'park':/^(via|viale|corso)\b/i.test(raw)?'street':'other'),address:'',notes:'',legacyValues:[]};result.push(match);}
      match.legacyValues||=[];if(raw!==match.id&&!match.legacyValues.includes(raw))match.legacyValues.push(raw);
    }
    return result;
  };
  window.municipalContextId=function(record){
    const raw=legacyContext(record);if(contexts.some(c=>c.id===raw))return raw;
    if(record?.areaId&&contexts.some(c=>c.id===record.areaId))return record.areaId;
    return contexts.find(c=>c.id===raw||contextKey(c.name)===contextKey(raw)||(c.legacyValues||[]).some(v=>contextKey(v)===contextKey(raw))||c.legacyAssetId===record?.id)?.id||'';
  };
  window.municipalParks=()=>contexts.filter(c=>c.type==='park'&&!(c.legacyValues||[]).some(v=>['parco','boschivo'].includes(String(v).trim().toLowerCase())));
  window.municipalParkId=record=>record?.parkId||'';
  window.municipalParkName=record=>contexts.find(c=>c.id===municipalParkId(record))?.name||'';
  window.municipalScopedRecords=()=>allMunicipalRecords().filter(r=>!window.RegistryFilters||RegistryFilters.contextMatches(municipalContextId(r))&&RegistryFilters.parkMatches(municipalParkId(r)));
  window.municipalScopedTrees=()=>trees.filter(r=>!window.RegistryFilters||RegistryFilters.contextMatches(municipalContextId(r))&&RegistryFilters.parkMatches(municipalParkId(r)));
  window.municipalValidate=function(data){
    if(!data||typeof data!=='object')throw Error('Archivio non valido.');
    if(data.contexts!=null&&!Array.isArray(data.contexts))throw Error('L’elenco dei contesti non è valido.');
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
    const sites=new Set(),contextNames=new Set();
    for(const context of municipalContextsFrom(data)){
      const name=String(context?.name||'').normalize('NFKC').trim().toLocaleLowerCase('it');
      if(!context||!safeId(context.id)||sites.has(context.id)||!name||contextNames.has(name))throw Error('Contesto non valido o nome duplicato.');
      if(!['park','street','square','garden','playground','other'].includes(context.type))throw Error('Tipo di contesto non valido.');
      sites.add(context.id);contextNames.add(name);
    }
    for(const record of [...(data.trees||[]),...(data.assets||[])])if(record.areaId&&!sites.has(record.areaId))throw Error('Area di appartenenza non valida: '+record.id);
    for(const record of [...(data.trees||[]),...(data.assets||[])])if(record.parkId&&!municipalContextsFrom(data).some(c=>c.id===record.parkId&&c.type==='park'))throw Error('Parco associato non valido: '+record.id);
    const parents=new Map((data.assets||[]).map(a=>[a.id,a.areaId]));
    for(const asset of data.assets||[]){const seen=new Set([asset.id]);let parent=asset.areaId;while(parent){if(seen.has(parent))throw Error('Le aree non possono contenersi a vicenda.');seen.add(parent);parent=parents.get(parent);}}
    const orderIds=new Set();
    for(const order of data.workOrders||[]){
      if(!order||!safeId(order.id)||orderIds.has(order.id)||!safeId(order.recordId)||!['open','planned','progress','done'].includes(order.status)||typeof order.title!=='string'||!order.title.trim())throw Error('Intervento non valido o senza scheda associata.');orderIds.add(order.id);
    }
  };
  window.loadMunicipalData=function(data){
    municipalValidate(data);assets=structuredClone(data.assets||[]);workOrders=structuredClone(data.workOrders||[]);contexts=municipalContextsFrom(data);
    extras=Object.fromEntries(Object.entries(data).filter(([key])=>!core.has(key)));
  };
  window.municipalSnapshot=()=>{contexts=municipalContextsFrom({contexts,trees,assets});return {...extras,assets:structuredClone(assets),workOrders:structuredClone(workOrders),contexts:structuredClone(contexts)};};
  window.municipalDataFrom=function(data){municipalValidate(data);return {...Object.fromEntries(Object.entries(data).filter(([key])=>!core.has(key))),assets:data.assets||[],workOrders:data.workOrders||[],contexts:municipalContextsFrom(data)};};
  window.allMunicipalRecords=()=>[...trees,...assets];
  window.municipalRecord=id=>trees.find(t=>t.id===id)||assets.find(a=>a.id===id);
  window.municipalName=record=>record?.assetKind?record.name:record?.species||'Non identificata';
  window.municipalStatus=record=>record?.assetKind?conditions[record.condition]:(statusName[record?.status]||'Non valutato');
  window.municipalAreaName=id=>contexts.find(a=>a.id===id)?.name||'';
  window.municipalContextLabel=record=>municipalAreaName(municipalContextId(record));
  window.municipalNextCode=function(kind){
    const prefix={bench:'P',bin:'C',playground_area:'AG',equipment:'G',park:'V'}[kind],used=new Set(allMunicipalRecords().map(r=>String(r.code||r.id).toUpperCase()));let n=1;
    while(used.has(`LESMO-${prefix}${String(n).padStart(4,'0')}`))n++;return `LESMO-${prefix}${String(n).padStart(4,'0')}`;
  };
  window.municipalTransaction=async function(change){
    if(municipalBusy||quickBusy||v2AnagBusy||backupInProgress)throw Error('Attendi il salvataggio in corso.');
    if(!folderHandle)throw Error('Accedi all’archivio prima di salvare.');
    const before={...municipalSnapshot(),trees:structuredClone(trees),history:structuredClone(historyEvents),photos:structuredClone(photos)};
    window.municipalBusy=true;
    try{await change({assets,workOrders,contexts});municipalValidate({...dataSnapshot()});await saveArchive();}
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
