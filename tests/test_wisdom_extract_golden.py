"""Golden gate rails (stream S-D). Synthetic labels only: this repository is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a label read into the wrong expected key (a heard-only ticker, a list, a principle);
2. a match that ignores stance or direction, a principle matched on nothing, an
   unlabelled prediction silently counted as a false positive;
3. a first evaluation not accepted as baseline, a per-type regression not blocking, a
   smaller model accepted on anything but a tie or better, a golden-version change
   compared against the old labels;
4. a rate recorded with a zero denominator, or a receipt's own precision trusted.
"""
from __future__ import annotations

import json

import pytest

from api.services.wisdom.core import ids, store
from api.services.wisdom.extract import golden, prompt, writer

TEXT = ("Bought ZZZT at 10.50 today and the stop is 9.80. Passed on YYYT, too thin. "
        "Your stop is your north star. Unrelated MMMT chatter here.")
SEGMENT = {"segment_id": "seg-g", "kind": "section", "text": TEXT, "author_id": "tsdr", "speaker_confidence": "high"}
SOURCE = {"stream": "sunday_scans", "guest_names_json": "[]"}


def make(**kw):
    rec = {name: None for name in prompt.record_fields()}
    rec.update({"tickers": [], "targets": [], "levels": [], "confidence_language": [], "hindsight": False,
                "extraction_confidence": "high"})
    rec.update(kw)
    return rec


def v1(gid, rtype, quote, split="dev", evidence=None, **expected):
    return {"gid": gid, "record_type": rtype, "stream": "sunday_scans", "quote": quote, "split": split,
            "locator": {"sample": "sample.txt", "external_ref": "test:1"}, "evidence": evidence or {},
            "expected": make(record_type=rtype, quote=quote, **expected)}


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.delenv("WISDOM_EXTRACT_MODEL", raising=False)
    monkeypatch.delenv("WISDOM_EXTRACT_EFFORT", raising=False)
    store.init_db()
    return tmp_path / "wisdom.db"


# ── 1. labels ────────────────────────────────────────────────────────────────

def test_v1_labels_become_expected_keys():
    heard = v1("G-1", "CALL", "x", evidence={"entity": {"ticker": "zzzt"}}, ticker_as_heard="zee", stance="taking",
               direction="long")
    (e,) = golden.expected_from_record(heard)
    assert (e.record_type, e.ticker, e.stance, e.direction) == ("CALL", "ZZZT", "taking", "long")
    listed = golden.expected_from_record(v1("G-2", "MENTION", "AAAT BBBT AAAT", tickers=["AAAT", "BBBT", "$aaat"]))
    assert [x.ticker for x in listed] == ["AAAT", "BBBT"]
    (p,) = golden.expected_from_record(v1("G-3", "PRINCIPLE", "q", principle={"statement": "stops first"}))
    assert p.statement == "stops first" and p.ticker is None
    (m,) = golden.expected_from_record(v1("G-4", "MARKET_SIGNAL", "q", market_signal={"name": "breadth washout"}))
    assert m.statement == "breadth washout"


def test_v0_draft_labels_still_read():
    rec = {"gid": "G-9", "record_type": "MENTION", "quote": "AAAT BBBT AAAT", "sample_file": "s.txt",
           "labels": {"list_kind": "honorable_mention"}}
    assert [x.ticker for x in golden.expected_from_record(rec)] == ["AAAT", "BBBT"]
    sib = {"gid": "G-8", "record_type": "NEGATIVE_CALL", "quote": "q", "labels": {
        "ticker": "YYYT", "stance": "passed", "sibling_expected": {"ticker": "XXXT", "stance": "passed"}}}
    assert [x.ticker for x in golden.expected_from_record(sib)] == ["YYYT", "XXXT"]


def test_splits_prefer_the_record_and_otherwise_split_by_gid_parity():
    assert golden.split_for({"gid": "G-1", "split": "test"}) == "test"
    splits = {golden.split_for({"gid": f"G-{i:03d}"}) for i in range(40)}
    assert splits == {"dev", "test"}
    g = "G-777"
    assert golden.split_for({"gid": g}) == ("dev" if int(ids.sha24(g)[-1], 16) % 2 == 0 else "test")


def test_placement_keys_discord_by_message_and_picks_the_tightest_segment():
    rec = {"gid": "G-5", "quote": "Passed on YYYT", "locator": {"sample": "discord/x.jsonl",
                                                                  "external_ref": "discord:1:42"}}
    assert golden.sample_key(rec) == "discord/x.jsonl#42"
    segs = {"discord/x.jsonl#42": [{"segment_id": "big", "ordinal": 0, "text": "a " + TEXT},
                                   {"segment_id": "small", "ordinal": 1, "text": "Passed on YYYT, too thin."}],
            "other": [{"segment_id": "wrong", "ordinal": 0, "text": "Passed on YYYT"}]}
    placed, unplaced = golden.place([rec, dict(rec, gid="G-6", quote="not there")], segs)
    assert list(placed) == ["small"] and unplaced == ["G-6"]


# ── 2. matching ──────────────────────────────────────────────────────────────

def predicted(records):
    return writer.validate_output({"records": records}, segment=SEGMENT, source=SOURCE, resolver=None,
                                  vocab_names=set()).kept


def test_matching_needs_type_ticker_stance_and_direction_and_scopes_precision():
    expected = (golden.expected_from_record(v1("G-1", "CALL", "Bought ZZZT at 10.50 today and the stop is 9.80.",
                                               ticker_as_written="ZZZT", stance="taking", direction="long"))
                + golden.expected_from_record(v1("G-2", "NEGATIVE_CALL", "Passed on YYYT, too thin.",
                                                 ticker_as_written="YYYT", stance="passed"))
                + golden.expected_from_record(v1("G-3", "PRINCIPLE", "Your stop is your north star.",
                                                 principle={"statement": "Your stop is your north star"})))
    preds = predicted([
        make(record_type="CALL", quote="Bought ZZZT at 10.50 today", ticker_as_written="ZZZT", direction="long",
             stance="taking", stop=9.8),
        make(record_type="NEGATIVE_CALL", quote="Passed on YYYT", ticker_as_written="YYYT", stance="avoid"),
        make(record_type="PRINCIPLE", quote="Your stop is your north star.",
             principle={"statement": "The stop is the north star", "category": "risk", "empirical_claim": False,
                        "testable_claim": None}),
        make(record_type="MENTION", quote="Unrelated MMMT chatter here.", ticker_as_written="MMMT"),
    ])
    assert preds[0].record_type == "MENTION" and preds[0].pre_entity_type == "CALL"  # scored before the entity step
    result = golden.match_segment(expected, preds, TEXT)
    assert result["tp"] == {"CALL": 1, "PRINCIPLE": 1}
    assert result["fn"] == {"NEGATIVE_CALL": 1} and result["fp"] == {"NEGATIVE_CALL": 1}
    assert result["unscored_predictions"] == 1 and result["lenient_tp"]["NEGATIVE_CALL"] == 1
    metrics = golden.score([result])["per_type"]
    assert metrics["NEGATIVE_CALL"]["precision"] == 0.0 and metrics["NEGATIVE_CALL"]["type_ticker_recall"] == 1.0
    assert metrics["CALL"]["precision"] == 1.0 and "MENTION" not in metrics


def test_a_dissimilar_principle_does_not_match():
    expected = golden.expected_from_record(v1("G-3", "PRINCIPLE", "Your stop is your north star.",
                                              principle={"statement": "Your stop is your north star"}))
    preds = predicted([make(record_type="PRINCIPLE", quote="Unrelated MMMT chatter here.",
                            principle={"statement": "chatter about unrelated things", "category": "risk",
                                       "empirical_claim": False, "testable_claim": None})])
    result = golden.match_segment(expected, preds, TEXT)
    assert result["tp"] == {} and result["fn"] == {"PRINCIPLE": 1} and result["unscored_predictions"] == 1


# ── 3-4. recording and the gate ──────────────────────────────────────────────

def per_type(tp, fp, fn):
    return {"MENTION": {"tp": tp, "fp": fp, "fn": fn, "precision": golden._rate(tp, tp + fp),
                        "recall": golden._rate(tp, tp + fn), "n_expected": tp + fn, "n_predicted_scored": tp + fp}}


#: §8a.1 — a gate run records the sha of the BYTES it scored, not just the file's name.
GSHA = "a" * 64
GSHA2 = "b" * 64


def record(conn, version, model, pt, when, golden_version="gv1", golden_sha256=GSHA):
    return golden.record_eval(conn, kind=golden.EVAL_KIND, extractor_version=version, n=9, now_iso=when,
                              metrics={"model": model, "effort": "high", "golden_version": golden_version,
                                       "split": "dev", "per_type": pt, "golden_sha256": golden_sha256})


def test_baseline_then_regression_blocks_and_a_tie_is_accepted(db):
    with store.write() as conn:
        base = record(conn, "wx-v0-aaaaaaaa", "claude-opus-5", per_type(8, 2, 2), "2026-09-13T10:00:00-04:00")
        worse = record(conn, "wx-v0-bbbbbbbb", "claude-opus-5", per_type(4, 1, 6), "2026-09-13T10:01:00-04:00")
        tie = record(conn, "wx-v0-cccccccc", "claude-opus-5", per_type(8, 2, 2), "2026-09-13T10:02:00-04:00")
        sonnet = record(conn, "wx-v0-cccccccc", "claude-sonnet-5", per_type(8, 3, 2), "2026-09-13T10:03:00-04:00")
        new_labels = record(conn, "wx-v0-dddddddd", "claude-opus-5", per_type(1, 9, 9), "2026-09-13T10:04:00-04:00",
                            golden_version="gv2")
    assert base["gate"] == {"decision": "accepted", "baseline": True, "compared_to": None, "regressions": []}
    assert worse["gate"]["decision"] == "blocked"
    assert {(r["metric"], r["previous_n"], r["current_n"]) for r in worse["gate"]["regressions"]} == {("recall", 10, 10)}
    assert tie["gate"]["decision"] == "accepted" and tie["gate"]["compared_to"] == base["run_id"]
    assert sonnet["gate"]["decision"] == "blocked" and sonnet["gate"]["compared_model"] == "claude-opus-5"
    assert new_labels["gate"]["baseline"] is True
    with store.read() as conn:
        assert golden.gate_status(conn, extractor_version="wx-v0-bbbbbbbb", model="claude-opus-5")["accepted"] is False
        assert golden.gate_status(conn, extractor_version="wx-v0-cccccccc", model="claude-opus-5")["accepted"] is True
        # an effort the gate never measured is not accepted for the same version and model
        unmeasured = golden.gate_status(conn, extractor_version="wx-v0-cccccccc", model="claude-opus-5", effort="low")
        assert unmeasured["accepted"] is False and "effort" in unmeasured["reason"]
        assert golden.gate_status(conn, extractor_version="wx-v0-cccccccc", model="claude-sonnet-5")["accepted"] is False
        missing = golden.gate_status(conn, extractor_version="wx-v0-eeeeeeee", model="claude-opus-5")
    assert missing["accepted"] is False and "no golden-gate evaluation" in missing["reason"]


# ── R98, session 25: a run that scored nothing must refuse, never accept ─────

def test_a_zero_sample_run_REFUSES_and_writes_no_row(db):
    """⛔⛔ THE HOLE `docs/wisdom/HARD-RULES.md`'s "never run the golden gate inside the
    container" rule exists to name. Inside a container where the golden set was never
    deployed, a zero-sample run finds no prior history to compare against, and
    decide_gate's baseline branch — correct when a REAL sample has no history — returned
    `accepted, baseline: True` for a verdict that measured NOTHING."""
    with store.write() as conn:
        with pytest.raises(ValueError, match="scored nothing"):
            golden.record_eval(conn, kind=golden.EVAL_KIND, extractor_version="wx-v0-aaaaaaaa", n=0,
                               metrics={"model": "claude-opus-5", "effort": "high", "golden_version": "gv1",
                                        "split": "dev", "per_type": {}, "golden_sha256": GSHA})
    with store.read() as conn:
        rows = conn.execute("SELECT COUNT(*) FROM wisdom_eval_runs").fetchone()[0]
    assert rows == 0, "the refused run must write NOTHING, not a row that happens to be blocked"


def test_a_REAL_sample_after_a_refused_zero_sample_is_unaffected(db):
    """⭐ The fix must not touch the real path — a genuine 108-record run right after a
    refused zero-sample attempt still records baseline-accepted, normally."""
    with store.write() as conn:
        with pytest.raises(ValueError):
            golden.record_eval(conn, kind=golden.EVAL_KIND, extractor_version="wx-v0-aaaaaaaa", n=0,
                               metrics={"model": "claude-opus-5", "effort": "high", "golden_version": "gv1",
                                        "split": "dev", "per_type": {}, "golden_sha256": GSHA})
        out = record(conn, "wx-v0-aaaaaaaa", "claude-opus-5", per_type(8, 2, 2), "2026-09-13T10:00:00-04:00")
    assert out["gate"] == {"decision": "accepted", "baseline": True, "compared_to": None, "regressions": []}


def test_a_type_present_with_all_zero_counts_but_a_null_measurement_is_NOT_treated_as_empty(db):
    """⭐ CONTROL, the other direction: a NULL-only measurement (a type asserted absent across
    N segments, zero false positives) is real signal — golden.score() keeps it via
    null_declared even though tp=fp=fn=0 — and must NOT be refused as if nothing were
    scored. Without this, the fix above would over-refuse the single most useful NULL
    measurement the gate produces."""
    with store.write() as conn:
        out = golden.record_eval(conn, kind=golden.EVAL_KIND, extractor_version="wx-v0-aaaaaaaa", n=44,
                                 metrics={"model": "claude-opus-5", "effort": "high", "golden_version": "gv1",
                                          "split": "dev", "golden_sha256": GSHA,
                                          "per_type": {"CALL": {"tp": 0, "fp": 0, "fn": 0, "null_segments": 44,
                                                                "null_segments_with_fp": 0, "null_fp_rate": 0.0,
                                                                "precision": None, "recall": None}}})
    assert out["gate"]["decision"] == "accepted"


def test_metrics_rows_carry_counts_and_null_rates(db):
    with store.write() as conn:
        out = record(conn, "wx-v0-aaaaaaaa", "claude-opus-5", per_type(0, 0, 3), "2026-09-13T10:00:00-04:00")
    with store.read() as conn:
        rows = {r["metric"]: dict(r) for r in conn.execute("SELECT * FROM wisdom_metrics WHERE metric_run_id = ?",
                                                           (out["run_id"],))}
    assert rows["extractor_precision"]["denominator"] == 0 and rows["extractor_precision"]["value"] is None
    assert rows["extractor_recall"]["numerator"] == 0 and rows["extractor_recall"]["denominator"] == 3
    assert rows["extractor_recall"]["value"] == 0.0
    assert json.loads(rows["extractor_recall"]["slice_json"])["record_type"] == "MENTION"


def test_a_receipt_is_re_derived_and_idempotent(db):
    receipt = {"kind": golden.EVAL_KIND, "run_id": "pc-run-1", "extractor_version": "wx-v0-aaaaaaaa",
               "model": "claude-opus-5", "effort": "high", "golden_version": "gv1", "split": "dev",
               "golden_sha256": GSHA,
               "per_type": {"CALL": {"tp": 3, "fp": 1, "fn": 0, "precision": 0.99, "recall": 0.99}}}
    with store.write() as conn:
        first = golden.import_receipt(conn, receipt)
        again = golden.import_receipt(conn, receipt)
        status = golden.gate_status(conn, extractor_version="wx-v0-aaaaaaaa", model="claude-opus-5")
    assert first["duplicate"] is False and again["duplicate"] is True and again["run_id"] == first["run_id"]
    assert status["accepted"] and status["per_type"]["CALL"]["precision"] == 0.75
    with store.write() as conn:
        for bad in ({**receipt, "kind": "other"}, {**receipt, "extractor_version": "nope"},
                    {**receipt, "run_id": "x2", "per_type": {"CALL": {"tp": -1, "fp": 0, "fn": 0}}},
                    {**receipt, "run_id": "x3", "per_type": {"NOT_A_TYPE": {"tp": 1, "fp": 0, "fn": 0}}},
                    {**receipt, "run_id": "x4", "effort": "turbo"},
                    # §8a.1: a receipt that cannot say WHICH BYTES it scored is not a gate run
                    {**receipt, "run_id": "x5", "golden_sha256": "not-a-sha"},
                    {k: v for k, v in receipt.items() if k != "golden_sha256"} | {"run_id": "x6"}):
            with pytest.raises(ValueError):
                golden.import_receipt(conn, bad)


def test_drift_and_calibration_summaries():
    a = {"s1": [("CALL", "ZZZT", "taking", "long")], "s2": [("MENTION", "AAAT", None, None)], "s3": []}
    b = {"s1": [("CALL", "ZZZT", "taking", "long")], "s2": [("MENTION", "BBBT", None, None)], "s3": []}
    d = golden.drift(a, b)
    assert d["segments"] == 3 and d["identical_segments"] == 2
    assert d["by_type"]["MENTION"]["run_1"] == 1 and d["by_type"]["MENTION"]["agreed"] == 0
    assert d["mean_jaccard"] == pytest.approx((1 + 0 + 1) / 3)
    usages = [{"input_tokens": 100, "cache_read_input_tokens": 900, "output_tokens": o} for o in (100, 200, 300, 400)]
    c = golden.calibration(usages, [300, 300, 300, 300], model="claude-opus-5", effort="high", system_tokens=700)
    assert c["output_tokens_p50"] in (200, 300) and c["output_tokens_p90"] == 400 and c["n"] == 4
    assert c["cache_read_share"] == 0.9 and c["chars_per_body_token"] == pytest.approx(1200 / 1200)


# ── §8a.1: the gate is keyed on the BYTES, not the file name (reviewer fix, 2026-09-14) ──

def test_the_same_golden_name_with_different_bytes_is_a_new_baseline_never_a_comparison(db):
    """⛔ `golden_version` comes from the FILE NAME, so "golden-v1" is true of any bytes
    anyone puts at that path. Comparing a new run against a baseline measured on a
    DIFFERENT record set and calling it "no regression" is an identity join wearing a
    correctness check. The honest answer to changed bytes is a fresh BASELINE."""
    with store.write() as conn:
        base = record(conn, "wx-v0-aaaaaaaa", "claude-opus-5", per_type(8, 2, 2), "2026-09-13T10:00:00-04:00")
        # same name, same split, same model — WORSE numbers, and DIFFERENT bytes
        edited = record(conn, "wx-v0-bbbbbbbb", "claude-opus-5", per_type(1, 9, 9), "2026-09-13T10:01:00-04:00",
                        golden_sha256=GSHA2)
        # and the control: the SAME bytes still compare, so this is not "never compares"
        same = record(conn, "wx-v0-cccccccc", "claude-opus-5", per_type(1, 9, 9), "2026-09-13T10:02:00-04:00")
    assert base["gate"]["baseline"] is True
    assert edited["gate"] == {"decision": "accepted", "baseline": True, "compared_to": None, "regressions": []}
    assert same["gate"]["decision"] == "blocked" and same["gate"]["compared_to"] == base["run_id"]


def test_a_gate_run_cannot_be_recorded_without_the_sha_it_scored(db):
    with store.write() as conn:
        for bad in ({"model": "m", "effort": "high", "golden_version": "gv1", "split": "dev",
                     "per_type": per_type(1, 0, 0)},
                    {"model": "m", "effort": "high", "golden_version": "gv1", "split": "dev",
                     "per_type": per_type(1, 0, 0), "golden_sha256": ""},
                    {"model": "m", "effort": "high", "golden_version": "gv1", "split": "dev",
                     "per_type": per_type(1, 0, 0), "golden_sha256": "deadbeef"}):
            with pytest.raises(ValueError):
                golden.record_eval(conn, kind=golden.EVAL_KIND, extractor_version="wx-v0-aaaaaaaa", n=1, metrics=bad)
        # CONTROL: the same call with a real sha is recordable, so the three above fail for their reason
        ok = golden.record_eval(conn, kind=golden.EVAL_KIND, extractor_version="wx-v0-aaaaaaaa", n=1,
                                metrics={"model": "m", "effort": "high", "golden_version": "gv1", "split": "dev",
                                         "per_type": per_type(1, 0, 0), "golden_sha256": GSHA})
    assert ok["gate"]["decision"] == "accepted"


def test_gate_status_reports_the_sha_it_scored(db):
    with store.write() as conn:
        record(conn, "wx-v0-aaaaaaaa", "claude-opus-5", per_type(8, 2, 2), "2026-09-13T10:00:00-04:00")
        status = golden.gate_status(conn, extractor_version="wx-v0-aaaaaaaa", model="claude-opus-5", effort="high")
    assert status["accepted"] and status["golden_sha256"] == GSHA


def test_the_split_fallback_is_the_contract_formula_not_a_second_one(tmp_path):
    """CONTRACTS §6.4: split = dev when int(sha256(gid)[:8], 16) is even. The stored field
    wins; the fallback must not be a DIFFERENT function of the same input."""
    import hashlib
    assert golden.split_for({"gid": "g001", "split": "test"}) == "test"      # stored wins
    disagree = 0
    for i in range(500):
        gid = f"g{i:04d}"
        want = "dev" if int(hashlib.sha256(gid.encode()).hexdigest()[:8], 16) % 2 == 0 else "test"
        if golden.split_for({"gid": gid}) != want:
            disagree += 1
    assert disagree == 0, f"{disagree}/500 gids disagree with the contract formula"


def test_golden_sha256_reads_the_bytes(tmp_path):
    import hashlib
    f = tmp_path / "golden-v1.jsonl"
    one = b'{"gid":"g1"}\n'
    f.write_bytes(one)
    assert golden.golden_sha256(f) == hashlib.sha256(one).hexdigest()
    f.write_bytes(one + b'{"gid":"g2"}\n')
    assert golden.golden_sha256(f) != hashlib.sha256(one).hexdigest()


# ── Wave 1.5 item 1: per-type stability is a SHIPPING GATE (owner ruling 2026-09-14) ──

def test_stability_is_reported_PER_TYPE_because_one_average_hides_the_half_that_matters():
    """⛔ THE MEASUREMENT THIS EXISTS FOR. On 2026-09-14 the whole-run `mean_jaccard` was 0.505,
    which reads as "half-reproducible across the board". Per type it was nothing of the kind:
    CALL 17/23/21 and MENTION 93/117/116 are middling, while PRINCIPLE agreed on 6 of ~30 and
    MARKET_SIGNAL on 4 of ~17. PRINCIPLE is precisely what D18 publishes into the Brain KB under
    a named author, so an average would have let the unreproducible half ship behind the
    reproducible half.
    """
    stable = [("CALL", "ZZZT", "taking", "long")] * 4
    a = {"s1": stable + [("PRINCIPLE", None, "p1", None), ("PRINCIPLE", None, "p2", None)]}
    b = {"s1": stable + [("PRINCIPLE", None, "p3", None), ("PRINCIPLE", None, "p4", None)]}
    d = golden.drift(a, b)

    assert d["by_type"]["CALL"]["jaccard"] == pytest.approx(1.0)
    assert d["by_type"]["PRINCIPLE"]["jaccard"] == pytest.approx(0.0)
    # ...and the floor names the unreproducible type rather than averaging it away
    assert d["by_type"]["PRINCIPLE"]["below_floor"] is True
    assert d["by_type"]["CALL"]["below_floor"] is False
    assert d["below_floor"] == ["PRINCIPLE"]
    assert d["stability_floor"] == golden.STABILITY_FLOOR
    # the average alone would have read as comfortably mid-table
    assert 0.4 < d["mean_jaccard"] < 0.8


def test_a_type_nobody_emitted_is_ABSENT_from_the_table_never_scored_1_point_0():
    """⛔ A type neither run produced must not appear with a score. If it did it would post the
    best number in the table, and the one type nobody looked at would read as the most
    trustworthy — `lesson_a_saturated_instrument_reports_zero`, in the flattering direction.

    ⚠️ Precisely what this proves: a type only enters `by_type` when a run emitted it, so the
    absent case is handled by NOT BEING THERE. The `jaccard is None` branch beside it is
    defensive against a future change to how keys are counted, and this rail does not claim to
    exercise it — saying otherwise would be a rail asserting the adjacent thing.
    """
    d = golden.drift({"s1": [("CALL", "ZZZT", "t", "long")]}, {"s1": [("CALL", "ZZZT", "t", "long")]})
    assert "PRINCIPLE" not in d["by_type"] and d["by_type"]["CALL"]["jaccard"] == pytest.approx(1.0)
    empty = golden.drift({"s1": []}, {"s1": []})
    assert empty["by_type"] == {} and empty["below_floor"] == []


def test_a_version_that_gets_LESS_stable_than_the_baseline_does_not_ship(db):
    """The owner's sentence, executable: "a version that drops stability below the current
    baseline does not ship"."""
    with store.write() as conn:
        golden.record_eval(conn, kind=golden.DRIFT_KIND, extractor_version="wx-v0-aaaaaaaa", n=10,
                           now_iso="2026-09-14T05:00:00-04:00",
                           metrics={"model": "claude-opus-5", "effort": "high",
                                    "by_type": {"CALL": {"jaccard": 0.9, "below_floor": False},
                                                "PRINCIPLE": {"jaccard": 0.5, "below_floor": True}},
                                    "stability": {"decision": "accepted"}})
    with store.read() as conn:
        worse = golden.decide_stability(conn, extractor_version="wx-v0-bbbbbbbb", model="claude-opus-5",
                                        effort="high",
                                        by_type={"CALL": {"jaccard": 0.7, "below_floor": True},
                                                 "PRINCIPLE": {"jaccard": 0.5, "below_floor": True}})
        better = golden.decide_stability(conn, extractor_version="wx-v0-cccccccc", model="claude-opus-5",
                                         effort="high",
                                         by_type={"CALL": {"jaccard": 0.95, "below_floor": False},
                                                  "PRINCIPLE": {"jaccard": 0.85, "below_floor": False}})
    assert worse["decision"] == "blocked"
    assert [r["record_type"] for r in worse["regressions"]] == ["CALL"]
    assert worse["regressions"][0]["previous"] == 0.9 and worse["regressions"][0]["current"] == 0.7
    # CONTROL: an improvement is not a regression, or the gate would block every change.
    assert better["decision"] == "accepted" and better["regressions"] == []
    assert better["below_floor"] == []


def test_a_type_the_baseline_measured_and_this_run_did_NOT_is_a_regression_not_a_silence(db):
    """⛔ ABSENT IS NOT PASSING. Dropping a type from the comparison because this run has no
    number for it is how a regression hides — the projection quietly stops naming the thing
    that got worse (`lesson_a_projection_drops_what_it_does_not_name`)."""
    with store.write() as conn:
        golden.record_eval(conn, kind=golden.DRIFT_KIND, extractor_version="wx-v0-aaaaaaaa", n=10,
                           now_iso="2026-09-14T05:00:00-04:00",
                           metrics={"model": "claude-opus-5", "effort": "high",
                                    "by_type": {"PRINCIPLE": {"jaccard": 0.9, "below_floor": False}},
                                    "stability": {"decision": "accepted"}})
    with store.read() as conn:
        out = golden.decide_stability(conn, extractor_version="wx-v0-bbbbbbbb", model="claude-opus-5",
                                      effort="high", by_type={"CALL": {"jaccard": 1.0, "below_floor": False}})
    assert out["decision"] == "blocked"
    assert out["regressions"] == [{"record_type": "PRINCIPLE", "metric": "jaccard",
                                   "previous": 0.9, "current": None, "why": "not_measured"}]


def test_drift_separates_a_REWORDED_principle_from_a_DIFFERENT_one():
    """⛔⛔ THE MEASUREMENT THAT DECIDES WHETHER N=3 VOTING IS WORTH 3x THE BILL.

    `writer.Chunk.key` is `(type, ticker, stance, direction)` for CALL — structured, small value
    space — but `(type, normalize_quote_key(statement))` for PRINCIPLE and MARKET_SIGNAL, and
    `normalize_quote_key` only casefolds and collapses whitespace. So the identity of a principle
    IS its wording, and two runs that found the same rule and said it differently score ZERO
    agreement.

    ⭐ That makes the strict number ambiguous in a way that calls for opposite responses: finding
    DIFFERENT principles is a real stability problem and the reason not to publish; finding the
    SAME principle and rewording it is a property of the identity function, which voting would
    pay 3x to average over without fixing. Reporting both is what tells them apart.
    """
    same_claim_reworded = {"s1": [("PRINCIPLE", "your stop is your north star")]}
    reworded = {"s1": [("PRINCIPLE", "the stop is your north star always")]}
    d = golden.drift(same_claim_reworded, reworded)
    p = d["by_type"]["PRINCIPLE"]
    assert p["agreed"] == 0 and p["jaccard"] == pytest.approx(0.0), "strict identity sees nothing in common"
    assert p["agreed_paraphrase"] == 1 and p["jaccard_paraphrase"] == pytest.approx(1.0)
    assert p["paraphrase_share"] == pytest.approx(1.0), "all of this 'drift' is wording"

    # CONTROL — a genuinely DIFFERENT principle must NOT be merged, or the lens would hide the
    # very instability it exists to size.
    different = {"s1": [("PRINCIPLE", "size down when the regime turns hostile")]}
    d2 = golden.drift(same_claim_reworded, different)
    p2 = d2["by_type"]["PRINCIPLE"]
    assert p2["agreed"] == 0 and p2["agreed_paraphrase"] == 0
    assert p2["jaccard_paraphrase"] == pytest.approx(0.0) and p2["paraphrase_share"] == pytest.approx(0.0)

    # ...and a structured type is untouched by the lens: its identity was never free text.
    d3 = golden.drift({"s1": [("CALL", "ZZZT", "taking", "long")]},
                      {"s1": [("CALL", "ZZZT", "taking", "long")]})
    assert "agreed_paraphrase" not in d3["by_type"]["CALL"]


# ── golden-v1.1 NULL segments: false positives on text nobody labelled ───────
#
# ⛔ WHY THESE RAILS EXIST. On golden-v1's dev split the gate kept 882 records and SCORED
# 119; the other 763 were claims about paragraphs with no label, and a record INVENTED about
# unlabelled text could not be counted against the extractor at all. A positive label makes a
# MISS visible; only an anti-label makes an INVENTION visible.

NULL_TEXT = "Sunday Scans is out now. Zoom link posted at the close. See you all in the morning."


def null_row(gid, quote, types, split="dev"):
    return {"gid": gid, "kind": golden.NULL_KIND, "golden_version": "v1.1", "record_type": None,
            "stream": "sunday_scans", "quote": quote, "split": split, "null_for": list(types),
            "locator": {"sample": "sample.txt", "external_ref": "test:1"}, "expected": [], "evidence": {}}


def predicted_in(text, records):
    segment = dict(SEGMENT, text=text)
    return writer.validate_output({"records": records}, segment=segment, source=SOURCE, resolver=None,
                                  vocab_names=set()).kept


def test_a_prediction_inside_a_null_segment_is_a_false_positive_for_that_type():
    """The load-bearing rail: an anti-label makes an invention scorable."""
    n = golden.null_from_record(null_row("N-1", NULL_TEXT, ["CALL", "PRINCIPLE", "MARKET_SIGNAL"]))
    preds = predicted_in(NULL_TEXT, [
        make(record_type="CALL", quote="Sunday Scans is out now.", ticker_as_written="ZZZT", direction="long",
             stance="taking"),
        make(record_type="PRINCIPLE", quote="See you all in the morning.",
             principle={"statement": "show up every morning", "category": "process", "empirical_claim": False,
                        "testable_claim": None}),
    ])
    result = golden.match_segment([], preds, NULL_TEXT, nulls=[n])
    assert result["fp"] == {"CALL": 1, "PRINCIPLE": 1}
    assert result["null_fp"] == {"CALL": 1, "PRINCIPLE": 1}
    assert result["tp"] == {} and result["fn"] == {}
    # and it must not ALSO be reported as unscored: one prediction, one verdict
    assert result["unscored_predictions"] == 0 and result["null_spans"] == 1
    per_type = golden.score([result])["per_type"]
    assert per_type["CALL"]["precision"] == 0.0 and per_type["CALL"]["fp_null"] == 1
    assert per_type["MARKET_SIGNAL"]["fp_null"] == 0 and per_type["MARKET_SIGNAL"]["null_segments"] == 1
    assert per_type["MARKET_SIGNAL"]["null_fp_rate"] == 0.0


def test_a_type_the_null_row_does_not_declare_stays_unscored_never_a_false_positive():
    """⛔ A NULL row answers only the question it was asked. Scoring an undeclared type is
    the instrument manufacturing a finding — the labeller never looked for a MENTION here."""
    n = golden.null_from_record(null_row("N-2", NULL_TEXT, ["CALL"]))
    preds = predicted_in(NULL_TEXT, [make(record_type="MENTION", quote="Zoom link posted at the close.",
                                          ticker_as_written="ZZZT")])
    result = golden.match_segment([], preds, NULL_TEXT, nulls=[n])
    assert result["fp"] == {} and result["null_fp"] == {}
    assert result["unscored_predictions"] == 1
    assert "MENTION" not in golden.score([result])["per_type"]


def test_a_null_segment_with_no_predictions_contributes_nothing_but_its_denominator():
    """A quiet NULL segment is evidence — "0 of n", which is exactly what an FP rate needs —
    and it must never be able to move tp, fp or fn."""
    n = golden.null_from_record(null_row("N-3", NULL_TEXT, ["CALL", "PRINCIPLE"]))
    result = golden.match_segment([], [], NULL_TEXT, nulls=[n])
    assert result["tp"] == {} and result["fp"] == {} and result["fn"] == {}
    assert result["null_fp"] == {} and result["scored_predictions"] == 0
    metrics = golden.score([result])
    assert metrics["null_segments"] == 1 and metrics["null_false_positives"] == 0
    assert metrics["per_type"]["CALL"] == {
        "tp": 0, "fp": 0, "fn": 0, "precision": None, "recall": None, "n_expected": 0, "n_predicted_scored": 0,
        "type_ticker_recall": None, "fp_null": 0, "null_segments": 1, "null_segments_with_fp": 0,
        "null_fp_rate": 0.0}


def test_positive_scoring_is_unchanged_when_a_null_row_sits_in_the_same_segment():
    """The CONTROL. A NULL row beside real labels must not disturb them: a prediction that
    matched a label is a true positive, not a true positive AND a null false positive."""
    expected = golden.expected_from_record(v1("G-1", "CALL", "Bought ZZZT at 10.50 today and the stop is 9.80.",
                                              ticker_as_written="ZZZT", stance="taking", direction="long"))
    preds = predicted([
        make(record_type="CALL", quote="Bought ZZZT at 10.50 today", ticker_as_written="ZZZT", direction="long",
             stance="taking", stop=9.8),
        make(record_type="MENTION", quote="Unrelated MMMT chatter here.", ticker_as_written="MMMT"),
    ])
    plain = golden.match_segment(expected, preds, TEXT)
    n = golden.null_from_record(null_row("N-4", "Unrelated MMMT chatter here.", ["PRINCIPLE"]))
    with_null = golden.match_segment(expected, preds, TEXT, nulls=[n])
    assert plain["tp"] == with_null["tp"] == {"CALL": 1}
    assert plain["fp"] == with_null["fp"] == {} and plain["fn"] == with_null["fn"] == {}
    assert with_null["null_fp"] == {}
    # the MENTION is still UNSCORED: it is outside the label scope and its type is undeclared
    assert plain["unscored_predictions"] == with_null["unscored_predictions"] == 1


def test_a_prediction_the_labels_already_scored_is_never_double_counted_by_a_null_row():
    """⛔ The overlap case. A quote inside BOTH a label span and a NULL span must be counted
    once — by the label, which is the stronger evidence. Counting it twice inflates fp for a
    prediction that may be a true positive."""
    expected = golden.expected_from_record(v1("G-2", "NEGATIVE_CALL", "Passed on YYYT, too thin.",
                                              ticker_as_written="YYYT", stance="passed"))
    preds = predicted([make(record_type="CALL", quote="Passed on YYYT", ticker_as_written="YYYT",
                            direction="long", stance="taking")])
    # the same span is ALSO declared null for CALL, which is the type the model emitted
    n = golden.null_from_record(null_row("N-5", "Passed on YYYT, too thin.", ["CALL"]))
    result = golden.match_segment(expected, preds, TEXT, nulls=[n])
    assert result["fp"] == {"CALL": 1} and result["null_fp"] == {}
    assert result["fn"] == {"NEGATIVE_CALL": 1}


def test_a_null_row_never_becomes_an_expectation_and_needs_its_kind_to_be_one():
    """⛔ If a NULL row leaked an Expected, every NULL segment would manufacture a false
    NEGATIVE for a record that was never supposed to be there. And the discriminator is the
    declared `kind`: a row that merely lost its `expected` dict is NOT an assertion of absence."""
    row = null_row("N-6", NULL_TEXT, ["CALL"])
    assert golden.expected_from_record(row) == []
    assert golden.is_null_record(row) and golden.null_types(row) == frozenset({"CALL"})
    assert golden.null_from_record(row).types == frozenset({"CALL"})
    # ⛔ THE CASE THAT MAKES THE GUARD LOAD-BEARING, and the reason this assertion is here at
    # all: a mutation that disabled the early return SURVIVED against a tidy null row, because
    # `record_type: None` + `expected: []` happens to fall through the v0 path to [] anyway.
    # A rail that cannot distinguish the guard from its absence is not a rail
    # (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). The realistic editing mistake
    # is a positive row converted in place whose old fields were not stripped — and THAT one
    # leaks an Expected through both the PRINCIPLE branch and _expected_v1 unless `kind` wins.
    half_converted = dict(null_row("N-6b", NULL_TEXT, ["PRINCIPLE"]), record_type="PRINCIPLE")
    assert golden.expected_from_record(half_converted) == []
    v1_shaped = dict(null_row("N-6c", NULL_TEXT, ["CALL"]), record_type="CALL",
                     expected=make(record_type="CALL", quote=NULL_TEXT, ticker_as_written="ZZZT",
                                   stance="taking", direction="long"))
    assert golden.expected_from_record(v1_shaped) == []
    # a positive row that happens to carry a list-shaped `expected` is NOT a null row
    not_null = {"gid": "G-9", "record_type": "MENTION", "quote": "x", "expected": [],
                "locator": {"sample": "s.txt"}}
    assert not golden.is_null_record(not_null) and golden.null_from_record(not_null) is None
    # an unknown type NARROWS the claim; it never widens it
    assert golden.null_types(null_row("N-7", NULL_TEXT, ["CALL", "NOT_A_TYPE"])) == frozenset({"CALL"})
    assert golden.null_from_record(null_row("N-8", NULL_TEXT, ["NOT_A_TYPE"])) is None


def test_a_null_span_that_is_not_in_the_segment_is_reported_never_treated_as_the_whole_segment():
    """A span we cannot locate is a span we cannot say anything about."""
    n = golden.null_from_record(null_row("N-9", "text that is not in this segment", ["CALL"]))
    preds = predicted_in(NULL_TEXT, [make(record_type="CALL", quote="Sunday Scans is out now.",
                                          ticker_as_written="ZZZT", direction="long", stance="taking")])
    result = golden.match_segment([], preds, NULL_TEXT, nulls=[n])
    assert result["null_fp"] == {} and result["fp"] == {}
    assert result["null_spans"] == 0 and result["null_spans_not_found"] == ["N-9"]
    assert result["unscored_predictions"] == 1


def test_the_newest_golden_set_wins_and_an_operator_can_still_pin_an_older_one(tmp_path):
    """⛔ v1.1 is a SUPERSET of v1, so preferring it scores strictly more. Pinning has to stay
    possible or the two versions can never be compared on one extractor."""
    base = tmp_path / "golden"
    base.mkdir()
    (base / "golden-v1.jsonl").write_text('{"gid":"G-1"}\n', encoding="utf-8")
    assert golden.golden_file(tmp_path)[1] == "golden-v1"
    (base / "golden-v1.1.jsonl").write_text('{"gid":"G-1"}\n{"gid":"N-1"}\n', encoding="utf-8")
    assert golden.golden_file(tmp_path)[1] == "golden-v1.1"
    assert golden.golden_file(tmp_path, prefer="golden-v1.jsonl")[1] == "golden-v1"
    assert golden.golden_file(tmp_path, prefer="golden-v9.jsonl") == (None, None)


def test_a_segment_scores_file_written_before_v1_1_still_scores_to_the_same_numbers():
    """⛔ NON-VACUITY + back-compat. `score()` reads the null keys with .get, so gate-run-1's
    stored segment-scores must re-score unchanged; and the control proves the reader is not
    simply returning zeros for everything."""
    old = {"tp": {"CALL": 3}, "fp": {"CALL": 1}, "fn": {"CALL": 2}, "lenient_tp": {"CALL": 3},
           "scored_predictions": 4, "unscored_predictions": 7}
    metrics = golden.score([old])
    assert metrics["per_type"]["CALL"]["precision"] == 0.75
    assert metrics["per_type"]["CALL"]["recall"] == 0.6
    assert metrics["per_type"]["CALL"]["null_segments"] == 0
    assert metrics["null_segments"] == 0 and metrics["unscored_predictions"] == 7


def test_the_paraphrase_lens_refuses_to_merge_OPPOSITE_advice():
    """⚰️ MEASURED FAILURE OF THE FIRST VERSION, 2026-09-14. A token-set overlap cannot see a
    negation, because the negation barely changes the token set:

        "never average down into a loser"  vs "always average down into a loser"   0.667
        "size down when the regime turns hostile" vs "size up ... friendly"        0.625

    Both cleared the 0.6 threshold and merged as "the same claim, reworded". For a PRINCIPLE
    that is the worst error available: the negation IS the teaching, and merging the two would
    report the extractor as STABLE at the exact moment it contradicted itself — flattering the
    number in the one direction that would let an inverted rule publish under a named author.

    ⭐ Antonym PAIRS, not a polarity word list: a bare list would refuse the legitimate
    paraphrase below, where one side simply adds "always" and there is no "never" to contradict.
    """
    def merged(a, b):
        return golden._fuzzy_agreed([("PRINCIPLE", a)], [("PRINCIPLE", b)])

    assert merged("never average down into a loser", "always average down into a loser") == 0
    assert merged("size down when the regime turns hostile", "size up when the regime turns friendly") == 0
    assert merged("add to the winner above the pivot", "trim the winner above the pivot") == 0
    # CONTROL: real paraphrase still merges, including one that ADDS a polarity word with no
    # opposite on the other side — or the guard would have bought precision with the lens's job.
    assert merged("your stop is your north star", "the stop is your north star always") == 1
