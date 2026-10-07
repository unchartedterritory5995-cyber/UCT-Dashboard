"""Final mutable-input closure (owner decisions 2026-10-06): ADR ratio words, current-state evidence boundaries, sealed
SEC filing metadata, HISTORY on accepted-value removal. Each case mirrors the measured incident (SOGP, TVGN, ALP)."""
from __future__ import annotations

import gzip
import json
import os
import sqlite3

import pytest

from api.services.marketcap import adr, history as H, reference_authority as RA, sec_authority as SA
from tests.marketcap.lifecycle_fixtures import make_build


# ── ADR ratio parser ─────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("text,ratio", [
    ("American depositary shares, each ADS represents two hundred (200) Class A ordinary shares, par value", 200.0),
    ("American Depositary Shares, each representing twenty (20) Class A ordinary shares", 20.0),
    ("American Depositary Shares, each representing one hundred (100) ordinary shares", 100.0),
    ("American depositary shares, each American depositary share representing four hundred Class A ordinary shares", 400.0),
    ("ADSs, each representing 5 ordinary shares", 5.0),
    ("American Depositary Shares, each representing one-fifth of one ordinary share", 0.2),
    ("ADSs, each twenty (20) ADSs representing one (1) Common Share", 0.05),
])
def test_ratio_words(text, ratio):
    v, st, _ = adr.parse_ratio(text)
    assert st == "OK" and abs(v - ratio) < 1e-9


def test_word_and_numeral_must_agree_or_fail_closed():
    v, st, snip = adr.parse_ratio("American Depositary Shares, each representing twenty (200) ordinary shares")
    assert v is None and st == "CONFLICT" and snip.startswith("WORD_NUMERAL_DISAGREE")


def test_accepted_evidence_keeps_the_accepted_reading():
    t = "American depositary shares, each ADS represents two hundred (200) Class A ordinary shares"
    assert adr.parse_ratio(t, legacy=True)[1] == "NOT_FOUND"          # M3's reading of SOGP's 2024-2026 titles
    assert adr.parse_ratio(t)[0] == 200.0


def test_cover_window_reads_the_12b_table_not_the_narrative():
    body = ("Securities registered or to be registered pursuant to Section 12(b) of the Act: Title of each class "
            "American depositary shares, each ADS represents two hundred (200) Class A ordinary shares SOGP Nasdaq. "
            + "x " * 2000 + "Before September 20, 2023, American depositary shares, each ADS represents 20 Class A ordinary shares.")
    assert adr.parse_ratio(body)[1] == "CONFLICT"                     # the whole document narrates both ratios
    assert adr.parse_cover_ratio(body)[:2] == (200.0, "OK")


# ── current-state evidence is not historical authority (TVGN) ───────────────────────────────────────────────────
def _ref_store(tmp_path, fields_root, fields_new, pulled_at=None):
    st = RA.Store(str(tmp_path))
    rec = lambda f: ["TVGN", {"ticker": "TVGN", "cik": "0001860871", "type": "CS", "active": True, **f}, [], []]
    root = tmp_path / "root.jsonl"
    RA.dump({"TVGN": rec(fields_root)}, str(root))
    m = RA.seal_root(st, str(root), expect_sha256=RA.sha(str(root)), as_of="2026-09-30", provenance={})
    new = tmp_path / "pull.jsonl"
    RA.dump({"TVGN": rec(fields_new)}, str(new))
    child = RA.append(st, m["version_id"], str(new), pulled_at=pulled_at or "2026-10-06T04:17:17Z")
    return st, m["version_id"], child["version_id"]


def test_tvgn_current_share_fields_speak_only_from_their_pull(tmp_path):
    root_f = {"share_class_shares_outstanding": 6511540, "weighted_shares_outstanding": 6511540}
    new_f = {"share_class_shares_outstanding": 15736540, "weighted_shares_outstanding": 6511540}
    st, root, child = _ref_store(tmp_path, root_f, new_f)
    h = RA.current_history(st, child)["TVGN"]
    assert h == [[None, 6511540, 6511540], ["2026-10-06", 15736540, 6511540]]   # 00:17 ET pull -> the 10-06 close
    assert RA.current_history(st, root) == {}                                   # the accepted reference: no boundary
    out = tmp_path / "m" / "ref.jsonl"
    os.makedirs(out.parent)
    RA.materialize(st, child, str(out))
    assert json.load(open(out.parent / "ref_current_history.json"))["TVGN"][1][0] == "2026-10-06"


def test_a_pull_after_the_close_speaks_from_the_next_session(tmp_path):
    st, _r, child = _ref_store(tmp_path, {"share_class_shares_outstanding": 1}, {"share_class_shares_outstanding": 2},
                               pulled_at="2026-10-06T21:30:00Z")              # 17:30 ET
    assert RA.current_history(st, child)["TVGN"][1][0] == "2026-10-07"


# ── sealed SEC filing metadata (ALP 0001171843-26-000276) ───────────────────────────────────────────────────────
ALP = "0001171843-26-000276"


def _sec_data(d, accepted):
    os.makedirs(d, exist_ok=True)
    i = sqlite3.connect(os.path.join(d, "inputs.db"))
    i.execute("CREATE TABLE issuer(cik INTEGER PRIMARY KEY)")
    i.execute("INSERT INTO issuer VALUES (1095435)")
    i.execute("CREATE TABLE filing(cik INTEGER, accn TEXT, form TEXT, filing_date TEXT, report_date TEXT, accepted TEXT, "
              "public_at TEXT, primary_doc TEXT, is_xbrl INTEGER, is_ixbrl INTEGER)")
    i.executemany("INSERT INTO filing VALUES (?,?,?,?,?,?,?,?,?,?)", [
        (1095435, ALP, "424B5", "2026-01-15", None, accepted, accepted, "f.htm", 0, 0)])
    i.commit()
    a = sqlite3.connect(os.path.join(d, "acceptance.db"))
    a.execute("CREATE TABLE acceptance(accn TEXT PRIMARY KEY, accepted TEXT NOT NULL, source TEXT NOT NULL, evidence TEXT)")
    a.commit()
    return i, a


def test_alp_accepted_timestamp_survives_a_shifted_refetch(tmp_path):
    _sec_data(str(tmp_path / "m3"), "2026-01-15T14:03:41+00:00")
    st = SA.Store(str(tmp_path / "store"))
    root = SA.seal_root(st, str(tmp_path / "m3"), as_of="2026-09-26", provenance={})["version_id"]
    i, _a = _sec_data(str(tmp_path / "run"), "2026-01-15T19:03:41+00:00")     # the 2026-10-06 bulk (+5 h)
    i.execute("INSERT INTO filing VALUES (1095435,'0001171843-26-006419','8-K','2026-10-05',NULL,"
              "'2026-10-06T03:13:39+00:00','2026-10-06T03:13:39+00:00','g.htm',0,0)")
    i.commit(), i.close()
    os.makedirs(st.headers, exist_ok=True)
    open(os.path.join(st.headers, "0001171843-26-006419.txt"), "w").write("20261005191339")   # EDGAR: 19:13:39 ET
    r = SA.apply(st, root, str(tmp_path / "run"), fetched_at="2026-10-06T00:20:52Z", fetch=None)
    c = sqlite3.connect(str(tmp_path / "run" / "inputs.db"))
    assert c.execute("SELECT accepted FROM filing WHERE accn=?", (ALP,)).fetchone()[0] == "2026-01-15T14:03:41+00:00"
    assert r["report"]["divergence_kinds"] == {"SEC_METADATA_DIVERGENCE:accepted+public_at": 1}
    a = sqlite3.connect(str(tmp_path / "run" / "acceptance.db"))
    assert a.execute("SELECT accepted, source FROM acceptance WHERE accn='0001171843-26-006419'").fetchone() == \
        ("2026-10-05T23:13:39+00:00", "EDGAR_HEADER")                          # the new accession: the EDGAR record
    ident = json.load(open(tmp_path / "run" / "sec_metadata.json"))
    assert ident["post_root_accessions"] == ["0001171843-26-006419"] and ident["lineage"][0] == root
    # a pinned reproduction materializes exactly the accepted value
    _sec_data(str(tmp_path / "repro"), "2026-01-15T19:03:41+00:00")
    SA.materialize(st, root, str(tmp_path / "repro"))
    c2 = sqlite3.connect(str(tmp_path / "repro" / "inputs.db"))
    assert c2.execute("SELECT accepted FROM filing WHERE accn=?", (ALP,)).fetchone()[0] == "2026-01-15T14:03:41+00:00"


# ── HISTORY: any accepted valued day removed fails, unless an attached approved correction lists it ─────────────
def test_history_fails_on_any_accepted_value_removal(tmp_path):
    auth = make_build(str(tmp_path / "a.db"), "A", last_day=20260930)
    cand = make_build(str(tmp_path / "c.db"), "C", last_day=20261001)
    c = sqlite3.connect(cand)
    c.execute("DELETE FROM cap_daily WHERE cik=1 AND d=20260929")
    c.commit(), c.close()
    r = H.compare(cand, auth)
    assert not r["pass"] and r["failing"] == ["VALUE_REMOVED"]
    assert r["categories"]["VALUE_REMOVED"]["unapproved"] == 1
    ip = tmp_path / "impact_rows.jsonl.gz"
    with gzip.open(ip, "wt") as f:
        f.write(json.dumps([1, 20260929, 1.01e9, None]) + "\n")
    allowed, ciks, _ = H.load_allowances([str(ip)])
    assert H.compare(cand, auth, allowed, ciks)["pass"]
    # an allowance for a DIFFERENT day authorizes nothing
    with gzip.open(ip, "wt") as f:
        f.write(json.dumps([1, 20260928, 1.0e9, None]) + "\n")
    allowed, ciks, _ = H.load_allowances([str(ip)])
    assert not H.compare(cand, auth, allowed, ciks)["pass"]


def test_identity_correction_authorizes_nothing_until_a_human_approves(tmp_path):
    auth = make_build(str(tmp_path / "a.db"), "A", last_day=20260930)
    cand = make_build(str(tmp_path / "c.db"), "C", last_day=20261001)
    c = sqlite3.connect(cand)
    c.execute("DELETE FROM cap_daily WHERE cik=3 AND d>=20260929")             # a predecessor's post-boundary days
    c.commit(), c.close()
    root = str(tmp_path / "root")
    m = H.propose_identity_correction(root, [[3, 20260929, 1.01e11, None], [3, 20260930, 1.02e11, None]],
                                      {"boundary": "8-K12B"}, reason="succession boundary")
    with pytest.raises(PermissionError, match="UNAPPROVED"):
        H.identity_correction_rows(root, m["correction_id"])
    with pytest.raises(PermissionError, match="human"):
        H.approve_identity_correction(root, m["correction_id"], by="scheduler", reason="x")
    assert not H.compare(cand, auth)["pass"]
    H.approve_identity_correction(root, m["correction_id"], by="owner", reason="reviewed")
    allowed, ciks, _ = H.load_allowances([H.identity_correction_rows(root, m["correction_id"])])
    assert H.compare(cand, auth, allowed, ciks)["pass"]
