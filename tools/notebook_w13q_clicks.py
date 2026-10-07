"""Wave 13 lane 13Q-1 -- the click-by-click usability instrument ("EASY IS THE KEY").

Spec: docs/notebook/WAVE-13-PLAN.md section 6 ("13Q: the click-by-click program") and the 23
budgets under it. This tool MEASURES; it never edits product code, and it draws no conclusion
(the reading is written afterwards, from the raw file this writes first -- R-RAW).

What it does, in a REAL browser (Playwright Chromium) against a LOCAL SANDBOX that it owns
(tools/notebook_perf_harness.py's `Sandbox` -> scripts/hub_sandbox_boot.py: the census env pins,
the shared-root tripwire, the integrity snapshots), for each of the plan's 23 flows Q1-Q23:

  * mouse  (1200 px): every click is counted; typing the CONTENT (a title, a ticker, a
             query) is not, per the plan ("Typing the content itself is not counted").
  * keys   (1200 px and 390 px): every keystroke is counted; Tab presses are counted
             SEPARATELY and are pressed FOR REAL until focus arrives on the control,
             capped at 600 (the plan's cap). A chord (Ctrl+K) is one keystroke. The
             reported "keys" figure is keystrokes + Tabs, which is what the budget bounds.
  * taps   (390 px, touch context): every tap is counted.

  For every flow and mode it records the measured count, the plan's budget, PASS or OVER,
  the wall time from the first counted action to the verified outcome, and the RAW PATH:
  each counted step with what it acted on, and for every Tab run the full focus trail.

  A flow PASSES or goes OVER only when its OUTCOME is verified (the note exists and is open,
  the cursor is in the body, the export downloaded, ...). A flow whose surface is dark or
  unbuilt on this tree, or that the driver could not complete, reads INCONCLUSIVE with the
  reason -- NEVER PASS. A Tab run that hits the 600 cap reads OVER with "cap reached", which
  is a finding, not a pass.

  Q7 (save Screener results to a note) is the plan's CONTROL: "the instrument must reproduce
  the Screener's ~337 Tabs before any fix" (ruling P5). The door is
  `app/src/pages/screener/shell/ScannerShell.jsx` (Screener-owned): MEASURED ONLY, never
  edited. The full focus trail to the door is kept so the number can be explained.

Flags: a flow that needs a dark flag gets it switched on IN THE SANDBOX ONLY (written into this
process's environment just before the launcher is spawned, so only the child inherits it; the
gate's one parse lives in the app). The list is FLAGS below (armed as SANDBOX_FLAGS); every name is grepped to a
read site in api/routers/auth.py NOTEBOOK_FLAGS (CLAUDE.md: never invent an env flag).

Model keys stay BLANKED (the launcher's default). Where a flow's surface waits on a model
answer (Q9 Ask), the answer is stubbed AT THE BROWSER'S NETWORK LAYER (Playwright route) so the
clicks measured are the UI's own; that row says so in its `notes`.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. Seeding that the product's own HTTP routes cannot do (the
screener snapshot rows Q7 needs, so the page shows results the way a member sees it) is written
by a CHILD process that first applies the sandbox's own census pins
(`hub_sandbox_boot.apply_sandbox_env`), as tools/notebook_w13c_walk.py does. The last row
asserts the driver's own sys.modules.

Run from PowerShell (a Windows path through the Bash tool loses its backslash), ports 8625-8629:

    python tools/notebook_w13q_clicks.py --data-dir '<scratch>\\w13q-run1' --port 8625 `
        --out 'docs\\notebook\\evidence\\wave13-13q\\run-<sha>'

Preconditions: app/dist rebuilt from this tree; the port free (refused, never killed); the data
dir outside the shared root (refused) and EMPTY.

Exit: 0 = ran, integrity CLEAN (budgets do not set the exit code -- a miss is a finding);
2 = integrity not CLEAN; 3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:  # noqa: BLE001
        pass

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)
# The finish program's CLICKS lane reuses each wave-13 lane's OWN walk fixtures rather than
# retyping them (one seed recipe per feature): 13D's scan child, 13G's stored transcript, 13H's
# synthetic bars route and drawing helper, 13J's bars and nightly children. None imports api.*.
import notebook_w13d_walk as w13d  # noqa: E402
import notebook_w13g1_walk as w13g1  # noqa: E402
import notebook_w13h2_walk as w13h2  # noqa: E402
import notebook_w13j_walk as w13j  # noqa: E402

MEMBER = ("w13q@local.dev", "LocalTest2026!", "w13q")
# 8625-8629 is the wave-13 lane's own range; 8720-8724 is the finish program's CLICKS lane.
PORTS = (*range(8625, 8630), *range(8720, 8725))
TAB_CAP = 600
WIDE = {"width": 1200, "height": 900}
PHONE = {"width": 390, "height": 844}

# ⛔ Each name is a key of api/routers/auth.py NOTEBOOK_FLAGS (grepped, never invented).
# ⛔ The flag LEDGER convention for a tool that arms sandbox gates (the w13x walk's form): a
# plain LIST of names, armed with os.environ.update. A module-level `*_FLAGS` dict literal of
# gate names is the feature-flag index's TABLE form -- it would make this tool a second
# declaration site for each gate (tests/test_notebook_flag_table_form.py requires
# api/routers/auth.py to be the only one) and could hand the ledger "1" as the gate's default.
FLAGS = [
    "NOTEBOOK_ASK_INSERT_ON",              # Q9 insert the answer
    "NOTEBOOK_EARNINGS_PREP_ENABLED",      # Q15
    "NOTEBOOK_TEMPLATE_GALLERY_ENABLED",   # Q2's template sheet as production may show it
    "NOTEBOOK_PLAN_GRADING_ENABLED",       # Q13 (lane 13A)
    # Finish program, lane CLICKS: the eight flows that had no driver, plus every other
    # wave 11-14 gate, so the counts are taken on the product a member with everything on sees.
    "NOTEBOOK_PLAYBOOK_ENABLED",           # Q14 (lane 13B)
    "AWARENESS_NOTE_RESURFACE_ENABLED",    # Q16 (lane 13D)
    "NOTEBOOK_ENTRY_CONTEXT_ENABLED",      # Q17 (lane 13E)
    "NOTEBOOK_REVIEW_DRAFTS_ENABLED",      # Q18 (lane 13F)
    "NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED",  # Q19 (lane 13G)
    "NOTEBOOK_PASSED_SETUPS_ENABLED",
    "NOTEBOOK_THESIS_CHIPS_ENABLED",
    "NOTEBOOK_CHART_PLAN_ENABLED",         # Q20, Q21 (lane 13H)
    "NOTEBOOK_TA_FINGERPRINT_ENABLED",     # Q22 (lane 13I)
    "NOTEBOOK_VISUAL_PLAYBOOK_ENABLED",
    "NOTEBOOK_SETUPS_BOARD_ENABLED",       # Q23 (lane 13J)
    "NOTEBOOK_FIND_SIMILAR_ENABLED",
    "NOTEBOOK_VOICE_NOTES_ENABLED",        # wave 11
    "NOTEBOOK_AI_ACTIONS_ENABLED",
    "NOTEBOOK_FORMULAS_ENABLED",
    "NOTEBOOK_TRADE_CANVAS_ENABLED",
    "NOTEBOOK_ONBOARDING_ENABLED",         # wave 14's tours and checklist stand on this gate
    "NOTEBOOK_GETTING_STARTED_ENABLED",    # wave 14
]
# The environment the sandbox child inherits (kept under its old name: the wave-13 evidence
# scripts import it).
SANDBOX_FLAGS = {name: "1" for name in FLAGS}
CAL_FILE = "w13q-sandbox-calendar.json"

# The plan's table (section 6), typed ONCE here and printed back into every result row so the
# reading never re-types it. (flow id, flow, mouse, keys, taps, owning lane)
BUDGETS = [
    ("Q1", "new blank note, cursor in body", 2, 3, 2, "Notebook core"),
    ("Q2", "new note from a template with a ticker", 4, 6, 4, "Notebook templates (12B)"),
    ("Q3", "open a note by title", 2, 4, 3, "Notebook core"),
    ("Q4", "search, open a hit", 3, 5, 3, "Notebook core"),
    ("Q5", "today's daily note", 1, 2, 1, "Notebook core"),
    ("Q6", "link a note to a trade", 3, 6, 3, "Notebook core / Journal"),
    ("Q7", "save Screener results to a note (337 Tabs today)", 3, 10, 3, "Screener (ScannerShell.jsx)"),
    ("Q8", "save a price or consensus fact", 3, 8, 3, "Notebook capture"),
    ("Q9", "ask the Notebook, insert the answer", 3, 5, 3, "Notebook Ask"),
    ("Q10", "task with a due date", 2, 4, 3, "Notebook core"),
    ("Q11", "tag and move 5 notes", 8, 15, 10, "Notebook core"),
    ("Q12", "export one note as Word", 3, 6, 3, "Notebook export"),
    ("Q13", "plan grade of my last trade (13A)", 2, 4, 2, "13A"),
    ("Q14", "My Playbook, drill a number (13B)", 3, 6, 3, "13B"),
    ("Q15", "create earnings prep (13C)", 2, 5, 2, "13C"),
    ("Q16", "open a resurfaced note (13D)", 2, 4, 2, "13D"),
    ("Q17", "answer \"why did you take it\" (13E)", 2, 4, 2, "13E"),
    ("Q18", "draft this week's review, open a leak (13F)", 3, 6, 3, "13F"),
    ("Q19", "save a transcript passage to a thesis (13G)", 3, 6, 4, "13G"),
    ("Q20", "insert a chart, draw entry, stop and target, read size (13H)", 6, 10, 8, "13H"),
    ("Q21", "arm an alert at a drawn stop (13H)", 2, 4, 2, "13H"),
    ("Q22", "filter the visual playbook to one setup (13I)", 2, 4, 3, "13I"),
    ("Q23", "morning board, open the closest setup, find similar (13J)", 3, 6, 3, "13J"),
]

# Controller ruling, 2026-10-07 (the plan's section 6, "Keyboard budgets by ruling"). For these
# ten flows the plan's keyboard number is below the arithmetic FLOOR for a keyboard: the keys
# that are not Tab, plus one Tab per move to a new control. No page design can meet a number
# below its floor, so it is not a usable bar. Their keyboard budget is the floor plus
# KEYS_RULING_ALLOWANCE. Mouse and touch budgets are unchanged, and so is every other flow.
# (flow id: the floor). Cross-read against the plan by tests/test_notebook_w13q_clicks.py.
# Extended the same day to Q18 and Q23: their floor was first read as 6, and is 7 (a flow that
# starts on a fresh page reaches the page's own skip link with TWO Tabs, behind the shell's).
KEYS_RULING_FLOOR = {"Q6": 8, "Q9": 7, "Q11": 25, "Q12": 10, "Q16": 6, "Q17": 5, "Q19": 7, "Q20": 20,
                     "Q18": 7, "Q23": 7}
KEYS_RULING_ALLOWANCE = 2


def keys_budget(fid: str, plan_keys: int) -> int:
    floor = KEYS_RULING_FLOOR.get(fid)
    return plan_keys if floor is None else floor + KEYS_RULING_ALLOWANCE


BUDGET = {b[0]: {"flow": b[1], "mouse": b[2], "keys": keys_budget(b[0], b[3]), "taps": b[4], "owner": b[5],
                 "keys_plan": b[3], "keys_floor": KEYS_RULING_FLOOR.get(b[0])} for b in BUDGETS}


class Inconclusive(Exception):
    """The flow could not be measured on this tree: its surface is dark or unbuilt, or the
    driver could not reach a verified outcome. The message is the reason, recorded verbatim."""


# ── the meter ────────────────────────────────────────────────────────────────────────────

FOCUS_DESC_JS = """() => { const el = document.activeElement;
  if (!el || el === document.body) return {tag: 'BODY', name: ''};
  const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value
                || el.getAttribute('placeholder') || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
  return {tag: el.tagName, role: el.getAttribute('role') || '', name,
          testid: el.getAttribute('data-testid') || '', ce: el.isContentEditable || false}; }"""


# A control inside a one-Tab-stop group (hooks/useRovingTabIndex.js: `data-roving-item`, the
# group's one stop carries tabIndex 0, every other item -1). Tab can never land on such a
# control, so a Tab-only walk would run to the cap and read as a product miss the product does
# not have. Returns where the group's stop is and where the control is, or null when the control
# is an ordinary Tab stop. The group's direction is read from where its items sit on screen.
ROVING_PLAN_JS = """h => {
  if (!h || !h.hasAttribute || !h.hasAttribute('data-roving-item') || h.tabIndex >= 0) return null;
  let root = h.parentElement;
  while (root && root !== document.body) {
    const items = Array.from(root.querySelectorAll('[data-roving-item]'))
      .filter(e => e.getAttribute('data-roving-disabled') !== 'true');
    const stop = items.find(e => e.tabIndex === 0);
    if (stop && items.includes(h)) {
      window.__w13qRovingStop = stop;
      const a = items[0].getBoundingClientRect(), b = items[items.length - 1].getBoundingClientRect();
      return {from: items.indexOf(stop), to: items.indexOf(h), n: items.length,
              vertical: root.getAttribute('role') === 'toolbar' ? false
                : Math.abs(b.top - a.top) > Math.abs(b.left - a.left)};
    }
    root = root.parentElement;
  }
  return null; }"""


# A control inside a row of a tree (role="tree", one Tab stop: lane KEYS round 4). Reports the
# tree's current stop, and where the control's row is among the rows showing.
TREE_PLAN_JS = """h => {
  const row = h && h.closest ? h.closest('[role="treeitem"]') : null;
  const tree = row ? row.closest('[role="tree"]') : null;
  if (!tree) return null;
  const rows = Array.from(tree.querySelectorAll('[role="treeitem"]'));
  const stop = rows.find(e => e.getAttribute('tabindex') === '0');
  if (!stop) return null;
  window.__w13qRovingStop = stop;
  window.__w13qTreeRow = row;
  return {from: rows.indexOf(stop), to: rows.indexOf(row), n: rows.length}; }"""


# A control in a one-stop LIST OF ROWS (lib/useGridRoving.js: lane KEYS round 5). Reports the
# list's current stop and how many rows and how many controls along the target is from it.
GRID_PLAN_JS = """h => {
  if (!h || !h.hasAttribute || !h.hasAttribute('data-grid-roving')) return null;
  const rowOf = e => e.closest('[data-note-row]') || e.closest('tr');
  let root = h.parentElement;
  while (root && root !== document.body && !root.querySelector('[data-grid-roving][tabindex="0"]')) root = root.parentElement;
  if (!root) return null;
  const cells = Array.from(root.querySelectorAll('[data-grid-roving]'));
  const stop = cells.find(e => e.getAttribute('tabindex') === '0');
  if (!stop) return null;
  const rows = []; for (const c of cells) { const r = rowOf(c); if (!rows.includes(r)) rows.push(r); }
  const col = e => cells.filter(c => rowOf(c) === rowOf(e)).indexOf(e);
  window.__w13qRovingStop = stop;
  return {rows: rows.indexOf(rowOf(h)) - rows.indexOf(rowOf(stop)), from_col: col(stop), to_col: col(h)}; }"""


class Meter:
    """Counts one flow in one mode. Every counted action goes through here, and is recorded
    in `steps` with what it acted on -- the raw path the reading cites."""

    def __init__(self, pg, mode: str):
        self.pg, self.mode = pg, mode
        self.clicks = self.taps = self.keys = self.tabs = 0
        self.steps: list[dict] = []
        self.t0: float | None = None
        self.capped = False

    def _start(self):
        if self.t0 is None:
            self.t0 = time.time()

    # pointer -- a click in mouse mode, a tap in taps mode
    def press(self, loc, label: str, *, timeout: int = 20000):
        """Activate a control the way this mode's member would: click (mouse), tap (taps),
        or Tab-until-focused then Enter (keys)."""
        self._start()
        loc = loc.first if hasattr(loc, "first") else loc
        loc.wait_for(state="visible", timeout=timeout)
        if self.mode == "mouse":
            loc.click(timeout=timeout)
            self.clicks += 1
            self.steps.append({"do": "click", "on": label})
        elif self.mode == "taps":
            loc.scroll_into_view_if_needed(timeout=timeout)
            loc.tap(timeout=timeout)
            self.taps += 1
            self.steps.append({"do": "tap", "on": label})
        else:
            self.keys_to(loc, label)
            self.key("Enter", f"activate {label}")

    def keys_to(self, loc, label: str) -> None:
        """Keys mode: bring focus to a control the way a keyboard member does. An ordinary control
        is reached by real Tab presses. A control inside a one-Tab-stop group is reached by Tab to
        the group's stop, then the group's own Arrow key (or Home / End when that is one press).
        Every key is pressed for real and counted; the arrival is checked, never assumed."""
        handle = loc.element_handle(timeout=20000)
        tree = self.pg.evaluate(TREE_PLAN_JS, handle)
        if tree:
            # A row of a tree: Tab to the tree's one stop, then Down / Up (or Home / End) to the
            # row. Focus ends ON THE ROW; its Enter presses the row's own control.
            self.tab_to("el === window.__w13qRovingStop", f"the tree holding {label}")
            a, b, n = tree["from"], tree["to"], tree["n"]
            if b == 0 and abs(b - a) > 1:
                self.key("Home", f"first row of the tree: {label}")
            elif b == n - 1 and abs(b - a) > 1:
                self.key("End", f"last row of the tree: {label}")
            else:
                for _ in range(abs(b - a)):
                    self.key("ArrowDown" if b > a else "ArrowUp", f"move in the tree towards {label}")
            if not self.pg.evaluate("() => document.activeElement === window.__w13qTreeRow"):
                raise Inconclusive(f"the tree's arrow keys did not bring focus to the row of {label} "
                                   f"({n} rows, stop at {a}, row at {b})")
            return
        grid = self.pg.evaluate(GRID_PLAN_JS, handle)
        if grid:
            # A list of rows that is one stop: Tab to the stop, Down / Up by row (the control
            # kept), then Right / Left along the row. Every key real and counted.
            self.tab_to("el === window.__w13qRovingStop", f"the list holding {label}")
            for _ in range(abs(grid["rows"])):
                self.key("ArrowDown" if grid["rows"] > 0 else "ArrowUp", f"row towards {label}")
            # after the row moves the column is the stop's own, clamped to the row
            for _ in range(8):
                if self.pg.evaluate("h => h === document.activeElement", handle):
                    break
                at = self.pg.evaluate("""h => { const rowOf = e => e.closest('[data-note-row]') || e.closest('tr');
                    const a = document.activeElement; const cs = Array.from(rowOf(h).querySelectorAll('[data-grid-roving]'));
                    return cs.indexOf(a) - cs.indexOf(h) }""", handle)
                self.key("ArrowLeft" if at > 0 else "ArrowRight", f"along the row towards {label}")
            if not self.pg.evaluate("h => h === document.activeElement", handle):
                raise Inconclusive(f"the list's arrow keys did not bring focus to {label} ({grid})")
            return
        plan = self.pg.evaluate(ROVING_PLAN_JS, handle)
        if not plan:
            self.tab_to_locator(loc, label)
            return
        self.tab_to("el === window.__w13qRovingStop", f"the one-stop group holding {label}")
        n, a, b = plan["n"], plan["from"], plan["to"]
        fwd, back = (b - a) % n, (a - b) % n
        nxt, prv = ("ArrowDown", "ArrowUp") if plan["vertical"] else ("ArrowRight", "ArrowLeft")
        if b == 0 and min(fwd, back) > 1:
            self.key("Home", f"first item of the group: {label}")
        elif b == n - 1 and min(fwd, back) > 1:
            self.key("End", f"last item of the group: {label}")
        else:
            for _ in range(min(fwd, back)):
                self.key(nxt if fwd <= back else prv, f"move in the group towards {label}")
        if not self.pg.evaluate("h => h === document.activeElement", handle):
            raise Inconclusive(f"the group's arrow keys did not bring focus to {label} "
                               f"(group of {n}, stop at {a}, control at {b})")

    def counted(self, n: int, what: str) -> None:
        """Pointer inputs a shared helper made for real (the 13H-2 walk's drawing helper), added
        from that helper's own record of what it pressed. Mouse and taps modes only."""
        self._start()
        if self.mode == "taps":
            self.taps += n
        else:
            self.clicks += n
        self.steps.append({"do": f"{'tap' if self.mode == 'taps' else 'click'} x{n} (counted from the helper's record)",
                           "on": what})

    def pointer(self, loc, label: str, *, timeout: int = 20000):
        """A pointer-only action (mouse/taps modes) -- e.g. clicking into a field."""
        self._start()
        loc = loc.first if hasattr(loc, "first") else loc
        loc.wait_for(state="visible", timeout=timeout)
        if self.mode == "taps":
            loc.scroll_into_view_if_needed(timeout=timeout)
            loc.tap(timeout=timeout)
            self.taps += 1
            self.steps.append({"do": "tap", "on": label})
        else:
            loc.click(timeout=timeout)
            self.clicks += 1
            self.steps.append({"do": "click", "on": label})

    def key(self, key: str, label: str = ""):
        self._start()
        self.pg.keyboard.press(key)
        if key in ("Tab", "Shift+Tab"):
            self.tabs += 1
        else:
            self.keys += 1
        self.steps.append({"do": "key", "key": key, "on": label})

    def type(self, text: str, label: str = "content"):
        """Content typing: NOT counted (the plan), recorded so the path is complete."""
        self._start()
        self.pg.keyboard.type(text, delay=15)
        self.steps.append({"do": "type (not counted)", "text": text, "on": label})

    def fill(self, loc, text: str, label: str = "content"):
        """Content into a field that already has focus or was pointed at: NOT counted."""
        self._start()
        (loc.first if hasattr(loc, "first") else loc).fill(text)
        self.steps.append({"do": "fill (not counted)", "text": text, "on": label})

    def tab_to(self, js_predicate: str, label: str, *, cap: int = TAB_CAP, shift: bool = False) -> int:
        """Press Tab FOR REAL until document.activeElement satisfies `js_predicate` (a JS
        expression over `el`). Every press is counted and the focus trail is kept. Returns the
        number of presses, or raises Inconclusive at the cap with the trail recorded (the step
        is marked capped so the row reads OVER, not PASS)."""
        self._start()
        trail = []
        k = "Shift+Tab" if shift else "Tab"
        check = f"(() => {{ const el = document.activeElement; return !!(el && ({js_predicate})) }})()"
        if self.pg.evaluate(check):
            self.steps.append({"do": "tab-run", "to": label, "presses": 0, "trail": []})
            return 0
        for i in range(1, cap + 1):
            self.pg.keyboard.press(k)
            self.tabs += 1
            trail.append(self.pg.evaluate(FOCUS_DESC_JS))
            if self.pg.evaluate(check):
                self.steps.append({"do": "tab-run", "to": label, "presses": i, "trail": trail})
                return i
        self.capped = True
        self.steps.append({"do": "tab-run", "to": label, "presses": cap, "trail": trail, "capped": True})
        raise Capped(f"{cap} Tab presses never reached {label}")

    def tab_to_locator(self, loc, label: str, *, cap: int = TAB_CAP) -> int:
        """Tab until the focused element IS (or is inside) this locator's element."""
        handle = loc.element_handle(timeout=20000)
        self.pg.evaluate("h => { window.__w13qTarget = h }", handle)
        return self.tab_to("el === window.__w13qTarget || window.__w13qTarget.contains(el)", label, cap=cap)

    def shift_tab_to_locator(self, loc, label: str, *, cap: int = TAB_CAP) -> int:
        """Shift+Tab until the focused element IS (or is inside) this locator's element. For a
        control that sits BEFORE where focus is: a keyboard member goes back to it, they do not
        Tab forward round the whole page. Every press is real and counted like a Tab."""
        loc = loc.first if hasattr(loc, "first") else loc
        handle = loc.element_handle(timeout=20000)
        self.pg.evaluate("h => { window.__w13qTarget = h }", handle)
        return self.tab_to("el === window.__w13qTarget || window.__w13qTarget.contains(el)",
                           f"{label} (Shift+Tab)", cap=cap, shift=True)

    def elapsed(self) -> float | None:
        return round(time.time() - self.t0, 2) if self.t0 else None

    def count(self) -> int:
        return {"mouse": self.clicks, "taps": self.taps}.get(self.mode, self.keys + self.tabs)


class Capped(Exception):
    """A Tab run hit the plan's cap. The flow reads OVER (cap reached), never PASS."""


@dataclass
class Flow:
    fid: str
    run: Callable | None              # run(ctx: Ctx, m: Meter) -> dict of outcome evidence
    modes: tuple = ("mouse", "keys", "taps")
    unbuilt: str | None = None        # the reason it is INCONCLUSIVE on this tree, if it is
    notes: str = ""
    bars: bool = False                # route /api/bars/<SYM> to the 13H-2 walk's synthetic bars
    tall: bool = False                # a 1200 px tall window at the wide width (see Q20)


@dataclass
class Ctx:
    base: str
    req: object                       # the member's APIRequestContext
    raw: dict = field(default_factory=dict)
    seed: dict = field(default_factory=dict)
    wide: str = "1200"                # the wide viewport's label (its width in px)


# ── shared page helpers (setup -- never counted) ─────────────────────────────────────────

def settle(pg, ms: int = 600):
    try:
        pg.wait_for_load_state("networkidle", timeout=8000)
    except Exception:  # noqa: BLE001 -- a long-poll page never idles; the wait is best-effort
        pass
    pg.wait_for_timeout(ms)


def open_start(pg, base: str, path: str, ready: str | None = None, timeout: int = 60000):
    """Load the flow's start page and clear the once-per-tab chrome (the Welcome intro, the
    Compass hint). SETUP: nothing here is counted, and each dismissal is recorded by the
    caller's raw block, so a member's first-visit cost is visible without polluting a flow."""
    pg.goto(base + path, wait_until="domcontentloaded", timeout=timeout)
    h._dismiss_intro(pg)
    try:
        pg.get_by_role("button", name="Got it", exact=True).first.click(timeout=2500)
    except Exception:  # noqa: BLE001 -- the hint did not show in this tab
        pass
    if ready:
        pg.locator(ready).first.wait_for(state="visible", timeout=timeout)
    settle(pg)
    # keyboard runs start from the top of the document, as a member arriving on the page
    # A blur alone leaves the browser's sequential-focus starting point wherever the last setup
    # click landed (the Compass hint's "Got it"), so the first Tab would continue from mid-page.
    # A throwaway focus target at the very top, focused and removed, puts it back at the start.
    pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur();"
                " const s = document.createElement('span'); s.tabIndex = -1; document.body.prepend(s);"
                " s.focus(); s.remove(); window.scrollTo(0, 0) }")


def focus_in_editor(pg) -> bool:
    return bool(pg.evaluate("() => { const el = document.activeElement;"
                            " return !!(el && el.closest && el.closest('.ProseMirror')) }"))


def note_id_from_url(pg) -> str | None:
    from urllib.parse import parse_qs, urlparse
    return (parse_qs(urlparse(pg.url).query).get("note") or [None])[0]


def wait_note_open(pg, timeout_ms: int = 30000) -> str | None:
    pg.wait_for_url("**/journal/notebook?*note=*", timeout=timeout_ms)
    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=timeout_ms)
    return note_id_from_url(pg)


def list_notes(req, base, q: str = "") -> list:
    r = req.get(base + "/api/j2/notes?limit=500" + q)
    return (r.json().get("notes") or []) if r.status == 200 else []


def read_note(req, base, nid):
    r = req.get(f"{base}/api/j2/notes/{nid}")
    return r.json().get("note") if r.status == 200 else None


def text_of(node, out=None):
    out = [] if out is None else out
    if isinstance(node, dict):
        if node.get("type") == "text":
            out.append(node.get("text", ""))
        for c in node.get("content") or []:
            text_of(c, out)
    return out


def journal_toast(pg) -> str:
    """The Notebook's own toast chip (lib/useJournalToast.jsx: a permanent role=status span whose
    text toggles) -- read by its data-empty flag, never by any aria-live on the page."""
    try:
        return pg.evaluate("() => Array.from(document.querySelectorAll('span[role=status][data-empty=false]'))"
                           ".map(e => e.innerText.trim()).filter(Boolean).join(' | ')")[:300]
    except Exception:  # noqa: BLE001
        return ""


def toast_text(pg) -> str:
    try:
        return pg.evaluate("() => Array.from(document.querySelectorAll('[role=status],[role=alert],[aria-live]'))"
                           ".map(e => e.innerText.trim()).filter(Boolean).join(' | ')")[:400]
    except Exception:  # noqa: BLE001
        return ""


# ── seeding (setup -- never counted) ─────────────────────────────────────────────────────

def _next_weekday(d: date, n: int) -> date:
    out = d
    while n > 0:
        out += timedelta(days=1)
        if out.weekday() < 5:
            n -= 1
    return out


def write_calendar(data_dir: Path) -> Path:
    """The sandbox-only earnings calendar Q15 reads (NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR, read
    only off Railway with the conftest imported -- tools/notebook_w13c_walk.py's recipe)."""
    today = date.today()
    p = data_dir / CAL_FILE
    p.write_text(json.dumps({"reporters": {"NVDA": {"date": _next_weekday(today, 2).isoformat(), "timing": "amc"}},
                             "asOf": datetime.now(timezone.utc).isoformat(timespec="seconds"), "partial": False},
                            indent=1), encoding="utf-8")
    return p


# Screener rows so /screener shows RESULTS the way a member sees it (the Save door is disabled
# until a result exists). Written by a CHILD under the sandbox's own census pins -- this process
# never imports api.*.
SCREENER_TICKERS = ["NVDA", "AMD", "AAPL", "MSFT", "META", "AMZN", "GOOGL", "TSLA", "AVGO", "CRWD",
                    "PLTR", "NFLX", "SHOP", "SNOW", "NET", "DDOG", "ZS", "PANW", "ANET", "SMCI",
                    "MU", "ARM", "TSM", "ASML", "LRCX", "KLAC", "AMAT", "MRVL", "ON", "QCOM"]

SEED_CHILD = r'''
import json, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services.screener import snapshot_db
snapshot_db.init_db()
n = snapshot_db.upsert_rows(spec["rows"])
print("SEEDED", snapshot_db.get_db_path(), n, snapshot_db.count_rows())
'''


def seed_stores(data_dir: Path, out: Path) -> str:
    today = date.today().isoformat()
    rows = []
    for i, t in enumerate(SCREENER_TICKERS):
        rows.append({"ticker": t, "company": f"{t} (walk seed)", "sector": "Technology",
                     "industry": "Semiconductors" if i % 2 else "Software", "exchange": "NASDAQ",
                     "security_type": "stock", "market_cap": 5e10 + i * 1e9, "price": 50.0 + i * 7,
                     "avg_volume_30d": 2e6 + i * 1e5, "snapshot_date": today, "bars_asof": today,
                     "built_at": today})
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", SEED_CHILD, str(REPO), str(data_dir), json.dumps({"rows": rows})],
                       cwd=str(REPO), env=env, capture_output=True, text=True, timeout=600)
    (out / "seed-child.log").write_text((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or "")[-6000:],
                                        encoding="utf-8")
    if r.returncode != 0 or "SEEDED" not in (r.stdout or ""):
        raise h.SetupFailed(f"seeding the screener rows failed (rc {r.returncode}); see seed-child.log")
    return [ln for ln in r.stdout.splitlines() if ln.startswith("SEEDED")][-1]


def _doc(text: str) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


SEED_TITLES = ["NVDA breakout thesis", "Semis rotation notes", "AMD earnings recap", "Weekly review draft",
               "CRWD base watch", "Market regime journal", "PLTR pullback plan", "Risk rules"]


def seed_member(cx: Ctx, data_dir: Path) -> None:
    """The member's notes, a closed trade, a position and a watchlist, through the product's own
    routes (HTTP only). Every id the flows need is kept in cx.seed."""
    req, base = cx.req, cx.base
    notes = {}
    for t in SEED_TITLES:
        r = req.post(base + "/api/j2/notes", data={"title": t, "bodyJson": _doc(f"{t} -- seeded body.")})
        if r.status not in (200, 201):
            raise h.SetupFailed(f"seeding note {t!r} failed: HTTP {r.status} {r.text()[:200]}")
        notes[t] = r.json()["note"]["id"]
    cx.seed["notes"] = notes
    today = date.today()
    pos = req.post(base + "/api/j2/positions", data={
        "symbol": "NVDA", "side": "Long", "entryDate": (today - timedelta(days=10)).isoformat(),
        "shares": 100, "entryPrice": 180.0, "stopPrice": 170.0})
    cx.seed["position_http"] = pos.status
    try:
        cx.seed["position_id"] = (pos.json() or {}).get("position", {}).get("id") or (pos.json() or {}).get("id")
    except Exception:  # noqa: BLE001
        cx.seed["position_id"] = None
    wl = req.post(base + "/api/watchlists", data={"name": "W13Q walk list"})
    cx.seed["watchlist_http"] = wl.status
    # Q11 moves into a folder: one per (mode, width) so runs never collide
    folders = {}
    for key in (f"mouse-{cx.wide}", f"keys-{cx.wide}", "keys-390", "taps-390"):
        r = req.post(base + "/api/j2/note-folders", data={"name": f"Semis {key}"})
        if r.status in (200, 201):
            body = r.json()
            f = body.get("folder") or body
            folders[key] = {"id": f.get("id"), "name": f.get("name")}
    cx.seed["folders"] = folders
    # Q6: a closed CRWD trade to link a note to
    d = (today - timedelta(days=3)).isoformat()
    t = req.post(base + "/api/j2/trades", data={"symbol": "CRWD", "side": "Long", "shares": 50, "entryPrice": 300,
                                                "entryDate": d, "exitPrice": 320, "exitDate": d, "originalStop": 290})
    tb = t.json() if t.status == 200 else {}
    cx.seed["trade_id"] = (tb.get("trade") or tb).get("id") if tb else None
    cx.seed["trade_http"] = t.status
    # Q13 (lane 13A): a plan note, then a matching NVDA trade entered AFTER the plan's save -- the
    # 13A walk's own recipe (tools/notebook_w13a_plan_grade_walk.py P1/P2), over HTTP
    plan = req.post(base + "/api/j2/notes", data={"title": "NVDA plan (w13q)", "ticker": "NVDA", "bodyJson": {
        "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": ln}]}
                                   for ln in ("Entry: 100", "Stop: 96", "Target: 120", "Shares: 100")]}})
    cx.seed["plan_note_http"] = plan.status
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    now = datetime.now(et)
    nxt = (now + timedelta(minutes=1)).replace(second=1, microsecond=0)
    time.sleep(max(0.0, (nxt - now).total_seconds()))
    day, hhmm = nxt.strftime("%Y-%m-%d"), nxt.strftime("%H:%M")
    pt = req.post(base + "/api/j2/trades", data={
        "symbol": "NVDA", "side": "Long", "shares": 100, "entryPrice": 100.4, "entryDate": day, "entryTimeEt": hhmm,
        "exitPrice": 110, "exitDate": day, "exitTimeEt": hhmm, "originalStop": 95})
    pb = pt.json() if pt.status == 200 else {}
    cx.seed["plan_trade_id"] = (pb.get("trade") or pb).get("id") if pb else None
    cx.seed["plan_trade_why"] = f"HTTP {pt.status}"
    if cx.seed["plan_trade_id"]:
        g = req.get(f"{base}/api/j2/plan-grades/trades/{cx.seed['plan_trade_id']}")
        cx.seed["plan_grade_http"] = g.status


# ── seeding for Q14, Q16-Q19 and Q21-Q23 (the finish program's CLICKS lane) ──────────────────
# Each recipe is the owning lane's own walk recipe, called or copied field for field from that
# lane's walk tool (named beside each). Nothing here is a member step, so nothing is counted.

RESEARCH_SEED_CHILD = r'''
import json, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services import transcript_index
transcript_index.put("NVDA", 2026, 2, "2026-08-27", spec["content"])
print("SEEDED", transcript_index.DB_PATH)
'''


def seed_research_stores(data_dir: Path, out: Path) -> str:
    """PRE-BOOT: the stored NVDA earnings call Q19 quotes from (tools/notebook_w13g1_walk.py's own
    transcript, written by a child under the sandbox's census pins) and the three daily closes the
    setups board measures its distances on (tools/notebook_w13j_walk.py's own bars child)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", RESEARCH_SEED_CHILD, str(REPO), str(data_dir),
                        json.dumps({"content": w13g1.CONTENT})],
                       cwd=str(REPO), env=env, capture_output=True, text=True, timeout=600)
    (out / "seed-research-child.log").write_text((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or "")[-6000:],
                                                 encoding="utf-8")
    line = [ln for ln in (r.stdout or "").splitlines() if ln.startswith("SEEDED")]
    if r.returncode != 0 or not line:
        raise h.SetupFailed(f"seeding the stored transcript failed (rc {r.returncode}); see seed-research-child.log")
    slashed = lambda s: str(s).lower().replace("\\", "/")  # noqa: E731
    if slashed(data_dir) not in slashed(line[-1]):
        raise h.SetupFailed(f"the transcript store resolved outside the sandbox: {line[-1]}")
    w13j.seed_bars(data_dir, {"ZQVA": {"day": w13j.TODAY, "c": 100.0}, "ZQVB": {"day": w13j.TODAY, "c": 50.0},
                              "ZQVC": {"day": w13j.TODAY, "c": 200.0}}, out)
    return line[-1]


PLAYBOOK_SETUP = "Pullback"
PLAYBOOK_TRADES = 25           # R3: 25 or more reads "normal", so the number shows without a reveal
WHY_SYMBOLS = ["COST", "ADBE", "INTC", "CSCO"]


def _fp_cell(value, source="screener_row", missing=None):
    return {"value": value, "source": source, "missing": missing}


def _tagged_plan_body(symbol: str, tag: str, rs: int, depth: float, adr: float, pole: float, day: str) -> dict:
    """A plan note whose chart carries a setup tag and a frozen fingerprint -- the shape
    tools/notebook_w13i2_walk.py seeds (`seeded_fingerprint` + `plan_body`), SYNTHETIC."""
    from zoneinfo import ZoneInfo
    fields = {f: _fp_cell(None, missing="not_in_screener_row") for f in (
        "adr_pct", "pct_vs_sma10", "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200", "ma_stack",
        "ema_stack_intact", "rs_rank", "rs_line_trend", "base_length_bars", "base_depth_pct",
        "pullback_depth_pct", "vol_nweek_low", "close_cv_pct", "pole_pct")}
    fields.update({"rs_rank": _fp_cell(rs), "base_depth_pct": _fp_cell(depth, "bars"), "adr_pct": _fp_cell(adr),
                   "pole_pct": _fp_cell(pole), "ma_stack": _fp_cell("full-bull"), "vol_nweek_low": _fp_cell(15),
                   "rs_line_trend": _fp_cell("up")})
    fields["patterns"] = _fp_cell(None, "pattern_vision", "patterns_current_window_only")
    fp = {"v": 1, "symbol": symbol, "requested_as_of": day, "as_of": day, "mode": "nightly", "fields": fields,
          "seeded": "synthetic walk seed"}
    to_unix = int(datetime.fromisoformat(day + "T16:00:00").replace(tzinfo=ZoneInfo("America/New_York")).timestamp())
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": f"{symbol} setup notes."}]},
        {"type": "widgetEmbed", "attrs": {
            "v": 1, "widgetId": "chart", "params": {"symbol": symbol, "tf": "D", "to": to_unix},
            "capturedAt": datetime.now().astimezone().isoformat(), "embedId": f"seed-{symbol.lower()}",
            "mode": "snapshot", "fallback": None, "annotations": [], "layout": {"width": "full", "height": None},
            "searchText": f"[chart: {symbol} D]", "ta": {"v": 1, "setupTag": tag, "fingerprint": fp}}}]}


def seed_new_lanes(cx: Ctx, data_dir: Path, out: Path) -> None:
    """POST-BOOT, over the member's own HTTP routes plus two child runs of the product's own
    jobs (13D's awareness scan, 13J's nightly match run). Every id a flow needs is in cx.seed;
    a recipe that fails leaves a reason there and its flow reads INCONCLUSIVE with it."""
    from zoneinfo import ZoneInfo
    req, base = cx.req, cx.base
    et_now = datetime.now(ZoneInfo("America/New_York"))
    today_et = et_now.strftime("%Y-%m-%d")

    def trade(sym, entry, stop, exit_, day, setup=None, hhmm=None):
        body = {"symbol": sym, "side": "Long", "shares": 100, "entryPrice": entry, "entryDate": day,
                "exitPrice": exit_, "exitDate": day, "originalStop": stop}
        if setup:
            body["setup"] = setup
        if hhmm:
            body.update(entryTimeEt=hhmm[0], exitTimeEt=hhmm[1])
        t = req.post(base + "/api/j2/trades", data=body)
        return t.status

    # Q20 (13H, tools/notebook_w13h2_walk.py `run`): the plan panel sizes against the member's own
    # account risk, so max risk per trade is set to 1% through the product's own settings route
    try:
        accts = req.get(base + "/api/j2/accounts").json().get("accounts") or []
        acct_id = (accts[0] or {}).get("id") if accts else None
        cur = req.get(f"{base}/api/j2/accounts/{acct_id}/settings").json() if acct_id else {}
        put = req.put(f"{base}/api/j2/accounts/{acct_id}/settings", data={**cur, "maxRiskPerTradePct": 1}) if acct_id else None
        cx.seed["account_risk"] = {"account": acct_id, "http": put.status if put else None}
    except Exception as e:  # noqa: BLE001
        cx.seed["account_risk"] = {"error": str(e)[:200]}

    # Q14 (13B, tools/notebook_w13b_playbook_walk.py W1): 25 closed trades tagged one setup
    start = datetime(2026, 6, 1)
    codes = [trade("SPY" if i % 2 else "QQQ", 50, 49, 52.0 if i % 5 < 2 else 49.0,
                   (start + timedelta(days=i)).strftime("%Y-%m-%d"), setup=PLAYBOOK_SETUP)
             for i in range(PLAYBOOK_TRADES)]
    cx.seed["playbook"] = {"setup": PLAYBOOK_SETUP, "trades": codes.count(200), "http": sorted(set(codes))}

    # Q18 (13F, tools/notebook_w13f_walk.py W1): this week's trades, a loss and a re-entry on the
    # same name 15 minutes later (the revenge detector's own shape), never a future day
    monday = et_now - timedelta(days=et_now.weekday())
    elapsed = (et_now.date() - monday.date()).days
    day_of = lambda off: (monday + timedelta(days=min(off, elapsed))).strftime("%Y-%m-%d")  # noqa: E731
    cx.seed["review_week"] = {
        "week_start": monday.strftime("%Y-%m-%d"),
        "http": [trade("AMD", 100, 99, 95, day_of(0), hhmm=("10:00", "10:30")),
                 trade("AMD", 95, 94, 93, day_of(0), hhmm=("10:45", "11:15")),
                 trade("AAPL", 100, 99, 103, day_of(1), hhmm=("10:00", "15:00")),
                 trade("TSLA", 100, 99, 102, day_of(2), hhmm=("10:00", "15:00"))]}

    # Q17 (13E, tools/notebook_w13e2_walk.py P1): one position entered TODAY per (mode, width);
    # the context freezes at the fill, so a past day would show no prompt at all
    why = {}
    for key, sym in zip((f"mouse-{cx.wide}", f"keys-{cx.wide}", "keys-390", "taps-390"), WHY_SYMBOLS):
        p = req.post(base + "/api/j2/positions", data={"symbol": sym, "side": "Long", "shares": 10,
                                                       "entryPrice": 100.0, "stopPrice": 95.0, "entryDate": today_et})
        why[key] = {"symbol": sym, "http": p.status}
    cx.seed["why_positions"] = why

    # Q22 (13I, tools/notebook_w13i2_walk.py): four plan notes whose charts carry a setup tag
    vp = {}
    last = et_now.date()
    while last.weekday() >= 5:
        last -= timedelta(days=1)
    for sym, tag, rs, depth, adr, pole in (("AMD", "VCP", 96, 9.5, 4.2, 71.0), ("TSLA", "VCP", 82, 14.0, 5.8, 55.0),
                                           ("MSFT", "Flat Base Breakout", 91, 7.1, 2.1, 33.0),
                                           ("META", "Bull Flag", 88, 12.0, 3.3, 41.0)):
        r = req.post(base + "/api/j2/notes", data={"title": f"{sym} setup (w13q)", "ticker": sym,
                                                   "bodyJson": _tagged_plan_body(sym, tag, rs, depth, adr, pole,
                                                                                 last.isoformat())})
        vp[sym] = {"id": r.json()["note"]["id"] if r.status in (200, 201) else None, "tag": tag, "http": r.status}
    cx.seed["visual_playbook"] = vp

    # Q23 (13J, tools/notebook_w13j_walk.py): three chart notes with drawn levels, then the REAL
    # nightly match run with that walk's own injected universe (never the screener store)
    board = {}
    for sym, args, kw in (("ZQVA", (102, 97, 115), {"tag": "VCP", "fingerprint": w13j.TEMPLATE_FINGERPRINT}),
                          ("ZQVB", (55, None), {}), ("ZQVC", (180, 190), {})):
        r = req.post(base + "/api/j2/notes", data={"title": f"{sym} plan", "ticker": sym,
                                                   "bodyJson": w13j.doc_with_chart(sym, *args, **kw)})
        board[sym] = r.status
    cx.seed["board_notes_http"] = board
    try:
        universe = {"as_of": w13j.TODAY, "rows": [{"symbol": "CRWD", "as_of": w13j.TODAY, "is_etf": False,
                                                    "values": w13j.CANDIDATE_VALUES}], "truncated": False}
        cx.seed["board_nightly"] = w13j.run_nightly_seed(data_dir, universe, out)
    except Exception as e:  # noqa: BLE001 -- Q23 reads INCONCLUSIVE with this reason
        cx.seed["board_nightly_error"] = str(e)[:300]

    # Q16 (13D, tools/notebook_w13d_walk.py W1-W3): a note that names a stop, an edit (the first
    # edit checkpoints the version that named it), then the awareness scan twice -- above the
    # stop, then through it. The scan is the product's own, run by that walk's own child.
    try:
        cr = req.post(base + "/api/j2/notes", data={"title": "ORCL swing plan (w13q)", "ticker": "ORCL",
                                                     "bodyJson": w13d.doc("The plan", "Stop: 100")})
        n0 = cr.json()["note"]
        req.put(f"{base}/api/j2/notes/{n0['id']}", data={"bodyJson": w13d.doc("The plan", "Stop: 100", "Target: 130"),
                                                          "baseUpdatedAt": n0["updatedAt"]})
        w13d.scan(data_dir, {"ORCL": {"price": 104.0}}, out, "q16-1-at-104")
        s2 = w13d.scan(data_dir, {"ORCL": {"price": 98.0}}, out, "q16-2-at-98")
        hist = req.get(base + "/api/voice/insights").json().get("insights") or []
        link = next((i.get("link") for i in hist if i.get("kind") == "note_level_touch" and i.get("link")), None)
        cx.seed["resurface"] = {"note": n0["id"], "link": link, "fired": s2["result"]["resurface"]["fired"]}
    except Exception as e:  # noqa: BLE001 -- Q16 reads INCONCLUSIVE with this reason
        cx.seed["resurface"] = {"link": None, "error": f"{type(e).__name__}: {str(e)[:300]}"}


# ── flow building blocks ─────────────────────────────────────────────────────────────────
# Counting rule (written once, applied everywhere): a CLICK or TAP on a control counts; a
# KEYSTROKE that is not content counts (Enter, Escape, a chord such as Ctrl+K or Ctrl+Alt+D, and
# a single trigger character such as "/" or "@" that opens a picker); every Tab counts and is
# reported separately. CONTENT does not count: a title, a ticker, a search query, the name typed
# after a trigger to filter a picker ("/price NVDA", "@tomorrow"), a tag, a task's words. A
# keystroke a MOUSE flow cannot avoid (a slash trigger) is recorded in the row (`keystrokes`) and
# named in the reading; the mouse figure is clicks.

def is_focused(pg, loc) -> bool:
    try:
        h_ = loc.first.element_handle(timeout=3000)
        return bool(pg.evaluate("h => h === document.activeElement || h.contains(document.activeElement)", h_))
    except Exception:  # noqa: BLE001
        return False


def focus_field(m: Meter, loc, label: str):
    """Put focus in a field the member is about to type into. Free when it already has focus."""
    loc = loc.first
    loc.wait_for(state="visible", timeout=20000)
    # A page that focuses its own field does it a frame or two after the field appears (the
    # Ask panel waits two frames on purpose). Sampling at once read "not focused" on a field
    # that had focus a moment later, and charged a click the member never makes (Q9, lane KEYS
    # round 4). So: look for up to 0.6 s. A field that never takes focus still costs its click.
    for _ in range(6):
        if is_focused(m.pg, loc):
            m.steps.append({"do": "already focused (free)", "on": label})
            return
        m.pg.wait_for_timeout(100)
    if m.mode == "keys":
        m.keys_to(loc, label)
    else:
        m.pointer(loc, label)


def focus_editor_body(m: Meter):
    pg = m.pg
    pm = pg.locator(".ProseMirror").first
    pm.wait_for(state="visible", timeout=30000)
    if focus_in_editor(pg):
        m.steps.append({"do": "already in body (free)", "on": "note body"})
        return
    if m.mode == "keys":
        # ✅ CLOSED, 13Q-Q1check controller follow-up #2. The 13Q-3 instrument-foreground
        # compensation that used to live here (a Playwright-native `pm.focus()` call, tried
        # before the real Tab walk) is REMOVED, not just narrowed -- the product defect it was
        # masking is fixed and independently re-measured.
        #
        # Full chain, each step with its own commit: 13Q-Q1check's remount-trace recorder found
        # NotebookTab.jsx::createNote() never primed useJ2Note's SWR cache, so NoteEditorPage's
        # first render saw `note: null`, built an EMPTY editor, fired the 'body' openFocus
        # effect's one-shot call on THAT instance, then tore it down the instant the real GET
        # resolved -- losing the caret with the rebuild. FIXED (globalMutate prime) and
        # re-measured clean (docs/notebook/evidence/wave13-q1check/remount-trace-diagnosis/).
        # That still left a SEPARATE defect, also 10/10 reproducible
        # (docs/notebook/evidence/wave13-q1check/focus-hook-probe/, commit a90976c005): the
        # body-focus effect fired while `editor.view.dom.isConnected` was FALSE --
        # @tiptap/react's `EditorContent` attaches that DOM in its own, later commit, and
        # `focus()` on a disconnected node is a silent no-op. FIXED in NoteEditorPage.jsx (poll
        # `editor.view.dom.isConnected` across animation frames, fire the one-shot only once
        # true) and re-measured clean
        # (docs/notebook/evidence/wave13-q1check/attach-fix-reverify/, commit b6206896e4):
        # 10/10 reps, both widths, activeElement in `.ProseMirror` AND the real
        # `page.keyboard.type`-typed text landing in the note's body via the product's own
        # GET /api/j2/notes/{id}.
        #
        # No CDP-vs-natural-context theory was ever needed -- both defects were ordinary React
        # timing bugs with ordinary fixes. With the product now landing focus on its own,
        # 10/10, this branch no longer needs (or does) anything beyond the real Tab walk any
        # other mode would take. ⛔ Do not re-add a `pm.focus()` compensation without NEW
        # evidence that supersedes the measurement cited above.
        m.tab_to("el.closest && el.closest('.ProseMirror')", "note body")
    else:
        m.pointer(pm, "note body")
    pg.keyboard.press("End")  # caret placement is setup inside the focused body, not a member step
    m.steps.append({"do": "End (caret to line end, not counted)"})


def use_skip_link(m: Meter, label_regex: str, log_label: str | None = None) -> bool:
    """13Q-3: take a visible skip link the way a real keyboard member actually would, rather
    than tab through the shared app nav + Journal tab bar to reach a spot a skip link already
    reaches directly -- that chrome-walk cost is 13Q-2's own finding (section 4: Q2, Q4, Q9,
    Q11, Q12, Q15, Q20 all pay it), not a cost this instrument should keep re-measuring once a
    real door exists. The app shell portals every page's own skip link to the SAME early slot
    right after "Skip to main content" (components/skipLinks.jsx), so reaching one costs at
    most a handful of real Tab presses regardless of chrome size -- measured, not assumed, in
    the re-run this fix is committed with. Mouse/taps never call this (nothing to skip with a
    pointer or a finger; they already click/tap the real control directly). Returns whether a
    matching, visible skip link was found and used -- a flow decides what to do if not (several
    surfaces only have ONE skip link, and not every flow's target is behind one)."""
    if m.mode != "keys":
        return False
    import re
    link = m.pg.get_by_role("link", name=re.compile(label_regex, re.I)).filter(visible=True)
    if link.count() == 0:
        return False
    m.press(link, log_label or f"skip link: {label_regex}")
    return True


def use_skip_link_back(m: Meter, label_regex: str, log_label: str) -> bool:
    """A skip link reached by Shift+Tab: for a member whose focus is in the folder panel, the
    shell's skip links are a few stops BEHIND them, and forward Tab would go round the whole
    page (measured: 86 and 162 presses, Q2 and Q11). Keys mode only."""
    if m.mode != "keys":
        return False
    import re
    link = m.pg.get_by_role("link", name=re.compile(label_regex, re.I))
    if link.count() == 0:
        return False
    m.shift_tab_to_locator(link, log_label)
    m.key("Enter", f"activate {log_label}")
    return True


def from_top(m: Meter) -> bool:
    """Keys mode: when focus is on <body> (a fresh page, or a route change that dropped it), the
    next Tab is the shell's "Skip to main content". A keyboard member takes it rather than walk
    the app's left rail (13Q-3's convention). Free in the other modes and when focus is somewhere."""
    if m.mode != "keys":
        return False
    if not m.pg.evaluate("() => !document.activeElement || document.activeElement === document.body"):
        return False
    return use_skip_link(m, r"^Skip to main content$", "Skip to main content")


def journal_chord(m: Meter, letter: str, label: str, url_glob: str) -> bool:
    """Keys mode: the Journal's own documented navigation, "g then <letter>" (HOTKEY_ROUTES in
    JournalLayout.jsx, listed on the shortcut sheet a member opens with "?"). Two keystrokes,
    both counted. Returns whether the page went where the chord says; a caller falls back to
    the tab row if it did not (the two keys stay counted)."""
    if m.mode != "keys":
        return False
    m.key("g", f"Journal shortcut, g then {letter}: {label}")
    m.key(letter, f"Journal shortcut, g then {letter}: {label}")
    try:
        m.pg.wait_for_url(url_glob, timeout=8000)
        return True
    except Exception:  # noqa: BLE001
        m.steps.append({"do": "the shortcut did not navigate; falling back to the tab row", "on": label})
        return False


def caret_at_top(pg) -> None:
    """SETUP for a keyboard run that starts 'working in the note' when the note holds a chart:
    the caret goes in the first paragraph. A click in the middle of the editor can land on the
    chart's own chrome instead (the 13H-2 walk measured exactly that)."""
    para = pg.locator(".ProseMirror p").first
    pg.evaluate("() => { const m = document.querySelector('main') || document.scrollingElement;"
                " document.querySelectorAll('*').forEach(e => { if (e.scrollTop > 0) e.scrollTop = 0 }) }")
    para.scroll_into_view_if_needed()
    para.click()
    pg.keyboard.press("End")
    pg.wait_for_timeout(300)


def use_template_search(m: Meter, dlg, card_label: str, card_key: str) -> bool:
    """13Q-5: the Templates dialog's own search box autofocuses on open
    (TemplatePicker.jsx's `autoFocusSearch`); typing the card's own label narrows to it
    (or to it alone, if the label is unique in the catalog -- it is, by construction) and
    Enter there picks whichever card the box's own active-index highlights, reusing the
    card's EXISTING onClick (TemplatePicker.jsx's onSearchKeyDown -- never a second onPick
    path). Measured cost: 23 real Tab presses to tab-hunt one named card down to roughly a
    chord-free single Enter (docs/notebook/evidence/wave13-13q3/run-remeasure-final/, Q2).
    Keys mode only. Returns whether the search-driven pick landed; a caller falls back to
    the real Tab walk if not -- the SAME compensate-or-fall-through shape
    `focus_editor_body` already uses, so a genuine regression here still measures honestly
    rather than being silently skipped."""
    if m.mode != "keys":
        return False
    search = dlg.get_by_label("Search templates").filter(visible=True)
    if search.count() == 0:
        return False
    if not is_focused(m.pg, search):
        # Instrument-only compensation, never counted -- the same category as
        # `bring_to_front()`/`focus_editor_body`'s own `.focus()` retry: there is no DOM
        # API a page can call to become the OS's foreground tab, and a real member's
        # browser tab already IS the foreground tab, so `autoFocus` lands there for them
        # exactly as it does here once this resolves it.
        search.first.focus()
        if not is_focused(m.pg, search):
            return False
    m.type(card_label, "search templates")
    active = dlg.locator(f"[data-template-key='{card_key}'][data-active='true']")
    try:
        active.first.wait_for(state="visible", timeout=3000)
    except Exception:  # noqa: BLE001 -- the search did not converge on this card; fall through
        return False
    m.key("Enter", f"pick the highlighted match ({card_label})")
    return True


def use_bulk_shortcut(m: Meter) -> bool:
    """13Q-5: Ctrl+Alt+B (documented on the bar's own visible "N selected" hint,
    BulkActionBar.jsx) jumps focus straight into the bulk-action bar once a selection
    exists, instead of the real Tab-walk past however many notes remain in the view.
    Measured cost this replaces: 167-179 real Tab presses to reach "Tags"/"Move to
    select" from a just-ticked row (docs/notebook/evidence/wave13-13q3/
    run-remeasure-final/, Q11). Keys mode only; a caller still finishes the reach with
    its own `m.press`/`tab_to_locator` on the exact control it wants, so a target the
    shortcut's default stop does not land on is still measured honestly, never assumed."""
    if m.mode != "keys":
        return False
    bar = m.pg.locator("[data-bulk-bar]")
    if bar.count() == 0:
        return False
    m.key("Control+Alt+b", "jump to the bulk-action bar (Ctrl+Alt+B)")
    return True


def go_all_notes(m: Meter):
    """From anywhere in the Notebook to the notes list (where + New note / Today / Templates live).
    "All notes" lives in the folder sidebar, which renders BEFORE the Notebook's own main-pane
    skip link target in DOM order, so the "Skip to note(s) list" link cannot reach it -- this
    uses the SIBLING "Skip to folder navigation" link (FolderSidebar.jsx) instead, which lands
    right at the top of the sidebar the row lives in."""
    pg = m.pg
    row = pg.locator("[data-all-notes-row]")
    try:
        row.first.wait_for(state="visible", timeout=6000)
    except Exception:  # noqa: BLE001
        toggle = pg.get_by_role("button", name="Show folders panel")
        if toggle.count() == 0:
            raise Inconclusive("the 'All notes' row is not visible and no 'Show folders panel' toggle exists")
        m.press(toggle, "Show folders panel")
    use_skip_link(m, r"Skip to folder navigation", "Skip to folder navigation")
    m.press(row, "All notes")
    pg.wait_for_url("**/journal/notebook?*view=*", timeout=20000)


def pick_option(m: Meter, name_re, label: str):
    """Choose a row in an open picker: Enter in keys mode (the top row is highlighted), a click or
    tap otherwise."""
    import re
    opt = m.pg.get_by_role("option", name=re.compile(name_re, re.I))
    opt.first.wait_for(state="visible", timeout=20000)
    if m.mode == "keys":
        m.key("Enter", f"choose {label}")
    else:
        m.pointer(opt, label)


def open_note_start(cx: Ctx, pg, nid: str, caret: bool = True):
    """In-note flows start with the note open and the member WORKING in it: the caret in the body
    (a setup click, uncounted). Q1 is the flow that measures getting the caret there."""
    open_start(pg, cx.base, f"/journal/notebook?note={nid}", ready=".ProseMirror")
    if caret:
        pg.locator(".ProseMirror").first.click()
        pg.keyboard.press("End")
        pg.wait_for_timeout(300)


def wait_body(cx: Ctx, nid: str, pred, timeout_s: float = 20.0):
    end = time.time() + timeout_s
    n = None
    while time.time() < end:
        n = read_note(cx.req, cx.base, nid)
        if n and pred(n):
            return n
        time.sleep(0.7)
    return n


def fresh_note(cx: Ctx, title: str, ticker: str | None = None, text: str = "Seed paragraph.") -> str:
    data = {"title": title, "bodyJson": _doc(text)}
    if ticker:
        data["ticker"] = ticker
    r = cx.req.post(cx.base + "/api/j2/notes", data=data)
    if r.status not in (200, 201):
        raise Inconclusive(f"setup: could not create the flow's note (HTTP {r.status})")
    return r.json()["note"]["id"]


def _run_tag(cx: Ctx, fid: str, mode: str, width: str) -> str:
    return f"{fid}-{mode}-{width}-{int(time.time() * 1000) % 10_000_000}"


# ── the flows ────────────────────────────────────────────────────────────────────────────
# Each flow: start page (setup, uncounted) -> the member's shortest path on this tree -> the
# OUTCOME verified (API read-back or the page's own answer). The return value is the evidence.

def q1_new_blank(cx: Ctx, pg, m: Meter, width: str) -> dict:
    open_start(pg, cx.base, "/journal/notebook")
    before = len(list_notes(cx.req, cx.base))
    if m.mode == "keys":
        m.key("Control+k", "open the command palette")
        m.type("new note", "palette query")
        pick_option(m, r"New Note", "New Note")
    else:
        go_all_notes(m)
        m.press(pg.locator("[data-tour='new-note']").filter(visible=True), "+ New note")
    nid = wait_note_open(pg)
    focus_editor_body(m)
    ok = focus_in_editor(pg) and len(list_notes(cx.req, cx.base)) == before + 1
    if not ok:
        raise Inconclusive(f"outcome not reached: cursor in body={focus_in_editor(pg)}, note {nid}")
    return {"note": nid, "cursor_in_body": True, "path": "palette New Note" if m.mode == "keys" else "All notes -> + New note"}


def q2_template_ticker(cx: Ctx, pg, m: Meter, width: str) -> dict:
    open_start(pg, cx.base, "/journal/notebook")
    go_all_notes(m)
    # 13Q-3: "Templates" lives in the pane's own list header -- the SAME region "Skip to notes
    # list" (NotebookTab.jsx) lands at, right past whatever remains of the sidebar after
    # go_all_notes' own click (the Keys path there still leaves focus on the "All notes" row).
    # Lane KEYS round 4: the folder panel is one Tab stop now, so the list's header is a few
    # Tabs FORWARD of "All notes". No skip link is needed on a keyboard.
    if m.mode != "keys":
        use_skip_link(m, r"Skip to notes? list", "Skip to notes list")
    m.press(pg.get_by_role("button", name="Templates", exact=True).filter(visible=True), "Templates")
    dlg = pg.get_by_role("dialog", name="New note")
    dlg.wait_for(state="visible", timeout=20000)
    card = dlg.locator("[data-template-key='thesis']")
    if card.count() == 0:
        card = dlg.locator("[data-template-key]").nth(1)
    key = card.first.get_attribute("data-template-key")
    label = card.first.get_attribute("aria-label") or key
    # 13Q-5: the dialog's own search box, not a Tab-hunt through every card.
    if not use_template_search(m, dlg, label, key):
        m.press(card, f"template card {key}")
    nid = wait_note_open(pg)
    tick = pg.locator("input[aria-label='Ticker']").filter(visible=True)
    if tick.count() == 0:
        raise Inconclusive("the note header carries no visible Ticker field at this width")
    if m.mode == "keys" and not is_focused(pg, tick.first):
        # a new note puts focus in its title; Ticker is a few stops BEFORE it
        m.shift_tab_to_locator(tick, "Ticker field")
    else:
        focus_field(m, tick, "Ticker field")
    m.fill(tick, "NVDA", "ticker")
    # the field saves on blur: the member leaves it -- Tab (keys) or a click into the body
    if m.mode == "keys":
        m.key("Tab", "leave the Ticker field (saves on blur)")
    else:
        m.pointer(pg.locator(".ProseMirror").first, "into the body (saves the ticker on blur)")
    n = wait_body(cx, nid, lambda n: (n.get("ticker") or "").upper() == "NVDA")
    if not n or (n.get("ticker") or "").upper() != "NVDA":
        raise Inconclusive(f"outcome not reached: note {nid} ticker={n and n.get('ticker')!r}")
    return {"note": nid, "template": key, "ticker": n.get("ticker")}


def q3_open_by_title(cx: Ctx, pg, m: Meter, width: str) -> dict:
    title = "Semis rotation notes"
    nid = cx.seed["notes"][title]
    open_start(pg, cx.base, "/journal/notebook")
    import re
    if m.mode == "keys":
        m.key("Control+k", "open the command palette")
        m.type("rotation", "palette query")
        pick_option(m, r"^Note: Semis rotation", f"Note: {title}")
    else:
        direct = pg.get_by_role("button", name=re.compile(re.escape(title))).filter(visible=True)
        if direct.count() == 0:
            direct = pg.locator(f"[data-note-card-id='{nid}']").filter(visible=True)
        if direct.count() == 0:
            go_all_notes(m)
            direct = pg.locator(f"[data-note-card-id='{nid}']").filter(visible=True)
        m.press(direct, f"note row '{title}'")
    got = wait_note_open(pg)
    if got != nid:
        raise Inconclusive(f"outcome not reached: opened {got}, wanted {nid}")
    return {"note": nid}


def q4_search_open(cx: Ctx, pg, m: Meter, width: str) -> dict:
    nid = cx.seed["notes"]["CRWD base watch"]
    open_start(pg, cx.base, "/journal/notebook")
    if m.mode == "keys":
        # Lane KEYS: the palette's "Search Notebook" now opens the search panel with the cursor
        # in the box (it used to open the Notebook and stop). Ctrl+K, the name, Enter.
        m.key("Control+k", "open the command palette")
        m.type("search notebook", "palette query")
        pick_option(m, r"Search Notebook", "Search Notebook")
        box = pg.get_by_label("Search your notes").filter(visible=True)
        try:
            box.first.wait_for(state="visible", timeout=15000)
        except Exception:  # noqa: BLE001
            raise Inconclusive("the palette's Search Notebook did not open the search box")
        focus_field(m, box, "Search your notes")
        m.fill(box, "CRWD", "search query")
        pg.wait_for_timeout(1200)
        m.key("Enter", "open the first hit")
        got = wait_note_open(pg)
        if got != nid:
            raise Inconclusive(f"outcome not reached: opened {got}, wanted {nid}")
        return {"note": nid, "path": "palette: Search Notebook"}
    tab = pg.get_by_role("tab", name="Search notes").filter(visible=True)
    if tab.count() == 0:
        toggle = pg.get_by_role("button", name="Show folders panel")
        if toggle.count():
            m.press(toggle, "Show folders panel")
        tab = pg.get_by_role("tab", name="Search notes").filter(visible=True)
    # 13Q-3: "Search notes" lives in the folder sidebar, same region "Skip to folder
    # navigation" (FolderSidebar.jsx) lands at -- a couple of presses, not a chrome walk.
    use_skip_link(m, r"Skip to folder navigation", "Skip to folder navigation")
    m.press(tab, "Search notes tab")
    box = pg.get_by_label("Search your notes").filter(visible=True)
    focus_field(m, box, "Search your notes")
    m.fill(box, "CRWD", "search query")
    pg.wait_for_timeout(1200)
    if m.mode == "keys":
        m.key("Enter", "open the first hit")
    else:
        hit = pg.locator(f"[data-note-card-id='{nid}']").filter(visible=True)
        if hit.count() == 0:
            import re
            hit = pg.get_by_role("button", name=re.compile("CRWD base watch")).filter(visible=True)
        m.press(hit, "search hit 'CRWD base watch'")
    got = wait_note_open(pg)
    if got != nid:
        raise Inconclusive(f"outcome not reached: opened {got}, wanted {nid}")
    return {"note": nid}


def q5_today(cx: Ctx, pg, m: Meter, width: str) -> dict:
    # 13Q-3 (click-budget fix): bare-root Research Home now carries its own "Today" button
    # (wired to the same openToday NotebookTab.jsx's list-header button already calls -- one
    # authority), so mouse/taps no longer detour through "All notes" to reach it.
    open_start(pg, cx.base, "/journal/notebook")
    if m.mode == "keys":
        m.key("Control+Alt+d", "Today's note (Ctrl+Alt+D)")
    else:
        m.press(pg.get_by_role("button", name="Today", exact=True).filter(visible=True), "Today")
    nid = wait_note_open(pg)
    n = read_note(cx.req, cx.base, nid) or {}
    return {"note": nid, "title": n.get("title")}


def q6_link_trade(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """No in-note control exists to link a trade (the note only SHOWS linked trades). The
    shortest path on this tree runs from the trade: the Journal's Trades tab -> Closed -> the
    trade -> Save to Notebook -> Current note. The flow starts on the note the member wants
    linked (which makes it the 'current note')."""
    nid = fresh_note(cx, f"Trade link target {_run_tag(cx, 'Q6', m.mode, width)}", "CRWD")
    tid = cx.seed.get("trade_id")
    if not tid:
        raise Inconclusive("setup: no seeded closed trade")
    open_note_start(cx, pg, nid)
    pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur() }")
    import re
    # the Notebook lives under the Trade Journal's own tab row, so Trades is one press away
    if not journal_chord(m, "j", "Closed trades", "**/journal/trades?*seg=closed*"):
        trades = pg.get_by_role("link", name=re.compile(r"^Trades")).filter(visible=True)
        m.press(trades, "Journal tab: Trades")
        pg.wait_for_timeout(1500)
        closed = pg.get_by_role("button", name=re.compile(r"Closed", re.I)).filter(visible=True)
        if closed.count() == 0:
            closed = pg.get_by_role("tab", name=re.compile(r"Closed", re.I)).filter(visible=True)
        if closed.count():
            m.press(closed, "Trades segment: Closed")
            pg.wait_for_timeout(1200)
    row = _trade_row(pg, "CRWD")
    from_top(m)
    if row.count() == 0:
        raise Inconclusive("the seeded CRWD trade row is not visible on the Trades surface")
    m.press(_row_opener(row, "CRWD"), "CRWD trade row")
    save = pg.get_by_role("button", name=re.compile(r"Save to Notebook")).filter(visible=True)
    try:
        save.first.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        pass
    if save.count() == 0:
        raise Inconclusive(f"no 'Save to Notebook' door on the trade view reached (url {pg.url})")
    m.press(save, "Save to Notebook")
    cur = pg.get_by_role("menuitem", name=re.compile(r"Current note")).filter(visible=True)
    if cur.count() == 0:
        cur = pg.get_by_role("button", name=re.compile(r"Current note")).filter(visible=True)
    m.press(cur, "Current note")
    links = None
    end = time.time() + 15
    while time.time() < end:
        r = cx.req.get(f"{cx.base}/api/j2/notes/{nid}")
        body = json.dumps((r.json() or {}).get("note", {})) if r.status == 200 else ""
        if str(tid) in body or "tradeRef" in body:
            links = True
            break
        time.sleep(0.8)
    if not links:
        raise Inconclusive(f"outcome not reached: note {nid} carries no reference to trade {tid}; toast: {toast_text(pg)!r}")
    return {"note": nid, "trade": tid, "path": "note -> Trades tab -> Closed -> trade -> Save to Notebook -> Current note"}


def _trade_row(pg, sym: str):
    """The trade's row on the Trades surface: a table row on a wide screen, whatever control names
    the symbol on a phone layout. Returns a locator (possibly empty)."""
    row = pg.locator("tr", has_text=sym).filter(visible=True)
    # 13Q-3: was `has_text=re.compile(rf"\b{sym}\b")`, but the COMMITTED bytes were two literal
    # backspace control characters (0x08) around {sym}, not the escape "\b" -- a pattern that can
    # never match ordinary page text. Plain has_text=sym (row's own substring semantics) fixes it
    # without any regex escaping. Evidence: docs/notebook/evidence/wave13-13q3/q6-q13-instrument-fix/.
    alt = pg.locator("a, button, [role=button], [role=row], li", has_text=sym).filter(visible=True)
    # Lane KEYS round 3: the loose match counts only when it is STILL THERE on the next sample.
    # The page being left can name the symbol too (a note's ticker chip). Taken at once, that
    # chip was returned as "the trade row", was gone a moment later, and Q6 read INCONCLUSIVE
    # beside a screenshot of the Trades page's half-second "Loading" fallback: three times in
    # three runs, and read as a stuck page. A real table row is taken at once: only Trades has one.
    end = time.time() + 45
    alt_seen = False
    while time.time() < end:   # the trades table loads after the surface: wait for it, never sample once
        if row.count():
            return row
        if alt.count():
            if alt_seen:
                return alt
            alt_seen = True
        else:
            alt_seen = False
        pg.wait_for_timeout(400)
    return row


def _row_opener(row, sym: str):
    """What a member activates to open a trade row: a link or button naming the symbol if the row
    has one, else the symbol's own cell text."""
    # Finish program, lane CLICKS: the row's OWN door first. On the desktop table that is the
    # symbol cell (TradesTable.jsx gives it the click handler and tabIndex 0); on a phone the row
    # is itself a button. The fallbacks below reached for a text span, which no Tab press can
    # land on (two capped keyboard rows) and whose click a status chip beside it can swallow.
    cell = row.first.locator("td[tabindex]")
    if cell.count():
        return cell.first
    if row.first.evaluate("el => el.tagName") in ("BUTTON", "A"):
        return row.first
    named = row.first.locator("a, button", has_text=sym)
    if named.count():
        return named.first
    txt = row.first.get_by_text(sym, exact=True)
    return txt.first if txt.count() else row.first


def q7_screener(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """The plan's CONTROL (ruling P5): the Screener's Save to Notebook door, ScannerShell.jsx
    (Screener-owned; measured only). Starts at the top of /screener with results showing."""
    target = fresh_note(cx, f"Screener target {_run_tag(cx, 'Q7', m.mode, width)}")
    open_note_start(cx, pg, target)       # setup: the member was just working in this note
    open_start(pg, cx.base, "/screener")
    door = pg.get_by_role("button", name="Save these results to Notebook").filter(visible=True)
    try:
        door.first.wait_for(state="visible", timeout=45000)
        end = time.time() + 45
        while time.time() < end and door.first.is_disabled():
            pg.wait_for_timeout(500)
    except Exception as e:  # noqa: BLE001
        raise Inconclusive(f"the Save to Notebook door never showed on /screener: {str(e)[:200]}")
    if door.first.is_disabled():
        raise Inconclusive("the door stayed disabled: the screener produced no result set in this sandbox")
    settle(pg, 800)
    pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur();"
                " window.scrollTo(0, 0) }")
    before = {n["id"]: n.get("updatedAt") for n in list_notes(cx.req, cx.base)}
    inbox_before = _inbox_count(cx)
    # Finish program, lane NAV: the Screener's own "Skip to save results" (ScannerShell.jsx, in
    # the shell's skip-link slot) lands right before the door. A keyboard member takes it.
    use_skip_link(m, r"^Skip to save results$", "Skip to save results")
    m.press(door, "Save these results to Notebook")
    changed, msg = [], ""
    end = time.time() + 15
    while time.time() < end:
        msg = journal_toast(pg) or msg
        after = {n["id"]: n.get("updatedAt") for n in list_notes(cx.req, cx.base)}
        changed = [i for i, u in after.items() if before.get(i) != u]
        if changed:
            break
        pg.wait_for_timeout(700)
    inbox_after = _inbox_count(cx)
    if target not in changed:
        raise Inconclusive(f"outcome not reached: the current note {target} did not receive the results "
                           f"(notes changed {changed}; inbox {inbox_before}->{inbox_after}); toast {msg!r}")
    return {"toast": msg, "note": target, "notes_changed": changed, "inbox": [inbox_before, inbox_after],
            "focus_after_save": pg.evaluate(FOCUS_DESC_JS)}


def _inbox_count(cx: Ctx) -> int | None:
    r = cx.req.get(cx.base + "/api/j2/inbox")
    if r.status != 200:
        return None
    b = r.json()
    items = b if isinstance(b, list) else (b.get("items") or b.get("captures") or [])
    return len(items)


def q8_fact(cx: Ctx, pg, m: Meter, width: str) -> dict:
    nid = fresh_note(cx, f"Fact target {_run_tag(cx, 'Q8', m.mode, width)}", "NVDA")
    open_note_start(cx, pg, nid)
    focus_editor_body(m)
    m.key("Enter", "new line")
    m.key("/", "slash trigger")
    m.type("price NVDA", "slash query")
    pick_option(m, r"^Price", "Price — NVDA")
    n = wait_body(cx, nid, lambda n: "financialFact" in json.dumps(n.get("bodyJson") or {}), 25)
    if not n or "financialFact" not in json.dumps(n.get("bodyJson") or {}):
        raise Inconclusive("outcome not reached: no financialFact node landed (the fact route needs a quote "
                           f"provider; vendor keys are blank in this sandbox). Toast: {toast_text(pg)!r}")
    return {"note": nid, "fact": True}


ASK_SSE_TEMPLATE = None


def _ask_stub(nid: str, title: str):
    src = {"n": 1, "type": "note", "label": title, "citation": "valid", "snippet": "seeded body",
           "navigation": {"kind": "note", "noteId": nid}, "location": {}, "stance": None, "payload": {},
           "textOrigin": None, "truncated": False}
    frames = [{"type": "sources", "scope": "note", "scopeLabel": "This note", "sources": [src]},
              {"type": "delta", "text": "The thesis is a base breakout above the pivot [1]."},
              {"type": "final", "answer": "The thesis is a base breakout above the pivot [1]."}]
    return "".join(f"data: {json.dumps(f)}\n\n" for f in frames)


def q9_ask_insert(cx: Ctx, pg, m: Meter, width: str) -> dict:
    title = f"Ask target {_run_tag(cx, 'Q9', m.mode, width)}"
    nid = fresh_note(cx, title, "NVDA", "NVDA breakout above the pivot on volume.")
    body = _ask_stub(nid, title)
    pg.route("**/api/j2/ask/stream", lambda route: route.fulfill(status=200, body=body,
                                                                  headers={"content-type": "text/event-stream"}))
    open_note_start(cx, pg, nid)
    # 13Q-3: the Ask toggle sits in the sticky chrome, ABOVE the body the member's caret just
    # landed in (setup) -- "Skip to editor toolbar" (NoteEditorPage.jsx) lands right before it,
    # a couple of presses, instead of the editor's own ~80-tab-stop content tree.
    use_skip_link(m, r"Skip to editor toolbar", "Skip to editor toolbar")
    m.press(pg.locator("[data-ask-toggle]").filter(visible=True), "Ask a question about this note")
    import re
    box = pg.get_by_placeholder(re.compile("What did I say")).filter(visible=True)
    focus_field(m, box, "question field")
    m.fill(box, "What is the thesis?", "question")
    if m.mode == "keys":
        m.key("Enter", "ask")
    else:
        m.press(pg.get_by_role("button", name="Ask", exact=True).filter(visible=True), "Ask")
    ins = pg.get_by_role("button", name=re.compile(r"Insert into")).filter(visible=True)
    try:
        ins.first.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("no 'Insert into this note' button after the (stubbed) cited answer -- "
                           f"notebook_ask_insert_on latched? page says: {pg.locator('body').inner_text()[:300]!r}")
    m.press(ins, "Insert into this note")
    n = wait_body(cx, nid, lambda n: "base breakout above the pivot" in json.dumps(n.get("bodyJson") or {}), 20)
    if not n or "base breakout above the pivot" not in json.dumps(n.get("bodyJson") or {}):
        raise Inconclusive("outcome not reached: the answer text did not land in the note body")
    return {"note": nid, "inserted": True, "model": "answer stubbed at the browser network layer (model keys blank)"}


def q10_task_due(cx: Ctx, pg, m: Meter, width: str) -> dict:
    nid = fresh_note(cx, f"Task target {_run_tag(cx, 'Q10', m.mode, width)}")
    open_note_start(cx, pg, nid)
    focus_editor_body(m)
    m.key("Enter", "new line")
    m.key("/", "slash trigger")
    m.type("checklist", "slash query")
    pick_option(m, r"^Checklist", "Checklist")
    m.type("Review NVDA earnings ", "task text")
    m.key("@", "date trigger")
    m.type("tomorrow ", "date words")
    def ok(n):
        s = json.dumps(n.get("bodyJson") or {})
        return "taskItem" in s and "dateMention" in s
    n = wait_body(cx, nid, ok, 20)
    if not n or not ok(n):
        raise Inconclusive("outcome not reached: no taskItem with a dateMention in the stored body")
    return {"note": nid, "task_with_due": True}


def q11_tag_move(cx: Ctx, pg, m: Meter, width: str) -> dict:
    tag = f"w13q{m.mode}{width}"
    folder = cx.seed["folders"].get(f"{m.mode}-{width}")
    if not folder:
        raise Inconclusive("setup: no folder to move into")
    ids = [fresh_note(cx, f"Bulk {tag} {i}") for i in range(5)]
    open_start(pg, cx.base, "/journal/notebook")
    go_all_notes(m)
    # 13Q-3: the bulk-select checkboxes are in the pane's own grid -- "Skip to notes list"
    # lands right before it, same reasoning as Q2.
    if m.mode != "keys":            # as in Q2: forward of the folder panel on a keyboard
        use_skip_link(m, r"Skip to notes? list", "Skip to notes list")
    try:
        pg.get_by_role("checkbox", name=f"Select Bulk {tag} 0").filter(visible=True).first.wait_for(
            state="visible", timeout=20000)
    except Exception:  # noqa: BLE001 -- recorded below as the specific missing checkbox
        pass
    # the list is newest-first, so the member ticks them top to bottom: 4, 3, 2, 1, 0
    for i in reversed(range(len(ids))):
        box = pg.get_by_role("checkbox", name=f"Select Bulk {tag} {i}").filter(visible=True)
        if box.count() == 0:
            raise Inconclusive(f"no 'Select Bulk {tag} {i}' checkbox in the list at this width")
        if m.mode == "keys":
            # Tick the first, then Shift+Down extends the selection one note at a time and
            # carries focus (lane 13Q-5). One key per further note.
            if i == len(ids) - 1:
                m.keys_to(box.first, f"select note {i}")
                m.key("Space", f"tick note {i}")
            else:
                m.key("Shift+ArrowDown", f"extend the selection to note {i}")
        elif m.mode == "mouse":
            # The list's own range select: tick the first, Shift+click the last. Two clicks
            # for five notes (NotebookTab.bulk.test.jsx, "Shift+click selects the range").
            if i == len(ids) - 1:
                m.pointer(box, f"tick note {i}")
            elif i == 0:
                m._start()
                box.first.click(modifiers=["Shift"])
                m.clicks += 1
                m.steps.append({"do": "shift+click", "on": f"tick note {i} (range: the notes between are selected)"})
        else:
            m.pointer(box, f"tick note {i}")
    bar = pg.locator("[data-bulk-bar]")
    bar.wait_for(state="visible", timeout=10000)
    # 13Q-5: Ctrl+Alt+B jumps into the bar; `m.press` still finishes the reach onto the
    # NAMED control (0 further Tabs if the shortcut's own default stop is already it,
    # a measured few otherwise -- never assumed).
    use_bulk_shortcut(m)
    m.press(bar.get_by_role("button", name="Tags", exact=True), "Tags")
    field = pg.get_by_label("Tag to add to the selected notes").filter(visible=True)
    focus_field(m, field, "tag field")
    m.fill(field, tag, "tag")
    if m.mode == "keys":
        m.key("Enter", "Add tag")
    else:
        m.press(pg.get_by_role("button", name="Add tag").filter(visible=True), "Add tag")
    pg.wait_for_timeout(1500)
    sel = pg.get_by_label("Folder to move the selected notes to").filter(visible=True)
    if sel.count() == 0:
        raise Inconclusive("tagging landed but the bar shows no 'Move to' folder select afterwards")
    if m.mode == "keys":
        # the tag form's submit moved focus away from the bar -- the shortcut again,
        # rather than a second full Tab-walk back to it.
        use_bulk_shortcut(m)
        m.tab_to_locator(sel.first, "Move to select")
        sel.first.select_option(folder["id"])
        m.keys += 1
        m.steps.append({"do": "key", "key": "ArrowDown (choose folder; counted 1)", "on": "Move to"})
    else:
        m.pointer(sel, "Move to select (open)")
        sel.first.select_option(folder["id"])
        if m.mode == "taps":
            m.taps += 1
        else:
            m.clicks += 1
        m.steps.append({"do": "choose option (counted 1)", "on": folder["name"]})
    m.press(pg.get_by_role("button", name="Move", exact=True).filter(visible=True), "Move")
    end = time.time() + 15
    got = []
    while time.time() < end:
        got = [read_note(cx.req, cx.base, i) or {} for i in ids]
        if all(tag in (n.get("tags") or []) and n.get("folderId") == folder["id"] for n in got):
            break
        time.sleep(0.8)
    done = [bool(tag in (n.get("tags") or []) and n.get("folderId") == folder["id"]) for n in got]
    if not all(done):
        raise Inconclusive(f"outcome not reached: per-note tagged-and-moved={done}")
    return {"notes": ids, "tag": tag, "folder": folder["name"]}


def q12_export_word(cx: Ctx, pg, m: Meter, width: str) -> dict:
    nid = fresh_note(cx, f"Export target {_run_tag(cx, 'Q12', m.mode, width)}")
    open_note_start(cx, pg, nid)
    import re
    # 13Q-3: "More note actions" sits in the sticky chrome, same reasoning as Q9's Ask toggle.
    more = pg.locator("button[aria-label='More note actions']").filter(visible=True)
    if m.mode == "keys":
        # the member is in the note's body and More is in the header ABOVE it: back, not round
        m.shift_tab_to_locator(more, "More note actions")
        m.key("Enter", "activate More note actions")
    else:
        m.press(more, "More note actions")
    panel = pg.locator("[role=group][aria-label='More note actions']")
    m.press(panel.get_by_role("button", name=re.compile(r"^Export")).filter(visible=True), "Export (in More note actions)")
    item = pg.get_by_role("menuitem", name=re.compile(r"Word")).filter(visible=True)
    item.first.wait_for(state="visible", timeout=10000)
    with pg.expect_download(timeout=30000) as dl:
        if m.mode == "keys":
            # an open menu takes arrow keys; Tab would close it. The member arrows to Word.
            for _ in range(8):
                if is_focused(pg, item):
                    break
                m.key("ArrowDown", "menu: next item")
            m.key("Enter", "Word (.docx)")
        else:
            m.pointer(item, "Word (.docx)")
    fn = dl.value.suggested_filename
    if not fn.lower().endswith(".docx"):
        raise Inconclusive(f"outcome not reached: downloaded {fn!r}")
    return {"note": nid, "file": fn}


def q13_plan_grade(cx: Ctx, pg, m: Meter, width: str) -> dict:
    tid = cx.seed.get("plan_trade_id")
    if not tid:
        raise Inconclusive(f"setup: the planned trade was not seeded ({cx.seed.get('plan_trade_why')})")
    open_start(pg, cx.base, "/journal")
    import re
    if not journal_chord(m, "j", "Closed trades", "**/journal/trades?*seg=closed*"):
        trades = pg.get_by_role("link", name=re.compile(r"^Trades")).filter(visible=True)
        m.press(trades, "Journal tab: Trades")
        pg.wait_for_timeout(1500)
        closed = pg.get_by_role("button", name=re.compile(r"Closed", re.I)).filter(visible=True)
        if closed.count() == 0:
            closed = pg.get_by_role("tab", name=re.compile(r"Closed", re.I)).filter(visible=True)
        if closed.count():
            m.press(closed, "Trades segment: Closed")
            pg.wait_for_timeout(1200)
    row = _trade_row(pg, "NVDA")
    from_top(m)
    if row.count() == 0:
        raise Inconclusive("the planned NVDA trade row is not visible on the Trades surface")
    m.press(_row_opener(row, "NVDA"), "NVDA trade row")
    card = pg.locator('[data-testid="plan-grade-card"]')
    try:
        card.first.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"no plan-grade card on the view the trade row opened (url {pg.url})")
    return {"trade": tid, "card_text": card.first.inner_text()[:300]}


def q15_earnings_prep(cx: Ctx, pg, m: Meter, width: str) -> dict:
    open_start(pg, cx.base, "/journal/notebook")
    import re
    # 13Q-3: bare-root Research Home's own content (ReportingSoon's "Create prep note"
    # button) renders right after the pane heading "Skip to notes list" lands on.
    use_skip_link(m, r"Skip to notes? list", "Skip to notes list")
    btn = pg.get_by_role("button", name=re.compile(r"^(Create prep note for|Open the) NVDA")).filter(visible=True)
    try:
        btn.first.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("no 'Create prep note for NVDA' on Research Home (Reporting soon did not render)")
    label = btn.first.get_attribute("aria-label")
    m.press(btn, label or "Create prep note for NVDA")
    nid = wait_note_open(pg, 60000)
    n = read_note(cx.req, cx.base, nid) or {}
    if "earnings-prep" not in (n.get("tags") or []):
        raise Inconclusive(f"outcome not reached: opened note {nid} tags={n.get('tags')}")
    return {"note": nid, "button": label}


class _HelperRaw:
    """The evidence sink the 13H-2 walk's drawing helper writes to (its `Walk` shape: `.raw`,
    `.shot`). What it recorded is kept in the run's raw file under the row's own tag."""

    def __init__(self, cx: Ctx, tag: str):
        self.raw = cx.raw.setdefault("drawing_helper", {}).setdefault(tag, {})

    def shot(self, pg, name):  # the row's own screenshot is taken by run_one
        return name


def _chart_frame(pg, m: Meter):
    """The note's chart, on screen and settled. SETUP: the pointer rests over the chart in mouse
    mode (a move, not a click -- the embed's toolbar shows on hover), nothing else."""
    frame = pg.locator('[data-widget-embed-view="chart"]').first
    frame.wait_for(state="visible", timeout=60000)
    frame.evaluate("el => el.scrollIntoView({block: 'center', inline: 'nearest'})")
    settle(pg, 1500)
    if m.mode == "mouse":
        frame.hover()
    return frame


def q20_chart(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """Insert a chart, draw three levels, name them entry / stop / target, read the size.
    The chart goes in by the slash menu (Q8's convention: its keystrokes are recorded, and a
    mouse row's figure is clicks). The three levels are placed by the 13H-2 walk's own drawing
    helper -- real clicks or taps on the chart -- and counted from that helper's record."""
    import re
    tag = _run_tag(cx, "Q20", m.mode, width)
    nid = fresh_note(cx, f"Chart target {tag}", "NVDA", "The plan:")
    open_note_start(cx, pg, nid)
    focus_editor_body(m)
    m.key("Enter", "new line")
    m.key("/", "slash trigger")
    m.type("chart NVDA", "slash query")
    pick_option(m, r"^Chart", "Chart — NVDA")
    frame = pg.locator('[data-widget-embed-view="chart"]').first
    try:
        frame.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("the slash menu's Chart row did not put a chart in the note")
    wait_body(cx, nid, lambda n: "widgetEmbed" in json.dumps(n.get("bodyJson") or {}), 20)
    if m.mode == "keys":
        # The keyboard's door to a level is the plan panel's own form (lane FIN-A11Y): a price, a
        # role, Add level. The chart toolbar is a forward Tab stop since lane KEYS.
        settle(pg, 3000)
        m.tab_to("el.tagName === 'BUTTON' && el.textContent.trim() === 'Plan' && el.closest('[data-widget-embed-view]')",
                 "Plan (chart toolbar)")
        m.key("Enter", "activate Plan (chart toolbar)")
        panel = pg.locator("[data-chart-plan-panel]").first
        panel.wait_for(state="visible", timeout=30000)
        form = panel.locator("[data-add-level]")
        try:
            form.wait_for(state="visible", timeout=15000)
        except Exception:  # noqa: BLE001
            raise Inconclusive("the plan panel has no form to add a level by typing")
        for price, role in (("150", "entry"), ("140", "stop"), ("180", "target")):
            field = form.locator("input").first
            m.keys_to(field, f"price of the new level ({role})")
            m.fill(field, price, "price")
            sel = form.get_by_label("Role of the new level")
            m.keys_to(sel, "Role of the new level")
            sel.select_option(role)
            m.keys += 1
            m.steps.append({"do": "key", "key": f"{role[0].upper()} (choose {role} in the select; counted 1)", "on": "Role"})
            m.press(form.get_by_role("button", name="Add level"), "Add level")
            pg.wait_for_timeout(500)
        try:
            pg.wait_for_function("() => { const e = document.querySelector('[data-plan-value=\"shares\"]'); "
                                 "return e && e.textContent.trim() !== '—' }", timeout=30000)
        except Exception:  # noqa: BLE001
            raise Inconclusive(f"three levels were typed and no size appeared; panel says: {panel.inner_text()[:300]!r}")
        n = wait_body(cx, nid, lambda n: sorted(re.findall(r'"role": "(entry|stop|target)"', json.dumps(n.get("bodyJson") or {})))
                      == ["entry", "stop", "target"], 20)
        stored = sorted(re.findall(r'"role": "(entry|stop|target)"', json.dumps((n or {}).get("bodyJson") or {})))
        if stored != ["entry", "stop", "target"]:
            raise Inconclusive(f"outcome not reached: the stored note carries roles {stored}")
        return {"note": nid, "path": "typed levels (plan panel form)", "roles_stored": stored,
                "shares": panel.locator('[data-plan-value="shares"]').first.inner_text()}
    settle(pg, 5000)                       # a fresh chart saves its own picture a few seconds in
    sink = _HelperRaw(cx, tag)
    placed = w13h2.draw_three_lines(pg, frame, m.mode == "taps", sink, "q20", req=cx.req, base=cx.base, nid=nid)
    arms = [a for a in sink.raw.get("q20_armed_before_tap", []) if not a.get("armed")]
    m.counted(1, "Draw (chart toolbar)")
    m.counted(len(arms), "Horizontal line tool (once per level it had to be picked again)")
    m.counted(placed, "place a level on the chart")
    m.counted(1, "Done (leave drawing)")
    if placed != 3:
        raise Inconclusive(f"only {placed} of 3 levels could be placed on the chart")
    if m.mode == "mouse":
        frame.hover()
    m.press(w13h2.toolbar_button(pg, frame, "Plan", m.mode == "taps"), "Plan (chart toolbar)")
    panel = pg.locator("[data-chart-plan-panel]").first
    panel.wait_for(state="visible", timeout=30000)
    rows = panel.locator("li[data-level-id]")
    try:
        rows.nth(2).wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"the plan panel lists {rows.count()} drawn levels, not 3")
    for i, role in ((0, "target"), (1, "entry"), (2, "stop")):
        m.press(rows.nth(i).locator(f'[data-role="{role}"]'), f"level {i + 1}: {role}")
        pg.wait_for_timeout(300)
    try:
        pg.wait_for_function("() => { const e = document.querySelector('[data-plan-value=\"shares\"]'); "
                             "return e && e.textContent.trim() !== '—' }", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"the three roles were set and no size appeared; panel says: {panel.inner_text()[:300]!r}")
    vals = {k: panel.locator(f'[data-plan-value="{k}"]').first.inner_text()
            for k in ("rr", "shares") if panel.locator(f'[data-plan-value="{k}"]').count()}
    n = wait_body(cx, nid, lambda n: sorted(re.findall(r'"role": "(entry|stop|target)"', json.dumps(n.get("bodyJson") or {})))
                  == ["entry", "stop", "target"], 20)
    stored = sorted(re.findall(r'"role": "(entry|stop|target)"', json.dumps((n or {}).get("bodyJson") or {})))
    if stored != ["entry", "stop", "target"]:
        raise Inconclusive(f"outcome not reached: the stored note carries roles {stored}")
    return {"note": nid, "levels": placed, "tool_picks": len(arms), "panel": vals, "roles_stored": stored}


def q14_playbook_drill(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """Start: the Journal. Insights -> My Playbook -> a number on a setup card; the trades the
    number was computed from are listed under it."""
    import re
    seeded = cx.seed.get("playbook") or {}
    if seeded.get("trades") != PLAYBOOK_TRADES:
        raise Inconclusive(f"setup: the tagged trades were not seeded ({seeded})")
    open_start(pg, cx.base, "/journal")
    if not journal_chord(m, "y", "Insights", "**/journal/insights*"):
        m.press(pg.get_by_role("link", name=re.compile(r"^Insights")).filter(visible=True), "Journal tab: Insights")
    door = pg.get_by_test_id("open-my-playbook").filter(visible=True)
    try:
        door.first.wait_for(state="visible", timeout=45000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"no My Playbook door on Insights (url {pg.url})")
    settle(pg, 400)
    from_top(m)
    m.press(door, "Open My Playbook")
    card = pg.locator(f'[data-setup="{PLAYBOOK_SETUP}"]')
    try:
        card.first.wait_for(state="visible", timeout=45000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"My Playbook shows no {PLAYBOOK_SETUP} card (url {pg.url})")
    settle(pg, 400)
    from_top(m)
    m.press(card.first.get_by_role("button", name=re.compile(r"Win rate")), f"Win rate ({PLAYBOOK_SETUP})")
    drill = card.first.get_by_test_id("playbook-drill")
    try:
        drill.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("the number was pressed and no list of trades opened under it")
    rows = drill.locator("tbody tr").count()
    if rows != PLAYBOOK_TRADES:
        raise Inconclusive(f"outcome not reached: the drill lists {rows} trades, {PLAYBOOK_TRADES} were seeded")
    return {"setup": PLAYBOOK_SETUP, "number": "Win rate", "drill_rows": rows, "drill_title": drill.locator("h4").inner_text()}


def q16_resurfaced(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """Start: Settings (the notice lives in its Compass & Voice section, the Voice Insights
    Inbox). The section, then "Open what you wrote": the note opens at the version that named
    the level."""
    import re
    rs = cx.seed.get("resurface") or {}
    link = rs.get("link")
    if not link:
        raise Inconclusive(f"setup: the scan fired no notice with a door ({rs})")
    open_start(pg, cx.base, "/settings")
    sec = pg.get_by_role("button", name=re.compile(r"Compass & Voice")).filter(visible=True)
    use_skip_link(m, r"^Skip to main content$", "Skip to main content")
    m.press(sec, "Settings section: Compass & Voice")
    door = pg.locator(f'a[href="{link}"]').filter(visible=True)
    try:
        door.first.wait_for(state="visible", timeout=60000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("the Voice Insights Inbox shows no 'Open what you wrote' for the seeded notice")
    m.press(door, "Open what you wrote")
    sheet = pg.get_by_role("dialog", name="What you wrote then")
    try:
        sheet.wait_for(state="visible", timeout=60000)
        pg.get_by_test_id("note-version-preview").get_by_text("Stop: 100").wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"outcome not reached: no 'What you wrote then' sheet holding the stop (url {pg.url})")
    if note_id_from_url(pg) != rs.get("note"):
        raise Inconclusive(f"outcome not reached: opened note {note_id_from_url(pg)}, wanted {rs.get('note')}")
    return {"note": rs.get("note"), "door": link, "sheet": "What you wrote then"}


def q17_why(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """Start: the position's own page (where the prompt is). Into the field, the words, Save."""
    seat = (cx.seed.get("why_positions") or {}).get(f"{m.mode}-{width}") or {}
    if seat.get("http") not in (200, 201):
        raise Inconclusive(f"setup: no position entered today for this run ({seat})")
    sym = seat["symbol"]
    words = f"Clean base, tight closes ({m.mode} {width})."
    open_start(pg, cx.base, f"/journal-2-0/position/{sym}")
    # The field's id is generated per card (a page can show one card per lot), so it is found
    # by its form, never by a fixed id. A fixed id read "no field" on a page that had one.
    box = pg.locator('[data-testid="why-prompt-editing"] textarea').first
    try:
        box.wait_for(state="visible", timeout=45000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"no 'Why did you take it?' field on the {sym} position page")
    settle(pg, 400)
    pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur();"
                " window.scrollTo(0, 0) }")
    # Lane KEYS round 3: the position page's own link to the reason, when it is there.
    if not use_skip_link(m, r"^Skip to why you took it$", "Skip to why you took it"):
        use_skip_link(m, r"^Skip to main content$", "Skip to main content")
    focus_field(m, box, "Why did you take it?")
    m.fill(box, words, "the reason")
    m.press(pg.locator('[data-testid="why-prompt-editing"]').get_by_role("button", name="Save", exact=True), "Save")
    saved = pg.locator('[data-testid="why-prompt-saved"]')
    try:
        saved.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"Save was pressed and the answer did not read back as saved; page: {toast_text(pg)!r}")
    pg.reload(wait_until="domcontentloaded")          # the server's copy, not the form's
    try:
        pg.locator('[data-testid="why-prompt-saved"]').get_by_text(words).wait_for(state="visible", timeout=45000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("outcome not reached: after a reload the saved answer is not on the page")
    return {"position": sym, "saved": words}


def q18_review_leak(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """Start: Research Home. "This week's review" drafts the note; the leak it found is a
    collapsed block in it, opened by its own arrow."""
    open_start(pg, cx.base, "/journal/notebook")
    before = {n["id"] for n in list_notes(cx.req, cx.base)}
    btn = pg.locator("[data-tour='review-drafts-weekly']").filter(visible=True)
    try:
        btn.first.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("no 'This week's review' on Research Home")
    # Lane KEYS round 2: Research Home's own link to this part of the page.
    if not use_skip_link(m, r"^Skip to reviews and setups$", "Skip to reviews and setups"):
        use_skip_link(m, r"Skip to notes? list", "Skip to notes list")
    m.press(btn, "This week's review")
    nid = wait_note_open(pg, 60000)
    if nid in before:
        raise Inconclusive(f"the button opened an existing note ({nid}), not a new draft")
    tog = pg.locator('[data-type="toggle"]', has_text="Revenge").first
    try:
        tog.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("the drafted review holds no 'Revenge re-entries' leak block")
    if tog.get_attribute("data-open") != "false":
        raise Inconclusive(f"the leak block was already open (data-open={tog.get_attribute('data-open')!r})")
    m.press(tog.locator("button.uctToggleChevron"), "open the leak (Revenge re-entries)")
    end = time.time() + 8
    while time.time() < end and tog.get_attribute("data-open") != "true":
        pg.wait_for_timeout(200)
    if tog.get_attribute("data-open") != "true":
        raise Inconclusive("outcome not reached: the leak block did not open")
    n = read_note(cx.req, cx.base, nid) or {}
    if "weekly-review" not in (n.get("tags") or []):
        raise Inconclusive(f"outcome not reached: note {nid} tags={n.get('tags')}")
    return {"note": nid, "title": n.get("title"), "leak_opened": "Revenge re-entries"}


def q19_transcript(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """Pointer and touch start on the ticker's research page: Save from a transcript -> Quote
    from a turn -> Save passage. The keyboard starts in the thesis note with the caret in its
    body (Q8's convention) and uses the door lane 13G built for it: /transcript, Enter."""
    tag = _run_tag(cx, "Q19", m.mode, width)
    nid = fresh_note(cx, f"NVDA thesis {tag}", "NVDA", "The call is the story.")
    if m.mode == "keys":
        open_note_start(cx, pg, nid)
        focus_editor_body(m)
        m.key("Enter", "new line")
        m.key("/", "slash trigger")
        m.type("transcript passage", "slash query")
        import re
        pg.get_by_role("option", name=re.compile(r"Transcript passage")).first.wait_for(state="visible", timeout=20000)
        want = pg.get_by_role("option", name=re.compile(r"Transcript passage")).first
        for _ in range(12):                 # with voice notes on, "Voice note" can sit above it
            if want.get_attribute("aria-selected") == "true":
                break
            m.key("ArrowDown", "slash menu: next row")
            pg.wait_for_timeout(120)
        if want.get_attribute("aria-selected") != "true":
            raise Inconclusive("the slash menu's highlight never reached 'Transcript passage'")
        m.key("Enter", "choose Transcript passage")
    else:
        open_start(pg, cx.base, "/journal/notebook/research/NVDA")
        door = pg.get_by_role("button", name="Save from a transcript").filter(visible=True)
        try:
            door.first.wait_for(state="visible", timeout=90000)
        except Exception:  # noqa: BLE001
            raise Inconclusive("no 'Save from a transcript' on the NVDA research page")
        pg.evaluate("() => window.scrollTo(0, 0)")
        m.press(door, "Save from a transcript")
    sheet = pg.locator("[data-save-transcript]")
    quote = pg.get_by_role("button", name="Quote from turn 2")
    try:
        sheet.wait_for(state="visible", timeout=30000)
        quote.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("the transcript sheet did not open on the stored call")
    dest = sheet.get_by_label("Destination note")
    dest_was = dest.first.input_value() if dest.count() else "(fixed: the open note)"
    m.press(quote, "Quote from turn 2")
    m.press(pg.get_by_role("button", name="Save passage"), "Save passage")
    done = pg.locator("[data-saved-excerpt]")
    try:
        done.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"Save passage was pressed and nothing read back as saved: {sheet.inner_text()[:300]!r}")
    ex = done.get_attribute("data-saved-excerpt")
    cited = done.inner_text()[:200]
    r = cx.req.get(f"{cx.base}/api/j2/notes/{nid}/excerpts")
    ids = [e.get("id") for e in ((r.json() or {}).get("excerpts") or [])] if r.status == 200 else []
    if ex not in ids:
        raise Inconclusive(f"outcome not reached: the passage was saved ({cited!r}) but not into the thesis "
                           f"{nid}; the sheet's destination was {dest_was!r}")
    return {"note": nid, "excerpt": ex, "cited": cited, "destination_default": dest_was}


def q21_arm_alert(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """Start: a note whose chart already carries a drawn entry, stop and target. Plan (the
    chart's toolbar) -> "Arm alert at this level" on the stop."""
    import re
    tag = _run_tag(cx, "Q21", m.mode, width)
    embed_id = f"q21-{tag}"
    chart = w13j.chart_attrs("NVDA", None, None, embed_id=embed_id)
    anchor = int(time.time()) - 5 * 86400
    # A DRAWN level carries its anchor point (`points[0]`); a level with a bare price and no
    # geometry is another write shape, and the panel will not arm an alert on one.
    chart["attrs"]["annotations"] = [{"id": f"d-{role}", "type": "horizontal", "role": role,
                                      "points": [{"time": anchor, "price": price}]}
                                     for role, price in (("target", 180.0), ("entry", 150.0), ("stop", 140.0))]
    body = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "The plan:"}]}, chart]}
    r = cx.req.post(cx.base + "/api/j2/notes", data={"title": f"Alert target {tag}", "ticker": "NVDA", "bodyJson": body})
    if r.status not in (200, 201):
        raise Inconclusive(f"setup: could not create the planned-chart note (HTTP {r.status})")
    nid = r.json()["note"]["id"]
    open_note_start(cx, pg, nid, caret=False)
    if m.mode == "keys":
        frame = pg.locator('[data-widget-embed-view="chart"]').first
        frame.wait_for(state="visible", timeout=60000)
        settle(pg, 1500)
        caret_at_top(pg)                   # the member is working in the note, above its chart
    else:
        frame = _chart_frame(pg, m)
    panel = pg.locator("[data-chart-plan-panel]").first
    if not (panel.count() and panel.is_visible()) and m.mode == "keys":
        # On a wide screen the chart's toolbar shows on hover, so the button is not "visible" to
        # wait for. The keyboard does not need it to be: Tab is pressed for real until focus is
        # on the Plan button, whatever is painted. If Tab can never reach it, that is the cap.
        m.tab_to("el.tagName === 'BUTTON' && el.textContent.trim() === 'Plan' && el.closest('[data-widget-embed-view]')",
                 "Plan (chart toolbar)")
        m.key("Enter", "activate Plan (chart toolbar)")
    elif not (panel.count() and panel.is_visible()):
        m.press(w13h2.toolbar_button(pg, frame, "Plan", m.mode == "taps"), "Plan (chart toolbar)")
    try:
        panel.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("the plan panel did not open")
    row = panel.locator('li[data-level-id="d-stop"]')
    arm = row.get_by_role("button", name=re.compile(r"^Arm alert at this level"))
    try:
        arm.first.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"the stop's row offers no 'Arm alert at this level'; panel: {panel.inner_text()[:300]!r}")
    m.press(arm, "Arm alert at this level (the stop)")
    try:
        row.get_by_text("Alert armed").first.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"the alert did not read back as armed; panel: {panel.inner_text()[:300]!r}")
    alerts = cx.req.get(cx.base + "/api/watchlist-alerts").json()
    want = f"nb:{embed_id}:d-stop"
    hit = next((a for a in alerts if a.get("drawing_id") == want), None)
    if not hit:
        raise Inconclusive(f"outcome not reached: the alerts list holds no row for {want}")
    return {"note": nid, "alert": {k: hit.get(k) for k in ("sym", "direction", "target_price", "drawing_id")}}


def q22_visual_playbook(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """Start: a note whose chart is tagged VCP. Visual playbook (under the chart) -> "Only this
    chart's setup (VCP)"."""
    import re
    seat = (cx.seed.get("visual_playbook") or {}).get("AMD") or {}
    if not seat.get("id"):
        raise Inconclusive(f"setup: the tagged chart note was not seeded ({seat})")
    open_note_start(cx, pg, seat["id"], caret=False)
    if m.mode != "keys":
        _chart_frame(pg, m)
    door = pg.locator('[data-testid="fingerprint-panel"]').first.get_by_role("button", name="Visual playbook")
    try:
        door.first.wait_for(state="visible", timeout=90000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("no 'Visual playbook' under the tagged chart")
    if m.mode == "keys":
        caret_at_top(pg)                   # the member is working in the note, above its chart
    m.press(door, "Visual playbook")
    book = pg.locator('[data-testid="visual-playbook"]')
    try:
        book.wait_for(state="visible", timeout=30000)
        pg.locator('[data-testid="playbook-card"]').first.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("the visual playbook opened with no cards")
    all_cards = pg.locator('[data-testid="playbook-card"]').count()
    only = book.get_by_role("button", name=re.compile(r"^Only this chart's setup \(VCP\)"))
    try:
        only.first.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"no 'Only this chart's setup (VCP)' in the playbook: {book.inner_text()[:300]!r}")
    m.press(only, "Only this chart's setup (VCP)")
    scope = book.locator('[data-testid="playbook-scope"]')
    end = time.time() + 15
    while time.time() < end and not scope.inner_text().startswith("Showing your VCP charts"):
        pg.wait_for_timeout(300)
    settle(pg, 900)
    choice = book.get_by_label("Setup").first.input_value()
    vcp_cards = pg.locator('[data-testid="playbook-card"]').count()
    if choice != "tag:VCP" or not scope.inner_text().startswith("Showing your VCP charts") or not 0 < vcp_cards < all_cards:
        raise Inconclusive(f"outcome not reached: Setup={choice!r}, {vcp_cards} of {all_cards} cards, "
                           f"scope {scope.inner_text()[:120]!r}")
    return {"setup_filter": choice, "cards_all": all_cards, "cards_vcp": vcp_cards}


def q23_board_similar(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """Start: Research Home. Active setups -> the closest setup is the board's first card ->
    its "Find more like this"; tonight's matches for it are listed."""
    if cx.seed.get("board_nightly_error") or not cx.seed.get("board_nightly"):
        raise Inconclusive(f"setup: the nightly match run did not complete ({cx.seed.get('board_nightly_error')})")
    open_start(pg, cx.base, "/journal/notebook")
    door = pg.get_by_role("link", name="Active setups", exact=True).filter(visible=True)
    try:
        door.first.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("no 'Active setups' door on Research Home")
    if not use_skip_link(m, r"^Skip to reviews and setups$", "Skip to reviews and setups"):
        use_skip_link(m, r"Skip to notes? list", "Skip to notes list")
    m.press(door, "Active setups")
    try:
        pg.wait_for_url("**/journal/notebook/setups", timeout=20000)
        pg.get_by_role("heading", name="Active setups").wait_for(state="visible", timeout=60000)
        pg.locator("[data-board-card]").first.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"the board did not open with cards (url {pg.url})")
    settle(pg, 400)
    from_top(m)
    order = pg.locator("[data-board-card]").evaluate_all("els => els.map(e => e.getAttribute('data-board-card'))")
    if not order or order[0] != "ZQVA":
        raise Inconclusive(f"the closest setup should be ZQVA (2% from its entry); the board's order is {order[:6]}")
    btn = pg.locator('[data-board-card="ZQVA"]').get_by_role("button", name="Find more like ZQVA", exact=True)
    m.press(btn, "Find more like this (ZQVA, the closest setup)")
    try:
        pg.get_by_role("heading", name="Names like ZQVA (VCP)").wait_for(state="visible", timeout=20000)
        match = pg.locator("[data-match]").first
        match.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("outcome not reached: no 'Names like ZQVA (VCP)' list with a match")
    text = match.inner_text()
    if "CRWD" not in text:
        raise Inconclusive(f"outcome not reached: the match shown is not the seeded one: {text[:200]!r}")
    return {"board_order": order[:6], "closest": "ZQVA", "match": text[:200]}


# Every one of the 23 flows has a driver on this tree. The mechanism stays: a flow whose surface
# is dark or unbuilt names its reason here and reads INCONCLUSIVE without touching a browser.
UNBUILT: dict = {}

FLOWS = [
    Flow("Q1", q1_new_blank), Flow("Q2", q2_template_ticker), Flow("Q3", q3_open_by_title),
    Flow("Q4", q4_search_open), Flow("Q5", q5_today), Flow("Q6", q6_link_trade),
    Flow("Q7", q7_screener, notes="the plan's control (ruling P5); door in ScannerShell.jsx, measured only"),
    Flow("Q8", q8_fact), Flow("Q9", q9_ask_insert, notes="answer stubbed at the browser network layer"),
    Flow("Q10", q10_task_due), Flow("Q11", q11_tag_move), Flow("Q12", q12_export_word),
    Flow("Q13", q13_plan_grade),
    Flow("Q14", q14_playbook_drill, notes="starts on the Journal; 25 seeded trades tagged one setup"),
    Flow("Q15", q15_earnings_prep),
    Flow("Q16", q16_resurfaced, notes="starts on Settings; the notice is fired by the product's own scan (13D walk child)"),
    Flow("Q17", q17_why, notes="starts on the position's page; a position entered today"),
    Flow("Q18", q18_review_leak, notes="starts on Research Home; this week's trades seeded with one revenge re-entry"),
    Flow("Q19", q19_transcript, notes="pointer/touch start on the research page, keys in the thesis note; stored call seeded"),
    Flow("Q20", q20_chart, bars=True, tall=True,
         notes="bars are a fixture; pointer levels placed by the 13H-2 walk's drawing helper, keyboard levels typed "
               "in the plan panel; the wide window is 1200 px tall so the chart's toolbar clears the note's sticky header"),
    Flow("Q21", q21_arm_alert, bars=True, notes="starts on a note whose chart already carries the three levels; bars are a fixture"),
    Flow("Q22", q22_visual_playbook, bars=True, notes="starts on a note whose chart is tagged VCP; bars are a fixture"),
    Flow("Q23", q23_board_similar, bars=True, notes="starts on Research Home; nightly matches from the 13J walk's injected universe"),
]


# ── the runner ───────────────────────────────────────────────────────────────────────────

def run_one(br, state, base: str, flow: Flow, mode: str, width: str, cx: Ctx, out: Path, errors: list) -> dict:
    b = BUDGET[flow.fid]
    budget = b[mode]
    row = {"flow": flow.fid, "name": b["flow"], "owner": b["owner"], "mode": mode, "width": width,
           "budget": budget, "measured": None, "verdict": "INCONCLUSIVE", "reason": "", "tabs": None,
           "keystrokes": None, "clicks": None, "taps": None, "time_s": None, "steps": [], "outcome": None,
           "notes": flow.notes}
    if flow.unbuilt:
        row["reason"] = flow.unbuilt
        print(f"  {flow.fid:>4} {mode:>5} @{width:>4}: INCONCLUSIVE -- {flow.unbuilt[:120]}", flush=True)
        return row
    vp = PHONE if width == "390" else {"width": int(width), "height": 1200 if flow.tall else WIDE["height"]}
    ctx = br.new_context(viewport=vp, has_touch=(width == "390"), is_mobile=(width == "390"),
                         reduced_motion="reduce", storage_state=state, accept_downloads=True)
    if flow.bars:
        # A FIXTURE, AND SAID SO: the sandbox has no market vendor keys, so a note chart would
        # have nothing to draw. Only /api/bars/<SYM> is answered, by the 13H-2 walk's own
        # deterministic bars; every request it served is kept in the raw file.
        w13h2.install_bars_route(ctx, cx.raw.setdefault("bars_fixture_served", []))
    pg = ctx.new_page()
    # 13Q-3 (Q1 fix verification): a brand-new background page never receives script-triggered
    # keyboard focus in Chromium (by design -- a background tab must not steal focus), while
    # synthetic clicks/taps/keypresses are unaffected by foreground state. Every OTHER row in
    # this instrument only ever drives via synthetic input, which is why this was invisible
    # everywhere except the one flow (Q1) whose outcome depends on a programmatic .focus() call.
    # Diagnosed in 13Q-2 (docs/notebook/evidence/wave13-13q2/q1-focus-foreground-diagnosis/);
    # fixed here, the 13Q-owning lane. A real member's tab is always foreground, so this makes
    # the sandbox page behave like one.
    pg.bring_to_front()
    pg.on("pageerror", lambda e: errors.append({"flow": flow.fid, "mode": mode, "width": width,
                                                 "error": str(e)[:300]}))
    # Console errors too: a failure the page reports without throwing (a lazy chunk that did
    # not load, a refused registration) is otherwise invisible in the record.
    pg.on("console", lambda c: errors.append({"flow": flow.fid, "mode": mode, "width": width,
                                               "console": c.text[:400]}) if c.type == "error" else None)
    pg.on("dialog", lambda d: d.accept())
    m = Meter(pg, mode)
    try:
        outcome = flow.run(cx, pg, m, width)
        row["outcome"] = outcome
        row["measured"] = m.count()
        row["verdict"] = "PASS" if row["measured"] <= budget else "OVER"
    except Capped as e:
        row["measured"] = m.count()
        row["verdict"] = "OVER"
        row["reason"] = f"cap reached: {e}"
    except Inconclusive as e:
        row["reason"] = str(e)[:600]
        row["measured_before_stop"] = m.count()
    except Exception as e:  # noqa: BLE001 -- a driver failure is INCONCLUSIVE, never a pass
        row["reason"] = f"driver could not complete: {type(e).__name__}: {str(e)[:400]}"
        row["measured_before_stop"] = m.count()
        row["traceback"] = traceback.format_exc()[-1500:]
    row["tabs"], row["keystrokes"], row["clicks"], row["taps"] = m.tabs, m.keys, m.clicks, m.taps
    row["time_s"] = m.elapsed()
    row["steps"] = m.steps
    try:
        name = f"{flow.fid}-{mode}-{width}.png"
        pg.screenshot(path=str(out / name))
        row["screenshot"] = name
    except Exception:  # noqa: BLE001
        pass
    ctx.close()
    print(f"  {flow.fid:>4} {mode:>5} @{width:>4}: {row['verdict']:<12} measured={row['measured']} "
          f"budget={budget} tabs={m.tabs} {('-- ' + row['reason'][:140]) if row['reason'] else ''}", flush=True)
    return row


def table_md(rows: list[dict]) -> str:
    lines = ["| flow | mode | width | measured | budget | verdict | tabs | time s | reason |",
             "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        meas = r["measured"] if r["measured"] is not None else "-"
        reason = (r.get("reason") or "").replace("|", "/").replace("\n", " ")[:180]
        lines.append(f"| {r['flow']} {r['name']} | {r['mode']} | {r['width']} | {meas} | {r['budget']} | "
                     f"{r['verdict']} | {r['tabs'] if r['tabs'] is not None else '-'} | "
                     f"{r['time_s'] if r['time_s'] is not None else '-'} | {reason} |")
    return "\n".join(lines) + "\n"


def clear_onboarding(pg, base: str, note_id: str | None = None) -> list:
    """SETUP, uncounted, recorded: with the wave-14 gates on, a member's first visit meets the
    base tour (a modal), the get-started checklist and one tour offer per session. The 23 flows
    are an established member's; the onboarding flows O1-O6 are measured by the sibling tool
    (tools/notebook_w14q_clicks.py). Everything closed here is listed in the raw file."""
    done = []
    tour = pg.locator("[role=dialog][aria-modal=true]")
    try:
        tour.first.wait_for(state="visible", timeout=6000)
        pg.keyboard.press("Escape")
        tour.first.wait_for(state="hidden", timeout=6000)
        done.append("base tour closed with Escape")
    except Exception:  # noqa: BLE001 -- the tour did not start for this member
        done.append("base tour not on screen")
    try:
        pg.get_by_role("button", name="Hide the get started list").first.click(timeout=4000)
        done.append("get-started checklist hidden")
    except Exception:  # noqa: BLE001
        done.append("get-started checklist not on screen")
    for _ in range(20):                      # one offer per load; decline each until none is left
        pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        settle(pg, 900)
        offer = pg.locator("[data-tour-offer]")
        try:
            offer.first.wait_for(state="visible", timeout=5000)
        except Exception:  # noqa: BLE001 -- no offer on this load: none is left
            break
        title = offer.locator("h2").first.inner_text()
        offer.get_by_role("button", name="Not now").first.click(timeout=5000)
        done.append(f"tour offer declined: {title}")
        pg.wait_for_timeout(600)
    if note_id:
        # The voice-notes gate puts a one-time "New: speak instead of type" tip in the note's
        # sticky toolbar (its seen-flag is the browser's own storage, carried to every run by
        # the storage state taken after this). An established member has closed it.
        pg.goto(f"{base}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        try:
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            pg.get_by_role("button", name="Dismiss tip").first.click(timeout=5000)
            done.append("voice dictation tip dismissed")
        except Exception:  # noqa: BLE001
            done.append("voice dictation tip not on screen")
    return done


def run_all(base: str, data_dir: Path, out: Path, only: set | None, modes: set | None, result: dict,
            wide: str = "1200") -> None:
    from playwright.sync_api import sync_playwright
    errors: list = []
    result["page_errors"] = errors
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin = br.new_context()
        seedctx = br.new_context(viewport=WIDE, reduced_motion="reduce")
        req = seedctx.request
        h._provision(admin.request, req, base, member=MEMBER)
        me = req.get(base + "/api/auth/me").json()
        result["auth_me_flags"] = {k: me.get(k) for k in sorted(me) if k.startswith(("notebook_", "j2_"))}
        cx = Ctx(base=base, req=req, wide=wide)
        seed_member(cx, data_dir)
        seed_new_lanes(cx, data_dir, out)
        result["seed"] = cx.seed
        # one warm visit, so the once-per-tab intro is recorded (setup), never counted in a flow
        pg = seedctx.new_page()
        open_start(pg, base, "/journal/notebook")
        result["first_visit_text"] = pg.locator("body").inner_text()[:1500]
        result["onboarding_cleared_in_setup"] = clear_onboarding(pg, base, next(iter(cx.seed["notes"].values()), None))
        pg.close()
        state = seedctx.storage_state()
        rows = result["rows"]
        plan = []
        for fl in FLOWS:
            if only and fl.fid not in only:
                continue
            for mode in fl.modes:
                if modes and mode not in modes:
                    continue
                widths = ["390"] if mode == "taps" else ([wide, "390"] if mode == "keys" else [wide])
                for wd in widths:
                    plan.append((fl, mode, wd))
        for fl, mode, wd in plan:
            rows.append(run_one(br, state, base, fl, mode, wd, cx, out, errors))
            # R-RAW: rewritten after EVERY row, so a run that dies keeps what it measured
            (out / "clicks.json").write_text(json.dumps({**result, "status": "IN PROGRESS"}, indent=1,
                                                        ensure_ascii=False, default=str), encoding="utf-8")
        result["raw"] = cx.raw
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8625)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="", help="comma-separated flow ids (Q1,Q7) -- a partial run says so")
    ap.add_argument("--modes", default="", help="comma-separated subset of mouse,keys,taps")
    ap.add_argument("--wide", type=int, default=WIDE["width"],
                    help="the wide viewport's width in px (wave 13 measured at 1200; the finish program at 1280)")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port not in PORTS:
        print("REFUSED: this tool uses ports 8625-8629 or 8720-8724 only (never 8077)")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this tool never kills it")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty -- a re-run must not inherit a previous run's notes")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    only = {s.strip().upper() for s in args.only.split(",") if s.strip()} or None
    modes = {s.strip().lower() for s in args.modes.split(",") if s.strip()} or None
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    result = {"tool": "tools/notebook_w13q_clicks.py", "tree": sha,
              "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "partial": {"flows": sorted(only) if only else None, "modes": sorted(modes) if modes else None},
              "sandbox_flags": SANDBOX_FLAGS, "tab_cap": TAB_CAP, "budgets": BUDGET, "rows": [],
              "wide_px": args.wide,
              "integrity": None, "failure": None, "not_run": None}
    # claimed before the session starts: a run that dies leaves INCOMPLETE, never a stale pass
    (out / "clicks.json").write_text(json.dumps({**result, "status": "INCOMPLETE (run did not finish)"}, indent=1),
                                     encoding="utf-8")
    not_run = failure = None
    cal = None
    try:
        cal = write_calendar(data_dir)
        result["seed_child"] = seed_stores(data_dir, out)
        result["seed_research_child"] = seed_research_stores(data_dir, out)
    except h.SetupFailed as e:
        not_run = str(e)
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    # ⛔ written for the CHILD (Popen inherits it), never read here: the gates' one parse is the app's
    os.environ.update(SANDBOX_FLAGS)
    if cal:
        os.environ["NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR"] = str(cal)
    os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "",
                       "ALPHA_VANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    if not not_run:
        box.start()
        try:
            if not box.wait_healthy(base, 300):
                failure = "the sandbox never answered /api/health"
            else:
                try:
                    run_all(base, data_dir, out, only, modes, result, wide=str(args.wide))
                except h.SetupFailed as e:
                    not_run = str(e)[:300]
                except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
                    failure = f"the run raised {type(e).__name__}: {str(e)[:400]}"
                    result["traceback"] = traceback.format_exc()[-3000:]
                box.wait_checkpoint(h.POST_BOOT, 60)
        finally:
            box.stop(grace_s=300)
    integ = (h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN]) if box.proc
             else {"clean": False, "status": "NOT BOOTED", "checkpoints": []})
    if box.proc:
        h._keep_integrity_log(integ, out / "integrity.md", own=True)
        print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    result.update({"integrity": integ, "failure": failure, "not_run": not_run,
                   "driver_imported_api": api_mods,
                   "finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "status": "COMPLETE" if not (failure or not_run) else "NOT COMPLETE"})
    (out / "clicks.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    (out / "table.md").write_text(table_md(result["rows"]), encoding="utf-8")
    print(f"driver imported api.*: {api_mods or 'none'}")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT: RUN FAILED -- {failure}")
        return 3
    if not integ.get("clean") or api_mods:
        print(f"VERDICT: INTEGRITY {integ.get('status')}")
        return 2
    counts: dict = {}
    for r in result["rows"]:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    print(f"VERDICT: RAN -- {len(result['rows'])} rows; " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
