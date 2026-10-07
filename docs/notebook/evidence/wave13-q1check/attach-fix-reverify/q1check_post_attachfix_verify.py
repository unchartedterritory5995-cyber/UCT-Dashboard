"""Wave 13, lane 13Q-Q1check -- controller follow-up #2, POST-FIX formal
re-measurement. Same protocol as the earlier q1check_final_verify.py (the
post-remount-fix re-measurement that still showed 10/10 failure): 5 reps x 2
widths (1200/390), fresh context per rep, page.bring_to_front(), click the
real "+ New note" button, NO focus()/click of any kind from this script at
any point.

This run is against the build that includes the follow-up #2 fix in
NoteEditorPage.jsx (poll editor.view.dom.isConnected across animation frames
before firing the one-shot body focus).

Two checks per rep, matching the original:
  1. document.activeElement read at +100ms / +500ms / +2s -- is it inside
     .ProseMirror?
  2. the real member path: type characters with page.keyboard.type (no
     focus() first), then read the note's body back through the product's
     OWN API (GET /api/j2/notes/{id}) to see where the typed text landed.

R-RAW: raw dump committed before interpretation.
"""
import json
import os
import sys
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q1check")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

SCRATCH = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad")
DATA_DIR = SCRATCH / "q1check-postattachfix2-data"
OUT = SCRATCH / "q1check-postattachfix2-out"
PORT = 8651  # distinct from every other worktree's sandbox port on this box
MEMBER = ("w13q1postattach@local.dev", "LocalTest2026!", "w13q1postattach")
REPS = 5
TYPED = "the attach fix landed"

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

DUMP_JS = """() => {
  const el = document.activeElement;
  return {
    activeTag: el ? el.tagName : null,
    activeInPM: !!(el && el.closest && el.closest('.ProseMirror')),
  };
}"""


def main():
    box = h.Sandbox(str(DATA_DIR), PORT, OUT / "sandbox.log")
    base = f"http://127.0.0.1:{PORT}"
    box.start()
    rows = []
    try:
        healthy = box.wait_healthy(base, 300)
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
                        btn.first.click()
                        pg.wait_for_url("**/journal/notebook?*note=*", timeout=20000)
                        url = pg.url
                        note_id = url.split("note=", 1)[1].split("&", 1)[0] if "note=" in url else None
                        row["note_id"] = note_id

                        checkpoints = {}
                        for label, ms in (("t100", 100), ("t500", 400), ("t2000", 1500)):
                            pg.wait_for_timeout(ms)
                            checkpoints[label] = pg.evaluate(DUMP_JS)
                        row["checkpoints"] = checkpoints
                        row["active_in_pm_final"] = checkpoints["t2000"]["activeInPM"]

                        # The real member path -- type with NO focus() call first.
                        # NoteEditorPage's autosave debounce is ~800ms
                        # (NoteEditorPage.jsx: "re-armed the 800ms debounce") --
                        # wait safely past it before reading the save back, or
                        # the GET races the debounce and reads a pre-save body.
                        pg.keyboard.type(TYPED, delay=20)
                        pg.wait_for_timeout(1500)
                        got = seedctx.request.get(f"{base}/api/j2/notes/{note_id}")
                        note = got.json().get("note") if got.status == 200 else None
                        title_val = (note or {}).get("title") or ""
                        body_text = ""
                        if note and note.get("bodyJson"):
                            body_text = " ".join(w13q.text_of(note["bodyJson"]))
                        row["typed_landed_in_title"] = TYPED in title_val
                        row["typed_landed_in_body"] = TYPED in body_text
                        row["page_errors"] = errors
                    except Exception as e:  # noqa: BLE001
                        row["driver_error"] = f"{type(e).__name__}: {str(e)[:400]}"
                    finally:
                        try:
                            name = f"postattachfix-{width_key}-r{rep}.png"
                            pg.screenshot(path=str(OUT / name))
                            row["screenshot"] = name
                        except Exception:  # noqa: BLE001
                            pass
                        ctx.close()
                    print(f"{width_key} rep{rep}: note={row.get('note_id')} "
                          f"activeInPM_final={row.get('active_in_pm_final')} "
                          f"typed_in_body={row.get('typed_landed_in_body')} "
                          f"typed_in_title={row.get('typed_landed_in_title')}", flush=True)
                    rows.append(row)
    finally:
        stop_how = box.stop()
        out_path = OUT / "results.json"
        out_path.write_text(json.dumps({"meta": {"stop_how": stop_how, "typed": TYPED},
                                         "rows": rows}, indent=2, default=str), encoding="utf-8")
        print("WROTE", out_path, flush=True)


if __name__ == "__main__":
    main()
