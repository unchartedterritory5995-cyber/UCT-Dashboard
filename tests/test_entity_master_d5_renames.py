"""D5 CHECKPOINT 6 (renamed only) — the confirmed-rename producer.

Every fixture is synthetic (monkeypatched `_fetch_ticker_events` and/or
`reconciliation.run_reconciliation`); no network call. Mirrors
`test_entity_master_d5_producer.py`'s fixture shape and inert-strand test
structure so all three D5 producers are tested the same way.
"""
from __future__ import annotations

import ast
import inspect
import types

import pytest

from api.services import entity_master_d5_renames as d5r
from api.services.entity_master import api as em_api
from api.services.entity_master import reconciliation as recon
from api.services.entity_master import schema


@pytest.fixture
def db_path(tmp_path):
    p = str(tmp_path / "d5_renames_test.db")
    schema.init_db(db_path=p)
    return p


def _seed(db_path, alias, valid_from="2020-01-01", entity_type="equity"):
    r = em_api.apply_event(
        "new_entity", {"entity_type": entity_type, "initial_alias": alias,
                       "initial_alias_valid_from": valid_from},
        dedup_key=f"seed:{alias}", source="admin_manual", db_path=db_path,
    )
    assert r.accepted
    return r.entity_id


def _fake_recon(creates=(), delists=()):
    """A stand-in for reconciliation.run_reconciliation's OWN return shape,
    with the SAME two independently-computed lists it produces."""
    return {
        "dry_run": True,
        "proposed_creates": [{"symbol": s} for s in creates],
        "proposed_delists": [{"symbol": s} for s in delists],
    }


# ── the inert-strand precondition itself ──────────────────────────────────────

def test_no_file_under_entity_master_imports_this_producer_back():
    """Same guarantee as D5 CP5's own build record: entity_master/** must
    not import this module, or flow-worker's existing reachability of that
    package would gain a new edge into this module's own network call."""
    import api.services.entity_master as em_pkg
    import pathlib
    pkg_dir = pathlib.Path(em_pkg.__file__).parent
    for py_file in pkg_dir.glob("*.py"):
        src = py_file.read_text(encoding="utf-8")
        tree = ast.parse(src)
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module] + [a.name for a in node.names]
            assert not any("entity_master_d5_renames" in n for n in names), (
                f"{py_file.name} imports the D5 renames producer back -- this "
                f"would give flow-worker (which RUNS entity_master/**) a new "
                f"edge into entity_master_d5_renames.py's own network call")


def test_this_producer_never_imports_delisted_registry():
    """Same Checkpoint-7 guarantee reconciliation.py and the CP5 producer
    both carry: structurally immune to stale delisted_registry data because
    it is never in this module's input set at all."""
    src = inspect.getsource(d5r)
    tree = ast.parse(src)
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
            names.update(a.name for a in node.names)
    assert not any("delisted_registry" in n for n in names), names


# ── _fetch_ticker_events — parsing the vendor's own response shape ───────────

def test_fetch_ticker_events_parses_the_real_response_shape(monkeypatch):
    """The exact shape verified live 2026-09-18 against META -- two
    ticker_change entries, unsorted as returned."""
    import api.services.massive as massive

    fake_resp = {
        "results": {"events": [
            {"type": "ticker_change", "ticker_change": {"ticker": "META"}, "date": "2022-06-09"},
            {"type": "ticker_change", "ticker_change": {"ticker": "FB"}, "date": "2012-05-18"},
        ]},
        "status": "OK",
    }
    fake_client = types.SimpleNamespace(_api_key="k", _get=lambda url: fake_resp)
    monkeypatch.setattr(massive, "_get_client", lambda: fake_client)

    events = d5r._fetch_ticker_events("META")
    assert {"ticker": "META", "date": "2022-06-09"} in events
    assert {"ticker": "FB", "date": "2012-05-18"} in events


def test_fetch_ticker_events_ignores_non_ticker_change_types(monkeypatch):
    import api.services.massive as massive

    fake_resp = {"results": {"events": [
        {"type": "some_other_event", "date": "2020-01-01"},
        {"type": "ticker_change", "ticker_change": {"ticker": "X"}, "date": "2021-01-01"},
    ]}}
    fake_client = types.SimpleNamespace(_api_key="k", _get=lambda url: fake_resp)
    monkeypatch.setattr(massive, "_get_client", lambda: fake_client)

    events = d5r._fetch_ticker_events("Y")
    assert events == [{"ticker": "X", "date": "2021-01-01"}]


def test_fetch_ticker_events_returns_empty_on_404_never_raises(monkeypatch):
    """NOT_FOUND (verified live against ATVI/TWTR -- no event history at all)
    is the NORMAL case for most tickers, never an error."""
    import api.services.massive as massive

    def _raise(url):
        raise Exception("404 Client Error: Not Found")

    fake_client = types.SimpleNamespace(_api_key="k", _get=_raise)
    monkeypatch.setattr(massive, "_get_client", lambda: fake_client)

    assert d5r._fetch_ticker_events("ATVI") == []


# ── find_confirmed_prior_ticker — the vendor-sourced correlation ─────────────

def test_find_confirmed_prior_ticker_identifies_the_immediately_preceding_ticker(monkeypatch):
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [
        {"ticker": "META", "date": "2022-06-09"},
        {"ticker": "FB", "date": "2012-05-18"},
    ])
    assert d5r.find_confirmed_prior_ticker("META") == ("FB", "2022-06-09")


def test_find_confirmed_prior_ticker_is_none_for_a_never_renamed_ticker(monkeypatch):
    """Only ONE entry in the vendor's history (its own IPO ticker) -- there
    is no prior ticker to name."""
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [
        {"ticker": "AAPL", "date": "1980-12-12"},
    ])
    assert d5r.find_confirmed_prior_ticker("AAPL") is None


def test_find_confirmed_prior_ticker_is_none_with_no_history(monkeypatch):
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [])
    assert d5r.find_confirmed_prior_ticker("ANYTHING") is None


def test_find_confirmed_prior_ticker_refuses_an_unexpected_shape(monkeypatch):
    """⛔ The sanity check: if the LAST-dated entry does not name the ticker
    we queried, this refuses rather than guessing which entry is "prior.\""""
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [
        {"ticker": "SOMETHING", "date": "2020-01-01"},
        {"ticker": "ELSE", "date": "2021-01-01"},
    ])
    assert d5r.find_confirmed_prior_ticker("QUERIED") is None


# ── run_d5_rename_producer — the one correlation this module makes ──────────

def test_confirms_a_rename_when_reconciliation_and_the_vendor_agree(monkeypatch, db_path):
    monkeypatch.setattr(recon, "run_reconciliation",
                         lambda **kw: _fake_recon(creates=["META"], delists=["FB"]))
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [
        {"ticker": "META", "date": "2022-06-09"},
        {"ticker": "FB", "date": "2012-05-18"},
    ])
    result = d5r.run_d5_rename_producer(dry_run=True, db_path=db_path)
    assert result["confirmed_renames"] == [
        {"old_symbol": "FB", "new_symbol": "META", "transition_date": "2022-06-09"}
    ]


def test_stays_silent_when_the_vendor_names_a_DIFFERENT_prior_ticker(monkeypatch, db_path):
    """⛔⛔ THE LOAD-BEARING CASE. Reconciliation independently proposed
    delisting 'OLDCO' and creating 'NEWCO' -- an unrelated delisting plus an
    unrelated new listing, per reconciliation's own explicit boundary. The
    vendor's OWN history for NEWCO names a DIFFERENT prior ticker ('WRONG')
    -- not OLDCO. This must NOT be confirmed: the vendor is describing a
    transition this run has no other evidence connects to OLDCO at all."""
    monkeypatch.setattr(recon, "run_reconciliation",
                         lambda **kw: _fake_recon(creates=["NEWCO"], delists=["OLDCO"]))
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [
        {"ticker": "NEWCO", "date": "2026-01-01"},
        {"ticker": "WRONG", "date": "2020-01-01"},
    ])
    result = d5r.run_d5_rename_producer(dry_run=True, db_path=db_path)
    assert result["confirmed_renames"] == []


def test_stays_silent_when_the_vendor_has_no_history_at_all(monkeypatch, db_path):
    """An ordinary, unrelated new listing next to an ordinary, unrelated
    delisting -- exactly what reconciliation.py's own docstring says looks
    identical to a rename from its feed alone. No vendor event history for
    the new symbol -> stays detected, nothing emitted."""
    monkeypatch.setattr(recon, "run_reconciliation",
                         lambda **kw: _fake_recon(creates=["FRESH"], delists=["GONE"]))
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [])
    result = d5r.run_d5_rename_producer(dry_run=True, db_path=db_path)
    assert result["confirmed_renames"] == []


# ── dry_run contract + apply path ─────────────────────────────────────────────

def test_dry_run_true_never_calls_apply_event(monkeypatch, db_path):
    calls = []
    monkeypatch.setattr(em_api, "apply_event", lambda *a, **k: calls.append((a, k)))
    monkeypatch.setattr(recon, "run_reconciliation",
                         lambda **kw: _fake_recon(creates=["META"], delists=["FB"]))
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [
        {"ticker": "META", "date": "2022-06-09"}, {"ticker": "FB", "date": "2012-05-18"},
    ])
    d5r.run_d5_rename_producer(dry_run=True, db_path=db_path)
    assert calls == []


def test_dry_run_false_applies_with_source_d5_renames(monkeypatch, db_path):
    eid = _seed(db_path, "FB", valid_from="2012-05-18")
    monkeypatch.setattr(recon, "run_reconciliation",
                         lambda **kw: _fake_recon(creates=["META"], delists=["FB"]))
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [
        {"ticker": "META", "date": "2022-06-09"}, {"ticker": "FB", "date": "2012-05-18"},
    ])
    result = d5r.run_d5_rename_producer(dry_run=False, db_path=db_path)
    assert result["applied"] == 1
    assert result["rejected"] == []

    resolved_new = em_api.resolve("META", db_path=db_path)
    assert resolved_new.status == "resolved"
    assert resolved_new.entity.entity_id == eid

    from api.services.entity_master import store
    conn = store._conn(db_path)
    row = conn.execute("SELECT source FROM entity_events WHERE dedup_key = ?",
                       ("d5-rename:FB:META:2022-06-09",)).fetchone()
    assert row is not None and row[0] == "d5-renames"


def test_dry_run_false_rejects_when_old_symbol_never_resolves(monkeypatch, db_path):
    """The vendor and reconciliation both point at 'FB', but this store has
    never heard of it (a synthetic mismatch, but the failure mode is real:
    a store lagging behind the vendor's own history) -- rejected by name,
    never a silent no-op."""
    monkeypatch.setattr(recon, "run_reconciliation",
                         lambda **kw: _fake_recon(creates=["META"], delists=["FB"]))
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [
        {"ticker": "META", "date": "2022-06-09"}, {"ticker": "FB", "date": "2012-05-18"},
    ])
    result = d5r.run_d5_rename_producer(dry_run=False, db_path=db_path)
    assert result["applied"] == 0
    assert len(result["rejected"]) == 1
    assert result["rejected"][0]["old_symbol"] == "FB"


def test_apply_is_idempotent_on_a_second_run(monkeypatch, db_path):
    """⛔ A second run under the SAME (artificial, static) fixture never
    double-applies -- but it does so via a DIFFERENT path than
    `apply_event`'s own dedup-key short-circuit, and that difference is
    itself correct: after the first run, 'FB' is a CLOSED alias (the rename
    closed it), so `em_api.resolve('FB', ...)` no longer resolves it at all.
    The second run therefore rejects at the resolve step, before
    `apply_event` is even called -- one write either way, never two."""
    _seed(db_path, "FB", valid_from="2012-05-18")
    monkeypatch.setattr(recon, "run_reconciliation",
                         lambda **kw: _fake_recon(creates=["META"], delists=["FB"]))
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [
        {"ticker": "META", "date": "2022-06-09"}, {"ticker": "FB", "date": "2012-05-18"},
    ])
    first = d5r.run_d5_rename_producer(dry_run=False, db_path=db_path)
    assert first["applied"] == 1

    second = d5r.run_d5_rename_producer(dry_run=False, db_path=db_path)
    assert second["applied"] == 0
    assert len(second["rejected"]) == 1
    assert second["rejected"][0]["old_symbol"] == "FB"

    from api.services.entity_master import store
    conn = store._conn(db_path)
    n = conn.execute("SELECT COUNT(*) FROM entity_events WHERE dedup_key = ?",
                     ("d5-rename:FB:META:2022-06-09",)).fetchone()[0]
    assert n == 1  # never duplicated


# ── MUTATION — the vendor-sourced date is what survives, not today's date ───

def test_MUTATION_transition_date_comes_from_the_vendors_event_not_todays_date(monkeypatch, db_path):
    """The whole point of this checkpoint: a rename carries the VENDOR's
    declared transition date, never the day the job happened to run. Use a
    transition date far from today and assert that exact date survives."""
    _seed(db_path, "FB", valid_from="2012-05-18")
    monkeypatch.setattr(recon, "run_reconciliation",
                         lambda **kw: _fake_recon(creates=["META"], delists=["FB"]))
    monkeypatch.setattr(d5r, "_fetch_ticker_events", lambda t: [
        {"ticker": "META", "date": "2022-06-09"}, {"ticker": "FB", "date": "2012-05-18"},
    ])
    result = d5r.run_d5_rename_producer(dry_run=True, db_path=db_path)
    assert result["confirmed_renames"][0]["transition_date"] == "2022-06-09"
