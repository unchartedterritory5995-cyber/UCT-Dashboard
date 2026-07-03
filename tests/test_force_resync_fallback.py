"""force_resync resilience — the 2026-07-03 'no such table: ohlcv' outage.

force_resync removes the local bars.db BEFORE pulling, and download_snapshot
(correctly) refuses a snapshot whose bars.db fails integrity_check. When the
NEWEST R2 snapshot was itself malformed, the old code deleted the local DB,
installed nothing, and left the process with no ohlcv table until reboot —
every /api/bars request 503'd.

Two guarantees tested here:
  1. Fallback: when the newest snapshot fails to install, older snapshots
     are tried (newest-first).
  2. Floor: when NOTHING installs, an empty-but-valid schema is recreated so
     reads degrade to cache-miss refetch instead of 'no such table'.
"""
from unittest.mock import patch

import pytest

from api.services import bars_sqlite, data_sync


@pytest.fixture
def tmp_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    bars_sqlite.put_bars(
        "MSTR", "D",
        [{"t": "2026-07-02", "o": 100, "h": 101, "l": 99, "c": 100.5, "v": 1000}],
        date_tf=True,
    )
    yield tmp_path
    bars_sqlite.bump_db_epoch()


def test_force_resync_recreates_schema_when_no_snapshot_installs(tmp_data_dir):
    # Windows-only: release this thread's SQLite handle so force_resync can
    # actually remove the file (prod Linux allows unlink-while-open).
    bars_sqlite._drop_local_conn()
    with patch.object(data_sync, "get_latest_snapshot_ts", return_value="111"), \
         patch.object(data_sync, "_list_snapshot_ts_desc", return_value=["111", "110"]), \
         patch.object(data_sync, "download_snapshot", return_value=False) as dl:
        ok = data_sync.force_resync()
    assert ok is False
    # Both candidates were attempted (newest first).
    tried = [c.args[0] for c in dl.call_args_list]
    assert tried == ["111", "110"]
    # The floor guarantee: local DB exists WITH the ohlcv table, empty.
    rows = bars_sqlite.get_bars("MSTR", "D", 10)
    assert rows == []  # data gone (expected), but the read does NOT raise


def test_force_resync_falls_back_to_older_snapshot(tmp_data_dir):
    calls = []

    def fake_download(ts):
        calls.append(ts)
        return ts == "109"  # newest two malformed, third installs

    with patch.object(data_sync, "get_latest_snapshot_ts", return_value="111"), \
         patch.object(data_sync, "_list_snapshot_ts_desc", return_value=["111", "110", "109"]), \
         patch.object(data_sync, "download_snapshot", side_effect=fake_download):
        ok = data_sync.force_resync()
    assert ok is True
    assert calls == ["111", "110", "109"]
