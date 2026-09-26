"""Lane 9A experiment 2: the runner's H8 died on the FULL corpus after H1-H7; experiment 1 showed
'+ New note' opens the editor on a 3-note account with the probe, selfTest, clipboard and arm all
present. So what differs is the corpus or the sequence. On a sandbox seeded with the real 992-note
corpus, through the runner's OWN _drive (not a copy of it):

  F1  H8 round 1 alone, on a fresh page
  F2  H7 round 1 (typing into the 2,000-paragraph note), then H8 round 1, on one page
  F3  H6 round 1 (typing into the small note), then H8 round 1, on one page

For every H8 attempt: pass/fail, the error's first lines, every main-frame URL after the '+ New
note' click (recorded by a framenavigated listener), and a screenshot at the end.
usage: python exp2.py <data-dir> <port> <corpus-dir> <out-dir>
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
dumps = out / "dumps"
dumps.mkdir(exist_ok=True)
results = []


def record(name, **detail):
    results.append({"at": time.strftime("%H:%M:%S"), "step": name, **detail})
    (out / "experiment2.json").write_text(json.dumps(results, indent=1) + "\n", encoding="utf-8")
    print(name, json.dumps(detail)[:500], flush=True)


assert not corp.verify(corpus), "the corpus does not verify"
manifest = json.loads((corpus / corp.MANIFEST_NAME).read_text(encoding="utf-8"))
steps = {s["id"]: s for s in u.plan(manifest)}
box = h.Sandbox(data_dir, port, out / "sandbox.log")
base = f"http://127.0.0.1:{port}"
box.start()
try:
    record("sandbox healthy", ok=box.wait_healthy(base, 240))
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        seed_ctx = br.new_context()
        u.provision(admin_ctx.request, seed_ctx.request, base)
        ids = u.seed(seed_ctx.request, base, corpus, manifest)
        total = seed_ctx.request.get(base + "/api/j2/notes?limit=1").json().get("total")
        record("seeded", api_total=total)
        state = seed_ctx.storage_state()

        def variant(label, before):
            ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce", storage_state=state)
            ctx.add_init_script(path=str(u.PROBE_FILE))
            ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
            pg = ctx.new_page()
            navs, errors = [], []
            pg.on("framenavigated", lambda f: navs.append((time.strftime("%H:%M:%S"), f.url.replace(base, "")))
                  if f == pg.main_frame else None)
            pg.on("pageerror", lambda e: errors.append(str(e)[:300]))

            def grid():
                pg.goto(base + "/journal/notebook?view=all")
                h._dismiss_intro(pg)
                pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)

            def self_test(where):
                r = pg.evaluate("() => window.__uctBench.selfTest()")
                if not r.get("ok"):
                    raise u.SelfTestFailed(f"{where}: {r}")
                return r

            for sid in before:
                try:
                    u._drive(pg, steps[sid], 1, ids, corpus, grid, self_test, dumps)
                    record(f"{label}: {sid} round 1", ok=True)
                except Exception as e:  # noqa: BLE001
                    record(f"{label}: {sid} round 1", ok=False, error=u._first_lines(e))
            mark = len(navs)
            t0 = time.time()
            try:
                u._drive(pg, steps["H8"], 1, ids, corpus, grid, self_test, dumps)
                ok, err = True, None
            except Exception as e:  # noqa: BLE001
                ok, err = False, u._first_lines(e)
            state_now = pg.evaluate("""() => ({
                pm: [...document.querySelectorAll('.ProseMirror')].map((el) => {
                  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
                  return {w: Math.round(r.width), h: Math.round(r.height), display: cs.display,
                          visibility: cs.visibility, hiddenAncestor: !!el.closest('[hidden]')} }),
                url: location.pathname + location.search })""")
            pg.screenshot(path=str(out / f"{label}-end.png"))
            record(f"{label}: H8 round 1", ok=ok, error=err, seconds=round(time.time() - t0, 1),
                   urls_during_H8=navs[mark:], page_errors=errors, end_state=state_now)
            ctx.close()

        variant("F1", [])
        variant("F2", ["H7"])
        variant("F3", ["H6"])
        br.close()
finally:
    box.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
    how = box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    line = h.integrity_line(integ, f"stop: {how}")
    (out / "integrity-line.txt").write_text(line + "\n", encoding="utf-8")
    print(line)
