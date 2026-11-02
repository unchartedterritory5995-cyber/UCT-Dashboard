"""tools/converse_eval.py -- the plain-English end-to-end evaluation runner.

⛔ NO MODEL CALL IS MADE BY THIS FILE. Every full run is ``--offline`` (the scripted
model in ``tests/fixtures/authoring/converse_eval_scripted.json``), in a SUBPROCESS:
the runner pins every census path before it imports ``api``, and this pytest process
has already imported ``api`` with ITS OWN pins, so an in-process run would be refused
(correctly) by the runner's own guard. The ``--live`` tests call ``main`` in-process
and assert it refuses BEFORE anything is imported, created or constructed -- the
client factory is patched to raise, so a guard that leaked would fail loudly rather
than spend.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "tools" / "converse_eval.py"
SCRIPT = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_scripted.json"
CASES = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_cases.json"
sys.path.insert(0, str(ROOT / "tools"))
import converse_eval as ce  # noqa: E402

#: A fake key, shaped like a real one. It must never appear in anything a run writes.
CANARY = "sk-ant-api03-CONVERSE-EVAL-CANARY-0123456789abcdefXYZ"

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")


def _run(tmp: Path, *extra: str, key: str | None = None, timeout: int = 600):
    env = dict(os.environ)
    env.pop("ANTHROPIC_API_KEY", None)
    if key is not None:
        env["ANTHROPIC_API_KEY"] = key
    work = tmp / "work"
    proc = subprocess.run([sys.executable, str(RUNNER), "--work", str(work), *extra],
                          cwd=str(ROOT), env=env, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    outs = list((work / "out").glob("*")) if (work / "out").exists() else []
    return proc, work, (outs[0] if outs else None)


def _last_line(text: str) -> str:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return lines[-1] if lines else ""


def _records(out: Path):
    return [json.loads(ln) for ln in io.open(out / "records.jsonl", encoding="utf-8") if ln.strip()]


# --------------------------------------------------------------------------- #
# the full offline run (one subprocess, shared)
# --------------------------------------------------------------------------- #

@pytest.fixture(scope="module")
def offline_run(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not on PATH")
    tmp = tmp_path_factory.mktemp("conv_eval_full")
    proc, work, out = _run(tmp, key=CANARY)
    return proc, work, out


def test_offline_run_passes_end_to_end_for_the_three_examples(offline_run):
    proc, _work, out = offline_run
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-3000:]
    assert _last_line(proc.stdout).startswith("VERDICT: PASS"), proc.stdout[-2000:]
    rows = _records(out)
    by_case = {}
    for r in rows:
        by_case.setdefault(r["case"], []).append(r)
    for cid in ("ex1-ema-cross", "ex2-rsi-average", "ex3-background"):
        turns = by_case[cid]
        assert [r["turn"] for r in turns] == [0, 1], cid
        for r in turns:
            # steps 1-3: a change, applied, graded against the reference (hash first)
            assert r["server"]["ok"] and r["server"]["disposition"] == "change", (cid, r["server"])
            assert r["grade"]["ok"], (cid, r["grade"])
            assert all(m["match"] in ("hash", "value") for m in r["grade"]["match"]), r["grade"]
            # steps 5-6: saved through the store, reloaded, recomputed to the same hashes
            assert r["persist"]["row"]["appended"] is True, r["persist"]
        assert turns[1]["persist"]["row"]["version"] == turns[0]["persist"]["row"]["version"] + 1
    # the edit turns changed only what was asked
    ex1 = by_case["ex1-ema-cross"][1]["definition"]["compute"]["source"]
    assert ex1 == "crossOver(ema(close, 10), ema(close, 30))"
    grading = json.loads(io.open(out / "grading.json", encoding="utf-8").read())
    assert grading["failed"] == []
    ledger = json.loads(io.open(out / "ledger.json", encoding="utf-8").read())
    assert ledger["mode"] == "offline" and ledger["money_spent_usd"] == 0.0


def test_the_negative_controls_pass_for_the_RIGHT_reason(offline_run):
    """Not merely "no change": each control is refused at the door it names."""
    _proc, _work, out = offline_run
    rows = {r["case"]: r for r in _records(out) if r["group"] == "control" and r.get("role") == "gate"}
    assert rows["ctl-mcginley"]["model_calls"] == 0 and rows["ctl-mcginley"]["server"]["gate"] == "concept:ungrounded"
    assert rows["ctl-other-symbol"]["server"]["gate"] == "unsupported:symbol-unasked"
    assert rows["ctl-screener-text"]["server"]["gate"] == "unsupported:node"
    assert rows["ctl-ambiguous"]["server"]["disposition"] == "clarify"
    assert rows["ctl-rename-nothing"]["client"]["changed"] is False
    assert all(r["grade"]["ok"] for r in rows.values())


def test_records_are_written_BEFORE_the_summary(offline_run):
    """R-RAW: the raw per-turn records exist (and are complete) before any summary."""
    _proc, _work, out = offline_run
    rec = (out / "records.jsonl").stat().st_mtime_ns
    for name in ("grading.json", "grading.md", "ledger.json"):
        assert (out / name).stat().st_mtime_ns >= rec, name
    grading = json.loads(io.open(out / "grading.json", encoding="utf-8").read())
    assert grading["turn_records"] == len(_records(out)) > 0


def test_no_key_value_ever_appears_in_any_output(offline_run):
    """A canary key was in the environment. It is in nothing the run wrote or printed."""
    proc, work, _out = offline_run
    assert CANARY not in proc.stdout and CANARY not in proc.stderr
    scanned = 0
    needle = CANARY.encode("utf-8")
    for path in work.rglob("*"):
        if path.is_file():
            scanned += 1
            assert needle not in path.read_bytes(), path
    assert scanned >= 5, "non-vacuity: the scan must have read the run's files"
    # offline blanks every model key before `api` is imported: names only on stdout
    assert "Model keys   : BLANKED" in proc.stdout


# --------------------------------------------------------------------------- #
# non-vacuity: a wrong scripted model FAILS grading
# --------------------------------------------------------------------------- #

@needs_node
def test_a_deliberately_wrong_scripted_envelope_fails_grading(tmp_path):
    script = json.loads(io.open(SCRIPT, encoding="utf-8").read())
    edit = script["turns"]["ex1-ema-cross#1"][0]
    assert edit["ops"][1]["slot"] == "cross#1.1" and edit["ops"][1]["value"] == 30
    edit["ops"][1]["value"] = 31            # the member asked for 30
    bad = tmp_path / "bad_script.json"
    bad.write_text(json.dumps(script), encoding="utf-8")
    proc, _work, out = _run(tmp_path, "--script", str(bad), "--only", "ex1-ema-cross")
    assert proc.returncode == ce.EXIT_FAIL, proc.stdout[-2000:]
    assert _last_line(proc.stdout).startswith("VERDICT: FAIL"), proc.stdout[-2000:]
    rows = _records(out)
    assert rows[0]["grade"]["ok"] is True                       # the create was right
    assert rows[1]["grade"]["ok"] is False
    assert any("neither by hash nor by value" in p for p in rows[1]["grade"]["problems"])


@needs_node
def test_an_unrequested_rename_on_an_edit_fails_grading(tmp_path):
    script = json.loads(io.open(SCRIPT, encoding="utf-8").read())
    script["turns"]["ex3-background#1"][0]["ops"].append({"op": "rename_definition", "name": "Blue sky"})
    bad = tmp_path / "rename_script.json"
    bad.write_text(json.dumps(script), encoding="utf-8")
    proc, _work, out = _run(tmp_path, "--script", str(bad), "--only", "ex3-background")
    assert proc.returncode == ce.EXIT_FAIL, proc.stdout[-2000:]
    edit = _records(out)[1]
    assert any("unrequested rename" in p for p in edit["grade"]["problems"]), edit["grade"]


@needs_node
def test_the_spend_cap_STOPS_the_run_and_reports_it_incomplete(tmp_path):
    """The cap is read off the SANDBOX cost_guard ledger (scripted token counts here)."""
    proc, _work, out = _run(tmp_path, "--max-usd", "0.05")
    assert proc.returncode == ce.EXIT_STOPPED, proc.stdout[-2000:]
    assert _last_line(proc.stdout).startswith("VERDICT: STOPPED"), proc.stdout[-2000:]
    ledger = json.loads(io.open(out / "ledger.json", encoding="utf-8").read())
    assert ledger["stopped"] and ledger["ledger_usd"] >= 0.05 and ledger["money_spent_usd"] == 0.0


@needs_node
def test_the_corpus_refused_pins_run_offline_and_model_phrases_are_live_only(tmp_path):
    corpus = {"chart": {"sym": "TEST", "tf": "D"}, "cases": [
        {"message": "Add the McGinley Dynamic", "refused": "McGinley Dynamic"},
        {"message": "show the Awesome Oscillator", "refused": "Awesome Oscillator"},
        {"message": "show the Relative Strength Index 14", "model": True, "terms": ["rsi"]}]}
    path = tmp_path / "corpus.json"
    path.write_text(json.dumps(corpus), encoding="utf-8")
    proc, _work, out = _run(tmp_path, "--corpus", str(path), "--only", "corpus")
    assert proc.returncode == ce.EXIT_PASS, proc.stdout[-2000:]
    rows = _records(out)
    assert [r["case"] for r in rows] == ["corpus#0", "corpus#1"]       # #2 needs a live model
    assert all(r["model_calls"] == 0 and r["grade"]["ok"] for r in rows)


# --------------------------------------------------------------------------- #
# --live refuses without each precondition, and never constructs a client
# --------------------------------------------------------------------------- #

class _Sentinel(Exception):
    pass


@pytest.fixture
def no_client(monkeypatch):
    def boom():
        raise AssertionError("a model client was constructed")
    monkeypatch.setattr(ce, "make_live_client", boom)

    def no_sandbox(*_a, **_k):
        raise _Sentinel("the run got past every precondition")
    monkeypatch.setattr(ce, "enter_sandbox", no_sandbox)


@pytest.mark.parametrize("argv,key,why", [
    (["--live", "--max-usd", "40"], CANARY, "--spend-authorized"),
    (["--live", "--spend-authorized"], CANARY, "--max-usd was not given"),
    (["--live", "--spend-authorized", "--max-usd", "40"], None, "ANTHROPIC_API_KEY is not set"),
    (["--live", "--spend-authorized", "--max-usd", "40"], "   ", "ANTHROPIC_API_KEY is not set"),
    (["--live", "--spend-authorized", "--max-usd", "0"], CANARY, "finite amount greater than 0"),
    (["--live", "--spend-authorized", "--max-usd", "inf"], CANARY, "finite amount greater than 0"),
], ids=["no-spend-flag", "no-cap", "no-key", "blank-key", "zero-cap", "infinite-cap"])
def test_live_refuses_without_each_precondition(monkeypatch, capsys, tmp_path, no_client, argv, key, why):
    if key is None:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    else:
        monkeypatch.setenv("ANTHROPIC_API_KEY", key)
    work = tmp_path / "work"
    code = ce.main(argv + ["--work", str(work)])
    out = capsys.readouterr()
    assert code == ce.EXIT_REFUSED, out.out
    assert why in out.out
    assert _last_line(out.out).startswith("VERDICT: REFUSED")
    assert not work.exists(), "a refused run must create nothing"
    assert CANARY not in out.out and CANARY not in out.err


def test_a_fully_authorised_live_run_gets_PAST_the_guards(monkeypatch, tmp_path, no_client):
    """The positive control: with all three preconditions the guard lets the run reach the
    sandbox step (stopped there by the test, before any import or client construction) --
    so the refusals above are the guard working, not a runner that refuses everything."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", CANARY)
    with pytest.raises(_Sentinel):
        ce.main(["--live", "--spend-authorized", "--max-usd", "40", "--work", str(tmp_path / "w")])


def test_live_problems_names_every_missing_precondition_at_once():
    args = ce._parse(["--live"])
    problems = ce.live_problems(args, {})
    assert len(problems) == 3


# --------------------------------------------------------------------------- #
# sandbox refusal
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("flag", ["--work", "--out"])
def test_a_work_or_out_dir_inside_the_shared_data_root_is_refused(capsys, flag):
    target = Path("C:/data/uct-converse-eval-must-not-exist") if os.name == "nt" else \
        Path("/data/uct-converse-eval-must-not-exist")
    existed = target.exists()
    argv = [flag, str(target)] if flag == "--work" else ["--out", str(target)]
    code = ce.main(argv)
    out = capsys.readouterr().out
    assert code == ce.EXIT_REFUSED, out
    assert "shared data root" in out and _last_line(out).startswith("VERDICT: REFUSED")
    assert target.exists() == existed


def test_a_census_path_pointing_at_the_shared_root_is_refused():
    """After the pins are applied, any census path still inside C:\\data refuses the run."""
    good = str(ROOT / "nowhere" / "auth.db")
    ce.verify_pins({"AUTH_DB_PATH": good}, None)            # control: a sandbox path passes
    for bad in (r"C:\data\auth.db", "C:/data/catalysts.db", "/data/auth.db", ""):
        with pytest.raises(ce.Refused):
            ce.verify_pins({"AUTH_DB_PATH": good, "X_DB_PATH": bad}, None)


def test_entering_the_sandbox_after_api_was_imported_is_refused(tmp_path):
    """In THIS process `api` is already imported (with pytest's pins), which is exactly
    the order the runner must refuse."""
    import api.services.user_definitions  # noqa: F401
    with pytest.raises(ce.Refused, match="before the sandbox"):
        ce.enter_sandbox(tmp_path / "data", live=False, cap_usd=None)


# --------------------------------------------------------------------------- #
# grading helpers
# --------------------------------------------------------------------------- #

def test_value_equality_is_per_bar_and_refuses_empty_or_misaligned_columns():
    assert ce.columns_equal([None, 1.0, 2.0], [None, 1.0, 2.0 + 1e-13])
    assert not ce.columns_equal([None, 1.0], [0.0, 1.0])
    assert not ce.columns_equal([1.0, 2.0], [1.0])
    assert not ce.columns_equal([], [])


def test_match_prefers_hash_then_value_then_fails():
    ref = {"hashes": {"a": "h1"}, "columns": {"a": [None, 1.0, 0.0]}}
    assert ce.match_outputs(ref, {"hashes": {"x": "h1"}, "columns": {"x": [9, 9, 9]}})[1][0]["match"] == "hash"
    assert ce.match_outputs(ref, {"hashes": {"x": "h2"}, "columns": {"x": [None, 1.0, 0.0]}})[1][0]["match"] == "value"
    ok, detail = ce.match_outputs(ref, {"hashes": {"x": "h2"}, "columns": {"x": [None, 1.0, 1.0]}})
    assert ok is False and detail[0]["match"] == "FAIL"


def test_the_synthetic_bars_are_fixed_and_made_up():
    a, b = ce.synthetic_bars(), ce.synthetic_bars()
    assert a == b and len(a) == 360
    assert all(set(x) == {"t", "o", "h", "l", "c", "v"} and x["l"] <= min(x["o"], x["c"]) for x in a)


def test_the_cases_file_holds_the_owner_examples_and_five_controls():
    doc = json.loads(io.open(CASES, encoding="utf-8").read())
    groups = [c["group"] for c in doc["cases"]]
    assert groups.count("example") == 3 and groups.count("control") == 5
    for c in doc["cases"]:
        if c["group"] == "example":
            assert [t["expect"]["kind"] for t in c["turns"]] == ["change", "change"], c["id"]
