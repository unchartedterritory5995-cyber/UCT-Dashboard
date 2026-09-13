"""GATE-S7-REGIME-CHANGE Checkpoint 2 — the dark evaluator and the forward-only
harness, over HARNESS-ARMED predicates only.

⛔ No delivery. No projection of member rows. No legacy change.

⛔⛔ THE THREE ZEROES. For this type a dark run that never ran, a market that
never moved and two rules that never disagreed all print the same four zeroes.
`test_NO_DATA_and_NO_FLIP_and_QUIET_are_THREE_DIFFERENT_FACTS` is the rail that
keeps them apart, and it is the most important test in this file.
"""
from __future__ import annotations

import ast
import pathlib
import uuid

import pytest

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import regime_change as rc
from api.services.alert_taxonomy import regime_change_compare as cmp_

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MODULE = _REPO / "api" / "services" / "alert_taxonomy" / "regime_change.py"
_COMPARE = _REPO / "api" / "services" / "alert_taxonomy" / "regime_change_compare.py"
_RULES = _REPO / "api" / "services" / "awareness" / "rules.py"

DAY = "2026-09-11"
DAY2 = "2026-09-12"

#: The legacy R4 shape, expressed as a predicate.
LEDGER_PRED = {
    "labels": None,
    "min_confidence": None,
    "stake": rc.STAKE_EITHER,
    "prior_label_source": rc.LEDGER,
}

#: The legacy path-B shape, expressed as a predicate. ⛔ `stake` differs, and
#: that is not a style choice — path B applies no stake test at all.
SUMMARY_PRED = {
    "labels": None,
    "min_confidence": None,
    "stake": rc.STAKE_ANY,
    "prior_label_source": rc.SESSION_SUMMARY,
}


@pytest.fixture()
def db(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    return p


# ─────────────────────────────────────────────────────────────────────────────
# The dark rule against each legacy shape
# ─────────────────────────────────────────────────────────────────────────────

def test_the_dark_rule_reproduces_R4_on_the_legacy_shape():
    assert rc.would_fire(LEDGER_PRED, current_label="bear_trend",
                         ledger_label="chop", has_positions=True) is True
    assert cmp_.legacy_ledger_fires(current_label="bear_trend",
                                    ledger_label="chop", has_positions=True) is True


def test_no_flip_is_not_an_event_on_either_side():
    for same in ("chop", "bull_trend"):
        assert rc.would_fire(LEDGER_PRED, current_label=same, ledger_label=same,
                             has_positions=True) is False
        assert cmp_.legacy_ledger_fires(current_label=same, ledger_label=same,
                                        has_positions=True) is False


def test_a_FIRST_EVER_cycle_has_no_prior_label_and_fires_nothing():
    """`get_last_label()` returns None on an empty ledger, and R4's own guard
    (`if not label or not prev_label ...`) makes that a non-event rather than a
    flip from nothing."""
    assert rc.would_fire(LEDGER_PRED, current_label="chop", ledger_label=None,
                         has_positions=True) is False
    assert cmp_.legacy_ledger_fires(current_label="chop", ledger_label=None,
                                    has_positions=True) is False


def test_an_inactive_account_gets_nothing_from_the_ledger_path():
    assert rc.would_fire(LEDGER_PRED, current_label="bear_trend",
                         ledger_label="chop") is False
    assert cmp_.legacy_ledger_fires(current_label="bear_trend",
                                    ledger_label="chop") is False
    # ...and either half of the stake is enough
    assert cmp_.legacy_ledger_fires(current_label="bear_trend", ledger_label="chop",
                                    has_watch=True) is True


def test_path_B_has_NO_stake_test_and_that_asymmetry_IS_the_point():
    """⛔ The two emitters disagree about who is eligible. Path B alerts a member
    with no position and no watchlist; R4 does not."""
    assert cmp_.legacy_session_summary_fires(
        current_label="bear_trend", last_summary_text="we were in chop") is True
    assert cmp_.legacy_ledger_fires(current_label="bear_trend",
                                    ledger_label="chop") is False


def test_F_S7_RC_2_the_substring_match_is_REPRODUCED_not_fixed():
    """⛔ `if r in last_text` over lowercased text. `"chop"` is a substring of
    "choppy", so a summary that never named a regime still yields a prior label.
    A dark rule using word boundaries would disagree with the legacy exactly
    where the legacy is wrong, and CP2 measures the migration, not the bug."""
    text = "the tape was choppy and I overtraded it"
    assert "chop" not in text.split(), "control: the WORD chop is not in the text"
    assert rc.prior_label(SUMMARY_PRED, current_label="bear_trend",
                          last_summary_text=text) == "chop"
    assert cmp_.legacy_session_summary_fires(current_label="bear_trend",
                                             last_summary_text=text) is True


def test_path_B_returns_the_FIRST_label_in_the_hard_coded_tuples_ORDER():
    """⛔ Two labels in one summary is not ambiguous to the legacy — the tuple's
    order decides, and `bull_trend` precedes `chop`."""
    text = "we discussed bull_trend early then chop later"
    assert rc.SESSION_SUMMARY_SCAN_ORDER.index("bull_trend") < \
           rc.SESSION_SUMMARY_SCAN_ORDER.index("chop")
    assert rc.prior_label(SUMMARY_PRED, current_label="bear_trend",
                          last_summary_text=text) == "bull_trend"


def test_the_current_label_is_skipped_INSIDE_the_loop_not_before_it():
    """If the text names the current label first and another label later, the
    legacy walks past the current one and keeps going."""
    text = "bull_trend then chop"
    assert rc.prior_label(SUMMARY_PRED, current_label="bull_trend",
                          last_summary_text=text) == "chop"


def test_NO_SUMMARY_is_a_different_fact_from_a_summary_that_names_no_label():
    """`if not summaries: return 0` is a distinct branch from a summary whose
    text mentions nothing. Both are quiet; only one means the member has never
    had a voice session."""
    assert rc.prior_label(SUMMARY_PRED, current_label="chop",
                          last_summary_text=None) is None
    assert rc.prior_label(SUMMARY_PRED, current_label="chop",
                          last_summary_text="good discipline today") is None
    assert cmp_.legacy_session_summary_fires(current_label="chop",
                                             last_summary_text=None) is False


def test_an_explicit_ZERO_confidence_is_not_the_missing_default():
    """⛔ `??` picks it, `if (x)` drops it. R4 gets this right with `0.5 if
    confidence is None else float(...)` and the mirror must not un-fix it."""
    assert rc.resolve_confidence(0.0) == 0.0
    assert rc.resolve_confidence(None) == 0.5
    p = dict(LEDGER_PRED, min_confidence=0.4)
    assert rc.would_fire(p, current_label="bear_trend", ledger_label="chop",
                         confidence=0.0, has_positions=True) is False
    assert rc.would_fire(p, current_label="bear_trend", ledger_label="chop",
                         confidence=None, has_positions=True) is True


def test_an_undeclared_prior_label_source_fires_nothing_rather_than_raising():
    """⛔ Choosing a default would be the assumption `prior_label_source` exists
    to remove — there is no 'the' prior label in this system."""
    absent = {k: v for k, v in LEDGER_PRED.items() if k != "prior_label_source"}
    assert "prior_label_source" not in absent, "control: the key really is gone"
    for p in (absent,
              dict(LEDGER_PRED, prior_label_source=None),
              dict(LEDGER_PRED, prior_label_source="brain_phase")):
        assert rc.would_fire(p, current_label="bear_trend", ledger_label="chop",
                             has_positions=True) is False
        assert cmp_.legacy_fires(p, current_label="bear_trend", ledger_label="chop",
                                 has_positions=True) is False
    # ⛔ and "brain_phase" is not a typo — it is F-S7-RC-4's third emitter, which
    # is deliberately NOT a declarable source.
    assert rc.EXCLUDED_EMITTER_ALERTS_TYPE not in rc.PRIOR_LABEL_SOURCES


# ─────────────────────────────────────────────────────────────────────────────
# The mirror rail — path B, driven for real
# ─────────────────────────────────────────────────────────────────────────────

def _drive_real_path_b(monkeypatch, *, current_label, summary_text,
                       real_add_insight=False, user_id="u1"):
    """Run the REAL `maybe_emit_regime_shift` and capture what it tried to queue.

    ⛔ `get_current_regime` and `list_summaries` are stubbed because they reach
    the network and the database; `add_insight` is stubbed by default because it
    WRITES a `voice_proactive_insights` row and mirrors it into the member's
    Compass chat thread — running it for real to find out what the function would
    do is the one outcome a dark checkpoint exists to prevent.

    ⚠️ `maybe_emit_regime_shift` swallows every exception and returns 0, so a
    broken stub would look exactly like "did not fire". Every caller below pairs
    its assertion with a positive control for that reason.
    """
    from api.services import voice_memory_service as vms
    from api.services import voice_proactive_service as vps
    from api.services import voice_regime_classifier as vrc

    monkeypatch.setattr(vrc, "get_current_regime",
                        lambda *a, **k: {"regime": current_label, "narration": ""})
    monkeypatch.setattr(
        vms, "list_summaries",
        lambda uid, **k: ([] if summary_text is None
                          else [{"summary_text": summary_text}]))
    queued: list = []
    if not real_add_insight:
        real = vps.add_insight

        def _capture(uid, **kw):
            queued.append(kw)
            return len(queued)
        assert real is not _capture
        monkeypatch.setattr(vps, "add_insight", _capture)
    return vps.maybe_emit_regime_shift(user_id), queued


def test_the_session_summary_mirror_matches_the_REAL_function(monkeypatch):
    """⭐ `lesson_rail_the_mirror_not_just_the_lane`. Path B is the one side that
    HAS to be mirrored, because the real one writes and delivers."""
    cases = [
        ("bear_trend", "we were in chop all week", True),
        ("bear_trend", "the tape was choppy", True),        # F-S7-RC-2
        ("chop", "we were in chop all week", False),        # same label
        ("bear_trend", "nothing about regimes here", False),
        ("bear_trend", None, False),                        # no summary at all
        ("", "we were in chop all week", False),            # no current label
    ]
    fired_at_least_once = False
    for label, text, expected in cases:
        n, queued = _drive_real_path_b(monkeypatch, current_label=label,
                                       summary_text=text)
        real_fired = bool(n) and bool(queued)
        mirrored = cmp_.legacy_session_summary_fires(current_label=label or None,
                                                     last_summary_text=text)
        assert mirrored == real_fired == expected, (
            f"label={label!r} text={text!r}: mirror={mirrored} real={real_fired}")
        fired_at_least_once = fired_at_least_once or real_fired
    # ⛔ NON-VACUITY: the driver really did make the real function fire.
    assert fired_at_least_once, "the driver fired on nothing — the rail proves nothing"


def test_the_session_summary_mirror_rail_CAN_FAIL(monkeypatch):
    """⛔ THE CONTROL ON THE RAIL ABOVE. If the driver silently returned 0 for
    everything, every case would compare False to False and pass. This proves the
    driver distinguishes a firing decision from a non-firing one, and that the
    kwargs it captures are path B's real ones."""
    n_no, q_no = _drive_real_path_b(monkeypatch, current_label="chop",
                                    summary_text="we were in chop all week")
    assert (n_no, q_no) == (0, [])

    n_yes, q_yes = _drive_real_path_b(monkeypatch, current_label="bear_trend",
                                      summary_text="we were in chop all week")
    assert n_yes == 1 and len(q_yes) == 1
    # the real kwargs, not a guess about them
    assert q_yes[0]["kind"] == "regime_shift"
    assert q_yes[0]["symbol"] is None
    assert q_yes[0]["importance"] == rc.LEGACY_IMPORTANCE_SESSION_SUMMARY == 8


# ─────────────────────────────────────────────────────────────────────────────
# F-S7-RC-1 and F-S7-RC-3, proved by RUNNING the shipped code
# ─────────────────────────────────────────────────────────────────────────────

def _fresh_user():
    from api.services.auth_db import init_db
    from api.services.auth_service import create_user
    init_db()
    return create_user(f"s7rc_{uuid.uuid4().hex}@x.com", "p")["id"]


def _insight_rows(user_id, kind=None):
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        if kind is None:
            return conn.execute(
                "SELECT id, kind, symbol FROM voice_proactive_insights WHERE user_id = ?",
                (user_id,)).fetchall()
        return conn.execute(
            "SELECT id, kind, symbol FROM voice_proactive_insights "
            "WHERE user_id = ? AND kind = ?", (user_id, kind)).fetchall()
    finally:
        conn.close()


def test_F_S7_RC_1_a_NULL_SYMBOL_insight_has_NO_cooldown_and_a_named_one_does():
    """⛔⛔ THE EXECUTABLE HALF OF F-S7-RC-1, and its control is the same code
    differing in ONE ARGUMENT.

    `add_insight`'s per-(symbol, kind) cooldown lives inside `if symbol:`. So two
    identical market-wide insights BOTH land, while two identical ticker-bearing
    ones collapse to one. The docstring on `rule_regime_flip` promises the first
    case is suppressed by that cooldown. It is not.
    """
    from api.services.voice_proactive_service import add_insight

    uid = _fresh_user()
    a = add_insight(uid, kind="regime_flip", symbol=None,
                    headline="Market regime flipped: chop -> bear trend", importance=7)
    b = add_insight(uid, kind="regime_flip", symbol=None,
                    headline="Market regime flipped: chop -> bear trend", importance=7)
    assert a is not None and b is not None and a != b
    assert len(_insight_rows(uid, "regime_flip")) == 2, (
        "a null-symbol insight is NOT suppressed — the promised cooldown never runs")

    # ⛔ THE CONTROL: identical calls, one argument different.
    uid2 = _fresh_user()
    c = add_insight(uid2, kind="regime_flip", symbol="NVDA",
                    headline="x", importance=7)
    d = add_insight(uid2, kind="regime_flip", symbol="NVDA",
                    headline="x", importance=7)
    assert c is not None
    assert d is None, "the cooldown must still work for a NAMED symbol"
    assert len(_insight_rows(uid2, "regime_flip")) == 1


def test_F_S7_RC_3_path_B_REFIRES_for_an_unchanged_summary_until_the_shared_cap(monkeypatch):
    """⛔⛔ SHARPER THAN F-S7-RC-1, AND NEW. Path A survives the missing cooldown
    because the LEDGER moves — the next cycle's `prev_label` is the label just
    recorded. Path B has no ledger: it diffs against the member's last session
    SUMMARY, which does not change until they have another voice session.

    So every window scan queues ANOTHER `regime_shift` row for the same unchanged
    flip, and the only bound is `MAX_INSIGHTS_PER_USER_PER_DAY`, which is SHARED
    across every insight kind. Driven here with the REAL `add_insight`.
    """
    from api.services.voice_proactive_service import MAX_INSIGHTS_PER_USER_PER_DAY

    uid = _fresh_user()
    fired = 0
    for _ in range(MAX_INSIGHTS_PER_USER_PER_DAY + 4):
        n, _q = _drive_real_path_b(monkeypatch, current_label="bear_trend",
                                   summary_text="we were in chop all week",
                                   real_add_insight=True, user_id=uid)
        fired += n

    rows = _insight_rows(uid, "regime_shift")
    assert len(rows) > 1, "path B did not re-fire — F-S7-RC-3 is refuted"
    assert len(rows) == MAX_INSIGHTS_PER_USER_PER_DAY == 8, (
        "the ONLY thing that stopped path B was the shared daily cap")
    assert fired == MAX_INSIGHTS_PER_USER_PER_DAY
    # ...and every one of them is market-wide, so none was ever cooled down.
    assert {r["symbol"] for r in rows} == {None}


# ─────────────────────────────────────────────────────────────────────────────
# The forward-only harness
# ─────────────────────────────────────────────────────────────────────────────

def test_a_tick_where_both_agree_counts_agreed_and_nothing_else(db):
    t = cmp_.observe("p1", LEDGER_PRED, DAY, current_label="bear_trend",
                     ledger_label="chop", has_positions=True, db_path=db)
    assert t == {"agreed": 1, "new_only": 0, "legacy_only": 0, "flip_seen": 1}


def test_a_flat_market_tick_records_NO_outcome_at_all(db):
    t = cmp_.observe("p1", LEDGER_PRED, DAY, current_label="chop",
                     ledger_label="chop", has_positions=True, db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 0, "flip_seen": 0}
    r = cmp_.report("p1", db_path=db)
    assert r["observed"] == 0 and r["ticks"] == 1 and r["flips_seen"] == 0
    assert r["status"] == cmp_.STATUS_NO_FLIP


def test_a_labels_filter_the_legacy_does_not_have_shows_as_LEGACY_ONLY(db):
    """⭐ THE COLUMN THAT MATTERS. `legacy_only` is an alert a member LOSES at
    the flip. Both legacy emitters fire on ANY change, so a `labels` predicate
    produces exactly that."""
    t = cmp_.observe("p1", dict(LEDGER_PRED, labels=["bear_trend"]), DAY,
                     current_label="chop", ledger_label="bull_trend",
                     has_positions=True, db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 1, "flip_seen": 1}


def test_a_stake_of_ANY_on_the_ledger_source_shows_as_NEW_ONLY(db):
    """The other direction: R4 refuses an inactive account, a `stake='any'`
    predicate does not. At the flip that member STARTS getting an alert."""
    t = cmp_.observe("p1", dict(LEDGER_PRED, stake=rc.STAKE_ANY), DAY,
                     current_label="bear_trend", ledger_label="chop", db_path=db)
    assert t == {"agreed": 0, "new_only": 1, "legacy_only": 0, "flip_seen": 1}


def test_a_stake_on_the_SESSION_SUMMARY_source_LOSES_a_member_an_alert(db):
    """⛔ The two emitters disagree about eligibility, so migrating path B onto
    R4's stake is not a tidy-up — it is `legacy_only`, member by member."""
    t = cmp_.observe("p1", dict(SUMMARY_PRED, stake=rc.STAKE_EITHER), DAY,
                     current_label="bear_trend",
                     last_summary_text="we were in chop all week", db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 1, "flip_seen": 1}


def test_a_min_confidence_on_the_session_summary_source_is_LEGACY_ONLY_by_construction(db):
    """Path B ignores confidence entirely and hard-codes importance 8. Any
    confidence gate on that source therefore removes alerts and adds none."""
    t = cmp_.observe("p1", dict(SUMMARY_PRED, min_confidence=0.9), DAY,
                     current_label="bear_trend", confidence=0.2,
                     last_summary_text="we were in chop all week", db_path=db)
    assert t["legacy_only"] == 1 and t["new_only"] == 0


def test_the_four_outcomes_are_never_collapsed_into_a_rate(db):
    r = cmp_.report("nothing-observed", db_path=db)
    for k in ("agreed", "new_only", "legacy_only", "not_comparable"):
        assert k in r
    assert not any("rate" in k or "pct" in k or "percent" in k for k in r), (
        "a pass rate answers a question nobody asked: legacy_only and new_only "
        "are different defects for different members")


def test_NO_DATA_and_NO_FLIP_and_QUIET_are_THREE_DIFFERENT_FACTS(db):
    """⛔⛔ THE MOST IMPORTANT TEST IN THIS FILE. This type's event may happen
    once a day at best, so 'the sweep never ran', 'the regime never moved' and
    'the two rules agreed on every flip' all print four zeroes. The report has to
    LEAD with what it observed or the counts mean nothing."""
    empty = cmp_.report("never-ticked", db_path=db)
    assert empty["status"] == cmp_.STATUS_NO_DATA
    assert empty["spans"] == 0 and empty["ticks"] == 0 and empty["flips_seen"] == 0

    # ran, but the regime never moved
    cmp_.observe("flat", LEDGER_PRED, DAY, current_label="chop",
                 ledger_label="chop", has_positions=True, db_path=db)
    flat = cmp_.report("flat", db_path=db)
    assert flat["status"] == cmp_.STATUS_NO_FLIP
    assert flat["ticks"] == 1 and flat["flips_seen"] == 0

    # the regime MOVED, and neither side fired — this member has no stake
    cmp_.observe("quiet", LEDGER_PRED, DAY, current_label="bear_trend",
                 ledger_label="chop", db_path=db)
    quiet = cmp_.report("quiet", db_path=db)
    assert quiet["status"] == cmp_.STATUS_QUIET
    assert quiet["ticks"] == 1 and quiet["flips_seen"] == 1

    # ⛔ ALL THREE PRINT THE SAME FOUR ZEROES, and the report still says which.
    zeroes = ("agreed", "new_only", "legacy_only", "not_comparable")
    for r in (empty, flat, quiet):
        assert [r[k] for k in zeroes] == [0, 0, 0, 0]
    assert len({empty["status"], flat["status"], quiet["status"]}) == 3


def test_the_report_STATES_WHAT_IT_CANNOT_SEE_every_time(db):
    r = cmp_.report("p1", db_path=db)
    assert r["blind_spots"], "a report that names no blind spot has stopped looking"
    joined = " ".join(r["blind_spots"])
    assert "ONE SPAN DESCRIBES ONE EMITTER" in joined
    assert "8/DAY INSIGHT CAP" in joined
    assert "HARNESS-ARMED" in joined
    assert "harness-armed" in joined
    # ⛔ the blind spot that is still blind, named as such
    assert "HOW OFTEN THE LABEL ACTUALLY FLIPS WAS NOT MEASURED" in joined


def test_a_parameter_change_RESETS_THE_CLOCK_into_not_comparable(db):
    for d in (DAY, DAY2):
        cmp_.observe("p1", LEDGER_PRED, d, current_label="bear_trend",
                     ledger_label="chop", has_positions=True, db_path=db)
    before = cmp_.report("p1", db_path=db)
    assert before["agreed"] == 2 and before["not_comparable"] == 0

    cmp_.observe("p1", dict(LEDGER_PRED, labels=["bear_trend"]), DAY2,
                 current_label="bear_trend", ledger_label="chop",
                 has_positions=True, db_path=db)
    after = cmp_.report("p1", db_path=db)
    assert after["not_comparable"] == 2, "the pre-change ticks are DISCARDED, never carried"
    assert after["agreed"] == 1
    assert after["spans"] == 2


def test_the_OBSERVATION_counts_SURVIVE_a_parameter_change(db):
    """⭐ `ticks` and `flips_seen` are observations, not conclusions. 'The sweep
    ran three times and the regime moved three times' stays true no matter what
    the predicate's parameters were — and it is the fact the report leads with."""
    for d in (DAY, DAY2):
        cmp_.observe("p1", LEDGER_PRED, d, current_label="bear_trend",
                     ledger_label="chop", has_positions=True, db_path=db)
    cmp_.observe("p1", dict(LEDGER_PRED, labels=["bear_trend"]), DAY2,
                 current_label="bear_trend", ledger_label="chop",
                 has_positions=True, db_path=db)
    r = cmp_.report("p1", db_path=db)
    assert r["ticks"] == 3 and r["flips_seen"] == 3
    assert r["not_comparable"] == 2


def test_prior_label_source_is_in_the_fingerprint_because_it_is_a_DIFFERENT_EMITTER():
    """⛔ Flipping it does not narrow the same question — it asks the other
    emitter's question, so the accumulated ticks cannot carry."""
    assert rc.predicate_fingerprint(LEDGER_PRED) != \
        rc.predicate_fingerprint(dict(LEDGER_PRED, prior_label_source=rc.SESSION_SUMMARY))


def test_the_two_FIXED_VALUES_are_in_the_fingerprint():
    """So a future widening of either cannot inherit a span accumulated while
    they were pinned."""
    fp = rc.predicate_fingerprint(LEDGER_PRED)
    assert rc.CHANNELS_FIXED in fp
    assert fp[-1] is rc.ENTITY_REF_FIXED
    # and a params attempt to widen changes NOTHING, because they are fixed
    assert rc.predicate_fingerprint(dict(LEDGER_PRED, channels=["email"])) == fp


def test_the_fingerprint_ignores_things_that_do_not_decide_firing():
    assert rc.predicate_fingerprint(LEDGER_PRED) == \
        rc.predicate_fingerprint(dict(LEDGER_PRED, note="a member-facing label"))


def test_labels_ORDER_does_not_reset_the_clock():
    assert rc.predicate_fingerprint(dict(LEDGER_PRED, labels=["chop", "bear_trend"])) == \
        rc.predicate_fingerprint(dict(LEDGER_PRED, labels=["bear_trend", "chop"]))


def test_opening_a_span_is_idempotent_per_tick(db):
    for _ in range(4):
        cmp_.observe("p1", LEDGER_PRED, DAY, current_label="bear_trend",
                     ledger_label="chop", has_positions=True, db_path=db)
    assert cmp_.report("p1", db_path=db)["spans"] == 1


def test_sessions_are_counted_by_the_TICKS_market_date_not_wall_clock(db):
    for d in (DAY, DAY, DAY2):
        cmp_.observe("p1", LEDGER_PRED, d, current_label="bear_trend",
                     ledger_label="chop", has_positions=True, db_path=db)
    r = cmp_.report("p1", db_path=db)
    assert r["sessions_covered"] == [DAY, DAY2]
    assert r["verdict_ready"] is False
    assert r["min_sessions_for_verdict"] == 5


def test_verdict_ready_needs_an_observed_FLIP_as_well_as_FIVE_SESSIONS(db):
    """⛔ Five sessions of a flat tape is not five sessions of evidence, and this
    type's honest cadence is close to once a day. A session count alone cannot
    tell a live sweep from a dead one over a market that did not move."""
    for i in range(5):
        cmp_.observe("flat", LEDGER_PRED, f"2026-09-{11 + i:02d}",
                     current_label="chop", ledger_label="chop",
                     has_positions=True, db_path=db)
    flat = cmp_.report("flat", db_path=db)
    assert len(flat["sessions_covered"]) == 5
    assert flat["flips_seen"] == 0
    assert flat["verdict_ready"] is False, (
        "five flat sessions must NOT read as a verdict")

    for i in range(5):
        cmp_.observe("live", LEDGER_PRED, f"2026-09-{11 + i:02d}",
                     current_label="bear_trend", ledger_label="chop",
                     has_positions=True, db_path=db)
    live = cmp_.report("live", db_path=db)
    assert live["verdict_ready"] is True
    assert live["agreed"] == 5 and live["flips_seen"] == 5
    assert live["min_flips_for_verdict"] == 1


def test_the_heartbeat_beats_on_a_FLAT_MARKET_tick_too(db):
    """⛔ *A heartbeat that only beats on success is a success detector*, and for
    this type most ticks are flat by nature."""
    assert cmp_.heartbeat(db_path=db) is None
    cmp_.observe("p1", LEDGER_PRED, DAY, current_label="chop",
                 ledger_label="chop", has_positions=True, db_path=db)
    hb = cmp_.heartbeat(db_path=db)
    assert hb["ticks"] == 1
    assert hb["last_market_date"] == DAY
    assert hb["last_tick_at"] > 0


def test_the_heartbeat_counts_every_tick_and_the_report_carries_it(db):
    for d in (DAY, DAY, DAY2):
        cmp_.observe("p1", LEDGER_PRED, d, current_label="bear_trend",
                     ledger_label="chop", has_positions=True, db_path=db)
    r = cmp_.report("p1", db_path=db)
    assert r["heartbeat"]["ticks"] == 3
    assert r["heartbeat"]["last_market_date"] == DAY2


def test_both_emitters_can_be_armed_as_separate_predicates_and_the_report_says_which(db):
    """⛔ The absorption question the packet says nobody has answered: which
    prior-label authority wins. The harness refuses to answer it — it records
    which one each span declared and leaves the ruling to the owner."""
    cmp_.observe("led", LEDGER_PRED, DAY, current_label="bear_trend",
                 ledger_label="chop", has_positions=True, db_path=db)
    cmp_.observe("sum", SUMMARY_PRED, DAY, current_label="bear_trend",
                 last_summary_text="we were in chop", db_path=db)
    assert cmp_.report("led", db_path=db)["prior_label_sources"] == ["ledger"]
    assert cmp_.report("sum", db_path=db)["prior_label_sources"] == ["session_summary"]


# ─────────────────────────────────────────────────────────────────────────────
# §2a item 3 — what calls this evaluator, and what it is allowed to touch
# ─────────────────────────────────────────────────────────────────────────────

def _code_only(path: pathlib.Path) -> str:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id in ("PARAMS_SCHEMA", "BLIND_SPOTS")
                for t in node.targets):
            node.value = ast.Constant(value="<prose>")
    return ast.unparse(ast.fix_missing_locations(tree))


def test_the_harness_is_the_only_caller_of_would_fire():
    """⛔⛔ §2a ITEM 3 AT A CHECKPOINT WITH NO WIRE YET. `price-level` merged with
    the type registered, the harness built, eighteen tests green and NOTHING
    calling the evaluator — and a week of empty rows would have read exactly like
    five sessions of agreement.

    This rail fails if a second caller appears (a wire added without an approval
    line) AND if the harness stops calling it (the evaluator gone dark for real).
    """
    callers = []
    for p in (_REPO / "api").rglob("*.py"):
        if p.name == "regime_change.py":
            continue
        try:
            code = _code_only(p)
        except SyntaxError:
            continue
        if "regime_change.would_fire" in code or "_rc.would_fire" in code:
            callers.append(str(p.relative_to(_REPO)).replace("\\", "/"))
    assert callers == ["api/services/alert_taxonomy/regime_change_compare.py"], (
        f"expected the harness to be the ONLY caller; found {callers}")


def test_the_caller_rail_is_non_vacuous():
    """⛔ Without this, a broken walk that visited nothing would make the
    assertion above pass over an empty world."""
    seen = list((_REPO / "api").rglob("*.py"))
    assert len(seen) > 100, "the module walk found almost nothing"
    code = _code_only(_COMPARE)
    assert "_rc.would_fire" in code
    assert "would_fire" in _COMPARE.read_text(encoding="utf-8")


def test_the_harness_NEVER_writes_the_ledger_it_is_measuring():
    """⛔⛔ `record_snapshot` writes on every awareness cycle and the legacy
    rule's own `prev_label` is whatever it last wrote. A second writer would MOVE
    the thing being measured, and the comparison would be measuring the harness."""
    code = _code_only(_COMPARE)
    for forbidden in ("regime_snapshots", "record_snapshot", "get_last_label",
                      "awareness_regime_snapshots", "AUTH_DB_PATH", "auth_db"):
        assert forbidden not in code, f"{forbidden} reached the harness's CODE"


def test_the_harness_imports_no_delivery_and_no_MUTATING_legacy_path():
    code = _code_only(_COMPARE)
    for forbidden in ("deliver_alert_payload", "watchlist_alert_service",
                      "add_insight", "maybe_emit_regime_shift", "get_current_regime",
                      "list_summaries", "awareness.engine", "awareness import engine",
                      "alert_taxonomy.delivery", "receipts"):
        assert forbidden not in code, f"{forbidden} reached the harness's CODE"


def test_the_ONE_legacy_import_is_the_PURE_rule_and_it_really_is_pure():
    """⭐ Path A is DRIVEN FOR REAL rather than mirrored, and that is only honest
    because `awareness/rules.py` touches no database and no network — its own
    module docstring says *"Rules never touch the database or the network —
    engine.py owns all I/O"*. This rail checks the CODE, not the sentence."""
    code = _code_only(_COMPARE)
    # non-vacuity: the harness really does drive the shipped rule
    assert "from api.services.awareness import rules" in code
    assert "rule_regime_flip" in code

    rules_code = _code_only(_RULES)
    for io_marker in ("sqlite3", "requests", "httpx", "get_connection", "urllib",
                      "open(", "environ", "getenv"):
        assert io_marker not in rules_code, (
            f"awareness/rules.py now does I/O ({io_marker}) — driving it from a "
            "dark harness is no longer safe and it must become a mirror")


def test_there_is_no_scheduler_entry_and_no_flag_for_this_type():
    """⛔ REGISTRATION IS NOT ACTIVATION, and putting a dark evaluator on a tick
    is not the FLIP. CP1-CP2 add neither."""
    main = _code_only(_REPO / "api" / "main.py")
    assert "alert_taxonomy import regime_change" not in main
    assert "regime_change.register" not in main
    for path in (_MODULE, _COMPARE):
        code = _code_only(path)
        assert "add_job" not in code
        assert "CronTrigger" not in code
        assert "environ" not in code and "getenv" not in code
        assert "ENABLED" not in code
