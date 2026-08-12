"""Worker→web R2 bridge for breadth_daily_ohlc — the gap-fill merge contract.

The merge is the one place where copying the bars bridge verbatim would be a
silent bug (bars adopt only rows NEWER than local max; a breadth backfill adds
OLDER dates, which that rule would reject). These tests pin the correct
gap-fill-by-(date,metric) behavior and the source/geometry gate.
"""
import sqlite3

import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_ohlc_sync as bridge


@pytest.fixture()
def fresh_store(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "web_ohlc.db"))
    store._INIT_DONE = False        # force re-init against the tmp (web) DB
    yield
    store._INIT_DONE = False


def _make_snap(path, rows):
    """Build a standalone snapshot DB (the worker's shipped file) with the
    exact store schema. `rows` = [(date, metric, o, h, l, c, source)]."""
    c = sqlite3.connect(path)
    try:
        c.execute(
            """CREATE TABLE breadth_daily_ohlc (
                date TEXT NOT NULL, metric TEXT NOT NULL,
                o REAL, h REAL, l REAL, c REAL,
                source TEXT DEFAULT 'live',
                updated_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (date, metric))"""
        )
        c.executemany(
            "INSERT INTO breadth_daily_ohlc(date,metric,o,h,l,c,source,updated_at) "
            "VALUES(?,?,?,?,?,?,?, datetime('now'))",
            rows,
        )
        c.commit()
    finally:
        c.close()


def test_gapfill_adopts_older_dates_and_protects_local_rows(fresh_store, tmp_path):
    # ── seed the WEB store ──────────────────────────────────────────────
    # a real intraday-sampled 'live' wick (the thing we must never clobber)
    store.update_intraday("2026-08-07", {"pct_above_50sma": 30.0})
    # an existing recent close_recon body
    store.write_bulk([("2024-06-01", "pct_above_50sma", 50, 55, 45, 52)],
                     source="close_recon")

    # ── the worker's snapshot ───────────────────────────────────────────
    snap = str(tmp_path / "snap.db")
    _make_snap(snap, [
        # (a) OLDER date → MUST be adopted (the bars ts>MAX rule would reject it)
        ("2020-03-23", "pct_above_50sma", 2, 3, 1, 2, "close_recon"),
        # (b) conflicts with the web's LIVE row → must NOT overwrite it
        ("2026-08-07", "pct_above_50sma", 99, 99, 99, 99, "close_recon"),
        # (c) 'reconstruct' junk source → filtered out at the boundary
        ("2019-01-02", "pct_above_50sma", 40, 45, 35, 42, "reconstruct"),
        # (d) NaN open → filtered by the finite gate
        ("2018-01-02", "pct_above_50sma", float("nan"), 45, 35, 42, "close_recon"),
        # (e) impossible geometry (h < l) → filtered by the ordering gate
        ("2018-01-03", "pct_above_50sma", 40, 10, 35, 42, "close_recon"),
        # (f) legitimate ZERO values (washout: 0% above MA) → adopted (no >0 gate)
        ("2020-03-24", "pct_above_50sma", 0, 0, 0, 0, "close_recon"),
        # (g) legitimate NEGATIVE values (e.g. McClellan) → adopted (no >0 gate)
        ("2020-03-25", "mcclellan", -50, -40, -60, -45, "close_recon"),
    ])

    adopted = bridge._merge_from(snap)

    h = store.history("pct_above_50sma")
    # (a) older date landed
    assert h["2020-03-23"] == {"o": 2.0, "h": 3.0, "l": 1.0, "c": 2.0}
    # (b) the live row is UNTOUCHED (still 30, not the snapshot's 99)
    assert h["2026-08-07"]["c"] == 30.0
    # (c) reconstruct source never adopted
    assert "2019-01-02" not in h
    # (d) NaN row rejected
    assert "2018-01-02" not in h
    # (e) bad-geometry row rejected
    assert "2018-01-03" not in h
    # (f) zero values adopted
    assert h["2020-03-24"] == {"o": 0.0, "h": 0.0, "l": 0.0, "c": 0.0}
    # (g) negative values adopted, under their own metric
    assert store.history("mcclellan")["2020-03-25"]["c"] == -45.0

    # 4 valid, novel rows adopted: (a), (f), (g) + the pre-existing web rows
    # untouched. (b) ignored (PK exists), (c)(d)(e) filtered.
    assert adopted == 3


def test_merge_is_idempotent(fresh_store, tmp_path):
    snap = str(tmp_path / "snap.db")
    _make_snap(snap, [("2020-03-23", "pct_above_50sma", 2, 3, 1, 2, "close_recon")])
    assert bridge._merge_from(snap) == 1
    assert bridge._merge_from(snap) == 0   # second pass adopts nothing


def test_intraday_recon_upgrades_body_but_never_overwrites_live(fresh_store, tmp_path):
    # web has a body-only close_recon day + a REAL live-accumulator wick day
    store.write_bulk([("2020-01-02", "pct_above_50sma", 50, 50, 50, 50)], source="close_recon")
    store.update_intraday("2026-08-07", {"pct_above_50sma": 30.0})   # live seed o=h=l=c=30
    store.update_intraday("2026-08-07", {"pct_above_50sma": 35.0})   # live now o30 h35 l30 c35
    snap = str(tmp_path / "snap.db")
    _make_snap(snap, [
        # a real intraday_recon WICK for the body day → must UPGRADE (2 > 1)
        ("2020-01-02", "pct_above_50sma", 50, 62, 45, 55, "intraday_recon"),
        # an intraday_recon row for the LIVE day → must NOT overwrite live (2 < 3)
        ("2026-08-07", "pct_above_50sma", 99, 99, 99, 99, "intraday_recon"),
    ])
    bridge._merge_from(snap)
    h = store.history("pct_above_50sma")
    assert h["2020-01-02"] == {"o": 50.0, "h": 62.0, "l": 45.0, "c": 55.0}   # body -> real wick
    assert h["2026-08-07"]["c"] == 35.0 and h["2026-08-07"]["h"] == 35.0     # live preserved
    # and it doesn't DOWNGRADE: a close_recon row must not replace the intraday_recon wick
    snap2 = str(tmp_path / "snap2.db")
    _make_snap(snap2, [("2020-01-02", "pct_above_50sma", 50, 50, 50, 50, "close_recon")])
    bridge._merge_from(snap2)
    assert store.history("pct_above_50sma")["2020-01-02"]["h"] == 62.0       # still the wick


def test_upload_and_sync_are_noops_without_credentials(fresh_store, monkeypatch):
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY",
                "DATA_SYNC_SECRET_KEY", "DATA_SYNC_BUCKET"):
        monkeypatch.delenv(var, raising=False)
    assert bridge.credentials_ok() is False
    assert bridge.upload() is None
    assert bridge.sync_if_new() is None
