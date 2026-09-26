"""Lane 9A experiment 3: classify the H8 bounce as PRODUCT or INSTRUMENT.

Experiment 2: on the real 992-note corpus, '+ New note' went ?view=all -> ?note=<new> -> back to
?view=all within a second, every time (F1/F2/F3). Experiment 1: on a 3-note account, the same
probe + selfTest + clipboard + arm opened the editor and stayed. The browser check: the full
corpus with NO probe opened it and stayed. So bisect on the full corpus, each variant in a fresh
context built from the same seeded session, with a passive history tracer in EVERY variant (it
wraps pushState/replaceState/back/go and logs the triggering event type and a short stack):

  ctrl        no probe, no clipboard permission, click at once
  ctrl-wait   no probe, click 2 s after the grid shows
  perms       no probe, clipboard permission granted
  a           probe (init script) + permission
  b           a + selfTest()
  c           b + clipboard write/read
  d           c + arm('paste')
usage: python exp3.py <data-dir> <port> <corpus-dir> <out-dir>
"""
import json
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

TRACER = r"""(() => {
  const log = (window.__navTrace = [])
  const stack = () => (new Error().stack || '').split('\n').slice(2, 8).map((s) => s.trim()).join(' | ')
  for (const k of ['pushState', 'replaceState']) {
    const orig = history[k].bind(history)
    history[k] = function (s, t, url) {
      log.push({ k, url: String(url), ev: window.event ? window.event.type : null,
                 t: Math.round(performance.now()), stack: stack() })
      return orig(s, t, url)
    }
  }
  for (const k of ['back', 'go', 'forward']) {
    const orig = history[k].bind(history)
    history[k] = function (...a) {
      log.push({ k, a, ev: window.event ? window.event.type : null, t: Math.round(performance.now()), stack: stack() })
      return orig(...a)
    }
  }
  addEventListener('popstate', () => log.push({ k: 'popstate', t: Math.round(performance.now()), url: location.search }))
})()"""


def record(name, **detail):
    results.append({"at": time.strftime("%H:%M:%S"), "step": name, **detail})
    (out / "experiment3.json").write_text(json.dumps(results, indent=1) + "\n", encoding="utf-8")
    print(name, json.dumps({k: v for k, v in detail.items() if k != "trace"})[:600], flush=True)


assert not corp.verify(corpus), "the corpus does not verify"
manifest = json.loads((corpus / corp.MANIFEST_NAME).read_text(encoding="utf-8"))
steps = {s["id"]: s for s in u.plan(manifest)}
html = (corpus / "paste-payload.html").read_text(encoding="utf-8")
plain = (corpus / "paste-payload.txt").read_text(encoding="utf-8")
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

        for variant in ("ctrl", "ctrl-wait", "perms", "a", "b", "c", "d"):
            ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce", storage_state=state)
            ctx.add_init_script(script=TRACER)
            if variant not in ("ctrl", "ctrl-wait"):
                ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
            if variant in ("a", "b", "c", "d"):
                ctx.add_init_script(path=str(u.PROBE_FILE))
            pg = ctx.new_page()
            navs = []
            pg.on("framenavigated", lambda f, pg=pg, navs=navs: navs.append(f.url.replace(base, ""))
                  if f == pg.main_frame else None)
            pg.goto(base + "/journal/notebook?view=all")
            h._dismiss_intro(pg)
            pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)
            done = []
            if variant == "ctrl-wait":
                pg.wait_for_timeout(2000)
                done.append("waited 2 s")
            if variant in ("b", "c", "d"):
                done.append(("selfTest", pg.evaluate("() => window.__uctBench.selfTest()").get("ok")))
            if variant in ("c", "d"):
                pg.bring_to_front()
                done.append(("clipboard", pg.evaluate("""async ([html, plain]) => { try {
                    await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html], {type: 'text/html'}),
                      'text/plain': new Blob([plain], {type: 'text/plain'})})])
                    const it = await navigator.clipboard.read(); return it.flatMap((i) => i.types).join(',') }
                    catch (e) { return 'ERROR ' + e.name + ': ' + e.message } }""", [html, plain])))
            if variant == "d":
                done.append(("arm", pg.evaluate("o => window.__uctBench.arm('paste', o)", u.arm_options(steps["H8"]))))
            n_trace = pg.evaluate("() => window.__navTrace.length")
            mark = len(navs)
            pg.locator('[data-tour="new-note"]').first.click()
            try:
                pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=12000)
                opened = True
            except Exception:  # noqa: BLE001
                opened = False
            pg.wait_for_timeout(1500)                      # let a bounce, if any, land
            trace = pg.evaluate("n => window.__navTrace.slice(n)", n_trace)
            pg.screenshot(path=str(out / f"{variant}.png"))
            record(f"variant {variant}", editor_opened=opened,
                   editor_still_open=pg.locator(".ProseMirror").count() > 0,
                   url_now=pg.url.replace(base, ""), urls_after_click=navs[mark:], done=done, trace=trace)
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
