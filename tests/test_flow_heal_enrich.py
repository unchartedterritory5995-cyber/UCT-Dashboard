"""Tests for api/flow_heal_enrich.py — the T+1 heal classification pipeline.

Covers the spec's failure mode (autoheal_classification_spec.md): healed rows
landing 0% sided / OI=0 / wrong colors, and the ordering requirement that OI
must land before color.
"""
import gzip
import json
import os
import sqlite3
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd
import pytest

from api import flow_heal_enrich as fhe


UTC = timezone.utc


def _ns(y, mo, d, h, mi, s):
    return int(datetime(y, mo, d, h, mi, s, tzinfo=UTC).timestamp() * 1e9)


# ── Tick test ─────────────────────────────────────────────────────────────

def _run_contract(prints):
    """prints: list of (ts_ns, price, size, condition). Returns (patches, stats)."""
    patches, stats = {}, {"events": 0, "sided": 0}
    fhe._tick_test_contract(
        "O:TST260821C00050000",
        np.array([p[0] for p in prints], dtype=np.int64),
        np.array([p[1] for p in prints], dtype=np.float64),
        np.array([p[2] for p in prints], dtype=np.int64),
        np.array([p[3] for p in prints], dtype=np.int32),
        patches, stats)
    return patches, stats


def test_tick_test_sides():
    t0 = _ns(2026, 7, 14, 13, 41, 0)  # 9:41:00 AM ET (EDT)
    sec = 1_000_000_000
    prints = [
        (t0 + 0 * sec, 1.00, 100, 0),   # k=0: no prior print → side '' (not emitted)
        (t0 + 1 * sec, 1.02, 100, 0),   # +2.0% vs 1.00 → A
        (t0 + 2 * sec, 1.10, 100, 219), # +7.8% vs 1.02 → AA (SWEEP)
        (t0 + 3 * sec, 1.00, 100, 0),   # -9.1% vs 1.10 → BB
    ]
    patches, stats = _run_contract(prints)
    assert stats["events"] == 4
    sides = {k.rsplit("|", 1)[-1]: v["side"] for k, v in patches.items()}
    assert sides == {"9:41:01 AM": "A", "9:41:02 AM": "AA", "9:41:03 AM": "BB"}
    # Patches are side-only by design — must NOT carry a color/OI payload
    # that could fight the snapshot-sourced OI (spec 3a note).
    for v in patches.values():
        assert v["color"] == "WHITE" and v["oi"] == 0


def test_tick_test_flat_tick_walkback():
    t0 = _ns(2026, 7, 14, 18, 0, 0)  # 2:00:00 PM ET (EDT)
    sec = 1_000_000_000
    prints = [
        (t0 + 0 * sec, 1.10, 100, 0),
        (t0 + 1 * sec, 1.00, 100, 0),   # BB event (also becomes walkback context)
        (t0 + 2 * sec, 1.001, 100, 0),  # +0.1% vs 1.00 = flat → walk back:
                                        # px[0]=1.10 ≠ 1.00, last_px(1.00) < 1.10 → B
    ]
    patches, _ = _run_contract(prints)
    last_key = [k for k in patches if k.endswith("2:00:02 PM")]
    assert len(last_key) == 1
    assert patches[last_key[0]]["side"] == "B"


def test_tick_test_multileg_and_dust_excluded():
    t0 = _ns(2026, 7, 14, 15, 0, 0)
    sec = 1_000_000_000
    prints = [
        (t0 + 0 * sec, 1.00, 100, 0),
        (t0 + 1 * sec, 1.05, 100, 232),  # multi-leg → no patch
        (t0 + 2 * sec, 1.10, 5, 0),      # premium $550 < $10k → no event
    ]
    patches, stats = _run_contract(prints)
    assert patches == {}
    assert stats["events"] == 2  # ML event counted, dust not


# ── Streaming tape reader ─────────────────────────────────────────────────

def test_build_patches_for_tape(tmp_path):
    t0 = _ns(2026, 7, 14, 13, 41, 0)
    sec = 1_000_000_000
    rows = []
    # Contract 1: cancel row must be dropped BEFORE the tick test
    rows.append(("O:AAA260821C00050000", t0 + 0 * sec, 1.00, 100, 0))
    rows.append(("O:AAA260821C00050000", t0 + 1 * sec, 9.99, 100, 201))  # CANCEL
    rows.append(("O:AAA260821C00050000", t0 + 2 * sec, 1.02, 100, 0))    # A vs 1.00
    # Contract 2 (grouped after, as in the real flat file)
    rows.append(("O:BBB261218P00100000", t0 + 0 * sec, 2.00, 100, 0))
    rows.append(("O:BBB261218P00100000", t0 + 1 * sec, 1.80, 100, 0))    # -10% → BB
    df = pd.DataFrame(rows, columns=["ticker", "sip_timestamp", "price", "size", "conditions"])
    gz_path = tmp_path / "tape.csv.gz"
    with gzip.open(gz_path, "wt", newline="") as f:
        df.to_csv(f, index=False)

    patches, stats = fhe.build_patches_for_tape(str(gz_path))
    assert stats["rows"] == 5
    assert patches == {
        "AAA|CALL|50|8/21/2026|9:41:02 AM": {"side": "A", "color": "WHITE", "oi": 0},
        "BBB|PUT|100|12/18/2026|9:41:01 AM": {"side": "BB", "color": "WHITE", "oi": 0},
    }


# ── OI backfill from dated snapshots ──────────────────────────────────────

_FLOW_SCHEMA = """
CREATE TABLE flow (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT, CreatedDate TEXT, CreatedTime TEXT, Symbol TEXT,
    CallPut TEXT, Strike TEXT, ExpirationDate TEXT,
    Side TEXT, Color TEXT, OI TEXT, Volume TEXT, Premium TEXT,
    created_at TEXT
);
CREATE TABLE contract_oi_snapshots (
    contract_key TEXT NOT NULL, snap_date TEXT NOT NULL,
    oi INTEGER NOT NULL, source TEXT,
    PRIMARY KEY (contract_key, snap_date)
);
"""


@pytest.fixture
def flow_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "flow.db")
    with sqlite3.connect(db_path) as c:
        c.executescript(_FLOW_SCHEMA)
    monkeypatch.setattr(fhe, "DB_PATH", db_path)

    # _backfill_flow_oi + run_patches_backfill reach the DB via FlowDB()
    from api.flow_db import FlowDB

    def _fake_init(self, db_path_arg=None):
        self.db_path = db_path
    monkeypatch.setattr(FlowDB, "__init__", _fake_init)
    return db_path


def _insert_flow(db_path, rows):
    with sqlite3.connect(db_path) as c:
        c.executemany(
            "INSERT INTO flow (source, CreatedDate, CreatedTime, Symbol, CallPut, "
            "Strike, ExpirationDate, Side, Color, OI, Volume, Premium, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)


def test_run_oi_backfill_exact_stale_and_bounds(flow_db):
    mdy = "7/14/2026"
    _insert_flow(flow_db, [
        ("stocks", mdy, "9:41:00 AM", "AAA", "CALL", "50", "8/21/2026",
         "", "WHITE", "0", "100", "10000", "2026-07-15 08:01:00"),
        ("stocks", mdy, "9:42:00 AM", "BBB", "PUT", "100", "12/18/2026",
         "", "WHITE", "0", "100", "10000", "2026-07-15 08:01:00"),
        ("stocks", mdy, "9:43:00 AM", "CCC", "CALL", "25", "8/21/2026",
         "", "WHITE", "0", "100", "10000", "2026-07-15 08:01:00"),
        ("stocks", mdy, "9:44:00 AM", "DDD", "CALL", "10", "8/21/2026",
         "", "WHITE", "0", "100", "10000", "2026-07-15 08:01:00"),
    ])
    with sqlite3.connect(flow_db) as c:
        c.executemany(
            "INSERT INTO contract_oi_snapshots (contract_key, snap_date, oi, source) "
            "VALUES (?,?,?,?)", [
                ("AAA|C|50.0|8/21/2026", "2026-07-14", 500, "schwab"),   # exact
                ("AAA|C|50.0|8/21/2026", "2026-07-10", 400, "schwab"),   # older, ignored
                ("BBB|P|100.0|12/18/2026", "2026-07-10", 300, "schwab"), # stale, in bound
                ("CCC|C|25.0|8/21/2026", "2026-07-01", 200, "schwab"),   # beyond 7d bound
                ("DDD|C|10.0|8/21/2026", "2026-07-15", 900, "schwab"),   # LATER — never used
            ])

    stats = fhe.run_oi_backfill(mdy)
    assert stats["symbols_with_empty_oi"] == 4
    assert stats["exact_date_contracts"] == 1
    assert stats["stale_contracts"] == 1
    assert stats["rows_updated"] == 2

    with sqlite3.connect(flow_db) as c:
        oi = dict(c.execute("SELECT Symbol, OI FROM flow"))
    assert oi["AAA"] == "500"   # exact-date snapshot wins over the older one
    assert oi["BBB"] == "300"   # stale-but-bounded fallback accepted
    assert oi["CCC"] == "0"     # too stale → honestly left at 0
    assert oi["DDD"] == "0"     # a later snapshot is contaminated → never used


def test_run_oi_backfill_never_overwrites(flow_db):
    mdy = "7/14/2026"
    _insert_flow(flow_db, [
        ("stocks", mdy, "9:41:00 AM", "AAA", "CALL", "50", "8/21/2026",
         "A", "MAGENTA", "777", "100", "10000", "2026-07-14 09:41:20"),
    ])
    with sqlite3.connect(flow_db) as c:
        c.execute("INSERT INTO contract_oi_snapshots VALUES (?,?,?,?)",
                  ("AAA|C|50.0|8/21/2026", "2026-07-14", 500, "schwab"))
    stats = fhe.run_oi_backfill(mdy)
    assert stats["symbols_with_empty_oi"] == 0
    with sqlite3.connect(flow_db) as c:
        assert c.execute("SELECT OI FROM flow").fetchone()[0] == "777"


# ── Classification parity ─────────────────────────────────────────────────

def test_parity_flags_inert_heal(flow_db):
    mdy = "7/14/2026"
    live = [("stocks", mdy, "9:40:00 AM", "AAA", "CALL", "50", "8/21/2026",
             "A" if i % 2 == 0 else "", "MAGENTA" if i % 5 == 0 else "WHITE",
             "100" if i % 5 else "0", "100", "10000", "2026-07-14 09:40:00")
            for i in range(600)]
    backfilled = [("stocks", mdy, "10:00:00 AM", "BBB", "PUT", "10", "8/21/2026",
                   "", "WHITE", "0", "100", "10000", "2026-07-15 08:01:00")
                  for _ in range(400)]
    _insert_flow(flow_db, live + backfilled)

    parity = fhe.classification_parity(mdy)
    assert parity["live"]["rows"] == 600
    assert parity["backfilled"]["rows"] == 400
    assert parity["backfilled"]["sided_pct"] == 0.0
    assert parity["baseline"]["source"] == "live-captured"
    assert parity["heal_complete"] is False

    # Enrich the backfilled cohort → parity turns green. use_cache=False is
    # the post-mutation contract (enrich_day recomputes + refreshes the cache);
    # the cached read must still serve the stale value until then.
    with sqlite3.connect(flow_db) as c:
        c.execute("UPDATE flow SET Side='A', OI='50' "
                  "WHERE created_at LIKE '2026-07-15%'")
    assert fhe.classification_parity(mdy)["heal_complete"] is False  # cached
    parity2 = fhe.classification_parity(mdy, use_cache=False)
    assert parity2["heal_complete"] is True


def test_parity_full_session_heal_uses_default_baseline(flow_db):
    mdy = "7/14/2026"
    _insert_flow(flow_db, [
        ("stocks", mdy, "10:00:00 AM", "BBB", "PUT", "10", "8/21/2026",
         "", "WHITE", "0", "100", "10000", "2026-07-15 08:01:00")
        for _ in range(100)])
    parity = fhe.classification_parity(mdy)
    assert parity["baseline"]["source"].startswith("default")
    assert parity["heal_complete"] is False


def test_parity_no_backfilled_rows_is_complete(flow_db):
    mdy = "7/14/2026"
    _insert_flow(flow_db, [
        ("stocks", mdy, "9:40:00 AM", "AAA", "CALL", "50", "8/21/2026",
         "A", "WHITE", "10", "100", "10000", "2026-07-14 09:40:05")])
    parity = fhe.classification_parity(mdy)
    assert parity["heal_complete"] is True


# ── Orchestrator plumbing ─────────────────────────────────────────────────

def test_enrich_day_disabled_gate(monkeypatch):
    monkeypatch.setattr(fhe, "ENABLED", False)
    out = fhe.enrich_day(date(2026, 7, 14))
    assert out["status"] == "disabled"
    assert out["steps"] == {}


def test_enrich_day_end_to_end(flow_db, tmp_path, monkeypatch):
    """Full pipeline on a synthetic healed day: OI → color → side → parity."""
    mdy = "7/14/2026"
    # A backfilled, unclassified row whose contract HAS a dated snapshot and
    # whose volume exceeds it (100 > 60 → YELLOW after rebuild; the single
    # trade is also > OI → MAGENTA per color_rebuild's single-trade rule).
    _insert_flow(flow_db, [
        ("stocks", mdy, "9:41:02 AM", "AAA", "CALL", "50", "8/21/2026",
         "", "WHITE", "0", "100", "10200", "2026-07-15 08:01:00"),
    ])
    with sqlite3.connect(flow_db) as c:
        c.execute("INSERT INTO contract_oi_snapshots VALUES (?,?,?,?)",
                  ("AAA|C|50.0|8/21/2026", "2026-07-14", 60, "schwab"))

    # color_rebuild reads its own module DB_PATH
    from api import color_rebuild
    monkeypatch.setattr(color_rebuild, "DB_PATH", flow_db)

    # Tape: AAA prints ending in an uptick at 9:41:02 ET (matches the row time)
    t0 = _ns(2026, 7, 14, 13, 41, 0)
    sec = 1_000_000_000
    df = pd.DataFrame(
        [("O:AAA260821C00050000", t0, 1.00, 100, 0),
         ("O:AAA260821C00050000", t0 + 2 * sec, 1.02, 100, 0)],
        columns=["ticker", "sip_timestamp", "price", "size", "conditions"])
    gz_path = tmp_path / "tape.csv.gz"
    with gzip.open(gz_path, "wt", newline="") as f:
        df.to_csv(f, index=False)

    out = fhe.enrich_day(date(2026, 7, 14), gz_path=str(gz_path), force=True)

    assert out["steps"]["oi_backfill"]["rows_updated"] == 1
    assert out["steps"]["side_patches"]["side_updated"] == 1
    with sqlite3.connect(flow_db) as c:
        side, color, oi = c.execute(
            "SELECT Side, Color, OI FROM flow").fetchone()
    assert side == "A"
    assert oi == "60"
    assert color in ("MAGENTA", "YELLOW")  # exceeded OI → upgraded, not WHITE
    assert out["parity"]["backfilled"]["rows"] == 1
    assert out["status"] in ("completed", "incomplete")
    assert fhe.last_result() is out


def test_summary_line_smoke():
    line = fhe.summary_line({
        "status": "completed", "target_date": "7/14/2026",
        "steps": {
            "oi_backfill": {"rows_updated": 12000, "exact_date_contracts": 8000,
                            "stale_contracts": 900, "max_stale_days": 7},
            "rebuild_color": {"rows_upgraded_to_magenta": 900,
                              "rows_upgraded_to_yellow": 1200},
            "side_patches": {"side_updated": 14000},
        },
        "parity": {"heal_complete": True,
                   "backfilled": {"rows": 29603, "sided_pct": 43.0, "oi_pos_pct": 78.0},
                   "baseline": {"sided_pct": 46.4, "oi_pos_pct": 83.3}},
    })
    assert "7/14/2026" in line and "OI +12000" in line and "side +14000" in line
    assert "✅" in line
