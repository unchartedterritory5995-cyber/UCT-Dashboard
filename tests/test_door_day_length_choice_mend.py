"""THE DOOR RE-SAYS ITS OWN PHRASE SHORTER WHEN A CHOICE RUNS OVER BECAUSE OF IT (third day-length unit, 2026-11-24).

⚰️ MEASURED 2026-11-24 in the regression sweep after #2599 (admin, measurement only; the request is private, so by
its numbers alone): a request with one length in days on a 5 minute chart asked the right question and paid a SECOND
model call for it. Attempt 1's choice was 90 characters, refused by the schema: the door's phrase as given (44) and
46 characters of the assistant's own, ten over the room it had been told (36). A model counts characters badly.

So the door, before its check, re-says its OWN phrase in its next shorter form when that alone makes the choice fit:
  * the assistant's own words are never touched, and a choice that is over because of them is left for the schema;
  * the replacement is one of `bars_phrases`, which `check_day_lengths` accepts by construction;
  * the last resort ("these bars in place of days", no time named) is never chosen by the mend;
  * a choice no form can fit is refused as before, by the schema;
  * the turn that needed it is answered in ONE call, and the mend is recorded by name (`usage.mended`).

The words below are written for this file; no private request is quoted. No paid calls: the model is the scripted
stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import definition_conversation as dc
from tests.test_p2_truth_server import conv, emits, empty_view, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring" / "patchSchema.json").read_text(encoding="utf-8"))
LIMIT = SCHEMA["$defs"]["question"]["properties"]["choices"]["items"]["maxLength"]
FIVE = {"sym": "NVDA", "tf": "5"}
ONE = "On a 5 minute chart, draw a band around today's open that is one 14 day ATR wide"
FOUR = "On a 5 minute chart, show the 10 day, 21 day and 50 day averages, each measured in 14 day ATRs from price"
DAILY = "The band on daily bars, with the real 14 day ATR"


def asked(*choices):
    return {"contract": dc.PATCH_CONTRACT, "baseRevision": 0, "ops": [], "disposition": "clarify",
            "reply": "Which would you like?",
            "questions": [{"id": "days", "text": "I can't yet add a daily measure to this chart's bars. Which would you like?",
                           "choices": list(choices)}]}


def choices_of(envelope):
    return envelope["questions"][0]["choices"]


def over_by_the_phrase(words, own_extra=10):
    """A choice of the shape measured: the door's full phrase as given, and `own_extra` more characters of the
    assistant's own than the room it was told."""
    notes = dc.day_length_turn_notes(words, FIVE)
    phrase, room = notes["day_lengths_bars_phrase"], notes["day_lengths_choice_room"]
    own = ("The band from this chart's own ATR, measured over " + "x" * 80)[:room + own_extra]
    return own + phrase, phrase


# ── the mend ──

def test_THE_FINDING_a_choice_over_only_because_of_the_phrase_is_re_said_shorter_and_fits():
    choice, phrase = over_by_the_phrase(ONE)
    assert len(choice) == LIMIT + 10                                  # 10 over, as measured
    forms = dc.bars_phrases(ONE, FIVE)
    after, n = dc.mend_choice_phrases(asked(DAILY, choice), forms)
    assert n == 1
    mended = choices_of(after)[1]
    assert len(mended) <= LIMIT, mended
    own = choice[:-len(phrase)]
    assert mended.startswith(own), "the assistant's own words were touched"
    said = mended[len(own):]
    assert said in forms and said != phrase and said != dc.BARS_PHRASE_LAST_RESORT
    assert choices_of(after)[0] == DAILY                              # the daily choice is untouched
    assert dc._schema_errors(after) == []
    assert dc.check_day_lengths(after, ONE, FIVE) is None             # the guard accepts it


def test_the_answer_it_was_given_is_not_changed_in_place():
    choice, _ = over_by_the_phrase(ONE)
    given = asked(DAILY, choice)
    after, n = dc.mend_choice_phrases(given, dc.bars_phrases(ONE, FIVE))
    assert n == 1 and choices_of(given)[1] == choice and after is not given


@pytest.mark.parametrize("words", [ONE, FOUR])
def test_every_overrun_a_shorter_form_can_absorb_is_mended_and_accepted(words):
    """From one character over to as far as the door's shorter forms reach: always a fit, never the last resort."""
    forms = dc.bars_phrases(words, FIVE)
    notes = dc.day_length_turn_notes(words, FIVE)
    room, phrase = notes["day_lengths_choice_room"], notes["day_lengths_bars_phrase"]
    shortest = min(len(f) for f in forms if f != dc.BARS_PHRASE_LAST_RESORT)
    for extra in range(1, len(phrase) - shortest + 1):
        choice = "y" * (room + extra) + phrase
        after, n = dc.mend_choice_phrases(asked(DAILY, choice), forms)
        assert n == 1, extra
        mended = choices_of(after)[1]
        assert len(mended) <= LIMIT and dc.BARS_PHRASE_LAST_RESORT not in mended, (extra, mended)
        assert dc.check_day_lengths(after, words, FIVE) is None, (extra, mended)


def test_a_choice_no_form_can_fit_is_left_for_the_schema_to_refuse():
    forms = dc.bars_phrases(ONE, FIVE)
    shortest = min(len(f) for f in forms if f != dc.BARS_PHRASE_LAST_RESORT)
    choice = "z" * (LIMIT - shortest + 1) + forms[0]                  # even the shortest timed form is one over
    given = asked(DAILY, choice)
    after, n = dc.mend_choice_phrases(given, forms)
    assert n == 0 and after is given
    assert any("too long" in e for e in dc._schema_errors(after))


def test_a_choice_over_because_of_its_own_words_is_untouched():
    long_own = "The band from this chart's own average true range, drawn around the session's opening price"
    given = asked(DAILY, long_own)
    assert len(long_own) > LIMIT
    after, n = dc.mend_choice_phrases(given, dc.bars_phrases(ONE, FIVE))
    assert n == 0 and after is given


def test_a_choice_within_the_limit_and_a_request_with_no_day_lengths_are_untouched():
    _, phrase = over_by_the_phrase(ONE)
    given = asked(DAILY, "Use " + phrase)
    after, n = dc.mend_choice_phrases(given, dc.bars_phrases(ONE, FIVE))
    assert n == 0 and after is given
    choice, _ = over_by_the_phrase(ONE)
    given = asked(DAILY, choice)
    assert dc.mend_choice_phrases(given, []) == (given, 0)            # no forms: nothing the door said
    assert dc.mend_choice_phrases({"ops": []}, dc.bars_phrases(ONE, FIVE))[1] == 0
    assert dc.mend_choice_phrases("not an answer", dc.bars_phrases(ONE, FIVE)) == ("not an answer", 0)


def test_the_last_resort_is_never_chosen_even_when_it_alone_would_fit():
    forms = ["14 five-minute bars, about 1 hour 10 minutes", dc.BARS_PHRASE_LAST_RESORT]
    choice = "w" * 50 + forms[0]                                    # 94: only the last resort (27) would fit
    after, n = dc.mend_choice_phrases(asked(DAILY, choice), forms)
    assert n == 0 and choices_of(after)[1] == choice


# ── the whole turn ──

def test_the_turn_that_paid_a_second_call_is_answered_in_one_and_says_it_was_mended(conv, clean_env, model):
    choice, _ = over_by_the_phrase(ONE)
    client = model([emits(asked(DAILY, choice))])
    r = conv.converse(ONE, user_id="u1", view=empty_view(0), chart=FIVE)
    assert r["ok"] is True and len(client.calls) == 1, r
    assert r["usage"]["repair_gate"] is None
    assert conv.MEND_CHOICE_PHRASE in str(r["usage"]["mended"])
    q = r["envelope"]["questions"][0]["choices"]
    assert len(q[1]) <= LIMIT and q[0] == DAILY


def test_control_a_choice_no_form_fits_still_pays_its_repair(conv, clean_env, model):
    forms = dc.bars_phrases(ONE, FIVE)
    shortest = min(len(f) for f in forms if f != dc.BARS_PHRASE_LAST_RESORT)
    hopeless = "z" * (LIMIT - shortest + 1) + forms[0]
    fixed, _ = over_by_the_phrase(ONE, own_extra=-1)                  # the repair keeps to its room
    client = model([emits(asked(DAILY, hopeless)), emits(asked(DAILY, fixed))])
    r = conv.converse(ONE, user_id="u1", view=empty_view(0), chart=FIVE)
    assert len(client.calls) == 2, r
    assert r["usage"]["repair_gate"] == "envelope:schema"
    assert conv.MEND_CHOICE_PHRASE not in str(r["usage"]["mended"])
