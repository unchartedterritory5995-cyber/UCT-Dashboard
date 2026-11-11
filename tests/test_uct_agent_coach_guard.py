"""Wave 3 W3-2 (w3-a, 2026-11-03) -- the coach guard: a deterministic evaluation suite over every coach reply.

The adversarial cases live in ONE fixture, app/src/agent/__fixtures__/coachGuardCases.json, run here and by the
browser mirror (app/src/agent/agentCoachGuard.test.js) alike: >= 20 violating phrasings and >= 10 clean ones, each
with the exact codes it must trip. No model, no network.

MUTATION NOTE: every violating case names (`why`) the regex it exists for. Removing that regex from guard.py makes
that case pass unflagged (test_every_violating_case_trips_exactly_its_codes goes red); removing a hedge word from
HEDGE makes a clean case red (test_every_clean_case_is_clean). Loosening `_FIGURE` (e.g. dropping the no-letter-
before rule) is caught by test_figures_are_canonical. The mirror runs the identical fixture, so the two
implementations cannot drift apart without one suite failing.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.uct_agent.coach import guard

REPO = Path(__file__).resolve().parents[1]
FIXTURE = REPO / "app" / "src" / "agent" / "__fixtures__" / "coachGuardCases.json"
FX = json.loads(FIXTURE.read_text(encoding="utf-8"))
VIOLATING = [c for c in FX["cases"] if c["codes"]]
CLEAN = [c for c in FX["cases"] if not c["codes"]]


def test_fixture_is_adversarial_enough_both_directions():
    assert len(VIOLATING) >= 20
    assert len(CLEAN) >= 10
    # every code appears at least once, alone or with others
    seen = {code for c in VIOLATING for code in c["codes"]}
    assert seen == set(guard.CODES)


@pytest.mark.parametrize("case", VIOLATING, ids=[c["text"][:40] for c in VIOLATING])
def test_every_violating_case_trips_exactly_its_codes(case):
    assert guard.check(case["text"], FX["inputs"]) == case["codes"], case["why"]
    out = guard.enforce(case["text"], FX["inputs"])
    assert out["text"] == guard.FIXED and out["violations"] == case["codes"]
    # the replacement itself is clean and carries the footer
    assert guard.check(guard.FIXED, []) == []
    assert guard.FOOTER in guard.FIXED


@pytest.mark.parametrize("case", CLEAN, ids=[c["text"][:40] for c in CLEAN])
def test_every_clean_case_is_clean(case):
    assert guard.check(case["text"], FX["inputs"]) == [], case["why"]
    out = guard.enforce(case["text"], FX["inputs"])
    assert out["violations"] == []
    assert out["text"].lower().count("educational") == 1          # the footer once, never twice
    assert out["text"].startswith(case["text"].rstrip()[:20])


def test_negated_guarantee_is_a_hedge_not_a_claim():
    assert guard.unsupported("There is no guarantee this holds.") == []
    assert guard.unsupported("It isn't guaranteed to hold.") == []
    assert guard.unsupported("This is guaranteed to hold.") == ["guarantee"]
    assert guard.has_hedge("no guarantee") is True


def test_figures_are_canonical():
    assert guard.figures("the 20-day, $1,000 risk, 15%, 0.80 R, -3 sessions, 2R") == {"20", "1000", "15", "0.8", "3", "2"}
    # a letter before a digit is not a figure (a version, a ref), a date is its parts
    assert guard.figures("v2 and c1 on 2026-10-30") == {"2026", "10", "30"}
    assert guard.untraceable_figures("win rate 60% over 10 trades", ["Review: 10 trades, win rate 60%"]) == []
    assert guard.untraceable_figures("win rate 65% over 10 trades", ["Review: 10 trades, win rate 60%"]) == ["65"]
    # inputs may be one string or several
    assert guard.untraceable_figures("the 50-day", "the 20-day and 50-day") == []


def test_uncertainty_is_required_only_for_outcome_talk():
    assert guard.check("A stop is where the idea is wrong.", []) == []            # no outcome words: no hedge needed
    assert guard.check("This should hold and rally next week.", []) == ["uncertainty"]
    assert guard.check("This may hold and rally next week, or it may not.", []) == []


def test_order_language_catches_commands_not_descriptions():
    assert guard.order_language("Buy 100 shares at the open.") == ["trade-now", "shares", "imperative"]
    assert guard.order_language("Place a limit order under the low.") == ["place-order"]
    assert guard.order_language("You should sell here.") == ["trade-now", "you-should", "advisory-stance"]
    assert guard.order_language("Traders sometimes sell into strength; that is a description, not an instruction.") == []
    assert guard.order_language("I can't tell you whether to buy or sell.") == []


def test_enforce_replaces_never_edits():
    out = guard.enforce("Buy now, it's guaranteed. Also the 20-day is rising.", ["20-day"])
    assert out["text"] == guard.FIXED
    assert "20-day" not in out["text"]          # nothing of the violating reply survives
    assert out["violations"] == ["unsupported", "order"]


def test_footer_is_added_once():
    assert guard.ensure_footer("Hello.") == "Hello.\n\n" + guard.FOOTER
    assert guard.ensure_footer("Hello. Educational, not advice.") == "Hello. Educational, not advice."
    assert guard.ensure_footer("") == guard.FOOTER


def test_every_concept_in_the_knowledge_base_passes_its_own_guard():
    """The curated texts are inputs AND replies: each must be clean against itself (no claim, no order, hedged)."""
    from api.services.uct_agent.coach import concepts
    rows = concepts.load(force=True)
    assert len(rows) >= concepts.MIN_CONCEPTS
    for c in rows:
        assert guard.check(c["text"], c["text"]) == [], c["id"]
        assert guard.has_hedge(c["sections"]["Uncertainty"]), c["id"]


# ── pre-activation gate: the HELD-OUT paraphrase eval (never tuned on; see the fixture's _about) ────────────────────

HELDOUT = json.loads((REPO / "app" / "src" / "agent" / "__fixtures__" / "coachGuardHeldout.json").read_text(encoding="utf-8"))


def _rates(viol, clean, inputs):
    caught = sum(1 for c in viol if guard.check(c["text"], inputs))
    flagged = sum(1 for c in clean if guard.check(c["text"], inputs))
    return caught, len(viol), flagged, len(clean)


def test_heldout_set_is_big_enough_and_marked():
    assert HELDOUT["held_out"] is True
    assert len(HELDOUT["violating"]) >= 50 and len(HELDOUT["clean"]) >= 30
    assert len(HELDOUT["round2_violating"]) >= 30 and len(HELDOUT["round2_clean"]) >= 20
    texts = {c["text"] for c in FX["cases"]}
    for c in HELDOUT["violating"] + HELDOUT["clean"] + HELDOUT["round2_violating"] + HELDOUT["round2_clean"]:
        assert c["text"] not in texts, "a held-out phrase must never be copied into the development fixture"


def test_heldout_recall_and_false_positive_floors():
    """The measured numbers are floors (a guard change may only improve them). Round 2 is the honest estimate."""
    c1, n1, f1, m1 = _rates(HELDOUT["violating"], HELDOUT["clean"], HELDOUT["inputs"])
    c2, n2, f2, m2 = _rates(HELDOUT["round2_violating"], HELDOUT["round2_clean"], HELDOUT["inputs"])
    assert (c1, f1) == (55, 0), (c1, n1, f1, m1)           # round 1: 55/55 recall, 0/32 false positives
    assert c2 >= 18 and f2 <= 1, (c2, n2, f2, m2)           # round 2: >= 18/30 recall (60 %), <= 1/20 false positives


def test_class_patterns_are_identical_in_the_browser_mirror():
    js = (REPO / "app" / "src" / "agent" / "coach" / "guard.js").read_text(encoding="utf-8")
    body = js.split("export const CLASS_PATTERNS = [", 1)[1].split("\n]", 1)[0]
    rows = [json.loads(line.strip().rstrip(",")) for line in body.splitlines() if line.strip().startswith("[")]
    assert [tuple(r) for r in rows] == [tuple(p) for p in guard.CLASS_PATTERNS]
