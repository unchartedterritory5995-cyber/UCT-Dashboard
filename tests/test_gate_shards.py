"""The gate wrapper's own rail — because the last assertion of this shape was never verified.

⛔ THE DIRECT CAUSE OF THIS FILE. On 2026-09-09 a full-gate run asserted its totals line with
`grep '^ *Test Files'` and reported **"NO TOTALS LINE — THIS SHARD DID NOT RUN"** for all six
shards, against six 236KB logs full of real results. vitest prefixes that line with ANSI escapes,
so the anchor never matched. The assertion that exists precisely because exit codes lie was itself
unchecked, and it failed in the ALARMING direction — which is the lucky direction. The same bug
one character different (matching nothing and reporting nothing) would have passed a void run.

So: four proofs, one per way a gate result can be a lie, each naming the assertion that fires.
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
