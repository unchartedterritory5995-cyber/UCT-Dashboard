"""What a member READS about a degraded delivery (step 2.7, `api/services/discord_render/badge.py`).

⛔⛔ **EVERY ASSERTION HERE IS ABOUT RENDERED TEXT, NEVER ABOUT STATE.** This repo has shipped two
toasts whose copy never reached a human while every structural assertion stayed green: one was
handed `message` to a component that renders `msg`, the other was owned by the element its own
action unmounts. "The badge function was called" proves nothing about whether a member was warned.

The two rules the whole file is built around, and they pull in opposite directions on purpose:

  * **S8 — a degraded artifact always carries its label.** C-06 measured 3 unlabelled stand-ins, 2
    of which never healed.
  * **Rare, or it is furniture.** The first freshness design would have drawn a badge on every
    chart all weekend (§3.8b), and a badge that shows when nothing is wrong is not there on the day
    it matters.

So the healthy-path tests below are not filler: they are the second half of the contract, and the
weekend case is the one that actually broke.
"""
from __future__ import annotations

import datetime as dt

import pytest

from api.services.discord_render import badge, contract, contracts
from api.services.discord_render import freshness as fr
from api.services.discord_render.adapters import result as R

RTH = dt.datetime(2026, 9, 11, 11, 0, tzinfo=fr.ET)        # Friday, mid-session
WEEKEND = dt.datetime(2026, 9, 12, 12, 0, tzinfo=fr.ET)    # Saturday, market shut
FRIDAY = "2026-09-11"
AUGUST = "2026-08-03"
JULY = "2026-07-01"
CID = "7f3a9c21"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _stale(as_of=AUGUST, *, tf="D", now=RTH, provider="bars_store", data=None):
    return R.ok(data if data is not None else [{"t": as_of}], provider=provider,
                envelope=fr.envelope(as_of, tf=tf, provider=provider, now=now), corr_id=CID)


def _fresh(as_of=FRIDAY, *, tf="D", now=RTH, provider="bars_store"):
    return R.ok([{"t": as_of}], provider=provider,
                envelope=fr.envelope(as_of, tf=tf, provider=provider, now=now), corr_id=CID)


def _unknown(provider="massive"):
    """A quote: the upstream carries no timestamp, so the vintage is unknown (OI-22)."""
    return R.ok(("post", 1.0), provider=provider, envelope=fr.envelope(None, now=RTH), corr_id=CID)


# ── 1 · the badge: drawn on True, absent on None, absent on False ───────────

def test_a_stale_vintage_is_drawn_as_the_envelopes_own_sentence():
    """The control for every "is absent" assertion below: this function CAN produce a sentence, so
    a None elsewhere means the rule fired and not that the helper is inert."""
    r = _stale()
    drawn = badge.render_badge(r)
    assert drawn == r.envelope.badge, "the sentence has one owner and this is not it"
    assert drawn == "⚠ data as of 2026-08-03 00:00 ET (stale)"


def test_an_unknown_vintage_draws_nothing_at_all():
    """⛔⛔ AN ABSENT BADGE MEANS "WE HAVE NOTHING TO TELL YOU". A badge saying "fresh" that nobody
    measured is the failure this rule exists to prevent, and `stale=None` is deliberately not
    `False` (§3.8b)."""
    r = _unknown()
    assert r.stale is None, "the fixture is wrong: this test would pass for the wrong reason"
    assert badge.render_badge(r) is None


def test_a_fresh_vintage_draws_nothing_at_all():
    assert _fresh().stale is False
    assert badge.render_badge(_fresh()) is None


def test_a_result_with_no_envelope_draws_nothing_and_does_not_raise():
    assert badge.render_badge(R.ok(PNG, provider="renderer")) is None
    assert badge.render_badge(None) is None


def test_nothing_is_drawn_all_weekend():
    """⛔⛔ THE CASE THAT ACTUALLY BROKE. Friday's 16:00 close is the correct newest bar all weekend
    and at Monday's pre-open — 65 hours old and perfectly fresh. A fixed age budget calls that
    stale, which is how a badge ends up showing every weekend until everyone ignores it."""
    saturday = _fresh(FRIDAY, now=WEEKEND)
    assert badge.render_badge(saturday) is None
    assert badge.render_footer({"bars": saturday}, CID) == ""


def test_the_badge_reads_a_bare_envelope_too():
    """One accessor wherever the stamp comes from — a cache artifact carries an `Envelope`, not a
    `Result`, and a second accessor for it would be a second place the rule lives."""
    env = fr.envelope(AUGUST, tf="D", now=RTH)
    assert badge.render_badge(env) == env.badge and env.badge


def test_a_stamp_that_hands_us_a_sentence_for_an_unmeasured_vintage_is_still_refused():
    """⛔⛔ THIS MODULE IS THE LAST GATE BEFORE THE MEMBER AND IT DOES NOT TRUST ITS INPUT'S GUARD.

    `Envelope.badge` happens to check the verdict itself, so for a `Result` the two agree and the
    check here reads as belt-and-braces. It is not: `render_badge` is duck-typed, and a cache
    artifact, a lane's own stamp or a future envelope type is under no obligation to guard. The
    thing being asserted is that **the rule lives where the sentence leaves for Discord**, not in
    whichever object happened to be passed in.
    """
    class Unmeasured:
        stale, badge = None, "⚠ data as of 2026-08-03 00:00 ET (stale)"

    class Fresh:
        stale, badge = False, "⚠ data as of 2026-08-03 00:00 ET (stale)"

    assert badge.render_badge(Unmeasured()) is None
    assert badge.render_badge(Fresh()) is None
    assert badge.render_footer({"bars": Unmeasured(), "flow": Fresh()}, CID) == ""

    class Measured:
        stale, badge = True, "⚠ data as of 2026-08-03 00:00 ET (stale)"
    assert badge.render_badge(Measured()), (
        "the control: this fixture shape CAN produce a sentence, so the three Nones above are the "
        "rule firing and not a duck type the function silently ignores")


def test_a_stale_verdict_with_no_readable_timestamp_invents_no_sentence():
    """A warning with no timestamp in it tells a member something is wrong and nothing about what."""
    class Verdict:
        stale, badge = True, None
    assert badge.render_badge(Verdict()) is None


# ── 2 · the footer: vintage · provenance · id, and only when it has to ──────

def test_a_healthy_delivery_reads_exactly_as_it_would_undegraded():
    """⛔ RARE, OR IT IS FURNITURE. On a healthy path this is EVERY delivery."""
    results = {"bars": _fresh(), "renderer": R.ok(PNG, provider="renderer"), "quote": _unknown()}
    assert badge.render_footer(results, CID) == ""
    assert badge.stamp("**NVDA** · Daily", "") == "**NVDA** · Daily"


def test_an_empty_result_set_says_nothing():
    assert badge.render_footer({}, CID) == "" and badge.render_footer(None, CID) == ""


def test_the_footer_order_is_vintage_then_provenance_then_id():
    """04 §4. The order is what a member needs, in the order they need it: what is wrong with the
    data, then where the answer came from, then the string they quote back to us."""
    results = {"bars": _stale(), "flow": R.ok({"ok": True}, provider="in_process")}
    line = badge.render_footer(results, CID)
    assert line == ("⚠ data as of 2026-08-03 00:00 ET (stale)"
                    " · served from a slower backup source · id 7f3a9c21")
    assert line.index("stale") < line.index("backup") < line.index("id ")


def test_the_quality_clause_leads_the_line_and_shares_it():
    """04 §4 — **quality · vintage · provenance · id**, on ONE line.

    ⛔⛔ IT SHARES THE LINE BECAUSE `_drop_previous_stamp` CUTS EXACTLY ONE. `produce_chart` edits
    the same message twice — a stand-in, then the real chart — so a stand-in label on a second line
    would survive the edit that healed it, leaving "⚠ simplified chart" under a chart that is no
    longer simplified. That is C-06 inverted, and worse than C-06: a member who has learnt to trust
    the label is then being lied to by it.
    """
    results = {"bars": _stale(), "flow": R.ok({"ok": True}, provider="in_process")}
    line = badge.render_footer(results, CID, quality=badge.standin_label("deadline"))
    assert line == ("⚠ simplified chart — the chart service took too long"
                    " · ⚠ data as of 2026-08-03 00:00 ET (stale)"
                    " · served from a slower backup source · id 7f3a9c21")
    assert "\n" not in line
    assert line.index("simplified") < line.index("data as of") < line.index("backup") < line.index("id ")


def test_a_quality_clause_alone_still_carries_the_id():
    """A stand-in on otherwise healthy data is a degraded delivery, so it gets the string a member
    quotes back to us — the one thing this line exists to carry."""
    line = badge.render_footer({"bars": _fresh()}, CID, quality=badge.standin_label("renderer_unavailable"))
    assert line == "⚠ simplified chart — the chart renderer is unavailable · id 7f3a9c21"


def test_omitting_quality_leaves_every_existing_line_byte_identical():
    """⛔ THE MUTATION CONTROL FOR THE PARAMETER ITSELF. If `quality=None` changed a single byte of
    what today's call sites produce, the C-06 swap would be a behaviour change wearing a
    refactor's clothes."""
    cases = [
        ({"bars": _stale()}, CID),
        ({"bars": _stale(), "flow": R.ok({"ok": True}, provider="in_process")}, CID),
        ({"bars": _fresh(), "renderer": R.ok(PNG, provider="renderer")}, CID),
        ({}, CID),
        ({"bars": _stale()}, None),
    ]
    for results, cid in cases:
        assert badge.render_footer(results, cid, quality=None) == badge.render_footer(results, cid)
    assert badge.render_footer({"bars": _stale()}, CID) != "", (
        "the control: every comparison above would hold if the footer said nothing at all")


def test_a_degraded_delivery_always_carries_the_id_a_member_quotes():
    """It is the join to the durable jobs row and the only string a member can give us that
    identifies their request."""
    assert badge.render_footer({"bars": _stale()}, CID).endswith(" · id 7f3a9c21")


def test_an_odd_looking_id_is_still_printed():
    """⛔ NEVER FILTERED THROUGH A FORMAT CHECK. Dropping the id because it failed a regex loses the
    one thing this line exists to carry, on exactly the delivery that needed it."""
    assert badge.render_footer({"bars": _stale()}, "RESUMED-4").endswith(" · id RESUMED-4")


def test_a_footer_with_no_id_still_labels_the_delivery():
    line = badge.render_footer({"bars": _stale()}, None)
    assert line.startswith("⚠ data as of") and " · id " not in line


def test_the_backup_source_is_named_in_words_a_member_can_act_on():
    results = {"flow": R.ok({"ok": True}, provider="in_process").with_reason(R.UNREACHABLE)}
    line = badge.render_footer(results, CID)
    assert "served from a slower backup source" in line
    assert "degraded" not in line and "in_process" not in line, (
        "'degraded' means nothing to a member and 'in_process' is our word for our plumbing")


def test_a_cache_hit_labelled_only_by_its_reason_is_still_provenance():
    """⛔ BOTH SIGNALS ARE READ. A cache hit is labelled `CACHED` by the layer that CHOSE the cache,
    which is not always the layer that reports itself as the provider; reading one loses half."""
    served = R.ok([{"t": FRIDAY}], provider="bars_store",
                  envelope=fr.envelope(FRIDAY, tf="D", now=RTH)).with_reason(R.CACHED)
    assert "backup source" in badge.render_footer({"bars": served}, CID)


def test_a_failed_result_is_not_reported_as_a_backup_source():
    """A failure is not a delivery from somewhere else — it is the failure message's business."""
    assert badge.render_footer({"flow": R.fail(R.TIMEOUT, provider="in_process")}, CID) == ""


def test_which_stale_upstream_is_named_does_not_depend_on_call_order():
    """⛔ §3.10: THE SAME INPUT RENDERS THE SAME PIXELS. "Whichever was recorded first" makes the
    sentence depend on adapter call order, which is not part of the input. The oldest vintage wins —
    the delivery is as old as its oldest stale part."""
    old, newer = _stale(JULY), _stale(AUGUST)
    a = badge.render_footer({"bars": old, "flow": newer}, CID)
    b = badge.render_footer({"flow": newer, "bars": old}, CID)
    assert a == b == badge.render_footer({"bars": old}, CID)
    assert "2026-07-01" in a and "2026-08-03" not in a


def test_one_line_never_two():
    """04 §4 says ONE line. Two stacked warnings is the shape that makes members stop reading."""
    results = {"bars": _stale(JULY), "flow": R.ok({}, provider="in_process"), "x": _stale(AUGUST)}
    assert "\n" not in badge.render_footer(results, CID)


# ── 3 · the stamp reaches the member, once, intact ─────────────────────────

def test_the_stamp_is_appended_to_the_content_a_member_reads():
    out = badge.stamp("**NVDA** · Daily", badge.render_footer({"bars": _stale()}, CID))
    assert out.startswith("**NVDA** · Daily"), "the original content is not replaced"
    assert out.endswith(" · id 7f3a9c21")
    assert "⚠ data as of 2026-08-03 00:00 ET (stale)" in out


def test_the_stamp_is_idempotent_across_the_second_edit():
    """⛔ `produce_chart` edits the same message more than once — a stand-in, then the real chart.
    Appending on each pass warns the member twice, and a test that calls it once cannot see that."""
    footer = badge.render_footer({"bars": _stale()}, CID)
    once = badge.stamp("**NVDA** · Daily", footer)
    assert badge.stamp(once, footer) == once
    assert badge.stamp(badge.stamp(once, footer), footer) == once


def test_a_second_edit_whose_footer_changed_replaces_rather_than_repeats():
    """The stand-in goes out labelled, then the real chart lands with a different provenance. One
    line, the current one — not a transcript of everything that happened on the way."""
    first = badge.stamp("**NVDA** · Daily", badge.render_footer({"bars": _stale()}, CID))
    second = badge.stamp(first, badge.render_footer(
        {"bars": _stale(), "flow": R.ok({}, provider="in_process")}, CID))
    assert second.count("⚠ data as of") == 1 and second.count(" · id ") == 1
    assert second.startswith("**NVDA** · Daily") and "backup source" in second


def test_when_it_does_not_fit_the_CONTENT_is_trimmed_and_the_STAMP_is_kept():
    """⛔⛔ THE OTHER WAY ROUND IS THE S8 VIOLATION WITH EXTRA STEPS. A full-length reply whose last
    clause fell off is exactly the unlabelled stand-in C-06 describes — and it happens only on the
    longest replies, which are usually the most degraded."""
    footer = badge.render_footer({"bars": _stale()}, CID)
    out = badge.stamp("x" * (badge.CONTENT_MAX - 5), footer)
    assert len(out) <= badge.CONTENT_MAX
    assert footer in out, "the stamp survived; the content gave way"
    assert out.count("x") < badge.CONTENT_MAX - 5


def test_a_footer_longer_than_the_whole_budget_still_labels_the_delivery():
    out = badge.stamp("content", "y" * (badge.CONTENT_MAX + 50))
    assert len(out) == badge.CONTENT_MAX and out.startswith("y")


def test_content_that_is_empty_is_still_labelled():
    footer = badge.render_footer({"bars": _stale()}, CID)
    assert badge.stamp("", footer) == footer and badge.stamp(None, footer) == footer


def test_a_healthy_second_edit_does_not_eat_the_members_own_text():
    """⚠️ With no id in hand there is nothing that distinguishes our line from a member-facing
    sentence, so nothing is stripped. Stated as a test so the limitation is a decision, not a bug."""
    assert badge.stamp("**NVDA** · Daily", "") == "**NVDA** · Daily"


# ── 4 · the stand-in label: one table, and it is the contract's ────────────

@pytest.mark.parametrize("cls", sorted(contract.FAILURE_CLASSES))
def test_every_failure_class_has_a_stand_in_sentence_from_the_one_table(cls):
    """⛔ NO SECOND TABLE. Derived from `contract.FAILURE_CLASSES`, so a class added tomorrow is
    covered the day it lands instead of rendering as a generic apology forever (C-08)."""
    label = badge.standin_label(cls)
    assert label.startswith("⚠ simplified chart — ")
    assert label.endswith(contract.FAILURE_CLASSES[cls])
    assert "_" not in label, (
        "a member reads the sentence, not our class name — every multi-word class in the taxonomy "
        f"is underscore-joined, so a leaked identifier shows up here ({cls})")


def test_the_two_classes_that_actually_draw_a_stand_in_read_like_this():
    """04 §3: a stand-in is drawn when the renderer adapter returns a failure. What a member reads,
    in full, so a copy change has to come here and be argued for."""
    assert badge.standin_label("renderer_unavailable") == (
        "⚠ simplified chart — the chart renderer is unavailable")
    assert badge.standin_label("deadline") == (
        "⚠ simplified chart — the chart service took too long")
    assert set(badge.STANDIN_CLASSES) <= set(contract.FAILURE_CLASSES)


def test_an_unknown_class_cannot_leak_a_traceback_into_the_message():
    """⛔ NEVER A STACK TRACE, AN EXCEPTION STRING OR A URL. The input is normalised to a class in
    the table, so there is nothing for one to leak through."""
    leak = "ConnectionResetError at https://renderer.internal/render?token=abc"
    assert badge.standin_label(leak) == "⚠ simplified chart — something went wrong on our side"
    assert badge.standin_label(None) == "⚠ simplified chart — something went wrong on our side"


# ── 4b · the vintage that travels to the house page (C-07) ─────────────────

def test_the_house_page_is_handed_the_envelopes_own_sentence():
    """⛔⛔ THE SENTENCE, NOT THE DATE. `?stale=` carries what a member will read, composed once by
    `Envelope.badge`. Handing the page a bare `as_of` would make it phrase the warning itself — a
    second author over one value, and the reason the footer and the stats strip could disagree by a
    whole session on 2026-08-31. Derived from the envelope, never typed, so a re-wording cannot
    leave this test agreeing with a copy nobody ships."""
    env = _stale().envelope
    assert badge.vintage_param({"stale": env.stale, "as_of": env.as_of_et}) == env.badge
    assert env.badge, "the fixture is not stale, so this asserts nothing"


def test_nothing_travels_when_there_is_nothing_to_say():
    """⛔ RARE, OR IT IS FURNITURE — and unknown is not fresh. Fresh, unknown, and a stale verdict
    with no readable timestamp all send NO parameter, so the page draws no badge in each case."""
    assert badge.vintage_param({"stale": False, "as_of": FRIDAY}) is None
    assert badge.vintage_param({"stale": None, "as_of": FRIDAY}) is None
    assert badge.vintage_param({"stale": True, "as_of": None}) is None
    assert badge.vintage_param({"stale": True}) is None
    assert badge.vintage_param({"as_of": AUGUST}) is None
    assert badge.vintage_param({}) is None and badge.vintage_param(None) is None


def test_a_truthy_verdict_that_is_not_True_is_refused():
    """`stale` is three-valued on purpose (§3.8b). `is True` is the whole guard: `if stale:` reads
    None as falsey and is right by accident, until somebody makes the unknown case explicit."""
    for verdict in ("yes", 1, "true", [1]):
        assert badge.vintage_param({"stale": verdict, "as_of": AUGUST}) is None


def test_the_weekend_never_sends_a_badge_to_the_page():
    """The R-1 defect at this seam: Friday's close is the right newest bar all weekend, so a chart
    rendered on Saturday must carry no badge at all."""
    env = fr.envelope(FRIDAY, tf="D", provider="disk", now=WEEKEND)
    assert env.stale is False
    assert badge.vintage_param({"stale": env.stale, "as_of": env.as_of_et}) is None


# ── 5 · the contract this module is built against ──────────────────────────

def test_the_module_and_the_object_both_satisfy_the_frozen_shape():
    assert isinstance(badge, contracts.BadgeRenderer)
    assert isinstance(badge.RENDERER, contracts.BadgeRenderer)

    class BadgeOnly:
        def render_badge(self, result): return None
    assert not isinstance(BadgeOnly(), contracts.BadgeRenderer), (
        "the protocol accepts anything, so the two assertions above mean nothing")


def test_the_object_and_the_functions_cannot_say_different_things():
    r, results = _stale(), {"bars": _stale()}
    assert badge.RENDERER.render_badge(r) == badge.render_badge(r)
    assert badge.RENDERER.render_footer(results, CID) == badge.render_footer(results, CID)
    assert badge.RENDERER.standin_label("deadline") == badge.standin_label("deadline")


def test_the_content_ceiling_has_one_value_across_every_spelling():
    """Three modules name Discord's limit. Two spellings of one limit is the second-authority defect
    landing on the one string a member reads."""
    from api.services.discord_render.adapters import bindings
    assert badge.CONTENT_MAX == contracts.CONTENT_MAX == contract.CONTENT_MAX == bindings.CONTENT_MAX
