"""GATE-S7-EVENT-PROXIMITY Checkpoint 2 — dark evaluator + forward-only harness.

⛔ Harness-armed predicates ONLY. No projection of member rows (CP3), no
delivery, no legacy change.
"""
from __future__ import annotations

import ast
import pathlib
from datetime import date, timedelta

import pytest

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import event_proximity as ep
from api.services.alert_taxonomy import event_proximity_compare as cmp_
from api.services.alert_taxonomy import predicates as _predicates
from api.services.alert_taxonomy import receipts as _receipts

_REPO = pathlib.Path(__file__).resolve().parents[1]
_AT = _REPO / "api" / "services" / "alert_taxonomy"

TODAY = date(2026, 9, 14)


@pytest.fixture()
def dbp(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    ep.register(db_path=p)
    return p


def _params(**over):
    base = {"event_kind": ep.EARNINGS, "entity_ref": "NVDA",
            "event_date": TODAY.isoformat(), "granularity": ep.DAY,
            "lead_days": 0, "lead_hours": None, "session": "amc"}
    base.update(over)
    return base


def _arm(dbp, **over):
    """A HARNESS-ARMED predicate. ⛔ CP2 never reads a member row."""
    p = _params(**over)
    pid = _predicates.register_predicate(
        ep.TYPE_ID,
        {"kind": "security", "id": "sec:" + p["entity_ref"], "symbol": p["entity_ref"]},
        p, "harness-user", db_path=dbp)
    return pid, p


# --- the dark rule ----------------------------------------------------------

@pytest.mark.parametrize("lead,offset,expect", [
    (0, 0, True),     # today's reporter, the 07:00 ET slot
    (1, 1, True),     # tomorrow's reporter, the 18:00 ET slot
    (0, 1, False),    # due tomorrow, asking about today
    (1, 0, False),    # due today, asking about tomorrow
    (0, -1, False),   # already happened
])
def test_the_dark_rule_matches_the_two_legacy_slots(lead, offset, expect):
    p = _params(lead_days=lead, event_date=(TODAY + timedelta(days=offset)).isoformat())
    assert ep.would_fire(p, TODAY) is expect


def test_a_lead_day_the_legacy_slots_cannot_express_never_fires():
    """⛔ The legacy path expresses 0 and 1 and nothing else. A predicate asking
    for 3 is exactly the F-S7-EP-1 trap — the constant in `calendar_alerts.py`
    that belongs to the awareness engine — and it must not fire here."""
    p = _params(lead_days=3, event_date=(TODAY + timedelta(days=3)).isoformat())
    assert ep.would_fire(p, TODAY) is False
    assert 3 not in ep.LEGACY_LEAD_DAYS


@pytest.mark.parametrize("kind", ["economic", "ipo", "dividend"])
def test_the_pinned_but_unauthorized_kinds_never_fire(kind):
    """⭐ Pinned in the schema, NOT authorized to fire. The distinction is the
    whole of the gate packet's §2 ruling, so it is asserted rather than trusted."""
    assert kind in ep.EVENT_KINDS
    assert ep.would_fire(_params(event_kind=kind), TODAY) is False


def test_hour_granularity_never_fires_even_with_lead_hours():
    assert ep.would_fire(_params(granularity=ep.HOUR, lead_hours=2), TODAY) is False


def test_a_malformed_date_REFUSES_rather_than_defaulting_to_today():
    """⛔ None is a refusal, never a default. A malformed date that fell back to
    `today` would make every broken predicate permanently armed."""
    for bad in ("", "not-a-date", None, "2026-13-45"):
        assert ep.days_until(_params(event_date=bad), TODAY) is None
        assert ep.would_fire(_params(event_date=bad), TODAY) is False


def test_days_until_does_not_clamp_the_past():
    """⭐ Negative is meaningful: an event that already happened is a different
    state from one due today, and collapsing them makes a stale predicate look
    permanently armed."""
    assert ep.days_until(_params(event_date=(TODAY - timedelta(days=4)).isoformat()),
                         TODAY) == -4


# --- the evaluator ----------------------------------------------------------

def test_evaluate_fires_and_records_a_receipt(dbp):
    pid, _ = _arm(dbp)
    out = ep.evaluate(today=TODAY, predicate_ids=[pid], db_path=dbp)
    assert list(out["fired"]) == [pid]
    fires = _receipts.fires_for_predicate(pid, db_path=dbp)
    assert len(fires) == 1
    assert fires[0]["trigger_type"] == ep.TYPE_ID
    assert not fires[0].get("delivered_at"), "a dark fire must carry no delivery stamp"


def test_evaluate_is_dedup_once_per_event_day_like_the_legacy_path(dbp):
    """⭐ The legacy dedup PK is (user, ticker, market_date). The dark fire_key is
    keyed on (entity_ref, event_date, lead_days), so a repeated tick on the same
    day is a no-op BY CONSTRUCTION rather than by a guard someone must remember."""
    pid, _ = _arm(dbp)
    ep.evaluate(today=TODAY, predicate_ids=[pid], db_path=dbp)
    ep.evaluate(today=TODAY, predicate_ids=[pid], db_path=dbp)
    assert len(_receipts.fires_for_predicate(pid, db_path=dbp)) == 1


def test_evaluate_has_NO_all_predicates_mode(dbp):
    """⛔⛔ CP2's APPROVAL SAYS HARNESS-ARMED PREDICATES ONLY, and that must be a
    property of the SIGNATURE rather than of call-site discipline. A default that
    swept everything would make the restriction something a future caller could
    forget rather than something they cannot express."""
    import inspect
    sig = inspect.signature(ep.evaluate)
    p = sig.parameters["predicate_ids"]
    assert p.default is inspect.Parameter.empty, (
        "predicate_ids has a default — CP2 could then sweep every predicate in "
        "the store, which is CP3 and needs its own approval line")
    with pytest.raises(TypeError):
        ep.evaluate(today=TODAY, db_path=dbp)          # type: ignore[call-arg]


def test_an_unknown_predicate_is_reported_not_swallowed(dbp):
    out = ep.evaluate(today=TODAY, predicate_ids=["nope"], db_path=dbp)
    assert out["skipped"] == {"nope": "unknown predicate"}


# --- the mirror, railed against the real legacy module ----------------------

def test_legacy_would_fire_matches_the_real_reporter_set_membership(monkeypatch):
    """⭐ RAIL THE MIRROR, NOT JUST THE LANE.

    `legacy_would_fire` restates what `run_prereport_alerts` decides, because
    calling the real function would MUTATE its dedup table and DELIVER to a
    member. A restatement is only honest with the real thing beside it — so the
    real module's own reporter-set lookup is driven here, with the calendar
    stubbed, and the two must agree for every ticker in every slot.

    ⛔ THE PREDICATES ARE BUILT FROM THE CALENDAR, and that is the whole point of
    the next test: the two rules agree **only while the predicate's stored
    `event_date` still matches what the calendar says.**
    """
    import api.services.calendar_alerts as cal

    reporters = {
        TODAY.isoformat(): {"NVDA", "MSFT"},
        (TODAY + timedelta(days=1)).isoformat(): {"AAPL"},
    }
    monkeypatch.setattr(cal, "_get_reporters_for_date",
                        lambda md: reporters.get(md, set()))

    universe = ("NVDA", "MSFT", "AAPL", "TSLA")
    checked = 0
    for lead in ep.LEGACY_LEAD_DAYS:
        market_date = (TODAY + timedelta(days=lead)).isoformat()
        real_set = cal._get_reporters_for_date(market_date)
        for ticker in universe:
            real = ticker in real_set
            # A TRUTHFUL predicate: its event_date is whatever the calendar says
            # for this ticker, or a far-off date when the calendar has nothing.
            truthful_date = next(
                (d for d, names in reporters.items() if ticker in names),
                (TODAY + timedelta(days=99)).isoformat())
            mine = cmp_.legacy_would_fire(
                _params(entity_ref=ticker, event_date=truthful_date, lead_days=lead),
                TODAY)
            assert mine is real, (
                f"MIRROR DIVERGED at lead={lead} {ticker}: mirror={mine} real={real}")
            checked += 1
    assert checked == 8, f"expected 8 comparisons, made {checked}"


def test_A_STALE_PREDICATE_DATE_IS_THE_DIVERGENCE_THE_RESET_EXISTS_FOR(dbp):
    """⛔⛔ THE STRUCTURAL DIFFERENCE BETWEEN THE TWO RULES, found by railing the
    mirror rather than reasoning about it.

    The legacy path **re-reads the calendar every run** — it asks "is this ticker
    in `reporters(market_date)`". The dark rule reads the predicate's **stored**
    `event_date`. They agree exactly while that stored date is truthful, and the
    moment the company reschedules they describe different worlds:

      * legacy silently follows the calendar to the new date;
      * the dark predicate keeps firing against the old one until something
        updates it.

    ⭐ **That is not a harness bug and it is not fixed here.** It is the finding
    the dark period exists to size, and it is precisely why `note_event_change`
    discards the pre-change span into `not_comparable` rather than scoring it.
    ⚠️ It also means CP3 must decide WHO refreshes the projected event date —
    recorded in the gate packet, not assumed here.
    """
    pid, _ = _arm(dbp)
    stale = _params(event_date=TODAY.isoformat(), lead_days=0)
    assert cmp_.observe(pid, stale, TODAY, db_path=dbp) == cmp_.AGREED

    # The company moves the call a day later. The predicate is updated -> reset.
    moved = _params(event_date=(TODAY + timedelta(days=1)).isoformat(), lead_days=1)
    cmp_.observe(pid, moved, TODAY, db_path=dbp)
    rep = cmp_.report(pid, db_path=dbp)
    assert rep["not_comparable"] >= 1, (
        "a rescheduled event must discard the pre-change span rather than let it "
        "stand as agreement about a date that no longer exists")


def test_the_harness_imports_no_delivery_path():
    for name in ("event_proximity.py", "event_proximity_compare.py"):
        imported: set = set()
        for node in ast.walk(ast.parse((_AT / name).read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                imported |= {a.name for a in node.names}
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                imported.add(base)
                imported |= {f"{base}.{a.name}" for a in node.names}
        assert imported, f"{name}: the import scan saw nothing — broken, not green"
        for banned in ("delivery", "email_service", "deliver_alert_payload",
                       "calendar_alerts"):
            assert not any(banned in n for n in imported), f"{name} imports {banned}"


# --- the forward-only comparison -------------------------------------------

def test_agreement_is_recorded_and_a_quiet_tick_is_NOT(dbp):
    """⛔ Neither side firing is an ordinary tick, not an outcome. Counting quiet
    ticks as agreement would make the result a function of sampling rate."""
    pid, p = _arm(dbp)
    assert cmp_.observe(pid, p, TODAY, db_path=dbp) == cmp_.AGREED
    quiet = _params(event_date=(TODAY + timedelta(days=9)).isoformat())
    assert cmp_.observe(pid, quiet, TODAY, db_path=dbp) is None


def test_NON_VACUITY_CONTROL_the_differ_can_report_BOTH_disagreements(dbp):
    """⛔ A harness that can only ever say `agreed` is not a differ. Both
    one-sided outcomes are produced by construction here, so a future change that
    silently made disagreement unreachable goes red."""
    pid, _ = _arm(dbp)

    # legacy_only: a kind the legacy rule fires on but the dark rule refuses.
    # ⭐ Forced by patching the DARK side only, so the two genuinely disagree.
    import api.services.alert_taxonomy.event_proximity as _m
    real = _m.would_fire
    _m.would_fire = lambda params, today: False
    try:
        assert cmp_.observe(pid, _params(), TODAY, db_path=dbp) == cmp_.LEGACY_ONLY
    finally:
        _m.would_fire = real

    real_legacy = cmp_.legacy_would_fire
    cmp_.legacy_would_fire = lambda params, today: False
    try:
        assert cmp_.observe(pid, _params(), TODAY, db_path=dbp) == cmp_.NEW_ONLY
    finally:
        cmp_.legacy_would_fire = real_legacy

    rep = cmp_.report(pid, db_path=dbp)
    assert rep["legacy_only"] == 1 and rep["new_only"] == 1


def test_a_RESCHEDULED_event_resets_the_clock_and_discards_to_NOT_COMPARABLE(dbp):
    """⛔⛔ THE F-S7-3 ANALOGUE, and it is why replay is refused here.

    The company moves its call. What the two sides did against the OLD date can
    no longer be attributed to the migration — so the pre-change span is
    discarded into `not_comparable`, never kept as agreement.
    """
    pid, p = _arm(dbp)
    assert cmp_.observe(pid, p, TODAY, db_path=dbp) == cmp_.AGREED
    assert cmp_.report(pid, db_path=dbp)["agreed"] == 1

    moved = _params(event_date=(TODAY + timedelta(days=1)).isoformat(), lead_days=1)
    assert cmp_.observe(pid, moved, TODAY, db_path=dbp) == cmp_.AGREED

    rep = cmp_.report(pid, db_path=dbp)
    assert rep["not_comparable"] == 1, "the pre-move agreement must be discarded"
    assert rep["agreed"] == 1, "only the post-move tick may count"
    assert rep["spans"] == 2, "a fresh span must have opened at the new date"


def test_the_verdict_gate_is_five_sessions_and_is_its_own_field(dbp):
    """⛔ 'Not enough data yet' and 'they agree' are different answers."""
    pid, p = _arm(dbp)
    for i in range(4):
        d = TODAY + timedelta(days=i)
        cmp_.observe(pid, _params(event_date=d.isoformat()), d, db_path=dbp)
    rep = cmp_.report(pid, db_path=dbp)
    assert rep["verdict_ready"] is False
    assert len(rep["sessions_covered"]) == 4
    d = TODAY + timedelta(days=4)
    cmp_.observe(pid, _params(event_date=d.isoformat()), d, db_path=dbp)
    assert cmp_.report(pid, db_path=dbp)["verdict_ready"] is True


def test_sessions_are_counted_by_THE_TICKS_OWN_DAY_not_wall_clock(dbp):
    """⭐ A harness stamping wall-clock days would report five sessions after five
    wall-clock days regardless of how many ticks actually happened."""
    pid, _ = _arm(dbp)
    for _ in range(9):
        cmp_.observe(pid, _params(), TODAY, db_path=dbp)
    assert cmp_.report(pid, db_path=dbp)["sessions_covered"] == [TODAY.isoformat()]


def test_the_harness_never_touches_the_legacy_dedup_table():
    """⛔ `calendar_alerts_fired` lives in its own database and belongs to the
    legacy path. CODE, NEVER PROSE — this module names the table in its docstring."""
    tree = ast.parse((_AT / "event_proximity_compare.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    code = ast.unparse(tree).upper()
    assert "EVENT_PROXIMITY_COMPARISON_SPANS" in code, "the scan saw no schema — broken"
    assert "CALENDAR_ALERTS_FIRED" not in code
    assert "CALENDAR_ALERTS.DB" not in code


def test_the_legacy_module_is_byte_identical():
    import subprocess
    r = subprocess.run(
        ["git", "-C", str(_REPO), "diff", "--stat", "origin/master", "--",
         "api/services/calendar_alerts.py"],
        capture_output=True, text=True)
    assert r.stdout.strip() == "", f"calendar_alerts.py differs:\n{r.stdout}"
