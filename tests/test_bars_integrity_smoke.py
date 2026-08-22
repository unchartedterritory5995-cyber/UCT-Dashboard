"""Near-instant boot integrity smoke probe (bars_sqlite.integrity_smoke_ok).

The full PRAGMA quick_check scans every b-tree page (~200-280s on the 58M-row
store) and congested the web pod for ~5 min after every deploy. The smoke probe
replaces it on the boot path: it exercises the header/schema/table/index pages in
~ms and catches structural "disk image is malformed" corruption, while a missing
or empty-but-valid db passes.
"""
import sqlite3

import api.services.bars_sqlite as bs

_DDL_TABLE = (
    "CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
    "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))"
)
_DDL_INDEX = "CREATE INDEX idx_ohlcv_lookup ON ohlcv(ticker, tf, ts DESC)"


def _make_db(path, *, rows=True):
    c = sqlite3.connect(str(path))
    c.execute(_DDL_TABLE)
    c.execute(_DDL_INDEX)
    if rows:
        c.executemany(
            "INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
            [("AAPL", "D", 20260101, 1, 2, 0.5, 1.5, 100),
             ("SPY", "D", 20260101, 4, 5, 3.0, 4.5, 200)],
        )
    c.commit()
    c.close()


def test_smoke_ok_on_valid_db(tmp_path, monkeypatch):
    p = tmp_path / "bars.db"
    _make_db(p)
    monkeypatch.setattr(bs, "_DB_PATH", str(p))
    assert bs.integrity_smoke_ok() is True


def test_smoke_ok_on_empty_but_valid_db(tmp_path, monkeypatch):
    # Structure valid, zero rows — the probe validates STRUCTURE, not symbol
    # presence (AAPL/SPY absent must NOT fail it).
    p = tmp_path / "bars.db"
    _make_db(p, rows=False)
    monkeypatch.setattr(bs, "_DB_PATH", str(p))
    assert bs.integrity_smoke_ok() is True


def test_smoke_true_when_file_missing(tmp_path, monkeypatch):
    # No file → init_db creates a fresh one; not a failure.
    monkeypatch.setattr(bs, "_DB_PATH", str(tmp_path / "nope.db"))
    assert bs.integrity_smoke_ok() is True


def test_smoke_false_on_malformed_file(tmp_path, monkeypatch):
    p = tmp_path / "bars.db"
    _make_db(p)
    # Trash the SQLite header → "file is not a database" / "malformed" on first read.
    with open(p, "r+b") as f:
        f.seek(0)
        f.write(b"\xff" * 128)
    monkeypatch.setattr(bs, "_DB_PATH", str(p))
    assert bs.integrity_smoke_ok() is False
