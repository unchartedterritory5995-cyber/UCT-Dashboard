"""A null chunk must record which METRIC it was drawn against.

⛔⛔ THE NEAR-MISS THIS COMES FROM, 2026-08-31. Two `stage-4-breakdown` null
chunks sat on disk — seeds 20260830 and 20260845, 15 trials each, contiguous and
disjoint. They passed every check the loader had: right key, no overlap, no gap,
counts matching. They were drawn on the LONG metric, and the row had since been
re-graded SHORT.

Recombining them would have adjudicated a short-metric lift against long-metric
nulls and published the result. Nothing would have said so. The only reason it
did not happen is that their null maximum (0.0203) happened to match the OLD
long-metric row's `null_max` exactly, and that coincidence was noticed by eye.

⭐ A NULL IS SPECIFIC TO THE QUESTION IT ANSWERS. On the long metric a null lift
asks "did price rise more often than baseline"; on the short metric, "did it
fall". Swapping them is not noise, it is a different experiment — and the error
direction is to PUBLISH, because the mismatched null is unrelated to the
observed effect and so tends to be smaller than the true one.
"""
import sys, pathlib, json
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from tools.run_lift_ledger import write_null_chunk, load_null_chunks


def _chunk(tmp_path, name, *, seed, trials, direction, key="stage-4-breakdown"):
    p = tmp_path / name
    write_null_chunk(str(p), key, seed, trials, [0.01] * trials,
                     direction=direction, sample=3461, window=400)
    return str(p)


# ─── what the writer must record ────────────────────────────────────────────

def test_a_written_chunk_states_its_metric(tmp_path):
    p = _chunk(tmp_path, "a.json", seed=100, trials=5, direction="short")
    d = json.loads(pathlib.Path(p).read_text(encoding="utf-8"))
    assert d["direction"] == "short"
    assert d["sample_tickers"] == 3461 and d["window"] == 400
    assert d["written_at"], "a chunk with no date cannot be aged"
    assert len(d["lifts"]) == d["trials"]


# ─── the rule ───────────────────────────────────────────────────────────────

def test_matching_chunks_recombine(tmp_path):
    """⛔ THE DISCRIMINATION CONTROL. A loader that refused everything would
    satisfy every negative case below and be useless."""
    a = _chunk(tmp_path, "a.json", seed=100, trials=5, direction="short")
    b = _chunk(tmp_path, "b.json", seed=105, trials=5, direction="short")
    out = load_null_chunks(f"{a},{b}", "stage-4-breakdown",
                           want_direction="short")
    assert len(out) == 10


def test_a_MISMATCHED_metric_is_refused(tmp_path):
    """The near-miss itself: valid seeds, valid counts, wrong question."""
    a = _chunk(tmp_path, "a.json", seed=100, trials=5, direction="long")
    b = _chunk(tmp_path, "b.json", seed=105, trials=5, direction="long")
    with pytest.raises(SystemExit, match="different questions"):
        load_null_chunks(f"{a},{b}", "stage-4-breakdown",
                         want_direction="short")


def test_a_chunk_that_does_not_SAY_its_metric_is_refused(tmp_path):
    """⭐ THE ONE THAT MATTERS MOST. The real chunks predate the field entirely.
    An unlabelled chunk cannot be shown to match, and 'cannot be shown to
    match' must not be treated as 'matches' — that is the whole failure mode."""
    p = tmp_path / "old.json"
    p.write_text(json.dumps({"key": "stage-4-breakdown", "seed": 100,
                             "trials": 5, "lifts": [0.01] * 5}),
                 encoding="utf-8")
    with pytest.raises(SystemExit, match="records no `direction`"):
        load_null_chunks(str(p), "stage-4-breakdown", want_direction="short")


def test_an_unlabelled_chunk_still_loads_when_no_metric_is_demanded(tmp_path):
    """Back-compat is deliberate and bounded: a caller that passes no expected
    direction gets the old behaviour, so this does not break a legacy path that
    never had a direction to begin with."""
    p = tmp_path / "old.json"
    p.write_text(json.dumps({"key": "stage-4-breakdown", "seed": 100,
                             "trials": 5, "lifts": [0.01] * 5}),
                 encoding="utf-8")
    assert len(load_null_chunks(str(p), "stage-4-breakdown")) == 5


# ─── the guards that already existed must still bite ────────────────────────

def test_overlapping_seeds_are_still_refused(tmp_path):
    a = _chunk(tmp_path, "a.json", seed=100, trials=5, direction="short")
    b = _chunk(tmp_path, "b.json", seed=103, trials=5, direction="short")
    with pytest.raises(SystemExit, match="OVERLAP"):
        load_null_chunks(f"{a},{b}", "stage-4-breakdown", want_direction="short")


def test_a_gap_in_the_seed_partition_is_still_refused(tmp_path):
    a = _chunk(tmp_path, "a.json", seed=100, trials=5, direction="short")
    b = _chunk(tmp_path, "b.json", seed=110, trials=5, direction="short")
    with pytest.raises(SystemExit, match="GAP"):
        load_null_chunks(f"{a},{b}", "stage-4-breakdown", want_direction="short")


def test_the_wrong_structure_is_still_refused(tmp_path):
    a = _chunk(tmp_path, "a.json", seed=100, trials=5, direction="short",
               key="darvas-box")
    with pytest.raises(SystemExit, match="is for"):
        load_null_chunks(a, "stage-4-breakdown", want_direction="short")


def test_the_writer_is_atomic(tmp_path):
    """The chunk write used a truncating `open(w)` like the ledger did. A
    half-written chunk that still parses would recombine silently."""
    import inspect
    from tools import run_lift_ledger as r
    src = inspect.getsource(r.write_null_chunk)
    assert "os.replace" in src
    assert 'open(path, "w"' not in src
