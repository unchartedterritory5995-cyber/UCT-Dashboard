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
    # EACH OS IS ASKED ABOUT ITS OWN SPELLINGS OF THE ROOT. The guard canonicalises per OS, so on
    # Linux a drive-letter string is a file name in the working directory, not the shared root:
    # asking Linux to refuse it failed this case on every Linux lane. The `/data/...` spelling and
    # an empty pin are refused everywhere.
    drive = (r"C:\data\auth.db", "C:/data/catalysts.db") if os.name == "nt" else ()
    for bad in (*drive, "/data/auth.db", ""):
        with pytest.raises(ce.Refused):
            ce.verify_pins({"AUTH_DB_PATH": good, "X_DB_PATH": bad}, None)
    if os.name != "nt":
        # CONTROL: a drive-letter name really is outside the root here, so leaving the two drive
        # spellings out above is a fact about this OS and not a refusal that stopped working
        ce.verify_pins({"AUTH_DB_PATH": good, "X_DB_PATH": "C:/data/catalysts.db"}, None)


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


# ═══ 2026-11-17 — the lane must be able to BUILD, and that is checked without a bundler ════════

def test_every_asset_type_the_app_imports_has_a_loader_in_the_lane():
    """⚰️ The compass mark became a `.webp` on 2026-11-12. The lane's loader map had no entry for it,
    the bundle failed, and the runner answered "LANE UNAVAILABLE -- nothing was graded" for five
    days, while every test above was skipped wherever `app/node_modules` is absent.

    This reads the app's own import statements (no node, no bundler) and fails on a file type the
    lane cannot swallow."""
    import re
    from pathlib import Path
    import tools.converse_eval as ce

    src = Path(ce.APP) / "src"
    assert src.is_dir()
    # a dotted module name (`./b1Core.steps`) is code, not a file type: only a NON-CODE type counts
    non_code = {".css", ".scss", ".less", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico",
                ".bmp", ".apng", ".cur", ".tiff", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4",
                ".webm", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".mov", ".pdf", ".wasm", ".txt", ".md",
                ".csv", ".tsv", ".xml", ".yaml", ".yml", ".glsl", ".frag", ".vert", ".html"}
    known = set(ce.ASSET_LOADERS)
    pattern = re.compile(r"""(?:from|import)\s*\(?\s*['"][^'"\n]+?(\.[A-Za-z0-9]{2,5})['"]""")
    seen: dict = {}
    for path in src.rglob("*.js*"):
        if ".test." in path.name or "node_modules" in path.parts:
            continue                                   # tests are not in the lane's bundle
        for ext in pattern.findall(path.read_text("utf-8", errors="ignore")):
            seen.setdefault(ext.lower(), path)
    assert ".webp" in seen and ".css" in seen, "the scan read no asset imports at all"
    missing = {ext: str(p.relative_to(src)) for ext, p in seen.items() if ext in non_code and ext not in known}
    assert not missing, f"the lane has no loader for: {missing}"


def test_CONTROL_the_asset_scan_would_catch_a_missing_loader(monkeypatch):
    """The rail above can fail: take `.webp` out of the map and it names it."""
    import tools.converse_eval as ce
    monkeypatch.setattr(ce, "ASSET_LOADERS", {k: v for k, v in ce.ASSET_LOADERS.items() if k != ".webp"})
    with pytest.raises(AssertionError, match=r"\.webp"):
        test_every_asset_type_the_app_imports_has_a_loader_in_the_lane()


# ═══ 2026-11-17 — the UCT house indicators as cases (Studio plan C1 / L2) ════════════════════

HOUSE_CASES = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_house_cases.json"
HOUSE_SCRIPT = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_house_scripted.json"


def _trees_read_elsewhere(ops) -> bool:
    def walk(n):
        if isinstance(n, dict):
            yield n
            for a in n.get("args") or []:
                yield from walk(a)
    for o in ops:
        for out in (o.get("outputs") or []) + ([o] if "tree" in o else []):
            if any(n.get("type") in ("sym", "tf", "tf_live") for n in walk(out.get("tree") or {})):
                return True
    return False


def test_the_house_cases_are_the_house_set_and_nothing_else():
    """No bundler needed: the fixture is IN STEP with `api/data/worked_examples.json`. Every house
    indicator is a case with its own request and its own trees, or is named as left out because
    it reads another symbol or timeframe (the runner has one synthetic symbol on one timeframe)."""
    examples = {e["id"]: e for e in json.loads(io.open(ROOT / "api" / "data" / "worked_examples.json", encoding="utf-8").read())["examples"]}
    doc = json.loads(io.open(HOUSE_CASES, encoding="utf-8").read())
    script = json.loads(io.open(HOUSE_SCRIPT, encoding="utf-8").read())["turns"]
    house = {c["id"]: c for c in doc["cases"] if c["id"].startswith("house-")}
    left_out = set(doc["left_out"])
    assert left_out == {i for i, e in examples.items() if _trees_read_elsewhere(e["ops"])}
    assert {i.replace("house-", "").replace("-", "_") for i in house} == set(examples) - left_out
    assert len(house) >= 9
    for cid, case in house.items():
        ex = examples[cid.replace("house-", "").replace("-", "_")]
        (turn,) = case["turns"]
        assert turn["words"] == ex["request"]
        built = [out["tree"] for o in ex["ops"] if o.get("op") == "create" for out in o["outputs"]]
        built += [o["tree"] for o in ex["ops"] if o.get("op") == "add_output"]
        assert [o["tree"] for o in turn["expect"]["outputs"]] == built
        assert script[f"{cid}#0"][0]["ops"] == ex["ops"]               # the scripted answer IS the house patch
    # the runner's verdict needs its negative controls beside any examples: carried over unchanged
    base = {c["id"]: c for c in json.loads(io.open(ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_cases.json", encoding="utf-8").read())["cases"]}
    assert {c["id"]: c for c in doc["cases"] if c["group"] == "control"} == {k: v for k, v in base.items() if v["group"] == "control"}


@needs_node
def test_every_house_case_builds_computes_and_grades_offline(tmp_path):
    """The door, the engine and the grader, end to end, for nine real indicators: a change to any of
    them that breaks a house indicator fails here."""
    proc, _work, out = _run(tmp_path, "--cases", str(HOUSE_CASES), "--script", str(HOUSE_SCRIPT))
    assert proc.returncode == 0, proc.stdout[-3000:]
    assert _last_line(proc.stdout).startswith("VERDICT: PASS"), proc.stdout[-1500:]
    passed = {r["case"] for r in _records(out) if r.get("grade", {}).get("ok")}
    doc = json.loads(io.open(HOUSE_CASES, encoding="utf-8").read())
    assert {c["id"] for c in doc["cases"] if c["id"].startswith("house-")} <= passed


@needs_node
def test_CONTROL_a_house_answer_with_one_number_wrong_fails_grading(tmp_path):
    """The house cases can fail: 25 sessions answered as 26."""
    script = json.loads(io.open(HOUSE_SCRIPT, encoding="utf-8").read())
    text = json.dumps(script["turns"]["house-distribution-day-count#0"])
    assert text.count('"value": 25') == 1
    script["turns"]["house-distribution-day-count#0"] = json.loads(text.replace('"value": 25', '"value": 26'))
    bad = tmp_path / "bad_house.json"
    bad.write_text(json.dumps(script), encoding="utf-8")
    proc, _work, out = _run(tmp_path, "--cases", str(HOUSE_CASES), "--script", str(bad), "--only", "house-distribution-day-count")
    assert proc.returncode == ce.EXIT_FAIL, proc.stdout[-2000:]
    assert any("neither by hash nor by value" in p for r in _records(out) for p in r["grade"].get("problems", []))

# ═══ 2026-11-17 — indicators that carry a running state (SuperTrend, Parabolic SAR) ═════════════

STATEFUL_CASES = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_stateful_cases.json"
STATEFUL_SCRIPT = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_stateful_scripted.json"


def test_a_cases_file_may_ask_for_a_longer_history_and_nothing_else():
    assert ce.bar_count_of({}) == ce.DEFAULT_BARS == 360
    assert ce.bar_count_of({"bars": 1500}) == 1500
    assert ce.bar_count_of({"bars": ce.MAX_BARS}) == ce.MAX_BARS
    for bad in (100, ce.MAX_BARS + 1, "1500", 1500.0, True, None):
        with pytest.raises(SystemExit):
            ce.bar_count_of({"bars": bad})
    assert len(ce.synthetic_bars(1500)) == 1500
    # the first 360 of a longer series are the default series: a longer run changes nothing earlier
    assert ce.synthetic_bars(1500)[:360] == ce.synthetic_bars()


def test_the_stateful_cases_are_the_four_functions_and_the_standard_controls():
    """No bundler needed: what the fixture holds, and that it asks for enough history."""
    doc = json.loads(io.open(STATEFUL_CASES, encoding="utf-8").read())
    script = json.loads(io.open(STATEFUL_SCRIPT, encoding="utf-8").read())["turns"]
    examples = [c for c in doc["cases"] if c["group"] == "example"]
    called = set()
    for case in examples:
        (turn,) = case["turns"]
        built = [o["tree"] for o in script[f"{case['id']}#0"][0]["ops"][0]["outputs"]]
        assert [o["tree"] for o in turn["expect"]["outputs"]] == built      # the answer IS the function call
        called |= {t["name"] for t in built}
    assert called == {"supertrend", "supertrendDirection", "sar", "sarDirection"}
    # shown only after their warm-up: the default series is too short for every one of them
    from api.services import call_expansions
    assert doc["bars"] > 2 * max(call_expansions.SUPERTREND_WARMUP, call_expansions.SAR_WARMUP) + 360 > ce.DEFAULT_BARS
    base = {c["id"]: c for c in json.loads(io.open(ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_cases.json", encoding="utf-8").read())["cases"]}
    assert {c["id"]: c for c in doc["cases"] if c["group"] == "control"} == {k: v for k, v in base.items() if v["group"] == "control"}


@needs_node
def test_supertrend_and_parabolic_sar_build_compute_and_grade_offline(tmp_path):
    """The door, the browser's own patch engine and the grader, end to end. Before 2026-11-17 the
    door refused its own expansion of these functions, so none of them could be built."""
    proc, _work, out = _run(tmp_path, "--cases", str(STATEFUL_CASES), "--script", str(STATEFUL_SCRIPT))
    assert proc.returncode == 0, proc.stdout[-3000:]
    assert _last_line(proc.stdout).startswith("VERDICT: PASS"), proc.stdout[-1500:]
    passed = {r["case"] for r in _records(out) if r.get("grade", {}).get("ok")}
    assert {"stateful-supertrend", "stateful-supertrend-direction", "stateful-parabolic-sar", "stateful-sar-direction"} <= passed


@needs_node
def test_CONTROL_on_the_default_history_the_runner_refuses_to_grade_them(tmp_path):
    """On 360 bars the reference is unknown on every bar. The runner says so and grades nothing,
    rather than passing an all-empty line against an all-empty line."""
    doc = json.loads(io.open(STATEFUL_CASES, encoding="utf-8").read())
    del doc["bars"]
    short = tmp_path / "short.json"
    short.write_text(json.dumps(doc), encoding="utf-8")
    proc, _work, _out = _run(tmp_path, "--cases", str(short), "--script", str(STATEFUL_SCRIPT), "--only", "stateful-supertrend")
    assert proc.returncode != 0
    assert "all-unknown on the synthetic bars" in proc.stdout + proc.stderr


# ─── Indicators backlog 59: the door accepts what the browser refuses ─────────────────────────────
#
# Found six times by hand on production on 2026-11-17: the door answered ok with a change, the
# browser's own patch engine refused the whole patch, and a member read "Nothing was changed" for a
# request the assistant had built. This is the rail that finds the next one here.
#
# Each case is one request with TWO scripted answers: the answer production really gave, then the
# repair. With the door's rule in place the first is refused AT THE DOOR, the repair is accepted,
# the browser applies it and its outputs compute. With the rule gone the door accepts the first,
# the browser refuses it, and the runner fails the case by name (`ACCEPT_THEN_REFUSE`).

DOOR_BROWSER_CASES = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_door_browser_cases.json"
DOOR_BROWSER_SCRIPT = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_door_browser_scripted.json"
DOOR_BROWSER_IDS = {"door-marker-colour-states", "door-calc-timeframe-marker", "door-column-limit",
                    "door-table-cell-setting", "door-calc-timeframe-other-symbol"}
#: NOT a door rule: the door accepts it, the browser refuses it and sends its own refusal back to
#: the door for one repair (`definition_conversation.browser_refusal`, `authoringSession.modelTurn`).
BROWSER_REPAIR_ID = "browser-sends-its-refusal-back"


def test_the_door_browser_cases_are_two_answers_each_and_the_standard_controls():
    """No bundler needed: what the fixture holds."""
    doc = json.loads(io.open(DOOR_BROWSER_CASES, encoding="utf-8").read())
    script = json.loads(io.open(DOOR_BROWSER_SCRIPT, encoding="utf-8").read())["turns"]
    examples = {c["id"]: c for c in doc["cases"] if c["group"] == "example"}
    assert set(examples) == DOOR_BROWSER_IDS | {BROWSER_REPAIR_ID}
    for cid, case in examples.items():
        (turn,) = case["turns"]
        answers = script[f"{cid}#0"]
        assert len(answers) == 2, cid                                      # what production gave, then the repair
        assert answers[0]["ops"] != answers[1]["ops"], cid
        assert turn["expect"]["max_model_calls"] == 2, cid
    base = {c["id"]: c for c in json.loads(io.open(ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_cases.json", encoding="utf-8").read())["cases"]}
    assert {c["id"]: c for c in doc["cases"] if c["group"] == "control"} == {k: v for k, v in base.items() if v["group"] == "control"}


@needs_node
def test_what_the_door_refuses_is_repaired_and_the_browser_applies_the_repair(tmp_path):
    proc, _work, out = _run(tmp_path, "--cases", str(DOOR_BROWSER_CASES), "--script", str(DOOR_BROWSER_SCRIPT))
    text = proc.stdout
    assert ce.ACCEPT_THEN_REFUSE not in text, text[-3000:]
    rows = [r for r in _records(out) if r.get("case") in DOOR_BROWSER_IDS]
    assert {r["case"] for r in rows} == DOOR_BROWSER_IDS
    for r in rows:
        assert r.get("grade", {}).get("ok") is True, (r["case"], r.get("grade", {}).get("problems"))
        # the production answer was refused AT THE DOOR (attempt 1) and the repair accepted (attempt 2)
        assert (r.get("server") or {}).get("attempts") == 2, r["case"]
        assert (r.get("client") or {}).get("changed") is True, r["case"]   # and the BROWSER applied the repair
    # ⚠️ THE VERDICT LINE IS "FAIL" HERE, FOR ONE STATED REASON, AND THAT IS ASSERTED RATHER THAN
    # IGNORED: every example needs its repair by design, so the first-pass gate (which measures how
    # often the assistant is right first time on the STANDARD set) is below its line on this set.
    # Nothing else may fail.
    last = _last_line(text)
    assert last.startswith("VERDICT: FAIL") and "case runs passed" in last, last
    assert last.split("failed gates: ")[-1].strip() == "['first-pass rate (no repair, >= 70%)']", last
    done, of = last.split(" -- ")[1].split(" case runs passed")[0].split("/")
    assert done == of and int(of) >= len(DOOR_BROWSER_IDS), last          # every case run passed
    # none of these needed the browser to ask again: the door's own rule caught each
    assert not any(r.get("browser_repair") for r in rows)


@needs_node
def test_what_the_browser_refuses_goes_back_to_the_door_once_and_is_repaired(tmp_path):
    """The general half. The door accepts a candle colour that follows a number; the browser's
    engine refuses it. Through the SHIPPED modules: the browser builds the second request with the
    refused patch and its own words, the real door spends one call on it, the browser applies the
    repair, and the indicator computes."""
    proc, _work, out = _run(tmp_path, "--cases", str(DOOR_BROWSER_CASES), "--script", str(DOOR_BROWSER_SCRIPT),
                            "--only", BROWSER_REPAIR_ID)
    assert ce.ACCEPT_THEN_REFUSE not in proc.stdout, proc.stdout[-3000:]
    (row,) = [r for r in _records(out) if r.get("case") == BROWSER_REPAIR_ID]
    assert row["grade"]["ok"] is True, row["grade"].get("problems")
    assert row["browser_repair"] is True
    assert row["usage"]["repair_gate"] == "browser:refused"
    assert row["server"]["attempts"] == 1                                 # the repair cost ONE more call
    assert row["client"]["changed"] is True and row["client"]["revision"] == 1
    grading = json.loads(io.open(out / "grading.json", encoding="utf-8").read())
    # a turn the browser sent back is not a first pass
    assert grading["gates"]["first-pass rate (no repair, >= 70%)"]["value"] == 0


def test_the_runner_names_the_class_on_any_model_turn_and_only_then():
    refused = {"changed": False, "entries": [{"lines": ["Nothing was changed.", "Change 2 ..."]}]}
    accepted = {"ok": True, "disposition": "change"}
    said = ce.accept_then_refuse({"path": "model", "server": accepted, "client": refused})
    assert said.startswith(ce.ACCEPT_THEN_REFUSE) and "Nothing was changed. Change 2" in said
    # not the class: the browser applied it; the door refused it; the door asked; no model was reached
    assert ce.accept_then_refuse({"path": "model", "server": accepted, "client": {"changed": True}}) is None
    assert ce.accept_then_refuse({"path": "model", "server": {"ok": False, "gate": "envelope:reference"}, "client": refused}) is None
    assert ce.accept_then_refuse({"path": "model", "server": {"ok": True, "disposition": "clarify"}, "client": refused}) is None
    assert ce.accept_then_refuse({"path": "local", "server": None, "client": refused}) is None


def test_a_case_that_expects_no_particular_change_still_fails_on_the_class():
    """The controls and the other-symbol case are not graded as a change. They are asked too."""
    t = {"path": "model", "unexpected_calls": 0, "model_calls": 1,
         "server": {"ok": True, "disposition": "change"},
         "client": {"changed": False, "entries": [{"lines": ["Nothing was changed."]}]}}
    for kind in ("safe-change-allowed", "none", "clarify", "refused"):
        grade = ce.Run.grade_turn(None, {"id": "x"}, {"expect": {"kind": kind}}, t, None)
        assert grade["ok"] is False and any(p.startswith(ce.ACCEPT_THEN_REFUSE) for p in grade["problems"]), kind
    applied = dict(t, client={"changed": True, "working": {}})
    quiet = dict(t, server={"ok": False, "gate": "envelope:reference"})
    assert ce.Run.grade_turn(None, {"id": "x"}, {"expect": {"kind": "none"}}, quiet, None)["ok"] is True
    import types
    safe = types.SimpleNamespace(unsafe=lambda *_a: None)                   # the one thing an applied change asks of the run
    assert ce.Run.grade_turn(safe, {"id": "x"}, {"expect": {"kind": "safe-change-allowed", "named_symbols": ["SPY"]}}, applied, None) == {"ok": True, "problems": []}


# ─── conventions the instructions teach, as cases ─────────────────────────────────────────────────

CONVENTION_CASES = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_convention_cases.json"
CONVENTION_SCRIPT = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_convention_scripted.json"


@needs_node
def test_for_the_first_time_in_n_bars_builds_marks_and_computes_in_one_call(tmp_path):
    """"For the first time in N bars", spelled the way the instructions teach it
    (`tests/test_converse_first_time_convention.py`): the door accepts it on the first call, the
    browser applies it as a marker, and it is true on at least one synthetic bar."""
    proc, _work, out = _run(tmp_path, "--cases", str(CONVENTION_CASES), "--script", str(CONVENTION_SCRIPT))
    assert proc.returncode == 0, proc.stdout[-3000:]
    assert _last_line(proc.stdout).startswith("VERDICT: PASS"), proc.stdout[-1500:]
    (row,) = [r for r in _records(out) if r.get("case") == "conv-first-time-in-n"]
    assert row["grade"]["ok"] is True, row["grade"].get("problems")
    assert row["server"]["attempts"] == 1 and row["browser_repair"] is False
    assert row["client"]["changed"] is True
