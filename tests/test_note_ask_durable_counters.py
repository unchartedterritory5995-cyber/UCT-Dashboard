"""Wave 7 whole-branch fix round — rulings D-H5b, D-H5 and tests cross-shard 2:
the daily LLM caps are DURABLE, writing help is priced PER ACTION, and the
writing-help member cap is read per call.

⚰️ THE DEFECT (D-H5b). `note_ask._synth_spend` (the shared $25/day cap Ask and
writing help both charge), `_synth_by_user` (Ask's 40/day) and
`_writing_help_by_user` (writing help's 60/day) were module dicts. Every web
deploy -- several a day -- started a fresh process, so each "daily" cap was a
cap per UPTIME: a busy day with four deploys allowed four times the spend.

THE RULE, railed here:
  * ONE durable counter in auth.db (`api/services/daily_counters.py`) keyed by
    (scope, subject, ET day), the email-in limits' pattern. Ask, writing help
    and the armed meaning search's embed count (D-H6) all use it.
  * A deploy no longer resets it: the count and the spend survive a restart,
    simulated here by reloading BOTH modules (a restart re-executes every
    module; a store that lives in either one's memory is gone after it).
  * The check and the charge are ONE `BEGIN IMMEDIATE`, so two requests racing
    for the last slot get exactly one.
  * A counter read/write error FAILS OPEN with one log line: a cost cap that
    fails closed refuses every member on a busy database.
  * D-H5: writing help is charged a per-action estimate (the prompt's
    characters and the action's max output tokens at the model's published
    rates), not the flat `_APPROX_COST`; a refund gives back exactly what was
    charged.
  * cross 2: NOTEBOOK_WRITING_HELP_PERUSER_CAP is read per call, so a change
    needs no restart.
"""
from __future__ import annotations

import importlib
import logging
import sqlite3
import threading
import time

import pytest

from api.services import note_ask

DAY = "2026-09-25"


@pytest.fixture
def db(tmp_path, monkeypatch):
    from api.services import auth_db
    path = str(tmp_path / "counters.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", path)
    monkeypatch.setattr(note_ask, "_et_day", lambda: DAY)
    monkeypatch.delenv("NOTEBOOK_WRITING_HELP_PERUSER_CAP", raising=False)
    with note_ask._synth_lock:
        note_ask._inflight.clear()
    return path


def _counter_rows(path):
    c = sqlite3.connect(path)
    try:
        return c.execute("SELECT scope, subject, day, value FROM daily_usage_counters"
                         " ORDER BY scope, subject, day").fetchall()
    finally:
        c.close()


# ── D-H5b: durable ───────────────────────────────────────────────────────────

def test_a_RESTART_keeps_the_days_spend_and_every_count(db, monkeypatch):
    """What a deploy does, simulated: both modules re-executed from source."""
    from api.services import daily_counters
    assert note_ask.reserve_ask("u1") is True
    assert note_ask.reserve_writing_help("u1") is True
    spend = note_ask.spend_today()
    assert spend > 0, "non-vacuity: nothing was charged at all"
    before_inflight = note_ask._inflight

    importlib.reload(daily_counters)
    importlib.reload(note_ask)
    monkeypatch.setattr(note_ask, "_et_day", lambda: DAY)
    # non-vacuity: the reload really rebuilt the module's in-memory state
    assert note_ask._inflight is not before_inflight

    assert note_ask.spend_today() == pytest.approx(spend)
    assert note_ask.ask_used("u1") == 1
    assert note_ask.writing_help_used("u1") == 1


def test_a_restart_does_not_hand_back_a_spent_member_allowance(db, monkeypatch):
    """The member-facing half: a member who used their day's Ask questions does
    not get a fresh 40 because the pod redeployed."""
    from api.services import daily_counters
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 2)
    assert [note_ask.reserve_ask("u1") for _ in range(3)] == [True, True, False]
    importlib.reload(daily_counters)
    importlib.reload(note_ask)
    monkeypatch.setattr(note_ask, "_et_day", lambda: DAY)
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 2)
    assert note_ask.reserve_ask("u1") is False


def test_the_counters_are_keyed_by_the_ET_day_so_a_new_day_starts_at_zero(db, monkeypatch):
    assert note_ask.reserve_writing_help("u1") is True
    monkeypatch.setattr(note_ask, "_et_day", lambda: "2026-09-26")
    assert note_ask.writing_help_used("u1") == 0
    assert note_ask.spend_today() == 0.0
    assert note_ask.writing_help_used("u1", day=DAY) == 1


def test_rows_older_than_yesterday_are_pruned_on_a_write(db, monkeypatch):
    from api.services import daily_counters as dc
    dc.take("2026-09-20", [dc.Charge("probe", "u1", 1)])
    dc.take("2026-09-24", [dc.Charge("probe", "u1", 1)])
    dc.take(DAY, [dc.Charge("probe", "u1", 1)])
    assert [r[2] for r in _counter_rows(db)] == ["2026-09-24", DAY]


def test_two_requests_racing_for_the_LAST_slot_get_exactly_one(db, monkeypatch):
    """The read and the charge are ONE `BEGIN IMMEDIATE`.

    ⛔ THE INTERLEAVING IS FORCED: every read of a counter is held 100 ms, so
    with the read and the write split apart every racer reads the same count
    and every one is admitted (the email-in limits' race rail, same shape)."""
    from api.services import auth_db, daily_counters as dc
    real = auth_db.get_connection

    class SlowRead:
        def __init__(self, conn):
            self._c = conn

        def execute(self, sql, *args):
            cur = self._c.execute(sql, *args)
            if sql.lstrip().upper().startswith("SELECT") and "daily_usage_counters" in sql:
                time.sleep(0.1)
            return cur

        def __getattr__(self, name):
            return getattr(self._c, name)

    monkeypatch.setattr(auth_db, "get_connection", lambda: SlowRead(real()))
    # This rail is about the transaction boundary, not the bounded wait: a
    # racer that outwaited the production 1 s would FAIL OPEN (admitted, by
    # design) and read here as a broken boundary. Measured: 1 run in 4 did,
    # on a loaded box.
    monkeypatch.setattr(dc, "BUSY_TIMEOUT_MS", 10_000)
    # The database already exists in WAL mode with the table in it, as auth.db
    # does in production: four FIRST connections to a brand-new file race to
    # switch it to WAL, and that switch refuses without waiting (measured) --
    # a property of a fresh file, not of the counter.
    assert dc.value(DAY, "race", "u1") == 0.0
    gate = threading.Barrier(4)
    results, errors = [], []

    def race():
        gate.wait()
        try:
            results.append(dc.take(DAY, [dc.Charge("race", "u1", 1, 1)]))
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))

    threads = [threading.Thread(target=race) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert errors == []
    assert results.count(None) == 1 and len(results) == 4, results
    assert dc.value(DAY, "race", "u1") == 1


def test_a_database_error_FAILS_OPEN_with_one_log_line(db, monkeypatch, caplog):
    """A cost cap that fails closed refuses every member on a busy database."""
    from api.services import auth_db, daily_counters as dc

    def locked():
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(auth_db, "get_connection", locked)
    caplog.set_level(logging.WARNING, logger=dc.log.name)
    assert note_ask.reserve_ask("u1") is True
    lines = [r for r in caplog.records if r.name == dc.log.name]
    assert len(lines) == 1, [r.getMessage() for r in lines]
    assert "OperationalError" in lines[0].getMessage()
    caplog.clear()
    assert dc.value(DAY, note_ask.SCOPE_ASK, "u1") == 0.0
    assert len([r for r in caplog.records if r.name == dc.log.name]) == 1


def test_a_refund_never_goes_below_zero(db):
    note_ask.refund_ask("never-reserved")
    assert note_ask.ask_used("never-reserved") == 0
    assert note_ask.spend_today() == 0.0


# ── D-H5: writing help is priced per action ──────────────────────────────────

def _req(action, chars, **extra):
    from api.services.journal_two import writing_help as wh
    body = {"action": action, "scope": "selection", "text": "x" * chars, **extra}
    return wh.parse_request(body)


def test_a_20000_char_REWRITE_is_charged_more_than_a_200_char_SUMMARY():
    from api.services.journal_two import writing_help as wh
    model = wh.model_name()
    big = wh.estimate_cost(_req("rewrite", 20_000, style="shorter"), model=model)
    small = wh.estimate_cost(_req("summarize", 200), model=model)
    assert big > small > 0
    # the ruling's premise, measured: the flat charge UNDERcounted the
    # expensive call (and over-counted the cheap one)
    assert big > note_ask._APPROX_COST > small, (big, small)


def test_the_estimate_is_the_prompt_and_the_actions_ceiling_at_the_published_rates():
    from api.services import narrative_cost_guard
    from api.services.journal_two import writing_help as wh
    req = _req("translate", 5_000, lang="ja")
    built = wh.build_messages(req)
    chars = len(built["system"]) + sum(len(m["content"]) for m in built["messages"])
    tokens_in = -(-chars // wh.CHARS_PER_TOKEN)
    expected = narrative_cost_guard.estimate_cost(
        "claude-sonnet-5", int(tokens_in), wh._MAX_TOKENS["translate"])
    assert wh.estimate_cost(req, model="claude-sonnet-5") == pytest.approx(expected)
    # an unknown model is priced at the priciest known rate, never $0
    assert wh.estimate_cost(req, model="no-such-model") > expected


def test_the_reservation_charges_the_estimate_and_a_refund_gives_exactly_it_back(db):
    from api.services.journal_two import writing_help as wh
    cost = wh.estimate_cost(_req("continue", 3_000), model=wh.model_name())
    assert note_ask.reserve_writing_help("u1", cost=cost) is True
    assert note_ask.spend_today() == pytest.approx(cost)
    note_ask.refund_writing_help("u1", cost=cost)
    assert note_ask.spend_today() == pytest.approx(0.0)
    assert note_ask.writing_help_used("u1") == 0


def test_the_shared_cap_refuses_on_the_ESTIMATE_not_the_flat_charge(db, monkeypatch):
    monkeypatch.setattr(note_ask, "_SYNTH_GLOBAL_HARD", 0.03)
    assert note_ask.reserve_writing_help("u1", cost=0.04) is False
    assert note_ask.shared_cap_reached(cost=0.04) is True
    assert note_ask.shared_cap_reached() is False          # the flat 0.02 still fits
    assert note_ask.reserve_writing_help("u1", cost=0.02) is True


# ── cross 2: the member cap is read per call ─────────────────────────────────

def test_the_writing_help_member_cap_is_read_PER_CALL(db, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_WRITING_HELP_PERUSER_CAP", "1")
    assert note_ask.writing_help_peruser_cap() == 1
    assert note_ask.reserve_writing_help("u1") is True
    assert note_ask.reserve_writing_help("u1") is False
    monkeypatch.setenv("NOTEBOOK_WRITING_HELP_PERUSER_CAP", "3")   # no restart
    assert note_ask.writing_help_peruser_cap() == 3
    assert note_ask.reserve_writing_help("u1") is True


@pytest.mark.parametrize("raw,expected", [(None, 60), ("", 60), ("abc", 60), ("-4", 60), ("0", 0), ("12", 12)])
def test_a_bad_cap_value_falls_back_to_the_default(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv("NOTEBOOK_WRITING_HELP_PERUSER_CAP", raising=False)
    else:
        monkeypatch.setenv("NOTEBOOK_WRITING_HELP_PERUSER_CAP", raw)
    assert note_ask.writing_help_peruser_cap() == expected
