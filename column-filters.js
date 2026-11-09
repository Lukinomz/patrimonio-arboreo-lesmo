/* Filtri di colonna condivisi: selezioni multiple, intervalli, contesti e CSV usano gli stessi risultati. */
(() => {
  'use strict';
  const instances=new Map(), empty=()=>({values:new Set(),text:'',min:'',max:''});
  let context=empty(),park=empty(),popup=null,trigger=null;
  const norm=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('it').trim();
  const raw=value=>value==null?'':String(value);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const active=state=>state.values.size||state.text||state.min!==''||state.max!=='';
  function close(){popup?.remove();popup=null;trigger?.setAttribute('aria-expanded','false');if(trigger?.isConnected)trigger.focus({preventScroll:true});trigger=null;}
  window.RegistryFilters={
    contextMatches(value){return !context.values.size||context.values.has(raw(value));},
    parkMatches(value){return !park.values.size||park.values.has(raw(value));},
    get parkValues(){return new Set(park.values);},
    setParks(values){park={...empty(),values:new Set(values)};window.renderDashboard?.();},
    get contextValues(){return new Set(context.values);},
    setContexts(values){context={...empty(),values:new Set(values)};window.renderDashboard?.();},
    create({id,columns,getRows,onChange,baseMatch=()=>true}){
      const filters=new Map(),quick=new Map();
      const config=key=>({label:key,type:'text',...columns[key]});
      const state=key=>config(key).context?context:config(key).park?park:filters.get(key)||empty();
      const value=(row,key)=>raw(config(key).value?config(key).value(row):row[key]);
      const label=(key,val)=>val===''?'(Non indicato)':config(key).format?config(key).format(val):val;
      function matches(row,skip){
        return Object.keys(columns).every(key=>{
          if(key===skip)return true;
          const s=state(key),v=value(row,key),type=config(key).type;
          if(s.values.size&&!s.values.has(v)||s.text&&!norm(v).includes(norm(s.text)))return false;
          if(s.min!==''||s.max!==''){
            if(v==='')return false;const number=type==='number'?Number(v):v;
            if(s.min!==''&&number<(type==='number'?Number(s.min):s.min)||s.max!==''&&number>(type==='number'?Number(s.max):s.max))return false;
          }
          return true;
        });
      }
      function commit(key,next){if(config(key).context)context=next;else if(config(key).park)park=next;else filters.set(key,next);close();onChange();}
      function open(key,button){
        close();trigger=button;const c=config(key),s=state(key),draft={...s,values:new Set(s.values)};
        popup=document.createElement('div');popup.id='columnFilterPopup';popup.className='columnFilterPopup';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Filtra '+c.label);
        popup.innerHTML=`<header><strong>Filtra ${escape(c.label)}</strong><button type="button" data-cf-close aria-label="Chiudi filtro">×</button></header>${['number','date'].includes(c.type)?`<div class="cfRange"><label>Da<input data-cf-min type="${c.type==='date'?'date':'number'}" step="any" value="${escape(s.min)}"/></label><label>A<input data-cf-max type="${c.type==='date'?'date':'number'}" step="any" value="${escape(s.max)}"/></label></div>`:''}<input data-cf-search type="search" placeholder="Cerca valori…" aria-label="Cerca valori di ${escape(c.label)}"/><div class="cfSelection"><button type="button" data-cf-all>Seleziona risultati</button><button type="button" data-cf-none>Deseleziona</button></div><div class="cfChoices"></div><p class="cfSelectionInfo" aria-live="polite"></p><footer><button type="button" data-cf-clear>Rimuovi filtro</button><button type="button" data-cf-apply>Applica</button></footer>`;
        document.body.appendChild(popup);button.setAttribute('aria-expanded','true');button.setAttribute('aria-controls',popup.id);
        const counts=new Map();for(const row of getRows().filter(row=>baseMatch(row)&&matches(row,key))){const v=value(row,key);counts.set(v,(counts.get(v)||0)+1);}for(const v of [...s.values,...(c.choices?.()||[])])if(!counts.has(v))counts.set(v,0);
        let visible=[];
        function render(){
          const term=norm(popup.querySelector('[data-cf-search]').value);
          visible=[...counts.keys()].filter(v=>norm(label(key,v)).includes(term)).sort((a,b)=>label(key,a).localeCompare(label(key,b),'it',{numeric:true}));
          popup.querySelector('.cfChoices').innerHTML=visible.slice(0,150).map(v=>`<label><input type="checkbox" value="${escape(v)}" ${draft.values.has(v)?'checked':''}/><span>${escape(label(key,v))}</span><small>${counts.get(v)}</small></label>`).join('')||'<p>Nessun valore disponibile.</p>';
          popup.querySelector('.cfSelectionInfo').textContent=`${draft.values.size?draft.values.size+' selezionati':'Tutti i valori'}${visible.length>150?' · affina la ricerca per vedere tutti i valori':''}`;
        }
        popup.querySelector('[data-cf-search]').oninput=render;
        popup.querySelector('.cfChoices').onchange=e=>{if(e.target.checked)draft.values.add(e.target.value);else draft.values.delete(e.target.value);popup.querySelector('.cfSelectionInfo').textContent=draft.values.size?`${draft.values.size} selezionati`:'Tutti i valori';};
        popup.querySelector('[data-cf-all]').onclick=()=>{visible.forEach(v=>draft.values.add(v));render();};popup.querySelector('[data-cf-none]').onclick=()=>{draft.values.clear();render();};
        popup.querySelector('[data-cf-close]').onclick=close;popup.querySelector('[data-cf-clear]').onclick=()=>commit(key,empty());
        popup.querySelector('[data-cf-apply]').onclick=()=>{
          draft.min=popup.querySelector('[data-cf-min]')?.value||'';draft.max=popup.querySelector('[data-cf-max]')?.value||'';
          if(draft.min!==''&&draft.max!==''&&(c.type==='number'?Number(draft.min)>Number(draft.max):draft.min>draft.max)){popup.querySelector('.cfSelectionInfo').textContent='Il valore Da deve precedere il valore A.';return;}
          commit(key,draft);
        };
        render();const rect=button.getBoundingClientRect();
        if(innerWidth>740){popup.style.left=Math.max(8,Math.min(rect.left,innerWidth-340))+'px';popup.style.top=Math.max(8,Math.min(rect.bottom+5,innerHeight-popup.offsetHeight-8))+'px';}
        popup.querySelector(innerWidth>740?'[data-cf-search]':'[data-cf-close]').focus({preventScroll:true});
      }
      function quickButton(button,key,allLabel){quick.set(key,{button,allLabel});button.type='button';button.classList.add('columnQuickFilter');button.dataset.quickFilter=key;button.onclick=()=>open(key,button);update();}
      function update(){
        for(const [key,{button,allLabel}] of quick){const s=state(key);button.textContent=s.values.size===1?label(key,[...s.values][0]):s.values.size?`${s.values.size} selezionati`:active(s)?'Intervallo attivo':allLabel;button.classList.toggle('filtered',!!active(s));button.setAttribute('aria-label',`${config(key).label}: ${button.textContent}`);}
      }
      function headers(table,attribute){
        for(const sort of table.querySelectorAll(`[${attribute}]`)){
          const key=sort.getAttribute(attribute);if(!columns[key])continue;const th=sort.closest('th');th.dataset.columnKey=key;
          let button=th.querySelector('.columnFilterButton');if(!button){button=document.createElement('button');button.type='button';button.className='columnFilterButton';button.innerHTML='<svg aria-hidden="true" width="15" height="15" viewBox="0 0 20 20"><path d="M3 4h14l-5.5 6v5l-3 2v-7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';button.onclick=e=>{e.stopPropagation();open(key,button);};th.appendChild(button);}
          button.classList.toggle('filtered',!!active(state(key)));button.setAttribute('aria-label','Filtra '+config(key).label);button.setAttribute('title','Filtra '+config(key).label);button.setAttribute('aria-haspopup','dialog');
        }
        update();
      }
      function chips(container){
        container.replaceChildren();for(const key of Object.keys(columns)){const s=state(key);if(!active(s))continue;const button=document.createElement('button');button.type='button';const selected=s.values.size===1?label(key,[...s.values][0]):s.values.size?`${s.values.size} selezionati`:`${s.min||'…'} – ${s.max||'…'}`;button.textContent=`${config(key).label}: ${selected} ×`;button.onclick=()=>commit(key,empty());container.appendChild(button);}container.hidden=!container.childElementCount;
      }
      const api={matches,headers,quickButton,open,update,chips,hasFilters:()=>Object.keys(columns).some(key=>active(state(key))),reset({preserveContext=false}={}){filters.clear();if(!preserveContext){context=empty();park=empty();}update();}};
      instances.set(id,api);return api;
    },
    get:id=>instances.get(id)
  };
  document.addEventListener('pointerdown',e=>{if(popup&&!popup.contains(e.target)&&!trigger?.contains(e.target))close();});
  document.addEventListener('keydown',e=>{if(popup&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}},true);
})();
