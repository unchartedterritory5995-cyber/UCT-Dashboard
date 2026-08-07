"""Delivery durability, batched cycle writes, and retention — the three measured
defects of the shipped alert lane.

🔴 DEFECT 1 — A FAILED DELIVERY WAS PERMANENTLY RECORDED AS DELIVERED.
`deliver_alert_payload` claims the fire BEFORE it touches a channel and the claim
was ONE-WAY. Measured with every channel raising: **20 fires → 20/20 rows stamped
`delivered_at`, zero retry, one `_logger.warning` line.** There is no rate
limiter anywhere in this lane, so the first Resend or Discord 429 silently
converts real alerts into "delivered" rows the member never received.

⛔ AND THE OBVIOUS FIX IS WRONG. Moving the claim AFTER the channels trades a
silent drop for a silent DUPLICATE — two cycles would both find the row unclaimed
and both send. So the claim stays exactly where it is and exactly as atomic, and
gains an INVERSE that is reachable only from the frame that won it and only when
nothing was sent. Every "cannot double-send" claim below is asserted across MANY
cycles, never one.

🟠 DEFECT 2 — THE CYCLE PAID ~1,400× MORE THAN IT NEEDED FOR ITS WRITES. Measured
on this box, per row, over 300 rows: full `shadow_record()` 5,383.3 µs · with
`init_schema()` hoisted only 5,049.8 µs · reused connection with a commit per row
501.9 µs · one connection + one `executemany` + one commit **3.9 µs**.

🟠 DEFECT 3 — NO RETENTION, ANYWHERE. `alert_shadow_fires` grows 24/7 with no
market-hours gate: 31 alerts → 15.4 M rows/yr, 10,000 alerts → 279 GB/yr on the
shared `/data` volume.

⛔⛔ AND THE SWEEP MAY NOT EAT THE SOAK. Task 8's cutover gate reads THREE LIVE
SESSIONS of `alert_shadow_fires` (armed on production 2026-08-06 ~17:00 ET, 31
rows visible to `list_active()`, 30 of them observed). A window that could reach
those rows makes the gate pass on an empty set — [[lesson_gate_that_cannot_fail]]
with the evidence deleted rather than never collected. That is asserted here, not
argued, with a control proving the sweep is not simply a no-op.
"""
from __future__ import annotations

import ast
import datetime as _dt
import sqlite3
import time
import zoneinfo

import pytest

from api.services import alert_fired_log as fl
from api.services import alert_shadow_log as shadow
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import watchlist_alert_service as wls


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    monkeypatch.setattr(fl, "_last_fire_prune_at", 0.0, raising=False)
    ias.init_schema()
    return db_path


@pytest.fixture
def tmp_shadow(tmp_path, monkeypatch):
    p = tmp_path / "alert_shadow.db"
    monkeypatch.setenv("ALERT_SHADOW_DB_PATH", str(p))
    monkeypatch.setattr(shadow, "_DB_PATH", str(p))
    monkeypatch.setattr(shadow, "_last_prune_at", 0.0, raising=False)
    monkeypatch.delenv("ALERT_SHADOW_RETENTION_DAYS", raising=False)
    shadow.init_schema()
    return p


def _bars(closes, start_t=1_700_000_000, step=300):
    out = []
    for i, c in enumerate(closes):
        c = float(c)
        out.append({"t": start_t + i * step, "o": c, "h": c * 1.002,
                    "l": c * 0.998, "c": c, "v": 100_000})
    return out


_RISING = _bars([100.0 + i for i in range(80)])


@pytest.fixture
def armed(tmp_db, monkeypatch):
    """One armed alert whose condition is true, on bars that stay true."""
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    aid = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                     condition="above", threshold=50.0, tf="5")
    value, triggered = ev._evaluate_one(ias.get(aid))
    assert triggered is True, (
        "the fixture's condition is not true — every 'was not delivered' "
        "assertion below would then be a statement about an alert that never "
        "fired")
    return aid


@pytest.fixture
def hook(monkeypatch):
    """Replace ONLY the delivery hook, and record what the frame did around it.

    ⛔ THE REAL `deliver_alert_payload` STILL OWNS THE CLAIM in the tests that
    measure the claim; this fixture is for the tests that need the hook to FAIL,
    which is the one thing the shipped hook structurally cannot report (it wraps
    every channel in its own `try/except` and returns `None` either way).
    """
    calls: list = []
    box = {"mode": "ok", "result": None}

    def _hook(**kw):
        calls.append(kw)
        # the claim the shipped hook performs, unchanged, through the real path
        if not ias.claim_delivery((kw.get("extra_data") or {}).get("alert_id")):
            return None
        if box["mode"] == "raise":
            raise RuntimeError("Resend 429 rate limited")
        if box["mode"] == "report_failure":
            return {"channels_ok": 0}
        calls[-1] = dict(kw, _sent=True)
        return box["result"]

    monkeypatch.setattr(wls, "deliver_alert_payload", _hook)
    return {"calls": calls, "box": box,
            "sent": lambda: [c for c in calls if c.get("_sent")]}


# ─── DEFECT 1: a failed delivery is no longer recorded as delivered ──────────

def test_a_delivery_that_RAISES_is_not_recorded_as_delivered_and_is_RETRIED(
        armed, hook):
    """The headline. The row must not say `delivered` when nothing was sent.

    ⭐ AND THE RETRY IS THE OTHER HALF. "visible" without "retryable" leaves the
    member without the alert; "retryable" without "visible" means a fire that
    fails every attempt disappears into a latched row nobody looks at. Both are
    asserted, and the member is told EXACTLY ONCE across the whole sequence.
    """
    hook["box"]["mode"] = "raise"
    ev._run_one_cycle()

    fires = fl.fires_for_alert(armed)
    assert len(fires) == 1, "the cycle did not record a fire at all"
    row = fires[0]
    assert row["delivered_at"] is None, (
        "a delivery that raised is STILL recorded as delivered — this is the "
        "defect: 20 fires, every channel raising, 20/20 rows stamped delivered")
    assert row["delivery_failed_at"] is not None, (
        "the failure left no trace. A released claim is indistinguishable from "
        "a fire nobody has tried yet, so 'not delivered' has to be RECORDED")
    assert row["delivery_attempts"] == 1
    assert "Resend 429" in (row["delivery_error"] or ""), row["delivery_error"]
    assert fl.count_delivered(armed) == 0
    assert fl.delivery_health(armed)["failed"] == 1
    assert [f["id"] for f in fl.delivery_failures(alert_id=armed)] == [row["id"]]

    # ── the retry: the very next cycle, through the SAME unconditional dispatch
    hook["box"]["mode"] = "ok"
    ev._run_one_cycle()

    fires = fl.fires_for_alert(armed)
    assert len(fires) == 1, "the retry recorded a SECOND fire — that is a dup"
    row = fires[0]
    assert row["delivered_at"] is not None, "the released fire was never retried"
    assert row["delivery_failed_at"] is None, (
        "a fire that later succeeded still reads as failed — then "
        "`delivery_failed_at IS NOT NULL` cannot mean 'the member missed one'")
    assert row["delivery_attempts"] == 2
    assert fl.count_delivered(armed) == 1
    assert len(hook["sent"]()) == 1, (
        f"the member was told {len(hook['sent']())} times for ONE fire")


def test_a_hook_that_REPORTS_zero_channels_also_releases_the_lease(armed, hook):
    """The seam for the half that lives in the held file.

    `deliver_alert_payload` swallows each channel's exception and returns `None`
    whether every channel succeeded or every channel raised. The moment it
    reports — a count, a bool, a list — this frame already turns "nothing
    landed" into a released lease, with no further change on this side.
    """
    hook["box"]["mode"] = "report_failure"
    ev._run_one_cycle()

    row = fl.fires_for_alert(armed)[0]
    assert row["delivered_at"] is None and row["delivery_failed_at"] is not None
    assert "every channel refused" in (row["delivery_error"] or "")


@pytest.mark.parametrize("outcome,expected", [
    (None, False),                    # what the shipped hook returns TODAY
    ({}, False),                      # a report with no verdict is not a verdict
    ("delivered", False),             # an unrecognised shape is NOT a failure
    ({"channels_ok": 0}, True),
    ({"channels_ok": 2}, False),
    ({"delivered": False}, True),
    ({"delivered": True}, False),
    ({"ok": []}, True),
    ({"ok": ["bell"]}, False),
])
def test_only_an_EXPLICIT_zero_counts_as_a_failed_delivery(outcome, expected):
    """⛔ "NO REPORT" IS NOT "FAILED", AND THAT ASYMMETRY IS THE SAFETY.

    A frame that read `None` as failure would release and retry EVERY delivery
    — the double-send this whole design exists to make impossible. The negative
    rows here are the ones that matter; the positive ones only prove the check
    can fire at all.
    """
    assert ev._delivery_failed(outcome) is expected


def test_the_lease_is_BOUNDED_so_a_permanently_refusing_provider_stops(armed, hook):
    """After `MAX_DELIVERY_ATTEMPTS` the claim is NOT handed back.

    The row keeps `delivered_at` — which is what latches it shut so
    `claim_delivery` can never select it again — and gains `delivery_failed_at`,
    which is what makes the give-up VISIBLE instead of silent. An unbounded
    retry against a provider that is refusing us is what keeps us refused.
    """
    hook["box"]["mode"] = "raise"
    for _ in range(12):
        ev._run_one_cycle()

    row = fl.fires_for_alert(armed)[0]
    assert row["delivery_attempts"] == fl.MAX_DELIVERY_ATTEMPTS, (
        f"{row['delivery_attempts']} attempts against a ceiling of "
        f"{fl.MAX_DELIVERY_ATTEMPTS} across twelve cycles")
    assert row["delivered_at"] is not None, "the exhausted lease was handed back"
    assert row["delivery_failed_at"] is not None, "the give-up is invisible"
    assert fl.count_delivered(armed) == 0, (
        "a fire that was never delivered is counted as delivered — the metric "
        "reproduces exactly the lie the row no longer tells")
    assert fl.delivery_health(armed)["gave_up"] == 1
    assert len(hook["sent"]()) == 0


def test_a_SUCCESSFUL_delivery_is_still_recorded_as_delivered(armed, hook):
    """The control. Without it, "not delivered" would be true of everything and
    every assertion above would pass on a lane that delivers nothing at all."""
    ev._run_one_cycle()
    row = fl.fires_for_alert(armed)[0]
    assert row["delivered_at"] is not None
    assert row["delivery_failed_at"] is None
    assert row["delivery_attempts"] == 1
    assert fl.count_delivered(armed) == 1
    assert len(hook["sent"]()) == 1


def test_releasing_CANNOT_produce_two_deliveries_of_one_fire(armed, hook):
    """⛔ THE DOUBLE-SEND QUESTION, ASKED ACROSS TWENTY CYCLES.

    The condition stays true throughout, so the evaluator asks for a delivery on
    every one of them. Deliveries fail, are released, are retried, and one
    eventually lands — and the member is told exactly ONCE.
    """
    hook["box"]["mode"] = "raise"
    ev._run_one_cycle()
    ev._run_one_cycle()
    hook["box"]["mode"] = "ok"
    for _ in range(18):
        ev._run_one_cycle()

    assert len(hook["sent"]()) == 1, (
        f"the member was told {len(hook['sent']())} times across 20 cycles of "
        "one continuously-true condition")
    assert len(fl.fires_for_alert(armed)) == 1
    assert fl.count_delivered(armed) == 1
    assert len(hook["calls"]) == 20, (
        "the evaluator stopped ASKING — then 'told once' is a statement about a "
        "cycle that did not run, not about the gate")


def test_release_is_an_INVERSE_COMPARE_AND_SET_so_two_frames_cannot_both_win(
        armed, hook):
    """Two frames releasing one fire produce ONE deliverable row, not two."""
    hook["box"]["mode"] = "raise"
    ev._run_one_cycle()
    fire_id = fl.fires_for_alert(armed)[0]["id"]

    second = fl.release_delivery(fire_id, error="a second frame")
    assert second["released"] is False, (
        "a second release of an already-released fire reported success — two "
        "frames could then manufacture two deliverable rows out of one fire")
    assert fl.release_delivery(None, error="x")["found"] is False
    assert fl.release_delivery(10 ** 9, error="x")["found"] is False


def test_pending_fire_id_names_the_row_the_claim_is_about_to_take(armed):
    """The frame releases the row its OWN dispatch caused to be claimed —
    an inverse compare-and-set, not a guess at 'whatever is newest now'."""
    assert fl.pending_fire_id(armed) is None
    assert ias.record_trigger(armed, last_value=75.0) is True
    fire_id = fl.pending_fire_id(armed)
    assert fire_id == fl.fires_for_alert(armed)[0]["id"]
    assert fl.claim_delivery(armed) is True
    assert fl.pending_fire_id(armed) is None, (
        "a claimed fire is still reported as pending — the next dispatch would "
        "release a row it does not own")


def test_the_claim_is_still_won_EXACTLY_ONCE(tmp_db):
    """The property the whole design rests on, unchanged by the release path."""
    aid = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                     condition="above", threshold=70.0, tf="D")
    assert ias.record_trigger(aid, last_value=75.0) is True
    assert fl.claim_delivery(aid) is True
    assert fl.claim_delivery(aid) is False, "two callers both won one delivery"


def test_THE_HALF_THAT_IS_BLOCKED_BEHIND_THE_HELD_FILE_is_measured_not_assumed(
        armed, monkeypatch):
    """⏳ NAMED, NOT FIXED — and it goes red WITH THE PARAGRAPH IN HAND.

    `watchlist_alert_service.deliver_alert_payload` wraps each channel in its own
    `try/except … _logger.warning` and returns `None`. So with EVERY channel
    raising it returns exactly what it returns on a clean send, and this side
    cannot tell them apart. That file belongs to another agent this session.

    THE ONE CHANGE IT NEEDS: count the channels that succeeded and either return
    that count or raise when it is zero. `_delivery_failed` already consumes
    `{"channels_ok": n}`, `{"delivered": bool}` and `{"ok": [...]}`, so nothing
    on this side has to move.

    When somebody makes that change this test goes red, and it should — with
    this paragraph explaining why, and the deletion is the whole edit.
    """
    monkeypatch.setattr(wls, "add_alert", _raiser("bell down"))
    monkeypatch.setattr(wls, "send_email", _raiser("Resend 429 rate limited"))
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: "u@example.com")

    assert ias.record_trigger(armed, last_value=75.0) is True
    result = wls.deliver_alert_payload(
        user_id="u1", sym="AAPL", title="t", message="m",
        source="indicator_alert", extra_data={"alert_id": armed})

    assert result is None, (
        "deliver_alert_payload now REPORTS its channel outcome. Delete this "
        "test — `_delivery_failed` already consumes the report and releases the "
        "lease, so the remaining half of the failed-delivery defect is closed.")
    assert ev._delivery_failed(result) is False
    assert ev._delivery_failed({"channels_ok": 0}) is True, (
        "the seam that will consume the fix does not work — then 'blocked "
        "behind the held file' is an excuse rather than a measurement")


def _raiser(msg):
    def _fn(*a, **k):
        raise RuntimeError(msg)
    return _fn


def test_the_evaluator_does_not_fire_discord_at_all(armed):
    """⏳ WHICH HALF OF THE DISCORD DOUBLE-FIRE THIS TASK DID NOT TOUCH: BOTH.

    Measured: 2.0 Discord POSTs per fire with `DISCORD_ALERT_WEBHOOK` set, and
    1.0 wasted attempt with it unset. Both posts come from
    `watchlist_alert_service.deliver_alert_payload` / `alerts._fire_discord`,
    and both files belong to the leak-fix agent. This asserts the boundary
    rather than claiming the fix: the evaluator names neither, so nothing here
    can collide with that work.
    """
    src = ast.parse(open(ev.__file__, encoding="utf-8").read())
    names = {n.id for n in ast.walk(src) if isinstance(n, ast.Name)}
    names |= {n.attr for n in ast.walk(src) if isinstance(n, ast.Attribute)}
    strings = {n.value for n in ast.walk(src) if isinstance(n, ast.Constant)
               and isinstance(n.value, str)}
    assert "_fire_discord" not in names
    assert not any("DISCORD" in s for s in strings), (
        "the evaluator now names a Discord webhook — the double-fire has two "
        "halves and this file was not supposed to own either")


# ─── DEFECT 2: the cycle's writes ───────────────────────────────────────────

def test_a_batch_of_rows_costs_ONE_connection_and_ONE_transaction(tmp_shadow,
                                                                  monkeypatch):
    """⭐ THE MEASUREMENT, AS A STRUCTURAL ASSERTION.

    The per-row cost was a fresh SQLite connection (plus two PRAGMAs, plus a
    full `init_schema()` executescript) and an `fsync`ing commit, per row, per
    cycle. Timings move between boxes; "how many connections did 500 rows cost"
    does not.
    """
    real_conn = shadow._conn
    opened: list = []

    def _spy():
        opened.append(1)
        return real_conn()

    monkeypatch.setattr(shadow, "_conn", _spy)
    rows = [shadow._row_tuple(1, i, 1.0 * i, i % 2 == 0) for i in range(500)]
    assert shadow.shadow_record_many(rows) == 500
    assert len(opened) == 1, (
        f"500 rows opened {len(opened)} connections — the review measured this "
        "at 5,383 µs/row against 3.9 µs for one connection and one commit")
    assert len(shadow.shadow_rows(limit=1000)) == 500


def test_init_schema_is_NOT_run_once_per_row(tmp_shadow, monkeypatch):
    """The hoist, asserted on the call count rather than on a stopwatch.

    ⚠️ AND THE SCALE REVIEW'S ATTRIBUTION WAS WRONG, MEASURED: hoisting
    `init_schema()` alone takes 5,383.3 µs → 5,049.8 µs, a **6 %** saving, not
    "the whole 5,757 µs". The connection is the cost. Landing only the
    recommended one-liner would have left 94 % of the bill in place while
    reading as done — which is why the batch is here too.
    """
    calls: list = []
    real = shadow.init_schema
    monkeypatch.setattr(shadow, "init_schema",
                        lambda: (calls.append(1), real())[1])
    shadow._INITED.discard(shadow._DB_PATH)
    for i in range(50):
        shadow.shadow_record(1, i, 1.0 * i, True)
    assert len(calls) == 1, (
        f"init_schema ran {len(calls)} times for 50 rows — a full executescript "
        "of one CREATE TABLE and two CREATE INDEX statements, on its own fresh "
        "connection, per row")
    assert len(shadow.shadow_rows(limit=100)) == 50


def test_a_batched_cycle_still_isolates_a_RAISING_alert(tmp_db, tmp_shadow,
                                                        monkeypatch):
    """⛔ ONLY THE WRITE IS BATCHED. A bad row still costs exactly its own row.

    Error isolation per alert is what let a raising compute never abort a cycle;
    batching the transaction must not trade it away. The group's other rows land
    and the errors counter names the one that did not.
    """
    monkeypatch.setenv("ALERT_SHADOW_ENABLED", "1")
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    ids = [ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                      condition="above", threshold=float(t), tf="5")
           for t in (10, 20, 30)]
    bad = ids[1]
    real_eval = ev._evaluate_one_closed

    def _flaky(alert, **kw):
        if alert["id"] == bad:
            raise RuntimeError("a compute blew up")
        return real_eval(alert, **kw)

    monkeypatch.setattr(ev, "_evaluate_one_closed", _flaky)
    summary = shadow.run_shadow_cycle()

    assert summary["errors"] == 1
    assert summary["written"] == 2, (
        "the batch lost the whole group when one alert raised — that is the "
        "isolation the per-row write had and the batch must keep")
    assert {r["alert_id"] for r in shadow.shadow_rows(limit=100)} == set(ids) - {bad}


def test_the_cycle_reports_what_it_WROTE_not_only_what_it_evaluated(
        tmp_db, tmp_shadow, monkeypatch):
    """A batch that silently dropped its rows would leave `evaluated` intact."""
    monkeypatch.setenv("ALERT_SHADOW_ENABLED", "1")
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    for t in (10, 20, 30):
        ias.create(user_id="u1", sym="AAPL", indicator="rsi", condition="above",
                   threshold=float(t), tf="5")
    summary = shadow.run_shadow_cycle()
    assert summary["evaluated"] == 3
    assert summary["written"] == 3 == len(shadow.shadow_rows(limit=100))


# ─── DEFECT 3: retention, and the soak it may not eat ───────────────────────

# The production soak: `tools/alert_soak_matrix.py --arm` was run on the pod on
# 2026-08-06 ~17:00 ET — 31 armed, 31 visible to `list_active()`, deliverable_now
# 0 — and Task 8's gate reads THREE LIVE SESSIONS of the shadow rows it produces.
# Three sessions from a Friday arming reach the following Wednesday, so the
# widest honest reading of the span is a calendar week, not three days.
_SOAK_ARMED_ET = _dt.datetime(2026, 8, 6, 17, 0,
                              tzinfo=zoneinfo.ZoneInfo("America/New_York"))
_SOAK_SPAN_DAYS = 7


def _seed_shadow(ages_days, now):
    rows = [shadow._row_tuple(1, i, 1.0 * i, True,
                              recorded_at=int(now - d * 86400))
            for i, d in enumerate(ages_days)]
    shadow.shadow_record_many(rows)


def test_the_retention_window_CANNOT_EAT_THE_SOAK(tmp_shadow):
    """⛔⛔ THE ONE THE CUTOVER DEPENDS ON.

    Rows spanning the whole soak — the arming instant and every day of the three
    sessions Task 8 reads — survive the shipped default, and the assertion is on
    the SURVIVORS by identity, not on a count.

    ⚠️ AND THE CONTROL IS WHAT MAKES IT MEAN ANYTHING: a row older than the
    window IS deleted in the same call. Without it, a sweep that deleted nothing
    at all would satisfy every assertion here.
    """
    now = time.time()
    soak_ages = list(range(_SOAK_SPAN_DAYS + 1))
    older = shadow.DEFAULT_RETENTION_DAYS + 5
    _seed_shadow(soak_ages + [older], now)
    assert len(shadow.shadow_rows(limit=100)) == len(soak_ages) + 1

    out = shadow.prune_shadow(now=now)

    survivors = {r["recorded_at"] for r in shadow.shadow_rows(limit=100)}
    for d in soak_ages:
        assert int(now - d * 86400) in survivors, (
            f"the sweep deleted a shadow row {d} day(s) old. Task 8's cutover "
            f"gate reads three live sessions of this table; a window that "
            f"reaches them makes that gate pass on an EMPTY SET.")
    assert out["deleted"] == 1, (
        "the sweep deleted nothing at all — then 'the soak survives' is true of "
        "a no-op and this test measures nothing")
    assert int(now - older * 86400) not in survivors
    assert shadow.DEFAULT_RETENTION_DAYS > _SOAK_SPAN_DAYS, (
        f"the default window ({shadow.DEFAULT_RETENTION_DAYS}d) is not wider "
        f"than the soak span ({_SOAK_SPAN_DAYS}d)")


def test_a_MISCONFIGURED_window_is_refused_not_obeyed(tmp_shadow, monkeypatch):
    """A knob whose smallest legal value still cannot reach the evidence.

    `ALERT_SHADOW_RETENTION_DAYS=1` would delete the soak. It is refused and the
    floor is used — and the floor is asserted to be wider than the soak span, so
    NO reachable configuration can eat the gate's evidence.
    """
    now = time.time()
    monkeypatch.setenv("ALERT_SHADOW_RETENTION_DAYS", "1")
    assert shadow.retention_days() == shadow._MIN_RETENTION_DAYS
    assert shadow._MIN_RETENTION_DAYS >= _SOAK_SPAN_DAYS, (
        "the retention FLOOR can reach three shadow sessions — a mis-set "
        "environment variable would silently empty Task 8's cutover gate")

    _seed_shadow([0, 3, _SOAK_SPAN_DAYS], now)
    assert shadow.prune_shadow(now=now)["deleted"] == 0

    monkeypatch.setenv("ALERT_SHADOW_RETENTION_DAYS", "not-a-number")
    assert shadow.retention_days() == shadow.DEFAULT_RETENTION_DAYS
    monkeypatch.setenv("ALERT_SHADOW_RETENTION_DAYS", "45")
    assert shadow.retention_days() == 45


def test_the_sweep_uses_the_index_that_was_already_paid_for(tmp_shadow):
    """`idx_alert_shadow_at` is queried by NOTHING else in api/, tools/ or
    tests/ — today it is pure write amplification, and it is exactly the shape a
    `DELETE … WHERE recorded_at < ?` needs. Derived from `sqlite_master`, never
    typed: a probe naming a table or index by hand has cried wolf four times on
    this branch."""
    con = sqlite3.connect(str(tmp_shadow))
    try:
        table = con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%'").fetchone()[0]
        cols = [r[1] for r in con.execute(f"PRAGMA table_info({table})")]
        indexes = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?",
            (table,)) if r[0]}
        ts_col = next(c for c in cols if c.endswith("_at"))
        plan = " ".join(str(r) for r in con.execute(
            f"EXPLAIN QUERY PLAN DELETE FROM {table} WHERE {ts_col} < 0"))
    finally:
        con.close()
    assert any(ix in plan for ix in indexes), (
        f"the retention DELETE does not use an index: {plan}")
    assert "SCAN" not in plan.upper() or "INDEX" in plan.upper(), plan


def test_the_shadow_sweep_rides_the_cycle_and_is_THROTTLED(tmp_db, tmp_shadow,
                                                           monkeypatch):
    """A prune with no caller is a ledger door nobody opened — but a prune on
    every 60-second cycle is a DELETE a minute against the volume it protects."""
    monkeypatch.setenv("ALERT_SHADOW_ENABLED", "1")
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    ias.create(user_id="u1", sym="AAPL", indicator="rsi", condition="above",
               threshold=10.0, tf="5")
    now = time.time()
    _seed_shadow([shadow.DEFAULT_RETENTION_DAYS + 3], now)

    shadow._last_prune_at = 0.0
    first = shadow.run_shadow_cycle()
    assert first["pruned"] == 1, "the cycle did not sweep at all"

    _seed_shadow([shadow.DEFAULT_RETENTION_DAYS + 4], now)
    second = shadow.run_shadow_cycle()
    assert second["pruned"] == 0, (
        "the sweep ran twice inside the throttle window — one DELETE per "
        "60-second cycle against the shared /data volume")
    assert shadow._maybe_prune(now=shadow._last_prune_at
                               + shadow._PRUNE_EVERY_SEC + 1)["deleted"] == 1


def test_a_failing_sweep_can_NEVER_abort_the_cycle(tmp_db, tmp_shadow,
                                                   monkeypatch):
    """A retention sweep that could kill the soak it exists to bound would be a
    worse defect than the growth."""
    monkeypatch.setenv("ALERT_SHADOW_ENABLED", "1")
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    ias.create(user_id="u1", sym="AAPL", indicator="rsi", condition="above",
               threshold=10.0, tf="5")
    monkeypatch.setattr(shadow, "prune_shadow", _raiser("disk on fire"))
    shadow._last_prune_at = 0.0
    summary = shadow.run_shadow_cycle()
    assert summary["evaluated"] == 1 and summary["written"] == 1
    assert summary["pruned"] == 0


def test_shadow_stats_makes_the_growth_VISIBLE(tmp_shadow):
    now = time.time()
    _seed_shadow([0, 1, 2], now)
    s = shadow.shadow_stats()
    assert s["rows"] == 3 and s["distinct_alerts"] == 1
    assert s["retention_days"] == shadow.DEFAULT_RETENTION_DAYS
    assert s["oldest_recorded_at"] < s["newest_recorded_at"]


# ─── DEFECT 3, the other table: indicator_alert_fires lives in auth.db ──────

def _seed_fire(aid, n, *, age_days, delivered=True, failed=False, now=None):
    now = time.time() if now is None else now
    fl.record_fire(aid, "u1", "AAPL", "rsi", "above", "D", f"ep:{n}", 70.0 + n,
                   fired_at=now - age_days * 86400)
    row = fl.fires_for_alert(aid, 500)[0]
    with sqlite3.connect(fl.db_path()) as c:
        c.execute("UPDATE indicator_alert_fires SET delivered_at=?, "
                  "delivery_failed_at=? WHERE id=?",
                  (now if delivered else None,
                   now if failed else None, row["id"]))
    return row["id"]


def test_the_fire_sweep_keeps_PENDING_and_FAILED_fires_forever(tmp_db):
    """⛔ IT MAY NOT DELETE THE EVIDENCE THIS TASK EXISTS TO CREATE.

    A pending fire is deliverable and deleting it would silence it. A row
    carrying `delivery_failed_at` IS the record that a member missed an alert,
    and a defect whose only evidence has been swept is a defect nobody can
    report. Both are far older than the window, and both survive.

    🔴 THE ORDERING IS LOAD-BEARING AND THE FIRST VERSION OF THIS TEST DID NOT
    HAVE IT. With the failed row seeded LAST it was the newest, so the
    keep-newest-N clause protected it and the `delivery_failed_at IS NULL`
    clause was never exercised — deleting that clause left this test GREEN
    (measured: M6 SURVIVED). The protected rows are now the OLDEST by id and a
    younger delivered row occupies the keep slot, so each clause is the only
    thing standing between its row and the DELETE.
    """
    aid = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                     condition="above", threshold=70.0, tf="D")
    old = fl.FIRE_RETENTION_DAYS + 30
    failed = _seed_fire(aid, 1, age_days=old, failed=True)
    pending = _seed_fire(aid, 2, age_days=old, delivered=False)
    sweepable = _seed_fire(aid, 3, age_days=old)
    newest = _seed_fire(aid, 4, age_days=old)

    out = fl.prune_fires(keep_per_alert=1)

    kept = {r["id"] for r in fl.fires_for_alert(aid, 500)}
    assert newest in kept, "the keep-newest-N slot is not occupied by `newest`"
    assert pending in kept, "the sweep deleted a DELIVERABLE fire"
    assert failed in kept, "the sweep deleted the record of a missed alert"
    assert sweepable not in kept, (
        "the sweep deleted nothing — then 'pending and failed survive' is true "
        "of a no-op")
    assert out["deleted"] == 1


def test_the_fire_sweep_keeps_the_newest_N_of_EVERY_alert_however_old(tmp_db):
    """"my alert has never fired" and "my alert's history was pruned" look
    identical to the person reading it. A rarely-firing alert keeps its tail."""
    aid = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                     condition="above", threshold=70.0, tf="D")
    old = fl.FIRE_RETENTION_DAYS + 400
    ids = [_seed_fire(aid, n, age_days=old) for n in range(6)]
    fl.prune_fires(keep_per_alert=2)
    kept = [r["id"] for r in fl.fires_for_alert(aid, 500)]
    assert kept == ids[-2:][::-1], kept


def test_the_fire_sweep_keeps_everything_INSIDE_the_window(tmp_db):
    aid = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                     condition="above", threshold=70.0, tf="D")
    for n in range(5):
        _seed_fire(aid, n, age_days=fl.FIRE_RETENTION_DAYS - 1)
    assert fl.prune_fires(keep_per_alert=1)["deleted"] == 0
    assert len(fl.fires_for_alert(aid, 500)) == 5


def test_the_fire_sweep_rides_record_fire_and_is_THROTTLED(tmp_db, monkeypatch):
    aid = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                     condition="above", threshold=70.0, tf="D")
    calls: list = []
    monkeypatch.setattr(fl, "prune_fires",
                        lambda **kw: (calls.append(kw), {"deleted": 0})[1])
    fl._last_fire_prune_at = 0.0
    for n in range(5):
        fl.record_fire(aid, "u1", "AAPL", "rsi", "above", "D", f"ep:{n}", 70.0)
    assert len(calls) == 1, (
        f"the sweep ran {len(calls)} times for 5 fires — it is throttled to "
        "once per 6 h, not once per write")


def test_a_failing_fire_sweep_can_NEVER_lose_a_fire(tmp_db, monkeypatch):
    aid = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                     condition="above", threshold=70.0, tf="D")
    monkeypatch.setattr(fl, "prune_fires", _raiser("disk on fire"))
    fl._last_fire_prune_at = 0.0
    assert fl.record_fire(aid, "u1", "AAPL", "rsi", "above", "D", "ep:0", 70.0) is True
    assert fl.count_fires(aid) == 1


def test_the_migration_reaches_a_table_that_already_exists(tmp_path, monkeypatch):
    """⛔ `CREATE TABLE IF NOT EXISTS` IS A NO-OP ON EVERY BOX THAT ALREADY HAS
    THE TABLE, which is every box after the first deploy. The ALTERs are the
    only thing that reaches production's existing `indicator_alert_fires`."""
    db_path = tmp_path / "auth.db"
    con = sqlite3.connect(str(db_path))
    con.executescript("""
        CREATE TABLE indicator_alert_fires (
          id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id INTEGER NOT NULL,
          user_id TEXT NOT NULL, sym TEXT NOT NULL, indicator TEXT NOT NULL,
          condition TEXT NOT NULL, tf TEXT NOT NULL, fire_key TEXT NOT NULL,
          bar_time INTEGER, value REAL NOT NULL, threshold REAL,
          fired_at REAL NOT NULL, delivered_at REAL,
          UNIQUE(alert_id, fire_key));
    """)
    con.execute("INSERT INTO indicator_alert_fires (alert_id,user_id,sym,"
                "indicator,condition,tf,fire_key,value,fired_at) "
                "VALUES (7,'u1','AAPL','rsi','above','D','ep:0',70.0,1700000000)")
    con.commit()
    con.close()

    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    fl._INITED.discard(str(db_path))
    fl.init_schema()

    row = fl.fires_for_alert(7)[0]
    assert row["delivery_attempts"] == 0, "the existing row migrated to NULL"
    assert row["delivery_failed_at"] is None
    assert row["value"] == 70.0, "the migration lost the existing history"
    assert fl.claim_delivery(7) is True
    assert fl.fires_for_alert(7)[0]["delivery_attempts"] == 1
