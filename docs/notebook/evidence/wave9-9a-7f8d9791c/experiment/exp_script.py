"""Lane 9A experiment: three questions the browser check left open, on a small sandbox of its own.

  E1  Does Alt+Left (the protocol's Back) navigate in Playwright's default headless shell, and in
      Chromium's new headless (channel="chromium")?
  E2  The runner's H8 died because '+ New note' created a note but no editor opened; a context with
      no probe opened it fine. Which step of the runner's flow matters? Variants, each on a fresh
      page load, each recording every URL the page goes to after the click:
        a) probe via add_init_script, nothing else
        b) a) + selfTest()
        c) b) + clipboard write + read (the runner's exact H8 order)
        d) c) + arm('paste')
  E3  Ctrl+A / Ctrl+C in paste-payload.html, then read the clipboard FROM THE UCT PAGE (the origin
      the permission was granted to): is there text/html?
usage: python exp.py <data-dir> <port> <corpus-dir> <out-dir>
"""
import json
import sys
import time
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w9")
sys.path.insert(0, str(REPO / "tools"))
import notebook_bench_report as rep  # noqa: E402
import notebook_bench_uct as u  # noqa: E402
import notebook_perf_harness as h  # noqa: E402

data_dir, port, corpus, out = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
out.mkdir(parents=True, exist_ok=True)
results = []


def record(name, **detail):
    results.append({"at": time.strftime("%H:%M:%S"), "step": name, **detail})
    (out / "experiment.json").write_text(json.dumps(results, indent=1) + "\n", encoding="utf-8")
    print(name, json.dumps(detail)[:400], flush=True)


box = h.Sandbox(data_dir, port, out / "sandbox.log")
base = f"http://127.0.0.1:{port}"
box.start()
try:
    record("sandbox healthy", ok=box.wait_healthy(base, 240))
    from playwright.sync_api import sync_playwright
    html = (corpus / "paste-payload.html").read_text(encoding="utf-8")
    plain = (corpus / "paste-payload.txt").read_text(encoding="utf-8")
    with sync_playwright() as pw:
        # a few notes are enough here
        br0 = pw.chromium.launch()
        a0, m0 = br0.new_context(), br0.new_context()
        h._provision(a0.request, m0.request, base, member=("w9exp@local.dev", "LocalTest2026!", "w9exp"))
        ids = []
        for i in range(3):
            r = m0.request.post(base + "/api/j2/notes", data={"title": f"Exp note {i}", "bodyJson": {
                "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"exp body {i}"}]}]}})
            ids.append(r.json()["note"]["id"])
        state = m0.storage_state()
        br0.close()

        for label, kw in (("default headless shell", {}), ("new headless (channel=chromium)", {"channel": "chromium"})):
            try:
                br = pw.chromium.launch(**kw)
            except Exception as e:  # noqa: BLE001
                record(f"E1 {label}: could not launch", error=str(e).splitlines()[0][:200])
                continue
            ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce", storage_state=state)
            pg = ctx.new_page()
            pg.goto(base + "/journal/notebook?view=all")
            h._dismiss_intro(pg)
            card = pg.locator(u.card_selector(ids[0]))
            card.wait_for(state="visible", timeout=60000)
            card.click()
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            opened_url = pg.url.replace(base, "")
            pg.keyboard.press("Alt+ArrowLeft")
            try:
                card.wait_for(state="visible", timeout=8000)
                back = True
            except Exception:  # noqa: BLE001
                back = False
            record(f"E1 Alt+Left in the {label}", browser=br.version, opened=opened_url,
                   after=pg.url.replace(base, ""), went_back=back)
            br.close()

        br = pw.chromium.launch()
        for variant in ("a", "b", "c", "d"):
            ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce", storage_state=state)
            ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
            ctx.add_init_script(path=str(rep.PROBE_FILE))
            pg = ctx.new_page()
            navs = []
            pg.on("framenavigated", lambda f, pg=pg, navs=navs: navs.append(f.url.replace(base, "")) if f == pg.main_frame else None)
            pg.goto(base + "/journal/notebook?view=all")
            h._dismiss_intro(pg)
            pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)
            steps = []
            if variant in "bcd":
                steps.append(("selfTest", pg.evaluate("() => window.__uctBench.selfTest()").get("ok")))
            if variant in "cd":
                pg.bring_to_front()
                wrote = pg.evaluate("""async ([html, plain]) => { try {
                    await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html], {type: 'text/html'}),
                      'text/plain': new Blob([plain], {type: 'text/plain'})})])
                    const it = await navigator.clipboard.read(); return it.flatMap((i) => i.types).join(',') }
                    catch (e) { return 'ERROR ' + e.name + ': ' + e.message } }""", [html, plain])
                steps.append(("clipboard", wrote))
            if variant == "d":
                steps.append(("arm", pg.evaluate("() => window.__uctBench.arm('paste', {endMarker: 'zzqnothing', reps: 1})")))
            before = len(navs)
            focus_before = pg.evaluate("() => document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className).slice(0, 80)")
            pg.locator('[data-tour="new-note"]').first.click()
            try:
                pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=12000)
                opened = True
            except Exception:  # noqa: BLE001
                opened = False
            pg.screenshot(path=str(out / f"E2-{variant}.png"))
            record(f"E2 variant {variant}: '+ New note'", editor_opened=opened, steps=steps,
                   focus_before_click=focus_before, urls_after_click=navs[before:], url_now=pg.url.replace(base, ""))
            ctx.close()

        ctx = br.new_context(viewport={"width": 1280, "height": 800}, storage_state=state)
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
        app = ctx.new_page()
        app.goto(base + "/journal/notebook?view=all")
        src = ctx.new_page()
        src.goto((corpus / "paste-payload.html").resolve().as_uri())
        src.keyboard.press("Control+A")
        src.keyboard.press("Control+C")
        app.bring_to_front()
        types = app.evaluate("""async () => { try { const it = await navigator.clipboard.read();
            const out = []; for (const i of it) { for (const t of i.types) { const b = await i.getType(t);
            out.push(t + ':' + (await b.text()).length) } } return out } catch (e) { return ['ERROR ' + e.name + ': ' + e.message] } }""")
        record("E3 Ctrl+A/Ctrl+C in paste-payload.html, read from the UCT page", clipboard=types)
        br.close()
finally:
    box.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
    how = box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    line = h.integrity_line(integ, f"stop: {how}")
    (out / "integrity-line.txt").write_text(line + "\n", encoding="utf-8")
    print(line)
