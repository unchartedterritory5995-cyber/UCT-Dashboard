"""IDENTITY-CORRECTION-a22fda3994d446fb (owner approval 2026-10-06): exactly 285 sealed rows authorize exactly
themselves. Synthetic cases pin the mechanism; the artifact cases pin THIS closure (skipped where the sealed
authorities are not on the volume)."""
from __future__ import annotations

import gzip
import json
import os
import shutil
import sqlite3

import pytest

from api.services.marketcap import history as H, reference_authority as RA
from tests.marketcap.lifecycle_fixtures import make_build

LIVE = os.environ.get("MCAP_LIVE_ROOT", "C:/mcaplive")
CID = "IDENTITY-CORRECTION-a22fda3994d446fb"
M3 = os.environ.get("MCAP_M3_BUILD", "C:/mcapid/runs/run-20261005-m3b/data/builds/MCAP_V1-20261005T234206Z.db")
CAND = os.environ.get("MCAP_FINAL_CANDIDATE", "")
live = pytest.mark.skipif(not os.path.exists(os.path.join(LIVE, "history_corrections", CID)), reason="sealed authority absent")
cand = pytest.mark.skipif(not (CAND and os.path.exists(CAND) and os.path.exists(M3)), reason="final candidate absent")
BOUNDARY = {1117171: 20260624, 1160791: 20260721, 1631282: 20260416, 1711570: 20260729, 1723596: 20260721}
SUCCESSOR = {1711570: 2143673, 1723596: 2115119}


# ── mechanism (synthetic) ─────────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture()
def pair(tmp_path):
    auth = make_build(str(tmp_path / "a.db"), "A", last_day=20260930)
    cand_ = make_build(str(tmp_path / "c.db"), "C", last_day=20261001)
    c = sqlite3.connect(cand_)
    c.execute("DELETE FROM cap_daily WHERE cik=3 AND d IN (20260929, 20260930)")
    c.commit(), c.close()
    root = str(tmp_path / "root")
    return auth, cand_, root


def _approved(root, rows):
    m = H.propose_identity_correction(root, rows, {}, reason="t")
    H.approve_identity_correction(root, m["correction_id"], by="owner", reason="t")
    return H.load_allowances([H.identity_correction_rows(root, m["correction_id"])])


def test_the_exact_rows_authorize_the_removals(pair):
    auth, c, root = pair
    allowed, ciks, _ = _approved(root, [[3, 20260929, 1.01e11, None], [3, 20260930, 1.02e11, None]])
    r = H.compare(c, auth, allowed, ciks)
    assert r["pass"] and r["categories"]["VALUE_REMOVED"] == {"unapproved": 0, "approved": 2, "by_issuer": []}


def test_an_unauthorized_extra_removal_fails(pair):
    auth, c, root = pair
    allowed, ciks, _ = _approved(root, [[3, 20260929, 1.01e11, None], [3, 20260930, 1.02e11, None]])
    x = sqlite3.connect(c)
    x.execute("DELETE FROM cap_daily WHERE cik=3 AND d=20260928")           # the "286th" row
    x.commit(), x.close()
    r = H.compare(c, auth, allowed, ciks)
    assert not r["pass"] and r["categories"]["VALUE_REMOVED"]["unapproved"] == 1


@pytest.mark.parametrize("rows", [
    [[1, 20260929, 1.01e9, None], [1, 20260930, 1.02e9, None]],             # wrong issuer
    [[3, 20260928, 1.0e11, None], [3, 20260929, 1.01e11, None]],             # wrong session
])
def test_wrong_issuer_or_session_authorizes_nothing(pair, rows):
    auth, c, root = pair
    allowed, ciks, _ = _approved(root, rows)
    assert not H.compare(c, auth, allowed, ciks)["pass"]


def test_an_unrelated_removal_still_fails_with_a_correction_attached(pair):
    auth, c, root = pair
    allowed, ciks, _ = _approved(root, [[3, 20260929, 1.01e11, None], [3, 20260930, 1.02e11, None]])
    x = sqlite3.connect(c)
    x.execute("DELETE FROM cap_daily WHERE cik=1 AND d=20260929")
    x.commit(), x.close()
    assert H.compare(c, auth, allowed, ciks)["failing"] == ["VALUE_REMOVED"]


def test_a_modified_artifact_is_refused(pair):
    _a, _c, root = pair
    m = H.propose_identity_correction(root, [[3, 20260929, 1.01e11, None]], {}, reason="t")
    H.approve_identity_correction(root, m["correction_id"], by="owner", reason="t")
    p = os.path.join(root, "history_corrections", m["correction_id"], "impact_rows.jsonl.gz")
    os.chmod(p, 0o644)
    with open(p, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as f:
        f.write(b'[3, 20260929, 1.01e11, null]\n[3, 20260930, 1.02e11, null]\n')
    with pytest.raises(ValueError, match="do not match the seal"):
        H.identity_correction_rows(root, m["correction_id"])


# ── this closure's sealed artifacts ───────────────────────────────────────────────────────────────────────────────
def _rows():
    return [json.loads(x) for x in gzip.open(os.path.join(LIVE, "history_corrections", CID, "impact_rows.jsonl.gz")).read().decode().splitlines()]


@live
def test_the_approved_correction_is_exactly_the_reviewed_285_rows():
    p = H.identity_correction_rows(LIVE, CID)                               # seal + approval verified
    rows = _rows()
    assert p and len(rows) == 285
    by = {}
    for cik, d, old, new in rows:
        assert new is None and old > 0 and d >= BOUNDARY[cik]
        by[cik] = by.get(cik, 0) + 1
    assert by == {1117171: 68, 1160791: 50, 1631282: 115, 1711570: 2, 1723596: 50}


@live
def test_a_tampered_copy_of_the_approved_correction_is_refused(tmp_path):
    root = str(tmp_path)
    shutil.copytree(os.path.join(LIVE, "history_corrections", CID), os.path.join(root, "history_corrections", CID))
    p = os.path.join(root, "history_corrections", CID, "impact_rows.jsonl.gz")
    os.chmod(p, 0o644)
    rows = _rows() + [[1117171, 20260930, 1.0, None]]                         # a 286th row
    with open(p, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as f:
        f.write(("\n".join(json.dumps(r) for r in rows) + "\n").encode())
    with pytest.raises(ValueError):
        H.identity_correction_rows(root, CID)


@live
def test_ecl_stays_unapproved():
    m = RA.Store(LIVE).manifest("REF-CORRECTION-fb4af5f1edaeb091")
    assert m.get("_unapproved") is True


@cand
def test_final_candidate_gaps_and_successor_ownership():
    c = sqlite3.connect(f"file:{CAND}?mode=ro", uri=True)
    c.execute("ATTACH DATABASE ? AS m", (f"file:{M3}?mode=ro",))
    for cik, b in BOUNDARY.items():
        # the predecessor keeps every accepted day before its boundary, and owns nothing from it on
        assert c.execute("SELECT COUNT(*) FROM m.cap_daily o WHERE o.cik=? AND o.d<? AND NOT EXISTS (SELECT 1 FROM main.cap_daily n "
                         "WHERE n.cik=o.cik AND n.d=o.d)", (cik, b)).fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM main.cap_daily WHERE cik=? AND d>=?", (cik, b)).fetchone()[0] == 0
    for pred, succ in SUCCESSOR.items():                                    # no session owned by both
        assert c.execute("SELECT COUNT(*) FROM main.cap_daily p JOIN main.cap_daily s ON s.d=p.d WHERE p.cik=? AND s.cik=?",
                         (pred, succ)).fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM main.cap_daily WHERE cik=? AND d>=?", (succ, BOUNDARY[pred])).fetchone()[0] > 0


@cand
def test_unapproved_candidates_are_not_applied():
    c = sqlite3.connect(f"file:{CAND}?mode=ro", uri=True)
    c.execute("ATTACH DATABASE ? AS m", (f"file:{M3}?mode=ro",))
    for cik in (1499543, 1553846, 31462):                                    # NOAH, RDHL, ECL: accepted values intact
        assert c.execute("SELECT COUNT(*) FROM m.cap_daily o LEFT JOIN main.cap_daily n ON n.cik=o.cik AND n.d=o.d WHERE o.cik=? "
                         "AND (n.cap IS NULL OR ABS(n.cap/o.cap-1) > 1e-9)", (cik,)).fetchone()[0] == 0
