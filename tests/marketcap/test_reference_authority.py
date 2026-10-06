"""Market Cap REFERENCE / SPLIT EVIDENCE AUTHORITY (owner decision 2026-10-06): sealed root, append-only merge of fresh
pulls, divergences kept accepted, explicit human-approved REFERENCE_HISTORICAL_CORRECTION."""
from __future__ import annotations

import json
import os
import stat

import pytest

from api.services.marketcap import reference_authority as RA


def rec(t, cik="0000000001", typ="CS", splits=(), events=(), active=True, list_date="2010-01-04"):
    return [t, {"ticker": t, "name": t + " Inc", "market": "stocks", "locale": "us", "primary_exchange": "XNAS", "type": typ,
                "active": active, "cik": cik, "composite_figi": "F" + t, "share_class_figi": None, "list_date": list_date,
                "delisted_utc": None, "share_class_shares_outstanding": 1, "weighted_shares_outstanding": 1,
                "market_cap": 1.0, "currency_name": "usd"}, [list(s) for s in splits], list(events)]


EMPTY = lambda t: [t, {k: None for k in rec(t)[1]}, [], []]


def write(p, rows):
    RA.dump({r[0]: r for r in rows}, str(p))
    return str(p)


@pytest.fixture
def st(tmp_path):
    s = RA.Store(str(tmp_path / "root"))
    root = write(tmp_path / "m3_ref.jsonl", [
        rec("ECL", splits=[["2003-06-09", 1, 3]]),
        rec("NTRB"), rec("NTRBW", typ="WARRANT"),
        rec("KUST", splits=[["2026-10-01", 10, 1]]),
        rec("CBAT", cik="0002086841")])
    m = RA.seal_root(s, root, expect_sha256=RA.sha(root), as_of="2026-09-30", provenance={})
    return {"s": s, "root": m["version_id"], "tmp": tmp_path, "src": root}


def pulled(st, rows):
    return write(st["tmp"] / "pulled.jsonl", rows)


def test_root_is_the_accepted_bytes_and_refuses_an_approximation(st):
    m = st["s"].manifest(st["root"])
    assert m["files"]["ref.jsonl"] == RA.sha(st["src"]) and m["as_of"] == "2026-09-30" and m["tickers"] == 5
    with pytest.raises(RA.ReferenceAuthorityError, match="approximation"):
        RA.seal_root(st["s"], st["src"], expect_sha256="0" * 64, as_of="x", provenance={})


def test_append_keeps_history_and_takes_only_admissible_new_evidence(st):
    p = pulled(st, [
        rec("ECL", splits=[["2003-06-09", 1, 2]]),                    # upstream REWROTE a historical split
        rec("NTRB", active=False),                                    # current state changed
        EMPTY("NTRBW"),                                               # the warrant record vanished upstream
        rec("KUST", splits=[["2026-10-01", 10, 1], ["2026-10-20", 1, 2]]),   # a NEW split after the snapshot
        rec("CBAT", cik="0002086841"),
        rec("NEWCO", splits=[])])                                     # a new ticker
    m = RA.append(st["s"], st["root"], p, pulled_at="2026-10-06T04:00:00Z")
    out = RA.load(st["s"].path(m["version_id"], "ref.jsonl"))
    assert out["ECL"][2] == [["2003-06-09", 1, 3]]                    # accepted history kept
    assert out["NTRBW"][1]["type"] == "WARRANT"                       # a vanished record never erases evidence
    assert out["NTRB"][1]["active"] is False                          # current-state fields follow upstream
    assert ["2026-10-20", 1, 2] in out["KUST"][2]                     # genuinely new corporate action appended
    assert "NEWCO" in out and m["merge"]["added"] == 1 and m["merge"]["n_vanished_upstream"] == 1
    dv = json.load(open(st["s"].path(m["version_id"], "divergence.json")))
    assert any(d["ticker"] == "ECL" and d["field"] == "split" for d in dv)
    assert m["as_of"] == "2026-10-06" and m["parent"] == st["root"]


def test_an_identical_pull_is_no_new_version(st):
    m = RA.append(st["s"], st["root"], st["src"], pulled_at="2026-10-06T04:00:00Z")
    assert m.get("unchanged") and m["version_id"] == st["root"]


def test_correction_is_a_candidate_until_a_human_approves_it(st):
    p = pulled(st, [rec("ECL", splits=[["2003-06-09", 1, 2]])])
    c = RA.propose_correction(st["s"], st["root"], p, tickers=["ECL"], reason="ECL 2003 is 2-for-1")
    assert c["kind"] == "REFERENCE_HISTORICAL_CORRECTION" and c["status"] == "CANDIDATE"
    with pytest.raises(RA.ReferenceAuthorityError, match="UNAPPROVED"):
        RA.materialize(st["s"], c["version_id"], str(st["tmp"] / "x.jsonl"))
    with pytest.raises(RA.ReferenceAuthorityError, match="UNAPPROVED"):          # never a parent either
        RA.append(st["s"], c["version_id"], st["src"], pulled_at="2026-10-07T00:00:00Z")
    # the correction-impact driver (dark) may read it explicitly
    RA.materialize(st["s"], c["version_id"], str(st["tmp"] / "x.jsonl"), allow_candidate=True)
    for who in ("refresh:run-x", "scheduler"):
        with pytest.raises(RA.ReferenceAuthorityError, match="human"):
            RA.approve(st["s"], c["version_id"], by=who, reason="x", market_cap_gates="PASS")
    with pytest.raises(RA.ReferenceAuthorityError, match="did not PASS"):
        RA.approve(st["s"], c["version_id"], by="owner", reason="x", market_cap_gates="FAIL")
    RA.approve(st["s"], c["version_id"], by="owner", reason="reviewed", market_cap_gates="PASS")
    assert RA.materialize(st["s"], c["version_id"], str(st["tmp"] / "y.jsonl"))["kind"] == "REFERENCE_HISTORICAL_CORRECTION"


def test_a_tampered_version_is_refused(st):
    p = st["s"].path(st["root"], "ref.jsonl")
    os.chmod(p, stat.S_IWRITE | stat.S_IREAD)
    open(p, "a").write("x")
    with pytest.raises(RA.ReferenceAuthorityError, match="sealed sha256"):
        RA.materialize(st["s"], st["root"], str(st["tmp"] / "z.jsonl"))
