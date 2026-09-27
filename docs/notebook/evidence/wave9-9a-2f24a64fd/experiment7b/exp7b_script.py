"""Lane 9A experiment 7: scope the product's dead '+ New note' after Back (experiment 6, X1/X2).

The product alone, no probe: a note, then browser Back, then '+ New note' opened nothing and sent
no request; leaving by the sidebar's All notes row instead (X3) worked. Scope it, each in a fresh
context, the product alone plus a passive click logger (window capture and window bubble listeners
that record the click's target and whether it was cancelled -- they never cancel anything):

  Y1  992-note corpus: open an EXISTING note from its card, Back, 2 s, '+ New note'
  (Y2, a second 3-note member, was dropped: the first attempt's second sign-up answered 401 --
   evidence wave9-9a-2f24a64fd/experiment7, exp-stderr.log)
  Y3  992-note corpus: '+ New note', Back, RELOAD, '+ New note'
  Y4  992-note corpus: '+ New note', Back, the sidebar's All notes row, '+ New note'
  Y5  992-note corpus: '+ New note', Back, 2 s, '+ New note' clicked TWICE, 2 s apart
usage: python exp7.py <data-dir> <port> <corpus-dir> <out-dir>
"""
import json
import re
import sys
import time
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w9")
sys.path.insert(0, str(REPO / "tools"))
import notebook_bench_corpus as corp  # noqa: E402
import notebook_bench_uct as u  # noqa: E402
import notebook_perf_harness as h  # noqa: E402

data_dir, port, corpus, out = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
out.mkdir(parents=True, exist_ok=True)
results = []
CLICKLOG = r"""(() => {
  const log = (window.__clicks = [])
  const d = (e, phase) => log.push({ phase, target: (e.target && (e.target.tagName + ' ' + (e.target.textContent || '').trim().slice(0, 30))) || null,
    defaultPrevented: e.defaultPrevented, t: Math.round(performance.now()) })
  window.addEventListener('click', (e) => d(e, 'window-capture'), true)
  window.addEventListener('click', (e) => d(e, 'window-bubble'), false)
})()"""


def record(name, **detail):
    results.append({"at": time.strftime("%H:%M:%S"), "step": name, **detail})
    (out / "experiment7.json").write_text(json.dumps(results, indent=1) + "\n", encoding="utf-8")
    print(name, json.dumps(detail)[:900], flush=True)


assert not corp.verify(corpus), "the corpus does not verify"
manifest = json.loads((corpus / corp.MANIFEST_NAME).read_text(encoding="utf-8"))
box = h.Sandbox(data_dir, port, out / "sandbox.log")
base = f"http://127.0.0.1:{port}"
box.start()
try:
    record("sandbox healthy", ok=box.wait_healthy(base, 240))
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx, seed_ctx = br.new_context(), br.new_context()
        u.provision(admin_ctx.request, seed_ctx.request, base)
        ids = u.seed(seed_ctx.request, base, corpus, manifest)
        record("seeded", api_total=seed_ctx.request.get(base + "/api/j2/notes?limit=1").json().get("total"))
        state = seed_ctx.storage_state()

        for label in ("Y1", "Y3", "Y4", "Y5"):
            ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce",
                                 storage_state=state)
            ctx.add_init_script(script=CLICKLOG)
            pg = ctx.new_page()
            reqs = []
            pg.on("request", lambda r, reqs=reqs: reqs.append(f"{r.method} {r.url.replace(base, '')[:70]}")
                  if "/api/j2/notes" in r.url else None)
            new = pg.locator('[data-tour="new-note"]').first
            detail = {}
            try:
                pg.goto(base + "/journal/notebook?view=all")
                h._dismiss_intro(pg)
                pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)
                if label == "Y1":
                    pg.locator(u.card_selector(ids[{x["id"]: x for x in u.plan(manifest)}["H1"]["note_key"]])).click()
                else:
                    new.click()
                pg.wait_for_url(lambda url: "note=" in url, timeout=15000)
                pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                pg.wait_for_timeout(1000)
                pg.go_back()
                pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=30000)
                if label == "Y3":
                    pg.reload()
                    pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)
                if label == "Y4":
                    pg.get_by_role("button", name=re.compile(r"^All notes")).first.click()
                    pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=30000)
                pg.wait_for_timeout(2000)
                tries = 2 if label == "Y5" else 1
                opened = []
                for _ in range(tries):
                    mark_c = pg.evaluate("() => window.__clicks.length")
                    mark_r = len(reqs)
                    before = pg.url
                    new.click()
                    try:
                        pg.wait_for_url(lambda url: url != before and "note=" in url, timeout=10000)
                        ok = True
                    except Exception:  # noqa: BLE001
                        ok = False
                    opened.append({"opened": ok, "clicks_seen": pg.evaluate("n => window.__clicks.slice(n)", mark_c),
                                   "note_requests": reqs[mark_r:][:6]})
                    if ok:
                        break
                    pg.wait_for_timeout(2000)
                detail = dict(attempts=opened, url_now=pg.url.replace(base, ""))
            except Exception as e:  # noqa: BLE001
                detail["error"] = u._first_lines(e)
            pg.screenshot(path=str(out / f"{label}.png"))
            record(label, **detail)
            ctx.close()
        br.close()
finally:
    box.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
    how = box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    line = h.integrity_line(integ, f"stop: {how}")
    (out / "integrity-line.txt").write_text(line + "\n", encoding="utf-8")
    print(line)
