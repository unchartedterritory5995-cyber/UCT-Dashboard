"""Wave 10 lane DR-C live walk -- the Playwright script that produces
docs/notebook/proof/drc-<sha>/record.json (+ one screenshot per row). Kept in
tools/ so the evidence is reproducible; it is NOT a pytest rail.

Verifies the D-4 gallery (search box, category chips, "Preview before you use
it", breadth 9 -> 25) in a REAL browser against a real sandbox -- jsdom lays
out nothing, so a vitest pass is a claim about markup, never about what a
member's screen shows at 390 / 820 / 1200 px.

It reuses tools/notebook_perf_harness.py's Sandbox + provisioning recipe
(the SAME one wave 5/6/10B's own walks use) rather than re-deriving any of
it: `refuse_shared_root` / `port_busy` before boot, `Sandbox.start()` /
`.wait_healthy()` / `.stop()` for the launcher, `_provision()` for a PAID
walk account (signup, comp-access, email-verify, /api/auth/me paid_equiv
check), `_dismiss_intro()` for the one-per-tab welcome overlay, and
`read_integrity()` / `integrity_line()` for the shared-data-root snapshot
verdict this run's FIRST printed line always is.

Preconditions (identical shape to wave6's own walk header):
  * app/dist rebuilt from the tip under test (`npm run build` in app/);
  * the port free (refused, never killed); the data dir outside the shared
    root (refused);
  * a real Chromium via Playwright (local install, never CI).

Run from PowerShell (a Windows path through the Bash tool loses its
backslash) or with the data dir single-quoted:

    python tools/notebook_drc_walk.py --data-dir 'C:\\data-drcwalk' --port 8231 \
        --out docs/notebook/proof/drc-<sha>/record.json \
        --artifacts docs/notebook/proof/drc-<sha>

Rows (one per viewport width, 390 / 820 / 1200):
  D1  the gallery opens from the "Templates" door and shows the built-in catalog
      grouped by family, plus "Your templates" and the search/category
      toolbar (breadth: the catalog reads >= 20 built-ins)
  D2  the search box narrows the gallery to a known template by name
  D3  a category chip narrows the gallery to that family alone
  D4  "Preview" opens a READ-ONLY render of a template's body (a real
      heading renders as a DOM heading; the dialog's text never contains a
      raw TipTap JSON fragment) -- never raw JSON
  D5  "Use this template" creates the note and opens it in the editor, and
      the editor's own text contains a line unique to that template's body

Exit: 0 = every row PASS at every width and the sandbox's shared-data-root
snapshot reads CLEAN; 1 = a row FAILED; 2 = integrity not CLEAN/complete;
3 = refused / could not set up (SetupFailed, busy port, shared-root path).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))
from tools import notebook_perf_harness as H  # noqa: E402  (ONE sandbox + provisioning recipe)

WALK_EMAIL, WALK_PW = "drcwalk@local.dev", "LocalTest2026!"
WIDTHS = (390, 820, 1200)

# A template whose body has text distinctive enough to prove PREVIEW rendered
# the real body (never raw JSON) and that USE created a note with that body,
# never a coincidence of the title alone.
PROBE_TEMPLATE_LABEL = "Mistake Log"
PROBE_HEADING = "The rule that got broken"
SEARCH_QUERY = "mistake log"
CATEGORY_LABEL = "Mindset"


def _shot(pg, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pg.screenshot(path=str(path), full_page=False)


def _dump(pg, debug_dir: Path, tag: str) -> None:
    debug_dir.mkdir(parents=True, exist_ok=True)
    try:
        pg.screenshot(path=str(debug_dir / f"debug-{tag}.png"), full_page=True)
    except Exception as e:  # noqa: BLE001 -- best-effort diagnostics
        print(f"  (debug screenshot failed for {tag}: {e})")
    try:
        (debug_dir / f"debug-{tag}.txt").write_text(
            f"url={pg.url}\ntitle={pg.title()}\n\n{pg.locator('body').inner_text()[:6000]}",
            encoding="utf-8",
        )
    except Exception as e:  # noqa: BLE001
        print(f"  (debug text dump failed for {tag}: {e})")


def _open_template_gallery(pg, debug_dir: Path, width: int) -> None:
    """The "Templates" door (NotebookTab.jsx `setPickerOpen(true)`) -> the
    Sheet-wrapped gallery. "+ New note" beside it is a SEPARATE, direct blank
    create (`createNote()`) -- not this door, and not touched by this walk.

    If the door itself is already an inline gallery (the empty-notebook
    state), that also satisfies the check -- either way `[data-template-gallery]`
    is what this function guarantees is on screen when it returns."""
    try:
        if pg.locator('[data-template-gallery]').count() == 0:
            pg.get_by_role("button", name="Templates", exact=True).click(timeout=15000)
        pg.wait_for_selector('[data-template-gallery]', timeout=15000)
    except Exception:
        _dump(pg, debug_dir, f"landed-{width}")
        raise


def _walk_width(pg, base: str, width: int, out_dir: Path, errors: list[str]) -> dict:
    row: dict = {"width": width}
    pg.set_viewport_size({"width": width, "height": 900})
    # ?view=all -- a brand-new account (zero notes) lands on Wave H's bare-root
    # "Research Home" otherwise (isHome = !noteId && !hasActiveFilters &&
    # !viewAll && !isTrashView), whose only create door is "Start a note"
    # (an IMMEDIATE blank note, no picker at all) -- ?view=all is what the
    # sidebar's own "All notes" row sets, and it is what carries the real
    # "+ New note" toolbar door this walk is here to exercise.
    pg.goto(f"{base}/journal/notebook?view=all")
    H._dismiss_intro(pg)
    pg.wait_for_load_state("networkidle", timeout=20000)

    # D1 -- open the gallery (Templates door), breadth + grouping.
    _open_template_gallery(pg, out_dir, width)
    card_keys = pg.eval_on_selector_all(
        '[data-template-key]', "els => els.map(e => e.getAttribute('data-template-key'))")
    row["builtin_card_count"] = len(card_keys)
    row["family_groups"] = pg.eval_on_selector_all(
        '[data-template-gallery] .famLabel, [data-template-gallery] [id^="member-templates-label"]',
        "els => els.map(e => e.textContent)")
    _shot(pg, out_dir / f"gallery-{width}.png")
    d1 = len(card_keys) >= 20
    row["D1_gallery_opens_and_breadth"] = d1
    if not d1:
        errors.append(f"{width}: D1 -- only {len(card_keys)} built-in cards (want >= 20)")

    # D2 -- search narrows the gallery.
    search = pg.get_by_role("searchbox", name="Search templates")
    search.fill(SEARCH_QUERY)
    pg.wait_for_timeout(150)
    narrowed = pg.eval_on_selector_all(
        '[data-template-key]', "els => els.map(e => e.getAttribute('data-template-key'))")
    _shot(pg, out_dir / f"search-{width}.png")
    d2 = narrowed == ["mistake-log"]
    row["D2_search_narrows"] = d2
    row["search_result_keys"] = narrowed
    if not d2:
        errors.append(f"{width}: D2 -- search {SEARCH_QUERY!r} narrowed to {narrowed}, want ['mistake-log']")
    search.fill("")
    pg.wait_for_timeout(150)

    # D3 -- a category chip narrows the gallery.
    pg.get_by_role("button", name=CATEGORY_LABEL, exact=True).click()
    pg.wait_for_timeout(150)
    mind_keys = pg.eval_on_selector_all(
        '[data-template-key]', "els => els.map(e => e.getAttribute('data-template-key'))")
    _shot(pg, out_dir / f"category-{width}.png")
    d3 = len(mind_keys) > 0 and "mistake-log" in mind_keys and len(mind_keys) < len(card_keys)
    row["D3_category_narrows"] = d3
    row["category_result_keys"] = mind_keys
    if not d3:
        errors.append(f"{width}: D3 -- category {CATEGORY_LABEL!r} gave {mind_keys}")
    pg.get_by_role("button", name="All", exact=True).click()
    pg.wait_for_timeout(150)

    # D4 -- Preview: a real render, never raw JSON.
    pg.get_by_role("button", name=f"Preview {PROBE_TEMPLATE_LABEL}").click()
    dialog = pg.get_by_role("dialog", name=PROBE_TEMPLATE_LABEL)
    dialog.wait_for(state="visible", timeout=10000)
    heading_visible = dialog.get_by_role("heading", name=PROBE_HEADING).count() > 0
    dialog_text = dialog.inner_text()
    no_raw_json = ('"type"' not in dialog_text) and ('"content"' not in dialog_text)
    _shot(pg, out_dir / f"preview-{width}.png")
    d4 = heading_visible and no_raw_json
    row["D4_preview_read_only_render"] = d4
    if not d4:
        errors.append(f"{width}: D4 -- heading_visible={heading_visible} no_raw_json={no_raw_json}")

    # D5 -- Use this template: creates the note, opens the editor with that body.
    dialog.get_by_role("button", name="Use this template").click()
    pg.wait_for_selector(".ProseMirror", timeout=15000)
    pg.wait_for_timeout(300)
    editor_text = pg.locator(".ProseMirror").inner_text()
    _shot(pg, out_dir / f"created-{width}.png")
    d5 = PROBE_HEADING in editor_text
    row["D5_use_creates_note_with_body"] = d5
    row["created_note_url"] = pg.url
    if not d5:
        errors.append(f"{width}: D5 -- editor text after Use did not contain {PROBE_HEADING!r}")

    row["pass"] = d1 and d2 and d3 and d4 and d5
    return row


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--out", required=True, help="path to write record.json")
    ap.add_argument("--artifacts", required=True, help="directory for screenshots")
    ap.add_argument("--tip", default=None, help="the commit sha under test (recorded, not verified)")
    args = ap.parse_args(argv)

    why = H.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if H.port_busy(args.port):
        print(f"REFUSED: port {args.port} is already answering -- pick a free one, never kill the incumbent")
        return 3

    out_dir = Path(args.artifacts)
    out_dir.mkdir(parents=True, exist_ok=True)
    log_path = out_dir / "sandbox.log"
    base = f"http://127.0.0.1:{args.port}"

    sb = H.Sandbox(args.data_dir, args.port, log_path)
    rows: list[dict] = []
    errors: list[str] = []
    setup_error: str | None = None
    started = sb.alive()
    try:
        sb.start()
        started = True
        # Measured on this box: a cold sandbox (cap_universe load, ticker-name
        # prewarm registration, etc.) does not answer /api/health for ~3 min
        # before `Application startup complete.` -- 90s undercounted it.
        if not sb.wait_healthy(base, 240.0):
            setup_error = "sandbox never answered /api/health"
        else:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                br = pw.chromium.launch()
                admin_ctx = br.new_context()
                ctx = br.new_context(viewport={"width": 1280, "height": 900})
                try:
                    H._provision(admin_ctx.request, ctx.request, base, member=(WALK_EMAIL, WALK_PW, "drcwalk"))
                except H.SetupFailed as e:
                    setup_error = str(e)
                else:
                    pg = ctx.new_page()
                    pg.on("pageerror", lambda e: errors.append(f"pageerror: {str(e)[:300]}"))
                    for width in WIDTHS:
                        rows.append(_walk_width(pg, base, width, out_dir, errors))
                br.close()
        # Hold the sandbox past its own +120s snapshot checkpoint so the
        # integrity verdict covers the whole run, not just the pre-boot line
        # -- only worth the wait once there is something to report.
        if setup_error is None:
            sb.wait_checkpoint(H.PREWARM, H.PREWARM_WAIT_S)
    finally:
        stop_how = sb.stop() if started else "never-started"

    integ = H.read_integrity(sb.integrity_path(), required=["pre-boot (baseline)", "shutdown"])
    line = H.integrity_line(integ, note=f"stop: {stop_how}", not_run=setup_error)
    print(line)

    record = {
        "walk": "notebook-drc",
        "tip": args.tip,
        "data_dir": args.data_dir,
        "port": args.port,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "setup_error": setup_error,
        "rows": rows,
        "errors": errors,
        "sandbox_integrity": integ,
        "sandbox_log": str(log_path),
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(f"record: {args.out}")

    if setup_error:
        return 3
    if not integ.get("clean"):
        return 2
    if errors or not all(r.get("pass") for r in rows):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
