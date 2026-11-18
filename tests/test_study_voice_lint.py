"""The voice check (scripts/study/voice_lint.py) catches what the owner called AI-sounding, and leaves plain trader talk
alone. Owner, 2026-11-17: "Sounds way too AI and not much in my prose at all." """
from scripts.study import voice_lint as vl


def _unit(*qs):
    return {"unit": "T.01", "questions": list(qs), "verify": {q["key"]: {"status": "pass"} for q in qs}}


SPEC = vl.load_tells()


def test_flags_the_tells_he_named():
    q = {"key": "q01", "q": "Which is the one thing you never do?", "choices": ["No; skip it", "Yes; buy it", "a", "b"],
         "why": "Never pull the stop in. Our card says the primary stop sits under the low. The rulebook's hard line holds.",
         "simple": "Volume that dries up lifts the grade."}
    hard = {t[0] for t in vl.lint_question(q, SPEC)["hard"]}
    assert {"formula_stem", "internal_card", "internal_rulebook", "textbook_phrase"} <= hard
    soft = {t[0] for t in vl.lint_question(q, SPEC)["soft"]}
    assert "semicolon_choice" in soft


def test_plain_trader_talk_passes():
    q = {"key": "q01", "q": "You bought 48.60 and the low of the day is 46.40. What do you do with the size?",
         "choices": ["Fewer shares, stop stays put", "Move the stop up to fit", "Full size anyway", "Use a 7% stop"],
         "why": "Fewer shares. The stop goes a few cents under the low of the day, where the chart says you're wrong. "
                "That's about 4.5%. Wider than I like, but under 5% I'll take it. The size comes from the stop.",
         "simple": "Take fewer shares, because the stop goes where the chart says you're wrong."}
    r = vl.lint_question(q, SPEC)
    assert r["hard"] == []


def test_report_and_picture_cards_are_not_our_card():
    q = {"key": "q01", "q": "How does the report card read?", "why": "Tap the picture card to see the candle."}
    assert vl.lint_question(q, SPEC)["hard"] == []


def test_only_live_questions_count():
    good = {"key": "q01", "q": "Do you buy it?", "why": "Yes. We buy the trade through the high."}
    dead = {"key": "q02", "q": "Our rule?", "why": "Our card says so."}
    unit = {"unit": "T.01", "questions": [good, dead], "verify": {"q01": {"status": "pass"}, "q02": {"status": "cut"}}}
    r = vl.lint_unit(unit, SPEC)
    assert sum(r["hard"].values()) == 0


def test_unit_flags_same_opener_and_no_voice():
    qs = [{"key": f"q{i:02d}", "q": "x?", "why": f"True. The thing number {i} holds."} for i in range(10)]
    r = vl.lint_unit(_unit(*qs), SPEC)
    assert any("open 'True. The'" in f for f in r["flags"])
    assert any("talk as us or to you" in f for f in r["flags"])


def test_strict_exit_code(tmp_path):
    import json
    bad = _unit({"key": "q01", "q": "Our rule?", "why": "Our card says so."})
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(bad), encoding="utf-8")
    assert vl.main(["--file", str(p), "--strict"]) == 1
    good = _unit({"key": "q01", "q": "Do you buy it?", "why": "Yes. We buy it as it trades through the high."})
    p.write_text(json.dumps(good), encoding="utf-8")
    assert vl.main(["--file", str(p), "--strict"]) == 0


def test_walkthroughs_are_linted_too():
    unit = {"unit": "T.01", "questions": [],
            "walkthroughs": [{"key": "w1", "title": "Our card's example", "steps": ["Step one.", "Our rule? It lifts the grade."]}],
            "verify": {"w1": {"status": "pass"}}}
    r = vl.lint_unit(unit, SPEC)
    assert r["hard"]["internal_card"] >= 1 and r["hard"]["textbook_phrase"] >= 1


def test_plain_english_criteria_is_not_our_working_file():
    ok = {"key": "q01", "q": "Grade the decision.", "why": "A trade made on all your criteria is an A, even if it lost."}
    bad = {"key": "q02", "q": "Which one?", "why": "Our criteria say the base needs three taps."}
    assert vl.lint_question(ok, SPEC)["hard"] == []
    assert {t[0] for t in vl.lint_question(bad, SPEC)["hard"]} == {"internal_ids"}


def test_the_whole_library_stays_free_of_hard_tells():
    # 2026-11-17: every lesson was rewritten in his voice and the library reached 0 hard tells (from 918 "our card"
    # lines, 137 "rulebook", 73 textbook phrases before). This keeps it there: a new or edited lesson that brings one
    # back fails here, not in his review.
    assert vl.main(["--strict"]) == 0
