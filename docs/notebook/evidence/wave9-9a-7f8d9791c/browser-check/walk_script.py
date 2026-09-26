"""Lane 9A browser check: the pasteable probe in a real page, and protocol.md walked on UCT as written.

What it does, in a sandbox of its own (notebook_perf_harness.Sandbox -> scripts/hub_sandbox_boot.py,
stopped gracefully, integrity read), with its OWN account (w9walk@local.dev):
  1. seeds the corpus through import/confirm (the runner's own `seed`), opens All notes;
  2. PASTES the probe the way a DevTools console paste does: the file's text evaluated in the page's
     main world AFTER load (page.evaluate on the source) -- NOT add_init_script;
  3. walks protocol.md §4-§5 on UCT, op by op, exactly as written: selfTest, check absent, arm, the
     reps with the protocol's own navigation (a click on the card, Alt+Left back; the sidebar search
     box then Escape; Ctrl+K and the TWO-WORD prefix then Escape; the last paragraph, Ctrl+End, x;
     Ctrl+A / Ctrl+C in paste-payload.html, then + New note, the body, Ctrl+V; reload, paste the
     probe, arm('cold') before any click);
  4. writes every step's result to steps.json AS IT GOES, dumps and screenshots beside it.
Headless has no DevTools window to open or close; the console paste is the evaluate in (2).

usage: python walk.py <data-dir> <port> <corpus-dir> <out-dir>
"""
import json
import sys
import time
import traceback
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w9")
sys.path.insert(0, str(REPO / "tools"))
import notebook_bench_report as rep  # noqa: E402
import notebook_bench_uct as u  # noqa: E402
import notebook_perf_harness as h  # noqa: E402

data_dir, port, corpus, out = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
out.mkdir(parents=True, exist_ok=True)
(out / "dumps").mkdir(exist_ok=True)
manifest = json.loads((corpus / "corpus-manifest.json").read_text(encoding="utf-8"))
plan = {s["id"]: s for s in u.plan(manifest)}
SRC = rep.PROBE_FILE.read_text(encoding="utf-8")
steps = []
WALK_APP = "uct-sandbox-walk"


def record(name, ok, **detail):
    steps.append({"at": time.strftime("%H:%M:%S"), "step": name, "ok": bool(ok), **detail})
    (out / "steps.json").write_text(json.dumps(steps, indent=1) + "\n", encoding="utf-8")
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {json.dumps(detail)[:300]}", flush=True)


def shot(pg, name):
    try:
        pg.screenshot(path=str(out / f"{name}.png"))
    except Exception as e:  # noqa: BLE001
        record(f"screenshot {name}", False, error=str(e)[:200])


def dump(pg, op):
    text = pg.evaluate("([a, o]) => window.__uctBench.dump(a, o)", [WALK_APP, op])
    (out / "dumps" / f"{WALK_APP}__{op}__r1.json").write_text(text + "\n", encoding="utf-8")
    d = json.loads(text)
    why = rep.check_dump(d, version=rep.probe_version(), apps=(WALK_APP,))
    return d, why


def paste_probe(pg, where):
    pg.evaluate(SRC)                       # what a console paste does: the text, evaluated, after load
    v = pg.evaluate("() => window.__uctBench && window.__uctBench.version")
    record(f"probe pasted ({where})", v == rep.probe_version(), version=v)
    r = pg.evaluate("() => window.__uctBench.selfTest()")
    record(f"selfTest ({where})", r.get("ok"), ms=r.get("ms"), window=r.get("window"))
    return r


def attempts(pg, n, timeout=30000):
    pg.wait_for_function("n => window.__uctBench.status().attempts >= n", arg=n, timeout=timeout)


box = h.Sandbox(data_dir, port, out / "sandbox.log")
base = f"http://127.0.0.1:{port}"
box.start()
try:
    record("sandbox healthy", box.wait_healthy(base, 240), base=base, data_dir=data_dir)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
        h._provision(admin_ctx.request, ctx.request, base, member=("w9walk@local.dev", "LocalTest2026!", "w9walk"))
        ids = u.seed(ctx.request, base, corpus, manifest)
        record("corpus seeded through import/confirm", len(ids) == manifest["counts"]["total_notes"], notes=len(ids))
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.goto(base + "/journal/notebook?view=all")
        h._dismiss_intro(pg)
        pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)
        total = pg.get_by_text("of 992 notes").first
        total.wait_for(state="visible", timeout=30000)
        record("All notes shows 992", True, text=total.inner_text())
        shot(pg, "01-all-notes")
        paste_probe(pg, "All notes, after load")

        def walk(op_id, body):
            try:
                body(plan.get(op_id))
            except Exception as e:  # noqa: BLE001 -- recorded; the walk goes on
                record(f"{op_id} walk raised", False, error=" | ".join(str(e).splitlines()[:4])[:500])
                shot(pg, f"{op_id}-failure")
                try:
                    pg.goto(base + "/journal/notebook?view=all")
                    pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)
                    paste_probe(pg, f"after the {op_id} failure")
                except Exception as e2:  # noqa: BLE001
                    record("recovery failed", False, error=str(e2)[:300])

        def h1(step):
            card = pg.locator(u.card_selector(ids[step["note_key"]]))
            absent = not pg.evaluate("m => window.__uctBench.check(m)", step["marker"])
            record("H1 check(marker) reads absent", absent)
            pg.evaluate("o => window.__uctBench.arm('open', o)", dict(u.arm_options(step), reps=3))
            for k in range(1, 4):
                card.click()                                   # protocol: click the card
                attempts(pg, k)
                if k == 1:
                    shot(pg, "02-H1-note-open")
                pg.keyboard.press("Alt+ArrowLeft")             # protocol: Alt+Left (browser Back)
                card.wait_for(state="visible", timeout=30000)
            d, why = dump(pg, "H1")
            record("H1 walked: 3 reps, click then Alt+Left", why is None and len(d["samples"]) == 3,
                   samples=d["samples"], invalid=d["invalid"], press=d.get("press"), refused=why)

        def h4(step):
            pg.get_by_role("tab", name="Search notes").click()
            box_ = pg.get_by_label("Search your notes")
            pg.evaluate("o => window.__uctBench.arm('search', o)", dict(u.arm_options(step), reps=3))
            for k in range(1, 4):
                box_.click()
                pg.keyboard.type(step["query"], delay=60)      # a natural pace, never pasted
                attempts(pg, k)
                if k == 1:
                    shot(pg, "03-H4-result")
                pg.keyboard.press("Escape")                    # protocol: Escape clears the query
                pg.wait_for_function("t => !window.__uctBench.has(t)", arg=step["expected_title"], timeout=30000)
            d, why = dump(pg, "H4")
            record("H4 walked: rare term typed, row appears, Escape", why is None and len(d["samples"]) == 3,
                   samples=d["samples"], invalid=d["invalid"], refused=why)

        def h5(step):
            pg.evaluate("o => window.__uctBench.arm('search', o)", dict(u.arm_options(step), reps=3))
            for k in range(1, 4):
                pg.keyboard.press("Control+K")
                pg.get_by_label("Search a security, company, or note").wait_for(state="visible", timeout=15000)
                pg.keyboard.type(step["query"], delay=60)      # the TWO-WORD prefix
                attempts(pg, k)
                if k == 1:
                    shot(pg, "04-H5-row")
                pg.keyboard.press("Escape")
                pg.wait_for_function("t => !window.__uctBench.has(t)", arg=step["expected_title"], timeout=30000)
            d, why = dump(pg, "H5")
            record("H5 walked: Ctrl+K, two-word prefix, full-title row, Escape",
                   why is None and len(d["samples"]) == 3 and min(d["samples"] or [0]) > 5,
                   query=step["query"], samples=d["samples"], invalid=d["invalid"], refused=why)

        def h6(step):
            pg.locator(u.card_selector(ids[step["note_key"]])).click()
            pg.wait_for_function("m => window.__uctBench.has(m)", arg=step["last_marker"], timeout=60000)
            pg.evaluate("o => window.__uctBench.arm('typing', o)", u.arm_options(step))
            pg.locator(".ProseMirror p").last.click()          # protocol: click in the LAST paragraph
            pg.keyboard.press("Control+End")
            pg.keyboard.type("x" * 60, delay=40)
            try:
                pg.wait_for_function("() => window.__uctBench.status().samples >= 60", timeout=5000)
            except Exception:  # noqa: BLE001
                pass
            shot(pg, "05-H6-typed")
            d, why = dump(pg, "H6")
            record("H6 walked: last paragraph, Ctrl+End, 60 x", why is None and d["status"] == "COMPLETE",
                   n=len(d["samples"]), status=d["status"], refused=why)
            pg.keyboard.press("Alt+ArrowLeft")
            pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=30000)

        def h8_diagnostic(_step):
            """Runs 1 and 3 of the runner: '+ New note' created a note but the editor never showed.
            Is that the product or the instrument? A context with NO probe at all, the same
            account: click '+ New note' on All notes and record every URL the page goes to."""
            ctx2 = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce",
                                  storage_state=ctx.storage_state())
            p2 = ctx2.new_page()
            navs, logs = [], []
            p2.on("framenavigated", lambda f: navs.append(f.url.replace(base, "")) if f == p2.main_frame else None)
            p2.on("console", lambda m: logs.append(f"{m.type}: {m.text}"[:240]))
            p2.goto(base + "/journal/notebook?view=all")
            h._dismiss_intro(p2)
            p2.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)
            probe_present = p2.evaluate("() => typeof window.__uctBench !== 'undefined'")
            before = len(navs)
            p2.locator('[data-tour="new-note"]').first.click()
            opened = True
            try:
                p2.locator(".ProseMirror").first.wait_for(state="visible", timeout=15000)
            except Exception:  # noqa: BLE001
                opened = False
            shot(p2, "06a-H8-diagnostic-no-probe")
            record("H8 diagnostic: '+ New note' on All notes, NO probe in the page",
                   True, editor_opened=opened, probe_present=probe_present, url_now=p2.url.replace(base, ""),
                   urls_after_click=navs[before:], console_tail=logs[-8:])
            ctx2.close()

        def h8(step):
            # protocol: open paste-payload.html in the same Chrome, Ctrl+A, Ctrl+C
            src_pg = ctx.new_page()
            src_pg.goto((corpus / "paste-payload.html").resolve().as_uri())
            src_pg.keyboard.press("Control+A")
            src_pg.keyboard.press("Control+C")
            types = src_pg.evaluate("""async () => { try { const it = await navigator.clipboard.read();
                return it.flatMap((i) => i.types) } catch (e) { return ['ERROR ' + e.name + ': ' + e.message] } }""")
            record("H8 copy from paste-payload.html with Ctrl+A, Ctrl+C", "text/html" in types, clipboard_types=types)
            src_pg.close()
            pg.bring_to_front()
            if "text/html" not in types:
                raise RuntimeError("the protocol's copy step put no HTML on the clipboard here; nothing is faked")
            pg.evaluate("o => window.__uctBench.arm('paste', o)", dict(u.arm_options(step), reps=2))
            navs = []
            pg.on("framenavigated", lambda f: navs.append(f.url.replace(base, "")) if f == pg.main_frame else None)
            for k in range(1, 3):
                pg.locator('[data-tour="new-note"]').first.click()   # protocol: + New note
                try:
                    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=15000)
                except Exception:
                    record("H8 (probe in the page): the editor did not open after '+ New note'", False,
                           rep=k, urls_after_click=navs[-6:], url_now=pg.url.replace(base, ""))
                    raise
                pg.locator(".ProseMirror").first.click()             # into its body
                pg.keyboard.press("Control+V")
                attempts(pg, k)
                if k == 1:
                    shot(pg, "06-H8-pasted")
                pg.keyboard.press("Alt+ArrowLeft")
                pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=30000)
            d, why = dump(pg, "H8")
            record("H8 walked: new note, body, Ctrl+V", why is None and len(d["samples"]) == 2,
                   samples=d["samples"], invalid=d["invalid"], refused=why)

        def h9(step):
            pg.reload()                                        # protocol: reload (F5)
            pg.locator(u.GRID_CARD).first.wait_for(state="visible", timeout=60000)
            gone = pg.evaluate("() => typeof window.__uctBench === 'undefined'")
            record("H9 a reload loses the probe (it must be pasted again)", gone)
            pg.evaluate(SRC)                                   # paste the probe again
            msg = pg.evaluate("() => window.__uctBench.arm('cold')")   # BEFORE any click
            r = pg.evaluate("() => window.__uctBench.selfTest()")
            d, why = dump(pg, "H9")
            record("H9 walked: reload, paste, arm('cold') first, selfTest, dump",
                   why is None and len(d["samples"]) == 1 and r.get("ok"),
                   console=msg, lcp=d.get("lcp"), label=d.get("label"), samples=d["samples"], refused=why)
            shot(pg, "07-H9-after-reload")
            h._dismiss_intro(pg)

        walk("H1", h1)
        walk("H4", h4)
        walk("H5", h5)
        walk("H6", h6)
        walk("H8-diagnostic", h8_diagnostic)
        walk("H8", h8)
        walk("H9", h9)
        record("no page errors during the walk", not errors, errors=errors[:5])
        br.close()
except Exception as e:  # noqa: BLE001
    record("walk aborted", False, error=traceback.format_exc()[-800:])
finally:
    box.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
    how = box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    first = h.integrity_line(integ, f"stop: {how}")
    (out / "integrity-line.txt").write_text(first + "\n", encoding="utf-8")
    record("sandbox stopped; integrity", integ["clean"], status=integ["status"], stop=how)
    print(first)
