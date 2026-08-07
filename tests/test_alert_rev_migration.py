"""Phase C Task 7 — the `compute.rev` force-migration.

⭐ THE ONE INVARIANT THIS FILE EXISTS TO PROVE: a migration that resets state
must SUPPRESS THE FIRST CYCLE, or every armed alert on the migrated definition
re-fires at once on the first evaluation after deploy.

The measurement is a FIRE, NOT A FLAG. Asserting `rev_migrated_at` is set asserts
the bookkeeping; asserting NO NOTIFICATION LEFT THE BUILDING asserts the thing
the user experiences — so every headline test here counts deliveries through the
real `_run_one_cycle` and the real `_dispatch_delivery`, with only the transport
(`watchlist_alert_service.deliver_alert_payload`) spied.
"""
from __future__ import annotations

import ast
import inspect
import json
import re
import sqlite3
import textwrap
import time
from pathlib import Path

import pytest

from api.services import alert_rev_migration as rev
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import indicator_compute as ic
from api.services import watchlist_alert_service as wls

ROOT = Path(__file__).resolve().parents[1]
PARITY_BARS = ROOT / "app" / "src" / "pages" / "parityBars" / "intraday5m.json"
REGISTRY_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "nativeRegistry.js"

# ⭐ THE REAL REV-1 / REV-2 GAP, ON REAL BARS, AT THE BAR THE DECISION RECORD
# ARGUES FROM. `VWAP_SESSION_ANCHOR` re-anchored the accumulator from the UTC
# calendar day onto the ET session; index 386 of the chart-parity intraday
# fixture is the third ET session's open, where the old lane reads 93.9178 and
# the new one reads 108.3633. `_BARS` is sliced to END there so the forming
# lane's "last bar" IS that bar.
_GAP_BAR = 386
REV1_VWAP = 93.9178      # UTC-day bucketing — what a stored `last_value` holds
REV2_VWAP = 108.3633     # ET-session bucketing — what the shipped compute returns
STRADDLE = 100.0         # a threshold strictly between the two


def _bars() -> list[dict]:
    payload = json.loads(PARITY_BARS.read_text(encoding="utf-8"))
    return [dict(b) for b in payload["bars"][: _GAP_BAR + 1]]


def _utc_day_vwap(bars: list[dict]) -> list[float]:
    """The REV-1 series — VWAP bucketed by the UTC calendar day.

    ⛔ THIS IS THE OLD MATHS, WRITTEN OUT ON PURPOSE. `indicator_compute` only
    ships the corrected (rev 2) lane, so the only way to demonstrate that a
    migration has anything to migrate is to hold both series at once. It is a
    six-line accumulator, and the two numbers it produces at `_GAP_BAR` are
    asserted against the constants above — so if this helper is ever wrong, the
    test that uses it fails rather than quietly agreeing with itself.
    """
    import datetime as dt
    out: list[float] = []
    cum_pv = cum_v = 0.0
    day = None
    for b in bars:
        d = dt.datetime.fromtimestamp(b["t"], dt.timezone.utc).date()
        if d != day:
            cum_pv = cum_v = 0.0
            day = d
        cum_pv += ((b["h"] + b["l"] + b["c"]) / 3.0) * b["v"]
        cum_v += b["v"]
        out.append(round(cum_pv / cum_v, 4) if cum_v else None)
    return out


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A real alert DB, real bars, and a spy on the ONE delivery transport."""
    db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db))
    monkeypatch.setattr(ias, "_DB_PATH", str(db))
    ias.init_schema()
    rev.init_schema()

    bars = _bars()
    state = {"bars": bars}

    def _fetch(sym, tf, count=200):
        return [dict(b) for b in state["bars"]]

    monkeypatch.setattr(ev, "_fetch_bars_for_alert", _fetch)

    sent: list[dict] = []

    def _deliver(**kwargs):
        sent.append(kwargs)

    monkeypatch.setattr(wls, "deliver_alert_payload", _deliver)

    # ⛔ THE LANE IS PINNED TO `"forming"` FOR THIS WHOLE FILE, AND THAT IS THE
    # FINDING RATHER THAN A CONVENIENCE.
    #
    # The defect this file exists to prove — a rev-1 `last_value` becoming a
    # rev-2 `prev`, so the migration itself fabricates a crossing — is a property
    # of the FORMING lane and ONLY of it. The closed lane takes `prev` from
    # `series[i-1]`, i.e. from the same revision's own column, so a cross-revision
    # comparison is not a state it can reach. Measured at Task 8's cutover: with
    # the shipped constant now `"closed"`, the crossing binding fires on the
    # second post-migration cycle and it is NOT a lie — both sides of the
    # comparison are rev 2.
    #
    # So `suppress_first_cycle` is now belt-and-braces on the shipped lane and
    # load-bearing on the ROLLBACK lane. It stays, it is still tested, and the
    # test says which lane it is testing instead of silently becoming a test of
    # the other one. `test_the_CLOSED_lane_cannot_fabricate_a_cross_revision_
    # crossing_at_all` below is the other half.
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    return {"db": db, "bars": bars, "sent": sent, "state": state}


def _arm(alert_id: int, *, last_value, last_evaluated_at):
    """Put an alert into the state a LIVE alert is in: it has run before."""
    con = sqlite3.connect(str(ias._DB_PATH))
    try:
        con.execute(
            "UPDATE indicator_alerts SET last_value=?, last_evaluated_at=? WHERE id=?",
            (last_value, last_evaluated_at, int(alert_id)),
        )
        con.commit()
    finally:
        con.close()


def _armed_vwap_pair(*, armed_at: int) -> tuple[int, int]:
    """One crossing binding and one LEVEL binding, both holding a rev-1 number.

    ⚠️ THE LEVEL BINDING IS NOT DECORATION — IT IS THE HALF THE RESET CANNOT
    COVER. With `last_value` NULL the `cross_*` branches return False, so a test
    built only from crossings goes green with the suppression deleted.
    """
    cross = ias.create(user_id="u1", sym="PARITY", indicator="vwap",
                       condition="cross_above", threshold=STRADDLE, tf="5")
    level = ias.create(user_id="u1", sym="PARITY", indicator="vwap",
                       condition="above", threshold=STRADDLE, tf="5")
    for aid in (cross, level):
        _arm(aid, last_value=REV1_VWAP, last_evaluated_at=armed_at)
    return cross, level


def _row(alert_id: int) -> dict:
    return ias.get(int(alert_id))


def _fires(sent: list[dict]) -> list[dict]:
    return [s for s in sent if s.get("source") == "indicator_alert"]


def _notices(sent: list[dict]) -> list[dict]:
    return [s for s in sent if s.get("source") == "indicator_alert_migration"]


# ─── the two numbers this whole file rests on ────────────────────────────────

def test_the_two_revisions_really_do_disagree_on_these_bars(env):
    """⭐ THE NON-VACUITY FLOOR. Every test below is a statement about a gap
    between two revisions of the same maths; if the fixture had no gap, all of
    them would pass while measuring nothing.
    """
    bars = env["bars"]
    rev2 = ic.compute_vwap(bars)
    rev1 = _utc_day_vwap(bars)
    assert rev1[-1] == REV1_VWAP
    assert rev2[-1] == REV2_VWAP
    assert rev1[-1] < STRADDLE < rev2[-1], (
        "the threshold no longer straddles the two revisions — the fabricated "
        "crossing this file measures cannot occur")

    full = json.loads(PARITY_BARS.read_text(encoding="utf-8"))["bars"]
    moved = sum(1 for a, b in zip(_utc_day_vwap(full), ic.compute_vwap(full))
                if a is not None and b is not None and abs(a - b) > 0.01)
    assert moved == 207 and len(full) == 579, (
        "the applied cost of VWAP_SESSION_ANCHOR moved — 207 of 579 bars is what "
        "the decision record was priced on")


def test_WITHOUT_the_migration_the_bump_FABRICATES_A_CROSSING(env):
    """⭐ THE POSITIVE CONTROL, AND IT IS THE WHOLE ARGUMENT FOR THE TASK.

    Deploy the new maths under an alert still holding the old number and run one
    ordinary cycle. Both bindings fire. The crossing one is a lie — no bar took
    price through 100; the ANCHOR moved.
    """
    cross, level = _armed_vwap_pair(armed_at=int(time.time()) - 7200)
    ev._run_one_cycle()
    fired = {s["extra_data"]["alert_id"] for s in _fires(env["sent"])}
    assert fired == {cross, level}, (
        "the un-migrated deploy did NOT re-fire — the suppression tests below "
        "would then be preventing nothing")


# ─── the headline ────────────────────────────────────────────────────────────

def test_the_first_cycle_after_a_rev_bump_CANNOT_fire(env):
    """⭐ THE FABRICATED CROSSING, AS A TEST.

    `prev` was computed by rev 1. `current` is computed by rev 2. Comparing them
    invents a crossing that no bar produced. Spec §3.1 names the remedy: reset
    `last_value`, and suppress the first post-migration cycle.

    ⚠️ THE MEASUREMENT IS A FIRE, NOT A FLAG.
    """
    now = int(time.time())
    cross, level = _armed_vwap_pair(armed_at=now - 7200)
    result = rev.migrate_bindings_to_rev("vwap", 2, notify=rev.deliver_migration_notice,
                                         now=now - 3600)
    assert result["migrated"] == 2
    env["sent"].clear()

    ev._run_one_cycle()
    assert _fires(env["sent"]) == [], (
        "a crossing was fabricated by the migration itself — "
        f"{[s['extra_data']['alert_id'] for s in _fires(env['sent'])]} delivered "
        "on the first post-migration cycle")

    env["sent"].clear()
    ev._run_one_cycle()
    fired = [s["extra_data"]["alert_id"] for s in _fires(env["sent"])]
    assert fired, "suppression did not lift — the alert is now permanently deaf"
    assert fired == [level], (
        "the CROSSING binding fired on the second cycle. The reset exists so a "
        "rev-1 number can never be a rev-2 `prev`; a late crossing is the same "
        "lie, one cycle later")


def test_the_CLOSED_lane_cannot_fabricate_a_cross_revision_crossing_at_all(
        env, monkeypatch):
    """⭐ WHAT THE CUTOVER DID TO THIS DEFECT: it removed the mechanism.

    The test above is the forming lane's failure mode — `prev` is whatever the
    previous 60-second POLL stored, so a rev-1 number can meet a rev-2 number and
    invent a crossing out of the migration itself. The closed lane takes `prev`
    from `series[i - 1]`: both sides of every comparison come from ONE call to
    ONE revision's column, so the cross-revision comparison is not a reachable
    state rather than a suppressed one.

    ⚠️ MEASURED, NOT ARGUED, AND THE CROSSING THAT FIRES HERE IS REAL. On the
    shipped lane the crossing binding DOES deliver on the second post-migration
    cycle — and that is correct: it is a rev-2 crossing judged against a rev-2
    `prev`, on a bar where rev 2's own column crosses. The forming lane's second
    cycle would be a lie; this one is an answer.

    ⛔ AND `suppress_first_cycle` IS NOT DELETED. It is what the ROLLBACK lane
    needs, and the rollback is one Railway variable away with no deploy. This
    test states which lane owes it and which does not.
    """
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")
    now = int(time.time())
    cross, level = _armed_vwap_pair(armed_at=now - 7200)
    assert rev.migrate_bindings_to_rev(
        "vwap", 2, notify=lambda p: None, now=now - 3600)["migrated"] == 2
    env["sent"].clear()

    # The suppression still eats the first cycle — it is lane-independent.
    ev._run_one_cycle()
    assert _fires(env["sent"]) == []

    env["sent"].clear()
    ev._run_one_cycle()
    fired = sorted(s["extra_data"]["alert_id"] for s in _fires(env["sent"]))
    assert fired == sorted([cross, level]), (
        "the closed lane did not deliver the crossing — then this test says "
        "nothing about `prev`'s source and the forming-lane rail above is "
        "measuring both lanes by accident")

    # …and the reason it is not a fabricated crossing: the lane never read the
    # row's `last_value` at all. Both sides came out of one column.
    row = _row(cross)
    assert ev._evaluate_one(dict(row), bars=env["state"]["bars"],
                            mode="closed")[1] is True
    assert ev._evaluate_one(dict(row, last_value=1e9), bars=env["state"]["bars"],
                            mode="closed")[1] is True, (
        "a wildly different `last_value` changed the closed lane's answer — it "
        "IS reading the row, and the claim above is false")


def test_last_value_is_NULL_BETWEEN_the_migration_and_the_first_cycle(env):
    """The reset half, asserted directly rather than inferred from silence.

    ⛔ THIS IS WHAT SEES A MISSING RESET. Suppression alone eats the first
    cycle's delivery, so a tree with the reset deleted still reports zero fires
    on that cycle — and the fabricated crossing then arrives on the NEXT one, or
    not at all if the level moved back. The state is the load-bearing half.
    """
    now = int(time.time())
    cross, level = _armed_vwap_pair(armed_at=now - 7200)
    rev.migrate_bindings_to_rev("vwap", 2, notify=lambda p: None, now=now - 3600)

    for aid in (cross, level):
        row = _row(aid)
        assert row["last_value"] is None, (
            f"alert {aid} still holds a rev-1 number after the migration")
        assert rev.rev_row(aid)["def_rev"] == 2
        assert rev.rev_row(aid)["from_rev"] == 1
        assert rev.rev_row(aid)["rev_migrated_at"] == now - 3600

    # …and still NULL after the cycle that was eaten: a suppressed cycle records
    # no value, so nothing has re-populated `prev` with a number nobody compared.
    ev._run_one_cycle()
    for aid in (cross, level):
        assert _row(aid)["last_value"] is None


# ─── the notification ────────────────────────────────────────────────────────

def test_the_user_is_NOTIFIED_and_the_notification_names_the_indicator(env):
    """Spec §3.1's contract is *"you will never be silently switched"*, not
    *"old math runs forever"*. A migration with no notification honours neither.
    """
    now = int(time.time())
    cross, level = _armed_vwap_pair(armed_at=now - 7200)
    result = rev.migrate_bindings_to_rev("vwap", 2,
                                         notify=rev.deliver_migration_notice, now=now)

    notices = _notices(env["sent"])
    assert result["notified"] == 2 and result["notify_errors"] == 0
    assert {n["extra_data"]["alert_id"] for n in notices} == {cross, level}
    for n in notices:
        assert n["source"] == "indicator_alert_migration", (
            "the notice is indistinguishable from an alert firing")
        assert "vwap" in n["message"].lower() or "vwap" in n["title"].lower(), (
            "the notice does not name the indicator whose maths changed")
        assert n["extra_data"]["from_rev"] == 1 and n["extra_data"]["def_rev"] == 2
        assert n["user_id"] == "u1"
    # It rides the SAME transport as a fire, which is the point: no new channel.
    assert all(n["sym"] == "PARITY" for n in notices)


def test_a_migration_with_no_notify_is_REFUSED_not_silently_accepted(env):
    """`notify=None` accepted silently is "never silently switched" broken by
    the very code that promises it."""
    now = int(time.time())
    cross, level = _armed_vwap_pair(armed_at=now - 7200)
    with pytest.raises(ValueError, match="notify"):
        rev.migrate_bindings_to_rev("vwap", 2, notify=None, now=now)
    with pytest.raises(TypeError):
        rev.migrate_bindings_to_rev("vwap", 2)          # type: ignore[call-arg]

    # The refusal is TOTAL: nothing was migrated on the way to raising.
    for aid in (cross, level):
        assert _row(aid)["last_value"] == REV1_VWAP
        assert rev.rev_row(aid) is None


def test_a_FAILED_notice_is_counted_and_never_swallowed(env):
    """The reset has already happened; a user who was not told is exactly what
    §3.1 forbids, so the failure has to be visible in the return value."""
    now = int(time.time())
    _armed_vwap_pair(armed_at=now - 7200)

    def _boom(payload):
        raise RuntimeError("no channel")

    result = rev.migrate_bindings_to_rev("vwap", 2, notify=_boom, now=now)
    assert result["migrated"] == 2
    assert result["notified"] == 0 and result["notify_errors"] == 2


# ─── the blast radius ────────────────────────────────────────────────────────

def test_an_alert_on_an_UNMIGRATED_address_is_untouched_FIELD_BY_FIELD(env):
    """⛔ THE NON-MEASUREMENT ASSERTION. A migration that resets everything is
    easy and wrong: it would clear `last_value` on every alert in the product,
    disarming every crossing anyone has armed.
    """
    now = int(time.time())
    other = ias.create(user_id="u2", sym="PARITY", indicator="rsi",
                       condition="above", threshold=1e9, tf="5")
    _arm(other, last_value=41.5, last_evaluated_at=now - 7200)
    before = _row(other)

    rev.migrate_bindings_to_rev("vwap", 2, notify=lambda p: None, now=now)

    after = _row(other)
    assert after["last_value"] == before["last_value"] == 41.5
    assert after["last_evaluated_at"] == before["last_evaluated_at"] == now - 7200
    assert after == before, f"the migration touched an unrelated alert: {before} -> {after}"
    assert rev.rev_row(other) is None, "an unmigrated address gained a def_rev"
    assert _notices(env["sent"]) == [], "an unrelated user was notified"


def test_compute_rev_is_a_property_of_the_DEFINITION_not_of_one_plot(env):
    """Every plot of one definition comes out of one compute call, so a bump
    migrates all of them or the definition has two revisions at once."""
    assert rev.compute_rev("vwap") == 2
    assert rev.compute_rev("rsi") == rev.DEFAULT_REV == 1
    assert rev.compute_rev("ichimoku.chikou") == rev.compute_rev("ichimoku.tenkan")

    now = int(time.time())
    a = ias.create(user_id="u1", sym="PARITY", indicator="ichimoku.chikou",
                   condition="above", threshold=1.0, tf="5")
    b = ias.create(user_id="u1", sym="PARITY", indicator="ichimoku.tenkan",
                   condition="above", threshold=1.0, tf="5")
    result = rev.migrate_bindings_to_rev("ichimoku", 2, notify=lambda p: None, now=now)
    assert sorted(result["alert_ids"]) == sorted([a, b])


def test_re_running_the_same_migration_is_a_NO_OP(env):
    """Idempotent, because a re-run must not re-suppress a lane that already
    migrated — an operator repeating a deploy step would silently deafen every
    binding for another cycle."""
    now = int(time.time())
    cross, level = _armed_vwap_pair(armed_at=now - 7200)
    first = rev.migrate_bindings_to_rev("vwap", 2, notify=lambda p: None, now=now - 3600)
    assert first["migrated"] == 2 and first["skipped"] == 0

    ev._run_one_cycle()                       # spends the suppression
    ev._run_one_cycle()                       # a normal cycle: `level` fires
    env["sent"].clear()
    stamps = {aid: rev.rev_row(aid)["rev_migrated_at"] for aid in (cross, level)}
    values = {aid: _row(aid)["last_value"] for aid in (cross, level)}

    second = rev.migrate_bindings_to_rev("vwap", 2, notify=lambda p: None, now=now)
    assert second["migrated"] == 0 and second["skipped"] == 2
    assert _notices(env["sent"]) == []
    for aid in (cross, level):
        assert rev.rev_row(aid)["rev_migrated_at"] == stamps[aid]
        assert _row(aid)["last_value"] == values[aid]
    assert rev.suppress_first_cycle(_row(level)) is False


# ─── the suppression, on its own terms ───────────────────────────────────────

def test_suppression_is_keyed_on_the_ALERTS_OWN_CYCLE_not_the_wall_clock(env):
    """⚠️ ONE CYCLE, NOT ONE MINUTE.

    The migration here is an HOUR old. Any wall-clock window a reasonable person
    would pick has long expired, and the alert still has not been evaluated once
    — so it is still holding the state the migration left it in and must still be
    suppressed. A thin ticker, or a symbol whose bars arrive late, sleeps straight
    through a wall-clock window and then fires the thing the window existed to eat.
    """
    now = int(time.time())
    alert = {"id": 1, "last_evaluated_at": now - 7200, "rev_migrated_at": now - 3600}
    assert rev.suppress_first_cycle(alert) is True
    assert rev.suppress_first_cycle({**alert, "last_evaluated_at": None}) is True
    assert rev.suppress_first_cycle({**alert, "last_evaluated_at": now - 3599}) is False
    # …and the boundary itself: evaluated AT the migration instant is still the
    # pre-migration evaluation, so it does not count as the alert's own cycle.
    assert rev.suppress_first_cycle({**alert, "last_evaluated_at": now - 3600}) is True

    # No wall-clock read at all, asserted over the CODE — because a `time.time()`
    # in here is invisible to any single-instant test.
    #
    # ⚠️ AN `in`-ON-THE-SOURCE VERSION OF THIS WENT RED ON ITS OWN DOCSTRING,
    # which is the same shape as the vwap record's decorative content gate:
    # prose ABOUT the thing is not the thing. It walks the AST instead, so it
    # sees calls and nothing else.
    tree = ast.parse(textwrap.dedent(inspect.getsource(rev.suppress_first_cycle)))
    clocks = sorted(
        ast.unparse(n.func) for n in ast.walk(tree)
        if isinstance(n, ast.Call) and ast.unparse(n.func).split(".")[0]
        in {"time", "datetime", "dt"}
    )
    assert clocks == [], (
        f"suppress_first_cycle reads a clock ({clocks}) — it must key on the "
        "alert's own evaluation, not on a window it can sleep through")
    # …and the control: a function that DOES read a clock is seen by that walk,
    # so the empty list above is a measurement rather than a broken scan.
    lifted = sorted(
        ast.unparse(n.func) for n in ast.walk(
            ast.parse(textwrap.dedent(inspect.getsource(rev._consume_cycle))))
        if isinstance(n, ast.Call) and ast.unparse(n.func).split(".")[0]
        in {"time", "datetime", "dt"}
    )
    assert lifted == ["time.time"], (
        "the clock scan found nothing in a function that demonstrably reads one")


def test_a_NEVER_MIGRATED_alert_is_never_suppressed(env):
    """Inertness. On a tree where no migration has run — which is every tree
    today — this path must be a decision nobody notices."""
    now = int(time.time())
    a = ias.create(user_id="u1", sym="PARITY", indicator="vwap",
                   condition="above", threshold=STRADDLE, tf="5")
    _arm(a, last_value=REV1_VWAP, last_evaluated_at=now - 7200)
    assert rev.suppress_first_cycle(_row(a)) is False
    assert rev.consume_if_suppressed(_row(a), bars=env["bars"]) is False
    ev._run_one_cycle()
    assert len(_fires(env["sent"])) == 1, (
        "an alert that never migrated was suppressed — the migration path is not "
        "inert on a tree that has never migrated")


def test_a_cycle_with_NO_BARS_does_not_spend_the_suppression(env):
    """`_run_one_cycle` reaches every active alert even when its group fetched
    nothing. Consuming there would hand the FIRST cycle with real bars the
    un-suppressed evaluation this exists to prevent.
    """
    now = int(time.time())
    cross, level = _armed_vwap_pair(armed_at=now - 7200)
    rev.migrate_bindings_to_rev("vwap", 2, notify=lambda p: None, now=now - 3600)

    env["state"]["bars"] = []
    ev._run_one_cycle()
    assert _row(level)["last_evaluated_at"] == now - 7200, "the empty cycle was spent"
    assert rev.suppress_first_cycle(_row(level)) is True

    env["state"]["bars"] = _bars()
    env["sent"].clear()
    ev._run_one_cycle()
    assert _fires(env["sent"]) == [], (
        "the first cycle that could actually have delivered was not suppressed")
    env["sent"].clear()
    ev._run_one_cycle()
    assert len(_fires(env["sent"])) == 1


def test_suppression_lifts_after_ONE_cycle_even_inside_ONE_SECOND(env):
    """Seconds are integers, and a migration can land in the same second as the
    cycle that eats it. Without the guard the consumed stamp would still satisfy
    `last_evaluated_at <= rev_migrated_at` and the alert would stay deaf until
    the wall clock happened to tick."""
    now = int(time.time())
    cross, level = _armed_vwap_pair(armed_at=now)
    rev.migrate_bindings_to_rev("vwap", 2, notify=lambda p: None, now=now)
    assert rev.consume_if_suppressed(_row(level), bars=env["bars"], now=now) is True
    assert _row(level)["last_evaluated_at"] == now + 1
    assert rev.suppress_first_cycle(_row(level)) is False


def test_the_summary_COUNTS_the_suppressed_cycle(env):
    """A cycle that silently skips work is indistinguishable from a cycle that
    had none. The count is how an operator sees the migration land."""
    now = int(time.time())
    _armed_vwap_pair(armed_at=now - 7200)
    rev.migrate_bindings_to_rev("vwap", 2, notify=lambda p: None, now=now - 3600)
    summary = ev._run_one_cycle()
    assert summary["suppressed"] == 2 and summary["evaluated"] == 0
    summary = ev._run_one_cycle()
    assert summary["suppressed"] == 0 and summary["evaluated"] == 2


# ─── the seams ───────────────────────────────────────────────────────────────

def test_the_DELIVERY_CYCLE_consults_the_suppression(env):
    """⛔ A GATE WITH NO CALL SITE IS NOT A GATE.

    The behavioural tests above would all still pass if the guard lived in a
    function only they called. This asserts the SHIPPED cycle names it, so a
    refactor that drops the call site fails structurally as well.
    """
    # ⚠️ RE-PARSED FROM THE FILE BY NAME, NOT `inspect.getsource`. That helper
    # slices the file at the line numbers captured when the module was IMPORTED,
    # so an edit to this file while the suite is running hands it the wrong lines
    # and it reports a missing call site that is right there. Measured for real
    # on 2026-08-06 in a shared worktree. Finding a `FunctionDef` by name in a
    # fresh parse cannot drift.
    module = ast.parse(Path(ev.__file__).read_text(encoding="utf-8"))
    cycles = [n for n in module.body
              if isinstance(n, ast.FunctionDef) and n.name == "_run_one_cycle"]
    assert len(cycles) == 1, f"expected one _run_one_cycle, found {len(cycles)}"
    src = ast.unparse(cycles[0])
    assert "alert_rev_migration" in src, (
        "_run_one_cycle no longer imports the migration guard")
    assert "consume_if_suppressed" in src, (
        "_run_one_cycle no longer consults suppress-and-consume — every armed "
        "binding on a migrated definition re-fires on the deploy")

    # The control: the same parse of a DIFFERENT function does NOT contain it, so
    # the two assertions above are reading `_run_one_cycle`'s body and not the
    # whole module. A whole-file `in` would pass on the docstring alone.
    others = [n for n in module.body
              if isinstance(n, ast.FunctionDef) and n.name == "_evaluate_one"]
    assert len(others) == 1
    assert "consume_if_suppressed" not in ast.unparse(others[0]), (
        "the scan is reading more than the cycle's own body — it would pass on "
        "any mention anywhere in the module")


def test_the_three_effects_are_ONE_TRANSACTION(env):
    """A reset that lands without its stamp is the worst of both worlds: the
    crossings are gone AND the first cycle is not suppressed."""
    now = int(time.time())
    cross, level = _armed_vwap_pair(armed_at=now - 7200)

    real = ev.resolve_address
    calls = {"n": 0}

    def _explode(raw):
        calls["n"] += 1
        if calls["n"] > 3:      # past `target`, mid-way through the row loop
            raise RuntimeError("boom")
        return real(raw)

    import pytest as _pytest
    with _pytest.MonkeyPatch.context() as mp:
        mp.setattr(ev, "resolve_address", _explode)
        with _pytest.raises(RuntimeError):
            rev.migrate_bindings_to_rev("vwap", 2, notify=lambda p: None, now=now)

    for aid in (cross, level):
        assert _row(aid)["last_value"] == REV1_VWAP, (
            f"alert {aid} kept a half-applied reset after the migration raised")
        assert rev.rev_row(aid) is None, "a stamp survived a rolled-back migration"
    assert _notices(env["sent"]) == []


def test_the_migration_touches_NO_STORED_CHART_SETTINGS_BLOB(env):
    """⛔ THE OTHER `compute.rev` CONSUMER, AND THIS PATH IS NOT IT.

    A definition's revision is also stamped on stored CHART instances, and the
    owner's live blob was measured on 2026-08-06 as still v1: no
    `settingsVersion`, no `engineEnabled`, no `engine` block, 15 legacy indicator
    keys — rendered correctly by Phase B's READ-TIME migration. And the global
    blob is only a SEED: the real per-chart settings live in
    `charts_workspace_layout` → `widgets[].opts.settings`, which a blob-only
    rewrite would silently miss (that exact trap shipped a bug once already).

    So this migration deliberately writes NEITHER. Its whole surface is
    `indicator_alerts` (one column, to NULL) and its own side table. That is
    asserted here rather than promised in a docstring, because "we don't touch
    it" is the kind of claim that stops being true in a later edit.
    """
    src = Path(rev.__file__).read_text(encoding="utf-8")
    forbidden = ("chart_settings", "charts_workspace_layout", "user_preferences",
                 "usePreferences", "settingsVersion", "engineEnabled",
                 "opts.settings")
    hits = [name for name in forbidden if name in src]
    assert hits == [], (
        f"the rev migration names the stored chart-settings path: {hits}. "
        "Rewriting a user's blob is a different migration with a different "
        "read-time contract, and it is not this one.")
    # The control: the scan CAN see a name, so an empty list is a measurement.
    assert "indicator_alerts" in src

    # And behaviourally — the only table it wrote is its own plus the alerts one.
    now = int(time.time())
    _armed_vwap_pair(armed_at=now - 7200)
    con = sqlite3.connect(str(env["db"]))
    try:
        con.execute("CREATE TABLE IF NOT EXISTS user_preferences "
                    "(user_id TEXT, key TEXT, value TEXT)")
        con.execute("INSERT INTO user_preferences VALUES ('u1','chart_settings','{}')")
        con.commit()
        before = con.execute("SELECT * FROM user_preferences").fetchall()
    finally:
        con.close()
    rev.migrate_bindings_to_rev("vwap", 2, notify=lambda p: None, now=now)
    con = sqlite3.connect(str(env["db"]))
    try:
        after = con.execute("SELECT * FROM user_preferences").fetchall()
    finally:
        con.close()
    assert after == before and before, "the migration wrote to the preferences store"


def test_the_python_rev_table_matches_the_JS_registry(env):
    """⭐ ONE VOCABULARY, TWO LANES — as a rail, not a habit.

    `compute.rev` is authored in `nativeRegistry.js`; this lane keeps a table
    beside it. A future bump in the registry must land RED here, because the
    moment somebody comes to this file to fix it is exactly the moment the
    migration is supposed to be run.
    """
    src = REGISTRY_JS.read_text(encoding="utf-8")
    assert "compute: { kind: 'native', fn, rev: 1 }" in src, (
        "the registry's default revision is no longer this literal — the parse "
        "below now reads nothing and this comparison is vacuous")
    assert rev.DEFAULT_REV == 1

    parsed = {m.group(1): int(m.group(2))
              for m in re.finditer(r"fn:\s*'([a-zA-Z0-9_]+)'\s*,\s*rev:\s*(\d+)", src)}
    assert parsed, (
        "no explicit revision was parsed out of the registry — the regex now "
        "matches nothing and this comparison is vacuous")
    # An explicit `rev: 1` is the DEFAULT spelled out (the server lane writes
    # one), not a bump. Only a non-default revision is a migration, and the JS
    # side filters identically.
    overrides = {k: v for k, v in parsed.items() if v != rev.DEFAULT_REV}
    assert overrides == {k: v for k, v in rev.ADDRESS_REVS.items() if v != rev.DEFAULT_REV}, (
        f"the JS registry and ADDRESS_REVS disagree: {overrides} vs {rev.ADDRESS_REVS}. "
        "A definition whose maths moved has bindings that must be migrated.")


def test_the_migration_table_lives_BESIDE_indicator_alerts_in_one_file(env):
    """The single-transaction guarantee is a property of them sharing a file."""
    assert rev.db_path() == ias._DB_PATH
    con = sqlite3.connect(str(env["db"]))
    try:
        names = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    finally:
        con.close()
    assert {"indicator_alerts", "indicator_alert_rev"} <= names


def test_a_nonsense_revision_is_refused(env):
    for bad in (0, -1, "2", 1.5, True, None):
        with pytest.raises((ValueError, TypeError)):
            rev.migrate_bindings_to_rev("vwap", bad, notify=lambda p: None)
