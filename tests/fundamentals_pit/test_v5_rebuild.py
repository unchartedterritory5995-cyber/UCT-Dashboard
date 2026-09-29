"""The V5 rebuild runner: isolated from the source store, pinned, resumable."""
import hashlib
import json

import pytest

from api.services.fundamentals_pit import sec_client as SEC, store as S, v5_rebuild as VR
from .test_pipeline import _run


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setattr(SEC, "filing_instance", lambda cik, accn: None)


def _digest(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def test_init_acquire_derive_isolated_pinned_and_resumable(tmp_path, monkeypatch):
    _run(tmp_path)                                         # a small real store (bulk-ingested, v4-derived)
    src = str(tmp_path / "pit.db")
    c = S.connect(src)
    with S.tx(c):                                          # v4-era evidence that must NOT reach the V5 copy
        c.execute("INSERT INTO filing_signal VALUES ('A-24-1','us-gaap:Revenues',20230101,20231231,'restatement_axis','fs_dataset:x',0)")
    c.close()
    before = _digest(src)
    d = str(tmp_path / "v5run")
    assert VR.main(["init", "--dir", d, "--source", src, "--code-sha", "abc123"]) == 0
    run = json.load(open(f"{d}/run.json"))
    assert run["census"]["filings"] == 2 and run["code_sha"] == "abc123" and run["derivation_version"] == 5
    v5 = S.connect(run["output_store"], readonly=True)
    assert v5.execute("SELECT count(*) FROM filing_signal").fetchone()[0] == 0                # no v4 evidence
    assert v5.execute("SELECT count(*) FROM series_point WHERE derivation_version != 5").fetchone()[0] == 0
    v5.close()
    with pytest.raises(SystemExit):                        # a second init into the same run is refused
        VR.main(["init", "--dir", d, "--source", src, "--code-sha", "abc123"])

    assert VR.main(["acquire", "--dir", d, "--workers", "2"]) == 0
    acq = json.load(open(f"{d}/acquisition.json"))
    assert (acq["complete"], acq["unresolved"]) == (2, [])
    # resume: nothing left, nothing re-fetched
    asked = []
    monkeypatch.setattr(SEC, "filing_instance", lambda cik, accn: asked.append(accn))
    assert VR.main(["acquire", "--dir", d, "--workers", "2"]) == 0 and asked == []
    assert len(json.load(open(f"{d}/resumes.json"))) == 2

    assert VR.main(["derive", "--dir", d, "--workers", "1"]) == 0
    der = json.load(open(f"{d}/derive.json"))
    assert der["derived"] == 1 and der["points"] > 0 and der["failed"] == []
    assert _digest(src) == before                          # the source store was never written


def test_a_resume_under_changed_code_is_refused(tmp_path, monkeypatch):
    _run(tmp_path)
    d = str(tmp_path / "v5run")
    VR.main(["init", "--dir", d, "--source", str(tmp_path / "pit.db"), "--code-sha", "abc123"])
    monkeypatch.setattr(VR, "code_tree_sha256", lambda: "0" * 64)
    with pytest.raises(SystemExit) as e:
        VR.main(["acquire", "--dir", d])
    assert "REFUSED" in str(e.value)


def test_a_transient_failure_is_retried_never_recorded_as_no_evidence(tmp_path, monkeypatch):
    _run(tmp_path)
    d = str(tmp_path / "v5run")
    VR.main(["init", "--dir", d, "--source", str(tmp_path / "pit.db"), "--code-sha", "abc123"])
    monkeypatch.setattr(VR.time, "sleep", lambda s: None)
    def flaky(cik, accn):
        raise SEC.SecError("u", 503, "gave up")
    monkeypatch.setattr(SEC, "filing_instance", flaky)
    assert VR.main(["acquire", "--dir", d, "--workers", "1"]) == 2       # incomplete, and says so
    acq = json.load(open(f"{d}/acquisition.json"))
    assert acq["complete"] == 0 and len(acq["unresolved"]) == 2
    v5 = S.connect(json.load(open(f"{d}/run.json"))["output_store"], readonly=True)
    assert v5.execute("SELECT count(*) FROM signal_check").fetchone()[0] == 0              # nothing recorded
