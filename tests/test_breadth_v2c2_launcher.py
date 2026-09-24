"""V2c2 launcher rails: the preflight refuses rather than drifts (not launched here)."""
import hashlib
import json
import os

import pytest

from api.services import breadth_corrected_pass as cp


def _inputs(tmp_path, monkeypatch, fetch=("2026-09-23T20:09:57Z", "2026-09-23T20:20:01Z"), live_from="2026-03-23", acq=None):
    g = tmp_path / "grouped"; g.mkdir()
    body = b'{"AAPL": 1.0}'
    (g / "2026-09-22_1.json").write_bytes(body)
    inp = tmp_path / "inputs"; inp.mkdir()
    gm = {"dir": str(g), "fetch_window": list(fetch),
          "manifest": {"2026-09-22_1": {"sha256": hashlib.sha256(body).hexdigest()}}}
    (inp / "grouped_vintage_manifest.json").write_text(json.dumps(gm))
    (inp / "pit_uct_ledger.json").write_text(json.dumps({"live_from": live_from}))
    objs = {f: hashlib.sha256((inp / f).read_bytes()).hexdigest() for f in os.listdir(inp)}
    (inp / "INPUT_MANIFEST.json").write_text(json.dumps({
        "tag": "t", "last_session": "2026-09-22", "acquisition_window": acq or {"started": fetch[0], "finished": fetch[1]}, "grouped_fetch_window": list(fetch),
        "grouped_dir": str(g), "objects_sha256": objs}))
    monkeypatch.setenv("BREADTH_GROUPED_DIR", str(g))
    for v in cp.PRODUCTION_WRITING_FLAGS:
        monkeypatch.setenv(v, "0")
    return inp, g


def _problems(inp, now="2026-09-23T21:00:00+00:00"):
    return cp.preflight(str(inp), now_utc=now)["problems"]


def test_refuses_without_pins(tmp_path, monkeypatch):
    inp, _ = _inputs(tmp_path, monkeypatch)
    monkeypatch.setattr(cp, "PINS_PATH", str(tmp_path / "none.json"))
    assert any("no pins file" in p for p in _problems(inp))


def test_accepts_matching_pins_and_refuses_a_moved_module(tmp_path, monkeypatch):
    inp, _ = _inputs(tmp_path, monkeypatch)
    pins = tmp_path / "pins.json"; pins.write_text(json.dumps(cp.current_pins()))
    monkeypatch.setattr(cp, "PINS_PATH", str(pins))
    assert _problems(inp) == []
    bad = cp.current_pins(); bad["modules_md5_lf"]["breadth_dividend_basis.py"] = "0" * 32
    pins.write_text(json.dumps(bad))
    assert any("breadth_dividend_basis.py" in p for p in _problems(inp))
    bad = cp.current_pins(); bad["dividend_basis_version"] = "split-only"
    pins.write_text(json.dumps(bad))
    assert any("dividend_basis_version" in p for p in _problems(inp))


@pytest.mark.parametrize("flag", cp.PRODUCTION_WRITING_FLAGS)
def test_refuses_a_production_writing_flag(tmp_path, monkeypatch, flag):
    inp, _ = _inputs(tmp_path, monkeypatch)
    monkeypatch.setenv(flag, "1")
    assert any(flag in p for p in _problems(inp))


def test_refuses_a_stale_cache_and_a_tampered_file(tmp_path, monkeypatch):
    inp, g = _inputs(tmp_path, monkeypatch)
    # the next open after a 2026-09-23 evening fetch is 2026-09-24 13:30Z
    assert any("STALE" in p for p in _problems(inp, now="2026-09-24T13:31:00+00:00"))
    assert not any("STALE" in p for p in _problems(inp, now="2026-09-24T13:29:00+00:00"))
    (g / "2026-09-22_1.json").write_bytes(b'{"AAPL": 2.0}')
    assert any("grouped files differ" in p for p in _problems(inp))


def test_refuses_a_fetch_window_spanning_an_open(tmp_path, monkeypatch):
    inp, _ = _inputs(tmp_path, monkeypatch, fetch=("2026-09-23T13:00:00Z", "2026-09-23T14:00:00Z"))
    assert any("spans a session open" in p for p in _problems(inp, now="2026-09-23T14:05:00+00:00"))


def test_refuses_a_wrong_canonical_uct_start(tmp_path, monkeypatch):
    inp, _ = _inputs(tmp_path, monkeypatch, live_from="2026-01-02")
    assert any("live_from" in p for p in _problems(inp))


def test_refuses_an_acquisition_window_spanning_an_open(tmp_path, monkeypatch):
    # grouped fetched after the close, dividends paged past the next morning's open → mixed vintage
    inp, _ = _inputs(tmp_path, monkeypatch, acq={"started": "2026-09-23T20:09:57Z", "finished": "2026-09-24T14:05:00Z"})
    assert any("acquisition window" in p and "spans a session open" in p for p in _problems(inp, now="2026-09-24T15:00:00+00:00"))


def test_refuses_a_manifest_without_an_acquisition_window(tmp_path, monkeypatch):
    inp, _ = _inputs(tmp_path, monkeypatch, acq={"started": "2026-09-23T20:09:57Z"})
    assert any("no complete acquisition window" in p for p in _problems(inp))


# ── resume = CONTINUE THIS EXACT RUN (real preflight, disposable inputs + artifact) ──
LAUNCH_NOW = "2026-09-23T21:00:00+00:00"          # inside the fixture's one-window vintage


def _run_env(tmp_path, monkeypatch):
    inp, g = _inputs(tmp_path, monkeypatch)
    pins = tmp_path / "pins.json"; pins.write_text(json.dumps(cp.current_pins()))
    monkeypatch.setattr(cp, "PINS_PATH", str(pins))
    real = cp.preflight
    seen = []
    monkeypatch.setattr(cp, "preflight", lambda d, now_utc=None, verify_files=True:
                        seen.append(now_utc) or real(d, now_utc=now_utc or LAUNCH_NOW, verify_files=verify_files))

    def fake_run(art, days, unis, inputs, progress_every=1):
        c = cp.open_artifact(art)
        cp._checkpoint(c, days[0], "done")
        c.commit(); c.close()
        return {"failed": 0}
    monkeypatch.setattr(cp, "run", fake_run)
    return str(inp), str(tmp_path / "art.db"), seen


def _launch(inp, art, *extra):
    return cp.main(["--artifact", art, "--inputs", inp, "--from", "2026-09-21"] + list(extra))


def test_a_launch_records_the_run_identity(tmp_path, monkeypatch):
    inp, art, seen = _run_env(tmp_path, monkeypatch)
    assert _launch(inp, art) == 0 and seen == [None]
    rec = cp.launch_record(art)
    assert rec["launch_input_manifest_sha256"] == cp._sha(inp + "/INPUT_MANIFEST.json")
    assert rec["launch_pit_ledger_sha256"] == cp._sha(inp + "/pit_uct_ledger.json")
    assert (rec["launch_from"], rec["launch_to"]) == ("2026-09-21", "2026-09-22")


def test_the_same_run_resumes_after_the_open_judged_at_the_launch_instant(tmp_path, monkeypatch):
    inp, art, seen = _run_env(tmp_path, monkeypatch)
    _launch(inp, art)
    assert _launch(inp, art, "--resume") == 0
    assert seen[-1] == cp.launch_record(art)["launch_preflight_clean_at"]
    with pytest.raises(cp.ArtifactRefused, match="use --resume"):
        _launch(inp, art)                                 # never a second launch on the artifact


def test_mutating_one_input_makes_resume_refuse_then_restoring_it_resumes(tmp_path, monkeypatch):
    inp, art, _ = _run_env(tmp_path, monkeypatch)
    _launch(inp, art)
    f = tmp_path / "inputs" / "pit_uct_ledger.json"; good = f.read_text()
    f.write_text(json.dumps({"live_from": "2026-03-23", "dates": {"2026-09-22": {"tickers": ["X"]}}}))
    with pytest.raises(cp.ArtifactRefused):
        _launch(inp, art, "--resume")
    f.write_text(good)
    assert _launch(inp, art, "--resume") == 0


def test_a_mutated_manifest_or_grouped_file_makes_resume_refuse(tmp_path, monkeypatch):
    inp, art, _ = _run_env(tmp_path, monkeypatch)
    _launch(inp, art)
    m = tmp_path / "inputs" / "INPUT_MANIFEST.json"; good = m.read_text()
    m.write_text(good.replace('"tag": "t"', '"tag": "t2"'))
    with pytest.raises(cp.ArtifactRefused, match="not the manifest"):
        _launch(inp, art, "--resume")
    m.write_text(good)
    (tmp_path / "grouped" / "2026-09-22_1.json").write_bytes(b'{"AAPL": 2.0}')
    with pytest.raises(cp.ArtifactRefused, match="preflight"):
        _launch(inp, art, "--resume")


def test_a_different_end_date_or_pins_makes_resume_refuse(tmp_path, monkeypatch):
    inp, art, _ = _run_env(tmp_path, monkeypatch)
    _launch(inp, art)
    with pytest.raises(cp.ArtifactRefused, match="range"):
        _launch(inp, art, "--resume", "--to", "2026-09-24")
    real = cp.current_pins
    monkeypatch.setattr(cp, "current_pins", lambda: dict(real(), dividend_basis_version="div-basis-v7"))
    with pytest.raises(cp.ArtifactRefused, match="pins"):
        _launch(inp, art, "--resume")


def test_resume_refuses_a_never_launched_artifact(tmp_path, monkeypatch):
    inp, art, _ = _run_env(tmp_path, monkeypatch)
    with pytest.raises(cp.ArtifactRefused, match="no clean launch record"):
        _launch(inp, art, "--resume")
