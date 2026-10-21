"""scripts/study/ingest_feedback.py: the live feedback export becomes verdict
records the corrections overlay applies, plus a report of what is still open.
Run alone: python -m pytest tests/test_study_ingest_feedback.py -q
"""
from __future__ import annotations

import json

import pytest

from scripts.study import corrections, ingest_feedback as ing


def _row(i, **kw):
    base = {"id": i, "item_id": "si_872a0a87de98", "item_version": 1, "user_id": "u1", "role": "member",
            "channel": "site", "kind": "unclear_lesson", "text": "the where part lost me", "verdict": None,
            "answer_json": "Doji", "correct": False, "attempt_id": 9, "handled_at": None, "handled_by": None,
            "handled_note": None, "at": "2026-10-21T03:00:00+00:00", "type": "recall", "skill_id": "vocab.candle",
            "sym": "IWM", "asof": "2025-04-09", "review_status": "approved", "subject": "Bullish Engulfing",
            "q": "Which candle name fits the last 2 bars?", "ref": "872a0a"}
    base.update(kw)
    return base


@pytest.fixture()
def docs(tmp_path):
    exports = tmp_path / "exports"
    exports.mkdir()
    bank = tmp_path / "bank"
    bank.mkdir()
    (bank / "candles.chart.json").write_text(json.dumps({"items": [{"id": "si_872a0a87de98"}, {"id": "si_21a45eab27a0"}]}),
                                             encoding="utf-8")
    return {"exports": exports, "bank": bank, "report": tmp_path / "REPORT.md", "jsonl": tmp_path / "feedback.jsonl"}


def _run(docs, report_only=False):
    return ing.run(report_only=report_only, exports_dir=docs["exports"], report_path=docs["report"],
                   jsonl_path=docs["jsonl"], bank_dir=docs["bank"])


def test_owner_verdicts_become_corrections_records_and_members_notes_do_not(docs):
    rows = [
        _row(1),
        _row(2, role="owner", channel="discord", kind="bad_chart", text="bars too small", verdict="reject",
             user_id="discord:900"),
        _row(3, role="owner", channel="site", kind="great", text="", verdict="approve", item_id="si_21a45eab27a0",
             sym="CAVA", asof="2025-12-10", subject="Hanging Man", ref="21a45e"),
        _row(4, role="owner", channel="site", kind="unclear_lesson", text="say where the stop goes", verdict="fix"),
        _row(5, role="member", kind="too_easy", verdict="reject"),                  # a member's verdict never applies
    ]
    (docs["exports"] / "2026-10-21.json").write_text(json.dumps({"feedback": rows, "next_since_id": 5}), encoding="utf-8")
    out = _run(docs)
    assert out == {"rows": 5, "open": 5, "verdicts_added": 2}
    recs = [json.loads(l) for l in docs["jsonl"].read_text(encoding="utf-8").splitlines()]
    assert [r["verdict"] for r in recs] == ["reject", "approve"]
    assert recs[0]["item_id"] == "si_872a0a87de98" and recs[0]["segment"] == "candles.chart"
    assert recs[0]["reason"] == "bad_chart" and recs[0]["channel"] == "discord" and recs[0]["feedback_id"] == 2
    assert recs[0]["owner_words"] == "bars too small" and "IWM 2025-04-09 Bullish Engulfing" in recs[0]["note"]
    assert recs[1]["segment"] == "candles.chart" and recs[1]["channel"] == "site feedback"
    # the overlay reads them like any hand-written verdict: the rejected item leaves the bank
    items = [{"id": "si_872a0a87de98", "answer_json": {"answer": "x"}, "prompt_json": {}},
             {"id": "si_21a45eab27a0", "answer_json": {"answer": "y"}, "prompt_json": {}}]
    applied = corrections.apply(items, recs)
    assert [i["id"] for i in applied] == ["si_21a45eab27a0"]
    assert applied[0]["review_status"] == "approved" and applied[0]["reviewed"]["ts"] == "2026-10-21"


def test_rerunning_adds_nothing_and_a_later_export_wins(docs):
    rows = [_row(1, role="owner", verdict="reject", kind="bad_chart")]
    (docs["exports"] / "a.json").write_text(json.dumps({"feedback": rows}), encoding="utf-8")
    assert _run(docs)["verdicts_added"] == 1
    assert _run(docs)["verdicts_added"] == 0
    # the same row exported again, now handled: the report drops it, the jsonl keeps the one record
    rows[0]["handled_at"] = "2026-10-21T04:00:00+00:00"
    rows[0]["handled_note"] = "replaced with a legible chart"
    (docs["exports"] / "b.json").write_text(json.dumps({"feedback": rows}), encoding="utf-8")
    out = _run(docs)
    assert out == {"rows": 1, "open": 0, "verdicts_added": 0}
    assert "Nothing open." in docs["report"].read_text(encoding="utf-8")
    assert len(docs["jsonl"].read_text(encoding="utf-8").splitlines()) == 1


def test_the_report_groups_open_rows_by_item_with_the_question_and_the_counts(docs):
    rows = [_row(1), _row(2, kind="too_hard", text="", user_id="u2", answer_json=None, correct=None),
            _row(3, item_id="si_21a45eab27a0", sym="CAVA", asof="2025-12-10", subject="Hanging Man", ref="21a45e",
                 q="Which candle?", role="owner", channel="discord", verdict="fix", kind="unclear_lesson",
                 text="say where the stop goes"),
            _row(4, handled_at="2026-10-21T05:00:00+00:00")]
    (docs["exports"] / "x.json").write_text(json.dumps({"feedback": rows}), encoding="utf-8")
    _run(docs, report_only=True)
    text = docs["report"].read_text(encoding="utf-8")
    assert "3 open across 2 items" in text
    assert "| lesson unclear | 2 |" in text and "| too hard | 1 |" in text
    assert text.index("## IWM 2025-04-09 Bullish Engulfing") < text.index("## CAVA 2025-12-10 Hanging Man"), \
        "the item with the most open notes comes first"
    assert "> Which candle name fits the last 2 bars?" in text
    assert "- #1 lesson unclear — the where part lost me  (member via site, 2026-10-21 03:00 · answered Doji (not quite))" in text
    assert "- #3 lesson unclear · **fix** — say where the stop goes  (owner via discord" in text
    assert "#4" not in text, "handled rows are not open"
    assert not docs["jsonl"].exists(), "report-only appends nothing"


def test_no_exports_is_a_quiet_empty_report(docs):
    out = _run(docs)
    assert out == {"rows": 0, "open": 0, "verdicts_added": 0}
    assert "Nothing open." in docs["report"].read_text(encoding="utf-8")
