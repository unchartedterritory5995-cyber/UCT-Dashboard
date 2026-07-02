"""Tests for the 2026-07-01 backend hardening: yfinance timeout wrapper + WAL."""

import time
import sqlite3


# ── yfinance bounded wrapper ──────────────────────────────────────────────────

def test_bounded_yf_returns_value_for_fast_fn():
    from api.services.massive import _bounded_yf
    assert _bounded_yf(lambda: 42, default=-1, timeout=1.0) == 42


def test_bounded_yf_returns_default_promptly_on_timeout():
    from api.services.massive import _bounded_yf
    start = time.monotonic()
    # fn would take 1s; we cap at 0.2s → must return the default quickly, not hang.
    r = _bounded_yf(lambda: (time.sleep(1.0), "slow")[1], default="DEFAULT", timeout=0.2)
    elapsed = time.monotonic() - start
    assert r == "DEFAULT"
    assert elapsed < 0.8, f"did not return promptly on timeout ({elapsed:.2f}s)"


def test_bounded_yf_returns_default_on_error():
    from api.services.massive import _bounded_yf

    def boom():
        raise ValueError("upstream broke")

    assert _bounded_yf(boom, default=None, timeout=1.0) is None


# ── WAL enabled on the two hardened DBs ───────────────────────────────────────

def test_cot_conn_enables_wal(tmp_path, monkeypatch):
    import api.services.cot_service as cot
    monkeypatch.setattr(cot, "DB_PATH", str(tmp_path / "cot.db"))
    conn = cot._get_conn()
    try:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        assert mode.lower() == "wal"
    finally:
        conn.close()


def test_breadth_conn_enables_wal(tmp_path, monkeypatch):
    import api.services.breadth_monitor as bm
    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "breadth.db"))
    conn = bm._conn()
    try:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        assert mode.lower() == "wal"
    finally:
        conn.close()
