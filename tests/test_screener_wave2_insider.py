"""Wave 2: insider_capture.py — OpenInsider cluster-buy ratchet + days-since reader.

All DB access goes through a tmp-path `SCREENER_INSIDER_DB_PATH` (never the
shared `/data` root — the repo-root conftest tripwire would fail the run if
it did). `insider_clusters.get_recent_clusters` is monkeypatched on its own
module object so `run_capture()`'s lazy `from api.services import
insider_clusters; insider_clusters.get_recent_clusters(...)` picks it up.

Dates are always relative to `date.today()` — a hardcoded literal date is a
time bomb the day the suite runs on a different calendar day.
"""
import contextlib
from datetime import date, timedelta


def _fresh(monkeypatch, tmp_path):
    db = tmp_path / "screener_insider.db"
    monkeypatch.setenv("SCREENER_INSIDER_DB_PATH", str(db))
    return db


def _ok(*rows):
    """rows: (ticker, trade_date_str, insider_count, value_usd) — the REAL
    insider_clusters.get_recent_clusters() cluster shape (keys `ticker`,
    `trade_date`, `insider_count`, `value_usd`, plus company/qty/filing_date
    that this module doesn't use)."""
    clusters = [
        {"ticker": t, "trade_date": d, "insider_count": n, "value_usd": v,
         "company": "", "qty": None, "filing_date": d}
        for t, d, n, v in rows
    ]
    return {"count": len(clusters), "days_window": 7, "clusters": clusters,
            "elapsed_ms": 5, "source": "openinsider.com"}


def _patch(monkeypatch, fn):
    monkeypatch.setattr(
        "api.services.insider_clusters.get_recent_clusters",
        lambda days=7, count=50: fn())


def test_capture_upsert_ratchets_forward_to_the_newer_trade_date(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import insider_capture as ic

    today = date.today()
    older = (today - timedelta(days=20)).isoformat()
    newer = (today - timedelta(days=5)).isoformat()

    _patch(monkeypatch, lambda: _ok(("ABCD", older, 2, 500000.0)))
    r1 = ic.run_capture()
    assert r1["ok"] is True and r1["upserted"] == 1

    _patch(monkeypatch, lambda: _ok(("ABCD", newer, 5, 1200000.0)))
    r2 = ic.run_capture()
    assert r2["ok"] is True and r2["upserted"] == 1

    fields = ic.read_insider_fields(["ABCD"])
    assert fields["ABCD"]["insider_cluster_days"] == 5

    with contextlib.closing(ic._connect()) as conn:
        row = conn.execute(
            "SELECT last_trade_date, insiders, value_usd FROM cluster_latest "
            "WHERE ticker=?", ("ABCD",)).fetchone()
    assert row["last_trade_date"] == newer
    assert row["insiders"] == 5
    assert row["value_usd"] == 1200000.0


def test_capture_upsert_never_regresses_to_an_older_trade_date(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import insider_capture as ic

    today = date.today()
    newer = (today - timedelta(days=5)).isoformat()
    older = (today - timedelta(days=20)).isoformat()

    _patch(monkeypatch, lambda: _ok(("WXYZ", newer, 4, 900000.0)))
    ic.run_capture()

    # A stale/older print arrives on a later run (e.g. a re-scrape) — must
    # not push the stored date, insider count, or value backwards.
    _patch(monkeypatch, lambda: _ok(("WXYZ", older, 1, 100000.0)))
    r2 = ic.run_capture()
    assert r2["ok"] is True and r2["upserted"] == 1  # still "seen", row untouched

    with contextlib.closing(ic._connect()) as conn:
        row = conn.execute(
            "SELECT last_trade_date, insiders, value_usd FROM cluster_latest "
            "WHERE ticker=?", ("WXYZ",)).fetchone()
    assert row["last_trade_date"] == newer
    assert row["insiders"] == 4
    assert row["value_usd"] == 900000.0


def test_scrape_error_leaves_the_store_completely_untouched(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import insider_capture as ic

    today = date.today()
    good_date = (today - timedelta(days=3)).isoformat()

    _patch(monkeypatch, lambda: _ok(("GOOD", good_date, 3, 300000.0)))
    r1 = ic.run_capture()
    assert r1["ok"] is True and r1["upserted"] == 1

    _patch(monkeypatch, lambda: {
        "error": "openinsider fetch failed: timeout", "clusters": [], "count": 0})
    r2 = ic.run_capture()
    assert r2["ok"] is False
    assert r2["error"]
    assert r2["upserted"] == 0

    with contextlib.closing(ic._connect()) as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT ticker, last_trade_date FROM cluster_latest")]
    assert [r["ticker"] for r in rows] == ["GOOD"]
    assert rows[0]["last_trade_date"] == good_date


def test_days_since_boundary_90_in_91_out(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import insider_capture as ic

    today = date.today()
    d90 = (today - timedelta(days=90)).isoformat()
    d91 = (today - timedelta(days=91)).isoformat()

    _patch(monkeypatch, lambda: _ok(("IN90", d90, 2, 400000.0),
                                     ("OUT91", d91, 2, 400000.0)))
    r = ic.run_capture()
    assert r["upserted"] == 2

    fields = ic.read_insider_fields(["IN90", "OUT91"])
    assert fields["IN90"]["insider_cluster_days"] == 90
    assert "insider_cluster_days" not in fields["OUT91"]
    assert fields["OUT91"] == {}


def test_reader_absent_key_for_a_never_clustered_ticker(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import insider_capture as ic

    today = date.today()
    _patch(monkeypatch, lambda: _ok(("HASONE", today.isoformat(), 2, 400000.0)))
    ic.run_capture()

    fields = ic.read_insider_fields(["HASONE", "NEVER"])
    assert fields["HASONE"]["insider_cluster_days"] == 0
    assert fields["NEVER"] == {}
    assert "insider_cluster_days" not in fields["NEVER"]


def test_unparseable_trade_date_is_skipped_and_counted_not_written(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import insider_capture as ic

    today = date.today()
    _patch(monkeypatch, lambda: _ok(("BAD", "not-a-date", 1, 1.0),
                                     ("ALSOBAD", "", 1, 1.0),
                                     ("OK", today.isoformat(), 1, 1.0)))
    r = ic.run_capture()
    assert r["ok"] is True
    assert r["upserted"] == 1
    assert r["skipped"] == 2

    fields = ic.read_insider_fields(["BAD", "ALSOBAD", "OK"])
    assert fields["BAD"] == {}
    assert fields["ALSOBAD"] == {}
    assert fields["OK"]["insider_cluster_days"] == 0


def test_empty_cluster_list_is_a_clean_no_op_receipt(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import insider_capture as ic

    _patch(monkeypatch, lambda: _ok())
    r = ic.run_capture()
    assert r["ok"] is True
    assert r["seen"] == 0
    assert r["upserted"] == 0
    assert r["skipped"] == 0
