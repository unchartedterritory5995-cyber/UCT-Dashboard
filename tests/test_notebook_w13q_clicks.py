"""Rails for the wave-13 lane 13Q-1 click-by-click instrument's OWN counting and verdict
logic (tools/notebook_w13q_clicks.py). This tool drives a real Chromium against a real
sandbox -- these rails exercise its counting machinery WITHOUT either, via small fakes for
the Playwright surface (`Page`, a locator, a `BrowserContext`), so the arithmetic that
decides PASS vs OVER vs INCONCLUSIVE is proved directly against the instrument's real
code, not a reimplementation of it.

What each group covers:
  * `Meter` -- clicks/taps/keys/tabs are counted on the right counter for the right mode,
    `type`/`fill` (content) are NEVER counted (the plan's rule), and `count()` reports the
    mode-appropriate total.
  * `Meter.tab_to` -- the real Tab-until-focused loop: found immediately, found after N
    real presses (trail length == presses), and -- THE CONTROL THIS LANE'S BRIEF ASKS
    FOR -- never found within the cap, which must raise `Capped`, never return quietly.
  * `run_one` -- the row-building/verdict function exercised END TO END against fakes:
    under budget -> PASS, AT the budget -> PASS (the boundary is `<=`), OVER budget -> OVER
    (the non-vacuity control: an instrument that always says PASS would pass every other
    test here and only this one would catch it), a capped Tab run -> OVER with "cap
    reached" (never a silent PASS), a raised `Inconclusive` -> INCONCLUSIVE regardless of
    how few actions were counted (never PASS/OVER), a generic driver exception ->
    INCONCLUSIVE (never a crash, per the plan: "a flow the driver could not finish reads
    INCONCLUSIVE"), and an `unbuilt` flow short-circuits to INCONCLUSIVE before any
    browser object is even touched (passed `br=None` to prove it).
  * `table_md` -- renders a missing `measured` as `-`, never a crashed row.
  * The 23 budgets in `BUDGETS` are cross-read against the plan doc's own section 6 table
    (docs/notebook/WAVE-13-PLAN.md), so the instrument cannot silently drift from the spec
    it measures against -- the class of defect CLAUDE.md names repeatedly (a hand-typed
    number beside the list that owns it). A `len() == 23` non-vacuity check guards the
    parser itself: a regex that matched nothing would otherwise pass this check vacuously.

Run: `python -m pytest tests/test_notebook_w13q_clicks.py -q` from the repo root.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from tools import notebook_w13q_clicks as w13q  # noqa: E402


# ── fakes for the Playwright surface (no browser, no sandbox) ──────────────────────────────

class FakeKeyboard:
    def __init__(self):
        self.presses: list[str] = []

    def press(self, key: str):
        self.presses.append(key)

    def type(self, text: str, delay: int = 0):
        pass  # content typing is never counted (the plan) -- nothing to record for these rails


class FakeLocator:
    """Stands in for a Playwright Locator. `.first` is itself, per real Locator semantics."""

    def __init__(self):
        self.first = self
        self.clicks = self.taps = self.scrolls = 0

    def wait_for(self, state=None, timeout=None):
        pass

    def click(self, timeout=None):
        self.clicks += 1

    def tap(self, timeout=None):
        self.taps += 1

    def fill(self, text: str):
        pass  # content fill is never counted (the plan) -- nothing to record for these rails

    def scroll_into_view_if_needed(self, timeout=None):
        self.scrolls += 1

    def element_handle(self, timeout=None):
        return object()


class FakePage:
    """Stands in for a Playwright Page. `found_after` is the number of REAL Tab presses the
    fake "product" needs before `document.activeElement` would satisfy a `tab_to` predicate;
    `None` means it is never satisfied (models an unreachable control, i.e. the Q6/Q13 class
    of finding, and is what exercises the Capped path)."""

    def __init__(self, found_after: int | None = 0):
        self.keyboard = FakeKeyboard()
        self.found_after = found_after
        self.check_calls = 0

    def evaluate(self, expr, arg=None):
        # tab_to_locator's handle-stash call ("h => { window.__w13qTarget = h }") -- matched by
        # its distinct arrow-function shape, NOT by a substring also present in every check()
        # wrapper tab_to builds from the SAME target name.
        if isinstance(expr, str) and expr.strip().startswith("h =>"):
            return None
        if expr == w13q.FOCUS_DESC_JS:
            return {"tag": "DIV", "role": "", "name": "focused", "testid": "", "ce": False}
        # anything else is tab_to's boolean "has focus landed" predicate
        self.check_calls += 1
        if self.found_after is None:
            return False
        return len(self.keyboard.presses) >= self.found_after

    def on(self, event, handler):
        pass

    def screenshot(self, path=None):
        Path(path).write_bytes(b"")


class FakeContext:
    def __init__(self, page):
        self._page = page
        self.closed = False

    def new_page(self):
        return self._page

    def close(self):
        self.closed = True


class FakeBrowser:
    def __init__(self, page):
        self._page = page
        self.contexts: list[FakeContext] = []

    def new_context(self, **kwargs):
        ctx = FakeContext(self._page)
        self.contexts.append(ctx)
        return ctx


# ── Meter: counting ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("mode,field,other_fields", [
    ("mouse", "clicks", ("taps", "keys", "tabs")),
    ("taps", "taps", ("clicks", "keys", "tabs")),
])
def test_meter_count_reads_the_right_counter_for_pointer_modes(mode, field, other_fields):
    m = w13q.Meter(FakePage(), mode)
    setattr(m, field, 7)
    for f in other_fields:
        setattr(m, f, 99)  # a bug that reads the wrong counter would see this instead
    assert m.count() == 7


def test_meter_count_for_keys_mode_sums_keystrokes_and_tabs():
    m = w13q.Meter(FakePage(), "keys")
    m.keys, m.tabs, m.clicks, m.taps = 3, 4, 99, 99
    assert m.count() == 7


def test_press_mouse_clicks_once_and_records_the_step():
    loc = FakeLocator()
    m = w13q.Meter(FakePage(), "mouse")
    m.press(loc, "Save button")
    assert loc.clicks == 1
    assert m.clicks == 1 and m.taps == 0 and m.keys == 0 and m.tabs == 0
    assert m.steps == [{"do": "click", "on": "Save button"}]


def test_press_taps_scrolls_into_view_then_taps_once():
    loc = FakeLocator()
    m = w13q.Meter(FakePage(), "taps")
    m.press(loc, "Save button")
    assert loc.scrolls == 1 and loc.taps == 1
    assert m.taps == 1 and m.clicks == 0


def test_press_keys_tabs_to_the_control_then_presses_enter_once():
    """keys mode never clicks: it Tabs for real, counted separately from the Enter keystroke
    that activates the control (the plan: "Tab presses are counted SEPARATELY")."""
    loc = FakeLocator()
    pg = FakePage(found_after=3)
    m = w13q.Meter(pg, "keys")
    m.press(loc, "Save button")
    assert m.tabs == 3            # three real Tab presses to reach the control
    assert m.keys == 1            # the Enter that activates it, not a Tab
    assert m.clicks == 0 and m.taps == 0
    assert m.count() == 4
    assert pg.keyboard.presses == ["Tab", "Tab", "Tab", "Enter"]


@pytest.mark.parametrize("key,bucket", [("Tab", "tabs"), ("Shift+Tab", "tabs"), ("a", "keys"),
                                         ("Enter", "keys"), ("Control+k", "keys")])
def test_key_buckets_tab_and_shift_tab_separately_from_everything_else(key, bucket):
    m = w13q.Meter(FakePage(), "keys")
    m.key(key, "probe")
    assert getattr(m, bucket) == 1
    other = "keys" if bucket == "tabs" else "tabs"
    assert getattr(m, other) == 0


def test_type_and_fill_are_never_counted():
    """The plan: 'Typing the content itself is not counted.' A title, a ticker, a query --
    none of it may land on any counter, in ANY mode."""
    for mode in ("mouse", "keys", "taps"):
        m = w13q.Meter(FakePage(), mode)
        m.type("NVDA breakout thesis", "title")
        m.fill(FakeLocator(), "NVDA", "ticker")
        assert m.clicks == m.taps == m.keys == m.tabs == 0
        assert m.count() == 0
        assert any("not counted" in s["do"] for s in m.steps)


# ── Meter.tab_to: the real-press loop and its cap ───────────────────────────────────────

def test_tab_to_found_immediately_presses_nothing():
    pg = FakePage(found_after=0)
    m = w13q.Meter(pg, "keys")
    n = m.tab_to("true", "target", cap=10)
    assert n == 0
    assert m.tabs == 0
    assert pg.keyboard.presses == []


def test_tab_to_presses_for_real_until_found_and_keeps_the_full_trail():
    pg = FakePage(found_after=5)
    m = w13q.Meter(pg, "keys")
    n = m.tab_to("true", "target", cap=50)
    assert n == 5
    assert m.tabs == 5
    assert pg.keyboard.presses == ["Tab"] * 5
    trail_step = m.steps[-1]
    assert trail_step["presses"] == 5
    assert len(trail_step["trail"]) == 5     # one focus-description per real press
    assert "capped" not in trail_step


def test_tab_to_shift_tab_when_requested():
    pg = FakePage(found_after=2)
    m = w13q.Meter(pg, "keys")
    m.tab_to("true", "target", cap=10, shift=True)
    assert pg.keyboard.presses == ["Shift+Tab", "Shift+Tab"]


def test_tab_to_never_found_raises_Capped_rather_than_returning_quietly():
    """THE CONTROL: an unreachable control must stop the flow with `Capped`, which `run_one`
    turns into OVER -- never a silent PASS and never an infinite loop. Proved against the
    REAL loop (`found_after=None` -- the predicate never once returns true)."""
    pg = FakePage(found_after=None)
    m = w13q.Meter(pg, "keys")
    with pytest.raises(w13q.Capped, match=r"5 Tab presses never reached target"):
        m.tab_to("true", "target", cap=5)
    assert m.tabs == 5                 # it pressed Tab the full cap, not zero and not forever
    assert m.capped is True
    assert pg.keyboard.presses == ["Tab"] * 5
    assert m.steps[-1]["capped"] is True
    assert m.steps[-1]["presses"] == 5


def test_tab_to_cap_is_exact_one_short_of_found_still_caps():
    """Boundary: the control would be found on the NEXT press, but the cap ran out one press
    earlier -- it must still cap, not get lucky and look one press further."""
    pg = FakePage(found_after=6)
    m = w13q.Meter(pg, "keys")
    with pytest.raises(w13q.Capped):
        m.tab_to("true", "target", cap=5)
    assert m.tabs == 5


# ── run_one: the verdict the plan actually reads ────────────────────────────────────────

def _flow(fid: str, run=None, unbuilt: str | None = None) -> w13q.Flow:
    return w13q.Flow(fid=fid, run=run, unbuilt=unbuilt)


def _ctx() -> w13q.Ctx:
    return w13q.Ctx(base="http://127.0.0.1:0", req=None)


_UNSET = object()


def _run_one(flow, mode, width, tmp_path, *, br=_UNSET):
    """`br` defaults to a fresh FakeBrowser; pass `br=None` explicitly to prove a path never
    touches it at all (a real `None.new_context(...)` would raise AttributeError)."""
    browser = FakeBrowser(FakePage()) if br is _UNSET else br
    errors: list = []
    return w13q.run_one(browser, {}, "http://127.0.0.1:0", flow, mode, width, _ctx(), tmp_path, errors), errors


def test_run_one_under_budget_is_PASS(tmp_path):
    # Q1 keys budget is 3 (WAVE-13-PLAN.md section 6).
    def run(cx, pg, m, width):
        m.key("a", "one keystroke")
        return {"ok": True}
    flow = _flow("Q1", run=run)
    row, errors = _run_one(flow, "keys", "1200", tmp_path)
    assert row["measured"] == 1
    assert row["budget"] == 3
    assert row["verdict"] == "PASS"
    assert row["reason"] == ""
    assert errors == []


def test_run_one_exactly_at_budget_is_PASS_the_boundary_is_inclusive(tmp_path):
    def run(cx, pg, m, width):
        for _ in range(3):
            m.key("a", "keystroke")
        return {"ok": True}
    flow = _flow("Q1", run=run)
    row, _ = _run_one(flow, "keys", "1200", tmp_path)
    assert row["measured"] == 3 and row["budget"] == 3
    assert row["verdict"] == "PASS"


def test_run_one_over_budget_is_OVER(tmp_path):
    """THE CONTROL THE BRIEF ASKS FOR: an instrument that always reported PASS would pass
    every other test in this file and only this one would catch it. Q1's keys budget is 3;
    one keystroke over it must read OVER, never PASS."""
    def run(cx, pg, m, width):
        for _ in range(4):           # Q1 keys budget is 3
            m.key("a", "keystroke")
        return {"ok": True}
    flow = _flow("Q1", run=run)
    row, _ = _run_one(flow, "keys", "1200", tmp_path)
    assert row["measured"] == 4 and row["budget"] == 3
    assert row["verdict"] == "OVER"


def test_run_one_far_over_budget_is_still_OVER_not_clamped(tmp_path):
    def run(cx, pg, m, width):
        for _ in range(50):
            m.key("a", "keystroke")
        return {"ok": True}
    flow = _flow("Q1", run=run)
    row, _ = _run_one(flow, "keys", "1200", tmp_path)
    assert row["measured"] == 50
    assert row["verdict"] == "OVER"


def test_run_one_capped_tab_run_reads_OVER_with_cap_reason_never_PASS(tmp_path):
    def run(cx, pg, m, width):
        m.tab_to("true", "the unreachable control", cap=5)
        return {"ok": True}
    flow = _flow("Q1", run=run)
    page = FakePage(found_after=None)
    row, _ = _run_one(flow, "keys", "1200", tmp_path,
                       br=FakeBrowser(page))
    assert row["verdict"] == "OVER"
    assert row["reason"].startswith("cap reached:")
    assert row["measured"] == 5  # the Tab presses actually made, not None and not silently 0


def test_run_one_inconclusive_is_never_PASS_or_OVER_even_with_zero_actions(tmp_path):
    def run(cx, pg, m, width):
        raise w13q.Inconclusive("the seeded trade row is not visible on the Trades surface")
    flow = _flow("Q6", run=run)
    row, _ = _run_one(flow, "keys", "390", tmp_path)
    assert row["verdict"] == "INCONCLUSIVE"
    assert row["measured"] is None
    assert "not visible" in row["reason"]
    assert row["measured_before_stop"] == 0


def test_run_one_generic_driver_exception_is_inconclusive_never_a_crash(tmp_path):
    def run(cx, pg, m, width):
        m.key("a", "one keystroke before it broke")
        raise TimeoutError("waiting for navigation")
    flow = _flow("Q4", run=run)
    row, _ = _run_one(flow, "keys", "1200", tmp_path)
    assert row["verdict"] == "INCONCLUSIVE"
    assert row["reason"].startswith("driver could not complete: TimeoutError")
    assert row["measured_before_stop"] == 1
    assert "traceback" in row


def test_run_one_unbuilt_flow_is_inconclusive_before_touching_the_browser(tmp_path):
    """A lane whose surface is dark/unbuilt on this tree must read INCONCLUSIVE WITHOUT the
    instrument ever opening a browser context for it -- proved by passing `br=None`, which
    would raise AttributeError the moment anything tried to call `.new_context` on it."""
    flow = _flow("Q14", run=None, unbuilt="lane 13B (My Playbook) is not on this tree")
    row, errors = _run_one(flow, "mouse", "1200", tmp_path, br=None)
    assert row["verdict"] == "INCONCLUSIVE"
    assert row["reason"] == "lane 13B (My Playbook) is not on this tree"
    assert row["measured"] is None
    assert errors == []


# ── table_md rendering ───────────────────────────────────────────────────────────────────

def test_table_md_renders_a_missing_measured_as_a_dash_never_a_crash():
    rows = [{"flow": "Q6", "name": "link a note to a trade", "mode": "keys", "width": "390",
             "measured": None, "budget": 6, "verdict": "INCONCLUSIVE", "tabs": 37,
             "time_s": 23.78, "reason": "the seeded CRWD trade row is not visible on the "
             "Trades surface"}]
    out = w13q.table_md(rows)
    assert "| Q6 link a note to a trade | keys | 390 | - | 6 | INCONCLUSIVE | 37 | 23.78 |" in out


def test_table_md_sanitizes_pipes_and_newlines_in_the_reason_so_the_table_stays_well_formed():
    rows = [{"flow": "Q9", "name": "x", "mode": "mouse", "width": "1200", "measured": 3,
             "budget": 3, "verdict": "PASS", "tabs": 0, "time_s": 1.0,
             "reason": "a | pipe\nand a newline"}]
    out = w13q.table_md(rows)
    body_line = [l for l in out.splitlines() if l.startswith("| Q9")][0]
    assert body_line.count("|") == 10       # 9 columns = 10 pipes; none injected by the reason
    assert "\n" not in body_line


# ── the 23 budgets must not drift from the plan doc that owns them ─────────────────────────

_PLAN = REPO / "docs" / "notebook" / "WAVE-13-PLAN.md"


def _parse_plan_section_6_budgets() -> dict[str, tuple[int, int, int]]:
    """Reads docs/notebook/WAVE-13-PLAN.md's section 6 table directly (never retyped), so a
    drift between the spec and the instrument's BUDGETS constant fails here instead of
    silently reading a stale number."""
    rows: dict[str, tuple[int, int, int]] = {}
    for raw_line in _PLAN.read_text(encoding="utf-8").splitlines():
        # strip markdown emphasis FIRST -- Q7's row is bolded ("| **Q7** | **save ...") as the
        # plan's named control, and a prefix check against the un-stripped line misses it.
        line = raw_line.strip().replace("**", "")
        if not line.startswith("| Q"):
            continue
        cells = [c.strip().strip("*") for c in line.strip("|").split("|")]
        if len(cells) < 5:
            continue
        fid = cells[0].strip("*").strip()
        if not re.fullmatch(r"Q\d+", fid):
            continue
        try:
            rows[fid] = (int(cells[2]), int(cells[3]), int(cells[4]))
        except ValueError:
            continue
    return rows


def test_the_plan_doc_parser_is_not_vacuous():
    """Non-vacuity control (CLAUDE.md: 'an empty result is a failed invocation until proven
    otherwise'): a regex that matched nothing would make the drift check below pass by
    comparing two empty sets. All 23 flows must be found in the doc."""
    assert len(_parse_plan_section_6_budgets()) == 23


def test_instrument_budgets_match_the_plan_doc_exactly():
    plan = _parse_plan_section_6_budgets()
    assert set(plan) == set(w13q.BUDGET)
    for fid, (mouse, keys, taps) in plan.items():
        b = w13q.BUDGET[fid]
        assert (b["mouse"], b["keys"], b["taps"]) == (mouse, keys, taps), fid
