"""The split kill switch must stop the ADJUSTMENT, not just the store write.

🔴 MEASURED IN PRODUCTION 2026-08-10. `BARS_SPLIT_REPAIR_ENABLED=0` had been set for
days and the incident report recorded the damage as "frozen and bounded" on the
strength of it. It was not frozen. The flag is checked inside
`bars_split_repair.repair_ticker`, so it stopped the STORE WRITES — while the
identical false-positive detection kept running in `sanitize_daily_bars` and
rescaled **every response**, for every member, on every request.

⭐ THE PROOF: EGBN and BF-A's production rows are byte-identical to the
verified-clean local store, and production still SERVED them at 1.0993x and
3.3475x. A deep refetch could not fix them because nothing was wrong with the rows.

⛔ A switch that leaves the faulty computation running and merely declines to persist
its output is `lesson_gate_that_cannot_fail` in its most literal form.
"""
import importlib

import pytest

san = importlib.import_module("api.services.bars_sanitize")
bsr = importlib.import_module("api.services.bars_split_repair")


#: A 2:1 split declared mid-series with the pre-split bars NOT back-adjusted —
#: the shape the adjuster exists to fix.
SPLITS = [("2019-06-20", 2.0)]


def _bars():
    out = []
    for i in range(1, 41):
        day = f"2019-06-{i:02d}" if i <= 30 else f"2019-07-{i - 30:02d}"
        px = 100.0 if day < "2019-06-20" else 50.0
        out.append({"t": day, "o": px, "h": px, "l": px, "c": px, "v": 1000})
    return out


@pytest.fixture(autouse=True)
def _meta(monkeypatch):
    monkeypatch.setattr(san, "_ENABLED", True)
    monkeypatch.setattr(san, "_meta_cached", lambda t: {"ipo": None, "splits": SPLITS})
    scheduled = []
    monkeypatch.setattr(san, "_schedule_store_repair",
                        lambda t, tf: scheduled.append((t, tf)))
    return scheduled


def _closes(bars):
    return [b["c"] for b in bars]


def test_with_the_switch_ON_the_serve_path_still_adjusts(monkeypatch, _meta):
    """⛔ THE CONTROL. If the gate also broke the ON path, the fix would have
    silently disabled a real correction — worse than the bug."""
    monkeypatch.setattr(bsr, "enabled", lambda: True)
    out = san.sanitize_daily_bars("TESTX", _bars(), "D")
    pre = [c for b, c in zip(_bars(), _closes(out)) if b["t"] < "2019-06-20"]
    assert any(abs(c - 100.0) > 1e-9 for c in pre), \
        "the adjuster did nothing with the switch ON"
    assert _meta, "the store repair was not scheduled with the switch ON"


def test_with_the_switch_OFF_the_SERVED_bars_are_untouched(monkeypatch, _meta):
    """🔴 THE REGRESSION. This is what production was doing wrong: rescaling the
    response while the flag said the repair was off."""
    monkeypatch.setattr(bsr, "enabled", lambda: False)
    src = _bars()
    out = san.sanitize_daily_bars("TESTX", src, "D")
    assert _closes(out) == _closes(src), \
        "the switch is OFF and the served bars were STILL rescaled"


def test_with_the_switch_OFF_no_store_repair_is_scheduled(monkeypatch, _meta):
    monkeypatch.setattr(bsr, "enabled", lambda: False)
    san.sanitize_daily_bars("TESTX", _bars(), "D")
    assert _meta == [], "a store repair was scheduled while the switch was OFF"


def test_the_switch_is_the_SAME_one_the_store_writer_obeys():
    """⛔ NOT A SECOND FLAG. One switch, one meaning — a separate serve-time flag
    would let the two halves disagree, which is the state that produced a report
    describing live damage as 'frozen'."""
    import inspect
    src = inspect.getsource(san.sanitize_daily_bars)
    assert "bars_split_repair" in src, "the serve path does not consult the repair flag"
    assert "enabled()" in src
    # and the store writer keeps its own check — belt AND braces, same authority
    assert "enabled()" in inspect.getsource(bsr.repair_ticker)


def test_the_gate_covers_the_SPLIT_adjust_only(monkeypatch, _meta):
    """⚠️ The switch must gate the SPLIT adjustment and nothing else. The listing
    cutoff and the wick clamp are unrelated corrections; sweeping them into the same
    branch would quietly resurrect recycled-ticker bars and spike wicks whenever
    someone disabled the split repair.

    ⛔ ASSERTED STRUCTURALLY, over the AST. The obvious behavioural version of this
    test — feed bars and check the cutoff still fires — passes VACUOUSLY: the cutoff
    only triggers on a recycled ticker's multi-year data gap, so a contiguous
    fixture no-ops and the assertion holds no matter where the gate sits. That test
    was written first and it proved nothing.
    """
    import ast
    import inspect
    import textwrap

    tree = ast.parse(textwrap.dedent(inspect.getsource(san.sanitize_daily_bars)))
    fn = tree.body[0]
    guarded, unguarded = set(), set()
    for node in fn.body:
        if isinstance(node, ast.Try):
            for stmt in node.body:
                if isinstance(stmt, ast.If):
                    for c in ast.walk(stmt):
                        if isinstance(c, ast.Call) and isinstance(c.func, ast.Name):
                            guarded.add(c.func.id)
                else:
                    for c in ast.walk(stmt):
                        if isinstance(c, ast.Call) and isinstance(c.func, ast.Name):
                            unguarded.add(c.func.id)

    assert "_apply_split_adjust" in guarded, "the split adjust is NOT behind the gate"
    assert "_apply_listing_cutoff" in unguarded, \
        "the listing cutoff was swept behind the split switch"
    assert "_apply_listing_cutoff" not in guarded
