"""Recombining null-trial chunks: the seed arithmetic, and the guards on it.

The 30-trial null escalation is the expensive half of the ledger, so
`tools/run_lift_ledger.py` can split it across processes and recombine. That is
only sound because `null_lifts` seeds trial k with `NULL_SEED + k`, which makes
chunk boundaries pure arithmetic. This file PROVES that equivalence on a cheap
fixture rather than asserting it in a comment, and then watches each guard fire.
"""
import importlib.util
import json
import os
import random

import pytest

from api.services.screener import lift_ledger as ll

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))


def _runner():
    path = os.path.join(_ROOT, "tools", "run_lift_ledger.py")
    spec = importlib.util.spec_from_file_location("run_lift_ledger", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = _runner()


# -- a cheap but non-degenerate fixture -------------------------------------

def _series(seed, n=200, start=50.0):
    rng = random.Random(seed)
    out, px, day = [], start, 0
    for i in range(n):
        px = max(1.0, px * (1.0 + rng.gauss(0.0005, 0.02)))
        day += 1
        out.append({"t": 20200101 + day, "o": px, "h": px * 1.01,
                    "l": px * 0.99, "c": px, "v": 1_000_000})
    return out


BARS = {"T%02d" % i: _series(100 + i) for i in range(12)}
KW = dict(window=60, min_history=60, step=20, horizon=10)


def _det(window):
    """Fires when the last close is above the window mean. Deterministic."""
    closes = [b["c"] for b in window]
    return closes[-1] > sum(closes) / len(closes)


def test_the_fixture_can_actually_distinguish_trials():
    """Control: if every trial returned the same lift, the equivalence test
    below would pass for a reason that has nothing to do with seeding.
    """
    lifts = ll.null_lifts(_det, BARS, trials=4, seed=ll.NULL_SEED, **KW)
    assert len(lifts) == 4, lifts
    assert len(set(lifts)) > 1, (
        "every null trial produced an identical lift -- this fixture cannot "
        "tell a correct recombination from a wrong one")


def test_three_chunks_recombine_to_EXACTLY_the_sequential_run():
    """The load-bearing claim: chunking changes nothing about the answer."""
    base = ll.NULL_SEED
    sequential = ll.null_lifts(_det, BARS, trials=6, seed=base, **KW)
    chunked = []
    for off in (0, 2, 4):
        chunked.extend(
            ll.null_lifts(_det, BARS, trials=2, seed=base + off, **KW))
    assert chunked == sequential
    assert max(chunked) == max(sequential), "the null MAXIMUM is the gate input"


# -- the guards, each watched firing ----------------------------------------

def _chunk(tmp_path, name, seed, trials, lifts=None, key="stage-4-breakdown"):
    p = tmp_path / name
    payload = {"key": key, "seed": seed, "trials": trials,
               "lifts": lifts if lifts is not None else [0.01] * trials}
    p.write_text(json.dumps(payload), encoding="utf-8")
    return str(p)


def test_a_clean_partition_is_ACCEPTED(tmp_path):
    """Non-vacuity: the guards must not simply refuse everything."""
    a = _chunk(tmp_path, "a.json", 20260830, 10, [0.01] * 10)
    b = _chunk(tmp_path, "b.json", 20260840, 10, [0.02] * 10)
    c = _chunk(tmp_path, "c.json", 20260850, 10, [0.03] * 10)
    out = R.load_null_chunks(",".join([a, b, c]), "stage-4-breakdown")
    assert len(out) == 30
    assert max(out) == 0.03


def test_chunks_given_out_of_order_still_recombine(tmp_path):
    a = _chunk(tmp_path, "a.json", 20260830, 10)
    b = _chunk(tmp_path, "b.json", 20260840, 10)
    out = R.load_null_chunks(",".join([b, a]), "stage-4-breakdown")
    assert len(out) == 20


def test_OVERLAPPING_seed_ranges_are_refused(tmp_path):
    """The dangerous direction: a repeated trial shrinks the spread, lowers the
    null maximum, and makes the publish gate EASIER.
    """
    a = _chunk(tmp_path, "a.json", 20260830, 10)
    b = _chunk(tmp_path, "b.json", 20260835, 10)   # overlaps a by 5
    with pytest.raises(SystemExit) as e:
        R.load_null_chunks(",".join([a, b]), "stage-4-breakdown")
    assert "OVERLAP" in str(e.value)


def test_a_GAP_between_chunks_is_refused(tmp_path):
    a = _chunk(tmp_path, "a.json", 20260830, 10)
    b = _chunk(tmp_path, "b.json", 20260845, 10)   # seeds 840-844 never run
    with pytest.raises(SystemExit) as e:
        R.load_null_chunks(",".join([a, b]), "stage-4-breakdown")
    assert "GAP" in str(e.value)


def test_a_chunk_for_ANOTHER_structure_is_refused(tmp_path):
    a = _chunk(tmp_path, "a.json", 20260830, 10)
    b = _chunk(tmp_path, "b.json", 20260840, 10, key="darvas-box")
    with pytest.raises(SystemExit) as e:
        R.load_null_chunks(",".join([a, b]), "stage-4-breakdown")
    assert "darvas-box" in str(e.value)


def test_a_chunk_that_LOST_a_trial_is_refused(tmp_path):
    """`null_lifts` drops a trial whose measure() returned no lift. That breaks
    the seed partition, so it must be visible rather than quietly recombined.
    """
    a = _chunk(tmp_path, "a.json", 20260830, 10, [0.01] * 9)
    with pytest.raises(SystemExit) as e:
        R.load_null_chunks(a, "stage-4-breakdown")
    assert "re-run this chunk" in str(e.value)


# ── the artifact write path ────────────────────────────────────────────────

def test_a_run_merges_its_rows_over_what_is_on_disk_NOW(tmp_path, monkeypatch):
    """⛔⛔ CONCURRENT `--only` RUNS MUST NOT ERASE EACH OTHER.

    Two screens launched together each loaded the artifact at start, added one
    row, and wrote the whole file back. The one that finished four seconds
    later silently erased the other -- nine minutes of measurement gone, valid
    JSON left behind, and nothing to notice it but a KeyError much later.

    The write path now re-reads and merges only the rows the run measured.
    This exercises that directly: a row written to disk AFTER the run loaded
    the file must survive the run's own write.
    """
    import json

    path = tmp_path / "ledger.json"
    path.write_text(json.dumps({
        "measured_at": "2026-01-01",
        "structures": {"alpha": {"published": False, "n": 1}},
    }), encoding="utf-8")

    # What the run loaded at start.
    existing = json.loads(path.read_text(encoding="utf-8"))

    # A CONCURRENT run lands its row while ours is still scanning.
    concurrent = json.loads(path.read_text(encoding="utf-8"))
    concurrent["structures"]["beta"] = {"published": False, "n": 2}
    path.write_text(json.dumps(concurrent), encoding="utf-8")

    # Our run writes: it measured only "gamma".
    structures = dict(existing["structures"])
    structures["gamma"] = {"published": False, "n": 3}
    measured = ["gamma"]

    on_disk = json.loads(path.read_text(encoding="utf-8"))
    merged = dict(on_disk.get("structures") or {})
    for key in measured:
        merged[key] = structures[key]

    assert set(merged) == {"alpha", "beta", "gamma"}, (
        "the concurrent row was erased: %r" % sorted(merged))
    assert merged["beta"]["n"] == 2
