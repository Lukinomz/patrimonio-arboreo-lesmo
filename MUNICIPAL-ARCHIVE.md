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
