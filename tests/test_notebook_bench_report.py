"""Rails for tools/notebook_bench_report.py -- the head-to-head benchmark report (wave 9, 9A, A5).

⛔ No competitor number exists in this repository, and these rails keep it that way: the committed
results.md must equal the tool's output over the committed (empty) run, so a hand-typed number goes
red. Every fixture dump below is built in a temp directory at test time, for an app named
`fixture-app` (or `fixture-app-b`), with obviously synthetic values -- never a real app's timing.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from tools import notebook_bench_report as r  # noqa: E402
from tools import notebook_perf_harness as h  # noqa: E402

BENCH = REPO / "docs" / "notebook" / "benchmark"
FIXTURE_APPS = (("fixture-app", "Fixture app", "web, fixture"),
                ("fixture-app-b", "Fixture app B", "web, fixture"))
UA_WIN_140 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
UA_WIN_141 = UA_WIN_140.replace("Chrome/140", "Chrome/141")
UA_MAC_140 = UA_WIN_140.replace("Windows NT 10.0; Win64; x64", "Macintosh; Intel Mac OS X 10_15_7")
VERSION = r.probe_version()


def _machine(tmp: Path, **over) -> Path:
    rec = {k: f"fixture-{k}" for k in r.MACHINE_KEYS}
    rec.update({"os": "Windows 11 fixture", "chrome_version": "140.0.0.0", "obsidian_version": "9.9.9",
                "machine_name": "FIXTURE-BOX", "sitting_date": "2099-01-01"})
    rec.update(over)
    p = tmp / "machine.json"
    p.write_text(json.dumps(rec), encoding="utf-8")
    return p


def _dump(run: Path, *, app="fixture-app", op="H1", rnd=1, samples=None, invalid=(), selftest=True,
          version=None, ua=UA_WIN_140, name=None, **extra) -> Path:
    spec = r.OPS_BY_ID[op]
    d = {"probeVersion": version or VERSION, "app": app, "op": op, "kind": spec["kind"],
         "status": "COMPLETE", "userAgent": ua, "viewport": {"width": 1280, "height": 800, "dpr": 1},
         "capturedAt": "2099-01-01T00:00:00.000Z",
         "samples": list(samples if samples is not None else [111.0] * 12),
         "invalid": list(invalid),
         "selfTest": ({"ok": True, "ms": 201.0, "version": version or VERSION} if selftest is True
                      else selftest)}
    if spec["kind"] == "open":
        d["mode"] = spec["mode"]
    d.update(extra)
    p = run / (name or f"{app}__{op}__r{rnd}.json")
    p.write_text(json.dumps(d), encoding="utf-8")
    return p


def _report(run: Path, machine: Path, auto: Path | None = None) -> str:
    return r.build_report(run, machine, auto, apps=FIXTURE_APPS)


def _row(text: str, op: str, label: str) -> list[str]:
    """The cells of `label`'s row in op `op`'s table."""
    section = text.split(f"## {op}: ", 1)[1].split("\n## ", 1)[0]
    for line in section.splitlines():
        if line.startswith(f"| {label} |"):
            return [c.strip() for c in line.strip("|").split("|")]
    raise AssertionError(f"no row {label!r} under {op}")


# ── the committed artifacts ────────────────────────────────────────────────────────────────

def test_the_committed_results_equal_the_tools_output_over_the_committed_run():
    """Regenerated from the inputs results.md names on its own Inputs line -- today the empty run
    and the FILL template; after a sitting, that sitting's directory and machine.json."""
    committed = (BENCH / "results.md").read_bytes().replace(b"\r\n", b"\n").decode("utf-8")
    run, machine, auto = r.inputs_of(committed)
    assert run.is_dir() and machine.is_file(), (run, machine)
    fresh = r.build_report(run, machine, auto)
    assert committed == fresh, ("docs/notebook/benchmark/results.md is not the tool's output: regenerate it "
                                "with tools/notebook_bench_report.py, never edit it by hand")
    dumps = [p for p in run.rglob("*.json") if p.name != "machine.json"]
    if not dumps and auto is None:   # until the owner's first sitting, EVERY cell reads NOT MEASURED
        for op in r.OPS:
            for _, label, _ in r.APPS:
                n, p50, p95 = _row(fresh, op["id"], label)[3:6]
                assert (n, p50, p95) == (r.NOT_MEASURED,) * 3, f"{op['id']} / {label}: {n} {p50} {p95}"


def test_the_committed_machine_file_is_the_tools_template_and_is_refused_as_one():
    committed = json.loads((BENCH / "machine.json").read_text(encoding="utf-8"))
    assert committed == r.machine_template()
    rec, why = r.load_machine(BENCH / "machine.json")
    assert rec is None and "still holds FILL" in why


def test_the_op_list_is_the_plans_reps():
    """dispatch plan §1.2: H1-H5 20 reps (H2/H3 first + full), typing 60 chars x 3 rounds,
    paste 10, cold 5."""
    got = {o["id"]: r.op_total(o) for o in r.OPS}
    assert got == {"H1": 20, "H2": 20, "H2-full": 20, "H3": 20, "H3-full": 20, "H4": 20, "H5": 20,
                   "H6": 180, "H7": 180, "H8": 10, "H9": 5}
    assert r.OPS_BY_ID["H6"]["rounds"] == 3 and r.OPS_BY_ID["H6"]["chars_per_round"] == 60


def test_percentile_is_the_harness_one_never_a_third_copy():
    """Defined in the harness (the report imports it through tools/ on sys.path, the test through
    the `tools` package, so the module objects differ -- the DEFINITION SITE is what must match),
    and the report defines no percentile of its own."""
    import ast
    assert r.percentile.__code__.co_filename == h.percentile.__code__.co_filename
    assert Path(r.percentile.__code__.co_filename).name == "notebook_perf_harness.py"
    tree = ast.parse((REPO / "tools" / "notebook_bench_report.py").read_text(encoding="utf-8"))
    assert not [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and "percentile" in n.name]


# ── each refusal fires on a fixture ────────────────────────────────────────────────────────

def test_a_dump_from_another_probe_version_is_refused_by_name(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run, version="uct-bench-probe/0")
    out = _report(run, _machine(tmp_path))
    assert _row(out, "H1", "Fixture app")[3] == r.NOT_MEASURED
    assert "probe version 'uct-bench-probe/0' is not bench_probe.js's" in out


def test_a_dump_without_a_passing_selftest_is_refused(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run, selftest={"ok": False, "ms": 612.0, "version": VERSION})
    _dump(run, app="fixture-app-b", selftest=None)
    out = _report(run, _machine(tmp_path))
    assert out.count("no passing selfTest reading") == 2
    assert _row(out, "H1", "Fixture app")[3] == _row(out, "H1", "Fixture app B")[3] == r.NOT_MEASURED


def test_a_dump_with_test_hooks_is_refused(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run, hooks=True)
    out = _report(run, _machine(tmp_path))
    assert "test hooks were installed" in out and _row(out, "H1", "Fixture app")[3] == r.NOT_MEASURED


def test_a_FILL_machine_record_refuses_every_hand_dump(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run)
    tmpl = tmp_path / "tmpl.json"
    tmpl.write_text(json.dumps(r.machine_template()), encoding="utf-8")
    out = _report(run, tmpl)
    assert "machine record refused: machine.json still holds FILL" in out
    assert _row(out, "H1", "Fixture app")[3] == r.NOT_MEASURED


def test_a_machine_the_user_agent_contradicts_is_refused(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run, ua=UA_WIN_141)
    _dump(run, app="fixture-app-b", ua=UA_MAC_140)
    out = _report(run, _machine(tmp_path))
    assert "its user agent says Chrome 141, machine.json says '140.0.0.0'" in out
    assert "its user agent says mac, machine.json says 'Windows 11 fixture'" in out
    m = {"os": "Windows 11 fixture", "chrome_version": "140.0.0.0", "obsidian_version": "9.9.9"}
    ua_obs = UA_WIN_140.replace("Safari/537.36", "obsidian/9.9.8 Safari/537.36")
    assert "Obsidian 9.9.8" in r.machine_conflict(m, {"app": "obsidian", "userAgent": ua_obs})
    assert r.machine_conflict(m, {"app": "obsidian", "userAgent": ua_obs.replace("9.9.8", "9.9.9")}) is None
    assert r.machine_conflict(m, {"app": "fixture-app", "userAgent": UA_WIN_140}) is None


def test_a_file_name_off_the_convention_or_disagreeing_with_its_dump_is_refused(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run, name="fixture-app-H1-round1.json")
    _dump(run, app="fixture-app", op="H1", name="fixture-app__H4__r1.json")
    out = _report(run, _machine(tmp_path))
    assert "file name is not <app>__<op>__r<round>.json" in out
    assert "the file name says fixture-app/H4 but the dump says fixture-app/H1" in out


# ── how a cell reads ───────────────────────────────────────────────────────────────────────

def test_an_absent_cell_reads_NOT_MEASURED_never_zero(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run, app="fixture-app", op="H1")
    out = _report(run, _machine(tmp_path))
    cells = _row(out, "H1", "Fixture app B")
    assert cells[3:6] == [r.NOT_MEASURED] * 3
    assert _row(out, "H4", "Fixture app")[3:6] == [r.NOT_MEASURED] * 3


def test_a_measured_cell_uses_the_harness_percentile(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    samples = [float(x) for x in range(101, 121)]
    _dump(run, samples=samples)
    cells = _row(_report(run, _machine(tmp_path)), "H1", "Fixture app")
    assert cells[3] == "20"
    assert cells[4] == f"{h.percentile(samples, 50):.1f} ms" and cells[5] == f"{h.percentile(samples, 95):.1f} ms"
    assert cells[7] == "`" + (run / "fixture-app__H1__r1.json").resolve().as_posix() + "`"


def test_fewer_than_10_samples_is_labelled_an_anecdote(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run, samples=[111.0] * 9)
    cells = _row(_report(run, _machine(tmp_path)), "H1", "Fixture app")
    assert cells[4].endswith("(anecdote, n=9)") and cells[5].endswith("(anecdote, n=9)")


def test_every_attempt_timing_out_reads_not_in_dom(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run, op="H3-full", samples=[], invalid=["not-in-dom"] * 20)
    cells = _row(_report(run, _machine(tmp_path)), "H3-full", "Fixture app")
    assert cells[3:7] == ["0", "not in DOM", "not in DOM", "not-in-dom ×20"]


def test_a_typing_shortfall_reads_INCONCLUSIVE_never_a_p95(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run, op="H6", samples=[7.0] * 50, expectKeys=60, status="INCONCLUSIVE")
    cells = _row(_report(run, _machine(tmp_path)), "H6", "Fixture app")
    assert cells[4] == "INCONCLUSIVE" and "50 samples for 60 keys" in cells[5]


def test_no_winner_column_and_ratios_only_within_one_instrument_and_machine(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run, app="fixture-app", samples=[100.0] * 12)
    _dump(run, app="fixture-app-b", samples=[250.0] * 12)
    out = _report(run, _machine(tmp_path))
    header = out.split("## H1: ", 1)[1].splitlines()[4]
    assert header == "| app | client | instrument | n | p50 | p95 | invalid | source files |"
    assert "Fixture app B / fixture-app = 2.50" in out
    # an anecdote never enters a ratio
    run2 = tmp_path / "run2"
    run2.mkdir()
    _dump(run2, app="fixture-app", samples=[100.0] * 12)
    _dump(run2, app="fixture-app-b", samples=[250.0] * 5)
    assert "no other hand cell is measured with n >= 10" in _report(run2, _machine(tmp_path))


# ── the automated summary ──────────────────────────────────────────────────────────────────

def _auto_summary(tmp: Path, *, integrity="CLEAN", self_ok=True, per_op=None) -> Path:
    dumps = tmp / "auto-dumps"
    dumps.mkdir(exist_ok=True)
    _dump(dumps, app=r.AUTO_APP, op="H1", samples=[42.0] * 20, ua=UA_WIN_140.replace("Chrome/", "HeadlessChrome/"))
    summary = {"tool": "tools/notebook_bench_uct.py", "git_head": "f" * 40, "integrity": {"status": integrity},
               "self_test": {"ok": self_ok, "ms": 201.5}, "machine": {"available_mbytes": 9999},
               "per_op": per_op if per_op is not None else {
                   "H1": {"op": "H1", "kind": "open", "n": 20, "p50_ms": 42.0, "p95_ms": 42.0,
                          "status": "MEASURED", "reason": None, "dumps": ["auto-dumps/uct-sandbox-auto__H1__r1.json"]}}}
    p = tmp / "summary.json"
    p.write_text(json.dumps(summary), encoding="utf-8")
    return p


def test_the_automated_summary_fills_only_its_own_row_and_never_a_ratio(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    _dump(run, app="fixture-app", samples=[100.0] * 12)
    apps = FIXTURE_APPS + ((r.AUTO_APP, "UCT sandbox (automated)", "headless"),)
    out = r.build_report(run, _machine(tmp_path), _auto_summary(tmp_path), apps=apps)
    assert _row(out, "H1", "UCT sandbox (automated)")[3:5] == ["20", "42.0 ms"]
    assert "UCT sandbox (automated) /" not in out


def test_an_unclean_or_unverified_automated_summary_is_refused(tmp_path):
    for kw, why in (({"integrity": "NOT CLEAN"}, "sandbox integrity 'NOT CLEAN'"),
                    ({"self_ok": False}, "selfTest did not pass")):
        d = tmp_path / why.split()[0].strip("'")
        d.mkdir()
        run = d / "run"
        run.mkdir()
        apps = FIXTURE_APPS + ((r.AUTO_APP, "UCT sandbox (automated)", "headless"),)
        out = r.build_report(run, _machine(d), _auto_summary(d, **kw), apps=apps)
        assert why in out and _row(out, "H1", "UCT sandbox (automated)")[3] == r.NOT_MEASURED


def test_validate_summary_names_what_is_missing():
    good = {"tool": "t", "git_head": "x", "integrity": {}, "self_test": {}, "machine": {},
            "per_op": {"H8": {"op": "H8", "kind": "paste", "n": 0, "p50_ms": None, "p95_ms": None,
                              "status": "INCONCLUSIVE", "reason": "the clipboard write failed", "dumps": []}}}
    assert r.validate_summary(good) == []
    bad = json.loads(json.dumps(good))
    del bad["per_op"]["H8"]["reason"]
    assert r.validate_summary(bad) == ["H8: lacks reason"]
    bad2 = json.loads(json.dumps(good))
    bad2["per_op"]["H8"].update(status="INCONCLUSIVE", p50_ms=12.0)
    assert r.validate_summary(bad2) == ["H8: INCONCLUSIVE must carry a reason and no number"]


def test_the_version_is_read_from_the_probe_file(tmp_path, monkeypatch):
    fake = tmp_path / "bench_probe.js"
    fake.write_text("(() => { const PROBE_VERSION = 'uct-bench-probe/99' })()\n", encoding="utf-8")
    monkeypatch.setattr(r, "PROBE_FILE", fake)
    assert r.probe_version() == "uct-bench-probe/99"
    run = tmp_path / "run"
    run.mkdir()
    _dump(run)                                   # made with the REAL file's version
    out = _report(run, _machine(tmp_path))
    assert "is not bench_probe.js's 'uct-bench-probe/99'" in out


# ── the protocol names what the tools use (one authority each) ─────────────────────────────

PROTOCOL = BENCH / "protocol.md"


def test_the_protocol_names_the_current_probe_version_and_sha256():
    import hashlib
    text = PROTOCOL.read_text(encoding="utf-8")
    lf = r.PROBE_FILE.read_bytes().replace(b"\r\n", b"\n")
    assert hashlib.sha256(lf).hexdigest() in text, "protocol.md cites a stale sha256 of bench_probe.js"
    assert f"`{r.probe_version()}`" in text


def test_the_protocols_op_table_is_the_reports_op_list():
    import re
    text = PROTOCOL.read_text(encoding="utf-8")
    rows = re.findall(r"^\| (H\d(?:-full)?) \| (.+?) \| (.+?) \| (\d+) × (\d+)(?: characters)? \|$", text, re.M)
    got = {row[0]: (row[1], int(row[3]), int(row[4])) for row in rows}
    want = {o["id"]: (o["what"], o["rounds"], o.get("chars_per_round") or o["reps_per_round"]) for o in r.OPS}
    assert got == want


def test_the_protocols_rotation_rotates_the_hand_apps():
    import re
    text = PROTOCOL.read_text(encoding="utf-8")
    rows = re.findall(r"^\| r(\d) \| ([a-z]+) \| ([a-z]+) \| ([a-z]+) \| ([a-z]+) \|$", text, re.M)
    assert len(rows) == max(o["rounds"] for o in r.OPS)
    n = len(r.HAND_APPS)
    for rnd, *apps in rows:
        k = (int(rnd) - 1) % n
        assert tuple(apps) == r.HAND_APPS[k:] + r.HAND_APPS[:k], f"round {rnd}"
