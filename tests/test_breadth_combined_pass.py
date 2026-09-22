"""THE COMBINED PASS DRIVER — isolation, atomicity, resume.

⛔ THE MOST IMPORTANT TEST IN THIS FILE is the first one: the generator must be
INCAPABLE of opening the production breadth database. Everything else is recoverable;
that is not.
"""
import os
import sqlite3

import pytest

from api.services import breadth_combined_pass as cp


def test_a_an_absent_artifact_path_REFUSES_TO_RUN():
    """⛔⛔ NO DEFAULT DESTINATION, ON PURPOSE. A generator that opens the live store by
    forgetting an argument is one typo away from overwriting nineteen years of history,
    and BL-025 is this programme's own account of what one unintended write costs."""
    for bad in (None, "", "   "):
        with pytest.raises(cp.ArtifactRefused, match="REQUIRED"):
            cp.open_artifact(bad)


def test_b_the_production_store_is_REFUSED_even_if_named_explicitly(monkeypatch, tmp_path):
    from api.services import breadth_daily_ohlc as store
    prod = str(tmp_path / "prod.db")
    monkeypatch.setattr(store, "_db_path", lambda: prod)
    with pytest.raises(cp.ArtifactRefused, match="PRODUCTION"):
        cp.open_artifact(prod)
    assert not os.path.exists(prod), "the refusal must not have created the file"


def test_c_the_well_known_production_paths_are_in_the_refusal_set(tmp_path):
    """⚠️ Asserted PLATFORM-AWARELY. `os.path.abspath` of a POSIX production
    path becomes a drive-rooted Windows path, so a literal string match passes on
    Linux and fails here while the guard itself works perfectly. Assert the property
    that matters: the set is non-empty, every entry names the breadth store, and the
    guard refuses each one."""
    paths = cp._production_paths()
    assert paths, "the refusal set must never be empty"
    assert all(p.replace(os.sep, "/").endswith("breadth_daily_ohlc.db") for p in paths), paths
    # and the guard refuses each of them
    for p in paths:
        with pytest.raises(cp.ArtifactRefused, match="PRODUCTION"):
            cp.open_artifact(p)


def test_d_the_artifact_carries_the_canonical_schema(tmp_path):
    c = cp.open_artifact(str(tmp_path / "a.db"))
    cols = [r[1] for r in c.execute("PRAGMA table_info(breadth_daily_ohlc)")]
    assert cols[:7] == ["universe", "date", "metric", "o", "h", "l", "c"]
    pk = [r[2] for r in c.execute(
        "PRAGMA index_info('sqlite_autoindex_breadth_daily_ohlc_1')")]
    assert pk == ["universe", "date", "metric"], "must match the production key"
    names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"pass_checkpoint", "pass_meta", "pass_session"} <= names
    c.close()


def test_e_checkpoint_marks_done_and_missing_source_as_COMPLETED_but_failed_as_RETRYABLE(
        tmp_path):
    """⭐ A missing provider file is a FACT about the archive, not a failure to retry
    forever; a genuine failure must come back around on the next run."""
    c = cp.open_artifact(str(tmp_path / "a.db"))
    cp._checkpoint(c, "2026-01-05", "done")
    cp._checkpoint(c, "2026-01-06", "missing_source", detail="no minute flat file")
    cp._checkpoint(c, "2026-01-07", "failed", detail="boom")
    got = cp.completed(c)
    assert got == {"2026-01-05", "2026-01-06"}
    assert "2026-01-07" not in got
    c.close()


def test_f_a_session_commits_ATOMICALLY_across_all_universes(tmp_path):
    """⚠️ A pass that can leave UCT written, US half-written and NASDAQ missing while
    marking the date complete is a pass whose resume is a guess."""
    path = str(tmp_path / "a.db")
    c = cp.open_artifact(path)
    rows = [(u, "2026-01-05", "pct_above_50sma", 1, 2, 0, 1.5, "intraday_recon_1m")
            for u in ("uct", "us", "nasdaq", "nyse")]
    c.execute("BEGIN IMMEDIATE")
    c.executemany("INSERT INTO breadth_daily_ohlc"
                  "(universe,date,metric,o,h,l,c,source,updated_at) "
                  "VALUES(?,?,?,?,?,?,?,?,datetime('now'))", rows)
    c.execute("ROLLBACK")                     # simulate a crash mid-session
    assert c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0] == 0
    assert "2026-01-05" not in cp.completed(c), "a rolled-back session is not complete"
    c.close()


def test_g_re_running_a_committed_session_is_idempotent(tmp_path):
    c = cp.open_artifact(str(tmp_path / "a.db"))
    row = ("us", "2026-01-05", "pct_above_50sma", 1, 2, 0, 1.5, "intraday_recon_1m")
    sql = ("INSERT INTO breadth_daily_ohlc(universe,date,metric,o,h,l,c,source,updated_at)"
           " VALUES(?,?,?,?,?,?,?,?,datetime('now')) "
           "ON CONFLICT(universe,date,metric) DO UPDATE SET c=excluded.c")
    c.execute(sql, row)
    c.execute(sql, row)
    c.commit()
    assert c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0] == 1
    c.close()


def test_h_provenance_is_recorded(tmp_path):
    c = cp.open_artifact(str(tmp_path / "a.db"))
    cp._meta(c, methodology=cp.METHODOLOGY, resolution="1m", session="RTH")
    c.commit()
    meta = dict(c.execute("SELECT key, value FROM pass_meta"))
    # THE METHODOLOGY STRING IS THE ARTIFACT'S IDENTITY, so it moves when the
    # methodology does. `-v2-corrected` marks the run that sources historical levels
    # AND the official close from the provider's grouped daily tape (Candidates E
    # and B) and replaces the fixed pct-range cap with the amended path-quality
    # rule. An artifact must never be able to claim `-v1` while carrying corrected
    # rows.
    assert meta["methodology"] == "rth-1m-composites-v2-corrected"
    assert meta["resolution"] == "1m" and meta["session"] == "RTH"
    c.close()


def test_i_pit_universes_are_point_in_time_and_distinct(monkeypatch):
    """⛔ No present-day membership projected backward, and no accidental reuse: a name
    resolves through its listing window, and the three venue sets are genuinely different
    populations."""
    from api.services import breadth_pit_frame as bpf
    ref = {
        "AAA": [{"type": "CS", "primary_exchange": "XNAS"}],
        "BBB": [{"type": "CS", "primary_exchange": "XNYS"}],
        "CCC": [{"type": "ETF", "primary_exchange": "XNAS"}],   # excluded by type
        "DDD": [{"type": "CS", "primary_exchange": "ARCX"}],    # US but neither exchange
        "EEE": None,                                            # unresolved → excluded
    }
    monkeypatch.setattr(bpf, "resolve", lambda recs, d: (recs or [None])[0])
    per = {k: [{"t": 1}] for k in ref}
    out = cp.resolve_universes("2020-06-01", per, ["AAA"], ref)
    assert sorted(out["us"]) == ["AAA", "BBB", "DDD"]
    assert out["nasdaq"] == ["AAA"]
    assert out["nyse"] == ["BBB"]
    assert out["uct"] == ["AAA"]
    assert "CCC" not in out["us"] and "EEE" not in out["us"]
    assert out["nasdaq"] != out["nyse"], "universe identity collision"
    assert set(out["nasdaq"]) | set(out["nyse"]) <= set(out["us"]), \
        "US must be a superset of the two exchange universes"


def test_j_run_refuses_before_opening_anything_when_the_path_is_absent():
    with pytest.raises(cp.ArtifactRefused):
        cp.run("", "2026-01-05", "2026-01-06")
