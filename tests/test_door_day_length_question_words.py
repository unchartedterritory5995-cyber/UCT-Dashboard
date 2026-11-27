"""THE DAY-LENGTH QUESTION'S WORDS: the door writes the time, the assistant writes the choice, and the two rules agree.

⚰️ MEASURED 2026-11-23. On a chart below a day a length in days is asked about ("the 50 day average on daily bars, or
the average of 50 five-minute bars, about 4 hours?"). Of the 24 such requests on record, 21 ended in that question
or a refusal, and 15 of those paid for a SECOND model call. The first live reading of `refused_attempts` showed why
for two of them:
  * attempt 1 wrote choices of 89 and 192 characters, and the SCHEMA refused them: a choice may be 80, a limit the
    assistant was never told;
  * attempt 2 wrote a short choice, and the DAY-LENGTH GUARD refused it: its note asked for every span "exactly",
    which is 165 characters for a request with four lengths, while its code accepts one.
What the note asked for could not fit the field. The member waited for two calls and was refused, every time.

Held here, with no model call:
  * the door writes ONE phrase for the bars version (`bars_phrase`), never over BARS_PHRASE_MAX_CHARS, for one to
    four lengths at every chart the door can name; a choice built around it passes the schema AND the guard;
  * the guard's NOTE asks for what its CODE accepts: what the note quotes, put in a choice, is accepted and fits;
  * the assistant is told the limit, and it is the schema's own number;
  * a guard that demands exact words must fit its field, or the module does not import;
  * ONE function says whether a chart below a day can build a daily measure. Since U-DAILY (e96) it reads the
    capability (D among the cross context's `tfBelowADayCodes`, on a chart that states a timeframe below a day).

SECOND UNIT (2026-11-23), after the 24 day-length requests were sent again: 0 refused (3 before), and 8 questions
still paid for a second call. Seven were choices of 82 to 96 characters: the assistant's own words (27 to 58) plus
the time range, with the bar counts put back where the door's phrase had dropped them. Raising the limit was ruled
out by the window (its column shows about 50 to 60 characters a line; a tab on an older bundle would refuse a longer
choice). So the door's phrase has SHORT FORMS from the same spans, counts kept and time compact; the turn is TOLD
how many characters of its own a choice may hold; the guard accepts exactly the forms the door can write. The
eighth was the guard reading "its 21-bar EMA on a daily chart" as the bars version: that is the daily version.
"""
from __future__ import annotations

import ast
import itertools
import json
from pathlib import Path

import pytest

from api.services import definition_conversation as dc

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring" / "patchSchema.json").read_text(encoding="utf-8"))
LIMIT = SCHEMA["$defs"]["question"]["properties"]["choices"]["items"]["maxLength"]
FIVE = {"sym": "NVDA", "tf": "5"}
#: every set of day lengths the 24 requests on record give (the numbers only), plus a few a request could
ON_RECORD = [(10,), (14,), (20,), (21,), (50,), (60,), (100,), (250,), (10, 21), (14, 50), (21, 50), (50, 20), (50, 21), (10, 21, 50, 14)]
MINUTES = sorted(set(dc._MINUTE_NAMES) | {4, 7, 60, 90, 120, 240, 390})
LENGTHS = (2, 9, 10, 14, 21, 50, 99, 100, 200, 250, 999)


def words_for(lengths, minutes=5):
    return f"On a {minutes} minute chart, show " + " and ".join(f"the {n} day average" for n in lengths)


def asked(*choices):
    return {"contract": dc.PATCH_CONTRACT, "baseRevision": 0, "ops": [], "disposition": "clarify", "reply": "Which would you like?",
            "questions": [{"id": "days", "text": "I can't yet compare each bar of this chart with a daily measure. Which would you like?",
                           "choices": list(choices)}]}


def refused(envelope, words, chart=FIVE):
    try:
        dc.check_day_lengths(envelope, words, chart)
    except dc._Refused as exc:
        return exc
    return None


def every_set():
    for k in (1, 2, 3, 4):
        yield from (itertools.permutations(LENGTHS, k) if k <= 2 else itertools.combinations(LENGTHS, k))


# ── the door's phrase ──

def test_the_phrase_is_the_span_for_one_length_and_one_range_for_several():
    assert dc.bars_phrase(words_for((50,)), FIVE) == "50 five-minute bars, about 4 hours"
    # several lengths: the counts in the order the member wrote them, the times from the shortest to the longest.
    # The COUNTS ARE KEPT and the time is written short when the full words would not leave the assistant its room
    assert dc.bars_phrase(words_for((10, 50)), FIVE) == "10 and 50 five-minute bars (50 min to 4 h)"
    assert dc.bars_phrase(words_for((9, 10)), FIVE) == "9 and 10 five-minute bars (45 min to 50 min)"
    assert dc.bars_phrase(words_for((10, 14)), FIVE) == "10 and 14 five-minute bars (50 min to 1 h 10 min)"
    assert dc.bars_phrase(words_for((10, 21, 50, 14)), FIVE) == "10, 21, 50 and 14 five-minute bars (50 min to 4 h)"
    # only when even that would not fit do the counts go; trading days are never shortened
    assert dc.bars_phrase(words_for((20, 50), 60), {"sym": "NVDA", "tf": "60"}) == "hourly bars (3 trading days to 7.5 trading days)"
    assert dc.bars_phrase(words_for((21,)), FIVE) == "21 five-minute bars, about 1 hour 45 minutes"
    # the order the member wrote the lengths in does not move the range: shortest to longest
    assert dc.bars_phrase(words_for((50, 10)), FIVE) == dc.bars_phrase(words_for((10, 50)), FIVE).replace("10 and 50", "50 and 10")
    # nothing to say on a daily chart, or with no length in days
    assert dc.bars_phrase("the 50 day average", {"sym": "NVDA", "tf": "D"}) is None
    assert dc.bars_phrase("On a 5 minute chart, the 50 bar average", FIVE) is None


def test_THE_RAIL_the_phrase_fits_with_room_for_one_to_four_lengths_on_every_chart():
    longest = 0
    for minutes in MINUTES:
        chart = {"sym": "NVDA", "tf": str(minutes)}
        for lengths in every_set():
            words = words_for(lengths, minutes)
            phrase = dc.bars_phrase(words, chart)
            assert phrase is not None and len(phrase) <= dc.BARS_PHRASE_MAX_CHARS, (minutes, lengths, phrase)
            longest = max(longest, len(phrase))
            # a choice the assistant writes around it: its own words, then the door's
            choice = "The same on " + phrase
            assert len(choice) <= LIMIT, (minutes, lengths, choice)
            assert refused(asked("The same as a line, on daily bars", choice), words, chart) is None, (minutes, lengths, choice)
    assert dc.BARS_PHRASE_MAX_CHARS - 8 <= longest <= dc.BARS_PHRASE_MAX_CHARS      # the bound is reached, not merely far away
    # a chart only known to be below a day ("intraday"): no minutes, so no time can be said, and the phrase says so
    for lengths in ON_RECORD:
        words = "On an intraday chart, show " + " and ".join(f"the {n} day average" for n in lengths)
        phrase = dc.bars_phrase(words, {"sym": "NVDA", "tf": "D"})
        assert phrase is not None and len(phrase) <= dc.BARS_PHRASE_MAX_CHARS and "bars" in phrase, (lengths, phrase)


@pytest.mark.parametrize("lengths", ON_RECORD, ids=["-".join(map(str, s)) for s in ON_RECORD])
def test_every_set_of_lengths_on_record_has_a_question_both_rules_accept(lengths):
    words = words_for(lengths)
    notes = dc.day_length_turn_notes(words, FIVE)
    assert [n["days"] for n in notes["day_lengths"]] == list(lengths)
    phrase = notes["day_lengths_bars_phrase"]
    # the turn is TOLD its room, as a number: the schema's limit less the phrase, never under the room the door keeps
    assert notes["day_lengths_choice_room"] == LIMIT - len(phrase) >= dc.ROOM_FOR_THE_ASSISTANTS_WORDS
    choices = ["The same lines, on daily bars", "The same on " + phrase]
    envelope = asked(*choices)
    assert dc._schema_errors(envelope) == [], dc._schema_errors(envelope)       # the schema
    assert refused(envelope, words) is None                                      # the day-length guard


# ── the guard: its note asks for what its code accepts ──

def test_THE_FINDING_what_the_note_asks_for_is_accepted_and_fits_a_choice():
    """The request that could never succeed: four lengths. The repair's choice is refused; what the note then quotes,
    put into a choice, passes the guard and the schema."""
    words = words_for((10, 21, 50, 14))
    exc = refused(asked("The three distances on daily bars", "Averages of 10, 21 and 50 five-minute bars (to 4 hours)"), words)
    assert exc is not None and exc.gate == "envelope:days-choice-in-days"
    told = exc.for_model()
    phrase = dc.bars_phrase(words, FIVE)
    assert f'put these words in it as given: "{phrase}", and at most {LIMIT - len(phrase)} characters of your own beside them' in told
    assert f"Keep the whole choice within {LIMIT} characters" in told and "never call it by its number of days" in told
    # ⚰️ it used to ask for every span "exactly": 165 characters where 80 are allowed
    every_span = "; ".join(n["on_this_chart"] for n in dc.day_length_notes(words, FIVE))
    assert len(every_span) > LIMIT and every_span not in told and "exactly (" not in told
    mended = asked("The three distances on daily bars", "Distances from averages of " + phrase)
    assert dc._schema_errors(mended) == [] and refused(mended, words) is None


def test_the_guard_still_accepts_one_span_named_exactly_and_still_refuses_days():
    words = words_for((50,))
    assert refused(asked("The 50 day average as a line, on daily bars", "Crosses of the average of 50 five-minute bars (about 4 hours)"), words) is None
    assert refused(asked("The line on daily bars", "Nothing for now: on a daily chart this builds exactly as asked"), words) is None
    for choice in ("Crosses of a 50 bar average of this chart",                                   # no time at all
                   "Crosses of the average of 50 five-minute bars (about 4 hours), the 50 day idea",   # still called 50 day
                   "Crosses of the average of 50 fifteen-minute bars (about 4 hours)"):                # another chart's bars
        assert refused(asked("The line on daily bars", choice), words) is not None, choice
    # the door's phrase does not excuse calling the bars version by its days
    several = words_for((10, 21))
    phrase = dc.bars_phrase(several, FIVE)
    assert refused(asked("On daily bars", "The 10 day and 21 day idea on " + phrase), several) is not None


def test_a_build_on_this_charts_bars_is_told_the_phrase_and_the_limit():
    close = {"type": "series", "name": "close"}
    words = words_for((10, 21, 50, 14))
    built = {"contract": dc.PATCH_CONTRACT, "baseRevision": 0, "disposition": "change", "reply": "Done.", "ops": [
        {"op": "create", "name": "Average", "placement": "price", "outputs": [
            {"key": "a", "tree": {"type": "call", "name": "sma", "args": [close, {"type": "num", "value": 50}]}}]}]}
    exc = refused(built, words)
    assert exc is not None and exc.gate == "envelope:days-as-bars"
    told = exc.for_model()
    assert f"two `choices` of at most {LIMIT} characters" in told
    assert f'the bars version carrying "{dc.bars_phrase(words, FIVE)}" as given and never called 50 days' in told


# ── the assistant is told the limit, and it is the schema's ──

def test_the_instructions_state_the_limit_the_schema_holds():
    rule = dc.DAY_LENGTH_CHOICE_RULE
    assert dc.CHOICE_MAX_CHARS == LIMIT == dc._choice_max_chars()
    assert dc.CONVERSE_SYSTEM_PROMPT.count(rule) == 1
    assert "two `choices` that each name what they draw IN TIME. " + rule in dc.CONVERSE_SYSTEM_PROMPT
    for part in (f"A choice is at most {LIMIT} characters, and a longer one is refused",
                 "put `uct_language_notes.day_lengths_bars_phrase` as given", "Never call that version by its number of days",
                 "`uct_language_notes.day_lengths_choice_room` is how many characters of your own", "Count them",
                 "Do not say the counts or the times again in your own words",
                 "`uct_language_notes.daily_measure_inside`"):
        assert part in rule, part
    # the number is not typed: the module reads it where the schema keeps it
    source = (ROOT / "api" / "services" / "definition_conversation.py").read_text(encoding="utf-8")
    assert "CHOICE_MAX_CHARS = _choice_max_chars()" in source and "CHOICE_MAX_CHARS = 80" not in source
    # the old instruction asked for the spans "exactly as given": it is gone from the instructions
    assert "Write the bars version with the `on_this_chart` words exactly" not in dc.CONVERSE_SYSTEM_PROMPT


# ── a guard that demands exact words must fit its field ──

def test_the_module_does_not_start_when_the_guards_words_would_not_fit_a_choice():
    dc.require_room_in_a_choice(LIMIT)                                    # as it stands
    # the phrase's budget is DERIVED: what the schema's limit leaves once the assistant's room is kept
    assert dc.BARS_PHRASE_MAX_CHARS == LIMIT - dc.ROOM_FOR_THE_ASSISTANTS_WORDS
    source = (ROOT / "api" / "services" / "definition_conversation.py").read_text(encoding="utf-8")
    assert "BARS_PHRASE_MAX_CHARS = CHOICE_MAX_CHARS - ROOM_FOR_THE_ASSISTANTS_WORDS" in source
    least = len(dc.BARS_PHRASE_LAST_RESORT)
    dc.require_room_in_a_choice(dc.ROOM_FOR_THE_ASSISTANTS_WORDS + least)             # the smallest limit that still works
    with pytest.raises(RuntimeError, match="cannot both hold"):
        dc.require_room_in_a_choice(dc.ROOM_FOR_THE_ASSISTANTS_WORDS + least - 1)     # one character under it
    with pytest.raises(RuntimeError):
        dc.require_room_in_a_choice(LIMIT, room=LIMIT)                    # a room that leaves the door no words at all
    # and it IS called when the module is read, with the schema's own limit
    tree = ast.parse((ROOT / "api" / "services" / "definition_conversation.py").read_text(encoding="utf-8"))
    at_import = [node for node in tree.body if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
                 and getattr(node.value.func, "id", None) == "require_room_in_a_choice"]
    assert len(at_import) == 1 and [getattr(a, "id", None) for a in at_import[0].value.args] == ["CHOICE_MAX_CHARS"]


# ── the capability: one function, and since U-DAILY (e96) it reads the capability itself ──

def test_one_function_says_whether_a_daily_measure_builds_below_a_day_and_it_reads_the_capability(monkeypatch):
    # ⭐⭐ U-DAILY (e96): a chart below a day builds a daily read (`tf` of D, the door's `tfBelowADayCodes`); a chart
    # that is days, or one that never said its timeframe, does not (the browser's gate refuses it there)
    assert dc.daily_values_below_a_day(FIVE) is True
    assert dc.daily_values_below_a_day() is False and dc.daily_values_below_a_day({"sym": "NVDA"}) is False
    assert dc.daily_values_below_a_day({"sym": "NVDA", "tf": "D"}) is False
    notes = dc.day_length_turn_notes(words_for((50,)), FIVE)
    assert set(notes) == {"day_lengths", "day_lengths_bars_phrase", "day_lengths_choice_room", "daily_measure_inside"}
    assert notes["daily_measure_inside"] is True
    assert dc.day_length_turn_notes("the 50 day average", {"sym": "NVDA", "tf": "D"}) == {}
    # CONTROL: the answer is the capability's, not a constant: withdraw D from the cross context and it is no again,
    # and the turn promises nothing
    withdrawn = {**dc.cross_context(), "tfBelowADayCodes": []}
    monkeypatch.setattr(dc, "cross_context", lambda: withdrawn)
    assert dc.daily_values_below_a_day(FIVE) is False
    assert set(dc.day_length_turn_notes(words_for((50,)), FIVE)) == {"day_lengths", "day_lengths_bars_phrase",
                                                                 "day_lengths_choice_room"}
    monkeypatch.undo()
    # the ONE place: nothing else in the module decides it, and the turn's notes read it by name
    source = (ROOT / "api" / "services" / "definition_conversation.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "daily_values_below_a_day"]
    assert len(calls) == 1
    writes = [node for node in ast.walk(tree) if isinstance(node, ast.Constant) and node.value == "daily_measure_inside"]
    assert len(writes) == 1                                               # written in one place, behind that call
    # when the engine unit points the function at its capability, the assistant is told, with nothing else edited
    monkeypatch.setattr(dc, "daily_values_below_a_day", lambda chart=None: True)
    assert dc.day_length_turn_notes(words_for((50,)), FIVE)["daily_measure_inside"] is True


# ── second unit: short forms from the same spans, the room as a number, one function for what is accepted ──

def test_every_form_the_door_can_write_comes_from_one_function_fullest_first():
    forms = dc.bars_phrases(words_for((10, 21, 50, 14)), FIVE)
    assert forms == ["10, 21, 50 and 14 five-minute bars, about 50 minutes to 4 hours",
                     "10, 21, 50 and 14 five-minute bars (50 min to 4 h)",
                     "five-minute bars, about 50 minutes to 4 hours",
                     "five-minute bars (50 min to 4 h)",
                     "these bars (50 min to 4 h)",
                     "these bars in place of days"]
    assert dc.bars_phrases(words_for((50,)), FIVE) == ["50 five-minute bars, about 4 hours", "50 five-minute bars (4 h)",
                                                       "these bars (4 h)", "these bars in place of days"]
    assert dc.bars_phrases("the 50 day average", {"sym": "NVDA", "tf": "D"}) == []
    # the door's phrase is the FIRST form that leaves the assistant its room
    for lengths in ON_RECORD:
        words = words_for(lengths)
        forms = dc.bars_phrases(words, FIVE)
        fits = [f for f in forms if len(f) <= dc.BARS_PHRASE_MAX_CHARS]
        assert dc.bars_phrase(words, FIVE) == fits[0] and forms[-1] == dc.BARS_PHRASE_LAST_RESORT, lengths
        # the counts are kept whenever a form WITH them fits: never dropped for nothing
        with_counts = [f for f in forms[:2] if len(f) <= dc.BARS_PHRASE_MAX_CHARS]
        assert (not with_counts) or dc.bars_phrase(words, FIVE) == with_counts[0], lengths


def test_the_guard_accepts_exactly_the_forms_the_door_can_write():
    words = words_for((10, 21, 50, 14))
    for form in dc.bars_phrases(words, FIVE):
        choice = "The same from " + form
        assert len(choice) <= LIMIT or form == dc.bars_phrases(words, FIVE)[0], form       # (only the fullest can run over)
        if len(choice) <= LIMIT:
            assert refused(asked("The same lines, on daily bars", choice), words) is None, form
    # and nothing near them: a time the door did not write, or the door's time with other counts
    for near in ("The same from 10, 21, 50 and 14 five-minute bars (to 4 hours)",
                 "The same from five-minute bars (about an hour to 4 h)",
                 "The same from the last few bars of this chart"):
        assert refused(asked("The same lines, on daily bars", near), words) is not None, near


def test_the_seven_choices_that_ran_over_would_fit_with_the_phrase_and_the_room():
    """The measured failures, by their numbers alone (the requests are private): the assistant's own words ran 27 to
    58 characters. With the door's phrase and the room it is told, a choice whose own words keep to the room fits."""
    for lengths in ON_RECORD:
        notes = dc.day_length_turn_notes(words_for(lengths), FIVE)
        own = "x" * notes["day_lengths_choice_room"]                     # as many of its own characters as it was told
        assert len(own + notes["day_lengths_bars_phrase"]) == LIMIT
        assert notes["day_lengths_choice_room"] >= 28                     # the shortest own words measured were 27
    # one character more than it was told is what the schema refuses: the number told is the true one
    notes = dc.day_length_turn_notes(words_for((10, 21, 50, 14)), FIVE)
    over = asked("On daily bars", "y" * (notes["day_lengths_choice_room"] + 1) + notes["day_lengths_bars_phrase"])
    assert any("too long" in e for e in dc._schema_errors(over))


def test_a_choice_that_says_on_a_daily_chart_is_the_daily_version():
    """⚰️ Live 2026-11-23: "The ratio with a 21 day EMA, which is its 21-bar EMA on a daily chart" was refused as a
    bars version called by its days. It is the DAILY version, described with the word "bar"."""
    words = "On a 5 minute chart, plot the ratio against SPY with its 21 day EMA"
    daily = "The ratio with a 21 day EMA, which is its 21-bar EMA on a daily chart"
    bars = "The ratio with an EMA of " + dc.bars_phrase(words, FIVE)
    assert refused(asked(daily, bars), words) is None
    for also in ("The same line on daily bars", "A 21-bar EMA on the daily chart", "Its 21 bar average on a daily chart"):
        assert refused(asked(also, bars), words) is None, also
    # CONTROL: a bars version is still caught, whatever else it says
    for caught in ("The ratio with a 21 day EMA on this chart's bars", "A 21-bar EMA of this chart", "A 21 bar EMA, daily style"):
        assert refused(asked(daily, caught), words) is not None, caught


def test_the_schema_says_what_a_change_to_one_of_its_limits_needs():
    """The browser validates against the copy of the schema bundled into the page. A raised limit makes a tab on the
    older bundle refuse the newer server's answer: found before a limit was raised, written where the next person
    to raise one will read it."""
    said = SCHEMA["description"]
    for part in ("bundled into the page", "a tab still on the older bundle", "`accepts` handshake"):
        assert part in said, part
    assert LIMIT == 80                                                    # and the limit itself did not move

