"""GATE-S7-CATALYST-MATCH Checkpoint 2 — the dark evaluator and the
forward-only harness, over HARNESS-ARMED predicates only.

⛔ No delivery. No projection of member rows. No legacy change.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services.alert_taxonomy import catalyst_match as cm
from api.services.alert_taxonomy import catalyst_match_compare as cmp_
from api.services.alert_taxonomy import db as _db

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MODULE = _REPO / "api" / "services" / "alert_taxonomy" / "catalyst_match.py"
_COMPARE = _REPO / "api" / "services" / "alert_taxonomy" / "catalyst_match_compare.py"

DAY = "2026-09-11"
DAY2 = "2026-09-12"


def _rows(*specs):
    """displayed rows, in the engine's own shape."""
    out = []
    for t, grade, tag, ctype in specs:
        out.append({"ticker": t, "grade": grade, "tag": tag, "catalyst_type": ctype})
    return out


WATCH_PRED = {
    "match_rule": cm.RULE_WATCHLIST,
    "member_set": cm.SET_WATCHLISTS,
    "entity_ref": None,
    "cohort": cm.COHORT_SELF,
    "min_grade": None,
    "catalyst_types": None,
    "tag": None,
    "displayed_only": True,
    "dedup_grain": cm.DEDUP_GRAIN,
}

GRADE_PRED = dict(WATCH_PRED, match_rule=cm.RULE_GRADE, cohort=cm.COHORT_ADMINS)


@pytest.fixture()
def db(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    return p


# ─────────────────────────────────────────────────────────────────────────────
# The evaluator
# ─────────────────────────────────────────────────────────────────────────────

def test_the_watchlist_rule_fires_on_the_intersection_and_nothing_else():
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"), ("AMD", "B", "News", "Analyst"))
    got = cm.would_fire(WATCH_PRED, displayed=rows, member_tickers=["NVDA", "TSLA"])
    assert got == ["NVDA"]


def test_the_watchlist_rule_needs_no_grade_at_all():
    """⛔ The legacy watchlist rule reads NO grade. A dark rule that quietly
    required one would lose an alert for every ungraded row."""
    rows = _rows(("NVDA", None, "News", None))
    assert cm.would_fire(WATCH_PRED, displayed=rows, member_tickers=["NVDA"]) == ["NVDA"]


def test_the_grade_rule_fires_WITHOUT_a_watchlist_which_is_its_whole_point():
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"), ("AMD", "C", "News", "Momentum"))
    got = cm.would_fire(GRADE_PRED, displayed=rows, member_tickers=[], is_admin=True)
    assert got == ["NVDA"], "grade A is in the legacy must-know set; grade C is not"


def test_the_grade_rule_refuses_a_non_admin_and_that_guard_is_load_bearing():
    """⛔ THE ONE GUARD THAT KEEPS A DARK COMPARISON FROM DESCRIBING A
    SUBSCRIBER'S INBOX. `_collect_admin_user_ids` is the legacy cohort."""
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    assert cm.would_fire(GRADE_PRED, displayed=rows, is_admin=False) == []
    assert cm.would_fire(GRADE_PRED, displayed=rows, is_admin=True) == ["NVDA"]


def test_already_fired_is_PER_RULE_since_F_S7_5(db):
    """⚰️ THIS ASSERTED THE CROSS-RULE SUPPRESSION AND CALLED IT "behaviour to
    REPRODUCE rather than fix". The retired body:

        first = cm.would_fire(WATCH_PRED, displayed=rows, member_tickers=["NVDA"])
        second = cm.would_fire(GRADE_PRED, displayed=rows, is_admin=True,
                               already_fired=first)
        assert second == [], "the grade alert must be suppressed ..."

    ⛔ That reading was right about the MIGRATION and wrong about the BUG. It was
    a live production defect (F-S7-5) and **absorbing it would have made it
    permanent and invisible** — the dark rule reproduces it, the comparison
    reports `agreed`, and the defect becomes a specification. It was fixed in the
    legacy path FIRST (`store.mustknow_dedup_key`), so this type now mirrors the
    FIXED behaviour.

    ⭐ `already_fired` is therefore PER-RULE: a name claimed by the watchlist
    rule no longer silences the grade rule.
    """
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    first = cm.would_fire(WATCH_PRED, displayed=rows, member_tickers=["NVDA"])
    assert first == ["NVDA"]

    # The grade rule's own namespace is empty, so it fires too.
    second = cm.would_fire(GRADE_PRED, displayed=rows, is_admin=True, already_fired=[])
    assert second == ["NVDA"], "since F-S7-5 both rules fire for one (user, ticker, date)"

    # ...and each rule still dedups WITHIN itself.
    assert cm.would_fire(GRADE_PRED, displayed=rows, is_admin=True,
                         already_fired=second) == []


def test_the_dedup_grain_is_declared_PER_RULE():
    """⛔ A predicate naming the wrong grain would model the pre-F-S7-5 collision
    and reintroduce it as the dark rule's specification."""
    assert cm.dedup_grain_for(cm.RULE_GRADE) == cm.DEDUP_GRAIN_MUSTKNOW
    assert cm.dedup_grain_for(cm.RULE_WATCHLIST) == cm.DEDUP_GRAIN
    assert cm.DEDUP_GRAIN != cm.DEDUP_GRAIN_MUSTKNOW
    assert set(cm.DEDUP_GRAINS) == {cm.DEDUP_GRAIN, cm.DEDUP_GRAIN_MUSTKNOW}


def test_the_mirror_agrees_with_the_FIXED_legacy_on_a_watched_grade_A_name(monkeypatch):
    """⭐ THE POINT OF FIXING BOTH IN ONE PR: after the fix, dark and legacy must
    still AGREE. Driven against the REAL legacy function with delivery and the
    dedup store stubbed, keyed exactly as `try_record_alert` keys it."""
    from api.services.catalyst import engine as ce
    from api.services import watchlist_alert_service as wal
    fired, delivered = set(), []

    def _try(u, t, d):
        k = (u, (t or "").upper(), d)
        if k in fired:
            return False
        fired.add(k)
        return True

    monkeypatch.setattr(wal, "deliver_alert_payload",
                        lambda **kw: delivered.append((kw["source"], kw["sym"])))
    monkeypatch.setattr(ce.store, "try_record_alert", _try)
    monkeypatch.setattr(ce, "_collect_user_watchlist_tickers", lambda: {"a1": {"NVDA"}})
    monkeypatch.setattr(ce, "_collect_admin_user_ids", lambda: ["a1"])
    monkeypatch.setenv("CATALYST_ALERTS_ENABLED", "1")
    monkeypatch.setenv("CATALYST_MUSTKNOW_ALERTS_ENABLED", "1")
    monkeypatch.delenv("CATALYST_MUSTKNOW_GRADES", raising=False)

    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    ce._fire_catalyst_alerts(rows, DAY)
    ce._fire_mustknow_alerts(rows, DAY)
    real_sources = sorted(src for (src, _s) in delivered)
    assert real_sources == ["catalyst_alert", "catalyst_mustknow"], (
        "control: the fixed legacy really does deliver both")

    # the dark rule, on the same inputs, per rule
    dark_watch = cm.would_fire(WATCH_PRED, displayed=rows, member_tickers=["NVDA"])
    dark_grade = cm.would_fire(GRADE_PRED, displayed=rows, is_admin=True)
    assert dark_watch == ["NVDA"] and dark_grade == ["NVDA"], (
        "dark and legacy disagree after the fix — the mirror was not updated with it")


def test_a_ticker_appearing_twice_alerts_once():
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"), ("NVDA", "A", "News", "Analyst"))
    assert cm.would_fire(WATCH_PRED, displayed=rows, member_tickers=["NVDA"]) == ["NVDA"]


def test_would_fire_returns_a_LIST_not_a_boolean_and_that_is_forced_by_the_legacy():
    """⛔ One refresh fires once PER MATCHING TICKER. A boolean would collapse
    "three names alerted" and "one name alerted" into one outcome and make the
    comparison structurally unable to see a member's inbox double."""
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"), ("AMD", "A", "News", "Analyst"))
    got = cm.would_fire(WATCH_PRED, displayed=rows, member_tickers=["NVDA", "AMD"])
    assert isinstance(got, list) and sorted(got) == ["AMD", "NVDA"]


# --- the row filters ---------------------------------------------------------

def test_catalyst_types_matches_CASE_INSENSITIVELY_because_it_is_model_output():
    """⛔⛔ F-S7-CM-1 ITEM 3. `synthesize.py` passes `catalyst_type` through with
    no normalisation. An exact-match filter silently drops `fda`."""
    pred = dict(WATCH_PRED, catalyst_types=["FDA"])
    for spelling in ("FDA", "fda", " Fda "):
        rows = _rows(("NVDA", "A", "Catalyst", spelling))
        assert cm.would_fire(pred, displayed=rows, member_tickers=["NVDA"]) == ["NVDA"], spelling


def test_catalyst_types_does_NOT_admit_a_label_outside_the_filter():
    pred = dict(WATCH_PRED, catalyst_types=["FDA"])
    rows = _rows(("NVDA", "A", "Catalyst", "M&A"))
    assert cm.would_fire(pred, displayed=rows, member_tickers=["NVDA"]) == []


def test_an_UNGRADED_row_is_never_hidden_by_a_min_grade_filter():
    """⛔ `_normalize_grade`'s own docstring: None means "keep, unknown". The
    legacy path never hides an ungraded row, so neither may a min_grade
    predicate — coercing None to "worse than C" would lose real alerts."""
    pred = dict(WATCH_PRED, min_grade="A")
    rows = _rows(("NVDA", None, "News", None))
    assert cm.would_fire(pred, displayed=rows, member_tickers=["NVDA"]) == ["NVDA"]


def test_min_grade_orders_A_above_B_above_C():
    rows = _rows(("A1", "A", "News", None), ("B1", "B", "News", None), ("C1", "C", "News", None))
    mine = ["A1", "B1", "C1"]
    assert cm.would_fire(dict(WATCH_PRED, min_grade="A"), displayed=rows,
                         member_tickers=mine) == ["A1"]
    assert cm.would_fire(dict(WATCH_PRED, min_grade="B"), displayed=rows,
                         member_tickers=mine) == ["A1", "B1"]
    assert cm.would_fire(dict(WATCH_PRED, min_grade="C"), displayed=rows,
                         member_tickers=mine) == ["A1", "B1", "C1"]


def test_a_member_set_the_legacy_query_cannot_reach_fires_NOTHING():
    """Pinned-but-unauthorized, the same call F-S7-2 made for `trendline`:
    it evaluates to nothing rather than raising."""
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    for other in (cm.SET_TAGS, cm.SET_POSITIONS, cm.SET_UCT20):
        pred = dict(WATCH_PRED, member_set=other)
        assert cm.would_fire(pred, displayed=rows, member_tickers=["NVDA"]) == [], other


def test_an_unknown_match_rule_fires_nothing_rather_than_raising():
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    assert cm.would_fire(dict(WATCH_PRED, match_rule="sentiment"),
                         displayed=rows, member_tickers=["NVDA"]) == []


# ─────────────────────────────────────────────────────────────────────────────
# ⛔⛔ THE MIRROR RAIL — the harness's legacy restatement is driven against the
# REAL legacy functions, with delivery and the dedup store stubbed out.
# ─────────────────────────────────────────────────────────────────────────────

def _drive_real_legacy(monkeypatch, fn_name, rows, *, users, admins=(), env=None):
    """Run the REAL `_fire_*` function and capture the (user, ticker) pairs it
    tried to alert on — without delivering anything and without touching
    `/data/catalysts.db`.

    ⛔ EVERY MUTATING AND DELIVERING EDGE IS STUBBED, and the stub for
    `try_record_alert` returns True so the function's own dedup does not hide a
    firing decision from us. What comes back is the set of decisions, which is
    exactly what the mirror claims to reproduce.
    """
    from api.services.catalyst import engine as ce
    from api.services import watchlist_alert_service as wal

    delivered = []
    monkeypatch.setattr(wal, "deliver_alert_payload",
                        lambda **kw: delivered.append((kw["user_id"], kw["sym"])))
    monkeypatch.setattr(ce.store, "try_record_alert", lambda u, t, d: True)
    monkeypatch.setattr(ce, "_collect_user_watchlist_tickers", lambda: users)
    monkeypatch.setattr(ce, "_collect_admin_user_ids", lambda: list(admins))
    for k, v in (env or {}).items():
        monkeypatch.setenv(k, v)
    getattr(ce, fn_name)(rows, DAY)
    return delivered


def test_the_mirror_matches_the_real_legacy_WATCHLIST_function(monkeypatch):
    """⭐ `lesson_rail_the_mirror_not_just_the_lane`. The harness restates the
    legacy rule read-only because the real one MUTATES and DELIVERS; a mirror
    without a rail is a second authority over one value."""
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"), ("AMD", "C", "News", "Momentum"),
                 ("TSLA", None, "Gapper", None))
    users = {"u1": {"NVDA", "TSLA"}}
    real = _drive_real_legacy(monkeypatch, "_fire_catalyst_alerts", rows, users=users,
                              env={"CATALYST_ALERTS_ENABLED": "1"})
    real_tickers = sorted(t for (_u, t) in real)

    mirrored = sorted(cmp_.legacy_would_fire(
        WATCH_PRED, displayed=rows, member_tickers=users["u1"]))
    assert mirrored == real_tickers, (
        f"mirror {mirrored} != the real function's decisions {real_tickers}")
    # ⛔ NON-VACUITY: the real function really did decide to fire on something.
    assert real_tickers, "the legacy driver fired on nothing — the rail proves nothing"


def test_the_mirror_matches_the_real_legacy_GRADE_function(monkeypatch):
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"), ("AMD", "B", "News", "Analyst"),
                 ("INTC", "C", "News", "Momentum"), ("TSLA", None, "Gapper", None))
    real = _drive_real_legacy(monkeypatch, "_fire_mustknow_alerts", rows,
                              users={}, admins=("admin1",),
                              env={"CATALYST_MUSTKNOW_ALERTS_ENABLED": "1"})
    real_tickers = sorted(t for (_u, t) in real)

    mirrored = sorted(cmp_.legacy_would_fire(GRADE_PRED, displayed=rows, is_admin=True))
    assert mirrored == real_tickers
    assert real_tickers == ["AMD", "NVDA"], (
        "the legacy must-know set is A,B — C and ungraded must not fire")


def test_the_mirror_rail_CAN_FAIL(monkeypatch):
    """⛔ THE CONTROL ON THE MIRROR RAIL. If the driver silently fired on
    nothing, both assertions above would compare two empty lists and pass. This
    proves the driver distinguishes a firing decision from a non-firing one."""
    rows = _rows(("INTC", "C", "News", "Momentum"))
    real = _drive_real_legacy(monkeypatch, "_fire_mustknow_alerts", rows,
                              users={}, admins=("admin1",),
                              env={"CATALYST_MUSTKNOW_ALERTS_ENABLED": "1"})
    assert real == [], "grade C must not reach the must-know rule"
    rows2 = _rows(("NVDA", "A", "Catalyst", "FDA"))
    real2 = _drive_real_legacy(monkeypatch, "_fire_mustknow_alerts", rows2,
                              users={}, admins=("admin1",),
                              env={"CATALYST_MUSTKNOW_ALERTS_ENABLED": "1"})
    assert [t for (_u, t) in real2] == ["NVDA"]


def test_the_mirror_FOLLOWS_the_env_var_not_the_default(monkeypatch):
    """⛔⛔ THE DEFECT THIS RAIL WAS ADDED FOR, FOUND BY A LIVE READ AFTER MERGE.

    `_fire_mustknow_alerts` reads `CATALYST_MUSTKNOW_GRADES` from the environment
    at call time. Read live on `web`, 2026-09-12: **`CATALYST_MUSTKNOW_GRADES=A`**
    — production is NARROWER than the "A,B" code default.

    ⚰️ For one commit the mirror answered from the CONSTANT, so against production
    it would have called every grade-B row `new_only` — **a disagreement
    manufactured by the harness, in the column that means "this member starts
    getting an alert they do not get today".** A harness whose headline number is
    its own misconfiguration is measuring its own plumbing.

    ⭐ A code default is not a configuration, and only a live read settles which
    one is running.
    """
    rows = _rows(("A1", "A", "Catalyst", "FDA"), ("B1", "B", "News", "Analyst"))

    # the code default
    monkeypatch.delenv("CATALYST_MUSTKNOW_GRADES", raising=False)
    assert cm.mustknow_grades() == ("A", "B")
    assert sorted(cmp_.legacy_would_fire(GRADE_PRED, displayed=rows, is_admin=True)) == ["A1", "B1"]
    assert sorted(cm.would_fire(GRADE_PRED, displayed=rows, is_admin=True)) == ["A1", "B1"]

    # PRODUCTION's actual value
    monkeypatch.setenv("CATALYST_MUSTKNOW_GRADES", "A")
    assert cm.mustknow_grades() == ("A",)
    assert cmp_.legacy_would_fire(GRADE_PRED, displayed=rows, is_admin=True) == ["A1"]
    assert cm.would_fire(GRADE_PRED, displayed=rows, is_admin=True) == ["A1"]

    # ⭐ AND BOTH SIDES MOVED TOGETHER, which is the only thing that keeps the
    # comparison honest: a tick under the production value reports NO
    # disagreement, where the constant-based mirror would have reported one.
    monkeypatch.setenv("CATALYST_MUSTKNOW_GRADES", "A")
    dark = set(cm.would_fire(GRADE_PRED, displayed=rows, is_admin=True))
    legacy = set(cmp_.legacy_would_fire(GRADE_PRED, displayed=rows, is_admin=True))
    assert dark == legacy and (dark - legacy) == set() and (legacy - dark) == set()


def test_the_env_read_is_at_CALL_TIME_not_import_time(monkeypatch):
    """⛔ A module-level capture would make the mirror correct only until somebody
    changed the variable — and correct-until-changed is how a mirror rots."""
    monkeypatch.setenv("CATALYST_MUSTKNOW_GRADES", "A")
    first = cm.mustknow_grades()
    monkeypatch.setenv("CATALYST_MUSTKNOW_GRADES", "A,B,C")
    second = cm.mustknow_grades()
    assert first == ("A",) and second == ("A", "B", "C")


def test_the_grade_mirror_matches_synthesize_s_normalizer():
    """The other mirror in this type: `_norm_grade` restates
    `synthesize._normalize_grade`. Driven against the real one."""
    from api.services.catalyst.synthesize import _normalize_grade
    for raw in ("A", "a", "B", "b ", "C", "c", "D", "", None, 0, "A+", "Grade A", 5, "b-"):
        assert cm._norm_grade(raw) == _normalize_grade(raw), raw


# ─────────────────────────────────────────────────────────────────────────────
# The forward-only harness
# ─────────────────────────────────────────────────────────────────────────────

def test_a_tick_where_both_agree_counts_agreed_and_nothing_else(db):
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    t = cmp_.observe("p1", WATCH_PRED, DAY, displayed=rows,
                     member_tickers=["NVDA"], db_path=db)
    assert t == {"agreed": 1, "new_only": 0, "legacy_only": 0}


def test_a_quiet_tick_records_NO_outcome_at_all(db):
    """⛔ Neither side firing is not an outcome. Counting quiet rows as `agreed`
    would drown every real disagreement and make the result a function of how
    many names the engine happened to display."""
    rows = _rows(("MSFT", "A", "Catalyst", "FDA"))
    t = cmp_.observe("p1", WATCH_PRED, DAY, displayed=rows,
                     member_tickers=["NVDA"], db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 0}
    r = cmp_.report("p1", db_path=db)
    assert r["observed"] == 0
    assert r["status"] == "QUIET"


def test_a_row_filter_the_legacy_does_not_have_shows_as_LEGACY_ONLY(db):
    """⭐ THE COLUMN THAT MATTERS. `legacy_only` is an alert a member LOSES at
    the flip. A `min_grade` the legacy watchlist rule does not apply produces
    exactly that, and it must never be collapsed into a pass rate."""
    rows = _rows(("NVDA", "C", "News", "Momentum"))
    t = cmp_.observe("p1", dict(WATCH_PRED, min_grade="A"), DAY, displayed=rows,
                     member_tickers=["NVDA"], db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 1}


def test_the_four_outcomes_are_never_collapsed_into_a_rate(db):
    r = cmp_.report("nothing-observed", db_path=db)
    for k in ("agreed", "new_only", "legacy_only", "not_comparable"):
        assert k in r
    assert not any("rate" in k or "pct" in k for k in r), (
        "a pass rate answers a question nobody asked: legacy_only and new_only "
        "are different defects for different members")


def test_NO_DATA_and_no_disagreement_are_DIFFERENT_facts(db):
    """⛔ §2a item 2's non-vacuity control. An empty store prints four zeroes
    and reads exactly like perfect agreement."""
    empty = cmp_.report("never-ticked", db_path=db)
    assert empty["status"] == "NO DATA"
    assert empty["spans"] == 0

    rows = _rows(("MSFT", "A", "Catalyst", "FDA"))
    cmp_.observe("quiet", WATCH_PRED, DAY, displayed=rows, member_tickers=["NVDA"], db_path=db)
    quiet = cmp_.report("quiet", db_path=db)
    assert quiet["status"] == "QUIET"
    assert quiet["spans"] == 1
    # Same four zeroes, different fact — and the report says which.
    assert (empty["agreed"], empty["new_only"], empty["legacy_only"]) == \
           (quiet["agreed"], quiet["new_only"], quiet["legacy_only"]) == (0, 0, 0)
    assert empty["status"] != quiet["status"]


def test_the_report_STATES_WHAT_IT_CANNOT_SEE_every_time(db):
    r = cmp_.report("p1", db_path=db)
    assert r["blind_spots"], "a report that names no blind spot has stopped looking"
    joined = " ".join(r["blind_spots"])
    assert "CROSS-RULE SUPPRESSION" in joined
    assert "HARNESS-ARMED" in joined


def test_a_parameter_change_RESETS_THE_CLOCK_into_not_comparable(db):
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    cmp_.observe("p1", WATCH_PRED, DAY, displayed=rows, member_tickers=["NVDA"], db_path=db)
    cmp_.observe("p1", WATCH_PRED, DAY2, displayed=rows, member_tickers=["NVDA"], db_path=db)
    before = cmp_.report("p1", db_path=db)
    assert before["agreed"] == 2 and before["not_comparable"] == 0

    changed = dict(WATCH_PRED, min_grade="A")
    cmp_.observe("p1", changed, DAY2, displayed=rows, member_tickers=["NVDA"], db_path=db)
    after = cmp_.report("p1", db_path=db)
    assert after["not_comparable"] == 2, "the pre-change ticks are DISCARDED, never carried"
    assert after["agreed"] == 1, "only the post-change tick counts as agreement"
    assert after["spans"] == 2


def test_displayed_only_is_in_the_fingerprint_so_flipping_it_resets(db):
    """⛔ It changes which rows are eligible, so a predicate that flipped it
    mid-run would answer a different question inside the same span."""
    a = cm.predicate_fingerprint(WATCH_PRED)
    b = cm.predicate_fingerprint(dict(WATCH_PRED, displayed_only=False))
    assert a != b


def test_the_fingerprint_ignores_things_that_do_not_decide_firing():
    assert cm.predicate_fingerprint(WATCH_PRED) == \
           cm.predicate_fingerprint(dict(WATCH_PRED, dedup_grain="something-else"))


def test_catalyst_types_order_does_not_reset_the_clock():
    assert cm.predicate_fingerprint(dict(WATCH_PRED, catalyst_types=["FDA", "M&A"])) == \
           cm.predicate_fingerprint(dict(WATCH_PRED, catalyst_types=["m&a", "fda"]))


def test_opening_a_span_is_idempotent_per_tick(db):
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    for _ in range(4):
        cmp_.observe("p1", WATCH_PRED, DAY, displayed=rows,
                     member_tickers=["NVDA"], db_path=db)
    assert cmp_.report("p1", db_path=db)["spans"] == 1


def test_sessions_are_counted_by_the_TICKS_market_date_not_wall_clock(db):
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    for d in (DAY, DAY, DAY2):
        cmp_.observe("p1", WATCH_PRED, d, displayed=rows,
                     member_tickers=["NVDA"], db_path=db)
    r = cmp_.report("p1", db_path=db)
    assert r["sessions_covered"] == [DAY, DAY2]
    assert r["verdict_ready"] is False
    assert r["min_sessions_for_verdict"] == 5


def test_verdict_ready_is_its_OWN_field_never_a_pass_fail(db):
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    for i in range(5):
        cmp_.observe("p1", WATCH_PRED, f"2026-09-{11 + i:02d}", displayed=rows,
                     member_tickers=["NVDA"], db_path=db)
    r = cmp_.report("p1", db_path=db)
    assert r["verdict_ready"] is True
    assert r["agreed"] == 5


# --- §2a item 4: the liveness stamp ------------------------------------------

def test_the_heartbeat_beats_on_a_QUIET_tick_too(db):
    """⛔ *A heartbeat that only beats on success is a success detector.* A sweep
    that died on its first morning is otherwise indistinguishable at the end of
    the week from one that ran every tick."""
    assert cmp_.heartbeat(db_path=db) is None
    quiet_rows = _rows(("MSFT", "A", "Catalyst", "FDA"))
    cmp_.observe("p1", WATCH_PRED, DAY, displayed=quiet_rows,
                 member_tickers=["NVDA"], db_path=db)
    hb = cmp_.heartbeat(db_path=db)
    assert hb["ticks"] == 1
    assert hb["last_market_date"] == DAY
    assert hb["last_tick_at"] > 0


def test_the_heartbeat_counts_every_tick_and_the_report_carries_it(db):
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    for d in (DAY, DAY, DAY2):
        cmp_.observe("p1", WATCH_PRED, d, displayed=rows,
                     member_tickers=["NVDA"], db_path=db)
    r = cmp_.report("p1", db_path=db)
    assert r["heartbeat"]["ticks"] == 3
    assert r["heartbeat"]["last_market_date"] == DAY2


# ─────────────────────────────────────────────────────────────────────────────
# §2a item 3 — what calls this evaluator
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
    """⛔⛔ §2a ITEM 3 AT A CHECKPOINT WITH NO WIRE YET.

    `price-level` merged with the type registered, the projection built, the
    harness built, **eighteen tests green and nothing calling the evaluator** —
    and a week of empty rows would have read exactly like five sessions of
    agreement. The question must be answered in writing at every checkpoint, and
    at CP1-CP2 the honest answer is *the harness calls it, directly, over
    predicates it arms itself*.

    This rail is the form that answer takes: it fails if a second caller appears
    (which would mean a wire was added without an approval line) AND it fails if
    the harness stops calling it (which would mean the evaluator went dark for
    real).
    """
    callers = []
    root = _REPO / "api"
    for p in root.rglob("*.py"):
        if p.name in ("catalyst_match.py",):
            continue
        try:
            code = _code_only(p)
        except SyntaxError:
            continue
        if "catalyst_match.would_fire" in code or "_cm.would_fire" in code:
            callers.append(str(p.relative_to(_REPO)).replace("\\", "/"))
    assert callers == ["api/services/alert_taxonomy/catalyst_match_compare.py"], (
        f"expected the harness to be the ONLY caller; found {callers}")


def test_the_caller_rail_is_non_vacuous():
    """⛔ Without this, a broken walk that visited nothing would make the
    assertion above pass with an empty list — except it asserts a NON-empty
    list, which is itself the control. This proves the walk really reaches
    files and really strips prose."""
    root = _REPO / "api"
    seen = [p for p in root.rglob("*.py")]
    assert len(seen) > 100, "the module walk found almost nothing"
    code = _code_only(_COMPARE)
    assert "_cm.would_fire" in code
    raw = _COMPARE.read_text(encoding="utf-8")
    assert "would_fire" in raw


def test_there_is_no_scheduler_entry_and_no_flag_for_this_type():
    """⛔ REGISTRATION IS NOT ACTIVATION, and putting a dark evaluator on a tick
    is not the FLIP. CP1-CP2 add neither."""
    main = _code_only(_REPO / "api" / "main.py")
    assert "catalyst_match" not in main
    for path in (_MODULE, _COMPARE):
        code = _code_only(path)
        assert "add_job" not in code
        assert "CronTrigger" not in code
        if path is _COMPARE:
            assert "os.environ" not in code and "getenv" not in code, (
                f"{path.name} reads an env var — the harness has none of its own")
        else:
            # ⛔ THE TYPE READS EXACTLY ONE ENV VAR AND IT IS THE LEGACY'S, NOT
            # ITS OWN. `CATALYST_MUSTKNOW_GRADES` configures the rule being
            # MIRRORED; ignoring it would make the mirror disagree with
            # production by construction (see
            # test_the_mirror_FOLLOWS_the_env_var_not_the_default). A gate of
            # this type's own is still forbidden — that is CP3.
            reads = [ln for ln in code.splitlines()
                     if "environ" in ln or "getenv" in ln]
            assert len(reads) == 1 and "CATALYST_MUSTKNOW_GRADES" in reads[0], (
                f"{path.name} reads an env var that is not the legacy's grade "
                f"configuration: {reads}")
            assert "ENABLED" not in code, (
                f"{path.name} reads an _ENABLED flag — CP1-CP2 have no gate")


def test_the_harness_imports_no_delivery_and_no_legacy_engine():
    code = _code_only(_COMPARE)
    for forbidden in ("deliver_alert_payload", "watchlist_alert_service",
                      "catalyst.engine", "_fire_catalyst_alerts", "_fire_mustknow_alerts",
                      "try_record_alert"):
        assert forbidden not in code, f"{forbidden} reached the harness's CODE"
