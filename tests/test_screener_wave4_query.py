"""Wave 4: the scan filter branch. Every case seeds its own store state
(SCAN_SWEEP_ENABLED is 0 locally -- there is no live sweep to lean on)."""
import importlib

import pytest


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    from api.services.screener import snapshot_db, scan_store, query
    importlib.reload(snapshot_db)
    importlib.reload(scan_store)
    importlib.reload(query)
    snapshot_db.init_db()
    import contextlib
    with contextlib.closing(snapshot_db.connect()) as conn:
        for t, px in (("NVDA", 100.0), ("AMD", 50.0), ("TSLA", 200.0)):
            conn.execute(
                "INSERT INTO screener_rows (ticker, price, snapshot_date, built_at) "
                "VALUES (?,?,?,?)", (t, px, "2026-08-20", 1))
        conn.commit()
    return snapshot_db, scan_store, query


H1 = "sha256:" + "a" * 64
H2 = "sha256:" + "b" * 64


def _sweep(scan_store, h, day, hits):
    scan_store.record_hits(h, "D", day, hits)
    scan_store.record_coverage(h, "D", day, evaluated=3, answered=3,
                               dropped=0, not_computable=0, dropped_symbols=[])


def test_scan_filter_intersects_at_the_hashes_latest_coverage(env):
    _, scan_store, query = env
    _sweep(scan_store, H1, 20260818, ["NVDA", "AMD", "TSLA"])
    _sweep(scan_store, H1, 20260820, ["NVDA"])          # latest wins
    out = query.run_scan({"filters": [{"key": "scan", "op": "in", "value": H1}]})
    assert [r["ticker"] for r in out["rows"]] == ["NVDA"]
    assert out["total"] == 1                              # describe_rows saw the SAME where
    assert out["scan_joins"] == [{"def_hash": H1, "as_of": 20260820, "applied": True}]


def test_two_hashes_AND_each_at_its_own_latest(env):
    _, scan_store, query = env
    _sweep(scan_store, H1, 20260820, ["NVDA", "AMD"])
    _sweep(scan_store, H2, 20260819, ["NVDA", "TSLA"])   # divergent latest is NORMAL
    out = query.run_scan({"filters": [
        {"key": "scan", "op": "in", "value": [H1, H2]}]})
    assert [r["ticker"] for r in out["rows"]] == ["NVDA"]
    joins = {j["def_hash"]: j for j in out["scan_joins"]}
    assert joins[H1]["as_of"] == 20260820 and joins[H2]["as_of"] == 20260819


def test_hand_crafted_duplicate_hash_dedupes_to_one_clause_one_join(env):
    _, scan_store, query = env
    _sweep(scan_store, H1, 20260820, ["NVDA"])
    # A hand-crafted ["H1", "H1"] must collapse to ONE clause and ONE
    # scan_joins entry, applied once -- the UI guards via includes() but the
    # server must not trust that.
    where, params = query.build_where([{"key": "scan", "op": "in", "value": [H1, H1]}])
    assert where.count("EXISTS") == 1
    assert params == [H1, "D", 20260820]
    out = query.run_scan({"filters": [{"key": "scan", "op": "in", "value": [H1, H1]}]})
    assert [r["ticker"] for r in out["rows"]] == ["NVDA"]
    assert out["scan_joins"] == [{"def_hash": H1, "as_of": 20260820, "applied": True}]


def test_never_swept_hash_is_INERT_and_disclosed_not_a_silent_universe(env):
    _, scan_store, query = env
    _sweep(scan_store, H1, 20260820, ["NVDA"])
    out = query.run_scan({"filters": [
        {"key": "scan", "op": "in", "value": [H1, H2]}]})
    # H2 has no coverage row: its clause is OMITTED (H1 still filters) and the
    # omission is REPORTED -- the client labels "first sweep tonight" from this.
    assert [r["ticker"] for r in out["rows"]] == ["NVDA"]
    joins = {j["def_hash"]: j for j in out["scan_joins"]}
    assert joins[H2] == {"def_hash": H2, "as_of": None, "applied": False}


def test_empty_or_malformed_value_REFUSES_never_the_silent_noop(env):
    _, _, query = env
    for bad in (None, "", [], [""], [None], 7, [7]):
        with pytest.raises(ValueError):
            query.run_scan({"filters": [{"key": "scan", "op": "in", "value": bad}]})


def test_scan_op_other_than_in_refused(env):
    _, _, query = env
    with pytest.raises(ValueError):
        query.run_scan({"filters": [{"key": "scan", "op": "eq", "value": H1}]})


def test_no_scan_filter_means_empty_scan_joins_and_untouched_behavior(env):
    _, _, query = env
    out = query.run_scan({"filters": [{"key": "price", "op": "gte", "min": 60}]})
    assert out["scan_joins"] == []
    assert sorted(r["ticker"] for r in out["rows"]) == ["NVDA", "TSLA"]


def test_unknown_keys_still_refuse(env):
    _, _, query = env
    with pytest.raises(ValueError):
        query.run_scan({"filters": [{"key": "not_a_key", "op": "eq", "value": 1}]})


def test_the_fragment_is_the_stores_never_restated(env):
    # Derive, never restate: query.py contains no scan_hits SQL of its own.
    import inspect
    from api.services.screener import query
    src = inspect.getsource(query)
    assert "scan_hits" not in src
