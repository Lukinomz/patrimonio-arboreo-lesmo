# Collegare la cartella Google Drive

L’app pubblicata su GitHub Pages può leggere e scrivere l’archivio condiviso usando una Web App Google Apps Script. Il servizio Drive è già impostato nell’app: il collaboratore apre **il normale link dell’app**, inserisce la password condivisa e preme **Accedi**. Non deve configurare Google, incollare indirizzi tecnici o ricevere link personalizzati. La password è verificata dal servizio Google, non dal solo browser. Non ci sono account individuali: tutti i collaboratori con la password hanno accesso in lettura e scrittura. La password Admin locale dell’app non protegge il servizio Drive.

## Prima attivazione (proprietario della cartella)

1. Crea o scegli una **cartella dedicata** in Google Drive. Conserva l’ID: è la parte dopo `/folders/` nel suo link. Per usare un archivio esistente, nella cartella devono esserci `alberi.json` e la cartella `Foto/` originale, senza nomi duplicati. Non rendere pubblica la cartella: il servizio opera con i permessi del proprietario.
2. Apri <https://script.google.com/home/start>, crea un progetto e sostituisci **tutto** il contenuto predefinito di `Codice.gs` con [Code.gs](Code.gs). Il codice non va inserito dentro `myFunction()`. Salva il file. Non mettere ID o chiavi dentro al codice GitHub.
3. In **Impostazioni progetto → Proprietà script**, aggiungi:
   - `DRIVE_FOLDER_ID`: l’ID della cartella dedicata.
   - `ACCESS_KEY`: la password condivisa, casuale e di almeno 32 caratteri. Nel modulo di accesso dell’app, apri **Prima configurazione e archivio locale** e usa **Genera e copia una nuova chiave**: incolla quanto copiato nel campo **Valore** della proprietà `ACCESS_KEY`. Il pulsante genera la chiave nel browser, senza cambiarla automaticamente sul servizio Google. In alternativa usa un gestore password. Non usare una password personale. Conservala privatamente.
4. Scegli **Distribuisci → Nuova distribuzione → App web**. Imposta **Esegui come: Me** e **Chi può accedere: Chiunque**. Autorizza l’accesso a Drive e copia l’URL che termina con `/exec`. Il codice controlla la chiave sul server prima di accedere ai file. Se l’organizzazione impedisce le Web App accessibili a chiunque, questa modalità richiede una modifica dell’amministratore o una diversa integrazione con accesso Google personale.
5. L’URL `/exec` va impostato **una volta dal manutentore** nella costante `DEFAULT_DRIVE_URL` di `drive-storage.js`, poi pubblicato su GitHub Pages. Per Lesmo è già configurato. Questa URL non è una password e può essere pubblica: la chiave resta esclusivamente nelle proprietà del servizio Google e non deve essere inserita nel codice pubblico.
6. Apri il normale link dell’app e inserisci la password. Se la cartella è nuova, il responsabile può aprire **Prima configurazione e archivio locale** e selezionare **Crea archivio se la cartella è vuota**. La creazione non sovrascrive un archivio comparso nel frattempo.
7. Per i collaboratori condividi il normale link dell’app e comunica separatamente la password. Il pulsante **Copia link dell’app** copia soltanto quell’indirizzo, senza password o parametri di configurazione.

Apps Script può mostrare l’avviso di applicazione non verificata per il progetto personale. Autorizza soltanto il progetto che hai creato e il codice che hai controllato; la richiesta di permesso Drive è per il proprietario. L’ID della cartella limita i file usati dal codice, ma il permesso Google del servizio riguarda Drive: usa un account dedicato se vuoi separarlo dai documenti personali.

Il manifest [appsscript.json](appsscript.json) documenta runtime, fuso orario e permessi. Se gestisci il progetto con `clasp`, usa anche questo file; con l’editor web i permessi vengono rilevati dal codice. Per aggiornare il servizio, modifica la distribuzione esistente selezionando **Nuova versione**, così l’URL resta uguale. Usa **un solo progetto Apps Script** per la cartella: il blocco delle scritture concorrenti è condiviso dalle distribuzioni di quel progetto, non da progetti diversi.

## Spostare l’archivio esistente

Il collegamento apre i dati di Drive: non carica automaticamente quelli del PC o telefono. Puoi copiare `alberi.json` e l’intera cartella `Foto` nell’archivio Drive **prima del primo collegamento**. In alternativa:

1. Dal vecchio archivio esporta un **backup completo con foto**.
2. Collega Drive, quindi usa **Ripristina backup su Drive** nella scheda Google Drive dell’app.
3. Conferma la sostituzione dell’archivio condiviso. L’importazione richiede tutte le immagini e non sovrascrive foto diverse con lo stesso percorso.

## Uso quotidiano e protezione dei dati

- Ogni collaboratore apre lo stesso indirizzo pubblico e inserisce la password nel modulo di accesso. L’app la mantiene in memoria per la pagina aperta senza salvarla nella propria memoria persistente. Il browser può proporre il suo gestore password, controllato dall’utente.
- Una ricarica normale della pagina richiede nuovamente l’accesso. **Esci** torna al modulo della password.
- I vecchi link con chiave nel frammento `#` restano compatibili; l’app rimuove il frammento dall’indirizzo corrente. Per i nuovi inviti usa il normale link e la password separata.
- Quando Drive è collegato, schede, rilievi e fotografie vengono scritti nella cartella condivisa, anche dal telefono. La modalità locale precedente resta disponibile nel modulo di accesso aprendo **Prima configurazione e archivio locale → Apri un archivio locale senza Drive**.
- Per vedere gli aggiornamenti altrui, usa **Aggiorna DB** nella sezione **Alberi / Anagrafica**, oppure nella scheda Drive in Archivio. Rilegge i dati usando la sessione già aperta, senza ricaricare la pagina e senza chiedere di nuovo la password. Se ci sono modifiche non salvate dopo un errore, chiede conferma prima di scartarle; un errore di lettura conserva i dati già caricati e consente di riprovare. Non c’è aggiornamento in tempo reale e non c’è salvataggio offline su Drive.
- Se due persone partono dalla stessa versione, il primo salvataggio riesce. Il secondo viene rifiutato: **nessuna fusione automatica**. Scarica la **copia da recuperare**, ricollega e ripeti le modifiche sulla versione aggiornata. Se non riesci a scaricare la copia, non chiudere la pagina: conserva manualmente le modifiche necessarie. Non importare l’intera copia vecchia sopra l’archivio nuovo per risolvere il conflitto.
- Dopo un errore di rete, il risultato di una scrittura può essere incerto. L’app blocca le scritture successive finché non ricolleghi, evitando sovrascritture alla cieca.
- Prima di ogni sostituzione di `alberi.json`, il server conserva il JSON precedente in `Backup/`. Le immagini originali non vengono eliminate né sovrascritte. I backup JSON non incorporano le foto: per una copia autonoma usa **Crea backup completo**, che scarica JSON e immagini sul dispositivo. La cartella Backup cresce: il proprietario può archiviarne le versioni dopo aver conservato una copia completa.
- Limiti applicativi: JSON fino a 8 MB, singola foto fino a 12 MB. Si applicano anche spazio Drive e quote/tempi di Google Apps Script. Il servizio è pensato per piccoli gruppi, non per traffico pubblico elevato.
- Per revocare l’accesso a chi ha la chiave, cambia `ACCESS_KEY` nelle proprietà script e comunica la nuova solo ai collaboratori autorizzati. Per bloccare tutti, archivia la distribuzione.

## Codici dei nuovi alberi

Quando apri **Nuovo albero**, l’app rilegge prima l’archivio Drive con la sessione già aperta e propone il primo numero libero nel formato `LESMO-A0001`. Con `LESMO-A0001` e `LESMO-A0003` occupati propone `LESMO-A0002`. Anche i codici degli alberi morti o abbattuti ancora in archivio restano occupati. I codici già esistenti, gli identificativi interni, le foto e lo storico non vengono rinumerati.

Il codice si può modificare manualmente. Se è già presente, ignorando differenze tra maiuscole/minuscole e spazi iniziali o finali, il modulo mostra l’errore vicino al campo e non salva. Nella nuova numerazione anche `LESMO-A1` è riconosciuto come `LESMO-A0001`: il numero diverso di zeri non consente di duplicare un codice. Se un’altra persona occupa il codice dopo l’apertura della scheda, il controllo di versione rifiuta il salvataggio: nessun record viene sovrascritto. Ricarica con **Aggiorna DB**, quindi riapri **Nuovo albero**. In assenza di rete l’app non propone un nuovo codice per Drive basandosi soltanto sulla copia vecchia.

## Verifiche dopo la distribuzione Google

Da una sessione di prova crea una scheda con una foto, apri l’app in una seconda sessione e verifica lettura di entrambe. Modifica dalla prima, poi tenta un salvataggio dalla seconda senza ricollegare: deve essere rifiutato. Verifica un backup completo e il rifiuto di una chiave errata. Non condividere il link dell’app come archivio pronto finché queste verifiche sul servizio reale non sono riuscite.

Test locali senza credenziali Google (simulazione dei servizi Google, non prova della distribuzione reale):

```sh
node --test tests/drive-server.test.cjs
python3 tests/drive-browser.py
python3 tests/mobile-dialog.py
```
