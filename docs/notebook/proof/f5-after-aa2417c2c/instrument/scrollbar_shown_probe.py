"""Does the app's global scrollbar rule leave a horizontal scrollbar 0 px tall? Measured with
scrollbars SHOWN (Playwright headless passes --hide-scrollbars by default, which zeroes every
scrollbar and made the walk's reading meaningless)."""
import json
from playwright.sync_api import sync_playwright
PAGE = """<!doctype html><style>
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: #000; }
::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
.row { display:flex; gap:12px; overflow-x:auto; padding-bottom:8px; width:300px }
.row.fixed { position: relative; scrollbar-width: thin; scrollbar-color: #cfcac0 transparent; }
.col { flex: 0 0 260px; height: 60px; background: #222 }
</style>
<div id=a class=row><div class=col></div><div class=col></div></div>
<div id=b class="row fixed"><div class=col></div><div class=col></div></div>
<div id=c style="display:flex;gap:12px;overflow-x:auto;width:300px"><div class=col></div><div class=col></div></div>"""
JS = """() => Object.fromEntries(['a','b'].map(id => { const e = document.getElementById(id);
  return [id, {sb: e.offsetHeight - e.clientHeight, sw: getComputedStyle(e).scrollbarWidth}] }))"""
out = {}
with sync_playwright() as p:
    for label, kw in (("hide-scrollbars (Playwright default)", {}),
                      ("scrollbars shown", {"ignore_default_args": ["--hide-scrollbars"]})):
        b = p.chromium.launch(**kw)
        pg = b.new_page()
        pg.set_content(PAGE)
        out[label] = pg.evaluate(JS)
        # control: an unstyled page (no ::-webkit-scrollbar rule) must show a classic bar when shown
        pg.set_content('<div id=a style="overflow-x:auto;width:300px"><div style="width:900px;height:40px"></div></div>'
                       '<div id=b style="overflow-x:auto;width:300px"><div style="width:900px;height:40px"></div></div>')
        out[label + " / control, no global rule"] = pg.evaluate(JS)
        b.close()
print(json.dumps(out, indent=1))
