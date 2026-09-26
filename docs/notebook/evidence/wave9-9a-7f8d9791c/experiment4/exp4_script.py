"""Lane 9A experiment 4: catch the H8 bounce with a history tracer running from page load.

Every failure so far went through the runner's own _drive (run 3; experiment 2 F1-F3); every
inline copy of the same steps passed (experiment 1 a-d; experiment 3 ctrl..d, which also carried
a history tracer). So: the runner's _drive, three times, with the SAME passive tracer installed
from page load (G1-G3), and one inline copy with it (G4), each dumping the whole trace -- every
pushState / replaceState / back / go / popstate since the page loaded, with the triggering event
type and a short stack -- plus the note-API requests the page made (request listener).
usage: python exp4.py <data-dir> <port> <corpus-dir> <out-dir>
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


def record(name, **detail):
    results.append({"at": time.strftime("%H:%M:%S"), "step": name, **detail})
    (out / "experiment4.json").write_text(json.dumps(results, indent=1) + "\n", encoding="utf-8")
    print(name, json.dumps({k: v for k, v in detail.items() if k not in ("trace", "requests")})[:600], flush=True)


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

        for label in ("G1", "G2", "G3", "G4"):
            ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce", storage_state=state)
            ctx.add_init_script(script=TRACER)
            ctx.add_init_script(path=str(u.PROBE_FILE))
            ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
            pg = ctx.new_page()
            reqs = []
            t_start = time.time()
            pg.on("request", lambda r, reqs=reqs, t_start=t_start: reqs.append(
                (round(time.time() - t_start, 2), r.method, r.url.replace(base, "")[:90]))
                if "/api/j2/notes" in r.url and "broker" not in r.url else None)

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
            if label in ("G1", "G2", "G3"):
                try:
                    u._drive(pg, steps["H8"], 1, ids, corpus, grid, self_test, dumps)
                except Exception as e:  # noqa: BLE001
                    err = u._first_lines(e)
            else:
                grid()
                self_test("inline")
                pg.bring_to_front()
                pg.evaluate("""async ([html, plain]) => {
                    await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html], {type: 'text/html'}),
                      'text/plain': new Blob([plain], {type: 'text/plain'})})])
                    await navigator.clipboard.read() }""", [html, plain])
                pg.evaluate("o => window.__uctBench.arm('paste', o)", u.arm_options(steps["H8"]))
                pg.locator('[data-tour="new-note"]').first.click()
                try:
                    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                except Exception as e:  # noqa: BLE001
                    err = u._first_lines(e)
            try:
                trace = pg.evaluate("() => window.__navTrace")
            except Exception as e:  # noqa: BLE001
                trace = [f"unreadable: {e}"]
            pg.screenshot(path=str(out / f"{label}.png"))
            record(label, via="_drive" if label != "G4" else "inline", ok=err is None, error=err,
                   url_now=pg.url.replace(base, ""), trace=trace, requests=reqs)
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
