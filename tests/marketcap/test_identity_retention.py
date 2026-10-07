"""DURABLE ISSUER IDENTITY (owner decision 2026-10-05): a company's disappearance from SEC's CURRENT ticker mapping never
erases its valid PIT history. Every test runs the REAL build (build.main) on a tiny data dir (identity_fixtures.py)."""
from __future__ import annotations

import os
import shutil
import sqlite3
from datetime import date

import pytest

from api.services.marketcap import build as B, identity_delta as ID, identity_ledger as IL, reasons as R
from api.services.marketcap.serve import Authority

from .identity_fixtures import Fixture, build, rows, valued

SPAN = (date(2019, 1, 1), date(2026, 9, 30))          # quarterly covers through 2026-09-30 (last filed 2026-11-04)


def _ledger_from(data: str, path: str) -> str:
    IL.record(path, os.path.join(data, "inputs.db"))
    return path


def _with_ledger(data: str, ledger: str) -> str:
    shutil.copyfile(ledger, os.path.join(data, "identity.db"))
    IL.record(os.path.join(data, "identity.db"), os.path.join(data, "inputs.db"))
    return data


def _manual_ledger(path: str, seen: list[tuple]) -> str:
    """[(cik, ticker, last_as_of, position)] -- an attribution SEC made in an older accepted snapshot."""
    c = IL.connect(path)
    with c:
        for cik, t, last, pos in seen:
            c.execute("INSERT INTO snapshot VALUES (?,?,?,?,?,?)", (f"s-{cik}-{t}", last, "TEST", 1, 1, pos + 1))
            c.execute("INSERT OR IGNORE INTO issuer_seen VALUES (?,?,?)", (cik, last, last))
            c.execute("INSERT INTO ticker_seen VALUES (?,?,?,?,?)", (cik, t, last, last, pos))
    c.close()
    return path


@pytest.fixture
def webster(tmp_path):
    fx = Fixture(str(tmp_path), {101: {"name": "WEBSTER-LIKE", "shares": 50e6, "span": SPAN,
                                       "bars": {"WBX": (date(2019, 3, 1), date(2026, 8, 20), 40.0)}}})
    old = fx.write({101: ["WBX", "WBX-PF"]}, "old")
    ledger = _ledger_from(old, str(tmp_path / "identity.db"))
    return fx, old, ledger, build(old, str(tmp_path / "out_old"))


# 1 ------------------------------------------------------------------------------------------------------------------
def test_current_ticker_disappears_historical_issuer_survives(webster, tmp_path):
    fx, _old, ledger, ref = webster
    before = valued(ref, 101)
    assert len(before) > 1500
    new = _with_ledger(fx.write({101: []}, "new"), ledger)                       # SEC emptied the list
    after = valued(build(new, str(tmp_path / "out_new")), 101)
    assert after == before
    # the defect, reproduced: the same inputs WITHOUT the durable ledger erase the whole history
    ctl = fx.write({101: []}, "ctl")
    assert valued(build(ctl, str(tmp_path / "out_ctl")), 101) == {}


# 2 ------------------------------------------------------------------------------------------------------------------
def test_deregistered_issuer_keeps_its_observations(webster, tmp_path):
    fx, _old, ledger, ref = webster
    new = _with_ledger(fx.write({101: []}, "new", extra_filings={101: [("15-12G", date(2026, 11, 20))]}), ledger)
    b = build(new, str(tmp_path / "out_new"))
    assert valued(b, 101) == valued(ref, 101)
    assert rows(b, "SELECT ticker, status FROM identity_retention WHERE cik=101 AND status='RETAINED'") == [("WBX", "RETAINED")]
    # the share-state evidence (observations / state runs) is the same set
    q = "SELECT class_key, start, end, shares, obs_accession FROM state_run WHERE issuer_id='cik:101' ORDER BY start"
    assert rows(b, q) == rows(ref, q)


# 3 ------------------------------------------------------------------------------------------------------------------
def test_acquired_issuer_keeps_pre_acquisition_history_and_nothing_after(webster, tmp_path):
    fx, _old, ledger, ref = webster
    # merger closes 2026-08-20 (last bar); SEC drops the symbol; the symbol later trades again for someone else
    new = _with_ledger(fx.write({101: []}, "new", extra_filings={101: [("25-NSE", date(2026, 8, 21))]},
                                bars={"WBX": [(date(2019, 3, 1), date(2026, 8, 20), 40.0),
                                              (date(2026, 12, 1), date(2027, 3, 1), 9.0)]}), ledger)
    after = valued(build(new, str(tmp_path / "out_new")), 101)
    assert after == valued(ref, 101)
    assert max(after) <= 20260820


# 4 ------------------------------------------------------------------------------------------------------------------
def test_rename_with_re_keyed_history_stays_one_issuer(tmp_path):
    fx = Fixture(str(tmp_path), {201: {"name": "RENAMED", "shares": 10e6, "span": SPAN,
                                       "bars": {"OLDT": (date(2019, 3, 1), date(2026, 9, 29), 12.0)}}})
    old = fx.write({201: ["OLDT"]}, "old")
    ledger = _ledger_from(old, str(tmp_path / "identity.db"))
    ref = build(old, str(tmp_path / "out_old"))
    # the provider re-keys the whole history under the new symbol; SEC lists only NEWT
    new = _with_ledger(fx.write({201: ["NEWT"]}, "new", bars={"OLDT": None, "NEWT": (date(2019, 3, 1), date(2026, 9, 29), 12.0)}),
                       ledger)
    b = build(new, str(tmp_path / "out_new"))
    assert valued(b, 201) == valued(ref, 201)
    assert rows(b, "SELECT DISTINCT cik FROM ticker_map WHERE ticker='NEWT'") == [(201,)]
    assert rows(b, "SELECT status FROM identity_retention WHERE ticker='OLDT'") == [("RETAINED_NO_BARS",)]


def test_rename_where_both_symbols_still_carry_bars_fails_closed_never_silently(tmp_path):
    fx = Fixture(str(tmp_path), {201: {"name": "RENAMED", "shares": 10e6, "span": SPAN,
                                       "bars": {"OLDT": (date(2019, 3, 1), date(2026, 9, 29), 12.0)}}})
    old = fx.write({201: ["OLDT"]}, "old")
    ledger = _ledger_from(old, str(tmp_path / "identity.db"))
    ref = build(old, str(tmp_path / "out_old"))
    new = _with_ledger(fx.write({201: ["NEWT"]}, "new", bars={"NEWT": (date(2019, 3, 1), date(2026, 9, 29), 12.0)}), ledger)
    b = build(new, str(tmp_path / "out_new"))
    d = ID.delta(b, ref)
    # two concurrently priced symbols read as two classes (the accepted multi-class guard): the history is HELD with
    # a reason -- but because the mapping changed, retention cannot accept that hold without a person
    assert valued(b, 201) == {}
    assert not d["pass"] and {x["class"] for x in d["failing_blocks"]} == {"IDENTITY_UNATTESTED"}


# 5 ------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("massive_names_new_issuer", [True, False])
def test_ticker_reuse_by_a_different_issuer_keeps_histories_separate(tmp_path, massive_names_new_issuer):
    fx = Fixture(str(tmp_path), {
        301: {"name": "OLD CO", "shares": 5e6, "span": (date(2009, 1, 1), date(2015, 3, 31)), "bars": {}},
        302: {"name": "NEW CO", "shares": 80e6, "span": (date(2015, 7, 1), date(2026, 9, 30)), "bars": {}}})
    refs = {"REU": {"ticker": "REU", "cik": "0000000302", "type": "CS", "active": True, "list_date": "2016-01-04"}} \
        if massive_names_new_issuer else {}
    data = fx.write({301: [], 302: ["REU"]}, "new", refs=refs,
                    bars={"REU": [(date(2010, 1, 4), date(2015, 3, 31), 20.0), (date(2016, 1, 4), date(2026, 9, 29), 55.0)]})
    ledger = _manual_ledger(str(tmp_path / "identity.db"), [(301, "REU", "2015-05-15", 0)])
    b = build(_with_ledger(data, ledger), str(tmp_path / "out"))
    old, new = valued(b, 301), valued(b, 302)
    assert new and min(new) >= 20160104                                     # the new issuer inherits nothing
    assert all(abs(v / (80e6 * 55.0) - 1) < 1e-9 for v in new.values())
    # M3.1 (owner decision 2026-10-06): a later reassignment never erases the predecessor's proven history -- it is
    # retained to its last attribution (and, when Massive names another CIK, bounded by the succession boundary)
    assert old and max(old) <= 20150331 and min(old) >= 20100104
    assert all(abs(v / (5e6 * 20.0) - 1) < 1e-9 for v in old.values())
    if massive_names_new_issuer:
        st = rows(b, "SELECT status FROM identity_retention WHERE cik=301")
        assert ("SUCCESSION_BOUNDARY",) in st and ("WITHHELD_REASSIGNED",) not in st
    assert not (set(old) & set(new))


# 6 ------------------------------------------------------------------------------------------------------------------
def test_multiple_historical_tickers_map_point_in_time(tmp_path):
    fx = Fixture(str(tmp_path), {401: {"name": "CHAIN", "shares": 20e6, "span": (date(2015, 1, 1), date(2026, 9, 30)),
                                       "bars": {"OLDA": (date(2015, 3, 2), date(2018, 5, 31), 5.0),
                                                "MIDB": (date(2018, 6, 1), date(2022, 5, 31), 7.0),
                                                "NEWC": (date(2022, 6, 1), date(2026, 9, 29), 9.0)}}})
    data = fx.write({401: ["NEWC"]}, "new")
    ledger = _manual_ledger(str(tmp_path / "identity.db"), [(401, "OLDA", "2018-06-15", 0), (401, "MIDB", "2022-06-15", 0)])
    b = build(_with_ledger(data, ledger), str(tmp_path / "out"))
    tm = {t: (s, e) for t, s, e in rows(b, "SELECT ticker, start, end FROM ticker_map WHERE cik=401")}
    assert tm["OLDA"][0] == "2015-03-02" and tm["MIDB"][0] == "2018-06-01" and tm["NEWC"][0] == "2022-06-01"
    a = Authority(b)
    assert a.issuer_for("OLDA")[0] == 401 and a.issuer_for("MIDB")[0] == 401 and a.issuer_for("NEWC")[0] == 401
    assert a.issuer_for("OLDA")[1]["current"] is False and "current" not in a.issuer_for("NEWC")[1]
    # non-overlapping earlier symbols are the same security, not extra classes: the current symbol is valued
    v = valued(b, 401)
    assert v and min(v) >= 20220601 and all(abs(x / (20e6 * 9.0) - 1) < 1e-9 for x in v.values())


# 7 ------------------------------------------------------------------------------------------------------------------
def test_current_ticker_addition_never_backfills_before_its_evidence(tmp_path):
    fx = Fixture(str(tmp_path), {501: {"name": "ADDED", "shares": 30e6, "span": (date(2024, 10, 1), date(2026, 9, 30)), "bars": {}}})
    data = fx.write({501: ["ADN"]}, "new",
                    bars={"ADN": [(date(2012, 1, 3), date(2013, 6, 28), 3.0), (date(2025, 1, 2), date(2026, 9, 29), 15.0)]})
    ledger = _manual_ledger(str(tmp_path / "identity.db"), [])
    b = build(_with_ledger(data, ledger), str(tmp_path / "out"))
    v = valued(b, 501)
    assert v and min(v) >= 20250102
    reasons = {r for _s, _e, r in rows(b, "SELECT start, end, reason FROM gap_run WHERE cik=501 AND end < 20140101")}
    assert reasons == {R.TICKER_REUSE}


# 8 ------------------------------------------------------------------------------------------------------------------
def test_removed_ticker_is_served_as_history_never_as_current(webster, tmp_path):
    fx, _old, ledger, ref = webster
    b = build(_with_ledger(fx.write({101: []}, "new"), ledger), str(tmp_path / "out_new"))
    s = Authority(b).series("WBX")
    assert s["listing"]["current"] is False and s["listing"]["last_attributed"]
    assert "current" not in Authority(ref).series("WBX")["listing"]       # a current symbol's document is unchanged
    assert s["points"] == Authority(ref).series("WBX")["points"]


# 9 ------------------------------------------------------------------------------------------------------------------
def test_rebuild_twice_from_identical_evidence_is_identical(webster, tmp_path):
    fx, _old, ledger, _ref = webster
    new = _with_ledger(fx.write({101: []}, "new"), ledger)
    b1, b2 = build(new, str(tmp_path / "o1")), build(new, str(tmp_path / "o2"))
    for q in ("SELECT * FROM cap_daily ORDER BY cik, d", "SELECT * FROM gap_run ORDER BY cik, start",
              "SELECT * FROM ticker_map ORDER BY ticker, cik", "SELECT * FROM identity_retention ORDER BY cik, ticker",
              "SELECT * FROM state_run ORDER BY issuer_id, class_key, start"):
        assert rows(b1, q) == rows(b2, q)


# 10 -----------------------------------------------------------------------------------------------------------------
def test_a_later_sec_state_cannot_erase_earlier_attributions(webster, tmp_path):
    fx, _old, ledger, ref = webster
    first_last = IL.connect(ledger, readonly=True).execute("SELECT last_as_of FROM ticker_seen WHERE ticker='WBX'").fetchone()[0]
    later = fx.write({101: []}, "later", extra_filings={101: [("8-K", date(2027, 1, 15))]})
    IL.record(ledger, os.path.join(later, "inputs.db"))                      # a newer snapshot without the symbol
    c = IL.connect(ledger, readonly=True)
    assert c.execute("SELECT last_as_of FROM ticker_seen WHERE cik=101 AND ticker='WBX'").fetchone()[0] == first_last
    assert IL.retained(c, 101, []) == [("WBX", date.fromisoformat(first_last)), ("WBX-PF", date.fromisoformat(first_last))]
    c.close()
    with pytest.raises(IL.IdentityError):                                 # an OLDER snapshot can never be recorded after it
        older = fx.write({101: []}, "older")
        sqlite3.connect(os.path.join(older, "inputs.db")).execute("DELETE FROM filing WHERE filing_date > '2020-01-01'").connection.commit()
        IL.record(ledger, os.path.join(older, "inputs.db"))
    b = build(_with_ledger(later, ledger), str(tmp_path / "out"))
    assert valued(b, 101) == valued(ref, 101)
    assert ID.delta(b, ref)["pass"]


# the retention rail is real: disabling it reproduces the WBS loss and gate R catches it -------------------------------
def test_mutation_disabling_retention_is_caught_by_the_gate(webster, tmp_path, monkeypatch):
    fx, _old, ledger, ref = webster
    new = _with_ledger(fx.write({101: []}, "new"), ledger)
    assert ID.delta(build(new, str(tmp_path / "ok")), ref)["pass"]
    monkeypatch.setattr(B, "retained_tickers", lambda conn, cik, current: [])
    broken = build(new, str(tmp_path / "broken"))
    d = ID.delta(broken, ref)
    assert valued(broken, 101) == {}
    assert not d["pass"] and d["issuers"]["removed_unexplained"] == [{"cik": 101, "ticker": "WBX"}]
    assert {x["class"] for x in d["failing_blocks"]} == {"UNEXPLAINED"}


def test_gate_fails_without_a_reference_and_passes_only_an_explicit_first_build(webster):
    _fx, _old, _ledger, ref = webster
    assert not ID.delta(ref, "")["pass"] and not ID.delta(ref, "C:/nonexistent.db")["pass"]
    assert ID.delta(ref, ID.FIRST_BUILD)["pass"]


def test_an_attested_identity_correction_is_accepted_and_listed(webster, tmp_path, monkeypatch):
    fx, _old, ledger, ref = webster
    monkeypatch.setattr(B, "retained_tickers", lambda conn, cik, current: [])
    broken = build(_with_ledger(fx.write({101: []}, "new"), ledger), str(tmp_path / "b"))
    att = [{"cik": 101, "start": 19000101, "end": 29991231, "reason": "IDENTITY_ATTRIBUTION_PROVEN_WRONG", "evidence": "test"}]
    d = ID.delta(broken, ref, att)
    assert d["pass"] and {x["class"] for x in d["removed_blocks"]} == {"ATTESTED"}


def test_durable_universe_keeps_issuers_that_left_the_current_universe(webster, tmp_path):
    import gzip
    import json
    _fx, _old, ledger, _ref = webster
    cur = tmp_path / "u.json.gz"
    cur.write_bytes(gzip.compress(json.dumps({"999": ["", ["ZZZ"]]}).encode()))
    out = tmp_path / "durable.json.gz"
    r = IL.durable_universe(ledger, str(cur), str(out))
    u = json.loads(gzip.decompress(out.read_bytes()))
    assert u["999"] == ["", ["ZZZ"]] and set(u["101"][1]) == {"WBX", "WBX-PF"}
    assert r["retained_issuers_added"] == 1


# the refresh owns the ledger: carried forward, recorded, never optional ---------------------------------------------
def _refresh_root(tmp_path, webster_ledger=None):
    import gzip
    import json
    from api.services.marketcap import refresh as RF
    root = tmp_path / "root"
    (root / "seed").mkdir(parents=True)
    src = tmp_path / "src"
    src.mkdir()
    (src / "u.json.gz").write_bytes(gzip.compress(json.dumps({"101": ["", []]}).encode()))
    (src / "prices.db").write_bytes(b"")
    (src / "ref.jsonl").write_text("")
    (root / "refresh.json").write_text(json.dumps({"target": f"local:{tmp_path / 'bucket'}", "sources": {
        "universe": {"kind": "file", "path": str(src / "u.json.gz")}, "prices": {"kind": "file", "path": str(src / "prices.db")},
        "reference": {"kind": "file", "path": str(src / "ref.jsonl")}}}))
    if webster_ledger:
        shutil.copyfile(webster_ledger, root / "seed" / "identity.db")
    return RF.Refresh(str(root), "run-test")


def test_refresh_refuses_to_build_without_a_durable_identity_ledger(webster, tmp_path):
    fx, _old, _ledger, _ref = webster
    r = _refresh_root(tmp_path)
    Fixture(r.rdir, fx.issuers).write({101: []}, "data")
    with pytest.raises(RuntimeError, match="durable identity"):
        r._identity()


def test_refresh_carries_the_ledger_forward_and_the_universe_keeps_retained_issuers(webster, tmp_path):
    import gzip
    import json
    fx, _old, ledger, _ref = webster
    r = _refresh_root(tmp_path, ledger)
    res = r.sources()
    u = json.loads(gzip.decompress(open(os.path.join(r.data, "sec_t.json.gz"), "rb").read()))
    assert set(u["101"][1]) == {"WBX", "WBX-PF"} and res["universe"]["durable"]["retained_tickers_added"] == 2
    Fixture(r.rdir, fx.issuers).write({101: []}, "data", extra_filings={101: [("15-12G", date(2026, 11, 20))]})
    out = r._identity()
    assert out["recorded"] and out["counts"]["snapshot"] == 2
    c = IL.connect(os.path.join(r.data, "identity.db"), readonly=True)
    assert [t for t, _d in IL.retained(c, 101, [])] == ["WBX", "WBX-PF"]
    assert os.path.getsize(os.path.join(r.root, "seed", "identity.db")) == os.path.getsize(ledger)   # the seed is never written
