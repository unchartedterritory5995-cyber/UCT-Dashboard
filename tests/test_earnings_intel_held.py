"""Tier 2 part B (R-T2B-10): what earnings_intel already HOLDS, for a request path that must not wait
on a vendor. Never a build."""
import pytest

from api.services import earnings_intel as ei

FULL = {"ticker": "ORCL", "quarters": [{"label": "FY2027 Q1", "reported": True}], "estimates": [], "meta": {}}
ESTIMATES_ONLY = {"ticker": "ORCL", "quarters": [], "estimates": [{"label": "FY2027 Q2"}], "meta": {}}
ANNUAL_ONLY = {"ticker": "ORCL", "quarters": [], "estimates": [],
               "annual": {"reported": [{"fiscal_year": 2026, "eps": 5.0}]}}
EMPTY = {"quarters": [], "estimates": []}


@pytest.fixture(autouse=True)
def _no_build(monkeypatch):
    monkeypatch.setattr(ei, "_build", lambda sym: (_ for _ in ()).throw(AssertionError("built")))
    monkeypatch.setattr(ei, "_schedule_refresh", lambda sym: (_ for _ in ()).throw(AssertionError("refreshed")))
    store = {}
    monkeypatch.setattr(ei.cache, "get", lambda k: store.get(("mem", k)))
    monkeypatch.setattr(ei.snap_store, "get", lambda kind, sym: store.get(("disk", kind, sym)))
    return store


def test_memory_first(_no_build):
    _no_build[("mem", f"{ei._KIND}::ORCL")] = FULL
    assert ei.get_earnings_held("orcl") is FULL


def test_a_stale_snapshot_is_still_held(_no_build):
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, ei._STALE_MAX - 1, 60)
    assert ei.get_earnings_held("ORCL") is FULL


def test_too_old_partial_or_absent_is_none(_no_build):
    assert ei.get_earnings_held("ORCL") is None
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, ei._STALE_MAX + 1, 60)
    assert ei.get_earnings_held("ORCL") is None
    _no_build[("disk", ei._KIND, "ORCL")] = ({"quarters": [], "estimates": []}, 10, 60)
    assert ei.get_earnings_held("ORCL") is None
    assert ei.get_earnings_held("") is None


# ── the two layers agree (preflight A13 / F22) ──────────────────────────────────────────────

def _held_from_memory(store, payload):
    store.clear()
    store[("mem", f"{ei._KIND}::ORCL")] = payload
    return ei.get_earnings_held("ORCL")


def _held_from_snapshot(store, payload):
    store.clear()
    store[("disk", ei._KIND, "ORCL")] = (payload, 10, 60)
    return ei.get_earnings_held("ORCL")


@pytest.mark.parametrize("name,payload,held", [
    ("full", FULL, True),
    ("estimates_only", ESTIMATES_ONLY, True),
    ("annual_only", ANNUAL_ONLY, False),
    ("empty", EMPTY, False),
])
def test_one_payload_one_answer_whichever_layer_holds_it(_no_build, name, payload, held):
    """get_earnings parks a partial build in MEMORY on purpose (it spares the providers a burst) but
    never persists it. A held read has to treat that partial exactly as the snapshot path would, or the
    same payload is history from one layer and nothing from the other."""
    from_memory = _held_from_memory(_no_build, payload)
    from_snapshot = _held_from_snapshot(_no_build, payload)
    assert from_memory == from_snapshot
    assert (from_memory is payload) is held
    assert (from_snapshot is payload) is held


def test_a_partial_in_memory_does_not_hide_a_good_snapshot(_no_build):
    """The memory layer is skipped, not trusted, when it holds a partial build: the snapshot beneath it
    is the better answer and is still served."""
    _no_build[("mem", f"{ei._KIND}::ORCL")] = ANNUAL_ONLY
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, 10, 60)
    assert ei.get_earnings_held("ORCL") is FULL


# ── it never reaches a provider ─────────────────────────────────────────────────────────────

def _boom(name):
    def _raise(*a, **k):
        raise AssertionError(f"provider path reached: {name}")
    return _raise


def test_it_never_calls_a_provider(_no_build, monkeypatch):
    """Every road from earnings_intel to a vendor raises. The held read is exercised down every outcome
    it has (memory hit, snapshot hit, nothing held, a snapshot that is too old, a partial); none may
    touch any of them."""
    from api.services import annual_financials, earnings_estimates, earnings_reaction, earnings_table
    from api.services import financial_statements

    for mod, attr in (
        (ei, "get_earnings"),
        (ei, "_reporting_currency"),
        (ei, "_quarters_from_estimates"),
        (ei, "_forward_quarters"),
        (ei, "_annual"),
        (financial_statements, "get_statements"),
        (earnings_estimates, "get_year_earnings"),
        (earnings_table, "_forward_quarters"),
        (earnings_table, "_next_report_date"),
        (annual_financials, "get_annual_financials"),
        (earnings_reaction, "reaction_for"),
    ):
        monkeypatch.setattr(mod, attr, _boom(f"{mod.__name__}.{attr}"))

    assert _held_from_memory(_no_build, FULL) is FULL
    assert _held_from_snapshot(_no_build, FULL) is FULL
    _no_build.clear()
    assert ei.get_earnings_held("ORCL") is None
    assert ei.get_earnings_held(None) is None
    # The two rejected-snapshot exits are separate lines from "nothing held", and a fall-through to a
    # builder would live on exactly those.
    assert _held_from_snapshot(_no_build, ANNUAL_ONLY) is None
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, ei._STALE_MAX + 1, 60)
    assert ei.get_earnings_held("ORCL") is None
    assert _held_from_memory(_no_build, ANNUAL_ONLY) is None
