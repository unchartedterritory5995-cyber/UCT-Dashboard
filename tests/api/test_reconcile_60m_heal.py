"""Regression tests for the active 60m companion heal in bars_reconciliation.

Background (2026-06-08 chart-correctness restore): 60m is excluded from the
reconciliation auditor's `_TFS` because the app stores session-anchored ET
hourly bars while audit.py fetches Polygon clock-hour native — auditing 60m
directly would delete correct bars. The contract is "60m heals indirectly:
once its 30m source is clean, the 60m resample is clean." `_heal_companion_60m`
makes that heal ACTIVE: when 30m drift is healed, the overlapping session-hour
60m rows are dropped so the next fetch re-resamples them from the clean 30m.
"""
import datetime as dt
import sqlite3
import zoneinfo

import pytest

from api.services import bars_reconciliation
from api.services.bars_fetch import bucket_60_et_unix_seconds

ET = zoneinfo.ZoneInfo("America/New_York")


def _et_unix(y, mo, d, h, mi):
    return int(dt.datetime(y, mo, d, h, mi, tzinfo=ET).timestamp())


@pytest.fixture
def bars_db(tmp_path, monkeypatch):
    """A minimal bars.db with the ohlcv schema, wired via DATA_DIR."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    db = tmp_path / "bars.db"
    conn = sqlite3.connect(str(db))
    conn.execute(
        "CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
        "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
        "PRIMARY KEY (ticker, tf, ts))"
    )
    conn.commit()
    conn.close()
    return str(db)


def _rows(db, ticker, tf):
    conn = sqlite3.connect(db)
    try:
        return {r[0] for r in conn.execute(
            "SELECT ts FROM ohlcv WHERE ticker=? AND tf=?", (ticker, tf)
        ).fetchall()}
    finally:
        conn.close()


def test_companion_60m_drops_overlapping_hour_only(bars_db):
    """Healing a 30m bad ts drops the 60m row whose session bucket contains it,
    and leaves an unrelated 60m row intact."""
    # 30m bar at 10:30 ET on 2026-06-08; its session-hour bucket is 10:00 ET.
    bad_30m = _et_unix(2026, 6, 8, 10, 30)
    target_60m = bucket_60_et_unix_seconds(bad_30m)
    other_60m = _et_unix(2026, 6, 8, 13, 0)  # different hour — must survive

    conn = sqlite3.connect(bars_db)
    conn.execute("INSERT INTO ohlcv VALUES ('NVDA','60',?,1,2,0,1,10)", (target_60m,))
    conn.execute("INSERT INTO ohlcv VALUES ('NVDA','60',?,1,2,0,1,10)", (other_60m,))
    conn.commit()
    conn.close()

    deleted = bars_reconciliation._heal_companion_60m("NVDA", [bad_30m])

    assert deleted == 1
    survivors = _rows(bars_db, "NVDA", "60")
    assert target_60m not in survivors
    assert other_60m in survivors


def test_companion_60m_dedupes_buckets(bars_db):
    """Two 30m bars in the same hour map to ONE 60m bucket delete."""
    h = 11
    a = _et_unix(2026, 6, 8, h, 0)
    b = _et_unix(2026, 6, 8, h, 30)
    bucket = bucket_60_et_unix_seconds(a)
    assert bucket_60_et_unix_seconds(b) == bucket

    conn = sqlite3.connect(bars_db)
    conn.execute("INSERT INTO ohlcv VALUES ('AMD','60',?,1,2,0,1,10)", (bucket,))
    conn.commit()
    conn.close()

    deleted = bars_reconciliation._heal_companion_60m("AMD", [a, b])
    assert deleted == 1
    assert bucket not in _rows(bars_db, "AMD", "60")


def test_companion_60m_empty_is_noop(bars_db):
    assert bars_reconciliation._heal_companion_60m("AMD", []) == 0
