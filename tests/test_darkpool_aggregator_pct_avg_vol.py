"""The aggregated dark-pool feed's `pctAvgVol` / `bigPrintPctAvgVol`: a print whose vendor message
carries no "% AvgVol" was NOT 0% of average volume, we were not told. It is published as None,
never a fabricated 0.0 (the rule darkpool_db._pct_avg_vol already enforces for the stored field)."""
import os
import io
import csv
import tempfile

os.environ.setdefault("RAILWAY_VOLUME_MOUNT_PATH", tempfile.mkdtemp(prefix="dp_agg_pav_"))

import pytest

from api import darkpool_db
from api import darkpool_aggregator


def _csv(rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=darkpool_db.CSV_COLUMNS)
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, "") for c in darkpool_db.CSV_COLUMNS})
    return buf.getvalue()


def _print(ticker, message, price=100.0, notional=6_000_000):
    return {"Date": "10/16/2026", "Timestamp": "10:00:00 AM", "Ticker": ticker, "Volume": 60000,
            "Price": price, "Notional": notional, "Message": message, "Type": "Block"}


@pytest.fixture
def dp(tmp_path, monkeypatch):
    db_path = str(tmp_path / "darkpool.db")
    monkeypatch.setattr(darkpool_db, "DB_DIR", str(tmp_path))
    monkeypatch.setattr(darkpool_db, "DB_PATH", db_path)
    monkeypatch.setattr(darkpool_aggregator, "DB_PATH", db_path)
    darkpool_db.init_db()
    return db_path


def _items(dp_rows):
    darkpool_db.insert_csv_rows(_csv(dp_rows))
    out = darkpool_aggregator.aggregate(all_data=True)
    return {it["t"]: it for it in out["allItems"]}


def test_a_print_without_avgvol_text_publishes_none_not_zero(dp):
    items = _items([_print("AAPL", "DARK BLOCK  $6.0M")])
    assert "AAPL" in items, items.keys()
    assert items["AAPL"]["bigPrintPctAvgVol"] is None


def test_a_print_with_avgvol_text_publishes_the_vendor_percent(dp):
    # Control: the same path does read the number when the vendor gives it.
    items = _items([_print("MSFT", "DARK BLOCK  $6.0M 334.49% AvgVol")])
    assert items["MSFT"]["bigPrintPctAvgVol"] == pytest.approx(334.49)


def test_the_logic_change_rebuilds_cached_windows():
    # The disk cache is keyed by data, not code: without a bump an old window keeps serving 0.0.
    assert darkpool_aggregator.AGG_CODE_VERSION != "3"
