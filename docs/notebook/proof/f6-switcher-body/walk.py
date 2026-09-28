"""Wave 10 F6, fix round 1: the quick switcher's body half, in a real browser, against a SANDBOX.

    python docs/notebook/proof/f6-switcher-body/walk.py --data-dir C:/data-w10f6 --port 8225

Boots `scripts/hub_sandbox_boot.py` (through tools/notebook_perf_harness.Sandbox, which stops it
the way it handles and reads its integrity log), signs in the sandbox admin and a comped member
through the app's own doors, seeds two notes through POST /api/j2/notes:
  * "Weekly plan <run>"  -- its BODY holds a word no title holds (`zqbodyword<run>`);
  * "Zq title <run>"     -- the control: a TITLE match for the prefix "zq".
Then at 1200 and 390 wide: opens the palette with Ctrl+K on /journal/notebook, types the word,
and records the option's accessible name, its visible text and its cue; presses Enter and
records where the page went. Then the control query ("zq title <run>") at the same width: the
title row must carry no cue.

The FIRST line of the result is the sandbox integrity verdict. Raw result: result.json beside
this file, plus a screenshot per width. Never C:\\data (the launcher refuses it).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO))

from tools import notebook_perf_harness as H  # noqa: E402

MEMBER = ("f6walk@local.dev", "LocalTest2026!", "f6walk")


def walk(base: str, run: str) -> dict:
    from playwright.sync_api import sync_playwright
    word = f"zqbodyword{run}"
    out = {"run": run, "word": word, "widths": {}}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = p.request.new_context()
        member_ctx = browser.new_context(viewport={"width": 1200, "height": 900})
        H._provision(admin, member_ctx.request, base, member=MEMBER)
        req = member_ctx.request
        body = {"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": f"Guidance held; the {word} line carried the quarter."}]}]}
        r = req.post(base + "/api/j2/notes", data={"title": f"Weekly plan {run}", "bodyJson": body})
        assert r.status in (200, 201), r.status
        body_note = r.json()["note"]["id"]
        r = req.post(base + "/api/j2/notes", data={"title": f"Zq title {run}"})
        assert r.status in (200, 201), r.status
        title_note = r.json()["note"]["id"]
        out["notes"] = {"body_match": body_note, "title_match": title_note}
        api = req.get(base + f"/api/j2/notes/switcher?q={word}&limit=8").json()
        out["api_answer"] = [{k: n[k] for k in ("id", "title", "matchTier", "strong", "matched")}
                             for n in api["notes"]]
        for width, height in ((1200, 900), (390, 844)):
            pg = member_ctx.new_page()
            pg.set_viewport_size({"width": width, "height": height})
            rec = {}
            pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
            H._dismiss_intro(pg)
            pg.wait_for_timeout(1200)

            def ask(q):
                pg.keyboard.press("Control+k")
                dlg = pg.get_by_role("dialog", name="Command palette")
                dlg.wait_for(state="visible", timeout=8000)
                box = dlg.get_by_role("combobox").first
                box.fill(q)
                return dlg

            dlg = ask(word)
            opt = dlg.get_by_role("option", name=f"Note: Weekly plan {run}", exact=False).first
            opt.wait_for(state="visible", timeout=10000)
            rec["options"] = [o.get_attribute("aria-label") or o.inner_text()
                              for o in dlg.get_by_role("option").all()]
            rec["aria_label"] = opt.get_attribute("aria-label")
            rec["visible_text"] = opt.inner_text()
            cue = opt.locator('[data-note-cue="in-text"]')
            rec["cue_count"] = cue.count()
            rec["cue_text"] = cue.first.inner_text() if cue.count() else None
            if cue.count():
                bb = cue.first.bounding_box()
                rec["cue_box"] = bb
                rec["cue_inside_viewport"] = bool(bb) and bb["x"] >= 0 and bb["x"] + bb["width"] <= width
                rec["cue_color"] = cue.first.evaluate("e => getComputedStyle(e).color")
            rec["page_scroll_width"] = pg.evaluate("() => document.documentElement.scrollWidth")
            shot = HERE / f"palette-{width}.png"
            pg.screenshot(path=str(shot))
            rec["screenshot"] = shot.name
            # Enter opens the highlighted row: arrow to the body row first if it is not active.
            for _ in range(12):
                if opt.get_attribute("aria-selected") == "true":
                    break
                pg.keyboard.press("ArrowDown")
            rec["selected_before_enter"] = opt.get_attribute("aria-selected")
            pg.keyboard.press("Enter")
            t0 = time.time()
            while time.time() - t0 < 8 and body_note not in pg.url:
                pg.wait_for_timeout(200)
            rec["url_after_enter"] = pg.url.replace(base, "")
            rec["opened_the_body_note"] = body_note in pg.url
            # the control: a title match carries no cue
            pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
            pg.wait_for_timeout(800)
            dlg = ask(f"zq title {run}")
            topt = dlg.get_by_role("option", name=f"Note: Zq title {run}", exact=False).first
            topt.wait_for(state="visible", timeout=10000)
            rec["control_aria_label"] = topt.get_attribute("aria-label")
            rec["control_cue_count"] = topt.locator("[data-note-cue]").count()
            out["widths"][str(width)] = rec
            pg.close()
        # clean up what this run created, through the product's own door
        out["cleanup"] = [req.delete(base + f"/api/j2/notes/{i}").status for i in (body_note, title_note)]
        browser.close()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="C:/data-w10f6")
    ap.add_argument("--port", type=int, default=8225)
    a = ap.parse_args()
    refusal = H.refuse_shared_root(a.data_dir)
    if refusal:
        print(refusal)
        return 3
    if H.port_busy(a.port):
        print(f"port {a.port} is busy -- refusing to walk an unknown server")
        return 3
    base = f"http://127.0.0.1:{a.port}"
    sb = H.Sandbox(a.data_dir, a.port, HERE / "sandbox.log")
    result, err = None, None
    sb.start()
    try:
        if not sb.wait_healthy(base, 240):
            err = "the sandbox never became healthy"
        else:
            # hold past the +15 s checkpoint before any write, as the harness does
            sb.wait_checkpoint("post-boot (+15s)", 90)
            result = walk(base, uuid.uuid4().hex[:6])
            sb.wait_checkpoint("post-prewarm (+120s)", 180)
    except Exception as e:  # noqa: BLE001 -- recorded, never swallowed
        err = f"{type(e).__name__}: {e}"
    finally:
        how = sb.stop()
    integ = H.read_integrity(sb.integrity_path(),
                             ["pre-boot (baseline)", "post-boot (+15s)", "post-prewarm (+120s)", H.SHUTDOWN])
    line = H.integrity_line(integ, note=f"stop: {how}")
    print(line)
    doc = {"integrity": line, "integrity_status": integ["status"], "checkpoints": integ["checkpoints"],
           "error": err, "result": result}
    (HERE / "result.json").write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(doc, indent=1))
    return 0 if (result and not err and integ["clean"]) else 1


if __name__ == "__main__":
    sys.exit(main())
