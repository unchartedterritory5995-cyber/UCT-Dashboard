"""Phase C Task 11 — fire-once, re-arm, snooze, the fired log, and the end of silence.

🔴 THE DEFECT UNDER TEST. `above`/`below` are LEVEL conditions (`current >
threshold`, no reference to `prev`) and `record_trigger` bumped a counter and
never deactivated, so an armed alert re-delivered bell + email + Discord on
EVERY 60-second poll for as long as the condition stayed true. Task 6 priced it
on real tape: `above`/`below` are 373,748 of the 388,808 fires the closed-bar
cutover removes, 96.1 %. It is latent, not live — prod's `indicator_alerts`
table has zero rows — and it goes live the moment one member arms one alert.

⚠️ "FIRED ONCE" IS A VACUOUS ASSERTION IF THE CONDITION WAS TRUE FOR EXACTLY ONE
CYCLE. Every quiet claim in this file is made across MANY consecutive cycles on
which the condition is asserted still true, and the re-fire is only ever claimed
after a genuine re-cross.
"""
import ast
import contextlib

import time

import pytest

from api.services import alert_fired_log as fl
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import watchlist_alert_service as wls
from api.services.alert_conditions import check_condition


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    ias.init_schema()
    return db_path


@pytest.fixture
def channels(monkeypatch):
    """Two counters that answer two DIFFERENT questions.

    ``invoked`` — how many times the evaluator ASKED for a delivery. That is
    once per cycle on which the condition was true, and it stays high: nothing
    in this task stops the evaluator asking.

    ``delivered`` — how many times a member was actually told, spied at
    `add_alert`, the in-app bell, which is the first channel INSIDE
    `deliver_alert_payload` and therefore downstream of the fire-once gate.

    ⛔ A SPY THAT REPLACES `deliver_alert_payload` WOULD REPLACE THE GATE and
    every assertion in this file would pass on a tree with no fix in it at all.
    The wrapper calls the real one.
    """
    delivered: list = []
    invoked: list = []
    monkeypatch.setattr(wls, "add_alert", lambda *a, **k: delivered.append((a, k)))
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    import api.services.alerts as _alerts
    monkeypatch.setattr(_alerts, "_fire_discord", lambda payload: None)

    real = wls.deliver_alert_payload

    def _wrapped(**kw):
        invoked.append(kw)
        return real(**kw)

    monkeypatch.setattr(wls, "deliver_alert_payload", _wrapped)
    return {"delivered": delivered, "invoked": invoked}


def _bars(closes, start_t=1_700_000_000, step=300):
    out = []
    for i, c in enumerate(closes):
        c = float(c)
        out.append({"t": start_t + i * step, "o": c, "h": c * 1.002,
                    "l": c * 0.998, "c": c, "v": 100_000})
    return out


# A monotonic rise pins RSI at its ceiling; a long decline drags it to the floor.
# Both are asserted against the real value function before anything is claimed.
_RISING = _bars([100.0 + i for i in range(80)])
_FALLING = _bars([100.0 + i for i in range(40)] + [140.0 - 2.0 * i for i in range(1, 41)])


def _parse_module(mod) -> ast.Module:
    """A FRESH parse of a module's file on disk.

    ⛔ NEVER `inspect.getsource(fn)` IN THIS TREE. It slices the file at the line
    numbers captured when the module was IMPORTED, and a co-worker inserting
    ~180 lines above the target hands back the wrong slice — measured for real
    on this branch, where it reported a call site missing that was right there.
    """
    with open(mod.__file__, "r", encoding="utf-8") as fh:
        return ast.parse(fh.read())


def _function_named(mod, name: str) -> ast.FunctionDef:
    """The FunctionDef by NAME, from a fresh parse. Cannot drift."""
    for node in ast.walk(_parse_module(mod)):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{name} is not defined in {mod.__name__}")


@contextlib.contextmanager
def _no_tzdata():
    """A box with no IANA tz database, via the module's OWN memoised failure.

    Not a fake: `_et_zone` caches its failure in `_ET_ZONE_ERROR` and raises
    `RuntimeError` from it on every later call, which is exactly the state a
    box without `tzdata` reaches after its first VWAP computation.
    """
    import api.services.indicator_compute as ic
    zone, err = ic._ET_ZONE, ic._ET_ZONE_ERROR
    ic._ET_ZONE = None
    ic._ET_ZONE_ERROR = (
        "compute_vwap needs the IANA tz database to anchor sessions on the ET "
        "calendar day (pip install tzdata). Bucketing by UTC instead is the "
        "retired VWAP_SESSION_ANCHOR defect, measured at $14.45 at a session open.")
    try:
        yield
    finally:
        ic._ET_ZONE, ic._ET_ZONE_ERROR = zone, err


# ─── ⭐ THE MEASUREMENT: quiet across many true cycles, loud after a re-cross ──

def test_the_alert_stays_quiet_across_TWELVE_TRUE_cycles_and_refires_only_after_a_real_recross(
        tmp_db, channels, monkeypatch):
    """The whole task, through the REAL cycle, on a REAL indicator.

    Twelve cycles on which RSI is genuinely above 70 — asserted, not assumed —
    then one cycle below (the re-arm), then twelve more above. Before this task
    that was 24 emails; the claim is 2.
    """
    assert ev.address_value("rsi", _RISING, {}) > 70, "the rising fixture does not trigger"
    assert ev.address_value("rsi", _FALLING, {}) < 70, "the falling fixture still triggers"

    holder = {"bars": _RISING}
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in holder["bars"]])

    aid = ias.create(user_id="u1", sym="TEST", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")

    for _ in range(12):
        ev._run_one_cycle()

    # ⚠️ NON-VACUITY: the condition is STILL true. Without this the "quiet" below
    # could be a statement about an alert that simply stopped being triggered.
    _value, triggered = ev._evaluate_one(ias.get(aid), bars=_RISING)
    assert triggered is True, "the condition stopped being true — 'quiet' would mean nothing"

    assert len(channels["invoked"]) == 12, "the evaluator did not ask 12 times"
    assert len(channels["delivered"]) == 1, (
        f"the member was told {len(channels['delivered'])} times across 12 "
        "consecutive true cycles — this is the defect")

    row = ias.get(aid)
    assert row["state"] == "fired"
    assert row["arm_epoch"] == 0
    assert row["trigger_count"] == 1
    assert fl.count_fires(aid) == 1

    # ── the re-cross: one cycle on which the condition is FALSE ──
    holder["bars"] = _FALLING
    ev._run_one_cycle()
    row = ias.get(aid)
    assert row["state"] == "armed", "a condition observed false did not re-arm the alert"
    assert row["arm_epoch"] == 1, "the re-arm did not move the episode — the key would collide"
    assert len(channels["delivered"]) == 1

    # ── and back above: it speaks again, ONCE, across another twelve ──
    holder["bars"] = _RISING
    for _ in range(12):
        ev._run_one_cycle()

    assert len(channels["delivered"]) == 2, (
        f"{len(channels['delivered'])} deliveries after the re-cross; expected "
        "exactly one more")
    assert len(channels["invoked"]) == 24, "the evaluator's own call count moved"
    assert ias.get(aid)["trigger_count"] == 2

    fires = fl.fires_for_alert(aid)
    assert [f["fire_key"] for f in fires] == ["ep:1", "ep:0"], (
        "the two fires are not two distinct armed episodes")
    assert all(f["delivered_at"] is not None for f in fires)


def test_deliver_alert_payload_reaches_a_member_EXACTLY_ONCE_per_RECORDED_fire(
        tmp_db, channels, monkeypatch):
    """The non-measurement assertion, asserted on the spy and not on the log.

    A history that records twice and delivers once is a reporting bug. A history
    that records once and delivers twice is the failure that reaches the user.
    Both are refused by comparing the two counts, which is only meaningful
    because the spy sits downstream of the gate.
    """
    holder = {"bars": _RISING}
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in holder["bars"]])
    aid = ias.create(user_id="u1", sym="TEST", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")

    for run in range(3):
        for _ in range(5):
            ev._run_one_cycle()
        holder["bars"] = _FALLING
        ev._run_one_cycle()
        holder["bars"] = _RISING

    assert fl.count_fires(aid) == 3, "three armed episodes should record three fires"
    assert fl.count_delivered(aid) == 3
    assert len(channels["delivered"]) == fl.count_delivered(aid)
    assert len(channels["invoked"]) > len(channels["delivered"]), (
        "the evaluator asked no more often than it delivered — the gate is not "
        "being exercised at all")


# ─── the key: a level is an episode, a cross is a bar ────────────────────────

def test_a_cross_fires_once_per_BAR_but_a_new_bar_does_NOT_rearm_a_LEVEL(tmp_db):
    """The two families, and why they cannot share one key.

    `cross_zero` can be true on two CONSECUTIVE bars (up on i, down on i+1 —
    one `s[i] > 0` away from reachable), with no non-crossing bar in between to
    re-arm on. Keying it on the armed episode would swallow a real second
    crossing. `above` is the opposite: it is true continuously, so keying it on
    the bar would still be a stream of identical alerts.
    """
    edge = ias.create(user_id="u1", sym="TEST", indicator="macd",
                      condition="cross_zero", threshold=None, tf="5")
    assert ias.record_trigger(edge, 0.5, bar_time=20260805) is True
    assert ias.record_trigger(edge, 0.6, bar_time=20260805) is False, "same bar, twice"
    assert ias.record_trigger(edge, -0.4, bar_time=20260806) is True, (
        "a genuine crossing on the NEXT bar was swallowed")

    level = ias.create(user_id="u1", sym="TEST", indicator="rsi",
                       condition="above", threshold=70.0, tf="5")
    assert ias.record_trigger(level, 75.0, bar_time=20260805) is True
    assert ias.record_trigger(level, 76.0, bar_time=20260806) is False, (
        "a new bar re-armed a level condition — that is one alert per bar, "
        "which is the defect at a slower cadence")


def test_a_cross_cannot_be_true_on_two_consecutive_FORMING_cycles():
    """Why `bar_time=None` is safe on the lane that is live today.

    The forming lane's `prev` is the value the PREVIOUS poll wrote back, so a
    cycle that fires `cross_above` leaves `prev > threshold` — and `cross_above`
    requires `prev <= threshold`. Swept over a grid rather than asserted on one
    hand-picked pair.
    """
    thr = 70.0
    fired_twice = []
    for prev in [x / 2 for x in range(120, 160)]:
        for cur in [x / 2 for x in range(120, 160)]:
            if check_condition("cross_above", cur, prev, thr):
                # the cycle writes `cur` back; can the NEXT one fire too?
                for nxt in [x / 2 for x in range(120, 160)]:
                    if check_condition("cross_above", nxt, cur, thr):
                        fired_twice.append((prev, cur, nxt))
    assert fired_twice == [], f"cross_above fired on consecutive cycles: {fired_twice[:3]}"


def test_the_condition_kind_table_covers_every_condition_check_condition_HANDLES():
    """Derived from `check_condition`'s OWN SOURCE, never from a list.

    A table that only covers what somebody remembered to list is a list, not a
    rail — that is precisely how four `dpc` constants rode uncovered for the
    entire life of the constants rule. A condition added to `check_condition`
    without a re-arm rule fails HERE, naming itself.
    """
    import api.services.alert_conditions as ac
    fn = _function_named(ac, "check_condition")
    handled = set()
    for node in ast.walk(fn):
        if (isinstance(node, ast.Compare) and isinstance(node.left, ast.Name)
                and node.left.id == "condition"):
            for c in node.comparators:
                if isinstance(c, ast.Constant) and isinstance(c.value, str):
                    handled.add(c.value)
    assert len(handled) >= 7, (
        f"the AST scan found only {handled} — it is measuring nothing")
    # ⚠️ the scan reads THAT BODY and not the whole module: a sibling function
    # in the same file must contribute nothing.
    other = _function_named(ac, "resolve_operand")
    assert other is not fn
    assert handled == set(fl.CONDITION_KIND), (
        f"uncovered by CONDITION_KIND: {sorted(handled - set(fl.CONDITION_KIND))}; "
        f"declared but not handled: {sorted(set(fl.CONDITION_KIND) - handled)}")
    assert set(fl.CONDITION_KIND.values()) == {fl.KIND_LEVEL, fl.KIND_EDGE}


# ─── the log: idempotent, and it never lies about a dropped write ────────────

def test_record_fire_is_idempotent_on_its_key(tmp_db):
    common = dict(alert_id=1, user_id="u1", sym="TEST", indicator="rsi",
                  condition="above", tf="5", key="ep:0", value=75.0)
    assert fl.record_fire(**common) is True
    assert fl.record_fire(**common) is False
    assert fl.count_fires(1) == 1
    assert fl.record_fire(**{**common, "key": "ep:1"}) is True
    assert fl.count_fires(1) == 2


@pytest.mark.parametrize("bad", [
    {"user_id": ""}, {"sym": ""}, {"indicator": ""}, {"condition": ""},
    {"tf": ""}, {"key": ""}, {"user_id": None}, {"value": float("nan")},
    {"value": "not a number"}, {"alert_id": 0}, {"alert_id": "x"},
    {"threshold": float("inf")},
])
def test_a_dropped_write_RAISES_and_is_never_reported_as_a_duplicate(tmp_db, bad):
    """⛔ THE ONE LIE THIS STORE CANNOT SURVIVE.

    `sqlite3.IntegrityError` is the parent of BOTH the UNIQUE failure and the
    NOT NULL failure. If a NOT NULL failure returned False, the caller would
    read it as "already fired" and the alert would go silent for the rest of its
    armed episode — a member's alert muted with nothing anywhere saying so.
    Every refusal is a ValueError, and it happens BEFORE the database is
    touched, so a refused fire leaves no trace.
    """
    good = dict(alert_id=1, user_id="u1", sym="TEST", indicator="rsi",
                condition="above", tf="5", key="ep:0", value=75.0)
    before = fl.count_fires()
    with pytest.raises(ValueError):
        fl.record_fire(**{**good, **bad})
    assert fl.count_fires() == before, "a refused fire left a row behind"


def test_a_NOT_NULL_failure_RAISES_and_is_never_reported_as_a_duplicate(tmp_db, monkeypatch):
    """The sqlite-level half of the same lie, driven at the branch that decides it.

    `sqlite3.IntegrityError` is the parent of BOTH failures. The pre-flight
    validation above means a NOT NULL cannot normally be reached — so this drives
    the branch directly, because a branch nothing exercises is a branch anybody
    can quietly turn into `return False`, and False here means "stay quiet".
    """
    import sqlite3

    class _Boom:
        def execute(self, *a, **k):
            raise sqlite3.IntegrityError(
                "NOT NULL constraint failed: indicator_alert_fires.user_id")

        def commit(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(fl, "_ensure_init", lambda: None)
    monkeypatch.setattr(fl, "_connect", lambda: _Boom())
    with pytest.raises(sqlite3.IntegrityError):
        fl.record_fire(alert_id=1, user_id="u1", sym="TEST", indicator="rsi",
                       condition="above", tf="5", key="ep:0", value=75.0)


def test_claim_delivery_is_won_exactly_once_and_fails_OPEN_when_unidentifiable(tmp_db):
    aid = ias.create(user_id="u1", sym="TEST", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")
    assert ias.record_trigger(aid, 75.0) is True
    assert fl.claim_delivery(aid) is True
    assert fl.claim_delivery(aid) is False, "two callers both won one delivery"
    # An unidentifiable payload delivers: a duplicate is visible and reportable,
    # a suppressed alert is neither.
    assert ias.claim_delivery(None) is True


def test_deleting_an_alert_takes_its_history_with_it(tmp_db):
    """SQLite reissues rowids. An orphaned history would hand the NEXT alert to
    take this id its predecessor's fire keys, and it would start life already
    fired — silent, and impossible to diagnose from the row."""
    aid = ias.create(user_id="u1", sym="TEST", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")
    assert ias.record_trigger(aid, 75.0) is True
    assert fl.count_fires(aid) == 1
    ias.delete(aid)
    assert fl.count_fires(aid) == 0


def test_list_fires_is_per_user(tmp_db):
    a1 = ias.create(user_id="u1", sym="AAA", indicator="rsi",
                    condition="above", threshold=70.0, tf="5")
    a2 = ias.create(user_id="u2", sym="BBB", indicator="rsi",
                    condition="above", threshold=70.0, tf="5")
    ias.record_trigger(a1, 75.0)
    ias.record_trigger(a2, 76.0)
    assert [f["alert_id"] for f in ias.list_fires("u1")] == [a1]
    assert [f["alert_id"] for f in ias.list_fires("u2")] == [a2]


# ─── snooze: honoured to the cycle, on the cycle's own clock ─────────────────

def test_a_snoozed_alert_is_silent_for_the_WHOLE_window_and_speaks_at_its_END(tmp_db):
    """⛔ COMPARED AGAINST THE TIME IT WAS HANDED, NOT THE WALL CLOCK.

    Every minute of a 15-minute window is checked, plus the second before the
    boundary and the boundary itself. A snooze that read `time.time()` at the
    comparison could not be tested at the boundary at all — the test would have
    to sleep, and a test that sleeps for fifteen minutes is a test nobody runs.
    """
    aid = ias.create(user_id="u1", sym="TEST", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")
    t0 = 1_700_000_000
    assert ias.record_trigger(aid, 75.0, now=t0) is True
    ias.snooze(aid, 15, now=t0)
    assert ias.get(aid)["snooze_until"] == t0 + 900

    for minute in range(1, 15):
        assert ias.record_trigger(aid, 75.0, now=t0 + minute * 60) is False, (
            f"the alert spoke {minute} minutes into a 15-minute snooze")
    assert ias.record_trigger(aid, 75.0, now=t0 + 900 - 1) is False, (
        "the alert spoke one second before the window closed")
    assert fl.count_fires(aid) == 1, (
        "a snoozed trigger was RECORDED — that consumes the episode's key and "
        "the alert would be mute forever once the snooze expired")

    assert ias.record_trigger(aid, 75.0, now=t0 + 900) is True, (
        "the alert never came back — a snooze that does not expire is a delete")
    row = ias.get(aid)
    assert row["state"] == "fired"
    assert row["arm_epoch"] == 1
    assert fl.count_fires(aid) == 2


def test_an_expired_snooze_rearms_through_record_evaluation_too(tmp_db):
    aid = ias.create(user_id="u1", sym="TEST", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")
    t0 = 1_700_000_000
    ias.snooze(aid, 5, now=t0)
    assert ias.record_evaluation(aid, 40.0, now=t0 + 60) is False
    assert ias.get(aid)["state"] == "snoozed"
    assert ias.record_evaluation(aid, 40.0, now=t0 + 300) is True
    assert ias.get(aid)["state"] == "armed"


@pytest.mark.parametrize("minutes", [0, -1, ias.SNOOZE_MAX_MINUTES + 1, "x", None])
def test_an_out_of_range_snooze_is_REFUSED_not_clamped(tmp_db, minutes):
    """A silently clamped snooze is a user who believes an alert is off and a
    system that thinks it is on."""
    aid = ias.create(user_id="u1", sym="TEST", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")
    with pytest.raises(ValueError):
        ias.snooze(aid, minutes)
    assert ias.get(aid)["state"] == "armed"


def test_a_manual_rearm_moves_the_episode(tmp_db):
    aid = ias.create(user_id="u1", sym="TEST", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")
    assert ias.record_trigger(aid, 75.0) is True
    assert ias.record_trigger(aid, 75.0) is False
    ias.rearm(aid)
    assert ias.get(aid)["arm_epoch"] == 1
    assert ias.record_trigger(aid, 75.0) is True


# ─── ⭐ needs_attention: the tzdata case, made visible ────────────────────────

def test_a_compute_that_RAISES_puts_the_alert_in_needs_attention_not_silence(
        tmp_db, channels, monkeypatch):
    """`compute_vwap` RAISES rather than falling back to UTC — deliberately, and
    correctly: a silent UTC fallback is the retired VWAP_SESSION_ANCHOR defect,
    measured at $14.45 at a session open. But the evaluator wraps every compute
    in try/except and logs, and the cycle then skips the alert WITHOUT WRITING
    ANYTHING AT ALL. **The raise is preserved. The silence is not.**
    """
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    aid = ias.create(user_id="u1", sym="TEST", indicator="vwap",
                     condition="above", threshold=1.0, tf="5")
    t0 = time.time()

    with _no_tzdata():
        ev._run_one_cycle()
        # THE SILENCE ITSELF, MEASURED: the cycle wrote nothing whatsoever.
        row = ias.get(aid)
        assert row["last_evaluated_at"] is None
        assert row["state"] == "armed"
        assert channels["delivered"] == []

        out = ias.sweep_silent_alerts(now=t0 + 400)

    assert out["flagged"] == 1
    row = ias.get(aid)
    assert row["state"] == "needs_attention"
    assert "tz database" in (row["state_detail"] or ""), (
        f"the raising exception's own message did not survive: {row['state_detail']!r}")


def test_a_HEALTHY_alert_is_never_flagged_by_the_sweep(tmp_db, monkeypatch):
    """The control. Without it, "flagged" would be true of everything and the
    test above would pass on a sweep that flags unconditionally."""
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    aid = ias.create(user_id="u1", sym="TEST", indicator="vwap",
                     condition="above", threshold=1.0, tf="5")
    out = ias.sweep_silent_alerts(now=time.time() + 400)
    assert out["silent"] == 1, "the alert was not even considered silent"
    assert out["flagged"] == 0
    assert ias.get(aid)["state"] == "armed"


def test_an_alert_on_an_indicator_that_cannot_be_evaluated_is_flagged(tmp_db, monkeypatch):
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    # Created through the service, which is how a legacy row reached the table
    # before the router learned to refuse this.
    aid = ias.create(user_id="u1", sym="TEST", indicator="rsx",
                     condition="above", threshold=70.0, tf="5")
    ias.sweep_silent_alerts(now=time.time() + 400)
    row = ias.get(aid)
    assert row["state"] == "needs_attention"
    assert "can never fire" in row["state_detail"]


def test_a_value_arriving_clears_needs_attention(tmp_db):
    aid = ias.create(user_id="u1", sym="TEST", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")
    ias.mark_needs_attention(aid, RuntimeError("broken"))
    assert ias.get(aid)["state"] == "needs_attention"
    ias.record_evaluation(aid, 40.0)
    row = ias.get(aid)
    assert row["state"] == "armed"
    assert row["state_detail"] is None
    # ⚠️ and it did NOT move the episode — nothing fired.
    assert row["arm_epoch"] == 0


def test_needs_attention_does_not_suppress_a_real_fire(tmp_db):
    aid = ias.create(user_id="u1", sym="TEST", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")
    ias.mark_needs_attention(aid, RuntimeError("broken"))
    assert ias.record_trigger(aid, 75.0) is True
    assert ias.get(aid)["state"] == "fired"


# ─── the migration ───────────────────────────────────────────────────────────

_PRE_TASK_11_SCHEMA = """
CREATE TABLE indicator_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL, sym TEXT NOT NULL, indicator TEXT NOT NULL,
  condition TEXT NOT NULL, threshold REAL, tf TEXT NOT NULL, params_json TEXT,
  active INTEGER NOT NULL DEFAULT 1, last_value REAL, last_evaluated_at INTEGER,
  triggered_at INTEGER, trigger_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
"""


def test_an_existing_table_is_MIGRATED_and_its_rows_land_ARMED(tmp_path, monkeypatch):
    """⛔ `CREATE TABLE IF NOT EXISTS` IS A NO-OP ON EVERY BOX THAT ALREADY HAS
    THE TABLE, which is every box. The ALTERs are the only thing that reaches an
    existing row, and a row that migrates into a NULL state would be an alert
    that can never fire again."""
    import sqlite3
    db_path = tmp_path / "auth.db"
    con = sqlite3.connect(str(db_path))
    con.executescript(_PRE_TASK_11_SCHEMA)
    con.execute(
        "INSERT INTO indicator_alerts (user_id, sym, indicator, condition, "
        "threshold, tf, active, trigger_count, created_at) "
        "VALUES ('u1','AAPL','rsi','above',70,'D',1,3,1700000000)")
    con.commit()
    con.close()

    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    ias.init_schema()

    rows = ias.list_active()
    assert len(rows) == 1
    assert rows[0]["state"] == "armed"
    assert rows[0]["arm_epoch"] == 0
    assert rows[0]["trigger_count"] == 3, "the migration lost the existing history"
    assert ias.record_trigger(rows[0]["id"], 75.0) is True


# ─── M5: two products, one name ──────────────────────────────────────────────

def test_the_chart_alert_lane_never_routes_anything_to_watchlist_create_alert():
    """⛔ `watchlist_alerts` ALREADY DELIVERS PRICE ALERTS, on the 15-second
    live-price poll. A chart price alert routed into `create_alert` would be the
    same product under a second name, and two products with one name is how a
    user ends up with two alerts and one notification.

    Positive control: the same scan must SEE the delivery hook the lane really
    does use, otherwise "no create_alert" is a statement about a scan that reads
    nothing.
    """
    import api.routers.indicator_alerts as router_mod
    modules = [router_mod, ias, fl, ev]
    seen_delivery = False
    for mod in modules:
        for node in ast.walk(_parse_module(mod)):
            if isinstance(node, ast.Attribute) and node.attr == "create_alert":
                raise AssertionError(
                    f"{mod.__name__} reaches for `create_alert` — the watchlist "
                    "price-alert lane. Line " + str(node.lineno))
            if isinstance(node, ast.ImportFrom) and "watchlist_alert_service" in (node.module or ""):
                for alias in node.names:
                    assert alias.name != "create_alert", (
                        f"{mod.__name__} imports the watchlist create path")
            if isinstance(node, ast.Attribute) and node.attr == "deliver_alert_payload":
                seen_delivery = True
    assert seen_delivery, (
        "the scan never saw `deliver_alert_payload` — it is reading nothing and "
        "its absence-claim is worth nothing")


# ─── the router ──────────────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_db):
    from fastapi.testclient import TestClient
    from api.main import app
    from api.middleware.auth_middleware import get_current_user

    def _fake_user():
        return {"id": "user-abc", "email": "abc@test", "role": "member"}

    app.dependency_overrides[get_current_user] = _fake_user
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_route_fired_returns_only_my_fires(client):
    mine = ias.create(user_id="user-abc", sym="AAA", indicator="rsi",
                      condition="above", threshold=70.0, tf="5")
    theirs = ias.create(user_id="someone-else", sym="BBB", indicator="rsi",
                        condition="above", threshold=70.0, tf="5")
    ias.record_trigger(mine, 75.0)
    ias.record_trigger(theirs, 76.0)
    r = client.get("/api/indicator-alerts/fired")
    assert r.status_code == 200, r.text
    assert [f["alert_id"] for f in r.json()["fires"]] == [mine]


def test_route_snooze_and_rearm_are_ownership_checked(client):
    mine = ias.create(user_id="user-abc", sym="AAA", indicator="rsi",
                      condition="above", threshold=70.0, tf="5")
    theirs = ias.create(user_id="someone-else", sym="BBB", indicator="rsi",
                        condition="above", threshold=70.0, tf="5")
    assert client.post(f"/api/indicator-alerts/{theirs}/snooze",
                       json={"minutes": 15}).status_code == 404
    assert client.post(f"/api/indicator-alerts/{theirs}/rearm").status_code == 404

    r = client.post(f"/api/indicator-alerts/{mine}/snooze", json={"minutes": 15})
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "snoozed"
    assert ias.get(mine)["state"] == "snoozed"

    r2 = client.post(f"/api/indicator-alerts/{mine}/rearm")
    assert r2.status_code == 200
    assert ias.get(mine)["state"] == "armed"

    assert client.post(f"/api/indicator-alerts/{mine}/snooze",
                       json={"minutes": 0}).status_code == 400


def test_route_refuses_a_bare_price_alert_and_NAMES_the_other_lane(client):
    """⭐ NARROWED BY PHASE C TASK 10, AND THE NARROWING IS THE POINT.

    `close` used to be on this list because it was not an address; it IS one now
    (`PRICE_FUNCS`), which is what makes price a LEFT operand and closes the
    thing Task 11 recorded as structurally blocked. The refusal survives for
    every spelling that still names no address — which is the half that was
    ever load-bearing, because those are what a user types when they mean the
    live-price product.
    """
    for alias in ("price", "LAST", "px", "last_price"):
        r = client.post("/api/indicator-alerts", json={
            "sym": "AAPL", "indicator": alias, "condition": "above",
            "threshold": 200, "tf": "D"})
        assert r.status_code == 400, f"{alias} was accepted"
        assert "watchlist" in r.json()["detail"].lower()
    # ⛔ …AND `close` IS ACCEPTED, or the paragraph above is a story about a
    # change that did not happen. This is the whole Task 11 hand-back: an alert
    # whose LEFT operand is the price.
    ok = client.post("/api/indicator-alerts", json={
        "sym": "AAPL", "indicator": "close", "condition": "cross_above",
        "threshold": 200, "tf": "D"})
    assert ok.status_code == 200, ok.text
    stored = ias.get(ok.json()["id"])
    assert stored["indicator"] == "close"


def test_route_refuses_an_indicator_that_can_never_fire(client):
    r = client.post("/api/indicator-alerts", json={
        "sym": "AAPL", "indicator": "rsx", "condition": "above",
        "threshold": 70, "tf": "D"})
    assert r.status_code == 400
    assert "catalog" in r.json()["detail"]
    # and the real one still works
    assert client.post("/api/indicator-alerts", json={
        "sym": "AAPL", "indicator": "rsi", "condition": "above",
        "threshold": 70, "tf": "D"}).status_code == 200


# ─── the soak matrix: it observes everything and can mail nobody ─────────────

def _diff_addresses() -> list:
    """The addresses the frozen `--diff` instrument drives, read from it."""
    from api.services import indicator_alert_evaluator as ev
    return list(ev.INDICATOR_FUNCS) + list(ev.EVENT_FUNCS)

def test_the_soak_matrix_covers_the_WHOLE_catalog_and_is_idempotent(tmp_db):
    from tools import alert_soak_matrix as soak
    expected = {s["address"] for s in soak.catalog_addresses()}
    # ⚠️ 31 SINCE PHASE C TASK 10, AND THE EXTRA ONE IS NAMED. The soak reads
    # `alert_catalog()` at runtime, so it grew with it; the frozen `--diff`
    # enumerates `INDICATOR_FUNCS + EVENT_FUNCS` and is still 30, because the
    # `close` address deliberately lives in a THIRD partition that the frozen
    # replay grid does not generate from (`_series_close` says why). Naming the
    # difference here rather than loosening the number to `>= 30`.
    assert len(expected) == 31, (
        f"the catalog has {len(expected)} addresses, not 31 — the matrix and "
        "the catalog have drifted apart")
    assert expected - set(_diff_addresses()) == {"close"}, (
        "the set the soak arms and the set the frozen --diff drives differ by "
        "something other than the one address Task 10 declared")

    first = soak.arm("owner-1", "SPY", "5", 30)
    assert sorted(first["created"]) == sorted(expected)
    again = soak.arm("owner-1", "SPY", "5", 30)
    assert again["created"] == [], "re-arming duplicated the matrix"
    assert len(soak.soak_rows()) == 31

    out = soak.verify()
    assert out["armed"] == 31
    assert out["visible_to_shadow"] == 31, (
        "the shadow lane cannot see the matrix — the soak would observe nothing "
        "and Task 8's three-session gate would pass VACUOUSLY")
    assert out["deliverable_now"] == 0
    assert out["missing"] == []

    assert sorted(soak.disarm()["deleted"]) == sorted(expected)
    assert soak.soak_rows() == []


def test_the_soak_matrix_CANNOT_deliver_even_when_every_alert_triggers(
        tmp_db, channels, monkeypatch):
    """⭐ THE SPAM GUARANTEE, MEASURED END TO END.

    Thirty instruments armed on the owner's own account, bars on which they
    genuinely trigger, ten full live cycles — and the member is told nothing.
    The guarantee is not a promise about the tool, it is the fire-once gate this
    same task shipped: a snoozed alert refuses BEFORE the fired log is touched,
    so nothing is ever claimable for delivery.
    """
    from tools import alert_soak_matrix as soak
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    soak.arm("owner-1", "SPY", "5", 30)

    for _ in range(10):
        ev._run_one_cycle()

    assert len(channels["invoked"]) > 0, (
        "not one alert in the matrix ever triggered — 'nothing was delivered' "
        "would then be a statement about a matrix that does nothing")
    assert channels["delivered"] == [], (
        f"the soak matrix delivered {len(channels['delivered'])} alerts to the "
        "owner")
    assert fl.count_fires() == 0, "a snoozed alert consumed its episode key"
    # and the lane the soak exists to feed still sees every one of them
    assert len({a["id"] for a in ias.list_active()}) == 31


def test_route_latency_states_the_worst_case_per_timeframe(client):
    r = client.get("/api/indicator-alerts/latency")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == ev.eval_mode()
    wc = body["worst_case_seconds"]
    assert set(wc) == {"1", "5", "15", "30", "60", "D", "W", "M"}
    if body["mode"] == "forming":
        assert set(wc.values()) == {60}
    else:
        assert wc["5"] == 60 + 300
