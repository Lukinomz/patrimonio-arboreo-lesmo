# Patrimonio comunale

L’app usa l’archivio esistente (`schema: 4`, `trees`, `history`, `photos`) e le
collezioni opzionali `assets` e `workOrders` per arredi, giochi e manutenzione.
Il servizio Apps Script salva il documento JSON completo. Non richiede una
nuova distribuzione per questi aggiornamenti dell’interfaccia.

## Schede e contesto

Alberi, panchine, cestini, aree giochi e giochi hanno tutti il campo
**Via/Località/Parco** (`address`) e le stesse quattro opzioni di Contesto:

- `''`: Nessun contesto
- `strada`: Stradale
- `parco`: Parco o area verde
- `altro`: Altro

`context-options.js` fornisce le opzioni e le etichette condivise. Il caricamento
non converte le schede esistenti. I valori precedenti, compresi vecchi ID o
classificazioni, restano conservati quando la scheda viene salvata senza
cambiare il contesto visualizzato. Giardino e area boschiva sono presentati
nella categoria Parco o area verde; valori non classificabili sono presentati
come Altro. La scelta di un nuovo contesto aggiorna soltanto quella scheda.

## Rimozione della gestione dei parchi

La gestione dedicata dei parchi è stata rimossa: nessuna creazione o modifica
da Admin, associazione manuale o massiva, colonna o filtro Parco, inventario
statistico o livello dedicato sulla mappa. Il campo Parco separato non è più
presente nelle schede. Rileva GPS rimane disponibile.

Eventuali metadati salvati dalle versioni precedenti (`contexts`, `parkId`,
`areaId` e altri campi aggiuntivi) sono conservati passivamente nell’archivio e
nei backup. Non vengono cancellati né usati per assegnare o gestire i parchi.
La lettura dei vecchi metadati serve solo a mostrare correttamente il Contesto
preesistente. I vecchi record di tipo `park`, se presenti, rimangono leggibili
come aree archiviate, senza funzioni di creazione o gestione dedicate.

## Registro, rilievi e salvataggi

`column-filters.js` gestisce i filtri di colonna, selezioni multiple e intervalli.
Filtri, ordinamento, conteggi e CSV usano gli stessi risultati completi prima
della paginazione. Anche su mobile il registro resta una tabella con intestazioni,
scorrimento orizzontale e codice fisso. I tipi di scheda hanno campi dedicati.

Le rilevazioni conservano data, operatore, osservazioni e snapshot. Un rilievo
retrodatato non sostituisce lo stato corrente. Gruppi, fasce boschive, policormici,
misure originali e osservazioni del primo rilievo restano nel formato precedente.
Le nuove visite agli arredi usano eventi `asset_rilievo`.

I salvataggi Drive usano la revisione dell’archivio. In caso di conflitto la
modifica locale viene annullata e la bozza resta disponibile. Backup e ripristino
su Drive, cartella PC e archivio mobile conservano anche i campi aggiuntivi.
Il codice QR contiene soltanto il link all’app e l’ID della scheda; richiede il
normale accesso all’archivio. Il GPS mostra l’accuratezza dichiarata dal dispositivo
e permette di correggere il punto sulla mappa.

## Verifica

`python tests/context-filters-browser.py` usa Chromium PC/iPhone e il vero
`Code.gs` con Drive simulato. Verifica le quattro opzioni esatte, le etichette,
il GPS, l’assenza della gestione parchi e la conservazione di 91 alberi,
rilievi, foto e metadati precedenti. Apertura, filtri e backup non devono produrre
scritture. Le modifiche esplicite alle note non devono cancellare i dati vecchi.
Le altre suite verificano registro, gruppi/policormici, moduli, sincronizzazione,
interventi, backup e amministrazione. Nessuna prova usa il DB condiviso reale.


## Diametro equivalente dei policormici

Il risultato mostrato nei moduli, nelle schede, nel registro e nei riepiloghi
è arrotondato alla decina di centimetri più vicina, senza cifre decimali
(es. 147,6 → 150 cm). I diametri dei fusti, il calcolo √Σd² e i valori salvati
negli snapshot e nei backup conservano la precisione originale. I diametri
degli alberi singoli mantengono la visualizzazione precedente.

## Navigazione e operazioni sul campo

Dopo l’accesso si apre **Patrimonio Arboreo & Urbano**, la panoramica basata
sulle statistiche esistenti, inizialmente su Tutti. Le altre sezioni principali
sono **Anagrafica**, **Censimento e Monitoraggio**, **Mappa** e **Guida**, con
gli stessi nomi su PC e smartphone. La Guida usa i nuovi percorsi.

La categoria selezionata è locale alla sezione: consultare gli arredi in
Anagrafica non cambia il modulo di censimento o le statistiche. Aprire un
albero dalla mappa seleziona il modulo arboreo; dopo il salvataggio di un nuovo
albero si torna al registro degli alberi. Gli interventi appena creati aprono
l’elenco pertinente ai destinatari.

**Archivio e backup** è una sezione dell’area **Admin**, protetta dall’accesso
amministrativo esistente. Sono stati spostati gli stessi elementi e comandi,
conservando collegamenti locali, Drive, backup, ripristino, importazioni,
esportazioni, foto rapide e fotografie da associare. Le schede ordinarie e
le rilevazioni continuano a consentire l’aggiunta di fotografie.

La barra **Livelli / Nuovo elemento** è esterna al piano della mappa. Il menu
Livelli distingue alberi, arredi e giochi e offre **Seleziona tutto** con stato
parziale e **Solo alberi**. I filtri sanitari e l’elenco Da posizionare rimangono
disponibili nello stesso menu. La mappa termina sopra la navigazione mobile,
rendendo utilizzabili zoom, schede e comandi anche su schermi stretti.

`python tests/navigation-map-browser.py` verifica questi percorsi su sei
configurazioni, compreso il telefono in orizzontale. Il backup conserva
91 alberi fittizi, storico, foto, arredi e metadati; navigazione e selezione
dei livelli non scrivono nell’archivio. Le prove dell’area Admin sostituiscono
soltanto nella risposta JavaScript locale il controllo di accesso con una
password di prova, senza estrarre o utilizzare la password dell’app.

L’Anagrafica usa una barra compatta con ricerca, Aggiorna ed Esporta. I dettagli
di Drive sono consultabili in Admin; nel registro i conteggi compaiono una volta
nel piè di tabella. I filtri aggiuntivi e l’ordinamento mobile si aprono con
**Filtri**, mentre le intestazioni mantengono ordinamento e filtri per colonna.
Gli errori di aggiornamento restano visibili. `tests/registry-layout-browser.py`
controlla lo spazio prima della tabella e la presenza dei comandi su PC e telefoni
da 320/390 px, per tutte le categorie, con dati fittizi e sole letture.
