"""Render Chrome Web Store screenshots (1280x800) of the REAL extension popup.

    python tools/extension_store_screenshots.py   # -> .extension-build/store/*.png

The popup's own HTML/CSS/JS is served unchanged; only the chrome.* browser APIs
are stubbed (active tab, selection, storage) and the two UCT endpoints are
answered by route() - no network, no production traffic, no credentials.
"""
import json
import mimetypes
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent
EXT = REPO / "extension"
OUT = REPO / ".extension-build" / "store"
OUT.mkdir(parents=True, exist_ok=True)

PASSAGE = ("Order backlog for advanced packaging rose for a third straight quarter, and "
           "management said lead times on its highest-volume tools now run past two quarters.")

STUB = """
(() => {
  if (!location.href.startsWith('https://ext.local/')) return;
  const store = { 'uct.capture.credential': { token: 'demo-token', expiresAt: '2099-01-01T00:00:00Z' } };
  window.chrome = {
    tabs: { query: async () => [{ id: 7, url: 'https://research.example.com/notes/packaging-capex', title: 'Advanced packaging: what the order book says' }] },
    scripting: { executeScript: async () => [{ result: %s }] },
    storage: { local: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { delete store[k] },
    } },
    runtime: { sendMessage: async () => ({ ok: true }) },
  };
})();
""" % json.dumps(PASSAGE)

ARTICLE = """<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;font-family:Georgia,serif;background:#f6f4ef;color:#222}
 .bar{height:44px;background:#dfe3e8;display:flex;align-items:center;padding:0 14px;gap:10px;font:13px system-ui}
 .url{flex:1;background:#fff;border-radius:16px;padding:6px 14px;color:#444}
 .ext{width:28px;height:28px;border-radius:6px;background:#fff url('https://ext.local/icons/icon48.png') center/20px no-repeat;box-shadow:0 0 0 2px #c9a84c}
 main{max-width:640px;margin:48px 0 0 90px}
 h1{font-size:34px;line-height:1.2;margin:0 0 8px}
 .by{font:13px system-ui;color:#777;margin-bottom:26px}
 p{font-size:18px;line-height:1.7;margin:0 0 18px}
 mark{background:#b9d3ff;color:inherit}
 iframe{position:absolute;top:50px;right:28px;width:360px;height:%dpx;border:0;border-radius:10px;
        box-shadow:0 12px 40px rgba(0,0,0,.28);background:#fff}
</style></head><body>
<div class="bar"><span>&#8592; &#8594; &#10227;</span><div class="url">research.example.com/notes/packaging-capex</div><div class="ext"></div></div>
<main>
<h1>Advanced packaging: what the order book says</h1>
<div class="by">Sample research note &middot; 6 min read</div>
<p>Capital spending on chip packaging has been the quiet story of the cycle. Front-end tools get the
headlines, but the constraint that kept showing up in supplier calls this quarter sits further back in the line.</p>
<p><mark>%s</mark></p>
<p>That matters for anyone holding the equipment names into the next print: guidance that assumes
normal lead times is now conservative by construction.</p>
</main>
<iframe src="https://ext.local/popup.html"></iframe>
</body></html>"""


def serve_ext(route):
    path = route.request.url.split("https://ext.local/", 1)[1].split("?")[0] or "popup.html"
    f = EXT / path
    if not f.is_file():
        return route.fulfill(status=404, body="")
    ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
    if f.suffix == ".js":
        ctype = "text/javascript"
    route.fulfill(status=200, body=f.read_bytes(), headers={"content-type": ctype})


CORS = {"access-control-allow-origin": "https://ext.local",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "content-type": "application/json"}


def uct_api(route):
    req = route.request
    if req.method == "OPTIONS":
        return route.fulfill(status=204, headers=CORS, body="")
    if "/api/j2/capture/destinations" in req.url:
        body = {"destinations": [
            {"id": "n1", "label": "Semis equipment — Q4 thesis", "ticker": "AMAT"},
            {"id": "n2", "label": "Packaging supply chain", "ticker": ""},
            {"id": "n3", "label": "Earnings prep — week of Oct 20", "ticker": ""},
        ]}
        return route.fulfill(status=200, headers=CORS, body=json.dumps(body))
    if req.url.endswith("/api/j2/capture") and req.method == "POST":
        return route.fulfill(status=200, headers=CORS, body=json.dumps({"ok": True, "deduped": False}))
    route.fulfill(status=404, headers=CORS, body="{}")


def shot(page, name):
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / name))
    print("wrote", OUT / name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
    ctx.add_init_script(STUB)
    ctx.route("https://ext.local/**", serve_ext)
    ctx.route("https://uctintelligence.com/**", uct_api)
    ctx.route("https://research.example.com/**",
              lambda r: r.fulfill(status=200, body=ARTICLE % (560, PASSAGE), headers={"content-type": "text/html"}))
    page = ctx.new_page()
    page.goto("https://research.example.com/notes/packaging-capex")
    frame = page.frame_locator("iframe")
    frame.locator("#destination option").first.wait_for(state="attached", timeout=10000)
    frame.locator("#annotation").fill("Lead times past two quarters: guidance is conservative. Check AMAT's call.")
    shot(page, "01-save-a-passage.png")
    frame.locator("#saveBtn").click()
    frame.locator("#ok").wait_for(state="visible", timeout=10000)
    print("ok text:", frame.locator("#ok").inner_text())
    shot(page, "02-saved.png")
    browser.close()
