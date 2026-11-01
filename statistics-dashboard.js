/* Cruscotto calcolato esclusivamente sull'archivio collegato. */
(() => {
  'use strict';
  const colors = {ok:'#397b56',sick:'#dcaa46',watch:'#bb852f',critical:'#bd5b4c',dead:'#766d68',cut:'#8c98a1',fallen:'#aa7b57',unknown:'#aab9a0',removed:'#d1d7cd'};
  const palette = ['#346e50','#749b62','#b3c88b','#a18b4c','#5b8991','#8f969f','#c1aa87','#b7bca7','#d9ded2'];
  const byId = id => document.getElementById(id);
  let speciesView = 'bars', activityYear = '';
  const number = value => value.toLocaleString('it-IT');
  const percentage = (part,total) => total ? Math.round(part/total*100) : 0;
  const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && !!dateFromCsv(date);
  function donut(items, total, centerLabel) {
    const radius=73, perimeter=2*Math.PI*radius;
    let offset=0;
    const rings=items.filter(item=>item.value>0).map(item=>{
      const length=item.value/total*perimeter;
      const arc=`<circle cx="110" cy="110" r="${radius}" fill="none" stroke="${item.color}" stroke-width="29" stroke-dasharray="${length} ${perimeter-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 110 110)"><title>${esc(item.label)}: ${item.value} (${percentage(item.value,total)}%)</title></circle>`;
      offset+=length;return arc;
    }).join('');
    return `<svg class="analyticsDonut" viewBox="0 0 220 220" role="img" aria-label="${esc(centerLabel)}: ${total}. ${esc(items.map(i=>`${i.label}: ${i.value}`).join(', '))}"><circle cx="110" cy="110" r="73" fill="none" stroke="#edf1e7" stroke-width="29"/>${rings}<text x="110" y="110" text-anchor="middle" class="analyticsDonutValue">${number(total)}</text><text x="110" y="132" text-anchor="middle" class="analyticsDonutLabel">${esc(centerLabel)}</text></svg>`;
  }
  function legend(items,total,key) {
    return `<div class="analyticsLegend">${items.map(item=>`<button type="button" ${item.key ? `data-analytics-filter="${key}" data-value="${esc(item.key)}"` : 'disabled'}><span class="analyticsDot" style="background:${item.color}"></span><span class="analyticsLegendName">${esc(item.label)}</span><strong>${number(item.value)}</strong><small>${percentage(item.value,total)}%</small>${item.key?'<span class="analyticsLegendArrow" aria-hidden="true">↗</span>':'<span></span>'}</button>`).join('')}</div>`;
  }
  function bars(items,total,key) {
    const max=Math.max(1,...items.map(item=>item.value));
    return `<div class="analyticsBars">${items.map(item=>`<button type="button" ${item.key ? `data-analytics-filter="${key}" data-value="${esc(item.key)}"` : 'disabled'} title="${esc(item.label)}: ${item.value} (${percentage(item.value,total)}%)"><span class="analyticsBarName">${esc(item.label)}</span><strong>${number(item.value)}<small>${percentage(item.value,total)}%</small></strong><span class="analyticsBarTrack"><span style="width:${item.value/max*100}%;background:${item.color}"></span></span></button>`).join('')}</div>`;
  }
  function groupedChart(groups, series, label) {
    const width=680,height=245,left=44,right=14,top=24,bottom=42,chartHeight=height-top-bottom;
    const maximum=Math.max(1,...groups.flatMap(group=>group.values));
    const step=Math.max(1,Math.ceil(maximum/4)), ceiling=step*4, baseline=height-bottom;
    let drawing='';
    for(let i=0;i<=4;i++){
      const y=baseline-i/4*chartHeight;
      drawing+=`<line x1="${left}" x2="${width-right}" y1="${y}" y2="${y}" stroke="#e7ecdf"/><text x="${left-9}" y="${y+4}" text-anchor="end" fill="#839078" font-size="11">${number(i*step)}</text>`;
    }
    const groupWidth=(width-left-right)/Math.max(groups.length,1),barWidth=Math.min(24,groupWidth/3.1);
    groups.forEach((group,index)=>{
      const center=left+groupWidth*(index+.5);
      group.values.forEach((value,j)=>{
        const barHeight=value/ceiling*chartHeight,x=center+(j-.5)*barWidth-barWidth/2,y=baseline-barHeight;
        drawing+=`<rect x="${x}" y="${y}" width="${barWidth-2}" height="${barHeight}" rx="3" fill="${series[j].color}"><title>${esc(group.label)} · ${series[j].label}: ${value}</title></rect>`;
      });
      drawing+=`<text x="${center}" y="${baseline+22}" text-anchor="middle" fill="#65785d" font-size="11">${esc(group.label)}</text>`;
      if(group.net!==undefined)drawing+=`<text x="${center}" y="${top-9}" text-anchor="middle" fill="${group.net<0?'#a25544':'#397048'}" font-size="11" font-weight="650">${group.net>0?'+':''}${group.net}</text>`;
    });
    return `<div class="analyticsChartLegend">${series.map(item=>`<span><i style="background:${item.color}"></i>${esc(item.label)}</span>`).join('')}</div><svg class="analyticsGroupedChart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">${drawing}</svg><details class="analyticsChartData"><summary>Vedi i dati</summary><div class="analyticsDataScroll"><table><caption class="registrySrOnly">${esc(label)}</caption><thead><tr><th>Periodo</th>${series.map(item=>`<th>${esc(item.label)}</th>`).join('')}${groups.some(g=>g.net!==undefined)?'<th>Saldo</th>':''}</tr></thead><tbody>${groups.map(group=>`<tr><th scope="row">${esc(group.label)}</th>${group.values.map(value=>`<td>${value}</td>`).join('')}${group.net!==undefined?`<td>${group.net>0?'+':''}${group.net}</td>`:''}</tr>`).join('')}</tbody></table></div></details>`;
  }
  function metric(title,value,detail,tone='',filter='',filterValue='') {
    return `<div class="analyticsMetric ${tone}"><span>${title}</span><strong>${number(value)}</strong><small>${detail}</small>${filter?`<button type="button" data-analytics-filter="${filter}" data-value="${filterValue}" aria-label="Apri elenco: ${title}">↗</button>`:''}</div>`;
  }
  window.renderStatisticsDashboard = function () {
    if(!byId('statisticsDashboard'))return;
    const total=trees.length,knownIds=new Set(trees.map(tree=>tree.id));
    const alive=trees.filter(tree=>['ok','sick','watch','critical'].includes(tree.status)).length;
    const attention=trees.filter(tree=>['sick','watch','critical'].includes(tree.status)).length;
    const present=trees.filter(tree=>!OUT_OF_STOCK_STATUSES.has(tree.status));
    const overdue=present.filter(tree=>validDate(tree.nextCheck)&&tree.nextCheck<localDay()).length;
    const located=trees.filter(isValid).length;
    const photoTrees=new Set(photos.filter(photo=>!photo.removed&&knownIds.has(photo.treeId)).map(photo=>photo.treeId));
    const identified=trees.filter(tree=>tree.species?.trim()&&!/^(non identificata|da identificare|sconosciuta)$/i.test(tree.species.trim())).length;
    const species=new Map();for(const tree of trees){const name=tree.species?.trim()||'Non identificata';species.set(name,(species.get(name)||0)+1);}
    const distinct=[...species.keys()].filter(name=>!/^(non identificata|da identificare|sconosciuta)$/i.test(name)).length;
    byId('analyticsMetrics').innerHTML=metric('Alberi in archivio',total,`${number(present.length)} presenti`,'','','')+
      metric('Alberi vivi',alive,`${percentage(alive,total)}% dell’archivio`,'green')+
      metric('Da seguire',attention,'Malati, da monitorare e critici','amber','overviewStatus','attention')+
      metric('Specie censite',distinct,`${number(total-identified)} alberi da identificare`)+
      metric('Con posizione GPS',located,`${percentage(located,total)}% dell’archivio`,'green','overviewLocation','geo')+
      metric('Verifiche scadute',overdue,'Alberi presenti · alla data di oggi',overdue?'red':'');
    const statuses=['ok','sick','watch','critical','unknown','dead','cut','fallen','removed'].map(key=>({key,label:statusName[key]||'Non valutato',value:trees.filter(tree=>(tree.status||'unknown')===key).length,color:colors[key]}));
    // Eventuali stati importati non riconosciuti rientrano tra i non valutati.
    statuses.find(item=>item.key==='unknown').value+=trees.filter(tree=>tree.status&&!Object.hasOwn(colors,tree.status)).length;
    byId('analyticsHealth').innerHTML=`<div class="analyticsDonutLayout">${donut(statuses,total,'alberi')}${legend(statuses,total,'overviewStatus')}</div>`;
    const ranking=[...species].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'it',{numeric:true}));
    const top=ranking.slice(0,8).map(([label,value],i)=>({key:label,label,value,color:palette[i]}));
    const other=ranking.slice(8).reduce((sum,[,value])=>sum+value,0);
    if(other)top.push({key:'',label:'Altre specie',value:other,color:palette[8]});
    byId('analyticsSpecies').innerHTML=!total?'<div class="analyticsEmpty">Nessun albero registrato</div>':speciesView==='pie'?`<div class="analyticsDonutLayout">${donut(top,total,'alberi')}${legend(top,total,'species')}</div>`:bars(top,total,'species');
    byId('analyticsSpeciesInfo').textContent=`${number(distinct)} specie · ${number(total)} alberi`;
    const coverage=[{label:'Posizione GPS',value:located,filter:'overviewLocation',choice:'nogeo',action:'Da posizionare'},
      {label:'Specie identificata',value:identified},{label:'Almeno una fotografia',value:photoTrees.size,filter:'v21PhotoFilter',choice:'without',action:'Senza foto'},
      {label:'Stato sanitario valutato',value:trees.filter(tree=>['ok','sick','watch','critical','dead','cut','fallen'].includes(tree.status)).length}];
    byId('analyticsCoverage').innerHTML=coverage.map(item=>`<div class="analyticsCoverageItem"><div><span>${item.label}</span><strong>${percentage(item.value,total)}%</strong></div><div class="analyticsCoverageTrack"><span style="width:${percentage(item.value,total)}%"></span></div><footer><small>${number(item.value)} di ${number(total)} alberi</small>${item.filter&&total>item.value?`<button type="button" data-analytics-filter="${item.filter}" data-value="${item.choice}">${item.action} (${number(total-item.value)}) ↗</button>`:''}</footer></div>`).join('');
    const dated=historyEvents.filter(event=>!event.cancelled&&knownIds.has(event.treeId)&&validDate(event.date)&&(SURVEY_TYPES.has(event.type)||WORK_TYPES.has(event.type)));
    const years=[...new Set([String(new Date().getFullYear()),...dated.map(event=>event.date.slice(0,4))])].sort().reverse();
    if(!years.includes(activityYear))activityYear=years[0];
    byId('analyticsActivityYear').innerHTML=years.map(year=>`<option value="${year}">${year}</option>`).join('');byId('analyticsActivityYear').value=activityYear;
    const groups=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'].map(label=>({label,values:[0,0]}));
    let surveys=0,works=0;
    for(const event of dated)if(event.date.startsWith(activityYear)){const series=SURVEY_TYPES.has(event.type)?0:1;groups[Number(event.date.slice(5,7))-1].values[series]++;if(series===0)surveys++;else works++;}
    byId('analyticsActivityInfo').textContent=`${number(surveys)} ${surveys===1?'rilievo':'rilievi'} · ${number(works)} ${works===1?'intervento':'interventi'}`;
    byId('analyticsActivity').innerHTML=groupedChart(groups,[{label:'Rilievi',color:'#397b56'},{label:'Interventi',color:'#7096a0'}],`Rilievi e interventi mensili nel ${activityYear}`);
    const annual=lifeAnnualTotals().slice(0,8).reverse();
    byId('analyticsBalance').innerHTML=annual.length?groupedChart(annual.map(item=>({label:item.year,values:[item.piantumazione,item.abbattimento+item.caduta+item.morte],net:item.piantumazione-item.abbattimento-item.caduta-item.morte})),[{label:'Piantati',color:'#397b56'},{label:'Perdite',color:'#be7861'}],'Bilancio arboreo: piantumazioni e prime perdite datate per anno'):'<div class="analyticsEmpty">Non ci sono ancora piantumazioni o perdite con data registrata.</div>';
    byId('analyticsBalanceInfo').textContent=annual.length?'Saldo indicato sopra ogni anno':'Eventi annuali';
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const view=byId('viewStatistiche'),dashboard=document.createElement('section');dashboard.id='statisticsDashboard';
    dashboard.innerHTML=`<div class="analyticsHeading"><div><span class="analyticsEyebrow">PANORAMICA DELL’ARCHIVIO</span><h2>Il patrimonio, a colpo d’occhio.</h2></div><span class="analyticsCurrent">Situazione attuale</span></div><div id="analyticsMetrics" class="analyticsMetrics"></div><div class="analyticsGrid"><section class="analyticsCard"><header><div><h3>Stato degli alberi</h3><p>Distribuzione sull’intero archivio</p></div></header><div id="analyticsHealth"></div></section><section class="analyticsCard"><header><div><h3>Composizione per specie</h3><p id="analyticsSpeciesInfo"></p></div><div class="analyticsViewToggle" role="group" aria-label="Tipo di grafico specie"><button type="button" data-species-view="bars" aria-pressed="true">Barre</button><button type="button" data-species-view="pie" aria-pressed="false">Torta</button></div></header><div id="analyticsSpecies"></div></section><section class="analyticsCard"><header><div><h3>Completezza del censimento</h3><p>Informazioni disponibili per albero</p></div></header><div id="analyticsCoverage"></div></section><section class="analyticsCard"><header><div><h3>Rilievi e interventi</h3><p id="analyticsActivityInfo"></p></div><label class="analyticsYearLabel">Anno<select id="analyticsActivityYear" aria-label="Anno dei rilievi e interventi"></select></label></header><div id="analyticsActivity"></div></section></div><section class="analyticsCard analyticsAnnual"><header><div><h3>Evoluzione del patrimonio</h3><p id="analyticsBalanceInfo"></p></div><a href="#lifeBalanceCard">Dettaglio annuale ↓</a></header><div id="analyticsBalance"></div></section>`;
    view.prepend(dashboard);
    view.addEventListener('click',event=>{
      const filter=event.target.closest('[data-analytics-filter]');if(filter)applyRegistryFilter(filter.dataset.analyticsFilter,filter.dataset.value);
      const toggle=event.target.closest('[data-species-view]');if(toggle){speciesView=toggle.dataset.speciesView;for(const button of view.querySelectorAll('[data-species-view]'))button.setAttribute('aria-pressed',String(button===toggle));renderStatisticsDashboard();}
    });
    byId('analyticsActivityYear').addEventListener('change',event=>{activityYear=event.target.value;renderStatisticsDashboard();});
  });
})();
