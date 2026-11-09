/* Il Contesto già presente nelle schede diventa un elenco condiviso, modificabile da Admin. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),types={park:'Parco',street:'Via',square:'Piazza',garden:'Giardino',playground:'Area giochi',other:'Altro'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let dialog,focusBefore;
  window.municipalContextOptions=(value='',exclude)=>'<option value="">Nessun contesto</option>'+Municipal.contexts.filter(c=>c.id!==exclude&&(c.id===value||c.legacyAssetId||c.legacyValues?.length||c.type!=='park')).map(c=>`<option value="${esc(c.id)}" ${c.id===value?'selected':''}>${esc(c.name)}</option>`).join('');
  window.municipalParkOptions=(value='')=>'<option value="">Nessun parco assegnato</option>'+municipalParks().map(c=>`<option value="${esc(c.id)}" ${c.id===value?'selected':''}>${esc(c.name)}</option>`).join('');
  window.readMunicipalSiteType=(record,chosen)=>record&&municipalContextId(record)===chosen?record.siteType||'':chosen||'';
  window.applyMunicipalContext=(record,id)=>{record.siteType=id||'';record.areaId=null;};
  const oldContextLabel=treeContextLabel;
  treeContextLabel=record=>municipalContextLabel(record)||oldContextLabel(record);
  window.showMunicipalInventory=function(contextId){
    RegistryFilters.setContexts(contextId?[contextId]:[]);
    document.querySelector('[data-mun-category="all"]')?.click();switchSection('anagrafica');
  };
  window.showParkInventory=function(id){RegistryFilters.setContexts([]);RegistryFilters.setParks(id?[id]:[]);document.querySelector('[data-mun-category="all"]')?.click();switchSection('anagrafica');};
  function tally(records){
    const treesOnly=records.filter(r=>!r.assetKind),known=treesOnly.reduce((n,r)=>n+(recordQuantity(r)??0),0),unknown=treesOnly.filter(r=>recordQuantity(r)===null).length;
    return {trees:treesOnly.length,quantity:known,unknown,bench:records.filter(r=>r.assetKind==='bench').length,bin:records.filter(r=>r.assetKind==='bin').length,equipment:records.filter(r=>r.assetKind==='equipment').length,areas:records.filter(r=>r.assetKind==='playground_area').length,total:records.filter(r=>r.assetKind!=='park').length};
  }
  window.municipalBreakdown=function(records){
    const c=tally(records);return `<span><strong>${c.trees}</strong> schede alberi · <strong>${c.quantity}</strong> esemplari${c.unknown?' + quantità non indicata in '+c.unknown+' gruppi':''}</span><span><strong>${c.bench}</strong> panchine</span><span><strong>${c.bin}</strong> cestini</span><span><strong>${c.equipment}</strong> giochi</span><span><strong>${c.areas}</strong> aree giochi</span>`;
  };
  function close(){if(municipalBusy)return;dialog.close();focusBefore?.focus?.({preventScroll:true});}
  function shell(title,body){if(!dialog.open)focusBefore=document.activeElement;dialog.innerHTML=`<header class="munDialogHead"><h2 id="contextDialogTitle">${esc(title)}</h2><button type="button" class="munClose" id="contextClose" aria-label="Chiudi contesti">×</button></header><div class="munDialogBody">${body}</div>`;if(!dialog.open)dialog.showModal();$('contextClose').onclick=close;}
  window.openMunicipalContexts=function(){
    const admin=window.isMunicipalAdmin?.();
    shell('Contesti',`<p>Consulta cosa è presente in ogni parco, via o altro luogo.</p>${admin?'<button type="button" class="btn main" id="contextNew">＋ Nuovo parco o contesto</button>':'<button type="button" class="btn" id="contextAdminAccess">Crea e modifica da Admin</button>'}<div class="contextList">${Municipal.contexts.map(c=>{const isPark=municipalParks().some(p=>p.id===c.id),records=allMunicipalRecords().filter(r=>isPark?municipalParkId(r)===c.id:municipalContextId(r)===c.id);return `<article><div><strong>${esc(c.name)}</strong><small>${types[c.type]||'Altro'}${c.address?' · '+esc(c.address):''}</small><div class="contextBreakdown">${municipalBreakdown(records)}</div></div><div class="munActions"><button class="btn" type="button" data-context-open="${esc(c.id)}" ${isPark?'data-is-park="true"':''}>Apri inventario</button>${admin?`<button class="btn" type="button" data-context-edit="${esc(c.id)}">Modifica</button>`:''}</div></article>`;}).join('')||'<p>Non ci sono ancora contesti nell’archivio.</p>'}</div>`);
    if(admin)$('contextNew').onclick=()=>editContext();else $('contextAdminAccess').onclick=()=>{close();$('adminOpen').click();};
    dialog.querySelectorAll('[data-context-open]').forEach(b=>b.onclick=()=>{close();if(isMunicipalAdmin?.())$('adminClose').click();if(b.dataset.isPark)showParkInventory(b.dataset.contextOpen);else showMunicipalInventory(b.dataset.contextOpen);});
    dialog.querySelectorAll('[data-context-edit]').forEach(b=>b.onclick=()=>editContext(Municipal.contexts.find(c=>c.id===b.dataset.contextEdit)));
  };
  function editContext(record){
    if(!window.isMunicipalAdmin?.())return;
    const count=record?allMunicipalRecords().filter(r=>municipalParks().some(p=>p.id===record.id)?municipalParkId(r)===record.id:municipalContextId(r)===record.id).length:0;
    shell(record?'Modifica contesto':'Nuovo contesto',`<form id="contextForm"><div class="munFormGrid"><label>Nome del contesto<input id="contextName" value="${esc(record?.name||'')}" placeholder="Es. Parco Ungaretti" required maxlength="160"/></label><label>Tipo<select id="contextType">${Object.entries(types).map(([k,v])=>`<option value="${k}" ${k===(record?.type||'park')?'selected':''}>${v}</option>`).join('')}</select></label><label class="munWide">Via / località<input id="contextAddress" value="${esc(record?.address||'')}" maxlength="200"/></label><label class="munWide">Note<textarea id="contextNotes" rows="3" maxlength="12000">${esc(record?.notes||'')}</textarea></label></div>${record?`<p class="munHint">${count} schede collegate. Cambiare il nome mantiene collegamenti e rilievi precedenti.</p>`:''}<p id="contextError" class="contextError" role="alert" hidden></p><div class="munDialogFoot"><button type="button" class="btn" id="contextBack">Annulla</button><button class="btn main" type="submit" id="contextSave">Salva contesto</button></div></form>`);
    $('contextBack').onclick=openMunicipalContexts;
    $('contextForm').onsubmit=async e=>{
      e.preventDefault();if(!window.isMunicipalAdmin?.()||municipalBusy)return;
      const name=$('contextName').value.trim(),type=$('contextType').value,address=$('contextAddress').value.trim(),notes=$('contextNotes').value.trim(),key=s=>s.normalize('NFKC').trim().toLocaleLowerCase('it');
      if(!name||Municipal.contexts.some(c=>c.id!==record?.id&&key(c.name)===key(name))){$('contextError').hidden=false;$('contextError').textContent='Scegli un nome non vuoto e non già utilizzato.';return;}
      $('contextSave').disabled=true;
      try{await municipalTransaction(({contexts})=>{
        if(!window.isMunicipalAdmin?.())throw Error('Accedi come amministratore per modificare i contesti.');
        const next={...record,id:record?.id||'CTX-'+uniqueID(),name,type,address,notes,modified:new Date().toISOString(),created:record?.created||new Date().toISOString()};
        if(record)contexts[contexts.findIndex(c=>c.id===record.id)]=next;else contexts.push(next);
      });openMunicipalContexts();tell('Contesto salvato.');}
      catch(error){$('contextError').hidden=false;$('contextError').textContent=error.message;$('contextSave').disabled=false;}
    };
  }
  window.renderContextStatistics=function(){
    if(!$('contextStatistics'))return;
    const selected=RegistryFilters.parkValues,contexts=municipalParks().filter(c=>!selected.size||selected.has(c.id));
    $('contextStatisticsRows').innerHTML=contexts.map(c=>{const records=municipalScopedRecords().filter(r=>municipalParkId(r)===c.id),n=tally(records),ids=new Set(records.map(r=>r.id)),tasks=Municipal.workOrders.filter(o=>ids.has(o.recordId)&&o.status!=='done').length;return `<tr><td><button class="codeLink" data-context-inventory="${esc(c.id)}">${esc(c.name)}</button><small>${types[c.type]||'Altro'}</small></td><td>${n.trees}</td><td>${n.quantity}${n.unknown?' + ?':''}</td><td>${n.bench}</td><td>${n.bin}</td><td>${n.equipment}</td><td>${n.areas}</td><td>${tasks}</td></tr>`;}).join('')||'<tr><td colspan="8">Nessun contesto presente nei risultati.</td></tr>';
    $('contextStatisticsCount').textContent=`${contexts.length} parchi · associazione manuale delle schede`;
    const button=$('statisticsContextFilter');button.textContent=selected.size===1?municipalAreaName([...selected][0])||'Non indicato':selected.size?`${selected.size} parchi selezionati`:'Tutti i parchi';
  };
  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{
    dialog=document.createElement('dialog');dialog.id='contextDialog';dialog.className='munDialog';dialog.setAttribute('aria-labelledby','contextDialogTitle');dialog.addEventListener('cancel',e=>{e.preventDefault();close();});document.body.appendChild(dialog);
    const stats=document.createElement('section');stats.id='contextStatistics';stats.className='workCard';stats.innerHTML='<div class="sectionHead"><div><h2>Inventario dei parchi</h2><p id="contextStatisticsCount"></p></div><button type="button" class="btn" id="statisticsContextFilter">Tutti i parchi</button></div><div class="contextStatsViewport"><table class="contextStatsTable"><thead><tr><th>Parco</th><th>Schede alberi</th><th>Esemplari</th><th>Panchine</th><th>Cestini</th><th>Giochi</th><th>Aree giochi</th><th>Interventi aperti</th></tr></thead><tbody id="contextStatisticsRows"></tbody></table></div>';$('viewStatistiche').prepend(stats);
    stats.onclick=e=>{const b=e.target.closest('[data-context-inventory]');if(b)showParkInventory(b.dataset.contextInventory);};$('statisticsContextFilter').onclick=()=>{const key='park',api=RegistryFilters.get(Municipal.categoryFilter==='trees'?'trees':'municipal');api?.open(key,$('statisticsContextFilter'));};
  },0));
})();
