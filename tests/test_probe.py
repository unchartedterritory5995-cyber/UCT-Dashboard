"""The probe harness must fail on exactly the runs that fooled me.

Each case below is one of this session's three worthless measurements, reduced
to its shape. If any of them can pass, the harness is decoration.
"""
import sys, pathlib, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from tools.probe import Probe, ProbeFailed


def _sink():
    return io.StringIO()


# ─── the three real failures ────────────────────────────────────────────────

def test_a_run_where_EVERY_item_raised_is_refused():
    """FAILURE #2: `except Exception: continue` swallowed an AttributeError on
    every ticker and the script printed "nothing fired — no disagreement to
    measure today". A crash wearing a finding's words."""
    out = _sink()
    with pytest.raises(ProbeFailed, match="EVERY one of"):
        with Probe("all-raise", expect_min=1, out=out) as p:
            for t in ("A", "B", "C"):
                with p.item(t):
                    raise AttributeError("'float' object has no attribute 'get'")
    assert "AttributeError" in out.getvalue()
    assert "SUMMARY" in out.getvalue(), "the summary must print even on failure"


def test_a_run_that_processed_almost_nothing_is_refused():
    """FAILURE #3: a scan too slow to finish. It had processed a handful of
    tickers and its sparse prints made that look like progress."""
    with pytest.raises(ProbeFailed, match="only 3 usable"):
        with Probe("too-few", expect_min=200, out=_sink()) as p:
            for t in range(3):
                with p.item(str(t)):
                    p.ok()


def test_a_run_that_touched_nothing_is_refused():
    """FAILURE #1's shape: an empty result reported as a clean one."""
    with pytest.raises(ProbeFailed, match="nothing was processed"):
        with Probe("empty", out=_sink()):
            pass


def test_a_mostly_broken_run_is_refused_even_if_some_items_worked():
    """The subtle one: 60% erroring still produces a number, and that number is
    drawn from a self-selected 40%."""
    with pytest.raises(ProbeFailed, match=r"raised \(60%"):
        with Probe("mostly-broken", expect_min=1, max_error_rate=0.5,
                   out=_sink()) as p:
            for i in range(10):
                with p.item(str(i)):
                    if i < 6:
                        raise ValueError("boom")
                    p.ok()


# ─── and it must NOT refuse a healthy run ───────────────────────────────────

def test_a_healthy_run_passes_and_prints_its_summary():
    """⛔ THE DISCRIMINATION CONTROL. A harness that refused everything would
    satisfy every case above and be useless."""
    out = _sink()
    with Probe("healthy", expect_min=5, out=out) as p:
        for i in range(10):
            with p.item(str(i)):
                if i == 0:
                    raise RuntimeError("one bad item is survivable")
                p.ok()
        p.result("hit rate", "42%")
    s = out.getvalue()
    assert "SUMMARY" in s and "counted=10" in s and "errors=1" in s
    assert "hit rate: 42%" in s
    assert "END" in s


def test_skips_are_counted_apart_from_errors():
    """A skip is a decision; an error is a defect. Collapsing them hides both."""
    out = _sink()
    with Probe("skips", expect_min=1, out=out) as p:
        for i in range(6):
            with p.item(str(i)):
                if i % 2:
                    p.skip("too few bars")
                else:
                    p.ok()
    s = out.getvalue()
    assert "skipped=3" in s and "errors=0" in s
    assert "too few bars" in s


def test_a_real_crash_inside_the_block_is_not_swallowed():
    """The harness records per-ITEM errors. A failure in the surrounding code
    is a real bug and must propagate — otherwise the harness becomes the very
    silent `except` it exists to replace."""
    with pytest.raises(KeyError):
        with Probe("outer", expect_min=1, out=_sink()) as p:
            with p.item("a"):
                p.ok()
            raise KeyError("this is not an item failure")


def test_the_summary_names_the_first_error_so_it_can_be_chased():
    out = _sink()
    with pytest.raises(ProbeFailed):
        with Probe("named", expect_min=1, out=out) as p:
            for i in range(4):
                with p.item(f"TICK{i}"):
                    raise TypeError("unsupported operand")
    s = out.getvalue()
    assert "TICK0" in s and "TypeError" in s and "unsupported operand" in s
