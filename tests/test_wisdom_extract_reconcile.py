"""Wave 1.5 item 2 — the N-pass reconciler.

⚠️ **FIXTURES ARE SYNTHETIC, AND THE TEST NAMES SAY SO.** Checked 2026-09-15:
`data/wisdom/gate-runs/` is EMPTY — no run in session 4's R12 persistence format exists yet.
(`data/wisdom/extract/gate-run-1` and `gate-run-2` are the OLD format: aggregates plus
`keys-*.json`, no `records.jsonl`. Session 5's §10c said "two existing persisted runs" and that
was wrong — it conflated the two.) So these fixtures are hand-built in the persisted shape, with
controlled disagreement, rather than read from a real run.

⭐ Their SHAPE is not invented: it is `tools/wisdom/gate_records.record_rows`' own output — the
same `record_id`, `record_key`, `principle_key`, `market_signal_key`, `segment_id`,
`extractor_version` fields a real run writes.
"""
from __future__ import annotations

import json
import pathlib
import sqlite3

import pytest

from api.services.wisdom.extract import reconcile
from api.services.wisdom.publish import floor

VERSION = "wx-v0-deadbeef"


def _row(segment_id, rtype, *, ident, record_id, version=VERSION):
    row = {"phase": "gate", "segment_id": segment_id, "record_type": rtype,
           "record_id": record_id, "extractor_version": version,
           "record_key": [rtype, ident, None, None], "principle_key": None,
           "market_signal_key": None}
    if rtype == "PRINCIPLE":
        row["principle_key"] = f"p_{ident}"
        row["record_key"] = [rtype, ident]
    elif rtype == "MARKET_SIGNAL":
        row["market_signal_key"] = [rtype, ident]
        row["record_key"] = [rtype, ident]
    return row


def _write_run(root: pathlib.Path, run_id: str, rows, *, version=VERSION):
    d = root / run_id
    d.mkdir(parents=True, exist_ok=True)
    (d / reconcile.RECORDS_FILE).write_text(
        "".join(json.dumps(r, sort_keys=True) + "\n" for r in rows), encoding="utf-8", newline="\n")
    (d / reconcile.MANIFEST_FILE).write_text(
        json.dumps({"run_id": run_id, "extractor_version": version}) + "\n",
        encoding="utf-8", newline="\n")
    return d


def _synthetic_three_runs(root: pathlib.Path):
    """3 passes over one segment set with CONTROLLED disagreement.

      stable_call      in 3/3 -> 1.0
      stable_principle in 3/3 -> 1.0
      wobbly_signal    in 2/3 -> 0.667
      once_only        in 1/3 -> 0.333
    """
    base = [_row("seg-1", "CALL", ident="NVDA", record_id="r_call"),
            _row("seg-1", "PRINCIPLE", ident="size-down", record_id="r_prin"),
            _row("seg-2", "MARKET_SIGNAL", ident="choppy-tape", record_id="r_sig")]
    run_a = list(base)
    run_b = list(base)
    run_c = [base[0], base[1], _row("seg-2", "MENTION", ident="AMD", record_id="r_once")]
    _write_run(root, "20260915T000001Z", run_a)
    _write_run(root, "20260915T000002Z", run_b)
    _write_run(root, "20260915T000003Z", run_c)
    return ["20260915T000001Z", "20260915T000002Z", "20260915T000003Z"]


def _load(root, ids):
    return [reconcile.load_run(root, i) for i in ids]


# ── matching and arithmetic ──────────────────────────────────────────────────

def test_SYNTHETIC_three_runs_give_3of3_2of3_and_1of3(tmp_path):
    ids = _synthetic_three_runs(tmp_path)
    result = reconcile.reconcile(_load(tmp_path, ids))
    by_ident = {tuple(s["identity"]): s for s in result["scores"]}
    assert result["n"] == 3
    assert by_ident[("CALL", "NVDA", None, None)]["stability"] == 1.0
    assert by_ident[("PRINCIPLE", "p_size-down")]["stability"] == 1.0
    assert by_ident[("MARKET_SIGNAL", "choppy-tape")]["runs_present"] == 2
    assert round(by_ident[("MARKET_SIGNAL", "choppy-tape")]["stability"], 3) == 0.667
    assert round(by_ident[("MENTION", "AMD", None, None)]["stability"], 3) == 0.333


def test_a_key_seen_twice_in_ONE_run_still_counts_once(tmp_path):
    """⛔ stability is presence-across-RUNS. A run that emitted a duplicate must not score 2/1."""
    rows = [_row("seg-1", "CALL", ident="NVDA", record_id="a"),
            _row("seg-1", "CALL", ident="NVDA", record_id="b")]
    _write_run(tmp_path, "r1", rows)
    _write_run(tmp_path, "r2", rows)
    result = reconcile.reconcile(_load(tmp_path, ["r1", "r2"]))
    [score] = result["scores"]
    assert score["runs_present"] == 2 and score["n"] == 2 and score["stability"] == 1.0
    assert score["record_ids"] == ["a", "b"], "both ids are carried, so both rows get written"


def test_the_same_key_in_DIFFERENT_segments_is_two_identities(tmp_path):
    """stability asks whether re-extracting THE SAME paragraph agrees."""
    _write_run(tmp_path, "r1", [_row("seg-1", "CALL", ident="NVDA", record_id="a")])
    _write_run(tmp_path, "r2", [_row("seg-2", "CALL", ident="NVDA", record_id="b")])
    # different segment sets -> refused, which is itself the right answer here
    with pytest.raises(reconcile.ReconcileRefused, match="segment sets"):
        reconcile.reconcile(_load(tmp_path, ["r1", "r2"]))


def test_matching_never_uses_text_or_spans(tmp_path):
    """⛔ THE E5 LESSON. Same key, different quote and span in each run -> still 2/2."""
    a = _row("seg-1", "PRINCIPLE", ident="size-down", record_id="a")
    b = _row("seg-1", "PRINCIPLE", ident="size-down", record_id="b")
    a.update(quote="Size down when the tape is choppy.", q_start=0, q_end=34)
    b.update(quote="When the tape is choppy, size down.", q_start=91, q_end=126)
    _write_run(tmp_path, "r1", [a])
    _write_run(tmp_path, "r2", [b])
    [score] = reconcile.reconcile(_load(tmp_path, ["r1", "r2"]))["scores"]
    assert score["stability"] == 1.0, "a re-worded principle is the SAME principle"
    assert sorted(score["record_ids"]) == ["a", "b"]


# ── refusals ─────────────────────────────────────────────────────────────────

def test_a_version_mismatch_is_refused_and_names_both_versions(tmp_path):
    _write_run(tmp_path, "r1", [_row("seg-1", "CALL", ident="NVDA", record_id="a")])
    _write_run(tmp_path, "r2", [_row("seg-1", "CALL", ident="NVDA", record_id="b",
                                     version="wx-v0-OTHER")], version="wx-v0-OTHER")
    with pytest.raises(reconcile.ReconcileRefused) as exc:
        reconcile.reconcile(_load(tmp_path, ["r1", "r2"]))
    assert "extractor_version" in str(exc.value)
    assert VERSION in str(exc.value) and "wx-v0-OTHER" in str(exc.value)


def test_a_segment_set_mismatch_is_refused_and_says_how_many_differ(tmp_path):
    _write_run(tmp_path, "r1", [_row("seg-1", "CALL", ident="NVDA", record_id="a"),
                                _row("seg-2", "CALL", ident="AMD", record_id="b")])
    _write_run(tmp_path, "r2", [_row("seg-1", "CALL", ident="NVDA", record_id="c")])
    with pytest.raises(reconcile.ReconcileRefused) as exc:
        reconcile.reconcile(_load(tmp_path, ["r1", "r2"]))
    assert "segment sets" in str(exc.value) and "missing 1" in str(exc.value)


def test_one_run_is_refused():
    with pytest.raises(reconcile.ReconcileRefused, match="at least 2"):
        reconcile.reconcile([{"run_id": "r1", "rows": [], "extractor_version": VERSION,
                              "segments": set(), "manifest": {}}])


# ── writers ──────────────────────────────────────────────────────────────────

def _store() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE wisdom_records (record_id TEXT PRIMARY KEY, record_type TEXT, "
                 "record_hash TEXT, stability REAL, stability_runs INTEGER)")
    conn.execute("CREATE TABLE wisdom_principles (principle_key TEXT PRIMARY KEY, stability REAL, "
                 "stability_runs INTEGER)")
    return conn


def test_the_writers_hit_the_right_rows_and_only_those(tmp_path):
    ids = _synthetic_three_runs(tmp_path)
    result = reconcile.reconcile(_load(tmp_path, ids))
    conn = _store()
    conn.executemany("INSERT INTO wisdom_records (record_id, record_type, record_hash) VALUES (?,?,?)",
                     [("r_call", "CALL", "h1"), ("r_prin", "PRINCIPLE", "h2"),
                      ("r_sig", "MARKET_SIGNAL", "h3"), ("r_untouched", "CALL", "h4")])
    conn.execute("INSERT INTO wisdom_principles (principle_key) VALUES ('p_size-down')")
    conn.execute("INSERT INTO wisdom_principles (principle_key) VALUES ('p_other')")

    reconcile.write_scores(conn, result)

    got = {r["record_id"]: (r["stability"], r["stability_runs"])
           for r in conn.execute("SELECT * FROM wisdom_records")}
    assert got["r_call"] == (1.0, 3) and got["r_prin"] == (1.0, 3)
    assert round(got["r_sig"][0], 3) == 0.667 and got["r_sig"][1] == 3
    assert got["r_untouched"] == (None, None), "a record not in the runs must be left alone"

    pri = {r["principle_key"]: (r["stability"], r["stability_runs"])
           for r in conn.execute("SELECT * FROM wisdom_principles")}
    assert pri["p_size-down"] == (1.0, 3)
    assert pri["p_other"] == (None, None)


def test_hashed_fields_are_untouched_by_a_write(tmp_path):
    """⛔⛔ THE TRAP THE COLUMN CHOICE AVOIDS. If stability reached a hashed field, every
    record_hash and record_id would change and re-extraction would duplicate the corpus."""
    from api.services.wisdom.extract import writer

    ids = _synthetic_three_runs(tmp_path)
    result = reconcile.reconcile(_load(tmp_path, ids))
    conn = _store()
    fields = {"principle": {"statement": "Size down when the tape is choppy."}}
    before_hash = writer._canonical_hash(fields, "PRINCIPLE")
    before_id = writer.record_id_for("seg-1", VERSION, before_hash)
    conn.execute("INSERT INTO wisdom_records (record_id, record_type, record_hash) VALUES (?,?,?)",
                 ("r_prin", "PRINCIPLE", before_hash))

    reconcile.write_scores(conn, result)

    row = conn.execute("SELECT record_id, record_hash FROM wisdom_records").fetchone()
    assert row["record_hash"] == before_hash
    assert row["record_id"] == "r_prin"
    assert writer._canonical_hash(fields, "PRINCIPLE") == before_hash
    assert writer.record_id_for("seg-1", VERSION, before_hash) == before_id
    # control: the hash CAN move, so this is not vacuous
    assert writer._canonical_hash({"principle": {"statement": "Other."}}, "PRINCIPLE") != before_hash


def test_a_write_that_matched_nothing_reports_zero_not_success(tmp_path):
    ids = _synthetic_three_runs(tmp_path)
    result = reconcile.reconcile(_load(tmp_path, ids))
    out = reconcile.write_scores(_store(), result)
    assert out == {"records_updated": 0, "principles_updated": 0}


# ── end to end with the floor ────────────────────────────────────────────────

def test_after_reconcile_the_floor_admits_exactly_the_3of3_set(tmp_path):
    ids = _synthetic_three_runs(tmp_path)
    result = reconcile.reconcile(_load(tmp_path, ids))
    admitted, blocked = [], []
    for s in result["scores"]:
        (admitted if floor.passes(s["record_type"], s["stability"], s["n"]) else blocked).append(
            (s["record_type"], round(s["stability"], 3)))
    # the two floored types: PRINCIPLE 3/3 passes, MARKET_SIGNAL 2/3 blocks
    assert ("PRINCIPLE", 1.0) in admitted
    assert ("MARKET_SIGNAL", 0.667) in blocked
    # the mechanical types are never floored, whatever their stability
    assert ("MENTION", 0.333) in admitted and ("CALL", 1.0) in admitted


def test_the_histogram_counts_what_clears_the_floor(tmp_path):
    ids = _synthetic_three_runs(tmp_path)
    hist = reconcile.histogram(reconcile.reconcile(_load(tmp_path, ids)))
    assert hist["PRINCIPLE"]["by_stability"] == {"3/3": 1} and hist["PRINCIPLE"]["clears_floor"] == 1
    assert hist["MARKET_SIGNAL"]["by_stability"] == {"2/3": 1}
    assert hist["MARKET_SIGNAL"]["clears_floor"] == 0, "2/3 must not clear a 0.8 floor"


def test_the_report_artifact_lands_in_the_gitignored_tree(tmp_path):
    ids = _synthetic_three_runs(tmp_path)
    result = reconcile.reconcile(_load(tmp_path, ids))
    path = reconcile.write_report(tmp_path, result)
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["n"] == 3 and payload["run_ids"] == ids
    assert payload["extractor_version"] == VERSION
    assert payload["by_type"]["MARKET_SIGNAL"]["clears_floor"] == 0


# ── chain wiring ─────────────────────────────────────────────────────────────

def test_reconcile_runs_before_the_publication_floor():
    """⛔ Order is load-bearing: the floor READS what the reconciler writes. Reversed, the floor
    would judge yesterday's scores and block every record on a NULL just filled in."""
    from api.services.wisdom.publish import chain

    names = [s.name for s in chain.DAILY]
    assert "reconcile_stability" in names, names
    assert names.index("reconcile_stability") < names.index("publication_floor")
    step = next(s for s in chain.DAILY if s.name == "reconcile_stability")
    assert ("api.services.wisdom.extract.reconcile", "score_silently") in step.targets


def test_N_is_the_number_of_runs_reconciled_never_a_literal(tmp_path):
    """A four-pass reconciliation must store 4, so Q17 reads a real denominator."""
    rows = [_row("seg-1", "CALL", ident="NVDA", record_id="a")]
    for i in range(4):
        _write_run(tmp_path, f"r{i}", rows)
    result = reconcile.reconcile(_load(tmp_path, [f"r{i}" for i in range(4)]))
    assert result["n"] == 4 and result["scores"][0]["n"] == 4
    assert result["scores"][0]["stability"] == 1.0


def test_the_daily_entry_point_is_a_no_op_without_enough_runs(tmp_path):
    out = reconcile.score_silently(object(), root=tmp_path)
    assert out["runs"] == 0 and "need" in out["skipped"]
    _write_run(tmp_path, "r1", [_row("seg-1", "CALL", ident="NVDA", record_id="a")])
    out = reconcile.score_silently(object(), root=tmp_path)
    assert out["runs"] == 1 and "need" in out["skipped"]
