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

GRADED THE WAY THE AUDIT GRADES. The audit's rule (its "grading rule" and "counts by verdict" tables):
  EASY  visible where the task happens, 2 clicks or fewer, PLAIN LABEL, same on a phone
        (row 1 "Start a note": 1 click, label, above the fold).
  OK    3 clicks or one menu deep, or a label that is understood only after a look
        (row 14 Properties: 3 clicks; row 22 Dictation: 2 clicks, icon only; row 13 Today and
        row 45 Passed setups: 1 or 2 clicks and a scroll, with a label).
  HARD  4 or more steps (row 15: 5), or BELOW THE FOLD AND icon-only, or a phone control off screen
        (row 24, clipped), or 3 clicks plus a scroll (rows 39 and 40: "3 + scroll", no label help).
  HIDDEN  no door inside the Notebook.
A "click" COUNTS THE PRESS ON THE TARGET ITSELF, as the audit's does: opening a note, Details,
Add property and Add a formula is 4 clicks. `clicks` = presses made before the target is on screen,
plus one. (The audit also graded some rows by judgement it does not tabulate: rows 26 and 41 at 1
click plus a scroll were HARD for a confusing label and "the very bottom of home". The instrument
cannot grade that; it grades one scroll with a label OK, as rows 13 and 45 were.)

THE VERDICT (`verdict`, pure and tested):
  EASY          visible, above the fold, uncovered, at most 2 clicks, and a visible text label.
  OK            visible and uncovered and one of: 3 clicks above the fold; an icon-only control above
                the fold; at most 2 clicks and one scroll away with a visible label.
  HARD          4 or more clicks; below the fold with 3 or more clicks, with no visible label, or more
                than one scroll away; or on screen but covered by something else or off the edge.
  HIDDEN        not reachable from the path: the target is absent, or a step of the path cannot be
                made on a page that loaded.
  NOT_MEASURED  the page or the setup broke (a switch off in this sandbox, a member that could not be
                made, a page that would not load), or a door the table says cannot be exercised in a
                sandbox is absent after every step was made. NEVER a pass.
A row's verdict is its WORST viewport. A row that says `door: false` (nothing was built) is HIDDEN.

REASONS CLEAR ONLY THE VERDICT THEY ARE WRITTEN FOR. A row's `reason` is {"verdict": ..., "text": ...}.
A HARD row with a HARD reason is accepted; the same reason on a HIDDEN row, or a HARD reason on a
row that is now HIDDEN, clears nothing.

EXIT CODE (documented here because --help prints this text):
  0  no row is HIDDEN, every HARD row has a HARD reason, and nothing is NOT_MEASURED.
  1  the bar fails: a HIDDEN row, or a HARD row without a HARD reason.
  2  VOID: nothing was measured, the table is malformed, or the positive control did not behave.
  3  UNPROVEN: no row failed but at least one is NOT_MEASURED. Never 0: a door that was not measured
     has not met the bar, whatever reason is written beside it.
Priority 2 > 1 > 3 > 0.

TWO STATES, GRADED ON THE REALISTIC ONE. Every door is measured twice per viewport on a fresh
paid member with the sample notebook added through the UI and five notes opened (Recent notes full):
  realistic  what a member sees: the first-visit nudges (the tour offer, the Meet Compass banner,
             a tip) NOT dismissed, and the Notices box PRESENT (a resurfacing insight is served on
             the feed the box reads). GRADED.
  settled    the nudges dismissed and no notice: recorded beside it, never graded.

R-HON: the POSITIVE CONTROL runs first at each viewport and is not skippable. Six synthetic doors on
Research Home, each with the verdict it must give: a plain button EASY, an icon-only button
(its text visually hidden by inline style, not a class) OK, an absent target HIDDEN, a step of the
path that cannot be made HIDDEN (not NOT_MEASURED), a covered target HARD, a target three screens
down HARD. The control's verdicts then go through the SAME `exit_code` the real doors go through
(`control_exit_checks`): the unreasoned set must exit 1, the set whose HARD rows carry HARD reasons
must exit 0, a reason written for the wrong verdict must not clear a row, and a HIDDEN row must stay
1 whatever is written. Any wrong answer VOIDS the run (exit 2).

R-RAW, in this order: a run (`--base`) writes doors-raw.json (the measurements, the screenshots, the
sha256 of the door table that drove it, no verdict anywhere) and stops. `--reinterpret DIR` then
derives doors.json and doors.md from it and prints the exit code; it reads the raw file and never
writes it. Commit the raw directory before the interpretation.

Precondition: a sandbox from THIS tree (app/dist rebuilt) is serving, booted through --serve so the
Personal API gate is on as it is in production (the stock c2 set leaves it off):
    python tools/notebook_door_audit.py --serve --data-root '<dir>' --sandbox-out '<dir>' --tip <sha>
Usage:
    python tools/notebook_door_audit.py --base http://127.0.0.1:8132 --out docs/notebook/evidence --tip <sha>
    python tools/notebook_door_audit.py --reinterpret docs/notebook/evidence/door-audit-<stamp>
    python tools/notebook_door_audit.py --self-check     (no browser: the verdict and exit functions on known cases)
    ... --only 11,15      run only those audit rows (the evidence is marked partial)
Never kills anything; never touches C:\\data (the sandbox owns its data dir).
"""
from __future__ import annotations

import argparse
import hashlib
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
CONDITIONS = ("realistic", "settled")
GRADED = "realistic"
REQUIRED_AUDIT_ROWS = (11, 15, 23, 24, 26, 29, 32, 33, 34, 35, 39, 40, 41, 42, 46, 53)
SEVERITY = {"EASY": 0, "OK": 1, "NOT_MEASURED": 2, "HARD": 4, "HIDDEN": 5}
MEASURED = ("EASY", "OK", "HARD", "HIDDEN")
REASON_VERDICTS = ("HARD", "HIDDEN", "NOT_MEASURED")
SAMPLE_BUTTON = "Add a sample notebook"
TOP_PATH = "/journal/notebook"


# ── pure: the verdict, the table, the exit code (tests/test_notebook_door_audit.py) ─────────────

def clicks_of(m: dict) -> int:
    """The audit's click count: the presses made before the target is on screen, PLUS the press on
    the target itself. `clicks` is recorded by the runner; `steps` (presses before) is the fallback."""
    if "clicks" in m:
        return int(m["clicks"])
    if "clicks_audit" in m:
        return int(m["clicks_audit"])
    return int(m.get("steps", 0)) + 1


def verdict(m: dict) -> str:
    """One measurement -> one verdict. Pure. See the module docstring for the rules and the audit
    rows each one comes from.

    Keys read: setup_failed, found, clicks (or steps), above_fold, uncovered, labelled (default
    True), scroll_screens (default 1 when below the fold).

    "Above the fold" (measured in the page, see MEASURE_JS) is: the target's top edge is above the
    bottom of the window AND so is its centre, so a control whose top 17 px peeks over the edge does
    not read as on screen to a member who sees a sliver."""
    if m.get("setup_failed"):
        return "NOT_MEASURED"
    if not m.get("found"):
        return "HIDDEN"
    if not m.get("uncovered", True):
        return "HARD"          # audit HARD: "a phone control off screen" (row 24, clipped); a press lands elsewhere
    clicks = clicks_of(m)
    if clicks >= 4:
        return "HARD"          # audit HARD: "4+ steps" (row 15: 5 clicks)
    labelled = m.get("labelled", True)
    if m.get("above_fold"):
        # audit EASY needs a "plain label" (row 1); an icon-only control is OK at best (row 22: 2 clicks, icon only)
        return "EASY" if clicks <= 2 and labelled else "OK"
    # below the fold
    if clicks >= 3:
        return "HARD"          # audit rows 39 and 40: "3 + scroll", no above the fold -> HARD
    if not labelled:
        return "HARD"          # audit HARD: "below the fold and jargon or icon-only"
    if int(m.get("scroll_screens", 1)) > 1:
        return "HARD"          # more than one scroll away is not "one scroll"
    return "OK"                # audit rows 13 and 45: 1 or 2 clicks, a label, a scroll -> OK


def row_verdict(row: dict, per_viewport: dict[str, dict]) -> tuple[str, dict[str, str]]:
    """The row's verdict (its worst viewport) and the verdict at each viewport."""
    if row.get("door") is False:
        return "HIDDEN", {}           # nothing was built: the audit's HIDDEN, still
    each: dict[str, str] = {}
    for vp, m in per_viewport.items():
        v = verdict(m)
        # A door the table says cannot be exercised in a sandbox is NOT_MEASURED when every step was
        # made and the target is simply absent. A STEP that could not be made is HIDDEN, always.
        if v == "HIDDEN" and row.get("unmeasurable_here") and m.get("target_absent") and not m.get("step_failed"):
            v = "NOT_MEASURED"
        each[vp] = v
    if not each:
        return "NOT_MEASURED", {}
    return max(each.values(), key=lambda v: SEVERITY[v]), each


def reason_for(row: dict, v: str) -> str | None:
    """The written reason that clears verdict `v` on this row, or None. A reason clears only the
    verdict it was written for."""
    r = row.get("reason")
    if isinstance(r, dict) and r.get("verdict") == v and str(r.get("text") or "").strip():
        return str(r["text"])
    return None


def reason_clears(row: dict, v: str) -> bool:
    """Whether the row's written reason clears the exit bar at verdict `v`: only a HARD row with a HARD
    reason. A HIDDEN row is never cleared (a reason on it records why, nothing more) and a NOT_MEASURED
    row is never cleared either (it exits 3 whatever is written)."""
    return v == "HARD" and bool(reason_for(row, "HARD"))


def exit_code(results: list[dict]) -> int:
    """results: [{"row": <table row>, "verdict": str}]. See the module docstring: 2 void, 1 the bar
    fails, 3 unproven, 0 met."""
    if not any(r["verdict"] in MEASURED for r in results):
        return 2
    unproven = False
    for r in results:
        v, row = r["verdict"], r["row"]
        if v == "HIDDEN":
            return 1                         # no reason clears a door that is not there
        if v == "HARD" and not reason_for(row, "HARD"):
            return 1
        if v == "NOT_MEASURED":
            unproven = True
    return 3 if unproven else 0


STEP_KINDS = ("click", "click_css", "hover_css", "open_note", "type")
COUNTED = ("click", "click_css", "open_note", "type")      # a hover only reveals; it is not a press


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
        if "reason" in r:
            rs = r["reason"]
            if not (isinstance(rs, dict) and rs.get("verdict") in REASON_VERDICTS and str(rs.get("text") or "").strip()):
                why.append(f"{tag}: a reason is {{\"verdict\": one of {REASON_VERDICTS}, \"text\": ...}}")
        if r.get("door") is False:
            if "reason" not in r:
                why.append(f"{tag}: door:false needs a written reason (it records why; it clears nothing)")
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
        if r.get("unmeasurable_here") and not reason_for(r, "NOT_MEASURED"):
            why.append(f"{tag}: unmeasurable_here needs a NOT_MEASURED reason")
    missing = sorted(set(REQUIRED_AUDIT_ROWS) - {r.get("audit_row") for r in rows if isinstance(r, dict)})
    if missing:
        why.append(f"audit rows with no entry: {missing}")
    return why


def _m(clicks, above, **kw):
    return {"found": True, "above_fold": above, "clicks": clicks, "uncovered": True, **kw}


# Known answers for the verdict function. `--self-check` runs them; a wrong expectation makes it
# exit non-zero, which tests/test_notebook_door_audit.py proves by feeding it one.
CASES: list[tuple[str, dict, str]] = [
    ("audit row 1: one click, label, above the fold", _m(1, True), "EASY"),
    ("two clicks, label, above the fold", _m(2, True), "EASY"),
    ("audit row 14: three clicks, above the fold", _m(3, True), "OK"),
    ("audit row 22: two clicks, icon only", _m(2, True, labelled=False), "OK"),
    ("audit row 15: four clicks", _m(4, True), "HARD"),
    ("audit row 15: five clicks, below the fold", _m(5, False), "HARD"),
    ("audit rows 39 and 40: three clicks and a scroll", _m(3, False, labelled=True, scroll_screens=1), "HARD"),
    ("audit row 13: one click, a scroll, a label", _m(1, False, labelled=True, scroll_screens=1), "OK"),
    ("audit row 45: two clicks, a scroll, a label", _m(2, False, labelled=True, scroll_screens=1), "OK"),
    ("audit HARD rule: below the fold and icon only", _m(1, False, labelled=False, scroll_screens=1), "HARD"),
    ("more than one scroll away", _m(1, False, labelled=True, scroll_screens=3), "HARD"),
    ("audit row 24: on screen but covered or clipped", {"found": True, "above_fold": True, "clicks": 1, "uncovered": False}, "HARD"),
    ("not found", {"found": False}, "HIDDEN"),
    ("not found, whatever else it says", {"found": False, "above_fold": True, "clicks": 1, "uncovered": True}, "HIDDEN"),
    ("setup failed", {"setup_failed": "flag off"}, "NOT_MEASURED"),
    ("the brief's EASY case, in steps", {"found": True, "above_fold": True, "steps": 1, "uncovered": True}, "EASY"),
    ("the brief's HARD case, in steps", {"found": True, "above_fold": False, "steps": 4, "uncovered": True}, "HARD"),
]


def _r(v, **row):
    return {"row": row, "verdict": v}


HARD_OK = {"reason": {"verdict": "HARD", "text": "owner call"}}
EXIT_CASES: list[tuple[str, list[dict], int]] = [
    ("every row fine", [_r("EASY"), _r("OK")], 0),
    ("a HIDDEN row", [_r("EASY"), _r("HIDDEN")], 1),
    ("a HIDDEN row with a HIDDEN reason clears nothing", [_r("EASY"), _r("HIDDEN", reason={"verdict": "HIDDEN", "text": "none built"})], 1),
    ("a HARD row with no reason", [_r("EASY"), _r("HARD")], 1),
    ("a HARD row with a blank reason", [_r("EASY"), _r("HARD", reason={"verdict": "HARD", "text": "  "})], 1),
    ("a HARD row with a HARD reason", [_r("EASY"), _r("HARD", **HARD_OK)], 0),
    ("a HARD row with a reason written for HIDDEN", [_r("EASY"), _r("HARD", reason={"verdict": "HIDDEN", "text": "x"})], 1),
    ("a HARD row with a reason written for NOT_MEASURED", [_r("EASY"), _r("HARD", reason={"verdict": "NOT_MEASURED", "text": "x"})], 1),
    ("a NOT_MEASURED row never exits 0", [_r("EASY"), _r("NOT_MEASURED", reason={"verdict": "NOT_MEASURED", "text": "x"})], 3),
    ("a NOT_MEASURED row with no reason is still 3", [_r("EASY"), _r("NOT_MEASURED")], 3),
    ("a failure outranks an unproven row", [_r("EASY"), _r("NOT_MEASURED"), _r("HIDDEN")], 1),
    ("nothing measured", [_r("NOT_MEASURED"), _r("NOT_MEASURED")], 2),
    ("an empty run", [], 2),
]

# ── the positive control's exit check, pure so a test can break it ─────────────────────────────

C_EASY = "control: a plain visible button"
C_ICON = "control: an icon-only button above the fold"
C_ABSENT = "control: a target that does not exist"
C_STEP = "control: a step of the path that cannot be made"
C_COVERED = "control: a covered target"
C_FAR = "control: a target three screens down"
CONTROL_WANT = {C_EASY: "EASY", C_ICON: "OK", C_ABSENT: "HIDDEN", C_STEP: "HIDDEN", C_COVERED: "HARD", C_FAR: "HARD"}


def control_exit_checks(got: dict[str, str]) -> list[str]:
    """`got`: control feature -> the verdict the instrument measured for it. Runs the SAME `exit_code`
    the real doors go through, over the control's rows, and returns what it got wrong (empty = it
    reaches the exit code the way the bar needs):
      - the unreasoned set (a HIDDEN, a failed step, an unreasoned HARD) must exit 1;
      - the cleared set (EASY, OK and HARD rows with a HARD reason, nothing HIDDEN) must exit 0;
      - the same HARD rows with a reason written for another verdict must exit 1;
      - a HIDDEN row with a HIDDEN reason must exit 1."""
    wrong: list[str] = []
    plain = [{"row": {"feature": f}, "verdict": v} for f, v in got.items()]
    if exit_code(plain) != 1:
        wrong.append(f"the unreasoned control set exits {exit_code(plain)}, must exit 1")
    hard = [f for f, v in got.items() if v == "HARD"]
    safe = [f for f, v in got.items() if v in ("EASY", "OK")]
    cleared = ([{"row": {"feature": f}, "verdict": got[f]} for f in safe]
               + [{"row": {"feature": f, "reason": {"verdict": "HARD", "text": "control"}}, "verdict": "HARD"} for f in hard])
    if not hard or not safe or exit_code(cleared) != 0:
        wrong.append(f"the cleared control set exits {exit_code(cleared)}, must exit 0 (hard rows {len(hard)}, safe rows {len(safe)})")
    mis = ([{"row": {"feature": f}, "verdict": got[f]} for f in safe]
           + [{"row": {"feature": f, "reason": {"verdict": "HIDDEN", "text": "control"}}, "verdict": "HARD"} for f in hard])
    if exit_code(mis) != 1:
        wrong.append(f"HARD rows with a reason written for HIDDEN exit {exit_code(mis)}, must exit 1")
    hid = [f for f, v in got.items() if v == "HIDDEN"]
    cl = ([{"row": {"feature": f, "reason": {"verdict": "HIDDEN", "text": "control"}}, "verdict": "HIDDEN"} for f in hid]
          + [{"row": {"feature": f}, "verdict": got[f]} for f in safe])
    if not hid or exit_code(cl) != 1:
        wrong.append(f"a HIDDEN row with a HIDDEN reason exits {exit_code(cl)}, must exit 1")
    return wrong


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
    wrong.extend(f"control exit: {w}" for w in control_exit_checks(dict(CONTROL_WANT)))
    bad = validate_table(load_table())
    wrong.extend(f"table: {b}" for b in bad)
    return wrong


def load_table(path: Path = TABLE_PATH) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def table_sha256(path: Path = TABLE_PATH) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


# ── the browser half (imports are lazy: the pure half above must import with nothing installed) ─

OVERLAY_JS = """() => { const d = document.createElement('div'); d.setAttribute('data-door-audit-control', '');
  d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent'; document.body.appendChild(d) }"""
SPACER_JS = """() => { const s = document.querySelector('section[aria-label="Ask your Notebook"]');
  const d = document.createElement('div'); d.setAttribute('data-door-audit-control', '');
  d.style.cssText = 'height:3000px'; s.parentElement.insertBefore(d, s) }"""
# An icon-only button whose only text is visually hidden by INLINE style (no class a stylesheet could
# be blamed for): the label detector must read it as icon only, so it can never grade it EASY.
ICON_JS = """() => { const b = document.createElement('button'); b.setAttribute('data-door-audit-icon', '');
  b.setAttribute('aria-label', 'Door audit icon');
  b.style.cssText = 'position:fixed;left:50%;top:320px;width:44px;height:44px;z-index:2147483000;background:#333';
  b.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>' +
    '<span style="position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap">Hidden label</span>';
  document.body.appendChild(b) }"""


def _crow(feature: str, target: dict, **kw) -> dict:
    return {"feature": feature, "audit_row": 0, "path": TOP_PATH, "steps": [], "target": target,
            "viewports": list(VIEWPORTS), "flag": None, **kw}


CONTROLS: list[dict] = [
    _crow(C_EASY, {"role": "button", "name": "New note"}),
    _crow(C_ICON, {"css": "[data-door-audit-icon]"}, inject_js=ICON_JS),
    _crow(C_ABSENT, {"role": "button", "name": "No such control door audit"}),
    _crow(C_STEP, {"role": "button", "name": "New note"}, steps=[{"click": "button|No such step door audit"}]),
    _crow(C_COVERED, {"role": "link", "name": "Open the setups board"}, inject_js=OVERLAY_JS),
    _crow(C_FAR, {"role": "button", "name": "Ask a question about my notebook"}, inject_js=SPACER_JS),
]

# The feed Research Home's Notices box reads for a resurfaced note (GET /api/voice/insights, which
# answers 403 to a member without voice access; lib/notices.js turns kinds note_level_touch,
# note_big_move and note_date_due into rows). One insight, whose link opens a note of this member.
def resurfacing_body(note_id: str) -> str:
    return json.dumps({"insights": [{"id": 90001, "kind": "note_level_touch", "symbol": "AAPL",
                                     "headline": "AAPL reached a level you wrote down",
                                     "body": "The price touched the entry on your plan.",
                                     "link": f"/journal/notebook?note={note_id}", "dismissed_at": None}]})


MEASURE_JS = r"""(el) => {
  const R = (b) => ({ left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1),
                      bottom: +b.bottom.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) })
  // Visually hidden by COMPUTED style (a CSS-module class is hashed, so no class name can be matched):
  // not rendered, invisible, a box of two pixels or less, or clipped to nothing.
  const hidden = (e) => {
    const cs = getComputedStyle(e), r = e.getBoundingClientRect()
    return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0' ||
      (r.width <= 2 && r.height <= 2) ||
      /rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)/.test(cs.clip || '') ||
      /inset\(\s*(50|100)%/.test(cs.clipPath || '')
  }
  const vtext = (n) => {
    if (n.nodeType === 3) return n.textContent
    if (n.nodeType !== 1) return ''
    if (n.getAttribute('aria-hidden') === 'true' || n.tagName.toLowerCase() === 'svg' || hidden(n)) return ''
    if (n.tagName === 'SELECT') return (n.selectedOptions[0] || {}).textContent || ''
    return [...n.childNodes].map(vtext).join(' ')
  }
  const text = (e) => (e.tagName === 'SELECT' ? vtext(e) : [...e.childNodes].map(vtext).join(' ')).replace(/\s+/g, ' ').trim()
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
    """A step of the path could not be made on a page that loaded: the door is not reachable (HIDDEN)."""


class SetupFailed(Exception):
    """The page or the setup broke; not the door's doing (NOT_MEASURED)."""


def make_steps(pg, steps: list[dict], notes: dict, hovers: list[str], did: list[str], gone: list[str], quiet: bool) -> None:
    for s in steps:
        kind, val = next(iter(s.items()))
        try:
            if kind == "click":
                role, name = parse_click(val)
                el = first_visible(locate(pg, {"role": role, "name": name}), 6000)
                if el is None:
                    raise RowFailure(f"click {val}: not on screen")
                el.click(timeout=6000)
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
                try:
                    pg.goto(pg.url.split("/journal")[0] + f"{TOP_PATH}?note={nid}", wait_until="domcontentloaded", timeout=60000)
                    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=45000)
                except Exception as e:  # noqa: BLE001
                    raise SetupFailed(f"the note page would not load: {str(e).splitlines()[0][:160]}") from e
            elif kind == "type":
                ed = first_visible(pg.locator(".ProseMirror"), 8000)
                if ed is None:
                    raise RowFailure("type: no editor on screen")
                ed.click()
                pg.keyboard.press("End")
                pg.keyboard.type(val, delay=40)
        except (RowFailure, SetupFailed):
            raise
        except Exception as e:  # noqa: BLE001 -- the page was there; this step could not be made on it
            raise RowFailure(f"{kind} {val}: {str(e).splitlines()[0][:160]}") from e
        did.append(f"{kind} {val}" if kind != "type" else f"type {val!r}")
        pg.wait_for_timeout(700)      # let the press settle (a menu mounts, a route changes)
        if kind == "open_note":       # a new screen can carry its own first-visit tip
            pg.wait_for_timeout(1500)
            if quiet:
                dismiss_nudges(pg, gone, f"after {kind}")


def settle(pg, el, tries: int = 12, gap: int = 400) -> bool:
    """Wait until the target's top edge has not moved for two reads in a row (a chart, a panel or
    an image above it is still loading and pushing it down); False when it never stopped."""
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


def run_row(pg, base: str, row: dict, vp: str, notes: dict, me: dict, out: Path, cond: str) -> dict:
    """Measure one door at one viewport in one state. Always returns a dict, never raises.
    A failure of the load, the setup or the measuring is `setup_failed` (NOT_MEASURED); a step of the
    path that cannot be made on a page that loaded is `step_failed` (HIDDEN); every step made and the
    target absent is `target_absent` (HIDDEN, or NOT_MEASURED where the table says it cannot be
    exercised here)."""
    realistic = cond == "realistic"
    steps = (row.get("steps_by_viewport") or {}).get(vp, row.get("steps") or [])
    spec = (row.get("target_by_viewport") or {}).get(vp, row.get("target"))
    m: dict = {"feature": row["feature"], "audit_row": row["audit_row"], "viewport": vp, "condition": cond, "path": row["path"],
               "target": spec, "steps": sum(1 for s in steps if next(iter(s)) in COUNTED), "steps_taken": [],
               "nudges_dismissed": []}
    m["clicks"] = m["steps"] + 1          # the audit's count: the press on the target is a click
    shot = out / f"{slug(row['feature'])}-{vp}.png" if realistic else None
    flag = row.get("flag")
    if flag:
        m["flag"] = {"key": flag.lower(), "state": me.get(flag.lower())}
        if me.get(flag.lower()) is not True:
            m["setup_failed"] = f"{flag} is not on for this member in this sandbox"
            m["found"] = False
            return m
    hovers: list[str] = []
    phase = "load"
    try:
        stubs = list(row.get("stubs") or [])
        if realistic and "resurfacing" not in stubs and row["audit_row"] != 0:
            stubs.append("resurfacing")       # the Notices box is on the member's home
        if "resurfacing" in stubs:
            nid = next((i for t, i in notes.items() if "AAPL pullback" in t), None)
            pg.route("**/api/voice/insights", lambda r: r.fulfill(status=200, content_type="application/json",
                                                                   body=resurfacing_body(nid)))
            m["stubbed"] = "GET /api/voice/insights answered with one note_level_touch insight linking a note (page.route)"
        pg.goto(base + row["path"], wait_until="domcontentloaded", timeout=60000)
        pg.locator("section[aria-label='Ask your Notebook'], [data-tour='first-run']").first.wait_for(state="visible", timeout=45000)
        from notebook_perf_harness import _dismiss_intro
        _dismiss_intro(pg)
        pg.wait_for_timeout(1500)
        if not realistic:
            dismiss_nudges(pg, m["nudges_dismissed"], "load")
        if row.get("inject_js"):
            pg.evaluate(row["inject_js"])
            pg.wait_for_timeout(300)
        phase = "steps"
        make_steps(pg, steps, notes, hovers, m["steps_taken"], m["nudges_dismissed"], not realistic)
        phase = "measure"
        if not realistic:
            dismiss_nudges(pg, m["nudges_dismissed"], "before measuring")
        el = first_visible(locate(pg, spec), 5000)
        if el is None:
            m["found"] = False
            m["target_absent"] = True
            m["failed_step"] = "every step was made and the target never became visible"
            if shot:
                pg.screenshot(path=str(shot))
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
        if shot:
            el.evaluate("e => { e.style.outline = '3px solid #ff2d55'; e.style.outlineOffset = '2px' }")
            pg.screenshot(path=str(shot))
    except SetupFailed as e:
        m["setup_failed"] = str(e)
        m["found"] = False
    except RowFailure as e:
        m["found"] = False
        m["step_failed"] = True
        m["failed_step"] = str(e)
        if shot:
            try:
                pg.screenshot(path=str(shot))
            except Exception:  # noqa: BLE001
                pass
    except Exception as e:  # noqa: BLE001
        # The page would not load (phase load) or the measuring itself broke (phase measure): the setup,
        # not the door. A step that could not be made was turned into RowFailure inside make_steps.
        m["setup_failed"] = f"{type(e).__name__} while {phase}: {str(e).splitlines()[0][:200]}"
        m["found"] = False
    return m


NUDGES = ("Not now", "Got it", "Dismiss tip")
# Five notes opened fill Research Home's Recent notes (ResearchHome.jsx RECENT_NOTES_SHOWN = 5).
OPEN_TO_FILL_RECENTS = ("Research: how a base", "AAPL pullback", "NVDA leadership", "MSFT base breakout", "Pre-market checklist")


def dismiss_nudges(pg, gone: list[str], where: str) -> None:
    """One press each on whatever first-visit nudge is on screen right now."""
    for name in NUDGES:
        for _ in range(3):
            b = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
            if not b.count():
                break
            b.first.click()
            gone.append(f"{where}: {name}")
            pg.wait_for_timeout(400)


def settle_member(pg, base: str, notes: dict, dismiss: bool) -> dict:
    """Put the member in ONE stated state, so a door's position is a property of the product and
    not of how many screens this run happened to visit first.
      * Five notes are opened, so Research Home's Recent notes is FULL (five rows, its maximum).
        Every note a door's steps open adds a recent row until the list is full, which moved every
        door below it by about 50 px a row, run to run, depending on the order of the table.
      * `dismiss` True (the settled state): the first-visit nudges are dismissed on the screens the
        doors live on. False (the realistic state, the one that is graded): nothing is dismissed,
        as for a member who has not pressed them.
    What was dismissed and how many recent rows the home then had are recorded in the evidence."""
    gone: list[str] = []

    def visit(path: str, wait_ms: int = 3500) -> None:
        pg.goto(base + path, wait_until="domcontentloaded", timeout=60000)
        pg.wait_for_timeout(wait_ms)
        if dismiss:
            dismiss_nudges(pg, gone, path)

    visit(TOP_PATH)
    visit(f"{TOP_PATH}?view=all")
    for frag in OPEN_TO_FILL_RECENTS:
        nid = next((i for k, i in notes.items() if frag in k), None)
        if nid:
            visit(f"{TOP_PATH}?note={nid}")
    visit(TOP_PATH, 4500)
    rows = pg.locator("[data-recent-notes] a[href*='note='], [data-recent-notes] button").count()
    return {"condition_dismisses_nudges": dismiss, "nudges_dismissed": gone, "recent_note_rows": rows}


def member_for(browser, admin_req, base: str, vp: str, dismiss: bool):
    """A fresh paid member with the sample notebook added through the UI (the way a new member
    gets notes and chart notes). Returns (ctx, email, me, {title: id}, state)."""
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
    state = settle_member(pg, base, notes, dismiss)
    pg.close()
    if len(notes) < 5:
        raise SetupFailed(f"the sample notebook did not land ({len(notes)} notes)")
    return ctx, email, me, notes, state


def audit(base: str, out: Path, tip: str, only: set[int] | None) -> int:
    """Measure and WRITE THE RAW FILE; interpret nothing (R-RAW). `--reinterpret` does the rest."""
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
                 "table": TABLE_PATH.name, "table_sha256": table_sha256(),
                 "partial": bool(only), "only": sorted(only) if only else None, "viewports": list(VIEWPORTS),
                 "conditions": list(CONDITIONS), "graded_condition": GRADED,
                 "status": "INCOMPLETE (the run did not finish)", "members": {}, "control": [], "measures": []}

    def save_raw():
        (out / "doors-raw.json").write_text(json.dumps(raw, indent=1, ensure_ascii=False, default=str) + chr(10),
                                            encoding="utf-8", newline=chr(10))

    save_raw()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            admin = browser.new_context()
            h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
            for vp in VIEWPORTS:
                raw["members"][vp] = {}
                for cond in CONDITIONS:
                    ctx = None
                    try:
                        ctx, email, me, notes, state = member_for(browser, admin.request, base, vp, cond == "settled")
                        raw["members"][vp][cond] = {"email": email, "notes": len(notes), **state}
                        # R-HON: the control first, at this viewport, in this state. A fresh page per door,
                        # so an injected overlay or a read stub never reaches the next one.
                        for crow in CONTROLS:
                            pg = ctx.new_page()
                            cm = run_row(pg, base, crow, vp, notes, me, out, cond)
                            pg.close()
                            cm["want"] = CONTROL_WANT[crow["feature"]]
                            raw["control"].append(cm)
                            save_raw()
                        for row in rows:
                            if vp not in row["viewports"] or row.get("door") is False:
                                continue
                            pg = ctx.new_page()
                            raw["measures"].append(run_row(pg, base, row, vp, notes, me, out, cond))
                            pg.close()
                            save_raw()
                    except SetupFailed as e:
                        raw["members"][vp][cond] = {"setup_failed": str(e)}
                        for row in rows:
                            if vp in row["viewports"] and row.get("door") is not False:
                                raw["measures"].append({"feature": row["feature"], "audit_row": row["audit_row"], "viewport": vp,
                                                        "condition": cond, "found": False, "setup_failed": str(e), "steps": 0})
                    finally:
                        if ctx is not None:
                            ctx.close()
                    save_raw()
            browser.close()
    except Exception as e:  # noqa: BLE001
        raw["status"] = f"INCONCLUSIVE: {type(e).__name__}: {str(e)[:300]}"
        save_raw()
        print(raw["status"])
        print(f"raw: {out / 'doors-raw.json'}")
        return 2
    raw["status"] = "RAW COMPLETE (no verdict has been computed)"
    save_raw()
    print(f"RAW COMPLETE: {out / 'doors-raw.json'}  (table sha256 {raw['table_sha256'][:12]})")
    print(f"commit this directory, then:  python tools/notebook_door_audit.py --reinterpret {out}")
    return 0


# ── interpretation (never touches the browser; reads the raw file, never writes it) ─────────────

def interpret(raw: dict, rows: list[dict]) -> tuple[dict, list[dict], dict, int, list[str]]:
    """The raw measurements -> verdicts. Pure given its arguments; touches no browser and no file."""
    control_bad: list[str] = []
    by_ctl: dict[tuple[str, str], dict[str, str]] = {}
    for cm in raw["control"]:
        got = verdict(cm)
        cm["verdict"] = got
        if got != cm["want"]:
            control_bad.append(f"{cm['feature']} [{cm['viewport']} {cm.get('condition')}]: answered {got}, must answer {cm['want']}")
        by_ctl.setdefault((cm["viewport"], cm.get("condition", GRADED)), {})[cm["feature"]] = got
    expected = (set(VIEWPORTS), set(CONDITIONS))
    seen = ({k[0] for k in by_ctl}, {k[1] for k in by_ctl})
    if seen != expected:
        control_bad.append(f"the control did not run at every viewport and state: saw {sorted(by_ctl)}")
    control_exit: dict[str, int] = {}
    for key, got in sorted(by_ctl.items()):
        if set(got) != set(CONTROL_WANT):
            control_bad.append(f"control rows at {key}: {sorted(set(CONTROL_WANT) - set(got))} missing")
        # the control's verdicts go through the SAME exit_code the real doors go through
        control_exit["/".join(key)] = exit_code([{"row": {"feature": f}, "verdict": v} for f, v in got.items()])
        control_bad.extend(f"[{key[0]} {key[1]}] {w}" for w in control_exit_checks(got))
    by_row: dict[str, dict[str, dict[str, dict]]] = {}
    for m in raw["measures"]:
        by_row.setdefault(m["feature"], {}).setdefault(m["viewport"], {})[m.get("condition", GRADED)] = m
    results = []
    for row in rows:
        per = by_row.get(row["feature"], {})
        v, each = row_verdict(row, {vp: c[GRADED] for vp, c in per.items() if GRADED in c})
        _, settled = row_verdict(row, {vp: c["settled"] for vp, c in per.items() if "settled" in c})
        results.append({"row": row, "verdict": v, "viewports": each, "settled_viewports": settled, "reason_clears": reason_clears(row, v)})
    code = exit_code(results)
    resting = [r for r in results if r["verdict"] in ("HARD", "NOT_MEASURED") or r["row"].get("door") is False]
    if control_bad:
        code = 2
    status = ("VOID: the positive control did not behave" if control_bad else
              {0: "PASS: the bar is met", 1: "FAIL: the bar is not met", 2: "INCONCLUSIVE", 3: "UNPROVEN: no row failed, but a row was not measured"}[code])
    final = {**raw, "status": status, "control_breaks": control_bad, "control_exit_codes": control_exit, "exit_code": code,
             "table_sha256_now": table_sha256(), "table_changed_since_run": raw.get("table_sha256") != table_sha256(),
             "resting_on_a_reason": [{"audit_row": r["row"]["audit_row"], "feature": r["row"]["feature"], "verdict": r["verdict"],
                                      "clears": r["reason_clears"]} for r in resting],
             "results": [{"feature": r["row"]["feature"], "audit_row": r["row"]["audit_row"], "verdict": r["verdict"],
                          "graded_viewports": r["viewports"], "settled_viewports": r["settled_viewports"],
                          "reason": r["row"].get("reason"), "reason_clears": r["reason_clears"], "note": r["row"].get("note")}
                         for r in results]}
    return final, results, by_row, code, control_bad


def interpret_and_write(raw: dict, rows: list[dict], out: Path) -> int:
    final, results, by_row, code, control_bad = interpret(raw, rows)
    (out / "doors.json").write_text(json.dumps(final, indent=1, ensure_ascii=False, default=str) + chr(10), encoding="utf-8", newline=chr(10))
    (out / "doors.md").write_text(render_md(final, results, by_row), encoding="utf-8", newline=chr(10))
    counts: dict[str, int] = {}
    for r in results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    print(f"CONTROL: {'all six behaved, and reached the exit code' if not control_bad else 'BROKEN'}  (control exit codes {final['control_exit_codes']})")
    for b in control_bad:
        print("  CONTROL BREAK:", b)
    if final["table_changed_since_run"]:
        print("  NOTE: the door table has changed since this run (its sha256 is not the one in doors-raw.json)")
    for r in results:
        per = "  ".join(f"{vp}:{v}" for vp, v in r["viewports"].items())
        st = " ".join(f"{vp}:{v}" for vp, v in r["settled_viewports"].items())
        print(f"  row {r['row']['audit_row']:>2} {r['verdict']:<12} {per:<24} (settled {st or '-'})  {r['row']['feature']}")
        for vp, c in by_row.get(r["row"]["feature"], {}).items():
            m = c.get(GRADED) or {}
            if m.get("setup_failed") or m.get("failed_step"):
                print(f"           [{vp}] {m.get('setup_failed') or m.get('failed_step')}")
    print("COUNTS:", ", ".join(f"{k} {counts[k]}" for k in sorted(counts, key=lambda k: SEVERITY[k])))
    print(f"{final['status']}  exit {code}  raw: {out / 'doors-raw.json'}")
    return code


def reinterpret(out: Path) -> int:
    """Re-derive doors.json and doors.md from an existing doors-raw.json and the CURRENT table (so a
    reason written after the run is read, and a verdict rule changed after it is applied). The raw
    file is read, never written: R-RAW. doors.json records whether the table is the one that drove
    the run."""
    raw = json.loads((out / "doors-raw.json").read_text(encoding="utf-8"))
    if not str(raw.get("status", "")).startswith("RAW COMPLETE"):
        print(f"the raw file is not a finished run: {raw.get('status')}")
        return 2
    only = set(raw.get("only") or [])
    rows = [r for r in load_table() if not only or r["audit_row"] in only]
    return interpret_and_write(raw, rows, out)


def render_md(final: dict, results: list[dict], by_row: dict) -> str:
    lines = [f"# Door audit {final['stamp']}", "",
             f"tip `{final['tip']}`; base `{final['base']}`; status **{final['status']}**; exit {final.get('exit_code')}"
             + ("; **partial**" if final.get("partial") else ""),
             f"door table sha256 at the run `{str(final.get('table_sha256'))[:16]}`; "
             f"{'CHANGED since the run' if final.get('table_changed_since_run') else 'unchanged since the run'}.", "",
             "Graded on the REALISTIC state (the first-visit nudges not dismissed, the Notices box present); the settled state "
             "(nudges dismissed, no notice) is recorded beside it. `clicks` counts the press on the target, as the audit does.",
             "", f"Control (R-HON): {'all six synthetic doors behaved and reached the exit code' if not final.get('control_breaks') else 'BROKEN: ' + '; '.join(final['control_breaks'])}; "
                 f"control exit codes {final.get('control_exit_codes')}.", ""]
    for vp, conds in final.get("members", {}).items():
        for cond, m in conds.items():
            lines.append(f"- {vp} {cond}: sample notebook, {m.get('recent_note_rows')} recent rows, nudges dismissed {len(m.get('nudges_dismissed') or [])}")
    lines += ["", "| audit row | door | verdict | 1280 | 390 | settled 1280 / 390 | reason (clears?) or note |", "|---|---|---|---|---|---|---|"]

    def cell(m, v=None):
        if not m:
            return "-"
        if m.get("setup_failed"):
            return f"not measured: {m['setup_failed']}"
        if not m.get("found"):
            return f"{v or 'HIDDEN'}: not found ({m.get('failed_step', '')})"
        return (f"{v or verdict(m)}: {clicks_of(m)} clicks, "
                f"{'above' if m['above_fold'] else 'below'} the fold ({m.get('screens_down')} screens down)"
                f"{', one scroll' if m.get('scrolled') and m.get('scroll_screens', 1) <= 1 else (', ' + str(m.get('scroll_screens')) + ' scrolls' if m.get('scrolled') else '')}"
                f", {'uncovered' if m['uncovered'] else 'COVERED by ' + str(m['covered_by'])}"
                f", {'icon only' if m.get('icon_only') else 'labelled'}")

    for r in results:
        row = r["row"]
        per = by_row.get(row["feature"], {})
        rs = row.get("reason")
        why = (f"[{rs['verdict']}, {'CLEARS' if r['reason_clears'] else 'does not clear'}] {rs['text']}" if isinstance(rs, dict) else "")
        st = " / ".join(r["settled_viewports"].get(vp, "-") for vp in VIEWPORTS)
        lines.append(f"| {row['audit_row']} | {row['feature']} | **{r['verdict']}** | {cell(per.get('1280', {}).get(GRADED), r['viewports'].get('1280'))} | "
                     f"{cell(per.get('390', {}).get(GRADED), r['viewports'].get('390'))} | {st} | "
                     f"{' '.join(x for x in (why, row.get('note')) if x).replace('|', '/')} |")
    return chr(10).join(lines) + chr(10)


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
    ap.add_argument("--self-check", action="store_true", help="run the verdict and exit functions on known cases and exit")
    ap.add_argument("--reinterpret", metavar="DIR", help="derive doors.json and doors.md from DIR/doors-raw.json and print the exit code (never writes the raw file)")
    a = ap.parse_args(argv)
    if a.self_check:
        wrong = self_check()
        for w in wrong:
            print("SELF-CHECK FAILED:", w)
        print("self-check: " + ("FAILED" if wrong else f"{len(CASES)} verdict cases, {len(EXIT_CASES)} exit cases, the control exit checks, table well-formed: all hold"))
        return 1 if wrong else 0
    if a.reinterpret:
        return reinterpret(Path(a.reinterpret))
    if not a.base or not a.out:
        ap.error("--base and --out are required (or --self-check, or --reinterpret DIR)")
    only = {int(x) for x in a.only.split(",") if x.strip()} or None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(a.out) / f"door-audit-{stamp}"
    out.mkdir(parents=True, exist_ok=True)
    return audit(a.base.rstrip("/"), out, a.tip, only)


if __name__ == "__main__":
    sys.exit(main())
