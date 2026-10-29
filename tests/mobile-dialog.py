"""Regressione: X raggiungibile con barra URL, tastiera e scorrimento.

Il browser emula le dimensioni visualViewport di un iPhone; non un dispositivo fisico.
"""
import functools
import http.server
import pathlib
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
            context = browser.new_context(**p.devices["iPhone 13"])
            context.add_init_script("""(() => {
              const viewport = new EventTarget();
              Object.assign(viewport, {width: 390, height: 620, offsetTop: 88, offsetLeft: 0});
              Object.defineProperty(window, 'visualViewport', {value: viewport, configurable: true});
              window.setTestViewport = values => {
                Object.assign(viewport, values);
                viewport.dispatchEvent(new Event('resize'));
                viewport.dispatchEvent(new Event('scroll'));
              };
            })();""")

            def route_request(route):
                url = route.request.url
                if not url.startswith(base):
                    route.abort()
                else:
                    route.continue_()

            context.route("**/*", route_request)
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base)
            page.wait_for_function("mArchiveReady")
            page.locator("#driveSetup").evaluate("e => e.open = true")
            page.locator("#driveLocal").click()
            page.evaluate("switchSection('anagrafica')")

            def visible_close(label):
                page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                box = page.locator("#v2AnagClose").bounding_box()
                visible = page.evaluate("({top:visualViewport.offsetTop, height:visualViewport.height, width:visualViewport.width})")
                assert box is not None
                assert box["y"] >= visible["top"] + 8, f"{label}: X coperta dalla barra superiore: {box['y']} < {visible['top'] + 8}"
                assert box["y"] + box["height"] <= visible["top"] + visible["height"], f"{label}: X oltre il viewport visibile"
                assert box["x"] >= 0 and box["x"] + box["width"] <= visible["width"]
                assert box["width"] >= 44 and box["height"] >= 44
                assert page.evaluate("p => !!document.elementFromPoint(p.x, p.y)?.closest('#v2AnagClose')", {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}), label + ": X coperta da un elemento della pagina"

            page.locator("#mAddNewTree").click()
            visible_close("Barra URL aperta")
            print("PASS: X visibile e cliccabile sotto la barra URL")
            page.locator("#v2AnagForm").evaluate("e => e.scrollTop = e.scrollHeight")
            visible_close("Modulo scrollato")
            print("PASS: X ancora visibile dopo lo scorrimento fino al fondo")

            page.evaluate("setTestViewport({height:310, offsetTop:108})")
            visible_close("Tastiera aperta")
            page.locator("#v2AnagClose").click()
            assert page.locator("#v2AnagOverlay").is_hidden()
            assert page.evaluate("trees.length") == 0
            print("PASS: X chiude il modulo con tastiera aperta senza salvare un albero")

            page.set_viewport_size({"width": 844, "height": 390})
            page.evaluate("setTestViewport({width:844, height:290, offsetTop:40})")
            page.locator("#mAddNewTree").click()
            visible_close("iPhone orizzontale")
            page.locator("#v2AnagClose").click()
            assert page.locator("#v2AnagOverlay").is_hidden()
            assert not errors, errors
            print("PASS: X visibile anche in orizzontale; nessun errore JavaScript")
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
