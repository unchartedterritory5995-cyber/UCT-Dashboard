"""The hot-warm cycle must not outlive the gap before its own next run.

Measured on prod 2026-08-29, on the single process that serves every member:

    _discord_chart_hot_warm   avg 15.9s   max 95.3s   interval 60s
    WARNING apscheduler.scheduler: Execution of job
        "_discord_chart_hot_warm (trigger: interval[0:01:00] …)" skipped

`limit` (a COUNT) was the only bound, which silently assumes each chart costs
about what it usually costs. The one time that assumption breaks is exactly when
it matters — `discord_interactions` itself documents that during a deploy swap
"a pod 22 s old fails every attempt". So the cycle also gets a wall-clock budget
and defers the rest to the next run.
"""
from __future__ import annotations

import time

import pytest

from api.services import discord_interactions as di


class _Hotset:
    """Stands in for `hotset.due` with a known number of due charts."""

    def __init__(self, n):
        self.items = [(f"KEY{i}", _Req(), {}) for i in range(n)]

    def due(self, _age_of, limit=6):
        return self.items[:limit]


class _Req:
    tf = "D"
    to = None
    compare = ()
    breadth_name = None


@pytest.fixture
def slow_warm(monkeypatch):
    """Every chart takes 0.05s; single_flight reports success."""
    calls = {"n": 0}

    def fake_single_flight(key, fn, ttl_s=None, cache_value=None):
        calls["n"] += 1
        time.sleep(0.05)
        return ("ok", b"png", {})

    monkeypatch.setattr(di.png_cache, "single_flight", fake_single_flight)
    monkeypatch.setattr(di.png_cache, "age_of", lambda *a, **k: 0)
    monkeypatch.setattr(di.prefs_mod, "render_options", lambda *a, **k: {})
    monkeypatch.setattr(di, "cache_ttl_for", lambda tf: 60)
    return calls


def _warm(**kw):
    return di.warm_hot_charts(bars_fn=None, render_fn=None, house_fn=None,
                              quote_fn=None, **kw)


def test_the_cycle_stops_at_its_deadline(monkeypatch, slow_warm):
    monkeypatch.setattr(di, "hotset", _Hotset(40))
    started = time.monotonic()
    warmed = _warm(limit=40, deadline_s=0.2)
    elapsed = time.monotonic() - started

    assert elapsed < 1.0, f"cycle ran {elapsed:.2f}s despite a 0.2s budget"
    assert 0 < len(warmed) < 40, (
        f"warmed {len(warmed)}/40 — the budget either did nothing or stopped "
        "everything; it should warm what fits and defer the rest"
    )


def test_without_a_deadline_behaviour_is_unchanged(monkeypatch, slow_warm):
    """The default must stay unbounded so every existing caller is unaffected.

    This is the discriminating half: a fix that bounded the cycle ALWAYS would
    quietly change every other caller and test in the codebase.
    """
    monkeypatch.setattr(di, "hotset", _Hotset(6))
    warmed = _warm(limit=6)
    assert len(warmed) == 6, "the un-deadlined path stopped warming everything"


def test_deferred_charts_are_not_lost(monkeypatch, slow_warm):
    """A deferred chart must simply be re-offered, never dropped.

    `hotset.due` is the queue; the cycle only skips. The next run sees the same
    entries, so the warm degrades in LATENCY, never in coverage.
    """
    hs = _Hotset(20)
    monkeypatch.setattr(di, "hotset", hs)
    first = _warm(limit=20, deadline_s=0.15)
    assert len(first) < 20
    # Same due-list on the next cycle: nothing was consumed or discarded.
    assert len(hs.due(None, limit=20)) == 20


def test_a_zero_budget_warms_nothing_rather_than_everything(monkeypatch, slow_warm):
    """Fail-safe direction: an accidental 0 must not read as 'unbounded'.

    `if deadline_s:` would treat 0.0 as falsy and run the cycle unbounded — the
    exact opposite of what a 0 asks for. Pinning it keeps the check as
    `is not None`.
    """
    monkeypatch.setattr(di, "hotset", _Hotset(10))
    assert _warm(limit=10, deadline_s=0.0) == []


# ── the budget must stay tied to the interval it protects ───────────────────


def test_the_budget_is_derived_from_the_interval_not_typed():
    """Two hand-typed numbers drift; the overrun would come back silently."""
    import inspect
    from api import main

    assert main.DISCORD_CHART_WARM_BUDGET_S < main.DISCORD_CHART_WARM_INTERVAL_S, (
        "the cycle budget is not shorter than its own interval — it can still "
        "overrun and skip its next run"
    )
    src = inspect.getsource(main)
    assert "DISCORD_CHART_WARM_BUDGET_S = DISCORD_CHART_WARM_INTERVAL_S" in src, (
        "the budget is written as an independent literal; it must be DERIVED "
        "from the interval so changing one cannot orphan the other"
    )


def test_the_scheduler_uses_the_same_interval_constant():
    """Otherwise the job's real cadence and the budget's basis disagree."""
    import inspect
    from api import main

    src = inspect.getsource(main)
    assert "seconds=DISCORD_CHART_WARM_INTERVAL_S" in src, (
        "add_job does not use the interval constant, so the budget is computed "
        "against a cadence the scheduler does not actually run"
    )
    assert 'add_job(_discord_chart_hot_warm, "interval", minutes=1' not in src, (
        "the hardcoded minutes=1 is back alongside the constant — two authorities"
    )


def test_the_warm_call_actually_passes_the_budget():
    """The wire. A budget that never reaches the cycle is decoration."""
    import inspect
    from api import main

    src = inspect.getsource(main._discord_chart_hot_warm)
    assert "deadline_s=DISCORD_CHART_WARM_BUDGET_S" in src, (
        "_discord_chart_hot_warm calls warm_hot_charts without deadline_s — the "
        "cycle is still unbounded in production"
    )


# ── fairness: "deferred" has to be true, not a comforting label ──────────────


def test_a_budgeted_cycle_does_not_starve_the_same_tail_forever(monkeypatch, slow_warm):
    """⛔ THE REGRESSION THE DEADLINE ITSELF INTRODUCED.

    `hotset.due` sorts by HIT COUNT descending — a STABLE order, the same charts
    in the same positions every cycle. So a deadline that always cuts from the
    end cuts THE SAME TAIL every time: those entries are never warmed again.
    Prod 2026-08-29 showed exactly the setup for it — a chronically over-budget
    cycle reporting "6 chart(s) deferred" on every single run.

    Deferral is only honest if the next cycle resumes where the last stopped.
    Run several budgeted cycles and require that EVERY due chart gets warmed at
    least once — which is false under the naive implementation.
    """
    hs = _Hotset(12)
    monkeypatch.setattr(di, "hotset", hs)
    monkeypatch.setattr(di, "_WARM_CURSOR", 0)

    seen = set()
    for _ in range(8):                       # enough cycles to cover 12 at ~3/cycle
        seen.update(_warm(limit=12, deadline_s=0.16))

    expected = {f"KEY{i}" for i in range(12)}
    missed = expected - seen
    assert not missed, (
        f"{len(missed)} chart(s) were never warmed across 8 budgeted cycles: "
        f"{sorted(missed)} — the budget is starving the tail, not deferring it"
    )


def test_the_cursor_only_advances_when_something_was_deferred(monkeypatch, slow_warm):
    """A cycle that finished everything must not rotate the next one.

    Otherwise the ordering drifts for no reason and the hottest chart stops
    being warmed first on a healthy cycle.
    """
    monkeypatch.setattr(di, "hotset", _Hotset(3))
    monkeypatch.setattr(di, "_WARM_CURSOR", 0)
    _warm(limit=3, deadline_s=5.0)           # ample budget: nothing deferred
    assert di._WARM_CURSOR == 0, "cursor moved despite nothing being deferred"


def test_the_unbounded_path_keeps_strict_hottest_first_order(monkeypatch, slow_warm):
    """No deadline ⇒ no rotation. The whole list is processed in `due` order."""
    monkeypatch.setattr(di, "hotset", _Hotset(5))
    monkeypatch.setattr(di, "_WARM_CURSOR", 3)   # deliberately non-zero
    warmed = _warm(limit=5)
    assert warmed == [f"KEY{i}" for i in range(5)], (
        f"the un-deadlined path rotated the order: {warmed}"
    )
