# Patrimonio comunale

L’archivio esistente mantiene `schema: 4`, `trees`, `history` e `photos`.
Le collezioni opzionali `assets` e `workOrders` aggiungono arredi, aree e giochi,
e i relativi interventi. I file precedenti si aprono senza conversioni.
Il servizio Apps Script salva l’intero documento JSON: questa estensione non
richiede una nuova distribuzione del servizio. Ricaricare l’app sui dispositivi
prima di utilizzare le nuove categorie.

`municipal-data.js` valida e conserva le estensioni e gli eventuali campi
aggiuntivi alla radice del documento. Tutti i percorsi di apertura, salvataggio,
backup e ripristino (Drive, cartella PC e archivio mobile) mantengono questi dati.
I salvataggi condivisi usano la revisione Drive già esistente. In caso di errore
la modifica locale viene annullata e la bozza del modulo resta disponibile;
il recupero Drive conserva la copia che si è tentato di salvare.

## Schede e relazioni

- `trees[]`: dati arborei, gruppi e policormici esistenti; `areaId` e
  `positionMeta` sono opzionali.
- `assets[]`: `id`, `code`, `assetKind`, `name`, `condition`; i tipi sono `bench`,
  `bin`, `playground_area`, `equipment`, `park`. Ogni tipo ha i propri campi.
- `areaId`: riferimento a un parco o a un’area giochi; le aree possono contenere
  alberi, arredi e giochi. I cicli sono rifiutati.
- `geometry`: perimetro GeoJSON Polygon, con la stessa validazione delle aree
  arboree. Il disegno non salva finché non viene salvata la scheda.
- `positionMeta`: fonte (`gps` / `manual`), data di acquisizione e accuratezza
  GPS in metri. Una correzione manuale non conserva l’accuratezza GPS.
- `workOrders[]`: scheda associata, titolo, assegnatario, priorità, scadenza,
  stato e aggiornamenti datati. Le foto hanno `orderId` e `stage` prima/dopo.

Le nuove visite agli arredi sono eventi `asset_rilievo`, con data, operatore,
osservazioni e snapshot. I rilievi arborei conservano i propri tipi e le proprie
misure. Un rilievo retrodatato viene conservato senza sostituire i dati correnti.
È possibile consultare e riprendere esplicitamente i valori di una visita
precedente; la visita originale non viene modificata.

Le etichette QR contengono solo il link all’app e l’ID della scheda. L’accesso
all’archivio richiede la normale autenticazione. La libreria QR è inclusa in
`vendor/`, con licenza MIT. Non viene inviato il contenuto delle schede ad altri
servizi per generare i codici.

## Verifica

`python tests/municipal-browser.py` usa Chromium con viewport PC/iPhone e il
vero `Code.gs` eseguito con Drive simulato. Copre aree, collegamenti, foto,
inserimenti simili, rilievi retrodatati, riferimenti storici, esportazione,
interventi multipli, completamento, QR, backup/ripristino, GPS simulato e conflitti.
Le suite preesistenti verificano le funzioni arboree, la sincronizzazione,
l’amministrazione e i moduli mobile.

Il GPS assistito campiona per un massimo di 20 secondi, propone il fix recente
con minore incertezza dichiarata e richiede una scelta esplicita dell’utente.
Non modifica la precisione del ricevitore. Le prove automatiche simulano il GPS;
il comportamento reale dipende dal dispositivo, dai permessi e dalla ricezione.
L’offline completo resta una fase separata.


## Contesti esistenti e filtri (novembre 2026)

Il campo `siteType` già presente nelle schede viene letto anche dai filtri del
registro misto. L’elenco dei contesti comprende i valori preesistenti e i vecchi
collegamenti `areaId`. Il caricamento non riscrive alberi, misure, note, foto o
snapshot delle rilevazioni. Una collezione opzionale `contexts` conserva nomi,
identificativi e alias del catalogo. I riferimenti testuali precedenti restano
riconosciuti anche dopo una rinomina da Admin. L’associazione di una nuova scheda
usa il medesimo campo Contesto; “Area di appartenenza” non è più un secondo
campo nell’interfaccia. Il servizio Drive e i backup mantengono il catalogo.

Le modifiche al catalogo si eseguono da Admin → Contesti. Le altre persone possono
selezionare i contesti esistenti e consultarne l’inventario. La protezione usa la
sessione amministratore già presente nell’app.

`column-filters.js` condivide il comportamento fra registro arboreo e registro
misto: filtri sulle intestazioni, selezioni multiple per tipo/condizione/contesto,
intervalli numerici e date, azzeramento, conteggi ed esportazione degli stessi
risultati prima della paginazione. I registri su mobile mantengono una vera
struttura tabellare con scorrimento orizzontale, intestazioni e codice fissi.

`python tests/context-filters-browser.py` verifica un archivio simulato con 91
alberi, gruppo di 50, contesti testuali preesistenti, grafie diverse di Marconi,
rilievi e una foto: le schede e lo storico originali vengono confrontati per
uguaglianza completa dopo filtri, esportazioni, modifica del solo catalogo,
riapertura e backup. Nessun dato del DB condiviso reale viene usato nelle prove.
Le grafie diverse delle vie non vengono unite automaticamente.


### Parchi: associazione manuale

Il Contesto preesistente (`siteType`) rimane distinto dal parco specifico.
Il nuovo campo opzionale `parkId` viene impostato soltanto quando l’utente
sceglie un parco nella scheda o conferma un’assegnazione dalla tabella.
Il caricamento non deduce alcun parco dal Contesto, dalla via o dal GPS:
le 91 schede già esistenti restano senza associazione al parco finché non
vengono selezionate esplicitamente. Il Contesto originario e gli snapshot
precedenti restano conservati anche durante l’assegnazione del parco.

Contesto e Parco hanno filtri distinti a selezione multipla. L’inventario dei
parchi conta soltanto le associazioni esplicite a `parkId`. Il test dei 91
censimenti verifica anche un’assegnazione manuale di due schede (un gruppo
con 50 esemplari e un singolo), lasciando identici gli altri 89 alberi e tutti
i rilievi precedenti.
