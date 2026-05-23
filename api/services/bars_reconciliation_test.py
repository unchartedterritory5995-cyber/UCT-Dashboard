"""Smoke tests for the reconciliation worker. The actual canonical-diff
+ heal logic is exercised end-to-end in production against live Polygon
data; here we just verify the pure pieces (sampling, healing) and the
state shape."""
import sqlite3
import os
from unittest.mock import patch, MagicMock

from api.services import bars_reconciliation


class TestSamplePairs:
    def test_returns_at_most_pairs_per_cycle(self, monkeypatch):
        """Sampling must never exceed the configured cap, even when all
        sources return data."""
        monkeypatch.setattr(bars_reconciliation, "_PAIRS_PER_CYCLE", 30)
        # Mock hot-set + cap_universe so we have plenty to draw from
        with patch("api.services.bars_fetch.get_hot_intraday_tickers", return_value=[f"H{i}" for i in range(100)]):
            # And mock cap_universe.json load via tmpfile if needed
            pairs = bars_reconciliation._sample_pairs()
        assert len(pairs) <= 30, f"oversampled: got {len(pairs)}, expected <= 30"

    def test_each_pair_has_valid_tf(self, monkeypatch):
        monkeypatch.setattr(bars_reconciliation, "_PAIRS_PER_CYCLE", 20)
        with patch("api.services.bars_fetch.get_hot_intraday_tickers", return_value=["AAPL", "NVDA"]):
            pairs = bars_reconciliation._sample_pairs()
        for ticker, tf in pairs:
            assert tf in bars_reconciliation._TFS, f"invalid tf in pair: {tf}"
            assert ticker, "empty ticker in pair"

    def test_handles_hot_set_unavailable(self, monkeypatch):
        """If the hot-set lookup raises, sampling still proceeds with
        priority + long-tail. A broken hot-set must not kill audits."""
        monkeypatch.setattr(bars_reconciliation, "_PAIRS_PER_CYCLE", 20)
        with patch("api.services.bars_fetch.get_hot_intraday_tickers", side_effect=RuntimeError("boom")):
            pairs = bars_reconciliation._sample_pairs()
        # Should still get priority tickers at minimum
        assert len(pairs) > 0, "sampling should fall back gracefully when hot-set fails"


class TestHealDrift:
    def test_deletes_specified_rows_only(self, tmp_path, monkeypatch):
        """Surgical delete: only the (ticker, tf, ts) rows passed in get
        removed. Other rows for the same ticker/tf survive, and other
        tickers are completely untouched."""
        db_path = str(tmp_path / "bars.db")
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        # Build a tiny ohlcv table with 3 BB 60min bars and 1 AAPL 60min bar
        conn = sqlite3.connect(db_path)
        conn.execute("""
            CREATE TABLE ohlcv (
              ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL,
              o REAL, h REAL, l REAL, c REAL, v INTEGER,
              PRIMARY KEY(ticker, tf, ts)
            )
        """)
        rows = [
            ("BB", "60", 1000, 6.0, 6.5, 5.9, 6.4, 1000),
            ("BB", "60", 2000, 6.4, 6.7, 6.3, 6.5, 2000),  # drift
            ("BB", "60", 3000, 6.5, 6.8, 6.4, 6.7, 3000),
            ("AAPL", "60", 1000, 100, 102, 99, 101, 5000),
        ]
        conn.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
        conn.commit()
        conn.close()

        # Patch the in-memory cache + bars_sqlite import paths to no-ops
        with patch("api.services.cache.cache") as _mc, \
             patch("api.services.bars_sqlite.bump_db_epoch"):
            _mc.delete_prefix.return_value = 0
            deleted = bars_reconciliation._heal_drift("BB", "60", [2000])

        assert deleted == 1, f"expected 1 row deleted, got {deleted}"

        # Verify the right row was deleted
        conn = sqlite3.connect(db_path)
        remaining = conn.execute("SELECT ticker, tf, ts FROM ohlcv ORDER BY ts").fetchall()
        conn.close()
        assert ("BB", "60", 2000) not in remaining
        assert ("BB", "60", 1000) in remaining
        assert ("BB", "60", 3000) in remaining
        assert ("AAPL", "60", 1000) in remaining, "AAPL row was wrongly touched"

    def test_empty_bad_timestamps_is_noop(self):
        """Calling heal with no timestamps returns 0 and touches nothing."""
        deleted = bars_reconciliation._heal_drift("BB", "60", [])
        assert deleted == 0


class TestGetState:
    def test_returns_dict_with_expected_keys(self):
        state = bars_reconciliation.get_state()
        for key in (
            "enabled", "running", "cycle_seconds", "pairs_per_cycle",
            "cycles_completed", "audits_run", "audits_errored",
            "drift_detected_count", "rows_healed_total",
            "last_cycle_at", "last_drift",
        ):
            assert key in state, f"state missing required key {key!r}"

    def test_returns_independent_copy(self):
        """Mutating the returned dict must NOT affect the internal state."""
        state = bars_reconciliation.get_state()
        state["audits_run"] = 99999
        state2 = bars_reconciliation.get_state()
        assert state2["audits_run"] != 99999
