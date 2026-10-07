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


# ── refresh-level price-authority cases (15-17, 20) through the REAL Refresh._price_authority / price_parent ─────────
def _refresh_root(st, tmp, official, target):
    import gzip
    from api.services.marketcap import refresh as RF
    r = tmp / "rroot"
    r.mkdir(exist_ok=True)
    src, rows = up(st)
    (r / "refresh.json").write_text(json.dumps({
        "target": f"local:{target}", "policy": {"auto_advance": False},
        "sources": {"prices": {"kind": "price_authority", "store": str(st["s"].root[:-len("/prices")]),
                               "root_version": st["root"], "source": src,
                               "official": {"kind": "file", "path": str(official)}}}}))
    uni = tmp / "sec_t.json.gz"
    uni.write_bytes(gzip.compress(json.dumps({"1": ["", list(TICKERS)]}).encode()))
    return RF, str(r), src, rows, str(uni)


def _run(RF, root, uni, monkeypatch, run_id):
    from api.services.marketcap import price_authority as PA_
    monkeypatch.setattr(PA_, "completed_sessions", lambda after, now=None: [d for d in NEW if d > after])
    r = RF.Refresh(root, run_id)
    os.makedirs(r.data, exist_ok=True)
    open(os.path.join(r.data, "ref.jsonl"), "w").write(json.dumps(["SPL", {}, [], []]) + chr(10))
    return r._price_authority(r.cfg.sources["prices"], uni)


def test_15_16_17_a_sealed_but_unused_price_version_is_reused_exactly_on_retry(st, monkeypatch):
    tmp = st["tmp"]
    off = tmp / "official.json"
    off.write_text(json.dumps({str(k): v for k, v in official_from(upstream_rows()).items()}))
    RF, root, src, rows, uni = _refresh_root(st, tmp, off, tmp / "bucket")
    a = _run(RF, root, uni, monkeypatch, "run-a")            # sealed; then (16) the Market Cap build fails
    assert a["parent"] == st["root"] and a["last_session"] == 20261002 and not a["reused"]
    b = _run(RF, root, uni, monkeypatch, "run-b")            # (17) the retry: same inputs -> the SAME version, reused
    assert b["price_version"] == a["price_version"] and b["reused"] and b["content_sha256"] == a["content_sha256"]
    versions = [v for v in os.listdir(st["s"].vdir) if v.startswith("PRICE-APPEND")]
    assert versions == [a["price_version"]]                  # no duplicate; nothing became authority by existing


def test_20_market_cap_rollback_carries_the_price_lineage(st, monkeypatch):
    from api.services.marketcap import publication as P
    from .lifecycle_fixtures import make_build, make_prices, manifest_fields, passing_validation
    tmp = st["tmp"]
    off = tmp / "official.json"
    off.write_text(json.dumps({str(k): v for k, v in official_from(upstream_rows()).items()}))
    bucket = tmp / "bucket"
    RF, root, src, rows, uni = _refresh_root(st, tmp, off, bucket)
    child = _run(RF, root, uni, monkeypatch, "run-a")["price_version"]
    t = P.LocalTarget(str(bucket))
    pdb = make_prices(str(tmp / "px.db"))
    sha = {}
    for bid, pv in (("MCAP_V1-20261002T050000Z", st["root"]), ("MCAP_V1-20261003T050000Z", child)):
        db = make_build(str(tmp / f"{bid}.db"), bid, last_day=20261001)
        mf = manifest_fields(bid, P.file_sha(db)[0])
        mf["inputs"]["price_authority"] = {"version": pv}
        sha[bid] = P.publish_build(t, build_db=db, prices_db=pdb, manifest_fields=mf, validation=passing_validation())["manifest_sha256"]
    r = RF.Refresh(root, "run-x")
    sp = r.cfg.sources["prices"]
    assert r.price_parent(sp) == st["root"]                   # no authority yet: the sealed root
    P.advance(t, "MCAP_V1-20261002T050000Z", sha["MCAP_V1-20261002T050000Z"], expect_current=None, by="o", reason="c",
              acceptance="HUMAN_CUTOVER")
    P.advance(t, "MCAP_V1-20261003T050000Z", sha["MCAP_V1-20261003T050000Z"], expect_current="MCAP_V1-20261002T050000Z",
              by="o", reason="n", acceptance="HUMAN_CUTOVER")
    assert r.price_parent(sp) == child                       # appends continue from the authority's own price version
    P.rollback(t, "MCAP_V1-20261002T050000Z", sha["MCAP_V1-20261002T050000Z"], expect_current="MCAP_V1-20261003T050000Z",
               by="o", reason="rollback")
    assert r.price_parent(sp) == st["root"]                   # rollback = the price lineage of the restored artifact


def test_an_authority_without_a_price_version_must_be_built_on_the_root(st, monkeypatch):
    from api.services.marketcap import publication as P
    from .lifecycle_fixtures import make_build, make_prices, manifest_fields, passing_validation
    tmp = st["tmp"]
    off = tmp / "official.json"
    off.write_text("{}")
    bucket = tmp / "bucket"
    RF, root, *_ = _refresh_root(st, tmp, off, bucket)
    t = P.LocalTarget(str(bucket))
    bid = "MCAP_V1-20261002T050000Z"
    db = make_build(str(tmp / "b.db"), bid, last_day=20261001)
    mf = manifest_fields(bid, P.file_sha(db)[0])
    mf["inputs"]["files"] = {"prices.db": {"sha256": "e" * 64, "bytes": 1}}     # NOT the sealed root
    s = P.publish_build(t, build_db=db, prices_db=make_prices(str(tmp / "px.db")), manifest_fields=mf,
                        validation=passing_validation())["manifest_sha256"]
    P.advance(t, bid, s, expect_current=None, by="o", reason="c", acceptance="HUMAN_CUTOVER")
    r = RF.Refresh(root, "run-y")
    with pytest.raises(RuntimeError, match="ambiguous"):
        r.price_parent(r.cfg.sources["prices"])


def test_a_production_refresh_can_never_bypass_the_price_authority(tmp_path):
    from api.services.marketcap import refresh as RF
    r = tmp_path / "prod"
    r.mkdir()
    (r / "refresh.json").write_text(json.dumps({"target": "r2", "sources": {
        "universe": {"kind": "file", "path": str(tmp_path / "u.json.gz")},
        "prices": {"kind": "bars_db", "db": "/data/bars.db"}}}))
    import gzip
    (tmp_path / "u.json.gz").write_bytes(gzip.compress(b'{"1": ["", ["AAA"]]}'))
    with pytest.raises(RuntimeError, match="only through the price authority"):
        RF.Refresh(str(r), "run-p").sources()


def test_counterfactual_mutable_bars_history_is_never_an_ordinary_append(st):
    """The regression the production-lifecycle gate found: today's mutable bars history (rows lost, gained, re-based,
    repaired) substituted for the sealed authority. The ordinary path appends ONLY new sessions and the accepted history
    is unchanged; the full substitution exists only as a HISTORICAL_CORRECTION candidate that nothing can use."""
    mutated = dict(drop=("AAA", 20260924), add=[("BBB", 20250102, 9.0)], change=("DDD", 20260923, 41.7))
    src, rows = up(st, **mutated)
    m = PA.append(st["s"], st["root"], src, official=official_from(rows), splits={}, sessions=NEW)
    PA.materialize(st["s"], m["version_id"], str(st["tmp"] / "mat.db"))
    assert PA.content_sha(str(st["tmp"] / "mat.db"), upto=20260929)[0] == st["s"].manifest(st["root"])["content_sha256"]
    whole = mkdb(st["tmp"] / "whole.db", upstream_rows(extra_days=[], **mutated))
    c = PA.propose_correction(st["s"], st["root"], whole, reason="counterfactual", provenance={})
    assert c["diff_summary"]["lost"]["rows"] == 1 and c["diff_summary"]["gained"]["rows"] == 1
    assert c["diff_summary"]["changed"]["rows"] == 1
    with pytest.raises(PA.PriceAuthorityError, match="UNAPPROVED"):
        PA.materialize(st["s"], c["version_id"], str(st["tmp"] / "x.db"))


# ── finality evidence ──────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("c,v,oc,prev,conv,prev_t,want", [
    (10.12, 500.0, 10.12, 10.0, 1.0, 10.0, ("OFFICIAL", 10.12)),
    (0.0112, 9.0, 0.011202, 0.01, 1.0, 0.01, ("OFFICIAL", 0.0112)),           # the aggregate's 4-decimal rounding
    (0.8051, 9.0, 6.4409, 0.8, 8.0, 0.8, ("OFFICIAL", 0.8051)),               # aggregate already on a LATER split
    (6.4409, 9.0, 6.4409, 6.4, 8.0, 0.8, ("OFFICIAL_SPLIT_BASIS", 6.4409 / 8)),  # bars.db already on it too
    (10.12, 0.0, None, 10.12, 1.0, 10.12, ("NO_TRADE_CARRY", 10.12)),
    (10.30, 0.0, None, 10.12, 1.0, 10.12, (None, None)),                      # "no trade" with a different close
    (10.05, 182744.0, None, 10.0, 1.0, 10.0, (None, None)),                   # traded but not in the aggregate
    (175.325, 846010.0, 175.03, 175.0, 1.0, 175.0, (None, None)),             # a partial bar (M3's 09-29 class)
    (0.8051, 9.0, 6.4409, 0.8, 1.0, 0.8, (None, None)),                       # a factor no reference split explains
])
def test_finality_rule(c, v, oc, prev, conv, prev_t, want):
    got = PA._finality(c, v, oc, prev, conv, prev_t)
    assert got[0] == want[0] and (got[1] is None or abs(got[1] - want[1]) < 1e-12)


def test_finality_bars_still_on_the_pre_event_basis():
    # CMND 1-for-8 on 2026-10-05 inside the version: bars.db 09-30 0.8051 (not yet re-based), official 6.4409
    assert PA._finality(0.8051, 99780.0, 6.4409, 0.8, 1.0, 0.8, pre=8.0) == ("OFFICIAL_PRE_EVENT_BASIS", 0.8051 * 8.0)
    assert PA._finality(0.8051, 99780.0, 6.4409, 0.8, 1.0, 0.8, pre=1.0) == (None, None)    # without the event: held


def _unused_finality(c, v, oc, prev, conv, prev_t, want):
    got = PA._finality(c, v, oc, prev, conv, prev_t)
    assert got[0] == want[0] and (got[1] is None or abs(got[1] - want[1]) < 1e-12)


def test_kust_class_split_after_the_root_with_bars_db_not_yet_rebased(st):
    """KUST 2026-10-01 (1-for-10): bars.db history still PRE-split, its new rows POST-split (== the official
    aggregate). The reference split is a BASIS_EVENT (the builder applies the same split to shares), the new rows are
    stored on the root basis, and the materialized series is continuous on today's basis -- never a x10 jump, never a
    x0.1 history."""
    rows = upstream_rows(extra_days=[])
    rows += [("SPL", d, (100.0 + i * 0.1) * 20, 1000.0) for i, d in enumerate(NEW, start=6)]   # post-split new rows
    rows += [(t, d, p + i * 0.1, 1000.0) for t, p in TICKERS.items() if t != "SPL" for i, d in enumerate(NEW, start=6)]
    src = mkdb(st["tmp"] / "kust.db", rows, kind="ohlcv")
    m = PA.append(st["s"], st["root"], src, official=official_from(rows), splits={"SPL": [["2026-10-01", 20, 1]]},
                  sessions=NEW, official_basis_date=20261006)
    assert m["appended"]["basis_events"] == [["SPL", "2026-10-01", 20.0]] and m["appended"]["holds"] == 0
    D = sqlite3.connect(st["s"].path(m["version_id"], "delta.db"))
    assert D.execute("SELECT split FROM basis_event").fetchone()[0] == "UPSTREAM_NOT_YET_REBASED"
    PA.materialize(st["s"], m["version_id"], str(st["tmp"] / "mat.db"))
    M = sqlite3.connect(str(st["tmp"] / "mat.db"))
    mat = [c for _d, c in M.execute("SELECT d, c FROM bar WHERE ticker='SPL' ORDER BY d")]
    assert all(abs(b / a - 1) < 0.01 for a, b in zip(mat, mat[1:]))       # continuous: no split-sized step anywhere
    assert abs(mat[-1] - (100.0 + 8 * 0.1) * 20) < 1e-9                  # today's basis


def test_a_no_trade_day_absent_from_the_aggregate_is_appended(st):
    rows = upstream_rows()
    rows = [(t, d, (TICKERS["AAA"] + 5 * 0.1) if (t == "AAA" and d == 20260930) else c,
             0.0 if (t == "AAA" and d == 20260930) else v) for t, d, c, v in rows]
    src = mkdb(st["tmp"] / "nt.db", rows, kind="ohlcv")
    off = official_from(rows)
    del off[20260930]["AAA"]                                                # the aggregate omits a no-trade day
    m = PA.append(st["s"], st["root"], src, official=off, splits={}, sessions=NEW)
    assert m["appended"]["finality_evidence"].get("NO_TRADE_CARRY") == 1 and m["appended"]["holds"] == 0
    D = sqlite3.connect(st["s"].path(m["version_id"], "delta.db"))
    assert D.execute("SELECT c FROM bar WHERE ticker='AAA' AND d=20260930").fetchone()[0] == TICKERS["AAA"] + 5 * 0.1


def test_divergence_recent_window_sees_only_the_window(st):
    src, rows = up(st, drop=("AAA", 20260922), change=("BBB", 20260929, 99.0))
    full = PA.divergence(st["s"], st["root"], src)
    win = PA.divergence(st["s"], st["root"], src, since=20260925)
    assert full["lost"]["rows"] == 1 and full["changed"]["rows"] == 1
    assert win["lost"]["rows"] == 0 and win["changed"]["rows"] == 1 and win["window_from"] == 20260925
