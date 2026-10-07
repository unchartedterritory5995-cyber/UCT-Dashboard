"""Wave 13 lane Q1-check -- step 1 measurement.

Measures, with NO instrument help (no focus()/click from this script after the
note is created), whether a freshly-created BLANK note's text cursor actually
lands in the note BODY, in a genuinely foreground page
(`page.bring_to_front()`), at 1200px and 390px, headless (this environment has
no display; headless is one of the two forms the task accepts).

For each of 5 repetitions per width:
  1. A brand-new browser context + page (mirrors tools/notebook_w13q_clicks.py
     ::run_one's own per-row context shape) is brought to the front BEFORE
     navigation.
  2. The real "+ New note" control (`[data-tour="new-note"]`) is clicked --
     the actual member door, not a deep link.
  3. document.activeElement is read at +100ms, +500ms, +2000ms from the click,
     with NO focus() or click call from this script in between.
  4. A real member path: `page.keyboard.type(...)` types a few characters
     with no prior focus()/click, then the product's OWN saved note (GET
     /api/j2/notes/{id}) is read back to see whether the characters landed in
     the title or the body.

Writes raw JSON to OUT/results.json. This file is committed BEFORE any
interpretation (R-RAW).
"""
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q1check")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

SCRATCH = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad")
DATA_DIR = SCRATCH / "q1check-data"
OUT = SCRATCH / "q1check-out"
PORT = 8627
MEMBER = ("w13q1check@local.dev", "LocalTest2026!", "w13q1check")

DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

os.environ.update(w13q.SANDBOX_FLAGS)
os.environ.setdefault("FMP_API_KEY", "")
os.environ.setdefault("FINNHUB_API_KEY", "")
os.environ.setdefault("ALPHAVANTAGE_API_KEY", "")

WIDTHS = {
    "1200": {"width": 1200, "height": 900},
    "390": {"width": 390, "height": 844},
}
REPS = 5
READ_AT_MS = (100, 500, 2000)

ACTIVE_ELEMENT_JS = """() => {
  const el = document.activeElement;
  const pm = document.querySelector('.ProseMirror');
  const titleEl = document.querySelector('[data-note-title]');
  return {
    tag: el ? el.tagName : null,
    isTitle: !!(el && el.hasAttribute && el.hasAttribute('data-note-title')),
    inPM: !!(el && el.closest && el.closest('.ProseMirror')),
    pmExists: !!pm,
    titleExists: !!titleEl,
    hasFocusDoc: document.hasFocus(),
    visibilityState: document.visibilityState,
  };
}"""


def extract_text(node, out):
    if isinstance(node, dict):
        if isinstance(node.get("text"), str):
            out.append(node["text"])
        for v in node.get("content") or []:
            extract_text(v, out)
    elif isinstance(node, list):
        for v in node:
            extract_text(v, out)


def body_text(body_json):
    out = []
    extract_text(body_json, out)
    return "".join(out)


def main():
    box = h.Sandbox(str(DATA_DIR), PORT, OUT / "sandbox.log")
    base = f"http://127.0.0.1:{PORT}"
    box.start()
    results = {"meta": {"port": PORT, "data_dir": str(DATA_DIR), "member": MEMBER[0],
                         "headless": True, "read_at_ms": list(READ_AT_MS)},
               "rows": []}
    try:
        healthy = box.wait_healthy(base, 300)
        results["meta"]["sandbox_healthy"] = healthy
        if not healthy:
            raise SystemExit("sandbox never became healthy")
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True)
            admin = br.new_context()
            seedctx = br.new_context()
            h._provision(admin.request, seedctx.request, base, member=MEMBER)
            state = seedctx.storage_state()

            for width_key, vp in WIDTHS.items():
                for rep in range(1, REPS + 1):
                    row = {"width": width_key, "rep": rep}
                    ctx = br.new_context(viewport=vp, has_touch=(width_key == "390"),
                                         is_mobile=(width_key == "390"), storage_state=state)
                    pg = ctx.new_page()
                    errors = []
                    pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
                    try:
                        pg.bring_to_front()
                        pg.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded", timeout=60000)
                        h._dismiss_intro(pg)
                        pg.wait_for_timeout(500)
                        btn = pg.locator('[data-tour="new-note"]').filter(visible=True)
                        btn.first.wait_for(state="visible", timeout=20000)
                        t0 = time.time()
                        btn.first.click()
                        pg.wait_for_url("**/journal/notebook?*note=*", timeout=20000)
                        url = pg.url
                        note_id = None
                        if "note=" in url:
                            note_id = url.split("note=", 1)[1].split("&", 1)[0]
                        row["note_id"] = note_id
                        row["click_to_url_ms"] = round((time.time() - t0) * 1000, 1)

                        readings = []
                        for target_ms in READ_AT_MS:
                            elapsed = (time.time() - t0) * 1000
                            wait_ms = max(0, target_ms - elapsed)
                            if wait_ms:
                                pg.wait_for_timeout(wait_ms)
                            info = pg.evaluate(ACTIVE_ELEMENT_JS)
                            info["t_ms"] = round((time.time() - t0) * 1000, 1)
                            info["target_ms"] = target_ms
                            readings.append(info)
                        row["readings"] = readings
                        row["in_body_at_2s"] = readings[-1]["inPM"]

                        # Real member path: type with NO focus()/click from this script.
                        marker = f"Q1CHK-{width_key}-R{rep}"
                        pg.keyboard.type(marker, delay=15)
                        row["typed_marker"] = marker

                        landed = "unknown"
                        note_after = None
                        if note_id:
                            deadline = time.time() + 8.0
                            while time.time() < deadline:
                                pg.wait_for_timeout(400)
                                try:
                                    r = ctx.request.get(base + f"/api/j2/notes/{note_id}")
                                except Exception:  # noqa: BLE001
                                    continue
                                if r.status != 200:
                                    continue
                                note = r.json().get("note") or {}
                                title = note.get("title") or ""
                                btxt = body_text(note.get("bodyJson"))
                                if marker in title or marker in btxt:
                                    note_after = {"title": title, "body_text": btxt[:300]}
                                    if marker in title and marker in btxt:
                                        landed = "both"
                                    elif marker in title:
                                        landed = "title"
                                    else:
                                        landed = "body"
                                    break
                            else:
                                # last read for evidence even if the marker never appeared
                                try:
                                    r = ctx.request.get(base + f"/api/j2/notes/{note_id}")
                                    if r.status == 200:
                                        note = r.json().get("note") or {}
                                        note_after = {"title": note.get("title") or "",
                                                      "body_text": body_text(note.get("bodyJson"))[:300]}
                                except Exception:  # noqa: BLE001
                                    pass
                                landed = "neither"
                        row["typed_landed"] = landed
                        row["note_after"] = note_after
                        row["page_errors"] = errors
                    except Exception as e:  # noqa: BLE001 -- a driver failure is recorded, not hidden
                        row["driver_error"] = f"{type(e).__name__}: {str(e)[:400]}"
                    finally:
                        try:
                            name = f"q1check-{width_key}-r{rep}.png"
                            pg.screenshot(path=str(OUT / name))
                            row["screenshot"] = name
                        except Exception:  # noqa: BLE001
                            pass
                        ctx.close()
                    print(json.dumps(row, default=str)[:400], flush=True)
                    results["rows"].append(row)
    finally:
        stop_how = box.stop()
        results["meta"]["stop_how"] = stop_how
        (OUT / "results.json").write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
        print("WROTE", OUT / "results.json", flush=True)


if __name__ == "__main__":
    main()
