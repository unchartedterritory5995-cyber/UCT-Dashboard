"""Lane DR-F -- real-browser confirmation for the D-7/D-8/D-9 fixes (wave 10 10/10
program, clause 6a follow-up) plus the two surfaces DR-R could not independently
confirm (a populated Graph edge, a populated Tasks list).

Boots its OWN sandbox (tools/notebook_perf_harness.Sandbox, the same launcher DR-R
used), same production-armed FLAGS, no model key. Reuses drr_walk's own seed (six
notes, folder, tags, share/publish) and its OVERFLOW_JS/TARGETS_JS verbatim -- method
matches method with the re-review this follows up on.

  python docs/notebook/proof/drf-instrument/drf_walk.py --data-dir 'C:\\...\\drf-data' \\
      --port 8395 --out docs/notebook/proof/drf-<sha>/record.json \\
      --art docs/notebook/proof/drf-<sha>/shots --tip <sha>

Exit: 0 = ran end to end (rows may still individually record a finding -- read them);
2 = sandbox integrity not CLEAN; 3 = refused or never started.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools"))
sys.path.insert(0, str(REPO / "docs" / "notebook" / "proof" / "drr-instrument"))
import notebook_perf_harness as H  # noqa: E402
import drr_walk as W  # noqa: E402  (WALK_EMAIL/PW, FLAGS, OVERFLOW_JS, TARGETS_JS, HEADS_JS)

# ── D-7: the toggle that reveals the panel once a content-first mode collapses it ──
FOLDER_TOGGLE_JS = r"""
() => {
  const btn = document.querySelector('[aria-label="Show folders panel"]');
  return { present: !!btn, visible: btn ? btn.getClientRects().length > 0 : false };
}
"""

# ── D-9: is today's own timeline column actually inside the scroller's viewport? ──
TIMELINE_TODAY_JS = r"""
() => {
  const scroller = document.querySelector('[class*="scroller"]');
  if (!scroller) return { found: false };
  const cells = Array.from(scroller.querySelectorAll('th[data-bucket-key]'));
  // The component computes today's bucket internally and has no on-screen label
  // naming it, so the walk passes today's OWN key in via a global (set just before
  // this runs) rather than guessing it from styling.
  const key = window.__drfTodayKey;
  const cell = key ? scroller.querySelector(`th[data-bucket-key="${key}"]`) : null;
  if (!cell) return { found: false, cellCount: cells.length };
  const scRect = scroller.getBoundingClientRect();
  const cRect = cell.getBoundingClientRect();
  const inView = cRect.left >= scRect.left - 1 && cRect.right <= scRect.right + 1;
  return {
    found: true, scrollLeft: scroller.scrollLeft, cellCount: cells.length,
    scrollerBox: { left: Math.round(scRect.left), right: Math.round(scRect.right) },
    cellBox: { left: Math.round(cRect.left), right: Math.round(cRect.right) },
    inView,
  };
}
"""

GRAPH_STATE_JS = r"""
() => {
  // The legend is TWO separate spans ("<b>N</b> notes", "<b>M</b> links"), not one
  // joined string -- read each <b> beside its own unit word rather than regexing
  // the concatenated text, which drops the boundary between them.
  const legend = document.querySelector('[class*="legend"]');
  const spans = legend ? Array.from(legend.querySelectorAll('span')) : [];
  const read = (word) => {
    const s = spans.find((el) => el.textContent && el.textContent.includes(word));
    const b = s ? s.querySelector('b') : null;
    return b ? Number(b.textContent) : null;
  };
  return {
    notes: read('note'),
    links: read('link'),
    legendText: legend ? legend.textContent.trim() : null,
    canvasPresent: !!document.querySelector('canvas'),
  };
}
"""

TASKS_STATE_JS = r"""
() => {
  const emptyState = document.body.textContent.includes('No open tasks');
  const rows = document.querySelectorAll('[class*="list"] li [class*="row"]');
  return {
    emptyState,
    rowCount: rows.length,
    rowTexts: Array.from(rows).map((r) => (r.textContent || '').trim().slice(0, 80)),
    bodyHasSeededText: document.body.textContent.includes('Confirm the stop'),
  };
}
"""


def _capture(pg, tag, width, out_dir, rows, extra=None):
    fname = f"drf-{tag}-{width}.png"
    pg.screenshot(path=str(out_dir / fname))
    row = {"surface": tag, "width": width, "shot": fname}
    ov = pg.evaluate(W.OVERFLOW_JS)
    row["overflow_px"] = ov["docScrollW"] - ov["docClientW"]
    row["targets_lt_24"] = len(pg.evaluate(W.TARGETS_JS, 24))
    row["headings"] = pg.evaluate(W.HEADS_JS)
    row["folder_toggle"] = pg.evaluate(FOLDER_TOGGLE_JS)
    if extra:
        row.update(extra)
    rows.append(row)
    print(json.dumps(row), flush=True)
    return row


def _walk_d7(pg, base, out_dir, rows):
    """D-7: at 390, switching to a content-first mode via the icon row must collapse
    the folder panel (the 'Show folders panel' toggle appears) and give the view's own
    content the first screen; List stays untouched."""
    pg.goto(f"{base}/journal/notebook?view=all")
    H._dismiss_intro(pg)
    pg.wait_for_timeout(1200)
    _capture(pg, "list", 390, out_dir, rows)

    for view_id, label in (("table", "Table view"), ("board", "Board view"),
                            ("calendar", "Calendar view"), ("graph", "Graph view"),
                            ("timeline", "Timeline view"), ("tasks", "Tasks view")):
        try:
            pg.get_by_role("button", name=label, exact=True).click(timeout=8000)
            pg.wait_for_timeout(900)
        except Exception as e:  # noqa: BLE001
            rows.append({"surface": f"d7-{view_id}", "width": 390, "error": f"could not switch: {e}"[:200]})
            continue
        _capture(pg, f"d7-{view_id}", 390, out_dir, rows)


def _seed_link_and_task_via_api(req, ids: dict, base: str) -> dict:
    """Seeds the link and the task through the app's OWN API doors (a `PUT` with a
    `noteLink`/`taskItem` node in `bodyJson`, exactly the shapes
    `notes.py::_sync_note_links_and_embeds`/`note_tasks.extract_tasks` already parse and
    `tests/fixtures_note_tasks.json` already fixtures) rather than TYPING `[[query`
    into the editor and racing its debounced (150ms), network-backed suggestion popup.

    ⛔ WHY NOT TYPING: debugged live (drf_debug_link.py) against this same tree --
    typing does reach the popup and does fire a search (`GET /notes?q=Beta`), but the
    editor's OWN autosave `PUT` fires concurrently and the popup is gone by the time
    the result would have rendered (`popupPresent: false` immediately after). That is
    a real, separate, reproducible finding about the `[[` suggestion menu under a
    concurrent autosave -- worth its own investigation -- but it is not what this
    walk exists to test, and DR-R's own two timeouts against the same menu were the
    first evidence of it. Confirming the GRAPH and TASKS surfaces render does not
    depend on how the member's words got into the note; it depends on the app's own
    read path (`GET /notes/graph`, `GET /notes/tasks`) reflecting what SAVED."""
    out = {}
    link_body = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [
                {"type": "text", "text": "Alpha thesis NVDA -- seeded for the DR-F confirmation. See "},
                {"type": "noteLink", "attrs": {"noteId": ids["n2"]}},
            ]},
        ],
    }
    r = req.put(base + f"/api/j2/notes/{ids['n1']}", data={"bodyJson": link_body})
    out["link_put_status"] = r.status

    task_body = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [
                {"type": "text", "text": "Trade checklist -- AMD add -- seeded for the DR-F confirmation."}]},
            {"type": "taskList", "content": [
                {"type": "taskItem", "attrs": {"checked": False}, "content": [
                    {"type": "paragraph", "content": [
                        {"type": "text", "text": "Confirm the stop is under the swing low"}]}]},
                {"type": "taskItem", "attrs": {"checked": False}, "content": [
                    {"type": "paragraph", "content": [
                        {"type": "text", "text": "Trim a third at the first target"}]}]},
            ]},
        ],
    }
    r = req.put(base + f"/api/j2/notes/{ids['n6']}", data={"bodyJson": task_body})
    out["task_put_status"] = r.status

    # ── poll the app's own persisted state, bounded, instead of a fixed sleep ──
    deadline = time.time() + 20
    tasks_seen = 0
    while time.time() < deadline:
        r = req.get(base + "/api/j2/notes/tasks?status=open")
        if r.status == 200:
            body = r.json()
            tasks_seen = sum(1 for t in body.get("tasks", []) if t.get("noteId") == ids["n6"])
            if tasks_seen >= 2:
                break
        time.sleep(0.5)
    out["tasks_persisted"] = tasks_seen
    out["tasks_poll_seconds"] = round(20 - max(0, deadline - time.time()), 1)

    deadline = time.time() + 20
    edge_seen = False
    edge_count = None
    while time.time() < deadline:
        r = req.get(base + "/api/j2/notes/graph")
        if r.status == 200:
            body = r.json()
            edges = body.get("edges", [])
            edge_count = len(edges)
            edge_seen = any(
                {e.get("source"), e.get("target")} == {ids["n1"], ids["n2"]} for e in edges
            )
            if edge_seen:
                break
        time.sleep(0.5)
    out["edge_persisted"] = edge_seen
    out["edge_count_at_confirm"] = edge_count
    out["edge_poll_seconds"] = round(20 - max(0, deadline - time.time()), 1)
    return out


def _walk_d8(pg, base, out_dir, rows):
    """D-8: re-measure targets_lt_24 at 1200 on the six named surfaces."""
    pg.goto(f"{base}/journal/notebook?view=all")
    H._dismiss_intro(pg)
    pg.wait_for_timeout(1200)
    _capture(pg, "d8-list", 1200, out_dir, rows)

    for view_id, label in (("table", "Table view"), ("board", "Board view"),
                            ("timeline", "Timeline view")):
        pg.get_by_role("button", name=label, exact=True).click(timeout=8000)
        pg.wait_for_timeout(700)
        _capture(pg, f"d8-{view_id}", 1200, out_dir, rows)

    pg.get_by_role("button", name="Templates", exact=True).click(timeout=8000)
    pg.wait_for_selector("[data-template-gallery]", timeout=10000)
    pg.wait_for_timeout(400)
    _capture(pg, "d8-templates", 1200, out_dir, rows)
    pg.keyboard.press("Escape")

    pg.get_by_role("tab", name="Search notes", exact=True).click(timeout=5000)
    box = pg.get_by_label("Search your notes")
    box.click(timeout=5000)
    box.fill("thesis")
    pg.wait_for_timeout(700)
    _capture(pg, "d8-search", 1200, out_dir, rows)


def _walk_d9(pg, base, out_dir, rows):
    """D-9: Timeline Month view opens scrolled to today (or the latest activity)."""
    pg.goto(f"{base}/journal/notebook?view=all")
    H._dismiss_intro(pg)
    pg.wait_for_timeout(1000)
    pg.get_by_role("button", name="Timeline view", exact=True).click(timeout=8000)
    pg.wait_for_timeout(900)
    # Matches lib/calendar.js::todayET exactly (ET calendar day, not UTC) -- the
    # component's own anchor, so a probe taken near midnight UTC cannot disagree
    # with what NoteTimelineView actually scrolled to.
    today_key = pg.evaluate(
        "() => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',"
        "year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())",
    )
    pg.evaluate("(k) => { window.__drfTodayKey = k }", today_key)
    row = _capture(pg, "d9-timeline-month", 1200, out_dir, rows)
    row["today_key"] = today_key
    row["today_in_view"] = pg.evaluate(TIMELINE_TODAY_JS)
    return row


def _walk_confirm(pg, base, out_dir, rows, seed_out):
    """Graph edge + Tasks list, confirmed IN THE BROWSER after the poll above."""
    pg.goto(f"{base}/journal/notebook?view=all")
    H._dismiss_intro(pg)
    pg.wait_for_timeout(900)
    pg.get_by_role("button", name="Graph view", exact=True).click(timeout=8000)
    pg.wait_for_timeout(1500)
    row = _capture(pg, "confirm-graph", 1200, out_dir, rows)
    row["graph_state"] = pg.evaluate(GRAPH_STATE_JS)
    row["seed"] = {"edge_persisted": seed_out.get("edge_persisted"), "edge_count_at_confirm": seed_out.get("edge_count_at_confirm")}

    pg.goto(f"{base}/journal/notebook?view=tasks")
    H._dismiss_intro(pg)
    pg.wait_for_timeout(1200)
    row2 = _capture(pg, "confirm-tasks", 1200, out_dir, rows)
    row2["tasks_state"] = pg.evaluate(TASKS_STATE_JS)
    row2["seed"] = {"tasks_persisted": seed_out.get("tasks_persisted")}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--art", required=True)
    ap.add_argument("--tip", default=None)
    args = ap.parse_args(argv)

    why = H.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if H.port_busy(args.port):
        print(f"REFUSED: port {args.port} is already answering")
        return 3

    out_dir = Path(args.art)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{args.port}"
    import os
    os.environ.update(W.FLAGS)

    sb = H.Sandbox(args.data_dir, args.port, out_dir / "sandbox.log")
    rows: list[dict] = []
    errors: list[str] = []
    setup_error: str | None = None
    seed_out: dict = {}
    ids: dict = {}
    started = False
    try:
        sb.start()
        started = True
        if not sb.wait_healthy(base, 240.0):
            setup_error = "sandbox never answered /api/health"
        else:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                br = pw.chromium.launch()
                admin_ctx = br.new_context()
                seed_ctx = br.new_context(viewport={"width": 1280, "height": 900})
                try:
                    H._provision(admin_ctx.request, seed_ctx.request, base, member=(W.WALK_EMAIL, W.WALK_PW, "drf walk"))
                except H.SetupFailed as e:
                    setup_error = str(e)
                if setup_error is None:
                    ids = W._seed(seed_ctx.request, base)
                    seed_out = _seed_link_and_task_via_api(seed_ctx.request, ids, base)

                    ctx390 = br.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
                    H._signup_or_login(ctx390.request, base, W.WALK_EMAIL, W.WALK_PW, "drf walk")
                    pg390 = ctx390.new_page()
                    pg390.on("pageerror", lambda e: errors.append(f"pageerror 390: {str(e)[:300]}"))
                    try:
                        _walk_d7(pg390, base, out_dir, rows)
                    except Exception as e:  # noqa: BLE001
                        errors.append(f"d7: {type(e).__name__}: {e}")
                    ctx390.close()

                    ctx1200 = br.new_context(viewport={"width": 1200, "height": 900})
                    H._signup_or_login(ctx1200.request, base, W.WALK_EMAIL, W.WALK_PW, "drf walk")
                    pg1200 = ctx1200.new_page()
                    pg1200.on("pageerror", lambda e: errors.append(f"pageerror 1200: {str(e)[:300]}"))
                    try:
                        _walk_d8(pg1200, base, out_dir, rows)
                    except Exception as e:  # noqa: BLE001
                        errors.append(f"d8: {type(e).__name__}: {e}")
                    try:
                        _walk_d9(pg1200, base, out_dir, rows)
                    except Exception as e:  # noqa: BLE001
                        errors.append(f"d9: {type(e).__name__}: {e}")
                    try:
                        _walk_confirm(pg1200, base, out_dir, rows, seed_out)
                    except Exception as e:  # noqa: BLE001
                        errors.append(f"confirm: {type(e).__name__}: {e}")
                    ctx1200.close()
                br.close()
        if setup_error is None:
            sb.wait_checkpoint(H.PREWARM, H.PREWARM_WAIT_S)
    finally:
        stop_how = sb.stop() if started else "never-started"

    integ = H.read_integrity(sb.integrity_path(), required=["pre-boot (baseline)", "shutdown"])
    line = H.integrity_line(integ, note=f"stop: {stop_how}", not_run=setup_error)
    print(line)

    out = {
        "walk": "drf_walk", "tip": args.tip, "data_dir": args.data_dir, "port": args.port,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "setup_error": setup_error,
        "seed": seed_out, "ids": ids, "rows": rows, "errors": errors,
        "sandbox_integrity": integ,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    try:
        Path(args.out).with_name("sandbox.log").write_text(
            (out_dir / "sandbox.log").read_text(encoding="utf-8", errors="replace"), encoding="utf-8",
        )
    except OSError:
        pass

    if setup_error:
        return 3
    if not integ.get("clean", integ.get("ok")):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
