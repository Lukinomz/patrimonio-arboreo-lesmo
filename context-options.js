/* Classificazione fissa per tutte le schede. I valori precedenti restano conservati. */
(() => {
  'use strict';
  window.MUNICIPAL_CONTEXTS={'':'Nessun contesto',strada:'Stradale',parco:'Parco o area verde',altro:'Altro'};
  const rawContext=record=>{
    if(!record)return '';
    if(Object.hasOwn(record,'siteType'))return String(record.siteType??'');
    return [record.context,record.contesto].find(value=>typeof value==='string')||'';
  };
  const normalized=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('it');
  window.municipalContextKey=function(record){
    const raw=rawContext(record);if(!raw)return '';
    const saved=Municipal.legacyContexts.find(item=>item?.id===raw);
    const aliases={strada:'strada',stradale:'strada',street:'strada','alberatura stradale':'strada',parco:'parco',park:'parco','parco o area verde':'parco',giardino:'parco',garden:'parco',boschivo:'parco','area boschiva':'parco',altro:'altro',other:'altro'};
    for(const value of [raw,...(Array.isArray(saved?.legacyValues)?saved.legacyValues:[]),saved?.type]){
      const key=normalized(value);if(Object.hasOwn(aliases,key))return aliases[key];
    }
    return 'altro';
  };
  window.municipalContextLabelForKey=key=>MUNICIPAL_CONTEXTS[key]||MUNICIPAL_CONTEXTS.altro;
  window.municipalContextOptions=function(value=''){
    return Object.entries(MUNICIPAL_CONTEXTS).map(([key,label])=>`<option value="${key}" ${key===value?'selected':''}>${label}</option>`).join('');
  };
  // Aprire o salvare una scheda senza cambiare il Contesto non converte i vecchi valori.
  window.readMunicipalSiteType=(record,chosen)=>record&&municipalContextKey(record)===chosen?rawContext(record):chosen;
  window.applyMunicipalContext=(record,key)=>{record.siteType=key;};
  treeContextLabel=record=>municipalContextLabelForKey(municipalContextKey(record));
  window.municipalBreakdown=function(records){
    const list=records.filter(record=>!record.assetKind),quantity=list.reduce((sum,record)=>sum+(recordQuantity(record)??0),0),unknown=list.filter(record=>recordQuantity(record)===null).length;
    return `<span><strong>${list.length}</strong> schede alberi · <strong>${quantity}</strong> esemplari${unknown?' + quantità non indicata in '+unknown+' gruppi':''}</span><span><strong>${records.filter(r=>r.assetKind==='bench').length}</strong> panchine</span><span><strong>${records.filter(r=>r.assetKind==='bin').length}</strong> cestini</span><span><strong>${records.filter(r=>r.assetKind==='equipment').length}</strong> giochi</span><span><strong>${records.filter(r=>r.assetKind==='playground_area').length}</strong> aree giochi</span>`;
  };
})();
