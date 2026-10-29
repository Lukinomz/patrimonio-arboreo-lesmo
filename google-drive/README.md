# Collegare la cartella Google Drive

L’app pubblicata su GitHub Pages può leggere e scrivere l’archivio condiviso usando una Web App Google Apps Script. Il proprietario autorizza il servizio sul proprio account Google una volta; i collaboratori inseriscono nell’app l’indirizzo del servizio e una chiave condivisa. Non è un accesso personale con account Google: chi possiede **indirizzo e chiave** può leggere e modificare tutto l’archivio. La password Admin locale dell’app non protegge il servizio Drive.

## Prima attivazione (proprietario della cartella)

1. Crea o scegli una **cartella dedicata** in Google Drive. Conserva l’ID: è la parte dopo `/folders/` nel suo link. Per usare un archivio esistente, nella cartella devono esserci `alberi.json` e la cartella `Foto/` originale, senza nomi duplicati. Non rendere pubblica la cartella: il servizio opera con i permessi del proprietario.
2. Apri <https://script.google.com/home/start>, crea un progetto e copia il contenuto di [Code.gs](Code.gs) nell’editor. Non mettere ID o chiavi dentro al codice GitHub.
3. In **Impostazioni progetto → Proprietà script**, aggiungi:
   - `DRIVE_FOLDER_ID`: l’ID della cartella dedicata.
   - `ACCESS_KEY`: una chiave casuale di almeno 32 caratteri, generata da un gestore password (consigliati 48 o più). Non usare una password personale. Conservala e condividila privatamente con i soli collaboratori. Non inviarla in chat.
4. Scegli **Distribuisci → Nuova distribuzione → App web**. Imposta **Esegui come: Me** e **Chi può accedere: Chiunque**. Autorizza l’accesso a Drive e copia l’URL che termina con `/exec`. Il codice controlla la chiave sul server prima di accedere ai file. Se l’organizzazione impedisce le Web App accessibili a chiunque, questa modalità richiede una modifica dell’amministratore o una diversa integrazione con accesso Google personale.
5. Apri l’app Lesmo → **Archivio → Google Drive**, incolla URL e chiave, poi **Collega Google Drive**. Se la cartella è nuova, seleziona **Crea archivio se la cartella è vuota**. La creazione non sovrascrive un archivio comparso nel frattempo.

Apps Script può mostrare l’avviso di applicazione non verificata per il progetto personale. Autorizza soltanto il progetto che hai creato e il codice che hai controllato; la richiesta di permesso Drive è per il proprietario. L’ID della cartella limita i file usati dal codice, ma il permesso Google del servizio riguarda Drive: usa un account dedicato se vuoi separarlo dai documenti personali.

Il manifest [appsscript.json](appsscript.json) documenta runtime, fuso orario e permessi. Se gestisci il progetto con `clasp`, usa anche questo file; con l’editor web i permessi vengono rilevati dal codice. Per aggiornare il servizio, modifica la distribuzione esistente selezionando **Nuova versione**, così l’URL resta uguale. Usa **un solo progetto Apps Script** per la cartella: il blocco delle scritture concorrenti è condiviso dalle distribuzioni di quel progetto, non da progetti diversi.

## Spostare l’archivio esistente

Il collegamento apre i dati di Drive: non carica automaticamente quelli del PC o telefono. Puoi copiare `alberi.json` e l’intera cartella `Foto` nell’archivio Drive **prima del primo collegamento**. In alternativa:

1. Dal vecchio archivio esporta un **backup completo con foto**.
2. Collega Drive, quindi usa **Ripristina backup su Drive** nella scheda Google Drive dell’app.
3. Conferma la sostituzione dell’archivio condiviso. L’importazione richiede tutte le immagini e non sovrascrive foto diverse con lo stesso percorso.

## Uso quotidiano e protezione dei dati

- Ogni collaboratore usa lo stesso URL e la stessa chiave. La chiave resta solo in memoria nella pagina; dopo una ricarica va reinserita. L’app ricorda solo l’URL, senza parametri o credenziali.
- Quando Drive è collegato, schede, rilievi e fotografie vengono scritti nella cartella condivisa, anche dal telefono. La modalità locale precedente resta disponibile dopo **Scollega**.
- Per vedere gli aggiornamenti altrui, usa **Ricollega / aggiorna**. Non c’è aggiornamento in tempo reale e non c’è salvataggio offline su Drive.
- Se due persone partono dalla stessa versione, il primo salvataggio riesce. Il secondo viene rifiutato: **nessuna fusione automatica**. Scarica la **copia da recuperare**, ricollega e ripeti le modifiche sulla versione aggiornata. Se non riesci a scaricare la copia, non chiudere la pagina: conserva manualmente le modifiche necessarie. Non importare l’intera copia vecchia sopra l’archivio nuovo per risolvere il conflitto.
- Dopo un errore di rete, il risultato di una scrittura può essere incerto. L’app blocca le scritture successive finché non ricolleghi, evitando sovrascritture alla cieca.
- Prima di ogni sostituzione di `alberi.json`, il server conserva il JSON precedente in `Backup/`. Le immagini originali non vengono eliminate né sovrascritte. I backup JSON non incorporano le foto: per una copia autonoma usa **Crea backup completo**, che scarica JSON e immagini sul dispositivo. La cartella Backup cresce: il proprietario può archiviarne le versioni dopo aver conservato una copia completa.
- Limiti applicativi: JSON fino a 8 MB, singola foto fino a 12 MB. Si applicano anche spazio Drive e quote/tempi di Google Apps Script. Il servizio è pensato per piccoli gruppi, non per traffico pubblico elevato.
- Per revocare l’accesso a chi ha la chiave, cambia `ACCESS_KEY` nelle proprietà script e comunica la nuova solo ai collaboratori autorizzati. Per bloccare tutti, archivia la distribuzione.

## Verifiche dopo la distribuzione Google

Da una sessione di prova crea una scheda con una foto, apri l’app in una seconda sessione e verifica lettura di entrambe. Modifica dalla prima, poi tenta un salvataggio dalla seconda senza ricollegare: deve essere rifiutato. Verifica un backup completo e il rifiuto di una chiave errata. Non condividere il link dell’app come archivio pronto finché queste verifiche sul servizio reale non sono riuscite.

Test locali senza credenziali Google (simulazione dei servizi Google, non prova della distribuzione reale):

```sh
node --test tests/drive-server.test.cjs
python3 tests/drive-browser.py
```
