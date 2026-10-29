"""Browser + vero Code.gs con servizi Google simulati. Nessuna credenziale reale."""
import base64
import functools
import http.server
import json
import pathlib
import re
import subprocess
import threading
import urllib.request
import urllib.parse

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
KEY = "test-only-key-not-for-production-0123456789"
ENDPOINT = re.search(r"const DEFAULT_DRIVE_URL = '([^']+)'", (ROOT / "drive-storage.js").read_text()).group(1)
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    service = subprocess.Popen(["node", str(ROOT / "tests/drive-runtime.cjs")], stdout=subprocess.PIPE, text=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}"
    try:
        assert service.stdout.readline().strip() == "Drive test runtime ready"
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
            errors = []

            def new_page(mobile=False, access_fragment=None):
                context = browser.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1280, "height": 900})
                context.add_init_script("Object.defineProperty(navigator, 'clipboard', {value: {writeText: async text => { window.testCopiedText = text; }}})")

                def bridge(route):
                    if route.request.url == ENDPOINT:
                        assert route.request.method == "POST"
                        assert route.request.headers["content-type"].startswith("text/plain")
                        request = urllib.request.Request("http://127.0.0.1:8766/", data=route.request.post_data.encode(), headers={"Content-Type": "text/plain"})
                        with urllib.request.urlopen(request) as response:
                            route.fulfill(status=200, content_type="application/json", body=response.read())
                    elif route.request.url.startswith(url):
                        route.continue_()
                    else:
                        route.abort()

                context.route("**/*", bridge)
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("dialog", lambda dialog: dialog.accept())
                assert page.goto(url + ("/?mobile=1" if mobile else "/") + (access_fragment or "")).status == 200
                if mobile:
                    page.wait_for_function("mArchiveReady")
                if access_fragment:
                    page.wait_for_function("document.body.classList.contains('driveConnected') || document.getElementById('driveFeedback').textContent.length > 0")
                else:
                    assert page.locator("#driveAccess").is_visible()
                    assert page.locator("#driveURL").input_value() == ENDPOINT
                    assert page.locator("#driveURL").is_hidden()
                    assert page.locator("#driveKey").is_visible()
                    assert page.locator("#driveSetup").evaluate("e => !e.open")
                return page

            def connect(page, create=False, key=KEY):
                page.locator("#driveKey").fill(key)
                if create:
                    page.locator("#driveSetup").evaluate("e => e.open = true")
                    page.locator("#driveCreate").check()
                page.locator("#driveConnect").click()
                page.wait_for_function("document.body.classList.contains('driveConnected') || document.getElementById('driveFeedback').textContent.length > 0")
                if page.evaluate("document.body.classList.contains('driveConnected')"):
                    assert page.locator("#driveAccess").is_hidden()
                    assert not page.locator("#app").evaluate("e => e.inert")
                    page.evaluate("switchSection('archivio')")

            desktop = new_page()
            desktop.locator("#driveSetup").evaluate("e => e.open = true")
            desktop.locator("#driveGenerate").click()
            generated_key = desktop.locator("#driveKey").input_value()
            assert len(generated_key) == 32
            assert desktop.evaluate("window.testCopiedText") == generated_key
            assert generated_key not in desktop.evaluate("JSON.stringify(localStorage)")
            print("PASS: generazione e copia di una chiave da 32 caratteri senza persistenza")
            connect(desktop, key="incorrect-key-at-least-thirty-two-characters")
            desktop.wait_for_function("document.getElementById('driveFeedback').textContent.includes('Password')")
            assert desktop.evaluate("folderHandle === null")
            connect(desktop)
            desktop.wait_for_function("document.getElementById('driveFeedback').textContent.includes('non contiene')")
            connect(desktop, create=True)
            desktop.wait_for_function("document.body.classList.contains('driveConnected')")
            assert desktop.locator("#driveKey").input_value() == ""
            assert desktop.evaluate("localStorage.getItem('LesmoDriveEndpoint')") == ENDPOINT
            assert KEY not in desktop.evaluate("JSON.stringify(localStorage)")
            print("PASS: chiave errata rifiutata, creazione solo esplicita, chiave non persistita")

            desktop.evaluate("v2OpenAnag(null)")
            desktop.locator("#v2AnaCode").fill("DRIVE-TEST-1")
            desktop.locator("#v2AnaSpecies").fill("Tiglio")
            desktop.locator("#v21InitialDate").fill("2026-10-29")
            desktop.locator("#v2AnaPhotoFiles").set_input_files({"name": "test.png", "mimeType": "image/png", "buffer": PNG})
            desktop.wait_for_function("v2AnaPhotos.length === 1")
            desktop.locator("#v2AnaSave").click()
            desktop.wait_for_function("trees.length === 1 && photos.length === 1 && !v2AnagBusy")
            mobile = new_page(mobile=True)
            connect(mobile)
            mobile.wait_for_function("document.body.classList.contains('driveConnected')")
            assert mobile.evaluate("trees[0].code") == "DRIVE-TEST-1"
            image = mobile.evaluate("async () => { const f = await (await filePathHandle(photos[0].relativePath)).getFile(); return await mBlobBase64(f); }")
            assert base64.b64decode(image) == PNG
            mobile.evaluate("renderDashboard(); updateArchiveUI()")
            assert "Google Drive" in mobile.locator("#workFolderReminder").inner_text()
            assert mobile.locator("#mArchiveTools").is_hidden()
            print("PASS: scheda e foto scritte da desktop e lette da telefono")
            print("PASS: il normale link richiede solo la password da browser desktop e mobile nuovi")

            desktop.evaluate("switchSection('archivio')")
            desktop.locator("#driveShare").click()
            access_link = desktop.evaluate("window.testCopiedText")
            assert access_link == url + "/"
            assert KEY not in access_link
            assert "#" not in access_link
            fragment = urllib.parse.urlencode({"drive": ENDPOINT, "key": KEY})
            shared = new_page(mobile=True, access_fragment="#" + fragment)
            assert shared.evaluate("trees[0].code") == "DRIVE-TEST-1"
            assert shared.evaluate("location.hash") == ""
            assert KEY not in shared.url
            assert KEY not in shared.evaluate("JSON.stringify(localStorage)")
            shared.close()
            invalid_fragment = "#" + urllib.parse.urlencode({"drive": "https://example.invalid/exec", "key": KEY})
            invalid = new_page(access_fragment=invalid_fragment)
            assert not invalid.evaluate("document.body.classList.contains('driveConnected')")
            assert "script.google.com" not in invalid.url
            assert invalid.evaluate("location.hash") == ""
            assert invalid.locator("#driveFeedback").inner_text()
            invalid.close()
            print("PASS: condivisione del solo link normale; vecchi link riservati compatibili, servizi estranei rifiutati")

            desktop.evaluate("v2OpenAnag(trees[0])")
            desktop.locator("#v2AnaAddress").fill("Via aggiornata dal primo utente")
            desktop.locator("#v2AnaSave").click()
            desktop.wait_for_function("!v2AnagBusy")
            mobile.evaluate("v2OpenAnag(trees[0])")
            mobile.locator("#v2AnaAddress").fill("Modifica concorrente da rifiutare")
            mobile.locator("#v2AnaSave").click()
            mobile.wait_for_function("document.getElementById('driveStatus').textContent.includes('Un’altra persona')")
            probe = new_page()
            connect(probe)
            probe.wait_for_function("document.body.classList.contains('driveConnected')")
            assert probe.evaluate("trees[0].address") == "Via aggiornata dal primo utente"
            assert mobile.locator("#driveImport").is_disabled()
            print("PASS: conflitto bloccato senza sovrascrivere il primo utente")
            mobile.evaluate("v2CloseAnag(); switchSection('archivio')")
            with mobile.expect_download() as recovery:
                mobile.locator("#driveRecovery").click()
            recovered = json.loads(pathlib.Path(recovery.value.path()).read_text())
            assert recovered["trees"][0]["address"] == "Modifica concorrente da rifiutare"
            print("PASS: copia di recupero conserva la modifica rifiutata anche dopo il rollback della scheda")

            with probe.expect_download() as download:
                probe.locator("#driveRecovery").click()
            backup = json.loads(pathlib.Path(download.value.path()).read_text())
            assert len(backup["trees"]) == 1 and len(backup["images"]) == 1
            assert base64.b64decode(backup["images"][0]["base64"]) == PNG
            backup["trees"][0]["species"] = "Tiglio ripristinato"
            probe.locator("#driveImportFile").set_input_files({"name": "backup.json", "mimeType": "application/json", "buffer": json.dumps(backup).encode()})
            probe.wait_for_function("trees[0].species === 'Tiglio ripristinato'")
            print("PASS: backup completo con foto e ripristino su Drive")

            # Una risposta persa dopo la scrittura blocca i salvataggi successivi.
            def lose_save(route):
                if json.loads(route.request.post_data)["action"] == "save":
                    route.abort()
                else:
                    route.fallback()
            probe.route(ENDPOINT, lose_save)
            failure = probe.evaluate("async () => { try { await saveArchive(); return false; } catch (_) { return true; } }")
            assert failure
            assert "non confermata" in probe.locator("#driveStatus").inner_text()
            print("PASS: errore di rete visibile e scritture bloccate")

            offline = new_page(mobile=True)
            offline.locator("#driveSetup").evaluate("e => e.open = true")
            offline.locator("#driveLocal").click()
            offline.evaluate("v2OpenAnag(null)")
            offline.locator("#v2AnaCode").fill("LOCAL-TEST")
            offline.locator("#v2AnaSpecies").fill("Quercia locale")
            offline.locator("#v21InitialDate").fill("2026-10-29")
            offline.locator("#v2AnaSave").click()
            offline.wait_for_function("trees.length === 1 && !v2AnagBusy")
            offline.reload()
            offline.wait_for_function("mArchiveReady")
            assert offline.evaluate("trees[0].code") == "LOCAL-TEST"
            assert not offline.evaluate("document.body.classList.contains('driveConnected')")
            print("PASS: salvataggio locale mobile invariato quando Drive non è collegato")
            assert not errors, errors
            print("PASS: nessun errore JavaScript in desktop e mobile")
            browser.close()
    finally:
        server.shutdown()
        service.terminate()
        service.wait(timeout=10)


if __name__ == "__main__":
    main()
