/* Registro: filtri e ordinamento agiscono sull'intero elenco, prima della paginazione. */
(() => {
  'use strict';
  const state = {sort: 'code', direction: 'asc', species: new Set(), address: new Set()};
  const collator = new Intl.Collator('it', {numeric: true, sensitivity: 'base'});
  const labels = {code: 'Identificativo', species: 'Specie', address: 'Via/Località/Parco', status: 'Stato', gps: 'GPS', photos: 'Foto', surveys: 'Rilievi', surveyDate: 'Ultimo rilievo', modified: 'Ultima modifica'};
  const defaults = Object.keys(labels);defaults.splice(3,0,'siteType');
  let columnFilters;
  Object.assign(labels, {scientificName:'Nome scientifico',siteType:'Contesto',placement:'Collocazione',lat:'Latitudine',lon:'Longitudine',height:'Altezza (m)',diameter:'Diametro (cm)',crownDiameter:'Chioma (m)',priority:'Priorità',nextCheck:'Prossima verifica',origin:'Origine',plantDate:'Data piantumazione',created:'Data inserimento',notes:'Note conservate',initialObservationNotes:'Osservazioni primo rilievo',surveyNotes:'Ultime osservazioni',recordType:'Tipo di censimento',treeCount:'Esemplari',countEstimated:'Conteggio stimato',stemCount:'Numero fusti',stemDiameters:'Diametri fusti (cm)',geometry:'Perimetro GeoJSON'});
  const visibleColumns = new Set(defaults);
  const numberFields = new Set(['lat','lon','height','diameter','crownDiameter','photos','surveys','treeCount','stemCount']);
  const dateFields = new Set(['surveyDate','modified','nextCheck','plantDate','created']);
  const byId = id => document.getElementById(id);
  const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it').trim();
  const facetValue = (tree, key) => String(tree[key] || '').trim() || (key === 'species' ? 'Non identificata' : 'Non indicata');
  const dateLabel = date => /^\d{4}-\d{2}-\d{2}/.test(date || '') ? date.slice(0, 10).split('-').reverse().join('/') : '—';

  function records() {
    const counts = new Map();
    for (const photo of photos) if (!photo.removed) counts.set(photo.treeId, (counts.get(photo.treeId) || 0) + 1);
    const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '' : Number(value);
    return trees.map(tree => ({tree,recordType:recordTypeLabel(tree),treeCount:recordQuantity(tree)??'',countEstimated:tree.countEstimated?'Sì':'No',stemCount:tree.stemCount??'',stemDiameters:(tree.stemDiameters||[]).join(' · '),geometry:hasGroupArea(tree)?JSON.stringify(tree.geometry):'',initialObservationNotes:firstObservationNotes(tree),surveyNotes:tree.surveyNotes||'',scientificName: tree.scientificName || '',
      siteType: treeContextLabel(tree),
      placement: tree.placement || '', lat:isValid(tree)?Number(tree.lat):'',lon:isValid(tree)?Number(tree.lon):'',
      height:number(tree.height),diameter:number(tree.diameter),crownDiameter:number(tree.crownDiameter),
      priority:({normal:'Ordinaria',medium:'Media',high:'Alta',urgent:'Urgente'})[tree.priority] || tree.priority || '',
      nextCheck:tree.nextCheck || '',origin:tree.origin === 'planted' ? 'Nuova piantumazione' : tree.origin === 'existing' ? 'Già presente' : '',
      plantDate:tree.plantDate || '',created:(tree.created || '').slice(0,10),notes:tree.notes || '', code: publicCode(tree), species: String(tree.species || '').trim(), address: String(tree.address || '').trim(),
      statusKey: Object.hasOwn(statusName,tree.status) ? tree.status : 'unknown', status: statusName[tree.status] || 'Non valutato', gps: isValid(tree) ? 1 : 0, photos: counts.get(tree.id) || 0,
      surveys: surveyCount(tree.id), surveyDate: lastSurveyDate(tree) || '', modified: (tree.modified || tree.created || '').slice(0, 10),
      search: normalize([publicCode(tree), tree.id, tree.species, tree.scientificName, tree.address, tree.notes,firstObservationNotes(tree),tree.surveyNotes,recordTypeLabel(tree),treeContextLabel(tree)].join(' '))}));
  }
  function criteria() {
    return {tokens: normalize(byId('overviewSearch').value).split(/\s+/).filter(Boolean), status: byId('overviewStatus').value,
      gps: byId('overviewLocation').value, photos: byId('v21PhotoFilter').value};
  }
  function matches(record, filters, except) {
    return filters.tokens.every(token => record.search.includes(token)) &&
      (except === 'status' || filters.status === 'all' || (filters.status === 'attention' ? ['sick','watch','critical'].includes(record.tree.status) : record.statusKey === filters.status)) &&
      (filters.gps === 'all' || record.gps === (filters.gps === 'geo' ? 1 : 0)) &&
      (filters.photos === 'all' || (filters.photos === 'with' ? record.photos > 0 : record.photos === 0)) &&
      ['species', 'address'].every(key => except === key || !state[key].size || state[key].has(facetValue(record.tree, key)));
  }
  function compare(a, b) {
    const av = a[state.sort], bv = b[state.sort];
    // Le informazioni mancanti restano in fondo in entrambe le direzioni.
    if ((av === '') !== (bv === '')) return av === '' ? 1 : -1;
    const difference = typeof av === 'number' ? av - bv : collator.compare(av, bv);
    return difference * (state.direction === 'asc' ? 1 : -1) || collator.compare(a.code, b.code) || collator.compare(a.tree.id, b.tree.id);
  }
  function filteredRows(all, filters) { return all.filter(record => matches(record, filters)&&(!columnFilters||columnFilters.matches(record))).sort(compare); }
  function rerender() {
    overviewPage = 0;
    byId('v21RegistryViewport').scrollTop = 0;
    renderDashboard();
  }
  function sortBy(key, toggle = false) {
    state.direction = toggle ? (state.direction === 'asc' ? 'desc' : 'asc') :
      (['photos', 'surveys', 'surveyDate', 'modified', 'gps'].includes(key) ? 'desc' : 'asc');
    state.sort = key;
    rerender();
  }
  function renderFacet(key, all, filters) {
    const root = document.querySelector(`[data-registry-facet="${key}"]`);
    const counts = new Map();
    for (const record of all) {
      const value = facetValue(record.tree, key);
      if (!counts.has(value)) counts.set(value, 0);
      if (matches(record, filters, key)) counts.set(value, counts.get(value) + 1);
    }
    for (const selected of state[key]) if (!counts.has(selected)) counts.set(selected, 0);
    const search = normalize(root.querySelector('input[type="search"]').value);
    const values = [...counts.keys()].filter(value => normalize(value).includes(search)).sort(collator.compare);
    const active = document.activeElement;
    const focusedValue = root.contains(active) && active.matches('input[type="checkbox"]') ? active.value : null;
    const options = root.querySelector('.registryFacetOptions');
    const signature = JSON.stringify(values);
    if (options.dataset.values !== signature) {
      const scroll = options.scrollTop;
      options.innerHTML = values.map(value => `<label class="registryFacetOption"><input type="checkbox" value="${esc(value)}"/><span>${esc(value)}</span><small></small></label>`).join('') || '<p class="registryNoOptions">Nessuna corrispondenza</p>';
      options.dataset.values = signature;
      options.scrollTop = scroll;
      if (focusedValue !== null) [...options.querySelectorAll('input')].find(input => input.value === focusedValue)?.focus({preventScroll: true});
    }
    for (const input of options.querySelectorAll('input')) {
      input.checked = state[key].has(input.value);
      input.disabled = !counts.get(input.value) && !input.checked;
      input.closest('label').querySelector('small').textContent = counts.get(input.value);
    }
    root.querySelector('.registryFacetValue').textContent = !state[key].size ? (key === 'species' ? 'Tutte le specie' : 'Tutte le vie') :
      state[key].size === 1 ? [...state[key]][0] : `${state[key].size} ${key === 'species' ? 'specie selezionate' : 'vie selezionate'}`;
    root.classList.toggle('isFiltered', state[key].size > 0);
  }
  function renderFilterChips(filters) {
    const chips = [];
    const add = (key, value, label) => chips.push(`<button type="button" data-registry-remove="${key}" data-value="${esc(value)}" aria-label="Rimuovi filtro: ${esc(label)}">${esc(label)}<span aria-hidden="true">×</span></button>`);
    if (byId('overviewSearch').value.trim()) add('overviewSearch', '', `Ricerca: ${byId('overviewSearch').value.trim()}`);
    for (const [id, label] of [['overviewStatus', 'Stato'], ['overviewLocation', 'Posizione'], ['v21PhotoFilter', 'Foto']]) {
      const select = byId(id);
      if (select.value !== 'all') add(id, '', `${label}: ${select.selectedOptions[0].dataset.label || select.selectedOptions[0].textContent}`);
      select.closest('label').classList.toggle('isFiltered', select.value !== 'all');
    }
    for (const key of ['species', 'address']) for (const value of state[key]) add(key, value, `${key === 'species' ? 'Specie' : 'Via'}: ${value}`);
    const box = byId('registryActiveFilters');
    box.innerHTML = chips.join(''); box.hidden = !chips.length;
    byId('v21ResetFilters').disabled = !chips.length&&!columnFilters?.hasFilters();
  }
  function renderSort() {
    const ascending = state.direction === 'asc';
    for (const button of document.querySelectorAll('[data-registry-sort]')) {
      const active = button.dataset.registrySort === state.sort;
      button.closest('th').setAttribute('aria-sort', active ? (ascending ? 'ascending' : 'descending') : 'none');
      button.querySelector('.registrySortIcon').textContent = active ? (ascending ? '↑' : '↓') : '↕';
      button.setAttribute('aria-label', `${labels[button.dataset.registrySort]}: ${active ? `ordina in senso ${ascending ? 'decrescente' : 'crescente'}` : 'ordina'}`);
    }
    byId('v21Sort').value = state.sort;
    byId('registrySortDirection').textContent = ascending ? '↑' : '↓';
    byId('registrySortDirection').setAttribute('aria-label', `Ordina in senso ${ascending ? 'decrescente' : 'crescente'}`);
    const direction = ['code', 'species', 'address', 'status'].includes(state.sort) ? (ascending ? 'A–Z' : 'Z–A') :
      ['surveyDate', 'modified'].includes(state.sort) ? (ascending ? 'meno recenti prima' : 'più recenti prima') :
      state.sort === 'gps' ? (ascending ? 'senza GPS prima' : 'con GPS prima') : (ascending ? 'crescente' : 'decrescente');
    byId('registryOrder').textContent = `${labels[state.sort]} · ${direction}`;
  }
  window.renderRegistryTable = function () {
    if(!columnFilters){
      const columns=Object.fromEntries(Object.entries(labels).map(([key,label])=>[key,{label,type:numberFields.has(key)?'number':dateFields.has(key)?'date':'text'}]));
      columns.siteType={label:'Contesto',context:true,value:row=>municipalContextId(row.tree),format:municipalAreaName};columns.gps.format=value=>value==='1'?'Con GPS':'Senza GPS';
      columnFilters=RegistryFilters.create({id:'trees',columns,getRows:records,baseMatch:row=>matches(row,criteria()),onChange:()=>{overviewPage=0;renderDashboard();}});
      const quick=document.createElement('button');quick.id='registryContextFilter';quick.className='columnQuickFilter';const box=document.createElement('label');box.className='registryField';box.innerHTML='<span class="registryFieldLabel">Contesto</span>';box.appendChild(quick);byId('overviewStatus').closest('label').insertAdjacentElement('afterend',box);columnFilters.quickButton(quick,'siteType','Tutti i contesti');
      const status=document.createElement('button');status.id='registryStatusFilter';byId('overviewStatus').hidden=true;byId('overviewStatus').insertAdjacentElement('afterend',status);columnFilters.quickButton(status,'status','Tutte le condizioni');
      const chips=document.createElement('div');chips.id='registryColumnFilterChips';chips.className='columnFilterChips';byId('registryActiveFilters').insertAdjacentElement('afterend',chips);
    }
    const all = records(), filters = criteria(), hits = filteredRows(all, filters);
    const maxPage = Math.max(1, Math.ceil(hits.length / perPage));
    overviewPage = Math.max(0, Math.min(overviewPage, maxPage - 1));
    const offset = overviewPage * perPage, visible = hits.slice(offset, offset + perPage);
    const columns = Object.keys(labels).filter(key => visibleColumns.has(key));
    const signature = columns.join('|');
    const table = byId('overviewTable');
    if (table.dataset.columns !== signature) {
      table.querySelector('thead tr').innerHTML = columns.map(key => `<th scope="col" aria-sort="none"><button type="button" data-registry-sort="${key}">${esc(labels[key])}<span class="registrySortIcon" aria-hidden="true">↕</span></button></th>`).join('') + '<th scope="col" class="registryActionsHead">Azioni</th>';
      table.dataset.columns = signature;
    }
    const cell = (record, key) => {
      const t = record.tree;
      if (key === 'code') return `<button class="codeLink" data-tree="${esc(t.id)}">${esc(record.code)}</button>${record.tree.recordType&&record.tree.recordType!=='single'?`<small class="registryRecordType">${esc(recordTypeLabel(record.tree))}${['group','woodland'].includes(record.tree.recordType)?` · ${record.tree.countEstimated?'≈ ':''}${recordQuantity(record.tree)??'?'} esemplari`:''}</small>`:''}`;
      if (key === 'status') return statusChip(t);
      if (key === 'gps') return record.gps ? `<button class="tinyBtn" data-goto="${esc(t.id)}" aria-label="Apri ${esc(record.code)} sulla mappa">⌖ Mappa</button><button class="tinyBtn" data-street="${esc(t.id)}" title="Street View" aria-label="Street View per ${esc(record.code)}">SV ↗</button>` : '<span class="registryMissing">Da posizionare</span>';
      if (dateFields.has(key)) return dateLabel(record[key]);
      if (key === 'diameter') return formatTreeDiameter(record[key],t);
      if (numberFields.has(key)) return record[key] === '' ? '—' : record[key].toLocaleString('it-IT', {maximumFractionDigits: key === 'lat' || key === 'lon' ? 7 : 2});
      return esc(record[key] || (key === 'species' ? 'Non identificata' : '—'));
    };
    byId('overviewRows').innerHTML = visible.map(record => '<tr>' + columns.map(key => `<td class="${numberFields.has(key) ? 'registryNumber' : dateFields.has(key) ? 'registryDate' : key === 'gps' ? 'registryGps' : ''}" ${key === 'notes' ? `title="${esc(record.notes)}"` : ''}>${cell(record,key)}</td>`).join('') + `<td class="registryActions"><button class="tinyBtn" type="button" data-registry-edit="${esc(record.tree.id)}" aria-label="Modifica anagrafica ${esc(record.code)}">Modifica</button></td></tr>`).join('') || `<tr><td colspan="${columns.length + 1}"><div class="registryEmpty"><strong>${all.length ? 'Nessuna scheda corrisponde ai filtri' : 'Nessuna scheda registrata'}</strong>${all.length ? '<button class="btn" type="button" data-registry-reset>Azzera filtri</button>' : '<span>Usa “Nuovo albero” per aggiungere la prima scheda.</span>'}</div></td></tr>`;
    byId('registryColumnsCount').textContent = `Colonne ${columns.length}/${Object.keys(labels).length}`;
    const range = hits.length ? `${offset + 1}–${offset + visible.length}` : '0';
    byId('registrySummary').textContent = `${hits.length.toLocaleString('it-IT')} di ${all.length.toLocaleString('it-IT')} schede`;
    byId('overviewCount').textContent = `${range} di ${hits.length.toLocaleString('it-IT')} risultati`;
    byId('pageInfo').textContent = `Pagina ${overviewPage + 1} di ${maxPage}`;
    byId('prevPage').disabled = overviewPage === 0;
    byId('nextPage').disabled = overviewPage >= maxPage - 1;
    byId('downloadTable').disabled = !hits.length;
    for (const key of ['species', 'address']) renderFacet(key, all, filters);
    const statusCounts = new Map();
    for (const record of all) if (matches(record, filters, 'status')) statusCounts.set(record.statusKey, (statusCounts.get(record.statusKey) || 0) + 1);
    for (const option of byId('overviewStatus').options) {
      if (option.value === 'all') continue;
      option.dataset.label ||= option.textContent;
      const count = option.value === 'attention' ? ['sick','watch','critical'].reduce((sum,key)=>sum+(statusCounts.get(key)||0),0) : statusCounts.get(option.value) || 0;
      option.textContent = `${option.dataset.label} (${count})`;
      option.disabled = !count && option.value !== filters.status;
    }
    renderFilterChips(filters); renderSort();columnFilters.headers(table,'data-registry-sort');columnFilters.chips(byId('registryColumnFilterChips'));
  };
  window.resetRegistryFilters = function (options={}) {
    columnFilters?.reset(options);
    for (const id of ['overviewStatus', 'overviewLocation', 'v21PhotoFilter']) byId(id).value = 'all';
    byId('overviewSearch').value = '';
    state.species.clear(); state.address.clear();
    for (const input of document.querySelectorAll('.registryFacetPanel input[type="search"]')) input.value = '';
    rerender();
  };
  window.exportRegistryResults = function () {
    const rows = filteredRows(records(), criteria());
    if (!rows.length) return;
    const quote = value => {
      let text = String(value ?? '');
      if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const columns = Object.keys(labels);
    const header = columns.map(key => labels[key]);
    const data = rows.map(record => columns.map(key => key === 'gps' ? (record.gps ? 'Con GPS' : 'Senza GPS') : record[key]));
    fileDownload('alberi_filtrati_lesmo.csv', '\ufeff' + [header, ...data].map(row => row.map(quote).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
    tell(`${rows.length} alberi esportati`);
  };
  window.applyRegistryFilter = function(key,value){resetRegistryFilters({preserveContext:true});if(key==='species')state.species.add(value);else if(key)byId(key).value=value;rerender();switchSection('anagrafica');document.querySelector('.v21Registry').scrollIntoView({block:'start'});};
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('.v21Registry');
    byId('overviewSearch').addEventListener('input', rerender);
    for (const id of ['overviewStatus', 'overviewLocation', 'v21PhotoFilter']) byId(id).addEventListener('change', rerender);
    for (const facet of root.querySelectorAll('[data-registry-facet]')) {
      const key = facet.dataset.registryFacet;
      facet.querySelector('input[type="search"]').addEventListener('input', () => renderFacet(key, records(), criteria()));
      facet.addEventListener('change', event => {
        if (event.target.type !== 'checkbox') return;
        if (event.target.checked) state[key].add(event.target.value); else state[key].delete(event.target.value);
        rerender();
      });
      facet.addEventListener('toggle', () => {
        if (!facet.open) return;
        for (const other of root.querySelectorAll('[data-registry-facet]')) if (other !== facet) other.open = false;
      });
    }
    for (const [key,label] of Object.entries(labels)) {
      const option = document.createElement('option'); option.value=key; option.textContent=label;
      if (!defaults.includes(key)) byId('v21Sort').appendChild(option);
    }
    byId('registryColumnOptions').innerHTML = Object.entries(labels).map(([key,label]) => `<label><input type="checkbox" value="${key}" ${visibleColumns.has(key)?'checked':''} ${key === 'code'?'disabled':''}/> ${esc(label)}</label>`).join('');
    byId('registryColumnOptions').addEventListener('change', event => {
      if(event.target.checked)visibleColumns.add(event.target.value);else visibleColumns.delete(event.target.value);
      renderDashboard();
    });
    root.addEventListener('click', event => {
      const edit = event.target.closest('[data-registry-edit]');
      if(edit){const tree=trees.find(tree=>tree.id===edit.dataset.registryEdit);if(tree)v2OpenAnag(tree);}
      const preset=event.target.closest('[data-registry-columns]');
      if(preset){visibleColumns.clear();for(const key of preset.dataset.registryColumns === 'all' ? Object.keys(labels) : defaults)visibleColumns.add(key);for(const input of byId('registryColumnOptions').querySelectorAll('input'))input.checked=visibleColumns.has(input.value);renderDashboard();}

      const sort = event.target.closest('[data-registry-sort]');
      if (sort) sortBy(sort.dataset.registrySort, state.sort === sort.dataset.registrySort);
      const chip = event.target.closest('[data-registry-remove]');
      if (chip) {
        const key = chip.dataset.registryRemove;
        if (key === 'species' || key === 'address') state[key].delete(chip.dataset.value);
        else byId(key).value = key === 'overviewSearch' ? '' : 'all';
        rerender();
      }
      if (event.target.closest('[data-registry-reset]')) resetRegistryFilters();
    });
    byId('v21Sort').addEventListener('change', event => sortBy(event.target.value));
    byId('registrySortDirection').addEventListener('click', () => sortBy(state.sort, true));
    document.addEventListener('click', event => {
      for (const facet of root.querySelectorAll('[data-registry-facet][open]')) if (!facet.contains(event.target)) facet.open = false;
    });
    const columnMenu=root.querySelector('.registryColumns');
    document.addEventListener('click',event=>{if(!columnMenu.contains(event.target))columnMenu.open=false;});
    columnMenu.addEventListener('keydown',event=>{if(event.key==='Escape'){columnMenu.open=false;columnMenu.querySelector('summary').focus();event.preventDefault();event.stopPropagation();}});
    root.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const facet = event.target.closest('[data-registry-facet]');
      if (facet?.open) { facet.open = false; facet.querySelector('summary').focus(); event.preventDefault(); event.stopPropagation(); }
    });
    root.addEventListener('focusout', () => {
      setTimeout(() => {
        for (const facet of root.querySelectorAll('[data-registry-facet][open]')) if (!facet.contains(document.activeElement)) facet.open = false;
      }, 0);
    });
  });
})();
