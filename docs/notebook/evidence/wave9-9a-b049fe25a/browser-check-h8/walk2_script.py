"""Lane 9A browser check, part 2: walk the protocol's H8 steps on UCT exactly as now written
(docs/notebook/benchmark/protocol.md, "H8: paste the 200-paragraph payload", at b049fe25a).

The first walk (evidence wave9-9a-7f8d9791c/browser-check) could not walk H8: its copy check read
the clipboard from the file:// page, which holds no permission (experiment E3 then showed Ctrl+A /
Ctrl+C in paste-payload.html does put text/html on the clipboard, read from the UCT origin). The
protocol now also says how to leave a pasted note on UCT (the All notes row). So, as a person
would, in one Chrome context:
  1. the corpus seeded through import/confirm; All notes open;
  2. the probe PASTED into the page (page.evaluate of the file's text -- the DevTools paste),
     `await __uctBench.selfTest()`, `__uctBench.check(<paste_end>)` must print absent;
  3. paste-payload.html opened in a second tab, Ctrl+A, Ctrl+C; back to UCT; the clipboard read
     FROM THE UCT PAGE must hold text/html;
  4. `__uctBench.arm('paste', <the console line's options>)`; per rep: '+ New note', click its body,
     Ctrl+V, wait until the paste has landed, leave by the sidebar's All notes row; 5 reps (one
     round, as the console line arms it);
  5. the dump, written at once.
usage: python walk2.py <data-dir> <port> <corpus-dir> <out-dir>
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
steps_log = []
SRC = u.PROBE_FILE.read_text(encoding="utf-8")


def record(name, ok, **detail):
    steps_log.append({"at": time.strftime("%H:%M:%S"), "step": name, "ok": ok, **detail})
    (out / "steps.json").write_text(json.dumps(steps_log, indent=1) + "\n", encoding="utf-8")
    print(("PASS " if ok else "FAIL ") + name, json.dumps(detail)[:500], flush=True)


assert not corp.verify(corpus), "the corpus does not verify"
manifest = json.loads((corpus / corp.MANIFEST_NAME).read_text(encoding="utf-8"))
step = {s["id"]: s for s in u.plan(manifest)}["H8"]
console = u.console_lines(step)
arm_line = next(x for x in console if x.startswith("__uctBench.arm("))
box = h.Sandbox(data_dir, port, out / "sandbox.log")
base = f"http://127.0.0.1:{port}"
box.start()
try:
    record("sandbox healthy", box.wait_healthy(base, 240))
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        u.provision(admin_ctx.request, ctx.request, base)
        ids = u.seed(ctx.request, base, corpus, manifest)
        record("corpus seeded through import/confirm", len(ids) == manifest["counts"]["total_notes"], notes=len(ids))
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.goto(base + "/journal/notebook?view=all")
        h._dismiss_intro(pg)
        pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)
        pg.screenshot(path=str(out / "01-all-notes.png"))
        record("All notes open", True)
        ver = pg.evaluate(SRC + "\n;window.__uctBench && window.__uctBench.version")
        record("probe pasted (DevTools paste equivalent)", ver == u.rep.probe_version(), version=ver)
        st = pg.evaluate("() => window.__uctBench.selfTest()")
        record("await __uctBench.selfTest()", bool(st.get("ok")), ms=st.get("ms"), window=st.get("window"))
        chk = pg.evaluate("m => window.__uctBench.check(m)", step["end_marker"])
        record(f"__uctBench.check({step['end_marker']!r}) prints absent", "absent" in str(chk), printed=chk)
        src_pg = ctx.new_page()
        src_pg.goto((corpus / "paste-payload.html").resolve().as_uri())
        src_pg.keyboard.press("Control+A")
        src_pg.keyboard.press("Control+C")
        src_pg.close()
        pg.bring_to_front()
        types = pg.evaluate("""async () => { try { const it = await navigator.clipboard.read(); const out = []
            for (const i of it) for (const t of i.types) out.push(t + ':' + (await (await i.getType(t)).text()).length)
            return out } catch (e) { return ['ERROR ' + e.name + ': ' + e.message] } }""")
        record("Ctrl+A, Ctrl+C in paste-payload.html; the UCT page reads text/html", any(t.startswith("text/html") for t in types),
               clipboard=types)
        opts = json.loads(arm_line[len("__uctBench.arm('paste', "):-1])
        armed = pg.evaluate("o => window.__uctBench.arm('paste', o)", opts)
        record(f"console line: {arm_line}", "armed" in str(armed), printed=armed)
        for k in range(1, opts["reps"] + 1):
            before = pg.url
            pg.locator('[data-tour="new-note"]').first.click()                       # protocol: + New note
            pg.wait_for_url(lambda url: url != before and "note=" in url, timeout=15000)
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            pg.locator(".ProseMirror").first.click()                                  # click into its body
            pg.keyboard.press("Control+V")                                            # Ctrl+V
            pg.wait_for_function("n => window.__uctBench.status().attempts >= n", arg=k, timeout=30000)
            if k == 1:
                pg.screenshot(path=str(out / "02-H8-pasted.png"))
            pg.get_by_role("button", name=u.ALL_NOTES_ROW).first.click()             # protocol: All notes row
            pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=30000)
            record(f"rep {k}: + New note, body, Ctrl+V, landed, All notes", True, url=pg.url.replace(base, ""))
        text = pg.evaluate("([a, o]) => window.__uctBench.dump(a, o)", ["uct", "H8"])
        (out / "uct__H8__walk.json").write_text(text + "\n", encoding="utf-8")
        d = json.loads(text)
        why = u.rep.check_dump(d, version=u.rep.probe_version(), apps=u.rep.HAND_APPS)
        record("copy(__uctBench.dump('uct', 'H8')) saved", d["status"] == "COMPLETE" and len(d["samples"]) == opts["reps"],
               status=d["status"], samples=d["samples"], invalid=d["invalid"], refused=why)
        record("no page errors", not errors, errors=errors[:5])
        br.close()
except Exception as e:  # noqa: BLE001
    record("walk raised", False, error=u._first_lines(e))
finally:
    box.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
    how = box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    line = h.integrity_line(integ, f"stop: {how}")
    (out / "integrity-line.txt").write_text(line + "\n", encoding="utf-8")
    print(line)
