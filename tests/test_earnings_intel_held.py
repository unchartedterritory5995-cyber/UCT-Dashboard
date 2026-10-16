"""Tier 2 part B (R-T2B-10): what earnings_intel already HOLDS, for a request path that must not wait
on a vendor. Never a build."""
import pytest

from api.services import earnings_intel as ei

FULL = {"ticker": "ORCL", "quarters": [{"label": "FY2027 Q1", "reported": True}], "estimates": [], "meta": {}}
ESTIMATES_ONLY = {"ticker": "ORCL", "quarters": [], "estimates": [{"label": "FY2027 Q2"}], "meta": {}}
ANNUAL_ONLY = {"ticker": "ORCL", "quarters": [], "estimates": [],
               "annual": {"reported": [{"fiscal_year": 2026, "eps": 5.0}]}}
EMPTY = {"quarters": [], "estimates": []}


def _writes(name):
    def _raise(*a, **k):
        raise AssertionError(f"held read wrote: {name}")
    return _raise


def _held(ticker):
    """get_earnings_held with every write seam raising for the duration of THIS call only.

    Scoped to the call on purpose: a fixture-lifetime patch also catches whatever another fixture or
    module legitimately does to the shared cache in its own setup/teardown (green alone, red in
    company)."""
    with pytest.MonkeyPatch.context() as mp:
        for obj, label, name in ((ei.cache, "cache", "set"), (ei.cache, "cache", "invalidate"),
                                 (ei.cache, "cache", "delete_prefix"),
                                 (ei.snap_store, "snap_store", "put"), (ei.snap_store, "snap_store", "delete")):
            mp.setattr(obj, name, _writes(f"{label}.{name}"))
        return ei.get_earnings_held(ticker)


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
    assert _held("orcl") is FULL


def test_a_stale_snapshot_is_still_held(_no_build):
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, ei._STALE_MAX - 1, 60)
    assert _held("ORCL") is FULL


def test_too_old_partial_or_absent_is_none(_no_build):
    assert _held("ORCL") is None
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, ei._STALE_MAX + 1, 60)
    assert _held("ORCL") is None
    _no_build[("disk", ei._KIND, "ORCL")] = ({"quarters": [], "estimates": []}, 10, 60)
    assert _held("ORCL") is None
    assert _held("") is None


# ── the two layers agree (preflight A13 / F22) ──────────────────────────────────────────────

def _held_from_memory(store, payload):
    store.clear()
    store[("mem", f"{ei._KIND}::ORCL")] = payload
    return _held("ORCL")


def _held_from_snapshot(store, payload):
    store.clear()
    store[("disk", ei._KIND, "ORCL")] = (payload, 10, 60)
    return _held("ORCL")


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
    assert _held("ORCL") is FULL


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
    assert _held("ORCL") is None
    assert _held(None) is None
    # The two rejected-snapshot exits are separate lines from "nothing held", and a fall-through to a
    # builder would live on exactly those.
    assert _held_from_snapshot(_no_build, ANNUAL_ONLY) is None
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, ei._STALE_MAX + 1, 60)
    assert _held("ORCL") is None
    assert _held_from_memory(_no_build, ANNUAL_ONLY) is None


# ── edges ───────────────────────────────────────────────────────────────────────────────────

def test_a_padded_ticker_is_stripped(_no_build):
    _no_build[("mem", f"{ei._KIND}::ORCL")] = FULL
    assert _held("  orcl 	") is FULL
    _no_build.clear()
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, 10, 60)
    assert _held(" orcl ") is FULL
    assert _held("   ") is None


def test_the_stale_boundary_is_inclusive(_no_build):
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, ei._STALE_MAX, 60)
    assert _held("ORCL") is FULL
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, ei._STALE_MAX + 1, 60)
    assert _held("ORCL") is None


@pytest.mark.parametrize("junk", [None, "a string", ["quarters"], 42])
def test_a_non_dict_payload_is_none_from_either_layer(_no_build, junk):
    assert _held_from_snapshot(_no_build, junk) is None
    assert _held_from_memory(_no_build, junk) is None


def test_a_held_read_writes_nothing_on_any_outcome(_no_build):
    """The write seams raise (fixture); drive every exit so a re-prime or persist on any of them fails."""
    assert _held_from_memory(_no_build, FULL) is FULL
    assert _held_from_snapshot(_no_build, FULL) is FULL
    assert _held_from_snapshot(_no_build, ANNUAL_ONLY) is None
    _no_build[("disk", ei._KIND, "ORCL")] = (FULL, ei._STALE_MAX + 1, 60)
    assert _held("ORCL") is None
    _no_build.clear()
    assert _held("ORCL") is None
