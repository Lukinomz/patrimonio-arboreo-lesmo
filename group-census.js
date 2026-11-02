/* Schede singole, gruppi, fasce boschive e policormici, nello stesso archivio. */
(() => {
  'use strict';
  const names={single:'Albero singolo',group:'Gruppo di alberi',woodland:'Fascia boschiva',multistem:'Albero policormico'};
  const byId=id=>document.getElementById(id);
  let drawing=null, editorGeometry=null, areaSvg, tools;
  const stemDrafts=new Map();
  const typeOf=tree=>Object.hasOwn(names,tree?.recordType)?tree.recordType:'single';
  window.firstObservationNotes=function(tree){
    if(!tree)return '';
    if(Object.hasOwn(tree,'initialObservationNotes'))return tree.initialObservationNotes||'';
    const first=historyEvents.filter(event=>event.treeId===tree.id&&event.type==='censimento').sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.created||'').localeCompare(String(b.created||'')))[0];
    if(first){const description=first.description||'';return ['','Primo rilievo dell’albero','Primo censimento (T0)','Rilevazione','Rilievo sanitario e dimensionale'].includes(description)?first.snapshot?.notes||tree.notes||'':description;}
    return tree.notes||'';
  };
  window.recordTypeLabel=tree=>names[typeOf(tree)];
  window.recordQuantity=tree=>['group','woodland'].includes(typeOf(tree))?(Number.isSafeInteger(tree.treeCount)&&tree.treeCount>0?tree.treeCount:null):1;
  const numeric=value=>Number(String(value).trim().replace(',','.'));
  const fmt=value=>Number(value).toLocaleString('it-IT',{maximumFractionDigits:2});
  function ringOf(geometry){
    const ring=geometry?.type==='Polygon'&&geometry.coordinates?.length===1?geometry.coordinates[0]:null;
    if(!Array.isArray(ring)||ring.length<4||ring.length>201||!ring.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<85))return null;
    if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])return null;
    return ring;
  }
  window.hasGroupArea=tree=>['group','woodland'].includes(typeOf(tree))&&!!ringOf(tree.geometry);
  function areaSize(geometry){
    const ring=ringOf(geometry);if(!ring)return 0;
    const latitude=ring[0][1]*Math.PI/180,scaleX=111320*Math.cos(latitude),scaleY=111320;
    const points=ring.map(([x,y])=>[(x-ring[0][0])*scaleX,(y-ring[0][1])*scaleY]);
    return Math.abs(points.slice(0,-1).reduce((sum,p,i)=>sum+p[0]*points[i+1][1]-points[i+1][0]*p[1],0))/2;
  }
  function centerOf(geometry){
    const ring=ringOf(geometry),points=ring.slice(0,-1);
    return {lat:points.reduce((sum,p)=>sum+p[1],0)/points.length,lon:points.reduce((sum,p)=>sum+p[0],0)/points.length};
  }
  function intersects(a,b,c,d){
    const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
    const on=(p,q,r)=>Math.abs(cross(p,q,r))<1e-14&&r[0]>=Math.min(p[0],q[0])-1e-12&&r[0]<=Math.max(p[0],q[0])+1e-12&&r[1]>=Math.min(p[1],q[1])-1e-12&&r[1]<=Math.max(p[1],q[1])+1e-12;
    return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
  }
  function validPolygon(geometry){
    const ring=ringOf(geometry);if(!ring||areaSize(geometry)<.5)return false;
    for(let i=0;i<ring.length-1;i++)for(let j=i+1;j<ring.length-1;j++){
      if(j===i+1||i===0&&j===ring.length-2)continue;
      if(intersects(ring[i],ring[i+1],ring[j],ring[j+1]))return false;
    }
    return true;
  }
  function makeStemEditor(prefix){
    return `<section class="stemEditor" id="${prefix}Box" hidden><label>Quanti fusti?<input type="number" id="${prefix}Count" min="2" max="100" step="1" inputmode="numeric" placeholder="Es. 3"/></label><div id="${prefix}Inputs" class="stemInputs"></div><output id="${prefix}Result" class="stemResult" aria-live="polite">Inserisci il numero di fusti.</output><small>Diametro equivalente = √(d₁² + d₂² + … + dₙ²)</small></section>`;
  }
  function stemValues(prefix){return [...byId(prefix+'Inputs').querySelectorAll('input')].map(input=>input.value);}
  function calculateStems(values){return values.length>=2&&values.every(value=>String(value).trim()!==''&&Number.isFinite(numeric(value))&&numeric(value)>0&&numeric(value)<=10000)?Math.sqrt(values.reduce((sum,value)=>sum+numeric(value)**2,0)):null;}
  function updateStemResult(prefix){
    const values=stemValues(prefix),diameter=calculateStems(values);
    const cached=stemDrafts.get(prefix)||[];values.forEach((value,index)=>{cached[index]=value;});stemDrafts.set(prefix,cached);
    byId(prefix+'Result').textContent=diameter===null?'Compila il diametro di ogni fusto.':`Diametro equivalente: ${fmt(diameter)} cm`;
    const target=byId(prefix==='groupStem'?'v21InitialDiameter':'v2CensusDiameter');
    if(diameter!==null)target.value=String(diameter);
  }
  function renderStemInputs(prefix,values){
    const count=Number(byId(prefix+'Count').value),valid=Number.isInteger(count)&&count>=2&&count<=100;
    if(values===undefined){const cached=stemDrafts.get(prefix)||[];stemValues(prefix).forEach((value,index)=>{cached[index]=value;});values=cached;}
    else values=[...values];
    stemDrafts.set(prefix,values);
    byId(prefix+'Inputs').innerHTML=valid?Array.from({length:count},(_,i)=>`<label>Fusto ${i+1} · cm<input type="text" inputmode="decimal" data-stem="${i}" aria-label="Diametro fusto ${i+1} in centimetri" value="${esc(values[i]??'')}" placeholder="Diametro"/></label>`).join(''):'';
    updateStemResult(prefix);
    if(!valid)byId(prefix+'Result').textContent='Indica da 2 a 100 fusti.';
  }
  function bindStems(prefix){
    byId(prefix+'Count').addEventListener('input',()=>renderStemInputs(prefix));
    byId(prefix+'Inputs').addEventListener('input',()=>updateStemResult(prefix));
  }
  function readStems(prefix,required){
    const raw=byId(prefix+'Count').value;
    if(!required&&!raw)return {};
    const count=Number(raw),values=stemValues(prefix),diameter=calculateStems(values);
    if(!Number.isInteger(count)||count<2||count>100||values.length!==count||diameter===null){
      tell('Indica da 2 a 100 fusti e compila tutti i diametri, in centimetri.');byId(prefix+'Count').focus();return false;
    }
    return {stemCount:count,stemDiameters:values.map(numeric),diameter,diameterMethod:'equivalent_multistem'};
  }
  function syncType(){
    const kind=byId('groupRecordType').value,group=['group','woodland'].includes(kind),multi=kind==='multistem';
    byId('groupQuantityFields').hidden=!group;byId('groupStemBox').hidden=!multi;byId('groupAreaFields').hidden=!group;
    byId('v21InitialDiameter').readOnly=multi;
    for(const input of byId('groupStemBox').querySelectorAll('input'))input.disabled=!multi;
    byId('groupTreeCount').disabled=!group;byId('groupCountEstimated').disabled=!group;
    byId('v2AnaLocate').textContent=group?'⌖ Delimita area sulla mappa':'⌖ Scegli posizione sulla mappa';
    byId('groupAreaInfo').textContent=editorGeometry?`Area delimitata · circa ${fmt(areaSize(editorGeometry))} m²`:'Nessuna area delimitata';
    byId('groupRemoveArea').hidden=!editorGeometry;
    if(multi)updateStemResult('groupStem');
  }
  window.captureGroupEditor=()=>({recordType:byId('groupRecordType').value,treeCount:byId('groupTreeCount').value,countEstimated:byId('groupCountEstimated').checked,stemCount:byId('groupStemCount').value,stemDiameters:stemValues('groupStem'),geometry:editorGeometry?structuredClone(editorGeometry):null});
  window.loadGroupEditor=function(tree,draft){
    if(!byId('groupRecordType'))return;
    const model=draft||tree||{};
    byId('groupRecordType').value=typeOf(model);
    byId('groupTreeCount').value=model.treeCount??'';byId('groupCountEstimated').checked=!!model.countEstimated;
    byId('groupStemCount').value=typeOf(model)==='multistem'?(model.stemCount||model.stemDiameters?.length||''):'';
    editorGeometry=ringOf(model.geometry)?structuredClone(model.geometry):null;
    renderStemInputs('groupStem',model.stemDiameters||[]);syncType();
  };
  window.readGroupEditor=function(){
    const kind=byId('groupRecordType').value,group=['group','woodland'].includes(kind);
    const raw=byId('groupTreeCount').value,count=raw===''?null:Number(raw);
    if(group&&count!==null&&(!Number.isSafeInteger(count)||count<1)){tell('Il numero di alberi deve essere un intero positivo, oppure lascia il campo vuoto.');byId('groupTreeCount').focus();return false;}
    const stems=kind==='multistem'?readStems('groupStem',true):{stemCount:null,stemDiameters:[]};if(stems===false)return false;
    const geometry=group?editorGeometry:null;
    if(geometry&&!validPolygon(geometry)){tell('Il perimetro non è valido: ridisegna l’area senza incrociare i lati.');return false;}
    return {recordType:kind,treeCount:group?count:1,countEstimated:group&&count!==null&&byId('groupCountEstimated').checked,...stems,
      diameterMethod:kind==='multistem'?'equivalent_multistem':'',geometry:geometry?structuredClone(geometry):null,...(geometry?centerOf(geometry):{})};
  };
  window.groupSnapshot=tree=>({recordType:typeOf(tree),treeCount:recordQuantity(tree),countEstimated:!!tree.countEstimated,stemCount:tree.stemCount??null,stemDiameters:structuredClone(tree.stemDiameters||[]),diameterMethod:tree.diameterMethod||'',geometry:tree.geometry?structuredClone(tree.geometry):null});
  window.loadSurveyStems=function(tree){
    const multi=typeOf(tree)==='multistem';byId('surveyStemBox').hidden=!multi;byId('v2CensusDiameter').readOnly=multi;
    byId('surveyStemCount').value=multi?(tree.stemCount||tree.stemDiameters?.length||''):'';
    renderStemInputs('surveyStem',multi?tree.stemDiameters||[]:[]);
    for(const input of byId('surveyStemBox').querySelectorAll('input'))input.disabled=!multi;
    byId('savedRecordNotes').textContent=firstObservationNotes(tree)||'Nessuna osservazione del primo rilievo.';
    const latest=historyEvents.filter(event=>event.treeId===tree.id&&SURVEY_TYPES.has(event.type)).sort(historyOrder).find(event=>event.description&&!['Rilevazione','Primo rilievo dell’albero','Primo censimento (T0)'].includes(event.description));
    byId('savedSurveyNotes').textContent=latest?`${latest.date||''} · ${latest.description}`:tree.surveyNotes||'Nessuna osservazione precedente.';
  };
  window.readSurveyStems=tree=>typeOf(tree)==='multistem'?readStems('surveyStem',true):{};
  window.showGroupAndNotesDetail=function(tree){
    const group=['group','woodland'].includes(typeOf(tree));
    const box=document.createElement('section');box.className='groupRecordDetail';
    const history=historyEvents.filter(event=>event.treeId===tree.id&&SURVEY_TYPES.has(event.type)&&event.description).sort(historyOrder).slice(0,10);
    box.innerHTML=`<div class="groupRecordBadge">${esc(recordTypeLabel(tree))}${group?` · ${recordQuantity(tree)===null?'quantità non indicata':`${tree.countEstimated?'circa ':''}${recordQuantity(tree)} esemplari`}`:''}${typeOf(tree)==='multistem'?` · ${tree.stemCount||'?'} fusti · Ø equivalente ${fmt(tree.diameter||0)} cm`:''}</div>${tree.stemDiameters?.length?`<p>Diametri dei fusti: ${tree.stemDiameters.map(fmt).join(' · ')} cm</p>`:''}${hasGroupArea(tree)?`<button class="btn" type="button" id="showGroupAreaDetail">Mostra area sulla mappa</button>`:''}<h3>Osservazioni primo rilievo</h3><p class="savedNotesText">${esc(firstObservationNotes(tree)||'Nessuna osservazione.')}</p>${tree.notes&&tree.notes!==firstObservationNotes(tree)?`<h3>Altre note conservate</h3><p class="savedNotesText">${esc(tree.notes)}</p>`:''}<details><summary>Osservazioni salvate (${historyEvents.filter(event=>event.treeId===tree.id&&SURVEY_TYPES.has(event.type)).length})</summary>${history.map(event=>`<article><small>${esc(event.date||'Data non indicata')}</small><p class="savedNotesText">${esc(event.description)}</p></article>`).join('')||'<p>Nessuna osservazione registrata.</p>'}</details>`;
    byId('v2DetailContent').appendChild(box);
    byId('showGroupAreaDetail')?.addEventListener('click',()=>{v2CloseDetail();switchSection('mappa');focusArea(tree.geometry);draw();});
  };
  function focusArea(geometry){
    const ring=ringOf(geometry);if(!ring)return;
    const lats=ring.map(p=>p[1]),lons=ring.map(p=>p[0]);mp.lat=(Math.min(...lats)+Math.max(...lats))/2;mp.lon=(Math.min(...lons)+Math.max(...lons))/2;
    const rect=byId('map').getBoundingClientRect();
    for(let z=20;z>=10;z--){const a=xy(Math.min(...lats),Math.min(...lons),z),b=xy(Math.max(...lats),Math.max(...lons),z);if(Math.abs(a.x-b.x)<rect.width*.65&&Math.abs(a.y-b.y)<rect.height*.6){mp.z=z;break;}}
    resetTiles();
  }
  window.isGroupAreaDrawing=()=>!!drawing;
  function updateTools(message=''){
    const n=drawing?.points.length||0;byId('groupAreaPointCount').textContent=message||`${n} vertici · almeno 3 per chiudere l’area`;
    byId('groupAreaConfirm').disabled=n<3;byId('groupAreaUndo').disabled=!n;
  }
  window.addGroupAreaPoint=function(point){
    if(!drawing)return;
    if(drawing.points.length>=200){updateTools('Massimo 200 vertici.');return;}
    const coordinate=[point.lon,point.lat];
    if(drawing.points.some(p=>Math.abs(p[0]-coordinate[0])<1e-9&&Math.abs(p[1]-coordinate[1])<1e-9)){updateTools('Per chiudere il perimetro premi Conferma area.');return;}
    drawing.points.push(coordinate);updateTools();drawGroupAreas();
  };
  function beginArea(){
    stopMapAdd();hideTreeCard();
    const fields=Object.fromEntries([...byId('v2AnagForm').querySelectorAll('input[id],textarea[id],select[id]')].filter(input=>input.type!=='file').map(input=>[input.id,input.value]));
    drawing={id:v2AnagId,fields,group:captureGroupEditor(),points:[]};
    v2CloseAnag({keep:true});switchSection('mappa');byId('map').closest('.stage').classList.add('groupAreaDrawing');tools.hidden=false;
    if(editorGeometry)focusArea(editorGeometry);updateTools();draw();
  }
  async function endArea(geometry){
    const draft=drawing;if(!draft)return;drawing=null;tools.hidden=true;byId('map').closest('.stage').classList.remove('groupAreaDrawing');
    v2AnaMapDraft={id:draft.id,fields:draft.fields,group:{...draft.group,...(geometry?{geometry}:{})}};
    const center=geometry?centerOf(geometry):{lat:draft.fields.v2AnaLat,lon:draft.fields.v2AnaLon};
    await v2OpenAnag(trees.find(tree=>tree.id===draft.id)||null,center.lat,center.lon);drawGroupAreas();
  }
  function finishArea(){
    if(!drawing||drawing.points.length<3)return;
    const geometry={type:'Polygon',coordinates:[[...drawing.points,drawing.points[0]]]};
    if(!validPolygon(geometry)){updateTools('Perimetro non valido: evita lati incrociati o punti allineati.');return;}
    endArea(geometry);
  }
  async function newArea(){hideAddChoice();if(await v2OpenAnag(null)===false)return;byId('groupRecordType').value='woodland';syncType();beginArea();}
  window.drawGroupAreas=function(){
    if(!areaSvg)return 0;
    const map=byId('map'),w=map.clientWidth,h=map.clientHeight;if(!w||!h)return 0;
    areaSvg.setAttribute('viewBox',`0 0 ${w} ${h}`);areaSvg.setAttribute('width',w);areaSvg.setAttribute('height',h);
    const parts=[];let shown=0;
    for(const tree of trees){
      if(!hasGroupArea(tree)||!mapVisibleStates.has(MAP_STATUS_ORDER.includes(tree.status)?tree.status:'unknown'))continue;
      const points=tree.geometry.coordinates[0].map(([lon,lat])=>mapFromLL(lat,lon));
      if(Math.max(...points.map(p=>p.x))<0||Math.min(...points.map(p=>p.x))>w||Math.max(...points.map(p=>p.y))<0||Math.min(...points.map(p=>p.y))>h)continue;
      const color=MAP_MARKER_COLORS[tree.status]||'#587746',representative=isValid(tree)?tree:centerOf(tree.geometry),center=mapFromLL(representative.lat,representative.lon);
      parts.push(`<polygon data-group-id="${esc(tree.id)}" points="${points.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" fill="${color}" fill-opacity=".2" stroke="${color}" stroke-width="3" role="button" tabindex="0" aria-label="${esc(publicCode(tree)+' · '+recordTypeLabel(tree))}" style="pointer-events:${drawing||addMode?'none':'all'}"><title>${esc(publicCode(tree))} · ${esc(tree.species||'')} · ${recordQuantity(tree)===null?'quantità non indicata':recordQuantity(tree)+' esemplari'}</title></polygon><text x="${center.x}" y="${center.y}" class="groupAreaLabel">${esc(publicCode(tree))}</text>`);shown++;
    }
    if(drawing?.points.length){
      const points=drawing.points.map(([lon,lat])=>mapFromLL(lat,lon));
      parts.push(`<polyline points="${points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="#4d8656" fill-opacity=".15" stroke="#346b43" stroke-width="3" stroke-dasharray="7 4"/>`);
      for(const point of points)parts.push(`<circle cx="${point.x}" cy="${point.y}" r="5" fill="#fff" stroke="#346b43" stroke-width="2"/>`);
    }
    areaSvg.innerHTML=parts.join('');return shown;
  };
  document.addEventListener('DOMContentLoaded',()=>{
    Object.assign(fieldName,{recordType:'Tipo di censimento',treeCount:'Numero di alberi',countEstimated:'Conteggio stimato',stemCount:'Numero fusti',stemDiameters:'Diametri fusti',diameterMethod:'Calcolo del diametro',initialObservationNotes:'Osservazioni primo rilievo',geometry:'Perimetro'});
    const identity=document.createElement('section');identity.className='groupCensusEditor';
    identity.innerHTML=`<label>Tipo di censimento<select id="groupRecordType">${Object.entries(names).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><div id="groupQuantityFields" class="groupQuantityFields" hidden><label>Numero di alberi<input type="number" min="1" step="1" id="groupTreeCount" inputmode="numeric" placeholder="Es. 50 · lascia vuoto se non noto"/></label><label class="groupEstimated"><input id="groupCountEstimated" type="checkbox"/> Conteggio stimato</label></div>${makeStemEditor('groupStem')}<div id="groupAreaFields" hidden><span id="groupAreaInfo"></span><div class="groupAreaActions"><button class="btn" type="button" id="groupDrawArea">Delimita area sulla mappa</button><button class="btn" type="button" id="groupRemoveArea" hidden>Rimuovi perimetro</button></div></div>`;
    byId('v2AnagForm').querySelector('.v2FormGrid').insertAdjacentElement('beforebegin',identity);
    const survey=document.createElement('div');survey.innerHTML=makeStemEditor('surveyStem')+`<details class="savedSurveyNotes"><summary>Note e osservazioni già salvate</summary><h4>Osservazioni primo rilievo</h4><p id="savedRecordNotes" class="savedNotesText"></p><h4>Ultima osservazione</h4><p id="savedSurveyNotes" class="savedNotesText"></p></details>`;
    byId('v2CensusNote').closest('label').insertAdjacentElement('beforebegin',survey);
    bindStems('groupStem');bindStems('surveyStem');
    byId('groupRecordType').addEventListener('change',syncType);
    byId('groupDrawArea').addEventListener('click',beginArea);
    byId('groupRemoveArea').addEventListener('click',()=>{editorGeometry=null;syncType();});
    byId('v2AnaLocate').addEventListener('click',event=>{if(['group','woodland'].includes(byId('groupRecordType').value)){event.preventDefault();event.stopImmediatePropagation();beginArea();}},true);
    const choice=document.createElement('button');choice.className='choiceCard';choice.id='chooseGroupArea';choice.type='button';choice.innerHTML='<span class="choiceIcon">▱</span><span><strong>Delimita un gruppo o una fascia boschiva</strong><small>Disegna il perimetro sulla mappa e assegna un unico codice.</small></span><span class="choiceArrow">→</span>';byId('addTreeChoice').querySelector('.choiceList').appendChild(choice);choice.addEventListener('click',newArea);
    const mapButton=document.createElement('button');mapButton.id='newGroupAreaMap';mapButton.className='mapBtn groupAreaMapButton';mapButton.type='button';mapButton.textContent='Area';mapButton.setAttribute('aria-label','Censisci un gruppo delimitando un’area');byId('map').closest('.stage').querySelector('.mapBtns').appendChild(mapButton);mapButton.addEventListener('click',newArea);
    areaSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');areaSvg.id='groupAreas';byId('map').appendChild(areaSvg);
    const openPolygon=event=>{const shape=event.target.closest('[data-group-id]');if(!shape||drawing||addMode||event.type==='click'&&moved)return;event.stopPropagation();const tree=trees.find(tree=>tree.id===shape.dataset.groupId);if(tree)showTreeMapCard(tree);};
    areaSvg.addEventListener('click',openPolygon);areaSvg.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();openPolygon(event);}});
    tools=document.createElement('div');tools.id='groupAreaTools';tools.hidden=true;tools.innerHTML='<strong>Delimita l’area</strong><p>Tocca i vertici del perimetro sulla mappa.</p><span id="groupAreaPointCount" role="status"></span><div><button type="button" id="groupAreaUndo">Annulla ultimo punto</button><button type="button" id="groupAreaCancel">Annulla</button><button type="button" id="groupAreaConfirm">Conferma area</button></div>';byId('map').closest('.stage').appendChild(tools);
    byId('groupAreaUndo').onclick=()=>{drawing?.points.pop();updateTools();drawGroupAreas();};byId('groupAreaCancel').onclick=()=>endArea(null);byId('groupAreaConfirm').onclick=finishArea;
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&drawing){event.preventDefault();event.stopImmediatePropagation();endArea(null);}},true);
    document.querySelectorAll('.mainNav [data-view],.mFieldNav [data-mobile-view]').forEach(button=>button.addEventListener('click',()=>{if(drawing)endArea(null);},true));
    const guide=byId('guida-nuovo');guide.insertAdjacentHTML('beforeend','<p class="guideNote"><strong>Gruppi e fasce boschive:</strong> scegli “Delimita un gruppo o una fascia boschiva”, tocca almeno tre vertici e premi “Conferma area”. Nella scheda indica il numero di alberi, se noto. Per un policormico scegli il tipo nella scheda e compila il diametro di ogni fusto.</p>');
  });
})();
