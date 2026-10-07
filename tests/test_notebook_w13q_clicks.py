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

    def filter(self, visible=None):
        return self

    def count(self):
        return 1

    def focus(self):
        pass  # the owning FakePage's `evaluate` governs the focus predicate, not this call


class FakeEmptyLocator:
    """A locator that matches nothing -- `use_skip_link`'s "no skip link offered" case."""

    def __init__(self):
        self.first = self

    def filter(self, visible=None):
        return self

    def count(self):
        return 0


class FakePage:
    """Stands in for a Playwright Page. `found_after` is the number of REAL Tab presses the
    fake "product" needs before `document.activeElement` would satisfy a `tab_to` predicate;
    `None` means it is never satisfied (models an unreachable control, i.e. the Q6/Q13 class
    of finding, and is what exercises the Capped path)."""

    def __init__(self, found_after: int | None = 0):
        self.keyboard = FakeKeyboard()
        self.found_after = found_after
        self.check_calls = 0
        self.brought_to_front = 0
        # 13Q-3: whether a `get_by_role("link", ...)` lookup (use_skip_link's own query)
        # should find a visible match. Off by default -- most existing tests never call it.
        self.skip_link_available = False
        self.get_by_role_calls: list[tuple] = []

    def get_by_role(self, role, name=None):
        self.get_by_role_calls.append((role, name))
        found = self.skip_link_available if role == "link" else False
        return FakeLocator() if found else FakeEmptyLocator()

    def locator(self, selector):
        return FakeLocator()

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

    def bring_to_front(self):
        self.brought_to_front += 1


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


# ── focus_editor_body: the 13Q-3 instrument-foreground compensation is REMOVED ──────────
#
# ✅ CLOSED, 13Q-Q1check controller follow-up #2. The compensation this block used to test
# (a Playwright-native `pm.focus()` tried before the real Tab walk, to paper over a harness
# artifact) is GONE from `tools/notebook_w13q_clicks.py::focus_editor_body` -- the product
# defects it was masking are fixed and independently re-measured 10/10 at both widths
# (docs/notebook/evidence/wave13-q1check/{remount-trace-diagnosis,focus-hook-probe,
# attach-fix-reverify}/). These three tests replace the three that proved the compensation's
# own behaviour, reusing the SAME generic fakes the rest of this file uses (never a
# compensation-specific fake) -- because there is no special-cased behaviour left to prove.


def test_focus_editor_body_already_in_the_body_short_circuits_for_free():
    """If the product already landed the caret (the fixed behaviour this whole lane measured
    for), the function returns immediately -- no Tab walk, no click, nothing counted beyond
    the free step."""
    page = FakePage(found_after=0)  # focus_in_editor's very first check reads True
    m = w13q.Meter(page, "keys")
    w13q.focus_editor_body(m)
    assert m.tabs == 0
    assert m.count() == 0
    assert any("already in body (free)" in s.get("do", "") for s in m.steps)


def test_focus_editor_body_keys_tabs_to_the_body_directly_no_compensation_in_between():
    """With the compensation removed, a 'keys' member who is NOT already in the body goes
    straight to the real Tab walk -- proved against the REAL function with the existing
    FakePage/FakeLocator fakes (no `pm.focus()` call exists anywhere on this path to fake)."""
    page = FakePage(found_after=4)
    m = w13q.Meter(page, "keys")
    w13q.focus_editor_body(m)
    assert m.tabs == 4                    # the real walk ran and found it after 4 presses
    assert m.count() == 4                 # the trailing "End" (caret placement) is setup, not counted


def test_focus_editor_body_mouse_and_taps_click_or_tap_the_body_directly():
    """Pointer modes never touch the keys-only Tab-walk branch at all -- a real click/tap on
    the `.ProseMirror` locator is the whole story, same as every other pointer-mode press in
    this file."""
    for mode, counter in (("mouse", "clicks"), ("taps", "taps")):
        page = FakePage(found_after=None)  # not already focused -- forces the pointer branch
        m = w13q.Meter(page, mode)
        w13q.focus_editor_body(m)
        assert getattr(m, counter) == 1
        assert m.count() == 1


# ── use_skip_link: 13Q-3's "take the door a real keyboard member would" ─────────────────

def test_use_skip_link_does_nothing_in_mouse_or_taps_mode():
    """A pointer member never 'uses' a skip link -- they already click/tap the real control
    directly. Proved for BOTH pointer modes against the real function."""
    for mode in ("mouse", "taps"):
        pg = FakePage()
        pg.skip_link_available = True
        m = w13q.Meter(pg, mode)
        used = w13q.use_skip_link(m, r"Skip to notes? list")
        assert used is False
        assert m.count() == 0
        assert pg.get_by_role_calls == []  # never even looked for one


def test_use_skip_link_returns_false_when_none_is_offered():
    pg = FakePage(found_after=0)
    pg.skip_link_available = False
    m = w13q.Meter(pg, "keys")
    used = w13q.use_skip_link(m, r"Skip to notes? list")
    assert used is False
    assert m.tabs == 0 and m.keys == 0
    assert pg.get_by_role_calls == [("link", None)] or pg.get_by_role_calls[0][0] == "link"


def test_use_skip_link_presses_it_for_real_in_keys_mode_when_one_is_offered():
    """Taking a skip link is itself `press()`'s existing keys-mode behaviour (Tab-to-locator,
    for real, then Enter) -- `use_skip_link` is the decision to call it on a skip link, not a
    new counting mechanism, so the SAME counters apply."""
    pg = FakePage(found_after=2)
    pg.skip_link_available = True
    m = w13q.Meter(pg, "keys")
    used = w13q.use_skip_link(m, r"Skip to notes? list", "Skip to notes list")
    assert used is True
    assert m.tabs == 2            # the real presses to reach the link
    assert m.keys == 1            # the Enter that activates it
    assert m.steps[-1] == {"do": "key", "key": "Enter", "on": "activate Skip to notes list"}


# ── use_template_search: 13Q-5's Q2 fix -- the dialog's own search box, not a card Tab-hunt ──

class FakeActiveCardLocator:
    """The probe for `[data-template-key='<key>'][data-active='true']` -- whether the search
    has converged on the wanted card."""

    def __init__(self, available: bool):
        self.first = self
        self.available = available

    def wait_for(self, state=None, timeout=None):
        if not self.available:
            raise TimeoutError("no card is highlighted yet")


class FakeTemplateSearchBox:
    """The Templates dialog's search input. `.element_handle()` returns itself as an identity
    sentinel so the owning page's `evaluate()` can answer `is_focused` honestly -- never a
    page-level boolean a locator cannot actually see."""

    def __init__(self, page):
        self.first = self
        self._page = page

    def wait_for(self, state=None, timeout=None):
        pass

    def filter(self, visible=None):
        return self

    def count(self):
        return 1

    def element_handle(self, timeout=None):
        return self

    def focus(self):
        self._page.search_focus_calls += 1
        if self._page.search_focus_succeeds:
            self._page.search_focused = True


class FakeTemplateDialog:
    """What `use_template_search` is handed as `dlg`: `.get_by_label` finds the search box,
    `.locator` finds the active-card probe."""

    def __init__(self, page):
        self._page = page

    def get_by_label(self, name):
        assert name == "Search templates"
        return self._page.search_box if self._page.search_box_exists else FakeEmptyLocator()

    def locator(self, selector):
        assert "data-active='true'" in selector
        return FakeActiveCardLocator(self._page.active_available)


class FakeTemplateSearchPage:
    def __init__(self, *, search_focused=False, focus_succeeds=True, active_available=True,
                 search_box_exists=True):
        self.keyboard = FakeKeyboard()
        self.search_focused = search_focused
        self.search_focus_succeeds = focus_succeeds
        self.search_focus_calls = 0
        self.active_available = active_available
        self.search_box_exists = search_box_exists
        self.search_box = FakeTemplateSearchBox(self)

    def evaluate(self, expr, arg=None):
        # is_focused's own predicate -- the only shape this page is ever asked to answer.
        assert "document.activeElement" in expr
        return bool(self.search_focused and arg is self.search_box)


def test_use_template_search_mouse_and_taps_never_run():
    """A pointer member already clicks/taps the card directly -- keys-mode only."""
    for mode in ("mouse", "taps"):
        page = FakeTemplateSearchPage()
        dlg = FakeTemplateDialog(page)
        m = w13q.Meter(page, mode)
        used = w13q.use_template_search(m, dlg, "Long/Short Thesis", "thesis")
        assert used is False
        assert m.count() == 0
        assert page.search_focus_calls == 0


def test_use_template_search_returns_false_when_the_dialog_has_no_search_box():
    page = FakeTemplateSearchPage(search_box_exists=False)
    dlg = FakeTemplateDialog(page)
    m = w13q.Meter(page, "keys")
    assert w13q.use_template_search(m, dlg, "Long/Short Thesis", "thesis") is False
    assert m.count() == 0


def test_use_template_search_types_and_enters_when_the_box_is_already_focused():
    """The common case: `autoFocusSearch` already landed real focus there (Sheet.jsx's own
    convention), so there is nothing to compensate -- type the label, Enter picks it."""
    page = FakeTemplateSearchPage(search_focused=True, active_available=True)
    dlg = FakeTemplateDialog(page)
    m = w13q.Meter(page, "keys")
    used = w13q.use_template_search(m, dlg, "Long/Short Thesis", "thesis")
    assert used is True
    assert page.search_focus_calls == 0       # never compensated -- it was already focused
    assert m.tabs == 0                        # no card Tab-hunt at all
    assert m.keys == 1                        # the one Enter
    assert m.steps[-1] == {"do": "key", "key": "Enter", "on": "pick the highlighted match (Long/Short Thesis)"}


def test_use_template_search_compensates_with_playwrights_own_focus_when_not_yet_focused():
    """THE SAME category of instrument-only compensation `focus_editor_body` already uses
    (never a product-internals reach-in, never counted) -- tried ONCE before giving up."""
    page = FakeTemplateSearchPage(search_focused=False, focus_succeeds=True, active_available=True)
    dlg = FakeTemplateDialog(page)
    m = w13q.Meter(page, "keys")
    used = w13q.use_template_search(m, dlg, "Long/Short Thesis", "thesis")
    assert used is True
    assert page.search_focus_calls == 1
    assert m.keys == 1


def test_use_template_search_falls_through_when_compensation_does_not_help():
    """⛔ THE CONTROL this lane's own brief asks for: a genuine failure to focus the search box
    is NOT silently papered over -- it is reported as not-used, so the caller's real Tab-hunt
    fallback still runs and measures honestly."""
    page = FakeTemplateSearchPage(search_focused=False, focus_succeeds=False, active_available=True)
    dlg = FakeTemplateDialog(page)
    m = w13q.Meter(page, "keys")
    used = w13q.use_template_search(m, dlg, "Long/Short Thesis", "thesis")
    assert used is False
    assert m.count() == 0


def test_use_template_search_falls_through_when_the_search_never_converges_on_the_card():
    """The box IS focused and the member DID type -- but if the product never highlights the
    named card (a genuine defect, or a label collision), Enter is never pressed blind at
    whatever else might be active. The caller's real Tab-hunt fallback still runs."""
    page = FakeTemplateSearchPage(search_focused=True, active_available=False)
    dlg = FakeTemplateDialog(page)
    m = w13q.Meter(page, "keys")
    used = w13q.use_template_search(m, dlg, "Long/Short Thesis", "thesis")
    assert used is False
    assert m.keys == 0            # Enter was never pressed


# ── use_bulk_shortcut: 13Q-5's Q11 fix -- Ctrl+Alt+B jumps into the bar ─────────────────────

class FakeBulkBarPage:
    def __init__(self, *, bar_exists=True):
        self.keyboard = FakeKeyboard()
        self._bar_exists = bar_exists

    def locator(self, selector):
        assert selector == "[data-bulk-bar]"
        return FakeLocator() if self._bar_exists else FakeEmptyLocator()


def test_use_bulk_shortcut_mouse_and_taps_never_run():
    for mode in ("mouse", "taps"):
        page = FakeBulkBarPage()
        m = w13q.Meter(page, mode)
        assert w13q.use_bulk_shortcut(m) is False
        assert m.count() == 0


def test_use_bulk_shortcut_returns_false_when_no_bar_is_on_screen():
    """⛔ CONTROL -- nothing to jump to is reported honestly, never a phantom press."""
    page = FakeBulkBarPage(bar_exists=False)
    m = w13q.Meter(page, "keys")
    assert w13q.use_bulk_shortcut(m) is False
    assert m.keys == 0


def test_use_bulk_shortcut_presses_the_chord_once_when_a_bar_exists():
    page = FakeBulkBarPage(bar_exists=True)
    m = w13q.Meter(page, "keys")
    used = w13q.use_bulk_shortcut(m)
    assert used is True
    assert m.keys == 1
    assert page.keyboard.presses == ["Control+Alt+b"]
    assert m.steps[-1] == {"do": "key", "key": "Control+Alt+b",
                            "on": "jump to the bulk-action bar (Ctrl+Alt+B)"}


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


def test_run_one_brings_the_fresh_page_to_the_front_before_running_the_flow(tmp_path):
    """13Q-3 (Q1 fix): Chromium silently ignores a script-triggered .focus() call on a page
    that has never been brought to the front, while synthetic clicks/taps/keypresses are
    unaffected -- diagnosed in 13Q-2 (q1-focus-foreground-diagnosis), fixed in `run_one` for
    the 13Q-owning lane. The real `run_one` must call `page.bring_to_front()` on the page it
    just created, before the flow runs -- proved against the real function, not a restatement."""
    page = FakePage()
    flow = _flow("Q1", run=lambda cx, pg, m, width: {"ok": True})
    row, _ = _run_one(flow, "keys", "1200", tmp_path, br=FakeBrowser(page))
    assert page.brought_to_front == 1
    assert row["verdict"] == "PASS"


def test_run_one_brings_to_front_BEFORE_the_flow_runs_not_after(tmp_path):
    """The control for the test above: a bring_to_front() called AFTER the flow already ran
    would not help a flow whose own first action depends on being foreground (Q1's body
    focus). The flow records whether the page was already foregrounded when it started."""
    page = FakePage()
    seen = {}

    def run(cx, pg, m, width):
        seen["brought_to_front_already"] = pg.brought_to_front
        return {"ok": True}

    flow = _flow("Q1", run=run)
    _run_one(flow, "keys", "1200", tmp_path, br=FakeBrowser(page))
    assert seen["brought_to_front_already"] == 1


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


# ── _trade_row: the Q6/Q13 phone-width locator fix ──────────────────────────────────────
#
# 13Q-3 finding: the COMMITTED file's `alt` locator was `has_text=re.compile(rf"\b{sym}\b")`,
# but the actual bytes on disk were two literal BACKSPACE control characters (0x08) around
# `{sym}`, not the two characters backslash+b -- a pattern that can never match ordinary page
# text. At 1200px this was invisible because `row` (a real `<tr>`) always matched first; at
# 390px the Trades surface renders `TradeCard` BUTTONS, never `<tr>`, so `alt` was the ONLY
# path and it was permanently dead -- exactly 13Q-2's "never once varies" signature. Fixed by
# using the plain string (the same substring semantics `row` already uses), never a regex.

class FakeTradeRowLocator:
    def __init__(self, found: bool):
        self._found = found

    def filter(self, visible=None):
        return self

    def count(self):
        return 1 if self._found else 0


class FakeTradeRowPage:
    """Records every `.locator(selector, has_text=...)` call so a test can assert the ACTUAL
    argument Playwright received -- a `re.Pattern` could look identical to a human reading the
    source while differing completely in the compiled bytes, which is exactly how this bug
    survived review."""

    def __init__(self, *, tr_matches: bool, alt_matches: bool):
        self.tr_matches = tr_matches
        self.alt_matches = alt_matches
        self.queries: list[tuple[str, object]] = []

    def locator(self, selector, has_text=None):
        self.queries.append((selector, has_text))
        return FakeTradeRowLocator(self.tr_matches if selector == "tr" else self.alt_matches)

    def wait_for_timeout(self, ms):
        pass


def test_trade_row_alt_query_is_a_plain_string_never_a_compiled_pattern():
    """The regression guard: a re.compile(...) here is exactly how the backspace corruption
    hid in the source for a whole lane. Asserting the TYPE of the argument Playwright actually
    received catches a reintroduced regex even if it compiles and even if it looks right."""
    pg = FakeTradeRowPage(tr_matches=False, alt_matches=True)
    row = w13q._trade_row(pg, "CRWD")
    assert row.count() == 1
    alt_queries = [q for q in pg.queries if q[0] != "tr"]
    assert len(alt_queries) == 1
    assert alt_queries[0][1] == "CRWD"
    assert isinstance(alt_queries[0][1], str)


def test_trade_row_finds_the_card_at_phone_width_where_there_is_no_tr():
    """The exact Q6/Q13 390px shape: no `<tr>` at all (TradeCard renders a `<button>`), so
    `alt` is the only path -- this is the case the backspace bug made permanently fail."""
    pg = FakeTradeRowPage(tr_matches=False, alt_matches=True)
    row = w13q._trade_row(pg, "CRWD")
    assert row.count() == 1


def test_trade_row_prefers_the_real_table_row_when_one_exists():
    """The 1200px shape: a real `<tr>` is found first; `alt` is never even needed, and this
    must keep working unchanged by the fix."""
    pg = FakeTradeRowPage(tr_matches=True, alt_matches=False)
    row = w13q._trade_row(pg, "CRWD")
    assert row.count() == 1
    assert pg.queries[0][0] == "tr"


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


# ── the keyboard ruling of 2026-10-07 must not drift from the plan doc that owns it ────────

def _parse_plan_keys_ruling() -> dict[str, tuple[int, int, int]]:
    """The plan's "Keyboard budgets by ruling" table, read directly: flow -> (plan, floor, budget)."""
    text = (REPO / "docs" / "notebook" / "WAVE-13-PLAN.md").read_text(encoding="utf-8")
    start = text.index("| # | plan keys | floor | keys budget |")
    rows: dict[str, tuple[int, int, int]] = {}
    for line in text[start:].splitlines()[2:]:
        m = re.match(r"^\|\s*(Q\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|", line)
        if not m:
            break
        rows[m.group(1)] = (int(m.group(2)), int(m.group(3)), int(m.group(4)))
    return rows


def test_the_keyboard_ruling_in_the_tool_is_the_plans_table():
    ruling = _parse_plan_keys_ruling()
    assert len(ruling) == 8                                   # NON-VACUITY: the parser read rows
    assert set(ruling) == set(w13q.KEYS_RULING_FLOOR)
    plan_keys = {b[0]: b[3] for b in w13q.BUDGETS}
    for fid, (plan, floor, budget) in ruling.items():
        assert plan == plan_keys[fid], fid                    # the "plan keys" column is the plan's own
        assert floor == w13q.KEYS_RULING_FLOOR[fid], fid
        assert floor > plan, fid                              # the ruling covers only a floor ABOVE the plan
        assert budget == floor + w13q.KEYS_RULING_ALLOWANCE, fid
        assert w13q.BUDGET[fid]["keys"] == budget, fid


def test_the_ruling_changes_keyboard_only_and_only_the_eight():
    for fid, _flow_name, mouse, keys, taps, _owner in w13q.BUDGETS:
        assert w13q.BUDGET[fid]["mouse"] == mouse and w13q.BUDGET[fid]["taps"] == taps
        if fid not in w13q.KEYS_RULING_FLOOR:
            assert w13q.BUDGET[fid]["keys"] == keys, fid
            assert w13q.BUDGET[fid]["keys_floor"] is None


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
        #  is the plan table's own number;  is that number, or the ruled
        # one for the eight flows of the 2026-10-07 keyboard ruling (checked above).
        assert (b["mouse"], b["keys_plan"], b["taps"]) == (mouse, keys, taps), fid


# ── finish program, lane CLICKS: one-Tab-stop groups, the helper count, the full roster ─────

class RovingPage(FakePage):
    """A page whose target sits inside a one-Tab-stop group. `plan` is what ROVING_PLAN_JS
    reports; `arrives` is whether focus is on the target after the group's keys."""

    def __init__(self, plan, arrives=True, found_after=2):
        super().__init__(found_after=found_after)
        self.plan, self.arrives = plan, arrives

    def evaluate(self, expr, arg=None):
        if expr == w13q.ROVING_PLAN_JS:
            return self.plan
        if isinstance(expr, str) and expr.startswith("h => h === document.activeElement"):
            return self.arrives
        return super().evaluate(expr, arg)


@pytest.mark.parametrize("plan,expected", [
    ({"from": 3, "to": 4, "n": 6, "vertical": False}, ["ArrowRight"]),
    ({"from": 3, "to": 2, "n": 6, "vertical": False}, ["ArrowLeft"]),
    ({"from": 1, "to": 3, "n": 6, "vertical": True}, ["ArrowDown", "ArrowDown"]),
    ({"from": 3, "to": 0, "n": 6, "vertical": False}, ["Home"]),
    ({"from": 2, "to": 5, "n": 6, "vertical": False}, ["End"]),
    ({"from": 0, "to": 5, "n": 6, "vertical": False}, ["ArrowLeft"]),      # one wrap beats End's tie
])
def test_a_control_in_a_one_stop_group_is_reached_by_tab_then_the_groups_own_keys(plan, expected):
    """Tab can never land on a `tabIndex -1` item, so a Tab-only walk would run to the cap and
    read as a product miss. The member's real path: Tab to the group, then its Arrow key."""
    pg = RovingPage(plan, found_after=2)
    m = w13q.Meter(pg, "keys")
    m.press(FakeLocator(), "Insights")
    assert pg.keyboard.presses == ["Tab", "Tab", *expected, "Enter"]
    assert m.tabs == 2
    assert m.keys == len(expected) + 1          # the group's keys and the Enter are all counted
    assert m.count() == 2 + len(expected) + 1


def test_a_group_whose_keys_do_not_arrive_reads_inconclusive_never_a_count():
    """The control: arrival is checked. A group that did not move focus must not be counted
    as if it had."""
    pg = RovingPage({"from": 3, "to": 4, "n": 6, "vertical": False}, arrives=False)
    m = w13q.Meter(pg, "keys")
    with pytest.raises(w13q.Inconclusive):
        m.press(FakeLocator(), "Insights")


def test_an_ordinary_control_is_still_a_plain_tab_walk():
    """Non-vacuity for the two tests above: with no group reported, no Arrow key is pressed."""
    pg = RovingPage(None, found_after=3)
    m = w13q.Meter(pg, "keys")
    m.press(FakeLocator(), "Save")
    assert pg.keyboard.presses == ["Tab", "Tab", "Tab", "Enter"]


@pytest.mark.parametrize("mode,field", [("mouse", "clicks"), ("taps", "taps")])
def test_counted_adds_a_helpers_pointer_inputs_to_the_right_counter(mode, field):
    m = w13q.Meter(FakePage(), mode)
    m.counted(3, "place a level on the chart")
    assert getattr(m, field) == 3 and m.count() == 3
    assert m.steps[-1]["on"] == "place a level on the chart"


def test_every_one_of_the_23_flows_has_a_driver():
    """The completeness review's finding, as a rail: eight flows had no driver, so their
    budgets were never measured. A flow may still read INCONCLUSIVE at run time; it may not
    be absent."""
    by_id = {f.fid: f for f in w13q.FLOWS}
    assert sorted(by_id, key=lambda s: int(s[1:])) == [f"Q{i}" for i in range(1, 24)]
    missing = [fid for fid, f in by_id.items() if f.run is None or f.unbuilt]
    assert missing == []
    assert w13q.UNBUILT == {}


def _notebook_flag_names() -> set[str]:
    """The keys of NOTEBOOK_FLAGS in api/routers/auth.py, read from its syntax tree. The tool
    never imports api.*, and neither does this rail."""
    import ast
    tree = ast.parse((REPO / "api" / "routers" / "auth.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "NOTEBOOK_FLAGS" for t in node.targets):
            return {k.value for k in node.value.keys if isinstance(k, ast.Constant)}
    return set()


def test_every_gate_the_sandbox_arms_is_a_real_gate():
    """An env var nobody reads looks exactly like a working switch (CLAUDE.md: never invent a
    flag). Every name the tool arms must be a key the app's one gate table declares."""
    real = _notebook_flag_names()
    assert "NOTEBOOK_PLAYBOOK_ENABLED" in real          # the parser found the table
    assert [n for n in w13q.FLAGS if n not in real] == []
    assert len(set(w13q.FLAGS)) == len(w13q.FLAGS)
