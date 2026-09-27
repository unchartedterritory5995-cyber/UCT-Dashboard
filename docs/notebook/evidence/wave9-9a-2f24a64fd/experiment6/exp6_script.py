"""Lane 9A experiment 6: is the H8 rep-2 dead click the PRODUCT or the instrument?

Run 4 (evidence wave9-9a-2f24a64fd/run4): even after waiting for a quiet page, rep 2's '+ New
note' opened nothing -- so it is not a timing race. On the real 992-note corpus, with NO probe and
NO tracer in the page (the product alone), each in a fresh context from one seeded session:

  X1  '+ New note', click the body, Control+V the 200-paragraph payload, wait until its last
      paragraph shows, browser Back, wait 2 s, '+ New note' again
  X2  the same, but TYPE five characters instead of pasting (does the paste matter?)
  X3  the same as X1, but leave with the sidebar's "All notes" row instead of Back

For the second '+ New note': did the URL name a note, every request the page made, console
errors and page errors, the button's disabled state, what element is under the button's centre,
any "Couldn't create" text, and a screenshot.
usage: python exp6.py <data-dir> <port> <corpus-dir> <out-dir>
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


def record(name, **detail):
    results.append({"at": time.strftime("%H:%M:%S"), "step": name, **detail})
    (out / "experiment6.json").write_text(json.dumps(results, indent=1) + "\n", encoding="utf-8")
    print(name, json.dumps({k: v for k, v in detail.items() if k not in ("requests",)})[:900], flush=True)


assert not corp.verify(corpus), "the corpus does not verify"
manifest = json.loads((corpus / corp.MANIFEST_NAME).read_text(encoding="utf-8"))
end_marker = manifest["markers"]["paste_end"] if "paste_end" in manifest.get("markers", {}) else None
html = (corpus / "paste-payload.html").read_text(encoding="utf-8")
plain = (corpus / "paste-payload.txt").read_text(encoding="utf-8")
box = h.Sandbox(data_dir, port, out / "sandbox.log")
base = f"http://127.0.0.1:{port}"
box.start()
try:
    record("sandbox healthy", ok=box.wait_healthy(base, 240), end_marker=end_marker)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx, seed_ctx = br.new_context(), br.new_context()
        u.provision(admin_ctx.request, seed_ctx.request, base)
        u.seed(seed_ctx.request, base, corpus, manifest)
        record("seeded", api_total=seed_ctx.request.get(base + "/api/j2/notes?limit=1").json().get("total"))
        state = seed_ctx.storage_state()

        for label in ("X1", "X2", "X3"):
            ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce", storage_state=state)
            ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
            pg = ctx.new_page()
            reqs, console, errors = [], [], []
            t0 = time.time()
            pg.on("request", lambda r, reqs=reqs, t0=t0: reqs.append(
                (round(time.time() - t0, 2), r.method, r.url.replace(base, "")[:90]))
                if "/api/" in r.url and "/api/stream/" not in r.url else None)
            pg.on("console", lambda m, console=console: console.append(f"{m.type}: {m.text}"[:300])
                  if m.type in ("error", "warning") else None)
            pg.on("pageerror", lambda e, errors=errors: errors.append(str(e)[:300]))
            detail = {}
            try:
                pg.goto(base + "/journal/notebook?view=all")
                h._dismiss_intro(pg)
                pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)
                new = pg.locator('[data-tour="new-note"]').first
                new.click()
                pg.wait_for_url(lambda url: "note=" in url, timeout=15000)
                pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                pg.locator(".ProseMirror").first.click()
                if label == "X2":
                    pg.keyboard.type("fixt5", delay=40)
                    pg.wait_for_timeout(1500)
                else:
                    pg.evaluate("""async ([html, plain]) => {
                        await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html], {type: 'text/html'}),
                          'text/plain': new Blob([plain], {type: 'text/plain'})})]) }""", [html, plain])
                    pg.keyboard.press("Control+V")
                    if end_marker:
                        pg.wait_for_function("m => document.body.innerText.includes(m)", arg=end_marker, timeout=30000)
                    pg.wait_for_timeout(1500)
                first_url = pg.url.replace(base, "")
                if label == "X3":
                    pg.get_by_text("All notes", exact=True).first.click()
                else:
                    pg.go_back()
                pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=30000)
                pg.wait_for_timeout(2000)
                mark_req, mark_con = len(reqs), len(console)
                info = pg.evaluate("""() => {
                    const b = document.querySelector('[data-tour="new-note"]')
                    if (!b) return {button: null}
                    const r = b.getBoundingClientRect()
                    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
                    return {disabled: b.disabled, text: b.textContent.trim(),
                            topIsButton: top === b || b.contains(top),
                            top: top ? (top.tagName + '.' + String(top.className).slice(0, 60)) : null,
                            active: document.activeElement ? document.activeElement.tagName + ' ' +
                              (document.activeElement.textContent || '').trim().slice(0, 40) : null} }""")
                before = pg.url
                new.click()
                try:
                    pg.wait_for_url(lambda url: url != before and "note=" in url, timeout=15000)
                    opened = True
                except Exception:  # noqa: BLE001
                    opened = False
                detail = dict(first_note=first_url, second_opened=opened, url_now=pg.url.replace(base, ""),
                              button_before_second_click=info,
                              requests_after_second_click=reqs[mark_req:][:25],
                              console_after_second_click=console[mark_con:][:12],
                              couldnt_create=pg.get_by_text("Couldn't create").count())
            except Exception as e:  # noqa: BLE001
                detail["error"] = u._first_lines(e)
            pg.screenshot(path=str(out / f"{label}.png"))
            record(label, page_errors=errors[:10], console_all=console[-12:], **detail)
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
