"""The exit-bar door audit for the Notebook P0 discoverability work (Task 14): is every door the
2026-10-11 audit graded HARD or HIDDEN now findable, at 1280 and at 390, in a REAL browser?

WHY IT EXISTS. The 2026-10-11 audit (docs/notebook/discoverability-audit-2026-10-11.md on branch
notebook-discover-1011) graded 53 features: 9 HARD, 7 HIDDEN. Its script stayed in a session scratch
dir. Tasks 1 to 13 changed how members find sixteen of them, and "zero HIDDEN" has to be a
measurement, not a claim. jsdom lays nothing out, so a door being above the fold, uncovered and
labelled cannot be a unit-test fact. This is the committed instrument, and it is re-runnable.

THE TABLE. tools/notebook_door_audit_doors.json, one entry per door (a bare JSON list; the field
list is in `validate_table`). Doors are reached by role and accessible name, never by CSS-module
class, so a restyle does not break the table and a rename does (which is the point).

WHAT IT DOES. Attaches to an already-serving sandbox (see Precondition). For each viewport it signs
in a FRESH paid member, adds the sample notebook through the UI (the way a new member with notes
gets chart notes), and for each door loads Research Home, makes the door's presses, and measures the
target in the page: found and visible, getBoundingClientRect() against innerHeight (above the
fold), whether `elementFromPoint` at its centre lands on the target or inside it (uncovered) AFTER a
scrollIntoView when it started below the fold, whether it carries visible text (a label) or only an
aria-label (icon only), and how many viewport heights of scrolling it needed.

THE VERDICT (`verdict`, pure and tested):
  EASY          visible, above the fold, uncovered, at most 2 steps.
  OK            visible and uncovered, at most 3 steps, and either above the fold (3 steps) or one
                scroll away with a visible label.
  HARD          more than 3 steps; or below the fold with no visible label, or more than one scroll
                away; or on screen but covered by something else, or off the edge of the screen.
  HIDDEN        not reachable from the path.
  NOT_MEASURED  the setup failed (a flag off in this sandbox, a member that could not be made, a
                step that never reached the page). NEVER a pass.
  NO_DOOR       the row declares `door: false`: nothing was built, a written reason is required.
`steps` is the number of presses BEFORE the target is on screen (opening a note is one); the
audit's own count also pressed the control, so every row also records `clicks_audit` = steps + 1.
A row's verdict is its WORST viewport.

EXIT: 0 when no row is HIDDEN and every HARD, NO_DOOR and NOT_MEASURED row carries a written
`reason`; 1 otherwise; 2 when nothing was measured or the positive control did not behave.

R-HON: the POSITIVE CONTROL runs first at each viewport and is not skippable. Four synthetic doors
on Research Home, each with the answer it must give: an absent target must read HIDDEN, a covered
one (a transparent overlay is injected) HARD, one pushed three screens down HARD, and a plain
visible button EASY. If any control answers otherwise the run is VOID (exit 2): a tool that cannot
fail has no PASS worth printing.
R-RAW: doors-raw.json (the measurements, no verdict in it) is written and never touched again
BEFORE any verdict is computed; doors.json repeats it with the verdicts; doors.md is the table.

Precondition: a sandbox from THIS tree (app/dist rebuilt) is serving, booted through --serve so the
Personal API gate is on as it is in production (the stock c2 set leaves it off):
    python tools/notebook_door_audit.py --serve --data-root '<dir>' --sandbox-out '<dir>' --tip <sha>
Usage:
    python tools/notebook_door_audit.py --base http://127.0.0.1:8132 --out docs/notebook/evidence --tip <sha>
    python tools/notebook_door_audit.py --self-check     (no browser: the verdict function on known cases)
    ... --only 11,15      run only those audit rows (the evidence is marked partial)
Never kills anything; never touches C:\\data (the sandbox owns its data dir).
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

TABLE_PATH = Path(__file__).resolve().with_name("notebook_door_audit_doors.json")
VIEWPORTS = ("1280", "390")
REQUIRED_AUDIT_ROWS = (11, 15, 23, 24, 26, 29, 32, 33, 34, 35, 39, 40, 41, 42, 46, 53)
SEVERITY = {"EASY": 0, "OK": 1, "NOT_MEASURED": 2, "NO_DOOR": 3, "HARD": 4, "HIDDEN": 5}
MEASURED = ("EASY", "OK", "HARD", "HIDDEN")
SAMPLE_BUTTON = "Add a sample notebook"
TOP_PATH = "/journal/notebook"


# ── pure: the verdict, the table, the exit code (tests/test_notebook_door_audit.py) ─────────────

def verdict(m: dict) -> str:
    """One measurement -> one verdict. Pure. See the module docstring for the rules.

    Keys read: setup_failed, found, steps, above_fold, uncovered, labelled (default True),
    scroll_screens (default 1 when below the fold).

    "Above the fold" (measured in the page, see MEASURE_JS) is: the target's top edge is above the
    bottom of the window AND so is its centre. The brief's rule is the first half; the second keeps
    a control whose top 17 px peeks over the edge (measured at 390: the setups link, the Notices
    box) from reading as on screen to a member who sees a sliver."""
    if m.get("setup_failed"):
        return "NOT_MEASURED"
    if not m.get("found"):
        return "HIDDEN"
    if not m.get("uncovered", True):
        return "HARD"                 # on screen, but a press lands on something else (or off the edge)
    steps = int(m.get("steps", 0))
    if steps > 3:
        return "HARD"
    if m.get("above_fold"):
        return "EASY" if steps <= 2 else "OK"
    # below the fold: a label and one scroll make it OK, an icon or a long scroll make it HARD
    if not m.get("labelled", True):
        return "HARD"
    if int(m.get("scroll_screens", 1)) > 1:
        return "HARD"
    return "OK"


def row_verdict(row: dict, per_viewport: dict[str, dict]) -> tuple[str, dict[str, str]]:
    """The row's verdict (its worst viewport) and the verdict at each viewport."""
    if row.get("door") is False:
        return "NO_DOOR", {}
    each: dict[str, str] = {}
    for vp, m in per_viewport.items():
        v = verdict(m)
        if v == "HIDDEN" and row.get("unmeasurable_here"):
            v = "NOT_MEASURED"        # a door that cannot be exercised here is not measured, never hidden
        each[vp] = v
    if not each:
        return "NOT_MEASURED", {}
    return max(each.values(), key=lambda v: SEVERITY[v]), each


def has_reason(row: dict) -> bool:
    return bool(str(row.get("reason") or "").strip())


def exit_code(results: list[dict]) -> int:
    """results: [{"row": <table row>, "verdict": str}]. 2 = nothing measured; 1 = the bar fails."""
    if not any(r["verdict"] in MEASURED for r in results):
        return 2
    for r in results:
        v, row = r["verdict"], r["row"]
        if v == "HIDDEN":
            return 1
        if v in ("HARD", "NO_DOOR", "NOT_MEASURED") and not has_reason(row):
            return 1
    return 0


def validate_table(rows) -> list[str]:
    """Why the table is malformed; empty = well-formed. Pure."""
    why: list[str] = []
    if not isinstance(rows, list) or not rows:
        return ["the table is not a non-empty list"]
    seen = set()
    for i, r in enumerate(rows):
        tag = f"row {i} ({r.get('feature') if isinstance(r, dict) else r!r})"
        if not isinstance(r, dict):
            why.append(f"{tag}: not an object")
            continue
        for k in ("feature", "audit_row", "path", "steps", "viewports"):
            if k not in r:
                why.append(f"{tag}: missing {k}")
        if r.get("feature") in seen:
            why.append(f"{tag}: duplicate feature name")
        seen.add(r.get("feature"))
        if not isinstance(r.get("audit_row"), int):
            why.append(f"{tag}: audit_row is not an int")
        if not set(r.get("viewports") or []) or not set(r.get("viewports") or []) <= set(VIEWPORTS):
            why.append(f"{tag}: viewports must be a non-empty subset of {VIEWPORTS}")
        if r.get("door") is False:
            if not has_reason(r):
                why.append(f"{tag}: door:false needs a written reason")
            continue
        if not r.get("target") and not r.get("target_by_viewport"):
            why.append(f"{tag}: no target")
        for t in [r.get("target"), *(r.get("target_by_viewport") or {}).values()]:
            if t is None:
                continue
            if not (("css" in t) or ("role" in t and "name" in t)):
                why.append(f"{tag}: a target needs role+name or css: {t}")
        for s in [*(r.get("steps") or []), *[x for v in (r.get("steps_by_viewport") or {}).values() for x in v]]:
            if not (isinstance(s, dict) and len(s) == 1 and next(iter(s)) in STEP_KINDS):
                why.append(f"{tag}: bad step {s}")
            elif "click" in s and "|" not in s["click"]:
                why.append(f"{tag}: a click step is 'role|name': {s}")
        if r.get("unmeasurable_here") and not has_reason(r):
            why.append(f"{tag}: unmeasurable_here needs a written reason")
    missing = sorted(set(REQUIRED_AUDIT_ROWS) - {r.get("audit_row") for r in rows if isinstance(r, dict)})
    if missing:
        why.append(f"audit rows with no entry: {missing}")
    return why


STEP_KINDS = ("click", "click_css", "hover_css", "open_note", "type")
COUNTED = ("click", "click_css", "open_note", "type")      # a hover only reveals; it is not a press


# Known answers for the verdict function. `--self-check` runs them; a wrong expectation makes it
# exit non-zero, which tests/test_notebook_door_audit.py proves by feeding it one.
CASES: list[tuple[str, dict, str]] = [
    ("visible, above the fold, one step", {"found": True, "above_fold": True, "steps": 1, "uncovered": True}, "EASY"),
    ("visible, above the fold, two steps", {"found": True, "above_fold": True, "steps": 2, "uncovered": True}, "EASY"),
    ("visible, above the fold, three steps", {"found": True, "above_fold": True, "steps": 3, "uncovered": True}, "OK"),
    ("not found", {"found": False}, "HIDDEN"),
    ("not found, whatever else it says", {"found": False, "above_fold": True, "steps": 0, "uncovered": True}, "HIDDEN"),
    ("below the fold, four steps", {"found": True, "above_fold": False, "steps": 4, "uncovered": True}, "HARD"),
    ("above the fold but four steps", {"found": True, "above_fold": True, "steps": 4, "uncovered": True}, "HARD"),
    ("below the fold, labelled, one scroll", {"found": True, "above_fold": False, "steps": 1, "uncovered": True,
                                              "labelled": True, "scroll_screens": 1}, "OK"),
    ("below the fold, icon only", {"found": True, "above_fold": False, "steps": 1, "uncovered": True,
                                   "labelled": False, "scroll_screens": 1}, "HARD"),
    ("below the fold, three screens down", {"found": True, "above_fold": False, "steps": 1, "uncovered": True,
                                            "labelled": True, "scroll_screens": 3}, "HARD"),
    ("on screen but covered", {"found": True, "above_fold": True, "steps": 1, "uncovered": False}, "HARD"),
    ("setup failed", {"setup_failed": "flag off"}, "NOT_MEASURED"),
]
EXIT_CASES: list[tuple[str, list[dict], int]] = [
    ("every row fine", [{"row": {}, "verdict": "EASY"}, {"row": {}, "verdict": "OK"}], 0),
    ("a HIDDEN row", [{"row": {}, "verdict": "EASY"}, {"row": {"reason": "x"}, "verdict": "HIDDEN"}], 1),
    ("a HARD row with no reason", [{"row": {}, "verdict": "EASY"}, {"row": {}, "verdict": "HARD"}], 1),
    ("a HARD row with a blank reason", [{"row": {}, "verdict": "EASY"}, {"row": {"reason": "  "}, "verdict": "HARD"}], 1),
    ("a HARD row with a reason", [{"row": {}, "verdict": "EASY"}, {"row": {"reason": "owner call"}, "verdict": "HARD"}], 0),
    ("a NO_DOOR row with no reason", [{"row": {}, "verdict": "EASY"}, {"row": {}, "verdict": "NO_DOOR"}], 1),
    ("a NO_DOOR row with a reason", [{"row": {}, "verdict": "EASY"}, {"row": {"reason": "none built"}, "verdict": "NO_DOOR"}], 0),
    ("an unmeasured row with no reason", [{"row": {}, "verdict": "EASY"}, {"row": {}, "verdict": "NOT_MEASURED"}], 1),
    ("nothing measured", [{"row": {"reason": "x"}, "verdict": "NOT_MEASURED"}, {"row": {"reason": "x"}, "verdict": "NO_DOOR"}], 2),
    ("an empty run", [], 2),
]


def self_check(cases=None, exit_cases=None) -> list[str]:
    """Run the known answers; return what disagreed. Empty = the verdict logic holds."""
    wrong: list[str] = []
    for name, m, want in (CASES if cases is None else cases):
        got = verdict(m)
        if got != want:
            wrong.append(f"verdict: {name}: got {got}, want {want}")
    for name, results, want in (EXIT_CASES if exit_cases is None else exit_cases):
        got = exit_code(results)
        if got != want:
            wrong.append(f"exit_code: {name}: got {got}, want {want}")
    bad = validate_table(load_table())
    wrong.extend(f"table: {b}" for b in bad)
    return wrong


def load_table(path: Path = TABLE_PATH) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


# ── the browser half (imports are lazy: the pure half above must import with nothing installed) ─

# Synthetic doors on Research Home, each with the answer it MUST give. `inject_js` runs after the
# page loads; the first is the plain visible button that must read EASY, so a tool that answers
# "bad" for everything fails too.
OVERLAY_JS = """() => { const d = document.createElement('div'); d.setAttribute('data-door-audit-control', '');
  d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent'; document.body.appendChild(d) }"""
SPACER_JS = """() => { const s = document.querySelector('section[aria-label="Ask your Notebook"]');
  const d = document.createElement('div'); d.setAttribute('data-door-audit-control', '');
  d.style.cssText = 'height:3000px'; s.parentElement.insertBefore(d, s) }"""
CONTROLS: list[tuple[dict, str]] = [
    ({"feature": "control: a plain visible button", "audit_row": 0, "path": TOP_PATH, "steps": [],
      "target": {"role": "button", "name": "New note"}, "viewports": list(VIEWPORTS), "flag": None}, "EASY"),
    ({"feature": "control: a target that does not exist", "audit_row": 0, "path": TOP_PATH, "steps": [],
      "target": {"role": "button", "name": "No such control door audit"}, "viewports": list(VIEWPORTS), "flag": None}, "HIDDEN"),
    ({"feature": "control: a covered target", "audit_row": 0, "path": TOP_PATH, "steps": [],
      "target": {"role": "link", "name": "Open the setups board"}, "viewports": list(VIEWPORTS), "flag": None,
      "inject_js": OVERLAY_JS}, "HARD"),
    ({"feature": "control: a target three screens down", "audit_row": 0, "path": TOP_PATH, "steps": [],
      "target": {"role": "button", "name": "Ask a question about my notebook"}, "viewports": list(VIEWPORTS), "flag": None,
      "inject_js": SPACER_JS}, "HARD"),
]

NOTICE_STUB = [{"id": "door-audit-1", "type": "notebook_task_reminder", "title": "Tasks due today",
                "message": "2 tasks are due", "read": False,
                "data": {"research_url": "/journal/notebook?view=tasks"}}]

MEASURE_JS = r"""(el) => {
  const R = (b) => ({ left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1),
                      bottom: +b.bottom.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) })
  const text = (e) => { const c = e.cloneNode(true); c.querySelectorAll('[aria-hidden="true"], svg, .sr-only').forEach((n) => n.remove())
                        return (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim() }
  const b = el.getBoundingClientRect()
  // hit-test at the centre of the part that is on screen (a tall section's own centre can be off it)
  const cx = b.left + b.width / 2
  const y0 = Math.max(b.top, 0), y1 = Math.min(b.bottom, innerHeight)
  const cy = (y0 + y1) / 2
  const hit = (b.width > 0 && y1 > y0 && cx >= 0 && cx <= innerWidth) ? document.elementFromPoint(cx, cy) : null
  const desc = (e) => !e ? null : (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
      (e.getAttribute && e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label').slice(0, 40) + ']' : ''))
  return { rect: R(b), innerWidth, innerHeight, scrollY: Math.round(window.scrollY),
           centre: { x: +cx.toFixed(1), y: +cy.toFixed(1) },
           above_fold: b.top < innerHeight && (b.top + b.height / 2) < innerHeight && b.bottom > 0 && b.width > 0,
           on_screen_x: b.width > 0 && cx >= 0 && cx <= innerWidth,
           whole_width_on_screen: b.left >= 0 && b.right <= innerWidth + 0.5,
           uncovered: !!hit && (hit === el || el.contains(hit)),
           hit: desc(hit), tag: el.tagName.toLowerCase(), role: el.getAttribute('role'),
           aria_label: el.getAttribute('aria-label'), text: text(el).slice(0, 80), href: el.getAttribute('href') }
}"""


def parse_click(s: str) -> tuple[str, str]:
    role, name = s.split("|", 1)
    return role, name


def locate(pg, spec: dict):
    if "css" in spec:
        return pg.locator(spec["css"])
    name = spec["name"]
    if name.startswith("~"):
        return pg.get_by_role(spec["role"], name=re.compile(name[1:], re.I))
    return pg.get_by_role(spec["role"], name=name, exact=True)


def first_visible(loc, timeout: int):
    """The first visible match, waiting for it; None when none shows up in time."""
    v = loc.filter(visible=True)
    try:
        v.first.wait_for(state="visible", timeout=timeout)
        return v.first
    except Exception:  # noqa: BLE001
        return None


class RowFailure(Exception):
    """A step of the path could not be made: the door is not reachable from the path."""


def make_steps(pg, steps: list[dict], notes: dict, hovers: list[str], did: list[str], gone: list[str]) -> None:
    for s in steps:
        kind, val = next(iter(s.items()))
        if kind == "click":
            role, name = parse_click(val)
            el = first_visible(locate(pg, {"role": role, "name": name}), 6000)
            if el is None:
                raise RowFailure(f"click {val}: not on screen")
            try:
                el.click(timeout=6000)
            except Exception as e:  # noqa: BLE001
                raise RowFailure(f"click {val}: {str(e).splitlines()[0][:160]}") from e
        elif kind == "click_css":
            el = first_visible(pg.locator(val), 6000)
            if el is None:
                raise RowFailure(f"click_css {val}: not on screen")
            el.click(timeout=6000)
        elif kind == "hover_css":
            hovers.append(val)
            el = first_visible(pg.locator(val), 8000)
            if el is None:
                raise RowFailure(f"hover_css {val}: not on screen")
            rest_pointer(pg, el)
        elif kind == "open_note":
            nid = next((i for t, i in notes.items() if val in t), None)
            if nid is None:
                raise SetupFailed(f"no note whose title contains {val!r}")
            pg.goto(pg.url.split("/journal")[0] + f"{TOP_PATH}?note={nid}", wait_until="domcontentloaded", timeout=60000)
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=45000)
        elif kind == "type":
            ed = first_visible(pg.locator(".ProseMirror"), 8000)
            if ed is None:
                raise RowFailure("type: no editor on screen")
            ed.click()
            pg.keyboard.press("End")
            pg.keyboard.type(val, delay=40)
        did.append(f"{kind} {val}" if kind != "type" else f"type {val!r}")
        pg.wait_for_timeout(700)      # let the press settle (a menu mounts, a route changes)
        if kind == "open_note":       # a new screen can carry its own first-visit tip
            pg.wait_for_timeout(1500)
            dismiss_nudges(pg, gone, f"after {kind}")


def settle(pg, el, tries: int = 12, gap: int = 400) -> bool:
    """Wait until the target's top edge has not moved for two reads in a row (a chart, a panel or
    an image above it is still loading and pushing it down); False when it never stopped. The
    position that is graded is the one a member who waited a moment would see."""
    last = None
    still = 0
    for _ in range(tries):
        top = el.evaluate("e => Math.round(e.getBoundingClientRect().top)")
        still = still + 1 if top == last else 0
        if still >= 2:
            return True
        last = top
        pg.wait_for_timeout(gap)
    return False


def rest_pointer(pg, el) -> None:
    """Put the pointer on the visible part of `el` WITHOUT scrolling. Locator.hover() scrolls the
    element to the middle of the window first, and for a block taller than half the window that
    parks its top edge under the note's sticky bar: the instrument would then report the sticky
    bar as covering a toolbar that a member, who scrolls with a wheel, first meets uncovered."""
    box = el.bounding_box()
    vp = pg.viewport_size
    if not box or not vp:
        return
    x = min(max(box["x"] + box["width"] / 2, 1), vp["width"] - 1)
    y = min(max(box["y"] + min(box["height"] / 2, 60), 1), vp["height"] - 1)
    pg.mouse.move(x, y)
    pg.wait_for_timeout(250)


class SetupFailed(Exception):
    """The measurement could not be set up (not the door's fault)."""


def run_row(pg, base: str, row: dict, vp: str, notes: dict, me: dict, out: Path) -> dict:
    """Measure one door at one viewport. Always returns a dict, never raises."""
    steps = (row.get("steps_by_viewport") or {}).get(vp, row.get("steps") or [])
    spec = (row.get("target_by_viewport") or {}).get(vp, row.get("target"))
    m: dict = {"feature": row["feature"], "audit_row": row["audit_row"], "viewport": vp, "path": row["path"],
               "target": spec, "steps": sum(1 for s in steps if next(iter(s)) in COUNTED), "steps_taken": []}
    m["clicks_audit"] = m["steps"] + 1
    flag = row.get("flag")
    if flag:
        m["flag"] = {"key": flag.lower(), "state": me.get(flag.lower())}
        if me.get(flag.lower()) is not True:
            m["setup_failed"] = f"{flag} is not on for this member in this sandbox"
            m["found"] = False
            return m
    hovers: list[str] = []
    try:
        if "notices" in (row.get("stubs") or []):
            pg.route("**/api/alerts?limit=20*", lambda r: r.fulfill(status=200, content_type="application/json",
                                                                      body=json.dumps(NOTICE_STUB)))
            m["stubbed"] = "GET /api/alerts?limit=20 answered with one notebook_task_reminder row (page.route)"
        pg.goto(base + row["path"], wait_until="domcontentloaded", timeout=60000)
        pg.locator("section[aria-label='Ask your Notebook'], [data-tour='first-run']").first.wait_for(state="visible", timeout=45000)
        from notebook_perf_harness import _dismiss_intro
        _dismiss_intro(pg)
        pg.wait_for_timeout(1500)
        dismiss_nudges(pg, m.setdefault("nudges_dismissed", []), "load")
        if row.get("inject_js"):
            pg.evaluate(row["inject_js"])
            pg.wait_for_timeout(300)
        make_steps(pg, steps, notes, hovers, m["steps_taken"], m["nudges_dismissed"])
        dismiss_nudges(pg, m["nudges_dismissed"], "before measuring")
        el = first_visible(locate(pg, spec), 5000)
        if el is None:
            m["found"] = False
            m["failed_step"] = "the target never became visible"
            pg.screenshot(path=str(out / f"{slug(row['feature'])}-{vp}.png"))
            return m
        m["found"] = True
        m["settled"] = settle(pg, el)
        first = el.evaluate(MEASURE_JS)
        m["first"] = first
        m["above_fold"] = bool(first["above_fold"] and first["on_screen_x"])
        m["scroll_screens"] = 0
        m["screens_down"] = round(max(0.0, first["rect"]["bottom"]) / first["innerHeight"], 2)
        if not first["above_fold"]:
            m["scroll_screens"] = max(1, math.ceil(first["rect"]["bottom"] / first["innerHeight"]) - 1)
        after = first
        if not first["above_fold"]:
            el.evaluate("e => e.scrollIntoView({ block: 'center', inline: 'nearest' })")
            pg.wait_for_timeout(500)
            for h in hovers:               # a hover-only toolbar needs the pointer back on its block
                try:
                    rest_pointer(pg, pg.locator(h).first)
                except Exception:  # noqa: BLE001
                    pass
            pg.wait_for_timeout(300)
            after = el.evaluate(MEASURE_JS)
        m["after"] = after
        m["uncovered"] = bool(after["uncovered"] and after["on_screen_x"])
        m["covered_by"] = None if m["uncovered"] else (after.get("hit") or "off the edge of the screen")
        m["text"], m["href"], m["tag"] = after["text"], after["href"], after["tag"]
        m["labelled"] = bool(after["text"])
        m["icon_only"] = not after["text"]
        m["scrolled"] = not first["above_fold"]
        el.evaluate("e => { e.style.outline = '3px solid #ff2d55'; e.style.outlineOffset = '2px' }")
        pg.screenshot(path=str(out / f"{slug(row['feature'])}-{vp}.png"))
    except SetupFailed as e:
        m["setup_failed"] = str(e)
        m["found"] = False
    except RowFailure as e:
        m["found"] = False
        m["failed_step"] = str(e)
        try:
            pg.screenshot(path=str(out / f"{slug(row['feature'])}-{vp}.png"))
        except Exception:  # noqa: BLE001
            pass
    except Exception as e:  # noqa: BLE001 -- the page itself would not load: the setup, not the door
        m["setup_failed"] = f"{type(e).__name__}: {str(e).splitlines()[0][:200]}"
        m["found"] = False
    return m


NUDGES = ("Not now", "Got it", "Dismiss tip")
# Five notes opened fill Research Home's Recent notes (ResearchHome.jsx RECENT_NOTES_SHOWN = 5).
OPEN_TO_FILL_RECENTS = ("Research: how a base", "AAPL pullback", "NVDA leadership", "MSFT base breakout", "Pre-market checklist")


def dismiss_nudges(pg, gone: list[str], where: str) -> None:
    """One press each on whatever first-visit nudge is on screen right now (see settle_member)."""
    for name in NUDGES:
        for _ in range(3):
            b = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
            if not b.count():
                break
            b.first.click()
            gone.append(f"{where}: {name}")
            pg.wait_for_timeout(400)


def settle_member(pg, base: str, notes: dict) -> dict:
    """Put the member in ONE stated state, so a door's position is a property of the product and
    not of how many screens this run happened to visit first.
      1. The first-visit nudges (the tour offer, the Meet Compass banner, a tip) are dismissed on
         the screens the doors live on, one press each, as a member does. They show or not
         depending on what the member was already shown, and each moves everything below it by
         about 80 to 110 px.
      2. Five notes are opened, so Research Home's Recent notes is FULL (five rows, its maximum).
         Every note a door's steps open adds a recent row until the list is full, which moved
         every door below it by about 50 px a row, run to run, depending on the order of the table.
    A member who has used the Notebook for a week is in this state; a member with one note has a
    shorter home, so a door on Research Home reads a little higher for them. What was dismissed and
    how many recent rows the home then had are recorded in the evidence."""
    gone: list[str] = []

    def visit(path: str, wait_ms: int = 3500) -> None:
        pg.goto(base + path, wait_until="domcontentloaded", timeout=60000)
        pg.wait_for_timeout(wait_ms)
        dismiss_nudges(pg, gone, path)

    visit(TOP_PATH)
    visit(f"{TOP_PATH}?view=all")
    for frag in OPEN_TO_FILL_RECENTS:
        nid = next((i for k, i in notes.items() if frag in k), None)
        if nid:
            visit(f"{TOP_PATH}?note={nid}")
    visit(TOP_PATH, 4500)
    rows = pg.locator("[data-recent-notes] a[href*='note='], [data-recent-notes] button").count()
    return {"nudges_dismissed": gone, "recent_note_rows": rows}


def member_for(browser, admin_req, base: str, vp: str):
    """A fresh paid member with the sample notebook added through the UI (the way a new member
    gets notes and chart notes). Returns (ctx, email, me, {title: id})."""
    import notebook_fin_walk as C
    ctx, email, me = C.member(browser, admin_req, base, f"da{vp}", vp)
    pg = ctx.new_page()
    C.goto(pg, base, TOP_PATH)
    C.settle_first_run(pg)
    btn = pg.get_by_role("button", name=SAMPLE_BUTTON)
    btn.first.wait_for(state="visible", timeout=40000)
    btn.first.click()
    for _ in range(120):
        if len(C.notes_list(ctx, base)) >= 5:
            break
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(2500)
    notes = {n.get("title"): n.get("id") for n in C.notes_list(ctx, base)}
    state = settle_member(pg, base, notes)
    pg.close()
    if len(notes) < 5:
        raise SetupFailed(f"the sample notebook did not land ({len(notes)} notes)")
    return ctx, email, me, notes, state


def audit(base: str, out: Path, tip: str, only: set[int] | None) -> int:
    import notebook_fin_walk as C
    import notebook_perf_harness as h
    from playwright.sync_api import sync_playwright

    stamp = out.name.split("door-audit-", 1)[-1]
    table = load_table()
    bad = validate_table(table)
    if bad:
        print("the door table is malformed:\n  " + "\n  ".join(bad))
        return 2
    rows = [r for r in table if not only or r["audit_row"] in only]
    raw: dict = {"stamp": stamp, "base": base, "tip": tip, "tool": "tools/notebook_door_audit.py",
                 "partial": bool(only), "only": sorted(only) if only else None, "viewports": list(VIEWPORTS),
                 "status": "INCOMPLETE (the run did not finish)", "members": {}, "control": [], "measures": []}

    def save_raw(path: Path):
        path.write_text(json.dumps(raw, indent=1, ensure_ascii=False, default=str) + "\n", encoding="utf-8", newline="\n")

    save_raw(out / "doors-raw.json")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            admin = browser.new_context()
            h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
            for vp in VIEWPORTS:
                ctx = None
                try:
                    ctx, email, me, notes, state = member_for(browser, admin.request, base, vp)
                    raw["members"][vp] = {"email": email, "notes": len(notes), **state}
                    # R-HON: the control first, at this viewport, on this member's home. A fresh page per
                    # door, so an injected overlay or a read stub never reaches the next one.
                    for crow, want in CONTROLS:
                        pg = ctx.new_page()
                        cm = run_row(pg, base, crow, vp, notes, me, out)
                        pg.close()
                        cm["want"] = want
                        raw["control"].append(cm)
                        save_raw(out / "doors-raw.json")
                    for row in rows:
                        if vp not in row["viewports"] or row.get("door") is False:
                            continue
                        pg = ctx.new_page()
                        raw["measures"].append(run_row(pg, base, row, vp, notes, me, out))
                        pg.close()
                        save_raw(out / "doors-raw.json")
                except SetupFailed as e:
                    raw["members"][vp] = {"setup_failed": str(e)}
                    for row in rows:
                        if vp in row["viewports"] and row.get("door") is not False:
                            raw["measures"].append({"feature": row["feature"], "audit_row": row["audit_row"], "viewport": vp,
                                                    "found": False, "setup_failed": str(e), "steps": 0})
                finally:
                    if ctx is not None:
                        ctx.close()
                save_raw(out / "doors-raw.json")
            browser.close()
    except Exception as e:  # noqa: BLE001
        raw["status"] = f"INCONCLUSIVE: {type(e).__name__}: {str(e)[:300]}"
        save_raw(out / "doors-raw.json")
        print(raw["status"])
        print(f"raw: {out / 'doors-raw.json'}")
        return 2
    raw["status"] = "RAW COMPLETE (no verdict has been computed)"
    save_raw(out / "doors-raw.json")                       # R-RAW: on disk, final, before any verdict

    # ── interpretation starts here ─────────────────────────────────────────────────────────
    return interpret_and_write(raw, rows, out)


def interpret(raw: dict, rows: list[dict]) -> tuple[dict, list[dict], dict, int, list[str]]:
    """The raw measurements -> verdicts. Pure given its arguments; touches no browser and no file."""
    control_bad = []
    for cm in raw["control"]:
        got = verdict(cm)
        cm["verdict"] = got
        if got != cm["want"]:
            control_bad.append(f"{cm['feature']} [{cm['viewport']}]: answered {got}, must answer {cm['want']}")
    by_row: dict[str, dict[str, dict]] = {}
    for m in raw["measures"]:
        by_row.setdefault(m["feature"], {})[m["viewport"]] = m
    results = []
    for row in rows:
        v, each = row_verdict(row, by_row.get(row["feature"], {}))
        results.append({"row": row, "verdict": v, "viewports": each})
    code = exit_code(results)
    accepted = [r for r in results if r["verdict"] in ("HARD", "NO_DOOR", "NOT_MEASURED")]
    status = "VOID: the positive control did not behave" if control_bad else (
        (f"PASS, with {len(accepted)} rows resting on a written reason ({', '.join(str(r['row']['audit_row']) for r in accepted)})"
         if accepted else "PASS") if code == 0 else ("FAIL" if code == 1 else "INCONCLUSIVE"))
    if control_bad:
        code = 2
    final = {**raw, "status": status, "control_breaks": control_bad, "exit_code": code,
             "resting_on_a_reason": [{"audit_row": r["row"]["audit_row"], "feature": r["row"]["feature"], "verdict": r["verdict"]}
                                     for r in accepted],
             "results": [{"feature": r["row"]["feature"], "audit_row": r["row"]["audit_row"], "verdict": r["verdict"],
                          "viewports": r["viewports"], "reason": r["row"].get("reason"), "note": r["row"].get("note")}
                         for r in results]}
    return final, results, by_row, code, control_bad


def interpret_and_write(raw: dict, rows: list[dict], out: Path) -> int:
    final, results, by_row, code, control_bad = interpret(raw, rows)
    (out / "doors.json").write_text(json.dumps(final, indent=1, ensure_ascii=False, default=str) + chr(10), encoding="utf-8", newline=chr(10))
    (out / "doors.md").write_text(render_md(final, results, by_row), encoding="utf-8", newline=chr(10))
    counts: dict[str, int] = {}
    for r in results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    print(f"CONTROL: {'all four behaved' if not control_bad else 'BROKEN'}")
    for b in control_bad:
        print("  CONTROL BREAK:", b)
    for r in results:
        per = "  ".join(f"{vp}:{v}" for vp, v in r["viewports"].items())
        print(f"  row {r['row']['audit_row']:>2} {r['verdict']:<12} {per:<24} {r['row']['feature']}")
        for vp, m in by_row.get(r["row"]["feature"], {}).items():
            if m.get("setup_failed") or m.get("failed_step"):
                print(f"           [{vp}] {m.get('setup_failed') or m.get('failed_step')}")
    print("COUNTS:", ", ".join(f"{k} {counts[k]}" for k in sorted(counts, key=lambda k: SEVERITY[k])))
    print(f"{final['status']}  exit {code}  raw: {out / 'doors-raw.json'}")
    return code


def reinterpret(out: Path) -> int:
    """Re-derive doors.json and doors.md from an existing doors-raw.json and the CURRENT table (so a
    reason written after the run is read, and a verdict rule changed after it is applied). The raw
    file is read, never written: R-RAW."""
    raw = json.loads((out / "doors-raw.json").read_text(encoding="utf-8"))
    only = set(raw.get("only") or [])
    rows = [r for r in load_table() if not only or r["audit_row"] in only]
    return interpret_and_write(raw, rows, out)


def render_md(final: dict, results: list[dict], by_row: dict) -> str:
    lines = [f"# Door audit {final['stamp']}", "",
             f"tip `{final['tip']}`; base `{final['base']}`; status **{final['status']}**; exit {final.get('exit_code')}"
             + ("; **partial**" if final.get("partial") else ""), "",
             "`steps` = presses before the target is on screen; `audit` = steps + 1 (the audit's own count presses the control too).",
             "", f"Control (R-HON): {'all four synthetic doors behaved' if not final.get('control_breaks') else 'BROKEN: ' + '; '.join(final['control_breaks'])}.",
             "Member state: " + "; ".join(f"{vp}: sample notebook, {m.get('recent_note_rows')} recent rows, nudges dismissed {len(m.get('nudges_dismissed') or [])}"
                                          for vp, m in final.get("members", {}).items()) + ".",
             "", "| audit row | door | verdict | 1280 | 390 | reason or note |", "|---|---|---|---|---|---|"]

    def cell(m, v=None):
        if not m:
            return "-"
        if m.get("setup_failed"):
            return f"not measured: {m['setup_failed']}"
        if not m.get("found"):
            return f"not found ({m.get('failed_step', '')})"
        return (f"{v or verdict(m)}: steps {m['steps']} (audit {m['clicks_audit']}), "
                f"{'above' if m['above_fold'] else 'below'} the fold ({m.get('screens_down')} screens down)"
                f"{', one scroll' if m.get('scrolled') and m.get('scroll_screens', 1) <= 1 else (', ' + str(m.get('scroll_screens')) + ' scrolls' if m.get('scrolled') else '')}"
                f", {'uncovered' if m['uncovered'] else 'COVERED by ' + str(m['covered_by'])}"
                f", {'icon only' if m.get('icon_only') else 'labelled'}")

    for r in results:
        per = by_row.get(r["row"]["feature"], {})
        lines.append(f"| {r['row']['audit_row']} | {r['row']['feature']} | **{r['verdict']}** | {cell(per.get('1280'), r['viewports'].get('1280'))} | "
                     f"{cell(per.get('390'), r['viewports'].get('390'))} | {' '.join(x for x in (r['row'].get('reason'), r['row'].get('note')) if x).replace('|', '/')} |")
    return "\n".join(lines) + "\n"


# ── booting the sandbox the audit attaches to ───────────────────────────────────────────────────

def serve(argv: list[str]) -> int:
    """fin_walk's c2 sandbox, with every Notebook switch the ledger records as armed on web. The
    stock c2 set misses NOTEBOOK_PERSONAL_API_ENABLED (it is not in the auth payload's gate list),
    which hides the iPhone Shortcut door that production shows."""
    import notebook_fin_walk as C
    original = C.flag_sets

    def patched():
        fs = original()
        ledger = json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"]
        led = ledger if isinstance(ledger, dict) else {f.get("name"): f for f in ledger}
        armed = sorted(n for n, f in led.items() if isinstance(f, dict) and f.get("status") == "armed"
                       and "web" in (f.get("where") or []) and n.startswith("NOTEBOOK_") and n not in C.NOT_MEMBER_GATES)
        fs["c2"] = sorted(set(fs["c2"]) | set(armed))
        return fs

    C.flag_sets = patched
    ap = argparse.ArgumentParser(prog="notebook_door_audit.py --serve")
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--sandbox-out", required=True)
    ap.add_argument("--port", type=int, default=8132)
    ap.add_argument("--tip", required=True)
    a = ap.parse_args(argv)
    return C.main(["--config", "c2", "--data-root", a.data_root, "--port", str(a.port), "--out", a.sandbox_out,
                   "--tip", a.tip, "--serve-only"])


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--serve" in argv:
        argv.remove("--serve")
        return serve(argv)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base")
    ap.add_argument("--out", help="parent dir; a door-audit-<UTC stamp>/ folder is made inside it")
    ap.add_argument("--tip", default="", help="the commit under test, recorded in the evidence")
    ap.add_argument("--only", default="", help="comma list of audit rows (the evidence is marked partial)")
    ap.add_argument("--self-check", action="store_true", help="run the verdict function on known cases and exit")
    ap.add_argument("--reinterpret", metavar="DIR", help="re-derive doors.json and doors.md from DIR/doors-raw.json (never rewrites the raw file)")
    a = ap.parse_args(argv)
    if a.self_check:
        wrong = self_check()
        for w in wrong:
            print("SELF-CHECK FAILED:", w)
        print("self-check: " + ("FAILED" if wrong else f"{len(CASES)} verdict cases, {len(EXIT_CASES)} exit cases, table well-formed: all hold"))
        return 1 if wrong else 0
    if a.reinterpret:
        return reinterpret(Path(a.reinterpret))
    if not a.base or not a.out:
        ap.error("--base and --out are required (or --self-check)")
    only = {int(x) for x in a.only.split(",") if x.strip()} or None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(a.out) / f"door-audit-{stamp}"
    out.mkdir(parents=True, exist_ok=True)
    return audit(a.base.rstrip("/"), out, a.tip, only)


if __name__ == "__main__":
    sys.exit(main())
