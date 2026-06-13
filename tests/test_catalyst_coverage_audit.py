"""Tests for the nightly catalyst coverage self-audit — classifies the day's
biggest movers vs what the tile surfaced (ranked/scored_hidden/excluded/missed).
"""
import pytest

from api.services.catalyst import coverage_audit


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(coverage_audit, "_DB_PATH", str(tmp_path / "cat.db"))
    monkeypatch.setattr(coverage_audit, "_INIT_DONE", False)


def test_run_audit_buckets_movers(monkeypatch):
    movers = [
        {"ticker": "AAA", "gap_pct": 12.0, "dollar_vol": 1e9},  # ranked
        {"ticker": "BBB", "gap_pct": 10.0, "dollar_vol": 5e8},  # scored, no rank
        {"ticker": "CCC", "gap_pct": 9.0, "dollar_vol": 2e8},   # excluded (gate)
        {"ticker": "DDD", "gap_pct": 8.0, "dollar_vol": 1e8},   # missed
    ]
    monkeypatch.setattr(coverage_audit, "_biggest_movers",
                        lambda *a, **k: movers)

    from api.services.catalyst import store
    monkeypatch.setattr(store, "get_for_date", lambda md, ranked_only=False: [
        {"ticker": "AAA", "rank": 1},
        {"ticker": "BBB", "rank": None},
    ])
    from api.services.catalyst import engine
    monkeypatch.setattr(engine, "get_exclusion_reason",
                        lambda md, t: "price below floor" if t == "CCC" else None)

    report = coverage_audit.run_audit("2026-06-12")
    assert report["counts"] == {"ranked": 1, "scored_hidden": 1,
                                "excluded": 1, "missed": 1}
    assert report["buckets"]["ranked"][0]["ticker"] == "AAA"
    assert report["buckets"]["excluded"][0]["reason"] == "price below floor"
    assert report["buckets"]["missed"][0]["ticker"] == "DDD"


def test_audit_persists_and_reads_back(monkeypatch):
    monkeypatch.setattr(coverage_audit, "_biggest_movers",
                        lambda *a, **k: [{"ticker": "AAA", "gap_pct": 9.0,
                                          "dollar_vol": 1e9}])
    from api.services.catalyst import store, engine
    monkeypatch.setattr(store, "get_for_date", lambda md, ranked_only=False: [])
    monkeypatch.setattr(engine, "get_exclusion_reason", lambda md, t: None)

    coverage_audit.run_audit("2026-06-12")
    got = coverage_audit.get_audit("2026-06-12")
    assert got is not None
    assert got["counts"]["missed"] == 1
    assert coverage_audit.get_audit("2026-06-11") is None


def test_run_audit_never_raises(monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("snapshot down")
    monkeypatch.setattr(coverage_audit, "_biggest_movers", _boom)
    report = coverage_audit.run_audit("2026-06-12")
    assert "error" in report
