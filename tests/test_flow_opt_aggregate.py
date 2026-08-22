"""api.flow_opt_aggregate.run_aggregate() — the nightly per-ticker options
aggregate (screener Wave 5, Task A4).

Every test seeds a tmp flow.db DIRECTLY via `FlowDB` (never the real
`/data/flow.db` — `FLOW_DB_PATH` is monkeypatched to a tmp path before
`run_aggregate()` is called) and monkeypatches `data_sync.put_bytes` so no
test ever attempts a real network call.
"""
import json
import os
import tempfile
from datetime import date

import pytest

from api.flow_db import FlowDB
from api.flow_summary import compute_top_conviction

FLOW_COLUMNS = [
    "source", "CreatedDate", "CreatedTime", "Symbol", "Type", "Volume", "Price",
    "Side", "CallPut", "Strike", "Spot", "Premium", "ExpirationDate",
    "Color", "ImpliedVolatility", "Dte", "ER", "StockEtf", "Sector",
    "Uoa", "Weekly", "MktCap", "OI",
]


def _row(**kw):
    """Build a flow.db-shaped (ALL-TEXT) row, mirroring test_flow_summary.py's
    `_row()` fixture plus the CreatedDate/source columns this module reads."""
    base = {
        "source": "stocks", "CreatedDate": "8/20/2026", "CreatedTime": "10:00:00",
        "Symbol": "AAA", "Type": "SWEEP", "Volume": "100", "Price": "1.00",
        "Side": "A", "CallPut": "CALL", "Strike": "100", "Spot": "100",
        "Premium": "1000000", "ExpirationDate": "9/18/2026", "Color": "YELLOW",
        "ImpliedVolatility": "", "Dte": "29", "ER": "F", "StockEtf": "stock",
        "Sector": "Tech", "Uoa": "", "Weekly": "", "MktCap": "5000000000", "OI": "",
    }
    base.update(kw)
    return base


def _seed(db, rows):
    cols = FLOW_COLUMNS
    placeholders = ",".join("?" for _ in cols)
    with db._conn() as conn:
        conn.executemany(
            f"INSERT INTO flow ({','.join(cols)}) VALUES ({placeholders})",
            [[r.get(c, "") for c in cols] for r in rows],
        )


@pytest.fixture
def flow_db(monkeypatch):
    fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.unlink(db_path)
    db = FlowDB(db_path)  # creates the flow table + indexes
    monkeypatch.setenv("FLOW_DB_PATH", db_path)

    art_fd, art_path = tempfile.mkstemp(suffix=".json")
    os.close(art_fd)
    os.unlink(art_path)
    monkeypatch.setenv("FLOW_OPT_AGG_ARTIFACT", art_path)

    yield db, art_path

    for p in (db_path, db_path + "-wal", db_path + "-shm", art_path):
        try:
            os.unlink(p)
        except OSError:
            pass


def _run(monkeypatch, r2_ok=True):
    monkeypatch.setattr("api.services.data_sync.put_bytes",
                        lambda *a, **k: r2_ok)
    from api import flow_opt_aggregate
    return flow_opt_aggregate.run_aggregate()


# ── (1) direction table ──────────────────────────────────────────────────

def test_direction_table_matches_call_put_side(flow_db, monkeypatch):
    db, _ = flow_db
    _seed(db, [
        _row(Symbol="CA", CallPut="CALL", Side="A", Premium="1000000"),
        _row(Symbol="PA", CallPut="PUT", Side="A", Premium="1000000"),
        _row(Symbol="CBB", CallPut="CALL", Side="BB", Type="SWEEP", Premium="1000000"),
        _row(Symbol="PBB", CallPut="PUT", Side="BB", Type="SWEEP", Premium="1000000"),
    ])
    receipt = _run(monkeypatch)
    rows = receipt["rows"]
    assert rows["CA"]["opt_net_premium_1d"] > 0   # Call + Ask -> bull
    assert rows["PA"]["opt_net_premium_1d"] < 0   # Put + Ask -> bear
    assert rows["CBB"]["opt_net_premium_1d"] < 0  # Call + below-bid sweep -> bear
    assert rows["PBB"]["opt_net_premium_1d"] > 0  # Put + below-bid sweep -> bull


def test_net_premium_is_bull_minus_bear(flow_db, monkeypatch):
    db, _ = flow_db
    _seed(db, [
        _row(Symbol="MIX", CallPut="CALL", Side="A", Premium="3000000"),
        _row(Symbol="MIX", CallPut="PUT", Side="A", Premium="1000000"),
    ])
    receipt = _run(monkeypatch)
    row = receipt["rows"]["MIX"]
    assert row["opt_net_premium_1d"] == 2_000_000
    assert row["opt_bull_pct_1d"] == 75
    assert row["opt_net_premium_5d"] == 2_000_000


# ── (2) blank-Side honesty (K3) ──────────────────────────────────────────

def test_blank_side_excluded_from_numerator_and_denominator(flow_db, monkeypatch):
    db, _ = flow_db
    _seed(db, [
        _row(Symbol="BLANK", CallPut="CALL", Side="", Premium="5000000"),
        _row(Symbol="BLANK", CallPut="CALL", Side="A", Premium="1000000"),
    ])
    receipt = _run(monkeypatch)
    row = receipt["rows"]["BLANK"]
    assert row["opt_net_premium_1d"] == 1_000_000
    assert row["opt_bull_pct_1d"] == 100
    assert receipt["census"]["rows_classified"] == 1


# ── (3) ML/-type + RED-color dropped ─────────────────────────────────────

def test_ml_type_and_red_color_dropped(flow_db, monkeypatch):
    db, _ = flow_db
    _seed(db, [
        _row(Symbol="MLX", Type="ML/", Premium="9000000"),
        _row(Symbol="REDX", Color="#FF0000", Premium="9000000"),
    ])
    receipt = _run(monkeypatch)
    assert "MLX" not in receipt["rows"]
    assert "REDX" not in receipt["rows"]


# ── (4) K1 — newest PARSED date, not lexicographic ───────────────────────

def test_1d_uses_newest_parsed_date_not_lexicographic(flow_db, monkeypatch):
    db, _ = flow_db
    _seed(db, [
        _row(Symbol="OLD", CreatedDate="9/9/2026", CallPut="CALL", Side="A",
             Premium="1000000"),
        _row(Symbol="NEW", CreatedDate="10/1/2026", CallPut="CALL", Side="A",
             Premium="2000000"),
    ])
    receipt = _run(monkeypatch)
    # "9/9/2026" > "10/1/2026" lexicographically, but October is the newer
    # calendar date -- as_of must reflect the PARSED newest date.
    assert receipt["as_of"] == "2026-10-01"
    assert "opt_net_premium_1d" in receipt["rows"]["NEW"]
    assert "opt_net_premium_1d" not in receipt["rows"].get("OLD", {})
    # OLD is still within the (only 2-date) 5d window.
    assert receipt["rows"]["OLD"]["opt_net_premium_5d"] == 1_000_000


# ── (5) 5d spans exactly the 5 newest dates ──────────────────────────────

def test_5d_window_spans_only_5_newest_dates(flow_db, monkeypatch):
    db, _ = flow_db
    dates = ["1/1/2026", "1/2/2026", "1/3/2026", "1/4/2026", "1/5/2026",
             "1/6/2026", "1/7/2026"]
    rows = [
        _row(Symbol=f"D{i}", CreatedDate=d, CallPut="CALL", Side="A",
             Premium="1000000")
        for i, d in enumerate(dates)
    ]
    _seed(db, rows)
    receipt = _run(monkeypatch)
    assert receipt["days"] == ["2026-01-07", "2026-01-06", "2026-01-05",
                               "2026-01-04", "2026-01-03"]
    assert "D0" not in receipt["rows"]  # 1/1 -- outside the 5 newest
    assert "D1" not in receipt["rows"]  # 1/2 -- outside the 5 newest
    assert "D2" in receipt["rows"]      # 1/3 -- within the 5 newest
    assert "D6" in receipt["rows"]      # 1/7 -- the newest


# ── (6) source='indexes' invisible ───────────────────────────────────────

def test_indexes_source_invisible(flow_db, monkeypatch):
    db, _ = flow_db
    _seed(db, [
        _row(Symbol="SPY", source="indexes", CallPut="CALL", Side="A",
             Premium="9000000"),
        _row(Symbol="AAPL", source="stocks", CallPut="CALL", Side="A",
             Premium="1000000"),
    ])
    receipt = _run(monkeypatch)
    assert "SPY" not in receipt["rows"]
    assert "AAPL" in receipt["rows"]
    assert receipt["census"]["rows_scanned"] == 1


# ── (7) receipt census arithmetic ────────────────────────────────────────

def test_receipt_census_arithmetic(flow_db, monkeypatch):
    db, _ = flow_db
    _seed(db, [
        _row(Symbol="A1", CallPut="CALL", Side="A", Premium="1000000"),
        _row(Symbol="A2", CallPut="PUT", Side="A", Premium="1000000"),
        _row(Symbol="A3", Type="ML/", Premium="9000000"),        # dropped
        _row(Symbol="A4", Color="#FF0000", Premium="9000000"),   # dropped
    ])
    receipt = _run(monkeypatch)
    assert receipt["census"]["rows_scanned"] == 4
    assert receipt["census"]["rows_classified"] == 2
    assert receipt["census"]["tickers"] == 2


# ── (8) artifact round-trips with as_of + all three keys per ticker ──────

def test_artifact_round_trips_with_all_three_keys(flow_db, monkeypatch):
    db, art_path = flow_db
    _seed(db, [_row(Symbol="RT", CallPut="CALL", Side="A", Premium="1000000")])
    receipt = _run(monkeypatch)
    with open(art_path, "r", encoding="utf-8") as fh:
        on_disk = json.load(fh)
    assert on_disk["as_of"] == receipt["as_of"] == "2026-08-20"
    rt = on_disk["rows"]["RT"]
    assert set(rt.keys()) == {"opt_net_premium_1d", "opt_bull_pct_1d",
                              "opt_net_premium_5d"}


# ── (9) R2 failure never raises; local mirror still written ─────────────

def test_r2_failure_still_writes_local_mirror(flow_db, monkeypatch):
    db, art_path = flow_db
    _seed(db, [_row(Symbol="X", CallPut="CALL", Side="A", Premium="1000000")])
    receipt = _run(monkeypatch, r2_ok=False)
    assert receipt["r2"] == "failed"
    assert os.path.exists(art_path)
    with open(art_path, "r", encoding="utf-8") as fh:
        on_disk = json.load(fh)
    assert on_disk["rows"]["X"]["opt_net_premium_1d"] == 1_000_000


# ── (10) MANDATORY agreement test vs compute_top_conviction ──────────────

def test_agrees_with_compute_top_conviction(flow_db, monkeypatch):
    """This module's direction/drop rules are a TRANSCRIPTION of
    api.flow_summary.compute_top_conviction (see api/flow_opt_aggregate.py's
    module docstring for why an import-and-share was not possible: K8, that
    module is not in the flow-worker's watch paths). This test is what keeps
    the transcription honest: the same fixture rows must agree, per ticker,
    on net-premium SIGN and bull %.
    """
    db, _ = flow_db
    fixture_rows = [
        _row(Symbol="AAA", CallPut="CALL", Side="A", Premium="3000000",
             Strike="100", Spot="100", MktCap="5000000000"),
        _row(Symbol="AAA", CallPut="PUT", Side="A", Premium="1000000",
             Strike="100", Spot="100", MktCap="5000000000"),
        _row(Symbol="BBB", CallPut="CALL", Side="BB", Type="SWEEP",
             Premium="2000000", Strike="100", Spot="100", MktCap="5000000000"),
    ]
    _seed(db, fixture_rows)

    today = date(2026, 8, 20)  # matches the fixture rows' default CreatedDate
    board = {i["sym"]: i for i in compute_top_conviction(fixture_rows, today=today)}

    receipt = _run(monkeypatch)

    assert set(board.keys()) == set(receipt["rows"].keys())
    for sym, item in board.items():
        signed = item["netPremium"] if item["dir"] == "BULL" else -item["netPremium"]
        agg_row = receipt["rows"][sym]
        assert (agg_row["opt_net_premium_1d"] >= 0) == (signed >= 0), sym
        assert agg_row["opt_bull_pct_1d"] == item["bullPct"], sym
