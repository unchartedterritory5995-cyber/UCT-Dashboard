"""Lane 9A experiment 5: where does the H8 popstate come from?

Experiment 4: through the runner's _drive, '+ New note' pushState'd ?note=<new> and ~290 ms later
a POPSTATE took the page back to ?view=all, with NO history.back()/go() call in the top frame's
tracer (3 of 3); an inline copy of the same steps opened and stayed (1 of 1). A popstate with no
page-side call means the traversal came from outside the page script (the automation, the
browser, or another frame). So, on one sandbox, each in a fresh context from one seeded session:

  W1  the runner's _drive (expected to bounce)
  W2  a VERBATIM inline copy of _drive's H8 path (the same strings, the same order)
  W3  the inline copy that passed in experiment 4 (G4)

Instruments: the history tracer in EVERY frame (add_init_script reaches iframes; each frame's own
trace is read), the Navigation API's navigate events (navigationType, userInitiated, destination),
the frames present after the click, and Playwright's own API log (DEBUG=pw:api, set by the caller,
to stderr) which lists every call the script made, so an automation-side traversal cannot hide.
usage: python exp5.py <data-dir> <port> <corpus-dir> <out-dir>
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
dumps = out / "dumps"
dumps.mkdir(exist_ok=True)
results = []
TRACER = (Path(__file__).parent / "exp3.py").read_text(encoding="utf-8").split('TRACER = r"""', 1)[1].split('"""', 1)[0]
NAV_TRACER = r"""(() => {
  const log = (window.__navApi = [])
  if (!window.navigation) { log.push({ k: 'no Navigation API' }); return }
  navigation.addEventListener('navigate', (e) => log.push({ k: 'navigate', type: e.navigationType,
    userInitiated: e.userInitiated, dest: e.destination && e.destination.url, t: Math.round(performance.now()),
    frame: window === window.top ? 'top' : location.href.slice(0, 80) }))
})()"""


def record(name, **detail):
    results.append({"at": time.strftime("%H:%M:%S"), "step": name, **detail})
    (out / "experiment5.json").write_text(json.dumps(results, indent=1) + "\n", encoding="utf-8")
    print(name, json.dumps({k: v for k, v in detail.items() if k not in ("frames",)})[:900], flush=True)


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

        for label in ("W1", "W2", "W3"):
            print(f"===== {label} begins", file=sys.stderr, flush=True)
            ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce", storage_state=state)
            ctx.add_init_script(script=TRACER)
            ctx.add_init_script(script=NAV_TRACER)
            ctx.add_init_script(path=str(u.PROBE_FILE))
            ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
            pg = ctx.new_page()

            def grid(pg=pg):
                pg.goto(base + "/journal/notebook?view=all")
                h._dismiss_intro(pg)
                pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)

            def self_test(where, pg=pg):
                r = pg.evaluate("() => window.__uctBench.selfTest()")
                if not r.get("ok"):
                    raise u.SelfTestFailed(f"{where}: {r}")
                return r

            err = None
            try:
                if label == "W1":
                    u._drive(pg, steps["H8"], 1, ids, corpus, grid, self_test, dumps)
                elif label == "W2":                      # verbatim: notebook_bench_uct.py _drive, H8 path
                    step, rnd = steps["H8"], 1
                    grid()
                    self_test(f"{step['id']} round {rnd}")
                    html2 = (corpus / "paste-payload.html").read_text(encoding="utf-8")
                    plain2 = (corpus / "paste-payload.txt").read_text(encoding="utf-8")
                    pg.bring_to_front()
                    wrote = pg.evaluate("""async ([html, plain]) => {
            try {
              await navigator.clipboard.write([new ClipboardItem({
                'text/html': new Blob([html], {type: 'text/html'}),
                'text/plain': new Blob([plain], {type: 'text/plain'})})])
              const items = await navigator.clipboard.read()
              return items.some((i) => i.types.includes('text/html')) ? 'ok' : 'written, but no text/html read back'
            } catch (e) { return String(e && (e.name + ': ' + e.message) || e) }
        }""", [html2, plain2])
                    if wrote != "ok":
                        raise RuntimeError(f"clipboard: {wrote}")
                    pg.evaluate("o => window.__uctBench.arm('paste', o)", u.arm_options(step))
                    pg.locator('[data-tour="new-note"]').first.click()
                    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                else:                                    # experiment 4's G4
                    grid()
                    self_test("inline")
                    pg.bring_to_front()
                    pg.evaluate("""async ([html, plain]) => {
                        await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html], {type: 'text/html'}),
                          'text/plain': new Blob([plain], {type: 'text/plain'})})])
                        await navigator.clipboard.read() }""", [html, plain])
                    pg.evaluate("o => window.__uctBench.arm('paste', o)", u.arm_options(steps["H8"]))
                    pg.locator('[data-tour="new-note"]').first.click()
                    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            except Exception as e:  # noqa: BLE001
                err = u._first_lines(e)
            frames = []
            for f in pg.frames:
                try:
                    frames.append({"url": f.url[:120], "main": f == pg.main_frame,
                                   "trace": f.evaluate("() => window.__navTrace || null"),
                                   "navApi": f.evaluate("() => window.__navApi || null")})
                except Exception as e:  # noqa: BLE001
                    frames.append({"url": f.url[:120], "unreadable": str(e)[:200]})
            pg.screenshot(path=str(out / f"{label}.png"))
            record(label, ok=err is None, error=err, url_now=pg.url.replace(base, ""),
                   n_frames=len(frames), top_navApi=next((f.get("navApi") for f in frames if f.get("main")), None),
                   frames=frames)
            print(f"===== {label} ends", file=sys.stderr, flush=True)
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
