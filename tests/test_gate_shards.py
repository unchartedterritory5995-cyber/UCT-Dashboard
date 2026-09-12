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

from gate_shards import (  # noqa: E402
    GateError, blob_hash, count_waived_files, parse_totals, run_gate, strip_ansi, sum_totals,
)

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
