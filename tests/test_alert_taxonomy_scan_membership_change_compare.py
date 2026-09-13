"""GATE-S7-SCAN-MEMBERSHIP-CHANGE Checkpoint 2 — the dark evaluator and the
FORWARD-ONLY harness, over HARNESS-ARMED predicates only.

⛔ No replay (F-S7-3). No delivery. No projection of member rows. No legacy
change. Four outcomes, never a pass rate, and `legacy_only` is an alert a member
LOSES at the flip.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import scan_membership_change as smc
from api.services.alert_taxonomy import scan_membership_change_compare as cmp_
from api.services.screener import scan_store
from api.services.screener import screen_alerts
from api.services.screener import snapshot_db

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MODULE = _REPO / "api" / "services" / "alert_taxonomy" / "scan_membership_change.py"
_COMPARE = _REPO / "api" / "services" / "alert_taxonomy" / "scan_membership_change_compare.py"

H = "sha256:" + "a" * 64
TF = "D"
DAY = "2026-09-11"
DAY2 = "2026-09-12"

EITHER = {"definition_id": H, "direction": smc.DIRECTION_EITHER, "timeframe": TF,
          "dedup_grain": smc.DEDUP_GRAIN}
ENTERED = dict(EITHER, direction=smc.DIRECTION_ENTERED)
LEFT = dict(EITHER, direction=smc.DIRECTION_LEFT)


@pytest.fixture()
def db(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    return p


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A screener database of this test's own, PROVED to be the one in use.

    ⛔ `C:\\data` exists on this box and the screener's default path resolves into
    it, so "we set the env var" is a claim about intent — this asserts the
    module actually reads it."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    monkeypatch.setattr(screen_alerts, "_done", set())
    assert snapshot_db.get_db_path() == str(path), (
        "SCREENER_DB_PATH did not reach snapshot_db — a module-level capture has "
        "appeared and this whole file is writing somewhere else")
    scan_store.init_db()
    return path


def _sweep(as_of: int, tickers, *, universe: int = 100, def_hash: str = H) -> None:
    """One swept session: a coverage receipt ALWAYS, hits only if it matched."""
    scan_store.record_hits(def_hash, TF, as_of, tickers)
    scan_store.record_coverage(def_hash, TF, as_of, evaluated=universe,
                               answered=universe, dropped=0, not_computable=0,
                               dropped_symbols=[])


def _inputs(sessions):
    """`(covered_sessions, hits_by_as_of)` the way the legacy derives them —
    coverage for the session list, hits for the contents.

    ⛔ EVERY COVERED SESSION IS DECLARED IN THE MAP, an empty one included. That
    is finding B written as a call convention rather than as a comment."""
    covered = scan_store.recent_covered_as_ofs(H, TF, limit=2)
    return covered, {s: scan_store.hits(H, TF, s) for s in covered}


# ═════════════════════════════════════════════════════════════════════════════
# The evaluator
# ═════════════════════════════════════════════════════════════════════════════

def test_the_diff_is_the_set_difference_both_ways():
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL", "MSFT"], 20260910: ["AAPL", "NVDA"]}
    got = smc.would_fire(EITHER, covered_sessions=covered, hits_by_as_of=hits)
    assert got["fires"] is True
    assert got["entered"] == ["NVDA"]
    assert got["exited"] == ["MSFT"]
    assert got["as_of"] == 20260910


def test_direction_filters_exactly_as_the_legacy_mode_does():
    """`want_in = entered if mode in ("entry","both")`, and the mirror image."""
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL", "MSFT"], 20260910: ["AAPL", "NVDA"]}

    only_in = smc.would_fire(ENTERED, covered_sessions=covered, hits_by_as_of=hits)
    assert only_in["entered"] == ["NVDA"] and only_in["exited"] == []

    only_out = smc.would_fire(LEFT, covered_sessions=covered, hits_by_as_of=hits)
    assert only_out["entered"] == [] and only_out["exited"] == ["MSFT"]

    both = smc.would_fire(EITHER, covered_sessions=covered, hits_by_as_of=hits)
    assert both["entered"] == ["NVDA"] and both["exited"] == ["MSFT"]


def test_a_direction_only_movement_the_member_did_not_subscribe_to_is_QUIET():
    """⛔ NOT a fire with an empty list. `run_nightly`'s own branch is
    `skipped_quiet`, and a nightly "nothing for you" message is what trains a
    member to mute the channel."""
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL", "MSFT"], 20260910: ["AAPL"]}   # MSFT LEFT only
    got = smc.would_fire(ENTERED, covered_sessions=covered, hits_by_as_of=hits)
    assert got["fires"] is False and got["reason"] == smc.REASON_QUIET


def test_an_unknown_direction_fires_nothing_rather_than_raising():
    """Pinned-but-unauthorized, the same call F-S7-2 made for `trendline`."""
    covered = [20260910, 20260909]
    hits = {20260909: [], 20260910: ["NVDA"]}
    got = smc.would_fire(dict(EITHER, direction="sideways"),
                         covered_sessions=covered, hits_by_as_of=hits)
    assert got["fires"] is False and got["reason"] == smc.REASON_QUIET
    assert smc.mode_for("sideways") is None


def test_the_decision_is_ONE_ALERT_however_many_names_moved():
    """⛔ THE GRAIN, AND IT IS FORCED BY THE LEGACY DEDUP KEY. `screen_alerts_fired`
    is keyed (user_id, def_hash, as_of), so one session is at most one message.
    A per-symbol return would count a five-name night as five alerts and make
    `legacy_only` stop meaning 'an alert a member loses'."""
    covered = [20260910, 20260909]
    hits = {20260909: [], 20260910: ["A", "B", "C", "D", "E"]}
    got = smc.would_fire(EITHER, covered_sessions=covered, hits_by_as_of=hits)
    assert got["fires"] is True
    assert len(got["entered"]) == 5
    assert isinstance(got["fires"], bool), "the alert grain is one decision, not a count"
    # ...and the names are still carried, because the MESSAGE names them.
    assert got["named"] == ["entered:A", "entered:B", "entered:C",
                            "entered:D", "entered:E"]


def test_already_fired_for_this_session_is_DEDUPED_and_not_quiet():
    covered = [20260910, 20260909]
    hits = {20260909: [], 20260910: ["NVDA"]}
    first = smc.would_fire(EITHER, covered_sessions=covered, hits_by_as_of=hits)
    assert first["fires"] is True
    again = smc.would_fire(EITHER, covered_sessions=covered, hits_by_as_of=hits,
                           already_fired=[20260910])
    assert again["fires"] is False
    assert again["reason"] == smc.REASON_DEDUPED
    assert again["named"], "the names survive — only the DELIVERY is suppressed"


def test_symbols_are_upper_cased_and_deduped_like_the_store_does():
    """`record_hits` upper-cases and de-dupes; a lower-case hit would be a row
    that exists and never matches."""
    covered = [20260910, 20260909]
    hits = {20260909: ["aapl"], 20260910: ["AAPL", "aapl", " nvda "]}
    got = smc.would_fire(EITHER, covered_sessions=covered, hits_by_as_of=hits)
    assert got["entered"] == ["NVDA"] and got["exited"] == []


# ═════════════════════════════════════════════════════════════════════════════
# ⛔⛔ THE MIRROR RAIL — driven against the REAL legacy, on a real temp store
# ═════════════════════════════════════════════════════════════════════════════

def _drive_real_legacy(mode: str, *, user: str = "u1"):
    """Run the REAL `screen_alerts.run_nightly` and capture what it decided to
    deliver — without delivering anything.

    ⛔ `deliver` is the ONLY seam stubbed. The diff, the mode filter, the quiet
    skip, the per-user quota and the dedup write are all the real code, so what
    comes back is the legacy's actual decision — which is exactly what the mirror
    claims to reproduce (`lesson_rail_the_mirror_not_just_the_lane`).
    """
    screen_alerts.subscribe(user, H, "def-1", "My screen", mode=mode)
    sent = []
    receipt = screen_alerts.run_nightly(deliver=lambda **kw: sent.append(kw), tf=TF)
    return sent, receipt


def test_the_mirror_matches_the_real_run_nightly_for_every_mode(store):
    """⭐ Every mode, in one drive each, against the real store. A mirror without
    a rail is a second authority over one value."""
    _sweep(20260909, ["AAPL", "MSFT"])
    _sweep(20260910, ["AAPL", "NVDA"])          # NVDA entered, MSFT left

    for mode, params, want_in, want_out in (
            ("both", EITHER, ["NVDA"], ["MSFT"]),
            ("entry", ENTERED, ["NVDA"], []),
            ("exit", LEFT, [], ["MSFT"])):
        sent, receipt = _drive_real_legacy(mode, user=f"u-{mode}")
        mine = [k for k in sent if k["extra_data"]["def_hash"] == H]
        assert len(mine) == 1, (
            f"control: the real legacy really did decide to alert for {mode}: {receipt}")
        assert mine[0]["extra_data"]["entered"] == want_in
        assert mine[0]["extra_data"]["exited"] == want_out
        assert mine[0]["extra_data"]["as_of"] == 20260910

        covered, hits = _inputs(None)
        mirrored = cmp_.legacy_would_fire(params, covered_sessions=covered,
                                          hits_by_as_of=hits)
        assert mirrored["fires"] is True
        assert mirrored["entered"] == want_in, f"mirror disagrees for {mode}"
        assert mirrored["exited"] == want_out, f"mirror disagrees for {mode}"
        assert mirrored["as_of"] == 20260910


def test_the_mirror_rail_CAN_FAIL(store):
    """⛔ THE CONTROL ON THE MIRROR RAIL. If the driver silently decided nothing,
    the assertions above would compare two empty answers and pass. This proves
    the driver distinguishes a firing decision from a non-firing one — on the
    same store, in the same run, with only the DATA changed."""
    _sweep(20260909, ["AAPL"])
    _sweep(20260910, ["AAPL"])                  # membership unchanged

    sent, receipt = _drive_real_legacy("both", user="u-quiet")
    assert [k for k in sent if k["extra_data"]["def_hash"] == H] == [], (
        f"an unchanged screen must send nothing: {receipt}")
    assert receipt["skipped_quiet"] >= 1, (
        "the legacy reached its quiet branch — that is the state being mirrored")

    covered, hits = _inputs(None)
    mirrored = cmp_.legacy_would_fire(EITHER, covered_sessions=covered,
                                      hits_by_as_of=hits)
    assert mirrored["fires"] is False and mirrored["reason"] == smc.REASON_QUIET


def test_the_mirror_matches_the_real_NO_PREVIOUS_answer(store):
    """⛔ FINDING A, THROUGH THE MIRROR. One covered session, and the legacy's
    receipt says `no_previous` while nothing is sent. The mirror must say
    `no_previous` too — not `quiet`, which would make a vanished window look
    like a still market."""
    _sweep(20260910, ["AAPL", "NVDA"])
    sent, receipt = _drive_real_legacy("both", user="u-nop")
    assert [k for k in sent if k["extra_data"]["def_hash"] == H] == []
    assert receipt["no_previous"] == 1 and receipt["compared"] == 0, (
        f"control: the legacy really did take its no_previous branch: {receipt}")

    covered, hits = _inputs(None)
    assert covered == [20260910]
    mirrored = cmp_.legacy_would_fire(EITHER, covered_sessions=covered,
                                      hits_by_as_of=hits)
    assert mirrored["reason"] == smc.REASON_NO_PREVIOUS
    assert mirrored["reason"] != smc.REASON_QUIET


def test_the_mirror_matches_the_real_DEDUP(store):
    """A second run over the same session must send nothing — the legacy's
    `skipped_dedup`, and the mirror's `REASON_DEDUPED`."""
    _sweep(20260909, ["AAPL"])
    _sweep(20260910, ["AAPL", "NVDA"])

    sent1, r1 = _drive_real_legacy("both", user="u-dedup")
    assert r1["sent"] == 1 and len(sent1) == 1, f"control: the first run sent one: {r1}"
    sent2 = []
    r2 = screen_alerts.run_nightly(deliver=lambda **kw: sent2.append(kw), tf=TF)
    assert sent2 == [] and r2["skipped_dedup"] == 1, (
        f"the legacy dedups at (user, def, session): {r2}")

    covered, hits = _inputs(None)
    mirrored = cmp_.legacy_would_fire(EITHER, covered_sessions=covered,
                                      hits_by_as_of=hits, already_fired=[20260910])
    assert mirrored["fires"] is False and mirrored["reason"] == smc.REASON_DEDUPED


def test_dark_and_legacy_AGREE_on_the_real_store(store):
    """⭐ The point of a mirror: on the same inputs, the two sides answer the
    same. A disagreement here would be manufactured by the harness."""
    _sweep(20260909, ["AAPL", "MSFT"])
    _sweep(20260910, ["AAPL", "NVDA"])
    covered, hits = _inputs(None)
    dark = smc.would_fire(EITHER, covered_sessions=covered, hits_by_as_of=hits)
    legacy = cmp_.legacy_would_fire(EITHER, covered_sessions=covered, hits_by_as_of=hits)
    assert dark["fires"] == legacy["fires"] is True
    assert dark["named"] == legacy["named"]


# ═════════════════════════════════════════════════════════════════════════════
# The forward-only harness
# ═════════════════════════════════════════════════════════════════════════════

def test_a_tick_where_both_alert_counts_agreed_and_nothing_else(db):
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL"], 20260910: ["AAPL", "NVDA"]}
    t = cmp_.observe("p1", EITHER, DAY, covered_sessions=covered,
                     hits_by_as_of=hits, db_path=db)
    assert t == {"agreed": 1, "new_only": 0, "legacy_only": 0, "not_comparable": 0,
                 "drift_new_only": 0, "drift_legacy_only": 0}


def test_a_quiet_NIGHT_records_NO_outcome_at_all(db):
    """⛔ Neither side alerting is not an outcome. On a NIGHTLY clock most nights
    are quiet, and counting them as `agreed` would drown every real
    disagreement and make the result a function of how often the market moved."""
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL"], 20260910: ["AAPL"]}
    t = cmp_.observe("p1", EITHER, DAY, covered_sessions=covered,
                     hits_by_as_of=hits, db_path=db)
    assert t["agreed"] == t["new_only"] == t["legacy_only"] == t["not_comparable"] == 0
    r = cmp_.report("p1", db_path=db)
    assert r["observed"] == 0 and r["status"] == "QUIET"
    assert r["reasons"] == {smc.REASON_QUIET: 1}


def test_a_vanished_window_is_NOT_COMPARABLE_and_never_quiet(db):
    """⛔⛔ FINDING A, IN THE HARNESS. Both sides answer nothing for the SAME
    reason — the diff could not be taken — and calling that agreement is exactly
    the flattering error this design exists to avoid."""
    t = cmp_.observe("p1", EITHER, DAY, covered_sessions=[20260910],
                     hits_by_as_of={20260910: ["AAPL"]}, db_path=db)
    assert t["not_comparable"] == 1
    assert t["agreed"] == 0
    r = cmp_.report("p1", db_path=db)
    assert r["status"] == "OBSERVED", (
        "a not-comparable tick IS an observation — the harness saw something and "
        "must not report it as a quiet run")
    assert r["reasons"] == {smc.REASON_NO_PREVIOUS: 1}


def test_an_UNDECLARED_session_is_NOT_COMPARABLE_finding_Bs_structural_refusal(db):
    t = cmp_.observe("p1", EITHER, DAY, covered_sessions=[20260910, 20260909],
                     hits_by_as_of={20260910: ["AAPL"]}, db_path=db)
    assert t["not_comparable"] == 1
    assert cmp_.report("p1", db_path=db)["reasons"] == {smc.REASON_UNDECLARED_SESSION: 1}


def test_the_four_outcomes_are_never_collapsed_into_a_rate(db):
    r = cmp_.report("nothing-observed", db_path=db)
    for k in ("agreed", "new_only", "legacy_only", "not_comparable"):
        assert k in r
    assert not any("rate" in k or "pct" in k for k in r), (
        "a pass rate answers a question nobody asked: legacy_only and new_only "
        "are different defects for different members")


def test_NO_DATA_and_QUIET_and_NOT_COMPARABLE_are_THREE_different_facts(db):
    """⛔ An empty store prints four zeroes and reads exactly like perfect
    agreement — and for a NIGHTLY diff a broken sweep and a still market are
    otherwise the same observation."""
    empty = cmp_.report("never-ticked", db_path=db)
    assert empty["status"] == "NO DATA" and empty["spans"] == 0

    cmp_.observe("quiet", EITHER, DAY, covered_sessions=[20260910, 20260909],
                 hits_by_as_of={20260909: ["AAPL"], 20260910: ["AAPL"]}, db_path=db)
    quiet = cmp_.report("quiet", db_path=db)

    cmp_.observe("gone", EITHER, DAY, covered_sessions=[20260910],
                 hits_by_as_of={20260910: ["AAPL"]}, db_path=db)
    gone = cmp_.report("gone", db_path=db)

    # Identical four-outcome ARITHMETIC in two of the three, different facts.
    assert (empty["agreed"], empty["new_only"], empty["legacy_only"]) == \
           (quiet["agreed"], quiet["new_only"], quiet["legacy_only"]) == (0, 0, 0)
    assert len({empty["status"], quiet["status"], gone["status"]}) == 3
    assert empty["reasons"] == {}
    assert quiet["reasons"] == {smc.REASON_QUIET: 1}
    assert gone["reasons"] == {smc.REASON_NO_PREVIOUS: 1}


def test_the_report_LEADS_with_what_it_observed(db):
    """⛔ `observed` and `status` before any count. This type is the one where it
    matters most — a quiet market and a broken sweep look identical."""
    keys = list(cmp_.report("p1", db_path=db))
    assert keys[:3] == ["predicate_id", "observed", "status"], keys


def test_LEGACY_ONLY_is_an_alert_the_member_LOSES(db):
    """⭐ THE COLUMN THAT MATTERS, produced rather than described: a dark rule
    narrowed to `entered` against a legacy subscription of `either` loses the
    exit alert entirely on a night when only an exit happened."""
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL", "MSFT"], 20260910: ["AAPL"]}   # MSFT left, nothing entered

    dark = smc.would_fire(ENTERED, covered_sessions=covered, hits_by_as_of=hits)
    legacy = cmp_.legacy_would_fire(EITHER, covered_sessions=covered, hits_by_as_of=hits)
    assert dark["fires"] is False and legacy["fires"] is True, (
        "control: the two rules really do disagree on this night")

    # Recorded through a monkeypatched dark side so the harness sees exactly
    # that disagreement without a legacy change.
    class _Narrowed:
        @staticmethod
        def would_fire(_params, **kw):
            return smc.would_fire(ENTERED, **kw)

    import unittest.mock as _mock
    with _mock.patch.object(cmp_, "_smc", _Wrap(_Narrowed)):
        t = cmp_.observe("p-loss", EITHER, DAY, covered_sessions=covered,
                         hits_by_as_of=hits, db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 1, "not_comparable": 0,
                 "drift_new_only": 0, "drift_legacy_only": 0}


class _Wrap:
    """A stand-in for the type module that narrows ONLY `would_fire`.

    ⛔ Everything else must still come from the real module — a wholesale fake
    would let the harness pass against a module that no longer exists."""

    def __init__(self, override):
        self._override = override

    def __getattr__(self, name):
        if name == "would_fire":
            return self._override.would_fire
        return getattr(smc, name)


def test_NEW_ONLY_is_an_alert_the_member_STARTS_getting(db):
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL", "MSFT"], 20260910: ["AAPL"]}

    class _Widened:
        @staticmethod
        def would_fire(_params, **kw):
            return smc.would_fire(EITHER, **kw)

    import unittest.mock as _mock
    with _mock.patch.object(cmp_, "_smc", _Wrap(_Widened)):
        t = cmp_.observe("p-gain", ENTERED, DAY, covered_sessions=covered,
                         hits_by_as_of=hits, db_path=db)
    assert t["new_only"] == 1 and t["legacy_only"] == 0 and t["agreed"] == 0


def test_SYMBOL_DRIFT_is_counted_BESIDE_the_four_and_never_inside_them(db):
    """⭐ An alert both rules would send can still carry different names. The
    four outcomes are structurally unable to see that; folding it into
    `legacy_only` would overstate the loss, and dropping it would hide a member
    being told about the wrong stock."""
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL"], 20260910: ["AAPL", "NVDA", "MSFT"]}

    class _Partial:
        @staticmethod
        def would_fire(_params, **kw):
            out = smc.would_fire(EITHER, **kw)
            out = dict(out)
            out["entered"] = [s for s in out["entered"] if s != "MSFT"]
            out["named"] = [f"entered:{s}" for s in out["entered"]]
            return out

    import unittest.mock as _mock
    with _mock.patch.object(cmp_, "_smc", _Wrap(_Partial)):
        t = cmp_.observe("p-drift", EITHER, DAY, covered_sessions=covered,
                         hits_by_as_of=hits, db_path=db)
    assert t["agreed"] == 1, "both sides still send the alert"
    assert t["legacy_only"] == 0, "no alert was lost — only a name"
    assert t["drift_legacy_only"] == 1 and t["drift_new_only"] == 0

    r = cmp_.report("p-drift", db_path=db)
    assert r["agreed"] == 1 and r["legacy_only"] == 0
    assert r["drift_legacy_only"] == 1
    assert "never folded into the four outcomes" in r["drift_grain"]


def test_the_report_STATES_WHAT_IT_CANNOT_SEE_every_time(db):
    r = cmp_.report("p1", db_path=db)
    assert r["blind_spots"], "a report that names no blind spot has stopped looking"
    joined = " ".join(r["blind_spots"])
    assert "screen_alert_subs" in joined, (
        "the unknown that decides whether this comparison can observe anything "
        "is the member count, and it must be stated")
    assert "MAX_PER_USER" in joined
    assert "HARNESS-ARMED" in joined
    assert "ONCE A NIGHT" in joined
    assert "scan_store.prune" in joined


def test_the_report_says_the_clock_ticks_once_a_night(db):
    """⚠️ Five trading sessions is five comparisons per subscribed definition,
    not five hundred. A small `n` must not read as agreement."""
    r = cmp_.report("p1", db_path=db)
    assert "NIGHTLY" in r["clock"]
    assert r["min_sessions_for_verdict"] == 5


def test_a_parameter_change_RESETS_THE_CLOCK_into_not_comparable(db):
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL"], 20260910: ["AAPL", "NVDA"]}
    cmp_.observe("p1", EITHER, DAY, covered_sessions=covered, hits_by_as_of=hits, db_path=db)
    cmp_.observe("p1", EITHER, DAY2, covered_sessions=covered, hits_by_as_of=hits, db_path=db)
    before = cmp_.report("p1", db_path=db)
    assert before["agreed"] == 2 and before["not_comparable"] == 0

    cmp_.observe("p1", ENTERED, DAY2, covered_sessions=covered,
                 hits_by_as_of=hits, db_path=db)
    after = cmp_.report("p1", db_path=db)
    assert after["not_comparable"] == 2, "the pre-change ticks are DISCARDED, never carried"
    assert after["agreed"] == 1, "only the post-change tick counts as agreement"
    assert after["spans"] == 2


def test_repointing_the_predicate_at_another_SCREEN_resets_the_clock():
    """⛔ `definition_id` is the load-bearing member of the fingerprint: a
    predicate re-pointed at a different screen is a different question wearing
    the same predicate id, and its old ticks describe a screen nobody watches."""
    other = dict(EITHER, definition_id="sha256:" + "b" * 64)
    assert smc.predicate_fingerprint(EITHER) != smc.predicate_fingerprint(other)


def test_the_fingerprint_ignores_things_that_do_not_decide_firing():
    assert smc.predicate_fingerprint(EITHER) == \
        smc.predicate_fingerprint(dict(EITHER, dedup_grain="something-else"))


def test_the_timeframe_is_in_the_fingerprint():
    assert smc.predicate_fingerprint(EITHER) != \
        smc.predicate_fingerprint(dict(EITHER, timeframe="W"))


def test_opening_a_span_is_idempotent_per_tick(db):
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL"], 20260910: ["AAPL", "NVDA"]}
    for _ in range(4):
        cmp_.observe("p1", EITHER, DAY, covered_sessions=covered,
                     hits_by_as_of=hits, db_path=db)
    assert cmp_.report("p1", db_path=db)["spans"] == 1


def test_sessions_are_counted_by_the_TICKS_market_date_not_wall_clock(db):
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL"], 20260910: ["AAPL", "NVDA"]}
    for d in (DAY, DAY, DAY2):
        cmp_.observe("p1", EITHER, d, covered_sessions=covered,
                     hits_by_as_of=hits, db_path=db)
    r = cmp_.report("p1", db_path=db)
    assert r["sessions_covered"] == [DAY, DAY2]
    assert r["verdict_ready"] is False


def test_verdict_ready_is_its_OWN_field_never_a_pass_fail(db):
    covered = [20260910, 20260909]
    hits = {20260909: ["AAPL"], 20260910: ["AAPL", "NVDA"]}
    for i in range(5):
        cmp_.observe("p1", EITHER, f"2026-09-{11 + i:02d}", covered_sessions=covered,
                     hits_by_as_of=hits, db_path=db)
    r = cmp_.report("p1", db_path=db)
    assert r["verdict_ready"] is True and r["agreed"] == 5


# --- §2a item 4: the liveness stamp ------------------------------------------

def test_the_heartbeat_beats_on_a_QUIET_night_and_on_a_VANISHED_window(db):
    """⛔ *A heartbeat that only beats on success is a success detector.* On a
    nightly clock a sweep that died on its first morning is otherwise
    indistinguishable at the end of the week from one that ran every night."""
    assert cmp_.heartbeat(db_path=db) is None

    cmp_.observe("p1", EITHER, DAY, covered_sessions=[20260910, 20260909],
                 hits_by_as_of={20260909: ["AAPL"], 20260910: ["AAPL"]}, db_path=db)
    assert cmp_.heartbeat(db_path=db)["ticks"] == 1

    cmp_.observe("p1", EITHER, DAY2, covered_sessions=[20260910],
                 hits_by_as_of={20260910: ["AAPL"]}, db_path=db)
    hb = cmp_.heartbeat(db_path=db)
    assert hb["ticks"] == 2, "the no_previous tick must beat too"
    assert hb["last_market_date"] == DAY2 and hb["last_tick_at"] > 0
    assert cmp_.report("p1", db_path=db)["heartbeat"]["ticks"] == 2


# ═════════════════════════════════════════════════════════════════════════════
# §2a item 3 — what calls this evaluator
# ═════════════════════════════════════════════════════════════════════════════

#: ⛔ CODE, NEVER PROSE — and in this package the prose is not only in
#: docstrings. `PARAMS_SCHEMA`, `BLIND_SPOTS` and the three grain declarations
#: are documentation that happens to live in string literals, and
#: `FORBIDDEN_SESSION_SOURCE`'s entire job is to NAME the table this type must
#: not read. A search that saw them would report the warning as the violation.
_PROSE_CONSTANTS = ("PARAMS_SCHEMA", "BLIND_SPOTS", "FORBIDDEN_SESSION_SOURCE",
                    "OUTCOME_GRAIN", "DRIFT_GRAIN", "CLOCK")


def _code_only(path: pathlib.Path) -> str:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id in _PROSE_CONSTANTS
                for t in node.targets):
            node.value = ast.Constant(value="<prose>")
    return ast.unparse(ast.fix_missing_locations(tree))


def test_the_stripper_sees_code_and_not_prose():
    """⛔ THE CONTROL FOR EVERY ABSENCE ASSERTION BELOW. Without it, a stripper
    that returned '' would make all of them pass over nothing."""
    code = _code_only(_COMPARE)
    raw = _COMPARE.read_text(encoding="utf-8")
    for needle in ("screen_alerts", "scan_store.prune", "MAX_PER_USER"):
        assert needle in raw, f"{needle} is not in the prose — the control is stale"
        assert needle not in code, f"{needle} survived the stripper"
    assert "def observe" in code and "def report" in code
    assert "_smc.would_fire" in code
    assert len(code) > 500


def test_the_harness_is_the_only_caller_of_would_fire():
    """⛔⛔ §2a ITEM 3 AT A CHECKPOINT WITH NO WIRE YET.

    `price-level` merged with the type registered, the projection built, the
    harness built, **eighteen tests green and nothing calling the evaluator** —
    and a week of empty rows would have read exactly like five sessions of
    agreement. At CP1-CP2 the honest answer is *the harness calls it, directly,
    over predicates it arms itself*.

    This rail fails if a second caller appears (a wire added without an approval
    line) AND if the harness stops calling it (the evaluator gone dark for real).
    """
    callers = []
    root = _REPO / "api"
    for p in root.rglob("*.py"):
        if p.name == "scan_membership_change.py":
            continue
        try:
            code = _code_only(p)
        except SyntaxError:
            continue
        if "scan_membership_change.would_fire" in code or "_smc.would_fire" in code:
            callers.append(str(p.relative_to(_REPO)).replace("\\", "/"))
    assert callers == ["api/services/alert_taxonomy/scan_membership_change_compare.py"], (
        f"expected the harness to be the ONLY caller; found {callers}")


def test_the_caller_rail_is_non_vacuous():
    """⛔ An empty walk would make almost any assertion pass. This proves the walk
    really reaches files and the stripper really keeps code."""
    seen = list((_REPO / "api").rglob("*.py"))
    assert len(seen) > 100, f"the module walk found almost nothing ({len(seen)})"
    code = _code_only(_COMPARE)
    assert "_smc.would_fire" in code
    assert "would_fire" in _COMPARE.read_text(encoding="utf-8")


def test_the_harness_imports_no_delivery_and_no_legacy_module():
    code = _code_only(_COMPARE)
    for forbidden in ("deliver_alert_payload", "watchlist_alert_service",
                      "screen_alerts", "run_nightly", "diff_for",
                      "scan_store", "snapshot_db", "scan_hits",
                      "screen_alerts_fired", "screen_alert_subs"):
        assert forbidden not in code, f"{forbidden} reached the harness's CODE"


def test_there_is_no_scheduler_entry_and_no_flag_for_this_type():
    """⛔ REGISTRATION IS NOT ACTIVATION, and putting a dark evaluator on a tick
    is not the FLIP. CP1-CP2 add neither."""
    main = _code_only(_REPO / "api" / "main.py")
    assert "scan_membership_change" not in main
    for path in (_MODULE, _COMPARE):
        code = _code_only(path)
        assert "add_job" not in code and "CronTrigger" not in code
        assert "os.environ" not in code and "getenv" not in code
        assert "ENABLED" not in code


def test_the_harness_has_no_replay_and_says_so():
    code = _code_only(_COMPARE)
    assert "replay" not in code.lower(), "a replay path reached the harness's CODE"
    assert "NO REPLAY" in (cmp_.__doc__ or "")
