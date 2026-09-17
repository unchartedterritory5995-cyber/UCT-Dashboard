"""The gate wrapper's own rail — because the last assertion of this shape was never verified.

⛔ THE DIRECT CAUSE OF THIS FILE. On 2026-09-09 a full-gate run asserted its totals line with
`grep '^ *Test Files'` and reported **"NO TOTALS LINE — THIS SHARD DID NOT RUN"** for all six
shards, against six 236KB logs full of real results. vitest prefixes that line with ANSI escapes,
so the anchor never matched. The assertion that exists precisely because exit codes lie was itself
unchecked, and it failed in the ALARMING direction — which is the lucky direction. The same bug
one character different (matching nothing and reporting nothing) would have passed a void run.

So: four proofs, one per way a gate result can be a lie, each naming the assertion that fires.

⛔⛔ AND THEN THE SAME DISEASE IN A SECOND BODY. Those four proofs all inject `run_shard_fn`, so
they test the CALLER and never the boundary. `_run_shard` — the one impure function, the one that
actually talks to vitest — was covered by nothing, and it shipped with `text=True` and no
`encoding=`. On Windows that decodes as cp1252, vitest emits UTF-8, and SIX SHARDS RAN FOR SIXTEEN
MINUTES AND RETURNED EMPTY STDOUT. The wrapper then reported "no totals line": a true statement
about a false cause.

Rule 10 is the fix for the disease rather than the symptom: **every impure function gets at least
one rail that executes it for real.** The two `_run_shard` rails at the bottom of this file are
that, and the injected-fake tests above remain — they are good tests of the decision logic, which
is a different thing from a test of the boundary.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))


@pytest.fixture(autouse=True)
def _never_take_the_machines_real_box_lock(monkeypatch, tmp_path):
    """⛔⛔ EVERY TEST IN THIS FILE IS POINTED AT A THROWAWAY LOCK.

    ⚰ Written after seven rails went red in one run. `_drive` spawns a child that calls the REAL
    `gate_shards.main()`, which now reaches for the REAL machine-wide lock — so the suite
    failed because a measurement harness was legitimately holding the box. The lock behaved
    perfectly; the suite was reaching into shared machine state.

    ⭐ THE SPURIOUS FAILURES ARE THE MILDER HALF. The dangerous half is the passing case: without
    this fixture, every green run of this suite TAKES AND RELEASES the machine's real lock dozens
    of times, so a test run could refuse another workstream's gate. A suite that perturbs the
    resource it is testing is the instrument-causes-the-condition defect, one layer out.

    ⚠️ `monkeypatch.setenv` mutates `os.environ`, and `_drive` passes `{**os.environ, …}` to the
    child — so the sandbox reaches the subprocess too. That is load-bearing, not incidental.
    """
    monkeypatch.setenv("UCT_GATE_BOX_LOCK", str(tmp_path / "box.lock"))
    monkeypatch.delenv("UCT_SKIP_GATE_BOX_LOCK", raising=False)


@pytest.fixture(autouse=True)
def _do_not_shell_out_to_the_real_do_not_build_sweep(monkeypatch):
    """⛔⛔ EVERY `run_gate` TEST HERE WOULD OTHERWISE SPAWN A 115-SECOND SCAN.

    `run_gate` builds its manifest with `do_not_build_sweep()` and passes it NO runner, so the
    real function shells out to `tools/q1_do_not_build_sweep.py` — measured on this tree
    2026-09-15 at **114.7 s**. Eleven tests call `run_gate` once each, so this one file cost
    ~21 minutes of scanning and `pytest.ini`'s `timeout = 300` killed the run outright.

    ⚠ AND THE KILL IS SILENT IN THE WORST WAY. On Windows pytest-timeout has no SIGALRM and
    falls back to `timeout_method = thread`, which kills the PROCESS — so what comes back is a
    stack with NO summary line and a wrapper exit code of **0**. That is the repo's own
    "a test run without a totals line is not a run" trap wearing a third face, and it is how
    this was found: the merge looked verified and nothing had been verified.

    ⭐ NOT ONE TEST IN THIS FILE ASSERTS ON `do_not_build`. The 21 minutes bought a manifest
    field nothing reads — the same defect as the box-lock fixture above, one layer out: a suite
    paying a real cost for a resource it never inspects.

    ⛔ THE STUB IS NOT A HOLE. `test_the_do_not_build_sweep_is_still_wired_both_ways` drives the
    REAL function through its own `run=` injection point and asserts BOTH outcomes, so a sweep
    that stopped working still reds. A stub without that test is how a probe gets quietly retired.
    """
    import gate_shards as _gs
    monkeypatch.setattr(_gs, "do_not_build_sweep",
                        lambda *a, **k: {"ran": True, "clean": True, "hits": [],
                                         "output": "", "stubbed_by": __name__})

from gate_shards import (  # noqa: E402
    GateError, blob_hash, count_waived_files, parse_totals, run_gate, strip_ansi, sum_totals,
    # ⛔ IMPORTED, NEVER RESTATED. `unexplained` lived in THIS FILE until 2026-09-15 and the
    # product never called it, so the suite enforced a contract the gate did not. It is now
    # `gate_shards.unexplained` and the rails below drive the SAME function the verdict does;
    # a copy here would be a second authority agreeing with itself (R-05 / the contract test
    # whose harness restated the contract).
    unexplained,
)
# ⛔ Bound HERE, at import, so the autouse stub below cannot reach it. The one test that
# exercises the REAL sweep calls THIS name; every other test gets the stub.
from gate_shards import do_not_build_sweep as _REAL_SWEEP  # noqa: E402

# ── Fixture (a): REAL captured bytes, not a hand-written approximation ────────────────────────
# Copied verbatim (via repr) from shard 6 of the 2026-09-09 run at 0ffe68a14. The escapes are the
# hazard itself, so an invented fixture would be testing the wrong string.
REAL_ANSI_PASS = (
    "\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m196 passed\x1b[39m\x1b[22m\x1b[90m (196)\x1b[39m\n"
    "\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m3546 passed\x1b[39m\x1b[22m\x1b[90m (3546)\x1b[39m\n"
)
REAL_ANSI_FAIL = (
    "\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[31m3 failed\x1b[39m\x1b[22m | "
    "\x1b[1m\x1b[32m194 passed\x1b[39m\x1b[22m\x1b[90m (197)\x1b[39m\n"
    "\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[31m4 failed\x1b[39m\x1b[22m | "
    "\x1b[1m\x1b[32m2498 passed\x1b[39m\x1b[22m\x1b[90m (2502)\x1b[39m\n"
)
# A shard that genuinely did not run: vitest died at argument parsing. This is what exit 0 looked
# like on the day it was believed.
DID_NOT_RUN = "Error: Unknown option --minWorkers\n"


def test_the_fixture_really_carries_the_hazard():
    """⛔ NON-VACUITY. If the captured bytes did not defeat a naive anchor, proof (a) below would
    pass against a scanner that never had the bug — and prove nothing."""
    assert re.match(r"^ *Test Files", REAL_ANSI_PASS) is None, (
        "the fixture no longer reproduces the ANSI-prefix bug this file exists for"
    )
    assert re.match(r"^ *Test Files", strip_ansi(REAL_ANSI_PASS)) is not None


# ── PROOF (a) — a real ANSI log parses ────────────────────────────────────────────────────────
def test_a_real_ansi_log_with_totals_is_parsed():
    got = parse_totals(REAL_ANSI_PASS)
    assert got is not None, "a healthy shard's log was read as 'did not run' — the 2026-09-09 bug"
    assert got["files"] == {"failed": 0, "passed": 196, "skipped": 0, "todo": 0, "total": 196}
    assert got["tests"]["passed"] == 3546
    assert got["tests"]["total"] == 3546

    fail = parse_totals(REAL_ANSI_FAIL)
    assert fail["files"]["failed"] == 3
    assert fail["files"]["total"] == 197
    assert fail["tests"]["failed"] == 4
    assert fail["tests"]["total"] == 2502


def test_both_totals_lines_are_required():
    """A run that died between the two lines must not read as a pass."""
    only_files = REAL_ANSI_PASS.split("\n")[0]
    assert parse_totals(only_files) is None


def test_the_sum_is_what_a_reader_reconciles_against(tmp_path):
    per_shard = [parse_totals(REAL_ANSI_FAIL), parse_totals(REAL_ANSI_PASS)]
    total = sum_totals(per_shard)
    assert total["files"]["total"] == 197 + 196
    assert total["files"]["failed"] == 3
    assert total["tests"]["passed"] == 2498 + 3546


# ── PROOF (b) — a shard that did not run ALARMS, by name ──────────────────────────────────────
def test_b_a_shard_that_did_not_run_alarms_and_names_itself(tmp_path):
    def run_shard(i):
        return DID_NOT_RUN if i == 3 else REAL_ANSI_PASS

    with pytest.raises(GateError) as e:
        run_gate(4, tmp_path, tree_state_fn=lambda: ("abc123", []),
                 run_shard_fn=run_shard, file_count_fn=lambda: 784)
    assert "NO TOTALS LINE" in str(e.value)
    assert "3" in str(e.value), "the alarm must name WHICH shard did not run"


# ── PROOF (c) — drift is caught and named ─────────────────────────────────────────────────────
def test_c_tree_drift_during_the_run_voids_it(tmp_path):
    """The 1180-then-1181 case: a file created mid-run changes what the shards were sharding."""
    states = iter([("aaa111", []), ("bbb222", [])])  # start clean, end at a DIFFERENT commit

    with pytest.raises(GateError) as e:
        run_gate(2, tmp_path, tree_state_fn=lambda: next(states),
                 run_shard_fn=lambda i: REAL_ANSI_PASS, file_count_fn=lambda: 392)
    assert "TREE DRIFT" in str(e.value)
    assert "aaa111" in str(e.value) and "bbb222" in str(e.value)


def test_c2_a_tree_that_became_dirty_mid_run_also_voids_it(tmp_path):
    states = iter([("aaa111", []), ("aaa111", [" M app/src/hub/registry.js"])])
    with pytest.raises(GateError) as e:
        run_gate(2, tmp_path, tree_state_fn=lambda: next(states),
                 run_shard_fn=lambda i: REAL_ANSI_PASS, file_count_fn=lambda: 392)
    assert "TREE DRIFT" in str(e.value)
    assert "uncommitted" in str(e.value)


# ── PROOF (d) — a dirty start refuses BEFORE running anything ─────────────────────────────────
def test_d_a_dirty_tree_refuses_before_a_single_shard_runs(tmp_path):
    ran = []

    def run_shard(i):
        ran.append(i)
        return REAL_ANSI_PASS

    with pytest.raises(GateError) as e:
        run_gate(6, tmp_path, tree_state_fn=lambda: ("abc123", [" M app/src/hub/registry.js"]),
                 run_shard_fn=run_shard, file_count_fn=lambda: 1181)
    assert "DIRTY TREE" in str(e.value)
    assert "registry.js" in str(e.value), "the refusal must name what is uncommitted"
    # ⛔ The load-bearing half: it refused BEFORE burning 13 minutes on a run it would discard.
    assert ran == [], "shards ran despite a dirty tree — the refusal is decorative"


# ── The control — a valid run produces a manifest that reconciles ─────────────────────────────
def test_a_valid_run_records_the_tree_the_wrapper_and_the_reconciliation(tmp_path):
    manifest = run_gate(
        2, tmp_path,
        tree_state_fn=lambda: ("0ffe68a14", []),
        run_shard_fn=lambda i: REAL_ANSI_FAIL if i == 1 else REAL_ANSI_PASS,
        file_count_fn=lambda: 393,
    )
    assert manifest["tree_head_start"] == manifest["tree_head_end"] == "0ffe68a14"
    assert manifest["summed"]["files"]["total"] == 393
    assert manifest["file_count_reconciles"] is True
    assert len(manifest["per_shard"]) == 2
    # The manifest names the version of the wrapper that produced it.
    assert manifest["wrapper"] == "scripts/gate_shards.py"
    assert manifest["wrapper_blob"] == blob_hash(
        pathlib.Path(__file__).resolve().parent.parent / "scripts" / "gate_shards.py"
    )


def test_a_file_count_that_does_not_reconcile_is_reported_not_hidden(tmp_path):
    """The chunked-run defect: a partial suite fails in the flattering direction."""
    manifest = run_gate(
        2, tmp_path,
        tree_state_fn=lambda: ("0ffe68a14", []),
        run_shard_fn=lambda i: REAL_ANSI_PASS,
        file_count_fn=lambda: 1181,          # disk says 1181; the shards only covered 392
    )
    assert manifest["summed"]["files"]["total"] == 392
    assert manifest["file_count_reconciles"] is False


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# RULE 10 — THE REAL BOUNDARY. Everything above injects `run_shard_fn`; these two execute
# `_run_shard` itself, against a real subprocess. They are the rails that would have caught the
# cp1252 encoding omission, and nothing above them could have.
# ═══════════════════════════════════════════════════════════════════════════════════════════════

def test_rail1_capture_round_trips_the_characters_vitest_actually_prints(tmp_path):
    """`_capture` — THE REAL BOUNDARY FUNCTION — must return UTF-8 text unmangled.

    ⭐ IT CALLS `gate_shards._capture` ITSELF. An earlier draft of this rail rebuilt the same
    `subprocess.run(...)` shape locally and asserted on that, which would have stayed green while
    the real function kept the bug — the identical "tests the caller, not the boundary" mistake,
    one level down. Removing `encoding=` from `_capture` must turn THIS red.

    Payload: U+2713 CHECK MARK and U+2014 EM DASH, the two characters vitest prints on every run
    that cp1252 cannot represent.

    ⚠️ HONEST ABOUT ITS OWN TEETH: this rail's bite is PLATFORM-DEPENDENT. On a machine whose
    default encoding is already UTF-8 it passes even against the bug, because the omission is
    harmless there. Acceptable only because the gate of record runs on THIS Windows box, where the
    default is cp1252 — recorded here rather than left for someone to rediscover.
    """
    import gate_shards

    script = tmp_path / "emit.py"
    script.write_text(
        "import sys\n"
        "sys.stdout.reconfigure(encoding='utf-8')\n"
        "print('✓ ok — done')\n",
        encoding="utf-8")

    got = gate_shards._capture([sys.executable, str(script)], tmp_path, shell=False)

    assert got.strip(), "the real subprocess returned NOTHING — the pipe is broken (encoding?)"
    assert "✓" in got, "the check mark did not survive _capture — this is the cp1252 bug"
    assert "—" in got, "the em dash did not survive _capture — this is the cp1252 bug"


def test_rail2_capture_against_real_vitest_produces_a_parseable_totals_line(tmp_path):
    """`_capture` -> REAL vitest -> `parse_totals` returns counts matching the file it ran.

    ⭐ THE BOUNDARY AGAINST ITS ACTUAL PRODUCER. Rail 1 proves a pipe carries UTF-8; only this
    proves the thing on the other end of OUR pipe is vitest, that its output arrives intact, and
    that our parser understands the format vitest emits TODAY. A future vitest that renames
    "Test Files" breaks this rail and nothing else in the suite.
    """
    import gate_shards

    app = gate_shards.APP

    # ⛔⛔ OPT-IN, BECAUSE ITS COST IS UNBOUNDED AND VARIABLE — not because it is unimportant.
    # This rail invokes `npx vitest` for real. Measured in this worktree: it completed inside a
    # 102-second whole-suite run once, and on 2026-09-17 the SAME invocation blew `_capture`'s
    # 300s ceiling and killed the run with no totals line. npx resolution plus a cold vitest
    # config load is the variance; nothing about the rail's own assertions changed between those
    # two runs. An unbounded external call sitting in the default path of a suite that gates a
    # landing will eventually eat a landing, and it did.
    #
    # ⭐ SKIPPED LOUDLY, NEVER SILENTLY. `pytest.ini` sets `-ra`, so this reason is printed in
    # every summary — a rail that opts itself out quietly is one that reads as verified while
    # having asserted nothing (`lesson_a_rails_important_half_can_be_opt_in`).
    #
    #   RUN IT DELIBERATELY:  UCT_RUN_REAL_VITEST=1 python -m pytest     #       tests/test_gate_shards.py::test_rail2_capture_against_real_vitest_produces_a_parseable_totals_line -q
    #
    # ⛔ It is the ONLY thing that proves the far end of our pipe is really vitest and that
    # `parse_totals` understands the format vitest emits TODAY — so it must be run before any
    # change to `_capture`, `parse_totals`, or the vitest version. Do not let it rot.
    if os.environ.get("UCT_RUN_REAL_VITEST") != "1":
        pytest.skip("OPT-IN rail: set UCT_RUN_REAL_VITEST=1 — real `npx vitest`, 3s..>300s, "
                    "unbounded; it killed a landing run on 2026-09-17")
    if not (app / "node_modules").exists():
        pytest.skip("app/node_modules absent — cannot invoke the real vitest")

    spec_dir = app / "src" / "__gate_rail__"
    spec_dir.mkdir(parents=True, exist_ok=True)
    spec = spec_dir / "boundary.test.js"
    spec.write_text(
        "import { describe, it, expect } from 'vitest'\n"
        "describe('gate wrapper boundary rail', () => {\n"
        "  it('passes one', () => { expect(1).toBe(1) })\n"
        "  it('passes two ✓ —', () => { expect(2).toBe(2) })\n"
        "})\n",
        encoding="utf-8")
    try:
        text = gate_shards._capture(
            ["npx", "vitest", "run", "src/__gate_rail__/boundary.test.js"], app, timeout=300)

        assert text.strip(), (
            "REAL vitest returned EMPTY output through _capture — exactly the capture failure "
            "that cost a sixteen-minute run")
        totals = parse_totals(text)
        assert totals is not None, (
            "parse_totals could not read REAL vitest output — the format changed, or the capture "
            "is mangled")
        assert totals["tests"]["passed"] == 2, totals
        assert totals["files"]["total"] == 1, totals
    finally:
        spec.unlink(missing_ok=True)
        try:
            spec_dir.rmdir()
        except OSError:
            pass


def test_run_shard_delegates_to_the_single_capture_seam():
    """⛔ AND THE SEAM CANNOT BE BYPASSED. `_run_shard` must go through `_capture`, or a fresh
    `subprocess.run(...)` there would reintroduce the omission with both rails above still green."""
    import inspect
    import gate_shards
    src = inspect.getsource(gate_shards._run_shard)
    assert "_capture(" in src, "_run_shard no longer uses the capture seam"
    assert "subprocess.run" not in src, (
        "_run_shard calls subprocess.run directly again — that is a second place for `encoding=` "
        "to be forgotten, which is how this bug shipped the first time")


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# THE WRAPPER'S OWN OUTPUT IS NOT DRIFT — and the exemption must stay narrow.
# ═══════════════════════════════════════════════════════════════════════════════════════════════

def test_the_wrappers_own_logs_do_not_count_as_tree_drift(tmp_path, monkeypatch):
    """`out_dir` lives in the repo, so the shard logs show as untracked and the drift check fired
    on the tool's own artifacts: "started clean, ended with 1 uncommitted file(s)". The check was
    right; its SCOPE was wrong. A log the wrapper wrote on purpose is not the source changing."""
    import gate_shards

    out = gate_shards.REPO / "docs" / "plans" / "joystick" / "gate-runs"
    states = iter([
        ("aaa111", []),                                   # clean start
        ("aaa111", ["?? docs/plans/joystick/gate-runs/"]),  # the wrapper's OWN output
    ])
    manifest = run_gate(
        2, out,
        tree_state_fn=lambda: next(states),
        run_shard_fn=lambda i: REAL_ANSI_PASS,
        file_count_fn=lambda: 392,
    )
    assert manifest["tree_head_end"] == "aaa111"


def test_the_drift_exemption_does_not_cover_anything_else(tmp_path):
    """⛔ THE CONTROL. An exemption wide enough to swallow a real source change would disable the
    check it lives inside — which is worse than the bug it fixes."""
    import gate_shards

    out = gate_shards.REPO / "docs" / "plans" / "joystick" / "gate-runs"
    states = iter([
        ("aaa111", []),
        ("aaa111", ["?? docs/plans/joystick/gate-runs/", " M app/src/hub/registry.js"]),
    ])
    with pytest.raises(GateError) as e:
        run_gate(2, out, tree_state_fn=lambda: next(states),
                 run_shard_fn=lambda i: REAL_ANSI_PASS, file_count_fn=lambda: 392)
    assert "TREE DRIFT" in str(e.value)
    assert "registry.js" in str(e.value), "the real source change must still void the run"


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# CONSOLE OUTPUT IS AN I/O BOUNDARY TOO — the third body of the encoding disease.
# ═══════════════════════════════════════════════════════════════════════════════════════════════

def test_say_survives_a_cp1252_console(capsysbinary):
    """`say` must not raise on characters the console cannot encode.

    ⛔ THE BUG THIS RAILS. `print(render(manifest))` raised UnicodeEncodeError on the Σ in the
    summary row, and the wrapper died AFTER A COMPLETELY SUCCESSFUL GATE — manifest written, tree
    verified, zero new failures, exit 1. Failing on the last line of a passing run is the least
    harmful version of this bug and the most embarrassing.
    """
    import gate_shards
    gate_shards.say("Σ summed — ✓ done")
    out = capsysbinary.readouterr().out.decode("utf-8", "replace")
    assert "Σ" in out
    assert "✓" in out


def test_say_survives_a_stream_with_no_binary_buffer():
    """Some captured streams (pytest's default capture, notebooks) expose no `.buffer`. `say` must
    degrade instead of raising AttributeError — a crash in the reporting path would once again turn
    a successful gate into exit 1."""
    import io
    import gate_shards

    class NoBuffer(io.StringIO):
        pass

    stream = NoBuffer()
    old = sys.stdout
    sys.stdout = stream
    try:
        gate_shards.say("Σ — ✓")
    finally:
        sys.stdout = old
    assert "Σ" in stream.getvalue()


def test_render_output_actually_contains_a_character_cp1252_cannot_encode():
    """⛔ NON-VACUITY. If `render` stopped emitting a non-cp1252 character, the two rails above
    would pass against a `say` that never had the bug — and prove nothing. The Σ in the summed row
    is the character that took the run down, so its presence is the hazard being preserved."""
    manifest = {
        "at": "2026-01-01T00:00:00", "tree_head_start": "a", "tree_head_end": "a",
        "wrapper": "scripts/gate_shards.py", "wrapper_blob": "b", "shards": 1,
        "per_shard": [{"shard": 1, "files": {"failed": 0, "passed": 1, "skipped": 0, "todo": 0,
                                             "total": 1},
                       "tests": {"failed": 0, "passed": 2, "skipped": 0, "todo": 0, "total": 2}}],
        "summed": {"files": {"failed": 0, "passed": 1, "skipped": 0, "todo": 0, "total": 1},
                   "tests": {"failed": 0, "passed": 2, "skipped": 0, "todo": 0, "total": 2}},
        "test_files_on_disk": 1, "file_count_reconciles": True,
        "failures": [], "baseline_sha": "x", "baseline_measured_at": "y",
        "vs_baseline": {"observed_count": 0, "baseline_count": 0, "new": [],
                        "no_longer_failing": [], "matches_baseline": True},
    }
    import gate_shards
    text = gate_shards.render(manifest)
    with pytest.raises(UnicodeEncodeError):
        text.encode("cp1252")


def test_say_survives_a_REAL_cp1252_console_subprocess():
    """⭐⭐ THE ONLY ONE OF THE `say` RAILS WITH TEETH, and the two above are kept honest by it.

    ⛔ WHY THE IN-PROCESS RAILS ARE NOT ENOUGH — measured, not assumed. Under pytest, `sys.stdout`
    is captured as UTF-8, so a bare `print("Σ")` succeeds and every in-process assertion passes
    against the bug. Verified by mutation on 2026-09-09: reverting `say` to `print(...)` left
    `test_say_survives_a_cp1252_console` GREEN, while the same call against a real console raised
    `UnicodeEncodeError: 'charmap' codec can't encode character '\\u03a3'`.

    So this rail spawns a REAL child with `PYTHONIOENCODING=cp1252` — the actual condition the
    wrapper faces on this machine — and asserts it exits 0. Under the bug it exits 1.

    ⚠️ Platform-honest: on a UTF-8 console this still passes against the bug, because the bug is
    harmless there. The gate of record runs on this Windows box, which is why the forced encoding
    is in the environment rather than left to chance.
    """
    import os
    import subprocess as sp

    scripts = str(pathlib.Path(__file__).resolve().parent.parent / "scripts")
    env = dict(os.environ, PYTHONIOENCODING="cp1252")
    code = (
        "import sys; sys.path.insert(0, r'" + scripts + "')\n"
        "import gate_shards\n"
        "gate_shards.say('\\u03a3 summed \\u2014 \\u2713 done')\n"
    )
    proc = sp.run([sys.executable, "-c", code], capture_output=True, text=True,
                  encoding="utf-8", errors="replace", env=env, timeout=60)

    assert proc.returncode == 0, (
        "say() crashed on a real cp1252 console — this is the bug that turned a PASSING gate into "
        f"exit 1. stderr:\n{proc.stderr}")
    assert "UnicodeEncodeError" not in (proc.stderr or "")


def test_the_docstring_still_carries_a_character_cp1252_cannot_encode():
    """⛔ NON-VACUITY for the `--help` rail below. If this module's docstring ever became pure
    ASCII, that rail would pass against a parser that never routed through `say()` and would prove
    nothing. The ⛔ in the first lines of `gate_shards.__doc__` IS the hazard — argparse prints the
    description verbatim, so that character is what reached the console and killed the process."""
    import gate_shards
    with pytest.raises(UnicodeEncodeError):
        (gate_shards.__doc__ or "").encode("cp1252")


def test_help_survives_a_REAL_cp1252_console_subprocess():
    """⛔⛔ ARGPARSE WAS THE SECOND CONSOLE WRITER AND IT WAS MISSED.

    `say()` was introduced because `print(render(manifest))` killed the wrapper on the Σ **after a
    completely successful gate**, and the fix was stated as "every console write goes through here
    so there is ONE place". Argparse never went through there — it writes `--help` and usage errors
    straight to the stream — so `python scripts/gate_shards.py --help` still died with
    `UnicodeEncodeError: 'charmap' codec can't encode character '\\u26d4'` on any cp1252 console,
    which is the default console on the box that runs the gate of record.

    ⭐ WHY THAT MATTERED MORE THAN A COSMETIC CRASH: the only way to discover `--max-workers` — the
    flag that exists so this script lowers its own footprint instead of OOM-killing a neighbour's
    13-minute run — was the help output that could not be printed.

    Same shape as the rail above: a REAL child, real `PYTHONIOENCODING=cp1252`, assert exit 0.
    ⚠️ Platform-honest in the same way — on a UTF-8 console this passes against the bug, because
    there the bug is harmless. The forced encoding is what gives it teeth.
    """
    import os
    import subprocess as sp

    script = pathlib.Path(__file__).resolve().parent.parent / "scripts" / "gate_shards.py"
    env = dict(os.environ, PYTHONIOENCODING="cp1252")
    proc = sp.run([sys.executable, str(script), "--help"], capture_output=True, text=True,
                  encoding="utf-8", errors="replace", env=env, timeout=60)

    assert proc.returncode == 0, (
        "`--help` crashed on a real cp1252 console. argparse bypasses say(); route its "
        f"_print_message through say() the way _Parser does. stderr:\n{proc.stderr}")
    assert "UnicodeEncodeError" not in (proc.stderr or ""), proc.stderr
    # ⛔ AND IT MUST ACTUALLY HAVE PRINTED THE HELP. An exit code of 0 with empty output would
    # satisfy every assertion above — the "empty result is a failed invocation" rule. Name a flag
    # rather than count bytes: this is the one a reader is here to find.
    assert "--max-workers" in (proc.stdout or ""), (
        "exit 0 but the help text never named --max-workers — the command printed nothing, or "
        f"printed to the wrong stream. stdout was:\n{proc.stdout!r}")

# ── The exit code, and the day it disagreed with its own report ───────────────────────────────
#
# ⛔ THE DEFECT. `main()` ended in a bare `return 0` under a comment saying the verdict was "a
# judgement the manifest supports and this script deliberately does not make". So on 2026-09-10 the
# wrapper printed **"⛔ The failing set DIFFERS from the baseline"** and exited **0**. Anything
# reading `$?` — a CI step, a `&&` chain, a background-task wrapper — saw success on a run whose own
# report said otherwise. That is worse than having no exit code: it is a green light nobody audited,
# and it is the same disease as `lesson_a_task_status_reports_the_wrappers_exit_not_the_suites`.
#
# ⭐ WHAT IS ENFORCED IS `new`, NOT SET EQUALITY. `compare_failures` says so itself — "`new` is the
# only one that can block a merge". `no_longer_failing` means a baseline entry stopped failing:
# master fixed it, or it stopped running. `test_gate_baseline_diff.py` pins that this direction
# NEVER blocks, so exiting non-zero on it would fail a branch for making things better — which is
# exactly how a gate teaches people to stop reading it.
#
# These rails execute the REAL script in a REAL process and observe the process's exit status,
# rather than asserting about a return value in-process (rule 10: every impure boundary gets a rail
# that executes it for real). Each carries the rule-14 non-vacuity control: a shelled-out rail that
# cannot distinguish is not a rail, and an empty result is a failed invocation until proven
# otherwise.

_SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / "scripts"

# A shard log shaped like the real thing: a totals line the parser requires, plus FAIL lines it
# reads identities from. The ANSI escapes are the hazard, so they are present here too.
def _shard_log(fail_idents: list[str]) -> str:
    body = "".join(
        f"\x1b[31m FAIL \x1b[39m  {ident}\n" for ident in fail_idents
    )
    n = len(fail_idents)
    if n:
        totals = (
            f"\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[31m{n} failed\x1b[39m\x1b[22m | "
            f"\x1b[1m\x1b[32m10 passed\x1b[39m\x1b[22m\x1b[90m ({10 + n})\x1b[39m\n"
            f"\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[31m{n} failed\x1b[39m\x1b[22m | "
            f"\x1b[1m\x1b[32m99 passed\x1b[39m\x1b[22m\x1b[90m ({99 + n})\x1b[39m\n"
        )
    else:
        totals = (
            "\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m10 passed\x1b[39m\x1b[22m\x1b[90m (10)\x1b[39m\n"
            "\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m99 passed\x1b[39m\x1b[22m\x1b[90m (99)\x1b[39m\n"
        )
    return body + totals


_DRIVER = '''
import json, pathlib, sys
sys.path.insert(0, {scripts!r})
import gate_shards

observed = json.loads(sys.argv[1])
baseline = json.loads(sys.argv[2])
out_dir  = sys.argv[3]
log_text = json.loads(sys.argv[4])

# Real run_gate, real parsing, real compare_failures, real render, real main() -> real exit status.
_real = gate_shards.run_gate
gate_shards.load_baseline = lambda: {{"measured_at": "rail", "sha": "0" * 40, "failures": baseline}}
# The stub FORWARDS whatever main() passes, overriding only the three seams this
# rail needs to fake. It used to pin its own signature (`lambda shards, od:`), so
# every new keyword main() learned broke it - `max_workers` did, then `exclude`
# and `exclude_reasons`, and all three rails in this file went red together with a
# TypeError that never reached a manifest. A stub that must be hand-synced with
# the function it wraps is a second authority over one signature.
# ⛔⛔ THE CHILD MUST STUB THE SWEEP TOO, AND THE PARENT'S autouse FIXTURE CANNOT REACH IT.
# `do_not_build_sweep()` shells out to `tools/q1_do_not_build_sweep.py`, measured at **114.7s**
# on 2026-09-15 and slower since (the tree has grown to ~9,866 files). `run_gate` calls it with
# no runner, so every `_drive` child paid a full repo scan — seven of them, ~13 minutes of pure
# waste for a manifest field not one test in this file reads.
#
# ⚰️ THIS WAS A KNOWN, WRITTEN-DOWN COST THAT THEN CAUSED A FAILURE NOBODY CONNECTED TO IT. The
# autouse stub's own docstring said the `_drive` children "still pay the sweep ... Stated, not
# hidden" — and when the scoped suite started dying at ~47%% with no totals line, four separate
# hypotheses were tested and discarded (contention, pytest-randomly, master's conftest, a missing
# `run_shard_fn` seam) before anyone re-read the sentence that already named it. A cost you have
# documented is not a cost you have bounded.
#
# ⛔ The parent's monkeypatch is process-local. `_drive` spawns a CHILD, so the stub has to be
# INSIDE this template or it does not exist where it matters.
gate_shards.do_not_build_sweep = lambda *a, **k: {{
    "ran": True, "clean": True, "hits": [], "output": "", "stubbed_by": "_DRIVER"}}
_SEAMS = ("tree_state_fn", "run_shard_fn", "file_count_fn")
gate_shards.run_gate = lambda shards, od, **kw: _real(
    shards, od,
    tree_state_fn=lambda: ("f" * 40, []),
    run_shard_fn=lambda i: log_text,
    file_count_fn=lambda: {files_on_disk},
    **{{k: v for k, v in kw.items() if k not in _SEAMS}},
)
raise SystemExit(gate_shards.main(["--shards", "1", "--out", out_dir]))
'''


def _drive(tmp_path, observed, baseline):
    """Run the real wrapper end to end in a child process; return (rc, stdout+stderr)."""
    log_text = _shard_log(observed)
    driver = tmp_path / "drive_gate.py"
    driver.write_text(
        _DRIVER.format(scripts=str(_SCRIPTS), files_on_disk=10 + len(observed)),
        encoding="utf-8",
    )
    out_dir = tmp_path / "runs"
    out_dir.mkdir(exist_ok=True)
    proc = subprocess.run(
        [sys.executable, str(driver), json.dumps(observed), json.dumps(baseline),
         str(out_dir), json.dumps(log_text)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    combined = (proc.stdout or "") + (proc.stderr or "")
    # ⛔ RULE 14 — an empty result is a failed invocation until proven otherwise. A driver that
    # died at import would give a tidy non-zero rc and prove nothing about the verdict.
    assert combined.strip(), (
        f"the wrapper produced NO output (rc={proc.returncode}) — that is a failed invocation, "
        f"not a verdict"
    )
    assert "# Gate run" in combined, (
        f"the wrapper never rendered a manifest, so its exit code is not a verdict:\n{combined[:800]}"
    )
    return proc.returncode, combined


A = "src/a.test.js > d > only the branch fails this"
B = "src/b.test.js > d > both fail this"
C = "src/c.test.js > d > only the baseline has this"


def test_the_exit_code_is_NONZERO_on_a_real_differing_set(tmp_path):
    """⛔ The case that shipped green: the report says DIFFERS, so the exit status must agree."""
    rc, out = _drive(tmp_path, observed=[A, B], baseline=[B])
    assert "DIFFERS from the baseline" in out, "expected the differing report; fixture is wrong"
    assert rc == 1, f"a run with a NEW failure exited {rc} — the exit code disagrees with its report"
    assert A in out, "the NEW failure must be named, not counted"


def test_non_vacuity_the_SAME_path_returns_zero_on_a_matching_set(tmp_path):
    """⛔ THE CONTROL. Without this, `return 1` unconditionally would pass the test above."""
    rc, out = _drive(tmp_path, observed=[B], baseline=[B])
    assert "matches the baseline exactly" in out
    assert rc == 0, f"a run whose failing set matches the baseline exited {rc}"


def test_a_baseline_entry_that_stopped_failing_does_NOT_block(tmp_path):
    """The direction that never blocks — and the manifest still reports the sets as differing.

    ⭐ This is the deliberate disagreement: `matches_baseline` is false while the exit code is 0,
    because master fixing something is not this branch's regression. Enforcing set equality here
    would fail a branch for an improvement.
    """
    rc, out = _drive(tmp_path, observed=[B], baseline=[B, C])
    assert rc == 0, f"a stale baseline in the non-blocking direction exited {rc} and blocked a merge"
    assert "never blocks" in out, "the reason must be stated, or 'differs' reads as a failure"


def test_a_refused_run_is_still_distinguishable_from_a_verdict(tmp_path):
    """Exit 2 is 'this is not a gate run' and must not collide with either verdict."""
    from gate_shards import EXIT_NEW_FAILURES, EXIT_NO_NEW
    assert len({EXIT_NO_NEW, EXIT_NEW_FAILURES, 2}) == 3, (
        "the invalid-run code collides with a verdict code, so a caller cannot tell a broken run "
        "from a failing one"
    )


def test_the_verdict_reads_the_same_block_the_manifest_publishes(tmp_path):
    """⛔ A second derivation of 'did anything break' is how the two answers drift apart."""
    from gate_shards import compare_failures, verdict_exit_code
    v = compare_failures([A, B], [B])
    assert verdict_exit_code({"vs_baseline": v}) == 1
    assert verdict_exit_code({"vs_baseline": compare_failures([B], [B])}) == 0
    # A manifest with no comparison at all must not silently pass as "nothing new".
    assert verdict_exit_code({}) == 0, "an absent comparison is the empty-baseline case, not a block"


def test_the_reconcile_SUBTRACTS_waived_files(tmp_path):
    """⛔ A waived run runs fewer files than exist, and that must RECONCILE.

    Before this, the blunt equality printed "DOES NOT RECONCILE" on a healthy
    waived gate (1283 on disk vs 1282 run) and left a reader to do the
    subtraction by hand. A check that cries wolf on its own waiver is one people
    learn to skip — and it exists because a partial suite fails in the
    FLATTERING direction.
    """
    src = tmp_path / "src"
    (src / "hub").mkdir(parents=True)
    (src / "hub" / "rule12Paths.test.js").write_text("x", encoding="utf-8")
    (src / "hub" / "other.test.js").write_text("x", encoding="utf-8")
    (src / "keep.test.jsx").write_text("x", encoding="utf-8")

    assert count_waived_files(("**/rule12Paths.test.js",), root=src) == 1
    # ⭐ CONTROL: a glob matching nothing subtracts NOTHING, so it cannot excuse
    # a real shortfall.
    assert count_waived_files(("**/doesNotExist.test.js",), root=src) == 0
    # ⭐ CONTROL: no waiver at all is zero, not a crash.
    assert count_waived_files((), root=src) == 0
    # …and a glob CAN match more than one when it is meant to.
    assert count_waived_files(("**/*.test.js",), root=src) == 2


# ══════════════════════════════════════════════════════════════════════════
# The expected_red note claims each entry names the fix it waits on. Until
# 2026-09-14 the entries were bare strings naming neither, so the note was a
# claim about the data rather than a property of it.
# ══════════════════════════════════════════════════════════════════════════


def _baseline():
    p = pathlib.Path(__file__).resolve().parents[1] / 'docs/plans/joystick/gate-baseline.json'
    return json.loads(p.read_text(encoding='utf-8'))


# ⛔ `unexplained` USED TO BE DEFINED RIGHT HERE. It is imported at the top of this file now and
# lives in `scripts/gate_shards.py`, because "one implementation shared by the rail and by its
# control" was still one implementation SHORT: the product itself did not have it, so a baseline
# carrying an unexplained waiver passed the gate and failed only the test suite. Promoting it made
# the gate return `EXIT_UNEXPLAINED_RED`; the rails below drive that path.


def test_every_expected_red_entry_names_a_reason_and_what_it_waits_on():
    """
    ⛔ A DELIBERATE RED NOBODY CAN EXPLAIN IS INDISTINGUISHABLE FROM ONE NOBODY
    NOTICED. compare_failures takes set(expected_red), so the entries must stay
    hashable strings - the reason therefore lives BESIDE the list, keyed by the
    same string, and this rail is what stops the two drifting apart.
    """
    b = _baseline()
    reasons = b.get('expected_red_reasons', {})
    missing = unexplained(b)
    assert not missing, (
        'expected_red entr(ies) with no reason beside them: ' + repr(missing))
    for entry, r in reasons.items():
        assert r.get('why', '').strip(), entry
        assert r.get('waits_on', '').strip(), entry


def test_a_reason_for_an_entry_that_is_not_declared_red_is_also_a_drift():
    """
    The other direction: a reason left behind after its entry was removed reads
    as documentation of a red that is no longer declared. Strict both ways, the
    same discipline compare_failures already applies to a stale entry.
    """
    b = _baseline()
    orphaned = [k for k in b.get('expected_red_reasons', {})
                if k not in set(b.get('expected_red', []))]
    assert not orphaned, (
        'reason(s) with no matching expected_red entry: ' + repr(orphaned))


def test_the_rail_can_fail_a_non_vacuity_control():
    """
    ⛔ An empty expected_red list satisfies both rails above for free, so on a
    day with nothing declared they would pass while proving nothing. This asserts
    the pairing logic actually rejects an unexplained entry.
    """
    planted = {'expected_red': ['x > y > z'], 'expected_red_reasons': {}}
    assert unexplained(planted) == ['x > y > z'], (
        'the pairing check cannot detect an unexplained entry')
    explained = {'expected_red': ['x > y > z'],
                 'expected_red_reasons': {'x > y > z': {'why': 'w', 'waits_on': 'n'}}}
    assert unexplained(explained) == [], (
        'the pairing check cannot tell an EXPLAINED entry apart — a check that '
        'answers no to everything passes for the wrong reason')


# ══════════════════════════════════════════════════════════════════════════
# C-3 — the predicate above is now part of the VERDICT, not only of the suite.
# Until 2026-09-15 `unexplained` existed solely in this file: `compare_failures`
# subtracted every `expected_red` entry out of `new` without asking whether the
# entry named a reason, so a gate run against a baseline carrying an unsigned
# waiver printed VERDICT=NO_NEW_FAILURES exit=0.
# ══════════════════════════════════════════════════════════════════════════


def _clean_manifest(unexplained_entries: list[str]) -> dict:
    """A manifest that is GREEN in every other direction, so the only thing under test is this.

    ⛔ Deliberately reconciling and deliberately empty everywhere else: if any other field could
    also produce a non-zero code, the rail below would pass without the new check existing.
    """
    return {
        "summed": {"files": {"total": 10, "failed": 0}, "tests": {"total": 100, "failed": 0}},
        "per_shard": [{"shard": 1, "files": {"total": 10}}],
        "test_files_on_disk": 10, "test_files_waived": 0,
        "file_count_reconciles": True,
        "vs_baseline": {
            "new": [], "no_longer_failing": [],
            "expected_red_seen": [], "expected_red_stale": [],
            "expected_red_unexplained": list(unexplained_entries),
        },
    }


def test_an_unexplained_expected_red_entry_gets_ITS_OWN_verdict_class():
    """⛔ NOT A PASS AND NOT A REGRESSION — the third answer.

    The entry was already subtracted out of `new` by `compare_failures`, so `new: 0` here is an
    unanswered question wearing a green. The code must be distinguishable from BOTH neighbours:
    a caller told NEW_FAILURES goes hunting for a regression that does not exist, and a caller
    told NO_NEW_FAILURES merges on an excuse nobody wrote down.
    """
    import gate_shards as gs
    code = gs.verdict_exit_code(_clean_manifest(['app/x.test.js > a > b']),
                                say=lambda *a, **k: None)
    assert code == gs.EXIT_UNEXPLAINED_RED, (
        f'an expected_red entry naming no reason exited {code}; the gate folded a waiver '
        f'nobody signed into the pass/fail count')
    assert code not in (gs.EXIT_NO_NEW, gs.EXIT_NEW_FAILURES), 'the class was collapsed'
    line = gs.verdict_line(code, expected_red_unexplained=1)
    assert line.startswith('VERDICT=UNEXPLAINED_RED exit=5'), line
    assert 'UNKNOWN' not in line


def test_control_the_same_run_with_the_entry_EXPLAINED_is_a_clean_pass():
    """⭐ THE NON-VACUITY CONTROL. Without it the check above would pass just as happily if
    `verdict_exit_code` returned 5 unconditionally, or if the manifest were malformed in a way
    that made every run non-green. Same manifest, one field different, opposite answer."""
    import gate_shards as gs
    code = gs.verdict_exit_code(_clean_manifest([]), say=lambda *a, **k: None)
    assert code == gs.EXIT_NO_NEW, (
        f'a baseline whose every expected_red entry names a reason must exit 0, got {code} — '
        f'a check that answers UNEXPLAINED_RED to everything proves nothing')


def test_control_the_unexplained_class_is_answered_BEFORE_the_thing_it_waives():
    """⛔ ORDER IS THE POINT, and it is a control in its own right.

    A run that did not reconcile is ALSO not a verdict, and it outranks this one: a partial suite
    has an incomplete failing set, so there is nothing yet to waive. Asserting both directions
    pins the order rather than leaving it to whichever `if` happens to come first.
    """
    import gate_shards as gs
    m = _clean_manifest(['app/x.test.js > a > b'])
    m['file_count_reconciles'] = False
    assert gs.verdict_exit_code(m, say=lambda *a, **k: None) == gs.EXIT_DID_NOT_RECONCILE, (
        'an incomplete suite must outrank the waiver check — its failing set is not final')
    # …and an unexplained entry outranks a STALE expected-red, which is a judgement about an
    # entry we can at least read.
    m2 = _clean_manifest(['app/x.test.js > a > b'])
    m2['vs_baseline']['expected_red_stale'] = ['app/y.test.js > c > d']
    assert gs.verdict_exit_code(m2, say=lambda *a, **k: None) == gs.EXIT_UNEXPLAINED_RED


def test_the_gate_reads_the_promoted_predicate_from_the_REAL_baseline_file(tmp_path, monkeypatch):
    """⛔ THE WIRING, not the predicate. `unexplained` was correct for a whole day while nothing
    called it; this drives `run_gate` against a planted baseline and reads the manifest.

    ⭐ And the control is the same run against a baseline whose entry IS explained — the manifest
    must then publish an EMPTY list, so the key cannot be a constant.
    """
    import gate_shards as gs
    planted = tmp_path / 'baseline.json'

    def _manifest(reasons: dict) -> dict:
        planted.write_text(json.dumps({
            'sha': 'deadbeef', 'measured_at': '2026-09-15', 'failures': [],
            'expected_red': ['app/x.test.js > a > b'], 'expected_red_reasons': reasons,
        }), encoding='utf-8')
        monkeypatch.setattr(gs, 'BASELINE', planted)
        return run_gate(1, tmp_path,
                        tree_state_fn=lambda: ('0ffe68a14', []),
                        run_shard_fn=lambda i: REAL_ANSI_PASS,
                        file_count_fn=lambda: 196)

    bad = _manifest({})
    assert bad['vs_baseline']['expected_red_unexplained'] == ['app/x.test.js > a > b'], (
        'run_gate does not publish the unexplained class — the predicate is promoted but unwired')
    assert 'no reason' in gs.render(bad), 'the rendered manifest hides the unexplained class'

    good = _manifest({'app/x.test.js > a > b': {'why': 'w', 'waits_on': 'n'}})
    assert good['vs_baseline']['expected_red_unexplained'] == [], (
        'the manifest reports an unexplained entry that IS explained — the key is a constant')


# ══════════════════════════════════════════════════════════════════════════
# The coverage check is part of the VERDICT. It was computed and rendered from
# day one and read by nothing, so a short run exited 0 saying 'no NEW failures'.
# ══════════════════════════════════════════════════════════════════════════


def _reconcile_manifest(reconciles: bool) -> dict:
    """
    A manifest whose baseline comparison is CLEAN in every direction, so the only
    thing these cases differ by is coverage. If the verdict changes, coverage is
    what changed it.
    """
    return {
        'file_count_reconciles': reconciles,
        'test_files_on_disk': 1352,
        'test_files_waived': 0,
        'summed': {'files': {'total': 1352 if reconciles else 1016}},
        'per_shard': [{'shard': i, 'files': {'total': 225}} for i in range(1, 7)],
        'vs_baseline': {'new': [], 'no_longer_failing': [],
                        'expected_red_seen': [], 'expected_red_stale': []},
    }


def test_a_run_that_does_not_reconcile_exits_non_zero_even_with_a_clean_baseline():
    """
    ⛔ THE FLATTERING DIRECTION. Fewer files run means fewer failures found, so
    a short run produces `new: []` and reads exactly like a pass.
    """
    import scripts.gate_shards as gs
    code = gs.verdict_exit_code(_reconcile_manifest(False), say=lambda *a, **k: None)
    assert code != 0, 'a short run must not exit 0'
    assert code == gs.EXIT_DID_NOT_RECONCILE, (
        'a short run needs its OWN code - it is not the same fact as a regression')


def test_the_same_manifest_that_reconciles_exits_zero():
    """
    The control. Without it the case above could pass because verdict_exit_code
    rejects everything - a check that answers no to any question.
    """
    import scripts.gate_shards as gs
    code = gs.verdict_exit_code(_reconcile_manifest(True), say=lambda *a, **k: None)
    assert code == gs.EXIT_NO_NEW, f'a clean, reconciling run must exit 0, got {code}'


def test_the_short_run_message_names_the_counts_and_the_shards():
    """
    ⛔ A refusal that does not say WHAT was missed cannot be acted on, and gets
    waived. Names and counts, not a bare verdict.
    """
    import scripts.gate_shards as gs
    lines = []
    gs.verdict_exit_code(_reconcile_manifest(False),
                         say=lambda m='', **k: lines.append(str(m)))
    blob = chr(10).join(lines)
    assert '1016' in blob, 'must say how many ran'
    assert '1352' in blob, 'must say how many were expected'
    assert 'shard 1' in blob and 'shard 6' in blob, 'must break it down per shard'


# ══════════════════════════════════════════════════════════════════════════
# The re-derivation precondition. Justifying a carry-over by hashing app/src
# ALONE is the flattering answer; the read set is a LIST and this is the only
# thing allowed to answer it.
# ══════════════════════════════════════════════════════════════════════════


def test_the_read_set_names_the_config_and_the_lockfile_not_just_app_src():
    """
    ⛔ app/src is the big one, not the whole set. A vitest config or a
    lockfile change alters what the suite DOES without touching a single test.
    """
    import scripts.gate_shards as gs
    for rel in ('app/src', 'app/vite.config.js', 'app/package.json',
                'app/package-lock.json'):
        assert rel in gs.GATE_READ_PATHS, rel


def test_identical_trees_permit_re_derivation():
    import scripts.gate_shards as gs
    class R:
        def __init__(s, out, rc=0): s.stdout, s.returncode = out, rc
    ok, diff = gs.gate_read_identical('A', 'B', paths=('x', 'y'),
                                      run=lambda argv: R('same-hash'))
    assert ok is True and diff == []


def test_one_differing_path_refuses_and_NAMES_it():
    """
    The other direction, and it must say WHICH path - a refusal nobody can act
    on gets waived.
    """
    import scripts.gate_shards as gs
    class R:
        def __init__(s, out, rc=0): s.stdout, s.returncode = out, rc
    def run(argv):
        return R('hash-b') if argv[-1].endswith(':y') and argv[-1].startswith('B') else R('hash-a')
    ok, diff = gs.gate_read_identical('A', 'B', paths=('x', 'y'), run=run)
    assert ok is False and diff == ['y'], diff


def test_a_path_missing_on_one_side_is_DIFFERING_not_equal():
    """
    ⛔ Two absent paths must not hash to the same empty string and read as
    equal. That is the vacuous answer this check exists to refuse.
    """
    import scripts.gate_shards as gs
    class R:
        def __init__(s, out, rc): s.stdout, s.returncode = out, rc
    ok, diff = gs.gate_read_identical('A', 'B', paths=('gone',),
                                      run=lambda argv: R('', 128))
    assert ok is False and diff == ['gone']


# ══════════════════════════════════════════════════════════════════════════
# ⛔⛔ AND THE READ SET IS DERIVED, NOT REMEMBERED.
#
# The four-path list above was written when `app/src` + the config + the
# lockfile looked like the whole story. It is not: the runner's cwd is `app/`,
# so a rail's `path.resolve(process.cwd(), '../…')` reaches the REPO ROOT, and
# the suite reads script corpora, generated docs, decision records and a dozen
# PYTHON sources. Fourteen of those paths were absent from GATE_READ_PATHS on
# 2026-09-15 — including three (`api/routers/definition_record.py`,
# `api/services/implied_move.py`, `api/services/setup_grade.py`) that a careful
# hand sweep of the same sources missed and this derivation found.
#
# ⭐ So the list is re-derived here every run. A per-file read set is precise
# enough to keep the re-derivation USEFUL (naming `docs/` or `api/` whole would
# answer DIFFERS forever), and this rail is what stops precision turning into
# drift: the fifteenth path fails BY NAME rather than being silently un-hashed.
# ══════════════════════════════════════════════════════════════════════════

#: Repo-root path literals a vitest source NAMES without opening. Each is a
#: hand-written fixture row or an ownership prefix in `rule12Paths.test.js`,
#: which asserts on the CLASSIFIER over invented change sets. ⛔ An entry here is
#: a CLASSIFICATION, not a waiver: a path that moves into this dict without a
#: reason is a path nobody checked.
NAMED_BUT_NOT_READ = {
    'docs/plans/joystick': 'rule12Paths.test.js — an owned-prefix string in JOYSTICK_PREFIXES',
    'docs/plans/joystick/closure.md': 'rule12Paths.test.js — a `changed` fixture row',
    'docs/plans/joystick/deferred.md': 'rule12Paths.test.js — a `changed` fixture row',
    'docs/plans/joystick/scope-reconciliation.md': 'rule12Paths.test.js — a `changed` fixture row',
    'api/routers/calendar.py': 'rule12Paths.test.js — a `changed` fixture row for a NON-joystick branch',
}

_PATH_LITERAL = re.compile(r"""['"]([A-Za-z0-9_.\-/]+)['"]""")


def _repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parent.parent


def _tracked_and_top_dirs():
    """(tracked paths, top-level directory names) — DERIVED from git, never typed.

    ⛔ `git -C <root>`: git resolves pathspecs against the cwd and `ls-files`
    output against the repo, and the two disagreeing is invisible (rule 14).
    """
    out = subprocess.run(['git', '-C', str(_repo_root()), 'ls-files'],
                         capture_output=True, text=True, encoding='utf-8',
                         errors='replace', check=True).stdout.splitlines()
    return set(out), {p.split('/')[0] for p in out if '/' in p}


def _normalise(spec: str) -> str:
    parts = spec.split('/')
    while parts and parts[0] in ('.', '..'):
        parts.pop(0)
    return '/'.join(parts).rstrip('/')


def root_relative_literals():
    """{repo-root path: the vitest sources that name it}.

    ⛔⛔ IT IS A DRIFT DETECTOR, NOT A CENSUS, AND THE DIFFERENCE IS THE WHOLE
    HONESTY OF IT. A path built by concatenation, or resolved relative to the
    TEST FILE rather than the repo root, is invisible to a literal scan —
    `app/scripts/build-cot-facts.mjs` is imported as
    '../../../scripts/build-cot-facts.mjs' and never appears in this result.
    Those are covered by hand in GATE_READ_PATHS and by the explicit rail below.
    What this catches is the shape that actually keeps appearing: a quoted
    repo-root path handed to `readFileSync` / `existsSync` / `execFileSync`.

    ⛔ A literal is kept only if it TRACKS or EXISTS. That is what separates a
    path from prose — `'api/routers/auth.py moved — the kill switch is elsewhere
    now'` is a failure message, not a read, and it resolves to nothing.
    """
    root = _repo_root()
    tracked, top = _tracked_and_top_dirs()
    found: dict[str, set[str]] = {}
    for p in (root / 'app' / 'src').rglob('*'):
        if p.suffix not in ('.js', '.jsx'):
            continue
        if '.test.' not in p.name and '.spec.' not in p.name:
            continue
        text = p.read_text(encoding='utf-8', errors='replace')
        for m in _PATH_LITERAL.finditer(text):
            rel = _normalise(m.group(1))
            if '/' not in rel or rel.split('/')[0] not in top:
                continue
            if rel.startswith('app/src/'):          # the tree hash already covers it
                continue
            if rel in tracked or (root / rel).is_dir():
                found.setdefault(rel, set()).add(p.relative_to(root).as_posix())
    return found


def _covered_by(rel: str, paths) -> bool:
    return any(rel == p or rel.startswith(p + '/') for p in paths)


def test_the_scan_that_derives_the_read_set_actually_READ_something():
    """
    ⛔ THE NON-VACUITY CONTROL, AND IT COMES FIRST. An empty result satisfies
    "every path found is covered" perfectly, so a glob that matched nothing, a
    wrong cwd, or a `git ls-files` that returned empty would publish a green
    coverage claim over zero evidence (rule 14).

    ⭐ It names MEMBERS, not only a count: a count drifts, a name fails loudly.
    """
    found = root_relative_literals()
    assert len(found) >= 40, f'the scan found only {len(found)} literals — it is not reading the suite'
    for member in ('tests/fixtures/ast/corpus.json',
                   'api/services/indicator_alert_evaluator.py',
                   'docs/decisions/2026-08-03-engine-enabled-settings-migration.md'):
        assert member in found, f'{member} is read by a rail and the scan did not see it'
    assert 'app/src/hub/registry.js' not in found, 'app/src must be filtered out, it is covered by its tree hash'


def test_the_read_set_covers_every_root_relative_path_the_suite_reads():
    """
    Every repo-root path a vitest source names is either IN the read set or
    CLASSIFIED as named-but-not-read. Nothing may be neither.
    """
    import scripts.gate_shards as gs
    uncovered = sorted(rel for rel in root_relative_literals()
                       if not _covered_by(rel, gs.GATE_READ_PATHS) and rel not in NAMED_BUT_NOT_READ)
    assert not uncovered, (
        'these paths are read by the suite and are NOT in GATE_READ_PATHS, so a re-derivation '
        'would carry a verdict across a change to them:\n  ' + '\n  '.join(uncovered))


def test_the_coverage_predicate_can_say_NO():
    """
    ⛔ The control for the rail above. If `_covered_by` answered True for
    everything, "nothing uncovered" would be a tautology over any read set.
    """
    import scripts.gate_shards as gs
    assert _covered_by('app/src/hub/registry.js', gs.GATE_READ_PATHS) is True
    assert _covered_by('api/services/__nothing_reads_this__.py', gs.GATE_READ_PATHS) is False
    # ⛔ and a PREFIX is not a parent: `app/scripts` must not swallow `app/scriptsX`.
    assert _covered_by('app/scriptsX/thing.mjs', gs.GATE_READ_PATHS) is False


def test_every_path_in_the_read_set_EXISTS_in_git():
    """
    ⛔ A path that git cannot resolve is reported DIFFERING on both sides by
    `gate_read_identical` — correctly — which would make the precondition refuse
    every carry-over forever, for a typo. `tests/fixtures/pine-inbox` is named by
    `dialect.test.js` and does not exist; that is why the read set carries the
    PARENT `tests/fixtures` rather than the absent child.
    """
    import scripts.gate_shards as gs
    root = _repo_root()
    missing = [p for p in gs.GATE_READ_PATHS
               if subprocess.run(['git', '-C', str(root), 'rev-parse', f'HEAD:{p}'],
                                 capture_output=True).returncode != 0]
    assert not missing, f'not resolvable at HEAD: {missing}'


def test_the_read_set_names_the_corpora_the_generators_and_the_cross_lane_sources():
    """
    The four families `app/src` cannot see, one named member each — so a deletion
    from the tuple fails by name instead of quietly shrinking the precondition.
    """
    import scripts.gate_shards as gs
    for rel in ('tests/fixtures',                                  # the script corpora
                'app/scripts',                                     # build entry points two rails run
                'tools/hub_surface_matrix.mjs',                    # a generator a rail EXECUTES
                'docs/plans/joystick/glass-acceptance-steps.md',   # an artifact a rail byte-compares
                'docs/formulas/GRAMMAR.md',
                'docs/decisions/2026-08-06-machine-repaint-linter.md',
                'api/services/indicator_compute.py',               # cross-lane parity reads
                'api/services/journal_two/roundtrip_export_fixture.py'):  # and one it EXECUTES
        assert rel in gs.GATE_READ_PATHS, rel
# ═══════════════════════════════════════════════════════════════════════════════════════════════
# THE EXIT CODE IS READ, AND THE VERDICT IS A LINE OF OUTPUT
#
# ⚰ Two separate lies, one disease, both measured in this repo:
#
#   1. `_capture` read the text of a subprocess and THREW AWAY `proc.returncode`. At the one place
#      this tool reads a process, exit 2 and exit 0 returned the same kind of value carrying the
#      same information. On 2026-09-14 a box-clearance waiter printed TIMEOUT and exited 2, and
#      what reached the operator was exit 0 — one step from sending a settling run into a live gate.
#
#   2. The wrapper's own exit code is not reliable IN TRANSIT. 2026-09-13: it printed
#      "GATE EXIT: 1" on a NEW failure and the task status said exit 0. 2026-09-09: a runner that
#      executed nothing also said 0. The channel is uninformative in BOTH directions.
#
# Every rail below is paired with a control that must return the OTHER answer, because the whole
# defect was an instrument that returned one answer to two different questions.
# ═══════════════════════════════════════════════════════════════════════════════════════════════

def _waiter(tmp_path, name: str, line: str, code: int) -> pathlib.Path:
    """A synthetic waiter: prints one line, exits with `code`. The shape of the real incident."""
    p = tmp_path / f"{name}.py"
    p.write_text(
        "import sys\n"
        "sys.stdout.reconfigure(encoding='utf-8')\n"
        f"print({line!r})\n"
        f"sys.exit({code})\n",
        encoding="utf-8")
    return p


def test_capture_reports_the_code_a_waiter_actually_exited_with(tmp_path):
    """⛔ THE REPRODUCTION. A waiter that prints TIMEOUT and exits 2 must be READABLE as 2.

    Before the fix this was unanswerable: `_capture` returned a bare `str`, so the only code a
    caller could report was the one it never learned. It calls `gate_shards._capture` ITSELF —
    rebuilding the `subprocess.run(...)` shape locally would test the copy and leave the boundary
    exactly as broken as it was, which is the mistake rail 1 above already documents.
    """
    import gate_shards

    script = _waiter(tmp_path, "timeout", "TIMEOUT - box never cleared within 25 min", 2)
    got = gate_shards._capture([sys.executable, str(script)], tmp_path, shell=False)

    assert "TIMEOUT" in got, "the text did not survive — the pipe is broken, not the code"
    assert got.returncode == 2, (
        f"_capture reported {got.returncode!r} for a waiter that exited 2 — this is the exit-code "
        f"discard that nearly corrupted the 2026-09-14 settling runs")


def test_non_vacuity_a_waiter_that_exits_zero_reports_zero(tmp_path):
    """⛔ THE CONTROL, and it is the entire point rather than a formality.

    A `_capture` hard-wired to `returncode = 2` would pass the rail above. What the defect actually
    was is an instrument that could not DISCRIMINATE, so the proof has to be that it now can: the
    same call shape, the same text-bearing waiter, the other answer.
    """
    import gate_shards

    script = _waiter(tmp_path, "clear", "CLEAR - box quiet, 11.8 GB free", 0)
    got = gate_shards._capture([sys.executable, str(script)], tmp_path, shell=False)

    assert "CLEAR" in got
    assert got.returncode == 0, f"a clean waiter reported {got.returncode!r}"


def test_capture_is_still_a_plain_string_to_every_existing_consumer(tmp_path):
    """⛔ THE COMPATIBILITY RAIL — this wrapper is SHARED, on master, run by other workstreams.

    The fix is only minimal if nothing downstream can tell it happened. Every way the result is
    consumed today is exercised here against the real function: membership, `.strip()`,
    `write_text`, and `parse_totals`. A tuple return would have failed all four.
    """
    import gate_shards

    script = tmp_path / "totals.py"
    script.write_text(
        "import sys\n"
        "sys.stdout.reconfigure(encoding='utf-8')\n"
        "print(' Test Files  1 passed (1)')\n"
        "print('      Tests  2 passed (2)')\n",
        encoding="utf-8")
    got = gate_shards._capture([sys.executable, str(script)], tmp_path, shell=False)

    assert isinstance(got, str), "the result stopped being a str — every existing caller breaks"
    assert got.strip(), ".strip() must still work"
    assert "Test Files" in got, "membership must still work"
    (tmp_path / "shard.log").write_text(got, encoding="utf-8")   # what _run_shard does
    totals = parse_totals(got)
    assert totals is not None and totals["tests"]["passed"] == 2, totals


def test_an_empty_capture_names_the_code_that_explains_it(tmp_path):
    """⛔ THE `or ""` TRAP, which is where the code matters MOST and where it was lost last.

    `text = run_shard_fn(i) or ""` collapses an empty result to a plain `str`, discarding the
    attribute at exactly the moment the output is gone and the code is the only evidence left.
    The EMPTY CAPTURE refusal must therefore be able to say WHY the shard produced nothing.
    """
    import gate_shards

    with pytest.raises(GateError) as e:
        run_gate(1, tmp_path,
                 tree_state_fn=lambda: ("a" * 40, []),
                 run_shard_fn=lambda i: gate_shards.Captured("", 2),
                 file_count_fn=lambda: 10)
    assert "EMPTY CAPTURE" in str(e.value)
    assert "with code 2" in str(e.value), (
        f"the refusal did not name the exit code, so it cannot tell a crash from a hang:\n{e.value}")


def test_a_seam_that_never_observed_a_code_says_so_instead_of_saying_zero(tmp_path):
    """⛔ `None` IS NOT `0`, and collapsing them is how "nobody looked" becomes "it was fine".

    An injected test seam returns a plain `str` and never ran a process at all. Reporting that as
    `exited 0` would be the swallowed-error defect in one word. The CONTROL is the test above,
    which must keep printing a real number rather than this hedge.
    """
    with pytest.raises(GateError) as e:
        run_gate(1, tmp_path,
                 tree_state_fn=lambda: ("a" * 40, []),
                 run_shard_fn=lambda i: DID_NOT_RUN,      # plain str, no .returncode
                 file_count_fn=lambda: 10)
    msg = str(e.value)
    assert "NO TOTALS LINE" in msg
    assert "UNOBSERVED" in msg, f"an unobserved code was reported as a number:\n{msg}"
    assert "code 0" not in msg, f"'not observed' was rendered as exit 0:\n{msg}"


def test_the_manifest_publishes_the_shard_exit_codes(tmp_path):
    """A shard that exits non-zero while printing a clean totals line is not a failure — but it is
    a FACT, and it was invisible for the whole life of this tool. ⛔ It is recorded, not enforced:
    vitest exits 1 on an ordinary red test, so making this a gate condition would fail every
    legitimately-red run twice. The verdict below stays the failing-set comparison."""
    import gate_shards

    manifest = run_gate(
        2, tmp_path,
        tree_state_fn=lambda: ("b" * 40, []),
        run_shard_fn=lambda i: gate_shards.Captured(REAL_ANSI_PASS, 1 if i == 2 else 0),
        file_count_fn=lambda: 392,
    )
    assert manifest["shard_exit_codes"] == {"1": 0, "2": 1}, manifest["shard_exit_codes"]
    assert [s["exit_code"] for s in manifest["per_shard"]] == [0, 1]
    # ⭐ AND IT DID NOT BECOME THE VERDICT. Shard 2 exited 1 and the gate still reports on the
    # failing set alone — the two must not be wired together.
    assert manifest["summed"]["tests"]["passed"] == 7092


# ── The VERDICT= line ─────────────────────────────────────────────────────────────────────────

_VERDICT_RE = re.compile(r"^VERDICT=(?P<name>[A-Z_]+) exit=(?P<exit>\d+)(?P<rest>.*)$", re.M)


def _read_verdict(output: str) -> dict:
    """Read the verdict the way a consumer with no JSON parser would: one grep, one line."""
    m = _VERDICT_RE.search(output)
    assert m, f"no VERDICT= line in the wrapper's output:\n{output[-1200:]}"
    fields = dict(kv.split("=", 1) for kv in m.group("rest").split() if "=" in kv)
    return {"name": m.group("name"), "exit": int(m.group("exit")), **fields}


def test_the_verdict_line_carries_the_result_without_the_exit_code(tmp_path):
    """⛔ THE WHOLE POINT. Derive the verdict from OUTPUT alone and it must match the real status.

    This is the defence against a channel that lies: on 2026-09-13 this wrapper printed its own
    "GATE EXIT: 1" and the task status still said 0. A reader who greps this line is immune to that
    — and the line cannot drift from the status, because both are computed from one manifest in
    one breath.
    """
    rc, out = _drive(tmp_path, observed=[A, B], baseline=[B])
    v = _read_verdict(out)
    assert v["name"] == "NEW_FAILURES", v
    assert v["exit"] == rc == 1, f"the verdict line and the real exit status disagree: {v}, rc={rc}"
    assert v["new"] == "1", v


def test_non_vacuity_the_verdict_line_says_NO_NEW_FAILURES_on_a_matching_set(tmp_path):
    """⛔ THE CONTROL. A line hard-wired to NEW_FAILURES would satisfy the rail above."""
    rc, out = _drive(tmp_path, observed=[B], baseline=[B])
    v = _read_verdict(out)
    assert v["name"] == "NO_NEW_FAILURES", v
    assert v["exit"] == rc == 0, f"{v}, rc={rc}"
    assert v["new"] == "0", v


def test_the_non_blocking_direction_is_visible_on_the_verdict_line_too(tmp_path):
    """A baseline entry that stopped failing never blocks — and a reader of the LINE ALONE must be
    able to see that the sets differ anyway, or `exit=0` looks like "nothing to see here"."""
    rc, out = _drive(tmp_path, observed=[B], baseline=[B, C])
    v = _read_verdict(out)
    assert v["exit"] == rc == 0
    assert v["no_longer_failing"] == "1", v


def test_a_refused_run_emits_an_INVALID_verdict_that_names_which_refusal(tmp_path, capsys):
    """⛔ EXIT 2 IS NOT A VERDICT, and the line has to say so rather than look like a third outcome.

    ⭐ It names WHICH refusal. `run_gate` gives every failure mode a capitalised label of its own
    precisely so a caller can tell them apart; flattening four distinct refusals into one word on
    the way out would undo that.
    """
    import gate_shards

    rc = gate_shards.main(["--shards", "1", "--out", str(tmp_path),
                           "--exclude", "**/x.test.js"])          # no --exclude-reason
    out = capsys.readouterr()
    v = _read_verdict(out.out)
    assert rc == 2
    assert v["name"] == "INVALID" and v["exit"] == 2, v
    assert v["cause"] == "MISSING_EXCLUDE_REASON", v
    # ⭐ CONTROL: INVALID must not collide with either verdict name, or a grep cannot discriminate.
    assert v["name"] not in {"NO_NEW_FAILURES", "NEW_FAILURES"}


def test_the_verdict_line_is_greppable_from_a_shell_with_no_json(tmp_path):
    """⚠ FORMAT CONTRACT. One line, no spaces inside a value, `k=v` throughout — so `grep` + `cut`
    is enough. Stated as a rail because the next person to add a field will want to add prose."""
    _, out = _drive(tmp_path, observed=[A, B], baseline=[B])
    line = next(ln for ln in out.splitlines() if ln.startswith("VERDICT="))
    assert "\t" not in line
    for token in line.split():
        assert token.count("=") >= 1, f"bare token {token!r} on the verdict line"
        assert " " not in token.split("=", 1)[1]


def test_every_exit_code_the_wrapper_can_return_has_a_verdict_name():
    """⛔ THE RAIL THAT WOULD HAVE CAUGHT THIS COLLISION, written because it happened.

    While this branch was being written, master added `EXIT_DID_NOT_RECONCILE = 3` — the verdict
    for a suite that did not run every file, which fails in the FLATTERING direction. The verdict
    line's name table knew 0, 1 and 2, so that run would have printed `VERDICT=UNKNOWN exit=3`:
    the one outcome an operator most needs named, rendered anonymous, on the line this branch
    tells them to read instead of the exit code.

    ⭐ THE SET IS DERIVED FROM THE MODULE, never retyped here. A hand-listed set of codes beside
    the codes it describes is the second-authority defect this repo has paid for in its gate
    baseline, its writer index and its COT router; the point of this rail is that the NEXT code
    is covered on the day it lands, by someone who has never read this file.
    """
    import gate_shards
    codes = {v for k, v in vars(gate_shards).items()
             if k.startswith("EXIT_") and isinstance(v, int)}
    assert codes, "no EXIT_* constants found — the derivation broke, so this rail proves nothing"
    missing = sorted(c for c in codes if c not in gate_shards.VERDICT_NAMES)
    assert not missing, (
        f"exit code(s) {missing} can be returned but have no VERDICT= name, so they print as "
        f"UNKNOWN on the one line a reader is told to trust")
    # ⭐ CONTROL: the rail must be able to fail. A name table covering every integer would.
    assert 99 not in gate_shards.VERDICT_NAMES


def test_the_verdict_line_names_a_run_that_did_not_reconcile(tmp_path):
    """The collision above, driven end to end rather than asserted about.

    ⛔ A partial suite is the failure this whole file exists for — fewer files run, fewer failures
    found, and it reads as a pass. So it is the single most important thing the line must name.
    """
    import gate_shards
    manifest = {
        "summed": {"files": {"total": 8, "failed": 0}, "tests": {"total": 80, "failed": 0}},
        "per_shard": [{"shard": 1, "files": {"total": 8}}],
        "test_files_on_disk": 10, "test_files_waived": 0,
        "file_count_reconciles": False,
        "vs_baseline": {"new": [], "no_longer_failing": []},
    }
    code = gate_shards.verdict_exit_code(manifest)
    assert code == gate_shards.EXIT_DID_NOT_RECONCILE
    line = gate_shards.verdict_line(code, reconciles="false")
    assert line.startswith("VERDICT=DID_NOT_RECONCILE exit=3"), line
    assert "UNKNOWN" not in line


def test_the_box_lock_path_is_overridable_and_defaults_to_a_machine_wide_location():
    """⛔ THE FIXTURE ABOVE IS ONLY SAFE BECAUSE THIS OVERRIDE EXISTS — so it is railed.

    ⭐ And the control is the DEFAULT: with no override the path must be machine-wide and outside
    every repository, or the sandbox would be hiding a tool that writes somewhere wrong. Both
    halves matter — an override that always won would mean the real lock is never used at all.
    """
    import gate_box_lock

    os.environ["UCT_GATE_BOX_LOCK"] = r"C:\tmp\override.lock"
    try:
        assert str(gate_box_lock.lock_path()).endswith("override.lock")
    finally:
        os.environ.pop("UCT_GATE_BOX_LOCK", None)

    default = gate_box_lock.lock_path()
    assert default.name == "gate-box.lock"
    # ⛔ outside every repo, and NOT under the live data root
    assert "uct-worktrees" not in str(default), default
    assert not str(default).lower().startswith("c:\\data"), default
    assert ".git" not in str(default), default


# ════════════════════════════════════════════════════════════════════════
# The sweep the autouse fixture stubs out. This is the ONE place it really runs.
# ════════════════════════════════════════════════════════════════════════


def test_the_do_not_build_sweep_is_still_wired_both_ways():
    """⛔ A sweep that could not run must NOT read as a sweep that found nothing.

    The autouse stub above makes the eleven `run_gate` tests affordable; without this, stubbing
    it would also delete the only coverage the sweep had. `_REAL_SWEEP` is bound at import,
    before the stub exists, so this drives the genuine function.
    """
    class _Proc:
        stdout = "  web clipper: app/src/x.js:12  `webClipper` "
        stderr = ""
        returncode = 1

    got = _REAL_SWEEP(run=lambda argv: _Proc())
    assert got["ran"] is True, "a sweep that ran must say so"
    assert got["clean"] is False, "a non-zero return means the sweep found something"
    assert got["hits"], "a hit line matching the documented shape must be reported"

    # ⭐ THE CONTROL. Without this the assertions above pass for a function that
    # answers the same way to everything.
    clean = _REAL_SWEEP(run=lambda argv: type("P", (), {"stdout": "", "stderr": "", "returncode": 0})())
    assert clean["ran"] is True and clean["clean"] is True and not clean["hits"]

    # ⛔ AND THE ABSENCE CASE, which is the one the docstring in gate_shards.py insists on.
    def _boom(argv):
        raise OSError("no interpreter")
    missing = _REAL_SWEEP(run=_boom)
    assert missing["ran"] is False, "a sweep that could not launch must report ran=False"
    assert "could not be launched" in missing["why"]


def test_the_autouse_stub_is_actually_in_force_for_run_gate():
    """⛔ NON-VACUITY. If the stub silently stopped applying, every test in this file would
    quietly go back to costing 115 s and this file would time out again — with no assertion
    naming why. This one fails BY NAME instead."""
    import gate_shards as _gs
    assert _gs.do_not_build_sweep()["stubbed_by"] == __name__, (
        "the autouse sweep stub is not in force; run_gate tests will shell out for ~115s each")
