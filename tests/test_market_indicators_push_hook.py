"""THE ONE SHARED SEAM — the NAAIM append inside `/api/breadth-monitor/push`.

⛔⛔ THIS IS THE ONLY BREADTH FILE THE MARKET INDICATORS PROJECT TOUCHES, so it gets
its own suite. The contract it must hold, in the owner's words: exception isolated,
idempotent, duplicate safe, unable to break the existing Breadth push if NAAIM
persistence fails, and unable to write bogus placeholder data.

⚠️ THESE EXERCISE THE REAL ROUTER FUNCTION, not a re-implementation of it. A test that
copies the hook's logic proves the copy works. `push_breadth_snapshot` is called
directly with a stubbed request, with the snapshot store stubbed out so nothing
touches breadth state — the hook itself is the thing under test.
"""
from __future__ import annotations

import asyncio
import json

import pytest


class _Req:
    """The two things `push_breadth_snapshot` asks a Request for."""

    def __init__(self, body, params=None):
        self._body = body
        self.query_params = params or {}

    async def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


@pytest.fixture
def hook(tmp_path, monkeypatch):
    """The real router, with breadth state stubbed and NAAIM pointed at a temp store."""
    from api.routers import breadth_monitor as router
    from api.services.market_indicators import naaim_store as ns

    monkeypatch.setenv("NAAIM_DB", str(tmp_path / "naaim.db"))
    monkeypatch.setattr(ns, "_INIT_DONE", False, raising=False)

    # ⛔ NOTHING BREADTH-SIDE MAY ACTUALLY RUN. The push path stores a snapshot, kicks
    # a heal and warms bars; none of that is under test here and all of it would reach
    # real state.
    monkeypatch.setattr(router, "_check_auth", lambda r: None)
    stored = {}
    monkeypatch.setattr(router.svc, "store_snapshot",
                        lambda d, m: stored.update({"date": d, "metrics": m}) or True)
    monkeypatch.setattr(router.svc, "snapshot_looks_degraded", lambda m: False)
    monkeypatch.setattr(router, "invalidate_analogues_cache", lambda: None)

    def run(metrics, date="2026-03-05"):
        return asyncio.run(router.push_breadth_snapshot(
            _Req({"date": date, "metrics": metrics})))

    return type("H", (), {"run": staticmethod(run), "ns": ns, "stored": stored,
                          "router": router})


# ── It appends ───────────────────────────────────────────────────────────────

def test_an_accepted_naaim_value_lands_in_the_canonical_series(hook):
    """⭐⭐ ONE TRUTH. The value the Breadth page will read and the value the chart
    draws are the same row, written by one ingestion path."""
    res = hook.run({"naaim": 71.4, "naaim_date": "2026-03-04", "universe_count": 3000})
    assert res["status"] == "ok"
    latest = hook.ns.latest()
    assert latest is not None
    assert latest["value"] == pytest.approx(71.4)
    assert latest["observed_on"] == "2026-03-04"
    assert latest["source"] == hook.ns.SOURCE_COLLECTOR
    # and the snapshot itself still stored, unchanged
    assert hook.stored["metrics"]["naaim"] == 71.4


def test_a_negative_reading_survives_the_whole_push_path(hook):
    hook.run({"naaim": -42.0, "naaim_date": "2026-03-04"})
    assert hook.ns.latest()["value"] == pytest.approx(-42.0)


# ── It refuses bogus data ────────────────────────────────────────────────────

def test_the_placeholder_never_enters_the_canonical_series(hook):
    """The morning-wire default arriving through a real push must be refused."""
    res = hook.run({"naaim": 75.0})            # undated — the placeholder signature
    assert res["status"] == "ok", "the snapshot must still be accepted"
    assert hook.ns.bounds()["count"] == 0, "but nothing may enter the series"
    refusals = hook.ns.stats()["recent_refusals"]
    assert refusals and "placeholder" in refusals[0]["reason"]


def test_an_out_of_range_value_is_refused_without_failing_the_push(hook):
    res = hook.run({"naaim": 9999.0, "naaim_date": "2026-03-04"})
    assert res["status"] == "ok"
    assert hook.ns.bounds()["count"] == 0


# ── It is isolated ───────────────────────────────────────────────────────────

def test_a_naaim_store_explosion_cannot_reject_the_breadth_snapshot(hook, monkeypatch):
    """⛔⛔ THE LOAD-BEARING GUARANTEE. Breadth ingestion is the path the Monitor
    depends on; a market indicator failing to append must never cost a session."""
    def boom(*a, **k):
        raise RuntimeError("disk on fire")
    monkeypatch.setattr(hook.ns, "ingest", boom)

    res = hook.run({"naaim": 71.4, "naaim_date": "2026-03-04", "universe_count": 3000})
    assert res["status"] == "ok"
    assert hook.stored["metrics"]["universe_count"] == 3000


def test_a_snapshot_with_no_naaim_key_touches_nothing(hook):
    hook.run({"universe_count": 3000, "advancing": 1500})
    assert hook.ns.bounds()["count"] == 0


def test_a_null_naaim_is_not_an_observation(hook):
    """Production currently pushes `naaim: null`. That must be a no-op, not a zero."""
    hook.run({"naaim": None, "naaim_date": None})
    assert hook.ns.bounds()["count"] == 0


# ── It is idempotent and duplicate-safe ──────────────────────────────────────

def test_pushing_the_same_snapshot_twice_writes_one_observation(hook):
    hook.run({"naaim": 71.4, "naaim_date": "2026-03-04"})
    hook.run({"naaim": 71.4, "naaim_date": "2026-03-04"})
    hook.run({"naaim": 71.4, "naaim_date": "2026-03-04"})
    assert hook.ns.bounds()["count"] == 1
    assert hook.ns.latest()["revision"] == 0, "an unchanged re-push is not a revision"


def test_a_corrected_value_for_the_same_week_revises_rather_than_duplicates(hook):
    hook.run({"naaim": 71.4, "naaim_date": "2026-03-04"})
    hook.run({"naaim": 72.9, "naaim_date": "2026-03-04"})
    assert hook.ns.bounds()["count"] == 1
    assert hook.ns.latest()["value"] == pytest.approx(72.9)
    assert hook.ns.latest()["revision"] == 1


def test_successive_weeks_accumulate(hook):
    for d, v in (("2026-03-04", 60.0), ("2026-03-11", 65.0), ("2026-03-18", 70.0)):
        hook.run({"naaim": v, "naaim_date": d}, date=d)
    assert hook.ns.bounds()["count"] == 3
    obs = hook.ns.observations()
    assert [o["observed_on"] for o in obs] == ["2026-03-04", "2026-03-11", "2026-03-18"]


# ── It is structurally safe ──────────────────────────────────────────────────

def test_the_hook_runs_after_the_snapshot_is_already_stored():
    """⛔ ORDER MATTERS. If the append ran BEFORE `store_snapshot`, a NAAIM failure
    could strand the series ahead of the breadth row it came from. Derived from the
    source rather than asserted from memory."""
    import inspect
    from api.routers import breadth_monitor as router
    src = inspect.getsource(router.push_breadth_snapshot)
    assert src.index("store_snapshot") < src.index("naaim_store"), (
        "the NAAIM append must come after the snapshot is stored")


def test_the_hook_is_wrapped_in_its_own_try_except():
    """⚠️ ANCHORED ON THE EXECUTABLE LINE, NOT ON THE WORD `naaim_store`. That string
    appears first inside the block comment above the hook, so a window around it reads
    prose and proves nothing. `_naaim_value` is only ever code."""
    import inspect
    from api.routers import breadth_monitor as router
    src = inspect.getsource(router.push_breadth_snapshot)
    i = src.index("_naaim_value")
    block = src[i - 200: i + 600]
    assert "try:" in block and "except Exception:" in block
    # and the guard is the LAST thing before the append, not somewhere above it
    assert block.index("try:") < block.index("_naaim_value = ")


def test_the_hook_writes_only_to_the_naaim_store():
    """It must not have grown a second side effect."""
    import inspect
    from api.routers import breadth_monitor as router
    src = inspect.getsource(router.push_breadth_snapshot)
    start = src.index("_naaim_value")
    block = src[start:start + 700]
    for forbidden in ("write_bulk", "set_ohlc", "update_intraday", "store_snapshot",
                      "patch_field", "delete_snapshot"):
        assert forbidden not in block, f"the NAAIM hook must not call {forbidden}"
