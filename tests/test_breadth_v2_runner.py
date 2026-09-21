"""Rails for the DURABLE V2 RUNNER — the index fix's equivalence, and the lifecycle.

⛔⛔ The index fix is the only change the durable runner makes to accepted V2 behaviour,
so its equivalence is not a nicety — it is the thing that lets the 28 sessions the first
attempt already committed stay valid alongside everything the runner writes next.
"""
from __future__ import annotations

import os
import sqlite3
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import breadth_wick_recon as wr  # noqa: E402


def _bars(tmp_path, rows):
    """A miniature `bars.db` with the REAL schema and the REAL index, so the query
    planner makes the same choice it makes against the 26 GB original."""
    p = str(tmp_path / "bars.db")
    con = sqlite3.connect(p)
    con.execute("""CREATE TABLE ohlcv (
        ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL,
        o REAL, h REAL, l REAL, c REAL, v INTEGER,
        PRIMARY KEY (ticker, tf, ts))""")
    con.execute("CREATE INDEX idx_ohlcv_lookup ON ohlcv(ticker, tf, ts DESC)")
    con.executemany("INSERT INTO ohlcv(ticker,tf,ts,c) VALUES(?,?,?,?)", rows)
    con.commit()
    return con


def test_session_eod_closes_indexed_path_equals_the_scan(tmp_path):
    """⭐ THE EQUIVALENCE PROOF. The filtered scan and the per-key probe must return the
    same dict — same keys, same floats — because the PK makes at most one row per
    (ticker, tf, ts) and both paths apply the identical `is None` / `> 0.0` filters."""
    day = 20200316
    rows = []
    for i, t in enumerate(["AAPL", "MSFT", "BCPC", "TPC", "SPY", "ZZZZ"]):
        rows.append((t, "D", day, 10.0 + i))
        rows.append((t, "D", day - 1, 99.0))           # another session, must not leak
        rows.append((t, "1", day, 1.0))                # another tf, must not leak
    rows.append(("NULLC", "D", day, None))             # NULL close -> dropped by both
    rows.append(("ZEROC", "D", day, 0.0))              # non-positive -> dropped by both
    con = _bars(tmp_path, rows)

    want = ["AAPL", "MSFT", "BCPC", "TPC", "NULLC", "ZEROC", "NOT_IN_DB"]
    indexed = wr.session_eod_closes(con, day, want)

    # The pre-fix formulation, reproduced here verbatim so the test is a comparison
    # against the accepted behaviour rather than against itself.
    scanned = {}
    for t, c in con.execute("SELECT ticker, c FROM ohlcv WHERE tf='D' AND ts=?", (day,)):
        if c is None or t not in set(want):
            continue
        v = float(c)
        if v > 0.0:
            scanned[t] = v

    assert indexed == scanned
    assert indexed == {"AAPL": 10.0, "MSFT": 11.0, "BCPC": 12.0, "TPC": 13.0}
    assert "SPY" not in indexed          # traded that day but not asked for
    assert "NOT_IN_DB" not in indexed    # asked for but never traded


def test_session_eod_closes_unfiltered_still_scans_every_name(tmp_path):
    """⚠️ `tickers=None` keeps the whole-cross-section contract — the fix narrows the
    query only when the caller has already told us which names it wants."""
    day = 20200316
    con = _bars(tmp_path, [("AAPL", "D", day, 1.0), ("MSFT", "D", day, 2.0),
                           ("AAPL", "1", day, 9.0)])
    assert wr.session_eod_closes(con, day, None) == {"AAPL": 1.0, "MSFT": 2.0}


def test_session_eod_closes_never_raises_on_a_dead_connection(tmp_path):
    """The docstring promises `{}` rather than an exception, and the combined pass
    relies on that to checkpoint `missing_source` instead of dying."""
    con = _bars(tmp_path, [("AAPL", "D", 20200316, 1.0)])
    con.close()
    assert wr.session_eod_closes(con, 20200316, ["AAPL"]) == {}
    assert wr.session_eod_closes(con, 20200316, None) == {}


def test_the_indexed_path_actually_uses_the_index(tmp_path):
    """⛔ The whole point was the query PLAN, so assert on the plan, not on a timing.
    `WHERE tf=? AND ts=?` has no usable prefix of `(ticker, tf, ts)` and degrades to a
    full SCAN; the per-key form must SEARCH."""
    con = _bars(tmp_path, [("AAPL", "D", 20200316, 1.0)])
    scan = " ".join(r[3] for r in con.execute(
        "EXPLAIN QUERY PLAN SELECT ticker, c FROM ohlcv WHERE tf='D' AND ts=?",
        (20200316,)))
    probe = " ".join(r[3] for r in con.execute(
        "EXPLAIN QUERY PLAN SELECT c FROM ohlcv WHERE ticker=? AND tf='D' AND ts=?",
        ("AAPL", 20200316)))
    assert "SCAN" in scan and "SEARCH" not in scan
    assert "SEARCH" in probe


# ------------------------------------------------------------------ the lifecycle

def test_supervisor_preflight_refuses_a_production_writing_environment(monkeypatch):
    """⛔⛔ The runner must be unable to write production even if someone clones the
    worker's variables wholesale. `BREADTH_HISTORY_BACKFILL_ENABLED` gates the R2
    upload and `BREADTH_WICKS_ENABLED` arms the sweep against the PRODUCER store."""
    from api.services import breadth_v2_supervisor as sup

    for var in ("BREADTH_COMBINED_PASS_ENABLED", "BREADTH_HISTORY_BACKFILL_ENABLED",
                "BREADTH_WICKS_ENABLED", "BREADTH_OHLC_REMOTE"):
        monkeypatch.setenv(var, "0")
    monkeypatch.delenv("BREADTH_DIVIDEND_BASIS", raising=False)
    assert sup.preflight()["problems"] == []

    for var, why in (("BREADTH_HISTORY_BACKFILL_ENABLED", "upload"),
                     ("BREADTH_WICKS_ENABLED", "sweep"),
                     ("BREADTH_OHLC_REMOTE", "pull"),
                     ("BREADTH_COMBINED_PASS_ENABLED", "boot hook")):
        monkeypatch.setenv(var, "1")
        problems = sup.preflight()["problems"]
        assert any(var in p for p in problems), (var, why, problems)
        monkeypatch.setenv(var, "0")


def test_supervisor_preflight_pins_f4_to_the_accepted_run(monkeypatch):
    """⭐ F4 IS DEFERRED, so the runner must reproduce the accepted run's F4 state, not
    a 'better' one. Web carries `BREADTH_DIVIDEND_BASIS=1`; the accepted V2 worker run
    had it UNSET, and inheriting web's value would silently move the methodology."""
    from api.services import breadth_v2_supervisor as sup

    for var in ("BREADTH_COMBINED_PASS_ENABLED", "BREADTH_HISTORY_BACKFILL_ENABLED",
                "BREADTH_WICKS_ENABLED", "BREADTH_OHLC_REMOTE"):
        monkeypatch.setenv(var, "0")
    monkeypatch.setenv("BREADTH_DIVIDEND_BASIS", "1")
    assert any("BREADTH_DIVIDEND_BASIS" in p for p in sup.preflight()["problems"])
    monkeypatch.setenv("BREADTH_DIVIDEND_BASIS", "0")
    assert not any("BREADTH_DIVIDEND_BASIS" in p for p in sup.preflight()["problems"])


def test_singleton_lease_admits_exactly_one_holder(tmp_path):
    """⭐ The lease is the proof that a stray manual launch cannot become a second
    writer. `flock` is held by the file descriptor, so the second acquire must fail
    while the first is open, and succeed once it is closed."""
    pytest.importorskip("fcntl")
    from api.services import breadth_v2_supervisor as sup

    path = str(tmp_path / "v2.lock")
    first = sup._Lease(path)
    assert first.acquire() is True

    second = sup._Lease(path)
    assert second.acquire() is False, "two runners acquired the same lease"

    os.close(first._fd)
    third = sup._Lease(path)
    assert third.acquire() is True, "the lease did not release with its holder"
    os.close(third._fd)


def test_progress_ledger_reads_an_artifact_without_writing_it(tmp_path):
    """⚠️ The ledger must be derived by READING `pass_checkpoint`, so the accepted pass
    stays uninstrumented and the artifact's mtime/size are untouched by monitoring."""
    from api.services import breadth_v2_supervisor as sup

    art = str(tmp_path / "v2.db")
    con = sqlite3.connect(art)
    con.execute("CREATE TABLE pass_checkpoint(date TEXT PRIMARY KEY, status TEXT)")
    con.execute("""CREATE TABLE breadth_daily_ohlc(
        universe TEXT, date TEXT, metric TEXT, o REAL, h REAL, l REAL, c REAL,
        PRIMARY KEY(universe,date,metric))""")
    con.executemany("INSERT INTO pass_checkpoint VALUES(?,?)",
                    [("2008-01-02", "done"), ("2008-01-03", "done"),
                     ("2008-01-21", "missing_source")])
    con.execute("INSERT INTO breadth_daily_ohlc VALUES('uct','2008-01-02','x',1,1,1,1)")
    con.commit()
    con.close()

    before = (os.path.getsize(art), os.path.getmtime(art))
    monkey = sup.ARTIFACT
    try:
        sup.ARTIFACT = art
        prog = sup._read_progress()
    finally:
        sup.ARTIFACT = monkey

    assert prog["done"] == 2
    assert prog["missing_source"] == 1
    assert prog["failed"] == 0
    assert prog["checkpoints"] == 3
    assert prog["last_session"] == "2008-01-21"
    assert prog["rows"] == 1
    assert prog["universes"] == {"uct": 1}
    assert (os.path.getsize(art), os.path.getmtime(art)) == before


def test_progress_ledger_degrades_instead_of_crashing(tmp_path):
    """A missing or unreadable artifact must not take the supervisor down with it."""
    from api.services import breadth_v2_supervisor as sup

    monkey = sup.ARTIFACT
    try:
        sup.ARTIFACT = str(tmp_path / "does_not_exist.db")
        prog = sup._read_progress()
    finally:
        sup.ARTIFACT = monkey
    assert prog["artifact_bytes"] is None
    assert prog["done"] is None


def test_the_build_pin_survives_a_line_ending(tmp_path):
    """⚰️⚰️ THE TRAP THAT ACTUALLY FIRED. `v2_manifest.json` pinned the md5 of a copy
    scp'd out of a Windows worktree — 19,016 bytes with 391 CRLF pairs. The same file
    checked out on Linux is 18,625 bytes of LF and hashes differently, so preflight
    refused the CORRECT code and a line ending got to veto a five-day run. The digest
    must be over normalised content."""
    from api.services import breadth_v2_supervisor as sup

    body = "def f():\n    return 1\n" * 40
    lf = tmp_path / "lf.py"
    crlf = tmp_path / "crlf.py"
    lf.write_bytes(body.encode())
    crlf.write_bytes(body.replace("\n", "\r\n").encode())

    assert lf.read_bytes() != crlf.read_bytes(), "the fixture must actually differ"
    assert sup._md5(str(lf)) == sup._md5(str(crlf))


def test_preflight_pins_both_breadth_modules(monkeypatch):
    """⛔ The pass must be the accepted build EXACTLY, and wick_recon must be the
    accepted build plus the proved index fix — nothing else."""
    from api.services import breadth_v2_supervisor as sup
    from api.services import breadth_combined_pass as cp

    for var in ("BREADTH_COMBINED_PASS_ENABLED", "BREADTH_HISTORY_BACKFILL_ENABLED",
                "BREADTH_WICKS_ENABLED", "BREADTH_OHLC_REMOTE"):
        monkeypatch.setenv(var, "0")
    monkeypatch.delenv("BREADTH_DIVIDEND_BASIS", raising=False)

    checks = sup.preflight()
    assert checks["combined_md5"] == sup.PINNED_COMBINED_MD5
    assert checks["wick_recon_md5"] == sup.PINNED_WICK_RECON_MD5
    assert checks["problems"] == []

    monkeypatch.setattr(sup, "PINNED_WICK_RECON_MD5", "0" * 32)
    assert any("breadth_wick_recon.py" in p for p in sup.preflight()["problems"])
