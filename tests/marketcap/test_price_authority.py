"""Market Cap PRICE INPUT AUTHORITY (owner decision 2026-10-05, Option 1): sealed root, append-only lineage, basis
events, explicit human-approved corrections. Price-authority failure matrix, store-level cases (refresh-level cases live
in test_failure_matrix.py)."""
from __future__ import annotations

import json
import os
import sqlite3
import stat

import pytest

from api.services.marketcap import price_authority as PA

ROOT_DAYS = [20260922, 20260923, 20260924, 20260925, 20260928, 20260929]
NEW = [20260930, 20261001, 20261002]
TICKERS = {"AAA": 10.0, "BBB": 20.0, "CCC": 30.0, "DDD": 40.0, "SPL": 100.0}


def mkdb(path, rows, kind="bar"):
    db = sqlite3.connect(path)
    if kind == "bar":
        db.executescript(PA.DDL)
        db.executemany("INSERT INTO bar VALUES(?,?,?,?)", rows)
    else:                                              # bars.db shape
        db.execute("CREATE TABLE ohlcv(ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL)")
        db.executemany("INSERT INTO ohlcv VALUES(?,?,?,?,?,?,?,?)", [(t, "D", d, c, c, c, c, v) for t, d, c, v in rows])
    db.commit()
    db.close()
    return str(path)


def root_rows():
    return [(t, d, p + i * 0.1, 1000.0) for t, p in TICKERS.items() for i, d in enumerate(ROOT_DAYS)]


def upstream_rows(*, rebase=None, drop=None, add=None, change=None, extra_days=NEW, partial=None, split=None, new=None):
    rows = []
    for t, p in TICKERS.items():
        for i, d in enumerate(ROOT_DAYS + extra_days):
            c = p + i * 0.1
            if split and t == split[0] and d < split[1]:
                c *= split[2]                              # bars.db: earlier history on the post-split basis
            if rebase and t == rebase[0]:
                c *= rebase[1]
            if change and (t, d) == change[:2]:
                c = change[2]
            if partial and (t, d) == partial[:2]:
                c = partial[2]
            if drop and (t, d) == drop:
                continue
            rows.append((t, d, c, 1000.0))
    for t, d, c in (add or []):
        rows.append((t, d, c, 1000.0))
    for t, p in (new or {}).items():
        rows += [(t, d, p, 500.0) for d in extra_days]
    return rows


def official_from(rows, days=NEW, skip=()):
    out = {}
    for t, d, c, _v in rows:
        if d in days and d not in skip:
            out.setdefault(d, {})[t] = c
    return out


@pytest.fixture
def st(tmp_path):
    s = PA.Store(str(tmp_path / "root"))
    src = mkdb(tmp_path / "m3_prices.db", root_rows())
    m = PA.seal_root(s, src, expect_sha256=PA.file_sha(src), provenance={"accepted": "MCAP_V1-TEST"})
    return {"s": s, "root": m["version_id"], "tmp": tmp_path, "src": src}


def up(st, name="bars.db", **kw):
    rows = upstream_rows(**kw)
    return mkdb(st["tmp"] / name, rows, kind="ohlcv"), rows


# ── root ────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_root_is_the_exact_accepted_bytes_and_refuses_an_approximation(st):
    m = st["s"].manifest(st["root"])
    assert m["kind"] == "ROOT" and m["files"]["base.db"] == PA.file_sha(st["src"]) and m["last_session"] == 20260929
    assert m["rows"] == 30 and m["symbols"] == 5
    assert not (os.stat(st["s"].path(st["root"], "base.db")).st_mode & stat.S_IWRITE)
    with pytest.raises(PA.PriceAuthorityError, match="approximation"):
        PA.seal_root(st["s"], st["src"], expect_sha256="0" * 64, provenance={})


# ── 1. clean append / 2. several missed sessions ────────────────────────────────────────────────────────────────────
def test_01_02_append_leaves_every_parent_key_identical(st):
    src, rows = up(st)
    m = PA.append(st["s"], st["root"], src, official=official_from(rows), splits={}, sessions=NEW)
    assert m["kind"] == "APPEND" and m["appended"]["sessions"] == NEW and m["appended"]["rows"] == 15
    assert m["validation"]["parent_history_identical"] is True
    out = PA.materialize(st["s"], m["version_id"], str(st["tmp"] / "mat.db"))
    assert PA.content_sha(str(st["tmp"] / "mat.db"), upto=20260929)[0] == st["s"].manifest(st["root"])["content_sha256"]
    assert out["chain"] == [st["root"], m["version_id"]] and out["last_session"] == 20261002


def test_one_session_then_another_chains(st):
    src, rows = up(st)
    a = PA.append(st["s"], st["root"], src, official=official_from(rows), splits={}, sessions=NEW[:1])
    b = PA.append(st["s"], a["version_id"], src, official=official_from(rows), splits={}, sessions=NEW)
    assert a["appended"]["sessions"] == [20260930] and b["appended"]["sessions"] == [20261001, 20261002]
    assert st["s"].chain(b["version_id"])[0]["version_id"] == st["root"]


def test_no_due_session_is_not_a_new_version(st):
    src, rows = up(st)
    assert PA.append(st["s"], st["root"], src, official={}, splits={}, sessions=[])["no_new_session"] is True


# ── 3-6: new-session validation ─────────────────────────────────────────────────────────────────────────────────────
def test_03_upstream_missing_session_holds(st):
    src, rows = up(st, extra_days=[])
    with pytest.raises(PA.PriceHold, match="SESSION_ABSENT_UPSTREAM|NO_OFFICIAL"):
        PA.append(st["s"], st["root"], src, official=official_from(upstream_rows()), splits={}, sessions=NEW)


def test_03b_no_official_aggregate_holds_the_session(st):
    src, rows = up(st)
    with pytest.raises(PA.PriceHold, match="NO_OFFICIAL_DAILY_AGGREGATE"):
        PA.append(st["s"], st["root"], src, official={}, splits={}, sessions=NEW)
    # ... and an aggregate for the first two sessions only appends exactly those two
    m = PA.append(st["s"], st["root"], src, official=official_from(rows, skip=(20261002,)), splits={}, sessions=NEW)
    assert m["appended"]["sessions"] == NEW[:2]


def test_04_partial_new_bar_is_not_appended(st):
    src, rows = up(st, partial=("BBB", 20260930, 20.33))
    off = official_from(upstream_rows())                   # the official (final) close differs
    m = PA.append(st["s"], st["root"], src, official=off, splits={}, sessions=NEW)
    assert m["appended"]["holds_by_reason"] == {"NOT_FINAL": 1}
    D = sqlite3.connect(st["s"].path(m["version_id"], "delta.db"))
    assert D.execute("SELECT COUNT(*) FROM bar WHERE ticker='BBB'").fetchone()[0] == 0   # no hole-then-resume


def test_05_duplicate_rows_are_dropped_once(st):
    src, rows = up(st, add=[("AAA", 20260930, 99.0)])
    m = PA.append(st["s"], st["root"], src, official=official_from(upstream_rows()), splits={}, sessions=NEW)
    assert m["session_report"][0].get("duplicates_dropped") == 1
    D = sqlite3.connect(st["s"].path(m["version_id"], "delta.db"))
    assert D.execute("SELECT c FROM bar WHERE ticker='AAA' AND d=20260930").fetchone()[0] != 99.0


def test_06_invalid_close_holds_the_row_or_the_session(st, monkeypatch):
    src, rows = up(st, change=("CCC", 20261001, 0.0))
    # 1 of 5 rows invalid > the 1% ceiling: the SESSION is untrustworthy -> the append stops before it
    m = PA.append(st["s"], st["root"], src, official=official_from(rows), splits={}, sessions=NEW)
    assert m["appended"]["sessions"] == [20260930] and "INVALID_CLOSES" in m["session_report"][-1]["hold"]
    # under the ceiling: only that row is held (and that ticker is not appended after it)
    monkeypatch.setattr(PA, "INVALID_ROW_CEILING", 0.5)
    st2 = PA.Store(str(st["tmp"] / "root2"))
    r2 = PA.seal_root(st2, st["src"], expect_sha256=PA.file_sha(st["src"]), provenance={})["version_id"]
    m = PA.append(st2, r2, src, official=official_from(rows), splits={}, sessions=NEW)
    assert m["appended"]["sessions"] == NEW and m["appended"]["holds_by_reason"] == {"INVALID_CLOSE": 1}


# ── 7-10: upstream historical rewrites are never inherited ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("kw", [dict(drop=("AAA", 20260925)),                  # 7 a historical row removed upstream
                                dict(add=[("AAA", 20260926, 10.5)]),          # 8 a historical row added upstream
                                dict(change=("BBB", 20260924, 21.0)),         # 9 a historical value changed upstream
                                dict(rebase=("CCC", 0.5))])                   # 10 an unexplained historical rebase
def test_07_to_10_upstream_history_changes_never_reach_the_lineage(st, kw):
    src, rows = up(st, **kw)
    m = PA.append(st["s"], st["root"], src, official=official_from(rows), splits={}, sessions=NEW)
    out = PA.materialize(st["s"], m["version_id"], str(st["tmp"] / "mat.db"))
    assert PA.content_sha(str(st["tmp"] / "mat.db"), upto=20260929)[0] == st["s"].manifest(st["root"])["content_sha256"]
    if "rebase" in kw:                                    # anchors disagree: the ticker is HELD, nothing appended
        assert m["appended"]["holds_by_reason"] == {"PRICE_BASIS_DIVERGENCE": 1}
    assert out["rows"] == 30 + m["appended"]["rows"]


def test_10b_a_reference_split_is_a_recorded_basis_event_and_market_cap_basis_is_today(st):
    src, rows = up(st, split=("SPL", 20261001, 20.0))      # 1-for-20 reverse split effective 2026-10-01
    m = PA.append(st["s"], st["root"], src, official=official_from(rows),
                  splits={"SPL": [["2026-10-01", 20, 1]]}, sessions=NEW)
    assert m["appended"]["basis_events"] == [["SPL", "2026-10-01", 20.0]] and m["appended"]["holds"] == 0
    D = sqlite3.connect(st["s"].path(m["version_id"], "delta.db"))
    stored = dict(D.execute("SELECT d, c FROM bar WHERE ticker='SPL'").fetchall())
    assert abs(stored[20260930] - (100.0 + 6 * 0.1)) < 1e-9          # stored on the ROOT basis
    PA.materialize(st["s"], m["version_id"], str(st["tmp"] / "mat.db"))
    M = sqlite3.connect(str(st["tmp"] / "mat.db"))
    mat = dict(M.execute("SELECT d, c FROM bar WHERE ticker='SPL'").fetchall())
    up_ = {d: c for t, d, c, _v in rows if t == "SPL"}
    assert all(abs(mat[d] / up_[d] - 1) < 1e-12 for d in mat)         # the build sees today's basis
    root = sqlite3.connect(st["s"].path(st["root"], "base.db"))
    assert root.execute("SELECT c FROM bar WHERE ticker='SPL' AND d=20260929").fetchone()[0] == 100.5  # never mutated


# ── 11-14: integrity ────────────────────────────────────────────────────────────────────────────────────────────────
def test_11_checksum_mismatch_refuses(st):
    p = st["s"].path(st["root"], "base.db")
    os.chmod(p, stat.S_IWRITE | stat.S_IREAD)
    db = sqlite3.connect(p)
    db.execute("UPDATE bar SET c=c*2 WHERE ticker='AAA'")
    db.commit()
    db.close()
    with pytest.raises(PA.PriceAuthorityError, match="does not match its sealed sha256"):
        st["s"].manifest(st["root"])


def test_12_missing_manifest_refuses(st):
    p = st["s"].path(st["root"], "manifest.json")
    os.chmod(p, stat.S_IWRITE | stat.S_IREAD)
    os.remove(p)
    with pytest.raises(PA.PriceAuthorityError, match="no manifest"):
        PA.materialize(st["s"], st["root"], str(st["tmp"] / "m.db"))


def test_13_a_child_that_mutates_parent_history_is_refused(st):
    src, rows = up(st)
    m = PA.append(st["s"], st["root"], src, official=official_from(rows), splits={}, sessions=NEW)
    d = st["s"].path(m["version_id"], "delta.db")
    os.chmod(d, stat.S_IWRITE | stat.S_IREAD)
    db = sqlite3.connect(d)
    db.execute("INSERT INTO bar VALUES('AAA', 20260925, 1.0, 1.0)")
    db.commit()
    db.close()
    with pytest.raises(PA.PriceAuthorityError):            # sha256 of the delta no longer matches
        PA.materialize(st["s"], m["version_id"], str(st["tmp"] / "m.db"))


def test_14_crash_while_sealing_leaves_no_version_and_retry_is_exact(st, monkeypatch):
    src, rows = up(st)
    real = PA.Store._seal

    def die(self, vid, manifest):
        raise KeyboardInterrupt("killed before the manifest")
    monkeypatch.setattr(PA.Store, "_seal", die)
    with pytest.raises(KeyboardInterrupt):
        PA.append(st["s"], st["root"], src, official=official_from(rows), splits={}, sessions=NEW)
    monkeypatch.setattr(PA.Store, "_seal", real)
    left = [v for v in os.listdir(st["s"].vdir) if v.startswith("PRICE-APPEND")]
    assert left and not st["s"].exists(left[0])           # an incomplete dir is not a version
    m = PA.append(st["s"], st["root"], src, official=official_from(rows), splits={}, sessions=NEW)
    assert m["version_id"] == left[0] and st["s"].exists(m["version_id"])
    again = PA.append(st["s"], st["root"], src, official=official_from(rows), splits={}, sessions=NEW)
    assert again["version_id"] == m["version_id"] and again.get("reused")   # orphan reuse, no duplicate


# ── new listings / inactive ─────────────────────────────────────────────────────────────────────────────────────────
def test_new_listing_enters_on_new_sessions_and_inactive_simply_stops(st):
    src, rows = up(st, new={"NEWCO": 5.0})
    rows = [r for r in rows if not (r[0] == "DDD" and r[1] > 20260929)]           # DDD delisted after the root
    src = mkdb(st["tmp"] / "bars2.db", rows, kind="ohlcv")
    m = PA.append(st["s"], st["root"], src, official=official_from(rows), splits={}, sessions=NEW)
    assert m["appended"]["new_listings"] == ["NEWCO"]
    D = sqlite3.connect(st["s"].path(m["version_id"], "delta.db"))
    assert D.execute("SELECT COUNT(*) FROM bar WHERE ticker='NEWCO'").fetchone()[0] == 3
    assert D.execute("SELECT COUNT(*) FROM bar WHERE ticker='DDD'").fetchone()[0] == 0


# ── 18-19: historical corrections ───────────────────────────────────────────────────────────────────────────────────
def test_18_19_correction_is_a_candidate_until_a_human_approves_it(st):
    corrected = mkdb(st["tmp"] / "corrected.db", upstream_rows(extra_days=[], rebase=("CCC", 0.5)))
    c = PA.propose_correction(st["s"], st["root"], corrected, reason="test", provenance={})
    assert c["kind"] == "HISTORICAL_CORRECTION" and c["status"] == "CANDIDATE"
    assert c["diff_summary"]["changed"]["tickers"] == 1
    with pytest.raises(PA.PriceAuthorityError, match="UNAPPROVED"):
        PA.materialize(st["s"], c["version_id"], str(st["tmp"] / "m.db"))
    src, rows = up(st)
    with pytest.raises(PA.PriceAuthorityError, match="UNAPPROVED"):                # never a parent either
        PA.append(st["s"], c["version_id"], src, official=official_from(rows), splits={}, sessions=NEW)
    for who in ("refresh:run-x", "scheduler"):
        with pytest.raises(PA.PriceAuthorityError, match="human"):
            PA.approve(st["s"], c["version_id"], by=who, reason="x", market_cap_gates="PASS")
    with pytest.raises(PA.PriceAuthorityError, match="did not PASS"):
        PA.approve(st["s"], c["version_id"], by="owner", reason="x", market_cap_gates="FAIL")
    PA.approve(st["s"], c["version_id"], by="owner", reason="reviewed", market_cap_gates="PASS")
    assert PA.materialize(st["s"], c["version_id"], str(st["tmp"] / "m.db"))["kind"] == "HISTORICAL_CORRECTION"


def test_divergence_monitor_reports_and_changes_nothing(st):
    src, rows = up(st, drop=("AAA", 20260925), rebase=("CCC", 0.5), add=[("BBB", 20200101, 1.0)])
    before = st["s"].manifest(st["root"])
    r = PA.divergence(st["s"], st["root"], src)
    assert r["lost"]["rows"] == 1 and r["gained"]["rows"] == 1 and r["changed"]["rebased_constant_factor"] == 0
    assert r["changed"]["tickers"] == 1 and st["s"].manifest(st["root"]) == before
