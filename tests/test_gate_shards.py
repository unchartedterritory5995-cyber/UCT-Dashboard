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

import pathlib
import sys
import re

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))

from gate_shards import (  # noqa: E402
    GateError, blob_hash, parse_totals, run_gate, strip_ansi, sum_totals,
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
