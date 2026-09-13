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


def record(conn, version, model, pt, when, golden_version="gv1"):
    return golden.record_eval(conn, kind=golden.EVAL_KIND, extractor_version=version, n=9, now_iso=when,
                              metrics={"model": model, "effort": "high", "golden_version": golden_version,
                                       "split": "dev", "per_type": pt})


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
                    {**receipt, "run_id": "x4", "effort": "turbo"}):
            with pytest.raises(ValueError):
                golden.import_receipt(conn, bad)


def test_drift_and_calibration_summaries():
    a = {"s1": [("CALL", "ZZZT", "taking", "long")], "s2": [("MENTION", "AAAT", None, None)], "s3": []}
    b = {"s1": [("CALL", "ZZZT", "taking", "long")], "s2": [("MENTION", "BBBT", None, None)], "s3": []}
    d = golden.drift(a, b)
    assert d["segments"] == 3 and d["identical_segments"] == 2
    assert d["by_type"]["MENTION"] == {"run_1": 1, "run_2": 1, "agreed": 0}
    assert d["mean_jaccard"] == pytest.approx((1 + 0 + 1) / 3)
    usages = [{"input_tokens": 100, "cache_read_input_tokens": 900, "output_tokens": o} for o in (100, 200, 300, 400)]
    c = golden.calibration(usages, [300, 300, 300, 300], model="claude-opus-5", effort="high", system_tokens=700)
    assert c["output_tokens_p50"] in (200, 300) and c["output_tokens_p90"] == 400 and c["n"] == 4
    assert c["cache_read_share"] == 0.9 and c["chars_per_body_token"] == pytest.approx(1200 / 1200)
