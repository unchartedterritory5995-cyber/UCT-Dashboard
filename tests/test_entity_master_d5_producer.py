"""D5 CHECKPOINT 5 — source='d5' for delisted + new_entity.

Every fixture is synthetic (monkeypatched `massive.list_reference_tickers`);
no network call. Mirrors `entity_master/test_reconciliation.py`'s fixture
shape so the two producers are tested the same way.
"""
import ast
import inspect

import pytest

from api.services import entity_master_d5_producer as d5p
from api.services.entity_master import api as em_api
from api.services.entity_master import reconciliation as recon
from api.services.entity_master import schema


@pytest.fixture
def db_path(tmp_path):
    p = str(tmp_path / "d5_producer_test.db")
    schema.init_db(db_path=p)
    return p


def _patch_live(monkeypatch, *, stocks=()):
    import api.services.massive as massive

    def _fake(active=True, market="stocks", limit=1000, max_pages=60):
        rows = list(stocks)
        if not active:
            return [r for r in rows if r.get("delisted_utc")]
        return [r for r in rows if not r.get("delisted_utc")] if market == "stocks" else []

    monkeypatch.setattr(massive, "list_reference_tickers", _fake)


def _seed(db_path, alias, valid_from="2020-01-01", entity_type="equity"):
    r = em_api.apply_event(
        "new_entity", {"entity_type": entity_type, "initial_alias": alias,
                       "initial_alias_valid_from": valid_from},
        dedup_key=f"seed:{alias}", source="admin_manual", db_path=db_path,
    )
    assert r.accepted
    return r.entity_id


# ── the inert-strand precondition itself ──────────────────────────────────────

def test_no_file_under_entity_master_imports_this_producer_back():
    """The packet's own inert-strand ruling for CP5: 'no [risk], PROVIDED the
    producer is a new module that adds no import to entity_master/**'. This
    is the other half of that sentence -- entity_master/** must not import
    THIS module either, or flow-worker's existing reachability of that
    package would gain a new edge into this module's own massive.py call."""
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
            assert not any("entity_master_d5_producer" in n for n in names), (
                f"{py_file.name} imports the D5 producer back -- this would give "
                f"flow-worker (which RUNS entity_master/**) a new edge into "
                f"entity_master_d5_producer.py's own network call")


def test_this_producer_never_imports_delisted_registry():
    """Same Checkpoint-7 guarantee reconciliation.py carries: structurally
    immune to stale delisted_registry data because it is never in this
    module's input set at all."""
    src = inspect.getsource(d5p)
    tree = ast.parse(src)
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
            names.update(a.name for a in node.names)
    assert not any("delisted_registry" in n for n in names), names


# ── new_entity — grounded in the vendor's own list_date ───────────────────────

def test_proposes_new_entity_for_an_unknown_ticker_with_a_list_date(monkeypatch, db_path):
    _patch_live(monkeypatch, stocks=[
        {"ticker": "NEWCO", "type": "CS", "list_date": "2026-08-01"},
    ])
    result = d5p.run_d5_producer(dry_run=True, db_path=db_path,
                                  compare_to_reconciliation=False)
    assert result["proposed_creates"] == [{
        "symbol": "NEWCO", "entity_type": "equity", "list_date": "2026-08-01",
        "cik": None, "composite_figi": None,
    }]


def test_skips_new_entity_when_the_symbol_is_already_known(monkeypatch, db_path):
    _seed(db_path, "AAPL")
    _patch_live(monkeypatch, stocks=[
        {"ticker": "AAPL", "type": "CS", "list_date": "1980-12-12"},
    ])
    result = d5p.run_d5_producer(dry_run=True, db_path=db_path,
                                  compare_to_reconciliation=False)
    assert result["proposed_creates"] == []


def test_skips_a_row_with_no_list_date(monkeypatch, db_path):
    _patch_live(monkeypatch, stocks=[{"ticker": "NODATE", "type": "CS"}])
    result = d5p.run_d5_producer(dry_run=True, db_path=db_path,
                                  compare_to_reconciliation=False)
    assert result["proposed_creates"] == []


# ── delisted — grounded in the vendor's own delisted_utc ──────────────────────

def test_proposes_delisted_for_an_active_entity_the_vendor_declares_delisted(
        monkeypatch, db_path):
    _seed(db_path, "GONE")
    _patch_live(monkeypatch, stocks=[
        {"ticker": "GONE", "type": "CS", "delisted_utc": "2026-07-15T00:00:00Z"},
    ])
    result = d5p.run_d5_producer(dry_run=True, db_path=db_path,
                                  compare_to_reconciliation=False)
    assert len(result["proposed_delists"]) == 1
    d = result["proposed_delists"][0]
    assert d["symbol"] == "GONE"
    assert d["lifecycle_since"] == "2026-07-15"


def test_never_proposes_delisted_for_an_unknown_symbol(monkeypatch, db_path):
    _patch_live(monkeypatch, stocks=[
        {"ticker": "NEVERSEEN", "type": "CS", "delisted_utc": "2026-07-15T00:00:00Z"},
    ])
    result = d5p.run_d5_producer(dry_run=True, db_path=db_path,
                                  compare_to_reconciliation=False)
    assert result["proposed_delists"] == []


def test_never_re_proposes_delisted_for_an_already_delisted_entity(monkeypatch, db_path):
    entity_id = _seed(db_path, "TWICE")
    r = em_api.apply_event("delisted", {"entity_id": entity_id, "lifecycle_since": "2026-01-01"},
                            dedup_key="seed:delist:TWICE", source="admin_manual", db_path=db_path)
    assert r.accepted
    _patch_live(monkeypatch, stocks=[
        {"ticker": "TWICE", "type": "CS", "delisted_utc": "2026-07-15T00:00:00Z"},
    ])
    result = d5p.run_d5_producer(dry_run=True, db_path=db_path,
                                  compare_to_reconciliation=False)
    assert result["proposed_delists"] == []


# ── dry_run contract + apply path ─────────────────────────────────────────────

def test_dry_run_true_never_calls_apply_event(monkeypatch, db_path):
    calls = []
    monkeypatch.setattr(em_api, "apply_event",
                         lambda *a, **k: calls.append((a, k)))
    _patch_live(monkeypatch, stocks=[
        {"ticker": "NEWCO", "type": "CS", "list_date": "2026-08-01"},
    ])
    d5p.run_d5_producer(dry_run=True, db_path=db_path, compare_to_reconciliation=False)
    assert calls == []


def test_dry_run_false_applies_with_source_d5(monkeypatch, db_path):
    _patch_live(monkeypatch, stocks=[
        {"ticker": "NEWCO", "type": "CS", "list_date": "2026-08-01"},
    ])
    result = d5p.run_d5_producer(dry_run=False, db_path=db_path,
                                  compare_to_reconciliation=False)
    assert result["created"] == 1
    resolved = em_api.resolve("NEWCO", db_path=db_path)
    assert resolved.status == "resolved"

    # MUTATION-relevant: the event actually recorded source='d5', not
    # reconciliation's 'source=reconciliation' or the caller's default.
    from api.services.entity_master import store
    conn = store._conn(db_path)
    row = conn.execute("SELECT source FROM entity_events WHERE dedup_key = ?",
                       (f"d5:new_entity:NEWCO:2026-08-01",)).fetchone()
    assert row is not None and row[0] == "d5"


def test_apply_is_idempotent_on_a_second_run(monkeypatch, db_path):
    _patch_live(monkeypatch, stocks=[
        {"ticker": "NEWCO", "type": "CS", "list_date": "2026-08-01"},
    ])
    first = d5p.run_d5_producer(dry_run=False, db_path=db_path,
                                 compare_to_reconciliation=False)
    assert first["created"] == 1
    # second run: NEWCO now resolves, so it is no longer proposed at all
    second = d5p.run_d5_producer(dry_run=False, db_path=db_path,
                                  compare_to_reconciliation=False)
    assert second["proposed_creates"] == []
    assert second["created"] == 0


# ── the comparison against the interim job ────────────────────────────────────

def test_comparison_names_agreement_and_each_producer_only_set(monkeypatch, db_path):
    """D5 sees NEWCO (has a list_date) and GONE (has delisted_utc + an
    existing entity). Reconciliation sees NEWCO too (absent from its own
    open-alias set) but NOT GONE, because GONE never had a seeded alias in
    THIS fixture's open-alias view -- proving the comparison actually reads
    two independently-computed sets, not one list labelled twice."""
    _seed(db_path, "GONE")
    _patch_live(monkeypatch, stocks=[
        {"ticker": "NEWCO", "type": "CS", "list_date": "2026-08-01"},
        {"ticker": "GONE", "type": "CS", "delisted_utc": "2026-07-15T00:00:00Z"},
    ])
    result = d5p.run_d5_producer(dry_run=True, db_path=db_path,
                                  compare_to_reconciliation=True)
    cmp = result["comparison"]
    assert cmp["creates_agree"] == ["NEWCO"], cmp
    assert cmp["creates_d5_only"] == []
    assert cmp["creates_reconciliation_only"] == []
    assert cmp["delists_agree"] == ["GONE"], cmp


# ── MUTATION — the confirmed-date grounding this checkpoint exists for ───────

def test_MUTATION_lifecycle_since_comes_from_the_vendors_delisted_utc_not_todays_date(
        monkeypatch, db_path):
    """The whole point of D5 over reconciliation.py: a delisting carries the
    VENDOR's declared date, never the day the job happened to run. Use a
    delisted_utc far from today and assert that exact date survives into the
    proposal untouched -- reverting `_dual_compute`-style back to `_today()`
    (as reconciliation.py's own proposal does) would fail this immediately."""
    eid = _seed(db_path, "OLD")
    _patch_live(monkeypatch, stocks=[
        {"ticker": "OLD", "type": "CS", "delisted_utc": "2019-03-04T00:00:00Z"},
    ])
    result = d5p.run_d5_producer(dry_run=True, db_path=db_path,
                                  compare_to_reconciliation=False)
    assert result["proposed_delists"] == [
        {"symbol": "OLD", "entity_id": eid, "lifecycle_since": "2019-03-04"}
    ]
