"""Approved V1 retention: full bytes → member-authoritative → 5 completed sessions → VERIFIED compact
evidence → eligible. p202609302026 permanently pinned. Retirement disabled unless explicitly enabled; and
archive is idempotent per vintage (a retry storm never re-copies the same vintage)."""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import stat
import sys

import pytest

from api.services import breadth_exchange_retention as ret
from api.services import breadth_vintage_archive as va

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools", "breadth_exch"))
import live_core as lc  # noqa: E402


def _vintage(root, tag):
    vd = os.path.join(root, "vintages", tag)
    for sub in ("inputs_", "grouped_"):
        os.makedirs(os.path.join(vd, sub + tag))
    open(os.path.join(vd, "inputs_" + tag, "INPUT_MANIFEST.json"), "w").write(tag)
    open(os.path.join(vd, "inputs_" + tag, "pit_reference.json"), "w").write("r")
    open(os.path.join(vd, "grouped_" + tag, "x_0.json"), "w").write("[1]")
    return vd


@pytest.fixture
def w(tmp_path):
    prod_root, arch = str(tmp_path / "producer"), str(tmp_path / "archive")
    for t in ("pA", "p202609302026"):
        _vintage(prod_root, t)
    lc.archive_vintages(os.path.join(prod_root, "vintages"), ["pA", "p202609302026"], arch, code_commit="t")
    c = sqlite3.connect(os.path.join(prod_root, "state.db"))
    c.execute("CREATE TABLE vintage (tag TEXT, last_session TEXT, grouped_dir TEXT, inputs_dir TEXT, pit_ledger TEXT, "
              "created_at TEXT, state TEXT, report TEXT)")
    c.execute("INSERT INTO vintage VALUES('pA','2026-10-06','','','','2026-10-07T20:00:00Z','pruned','{}')")
    c.commit()
    c.close()
    c = sqlite3.connect(os.path.join(prod_root, "v2_live.db"))
    c.execute("CREATE TABLE v2_session (date TEXT, pub_id TEXT, sha256 TEXT, provenance TEXT, published_at TEXT)")
    c.execute("INSERT INTO v2_session VALUES('2026-10-06','x','s',?,'t')", (json.dumps({"vintage_tag": "pA"}),))
    c.commit()
    c.close()
    store = str(tmp_path / "store.db")
    s = lc.Store(store)
    s.c.close()
    hist = [{"version": 1, "published_at": "2026-10-07T21:00:00Z", "latest_session": "2026-10-06",
             "rollback_of": None, "live_sha256": "x"}]
    return {"prod": prod_root, "arch": arch, "store": store, "hist": hist}


def _elig(w, tag="pA", owned=("2026-10-06",), today="2026-10-15", state="CURRENT", hold=False, hist=None):
    return ret.eligibility(w["arch"], tag, list(owned), w["hist"] if hist is None else hist, today, state, hold)


def _evidence(w, tag="pA"):
    return ret.write_evidence(w["arch"], ret.build_evidence(w["arch"], tag, w["prod"], w["store"], w["hist"],
                                                            {"code_commit": "c"}))


def test_nothing_is_eligible_without_member_authority_or_evidence(w):
    e = _elig(w, hist=[])
    assert not e["eligible"] and "D_all_owned_authoritative" in e["why_not"] and "G_evidence_verifies" in e["why_not"]


def test_five_COMPLETED_trading_sessions_after_becoming_authoritative(w):
    _evidence(w)
    assert ret.completed_sessions_since("2026-10-07", "2026-10-14") == 4      # 10-08, 10-09, 10-12, 10-13
    assert not _elig(w, today="2026-10-14")["eligible"]
    e = _elig(w, today="2026-10-15")
    assert e["E_sessions_since_authoritative"] == 5 and e["eligible"], e


def test_a_rollback_publication_does_not_make_a_session_authoritative():
    hist = [{"version": 1, "published_at": "2026-10-07T21:00:00Z", "latest_session": "2026-10-05",
             "rollback_of": None, "live_sha256": "a"},
            {"version": 2, "published_at": "2026-10-07T22:00:00Z", "latest_session": "2026-10-06",
             "rollback_of": 1, "live_sha256": "a"}]
    assert ret.first_authoritative("2026-10-06", hist) is None


def test_evidence_is_immutable_read_back_and_verified(w):
    p = _evidence(w)
    before = open(p, "rb").read()
    doc = ret.build_evidence(w["arch"], "pA", w["prod"], w["store"], w["hist"], {"code_commit": "other"})
    ret.write_evidence(w["arch"], doc)                                          # never rewritten
    assert open(p, "rb").read() == before
    v = ret.verify_evidence(w["arch"], "pA")
    assert v["owned_sessions"][0]["date"] == "2026-10-06" and v["authority_versions"]["2026-10-06"] == [1]
    for k in ("producer", "inputs", "ack", "archive_sums", "verification", "code", "computed_sessions"):
        assert k in v


@pytest.mark.parametrize("tamper,why", [
    (lambda d: d.__setitem__("archive_sums", d["archive_sums"] + "x"), "EVIDENCE_SUMS_SELF_MISMATCH"),
    (lambda d: d.pop("owned_sessions"), "EVIDENCE_MALFORMED"),
    (lambda d: d["verification"].__setitem__("verified", False), "EVIDENCE_UNVERIFIED"),
    (lambda d: d.__setitem__("ack_sha256", "0" * 64), "EVIDENCE_ACK_MISMATCH"),
    (lambda d: d.__setitem__("authority_versions", {"2026-10-06": []}), "EVIDENCE_SESSION_NOT_AUTHORITATIVE"),
])
def test_tampered_evidence_fails_G_and_blocks_retirement(w, tamper, why):
    p = _evidence(w)
    d = json.load(open(p))
    tamper(d)
    os.chmod(p, stat.S_IWUSR | stat.S_IRUSR)
    json.dump(d, open(p, "w"))
    with pytest.raises(ret.Refused) as e:
        ret.verify_evidence(w["arch"], "pA")
    assert e.value.reason == why
    assert not _elig(w)["eligible"]


def test_unverified_archive_cannot_get_evidence(w):
    f = os.path.join(w["arch"], "pA", "grouped_pA", "x_0.json")
    os.chmod(f, stat.S_IWUSR | stat.S_IRUSR)
    open(f, "w").write("rot")
    with pytest.raises(va.AckRefused):
        ret.build_evidence(w["arch"], "pA", w["prod"], w["store"], w["hist"], {})


def test_pin_hold_and_recovery_states_block(w):
    assert "H_not_pinned" in _elig(w, tag="p202609302026", owned=("2026-09-29",))["why_not"]
    _evidence(w)
    assert "I_no_hold_or_recovery" in _elig(w, hold=True)["why_not"]
    assert "I_no_hold_or_recovery" in _elig(w, state="ROLLBACK_IN_FORCE")["why_not"]
    assert "I_no_hold_or_recovery" in _elig(w, state="STALE (X)")["why_not"]


def test_retirement_is_disabled_by_default_and_deletes_only_full_bytes_when_enabled(w, monkeypatch):
    _evidence(w)
    kw = dict(owned=["2026-10-06"], history=w["hist"], today_iso="2026-10-15", runner_state="CURRENT", hold=False)
    monkeypatch.delenv("BREADTH_EXCH_RETENTION_RETIRE_ENABLED", raising=False)
    with pytest.raises(ret.Refused) as e:
        ret.retire(w["arch"], "pA", **kw)
    assert e.value.reason == "RETIREMENT_DISABLED" and os.path.isdir(os.path.join(w["arch"], "pA"))
    monkeypatch.setenv("BREADTH_EXCH_RETENTION_RETIRE_ENABLED", "1")
    with pytest.raises(ret.Refused):
        ret.retire(w["arch"], "p202609302026", **dict(kw, owned=["2026-09-29"]))   # pinned: never
    r = ret.retire(w["arch"], "pA", **kw)
    assert r["retired"] == "pA" and not os.path.exists(os.path.join(w["arch"], "pA"))
    for keep in (va.sums_path(w["arch"], "pA"), va.ack_path(w["arch"], "pA"), ret.evidence_path(w["arch"], "pA")):
        assert os.path.exists(keep)                                            # evidence survives retirement
    assert ret.verify_evidence(w["arch"], "pA")["tag"] == "pA"


def test_the_runner_never_retires():
    import inspect
    from api.services import breadth_exchange_runner as exr
    src = inspect.getsource(exr)
    assert "ret.retire(" not in src and ".retire(" not in src and "rmtree" not in src


def test_archive_is_idempotent_per_vintage_under_a_retry_storm(tmp_path, monkeypatch):
    """A retry builds a NEW vintage (a new identity, archived once); the SAME vintage is never copied twice."""
    prod_root, arch = str(tmp_path / "p"), str(tmp_path / "a")
    _vintage(prod_root, "pX")
    copies = []
    real = shutil.copytree
    monkeypatch.setattr(shutil, "copytree", lambda s, d, *a, **k: copies.append(s) or real(s, d, *a, **k))
    for _ in range(6):                                                          # MAX_ATTEMPTS invocations
        lc.archive_vintages(os.path.join(prod_root, "vintages"), ["pX"], arch, code_commit="t")
    assert len([c for c in copies if isinstance(c, str) and c.endswith("pX")]) == 1   # top-level copies
    assert sorted(os.listdir(arch)) == ["pX", "pX.ARCHIVED.json", "pX.SHA256SUMS"]
