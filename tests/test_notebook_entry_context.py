"""Wave 13 lane 13E-1 -- the market context frozen at the fill (`entry_context.py`) and its
routes (`api/routers/notebook_entry_context.py`).

  * EVERY FIELD SOURCED: each value equals what its authority answered, carries that
    authority's source and as-of, and the authority was actually CALLED (a constant in its
    place goes red). A source with nothing is a labelled gap with a reason, never a value.
  * FREEZE-ONCE: a second freeze, a second open, a re-sync or a sweep after the world moved
    changes nothing, and nothing is recomputed.
  * THE BROKER-SYNC HOOK only READS what sync wrote (the rows are byte-identical after it), and
    an exception in it never fails the sync -- with a control proving the same failure DOES
    raise when unguarded. The listener is wired to job ids main.py really registers.
  * THE SENTINEL: a broker trade's `position_id` is `manual-<uuid>`, so the closed trade reaches
    its context by (member, symbol, entry day), never by id.
  * A PAST DAY reads not captured; a carried-in broker holding has no entry day.
  * PURGE takes the table, and only the deleted member's rows.
  * THE ROUTES: 404 while the flag is off (before the session), 402 for a free plan, another
    member's position or trade is the one 404.

No vendor, model or bars store is reachable: every authority is replaced by a recording fake.
"""
from __future__ import annotations

import ast
import importlib
import json
import os
import pathlib
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

import pytest

from api.services.journal_two import entry_context as ectx
from api.services.journal_two import tech_fingerprint as tfp
from api.services.journal_two.db import ensure_schema

REPO = pathlib.Path(__file__).resolve().parent.parent
TODAY = "2026-10-02"
AT_1030_ET = "2026-10-02T14:30:00+00:00"          # 10:30 ET on TODAY
YESTERDAY_1030_ET = "2026-10-01T14:30:00+00:00"


# ── the authorities, replaced by recording fakes ─────────────────────────────────────────

class Sources:
    """Every authority entry_context reads, faked, with a call log."""

    def __init__(self):
        self.calls: list[str] = []
        self.regime = {"regime": "amber", "score": 72.5, "source": "wire_data", "asOf": None}
        self.wire = {"wire_date": "2026-10-02", "pct_above_50ma": 48.2}
        self.live = {"ok": True, "as_of": "2026-10-02T10:15:00-04:00",
                     "metrics": {"pct_above_50sma": 55.1}, "measured": 3000, "degraded": False}
        self.rs = {"NVDA": {"rs_rank": 91, "rs_score": 1.4}, "AMD": {"rs_rank": 77, "rs_score": 0.9}}
        self.report_date = "2026-10-20"
        self.candidates = {"generated_at": "2026-10-02T12:00:00Z", "market_date": "2026-10-02",
                           "candidates": {"pullback_ma": [{"ticker": "NVDA"}], "gapper_news": [],
                                          "remount": [{"ticker": "AMD"}]}}
        self.definitions = [
            {"ast_hash": "h1", "def_id": "d1", "definition": {"meta": {"name": "My breakouts"}}},
            {"ast_hash": "h2", "def_id": "d2", "definition": {"meta": {"name": "Never swept"}}},
        ]
        self.covered = {"h1": 20261001, "h2": None}
        self.hits = {"h1": ["MSFT", "NVDA"]}
        self.fp_calls: list[tuple[str, str]] = []

    def install(self, mp):
        from api.services import breadth_live, earnings_table, engine, rs_ranking, user_definitions
        from api.services.journal_two import regime
        from api.services.screener import scan_store

        def log(name, value):
            self.calls.append(name)
            if isinstance(value, Exception):
                raise value
            return value

        mp.setattr(regime, "get_current_regime", lambda: log("regime", self.regime))
        mp.setattr(engine, "get_breadth", lambda: log("wire", self.wire))
        mp.setattr(breadth_live, "compute_live",
                   lambda force=False, cached_only=False: log("live", self.live) if cached_only
                   else pytest.fail("compute_live must be read cached_only"))
        mp.setattr(rs_ranking, "get_rs_for_ticker", lambda s: log("rs", self.rs.get(s)))
        mp.setattr(rs_ranking, "cached_rank_map", lambda: log("rs_map", dict(self.rs)))
        mp.setattr(earnings_table, "_next_report_date", lambda s, now=None: log("earnings", self.report_date))
        mp.setattr(engine, "get_candidates", lambda: log("candidates", self.candidates))
        mp.setattr(user_definitions, "list_for_user", lambda uid: log("definitions", list(self.definitions)))
        mp.setattr(scan_store, "latest_covered_as_of", lambda h, tf: self.covered.get(h))
        mp.setattr(scan_store, "hits", lambda h, tf, as_of: list(self.hits.get(h, [])))

        def compute(symbol, as_of=None):
            self.fp_calls.append((symbol, as_of))
            if isinstance(getattr(self, "fp_error", None), Exception):
                raise self.fp_error
            return {"v": 1, "symbol": symbol, "requested_as_of": as_of, "as_of": as_of, "mode": "bars",
                    "fields": {"adr_pct": {"value": 4.2 + len(self.fp_calls), "source": "bars",
                                           "missing": None}}}
        mp.setattr(tfp, "compute", compute)
        return self


@pytest.fixture
def src(monkeypatch):
    # Every capture test below is about a PAID member unless it says otherwise (fin-security
    # I-1 gates the capture on the plan), and starts with no remembered vendor answer.
    monkeypatch.setattr(ectx, "member_is_paid", lambda uid: True)
    ectx._reset_vendor_state()
    return Sources().install(monkeypatch)


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    ectx.ensure_schema(c)
    yield c
    c.close()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(ectx.FLAG, "1")


def _position(c, uid="u1", symbol="NVDA", entry=AT_1030_ET, source=None, estimated=0, closed=None,
              pid=None):
    pid = pid or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    c.execute(
        "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares,"
        " entry_price, stop_price, raise_to_breakeven, context_at_entry, created_at, updated_at,"
        " closed_at, source, external_id, entry_estimated) VALUES (?,?,?,?,?,?,?,?,?,0,'{}',?,?,?,?,?,?)",
        (pid, uid, symbol, "Long", entry, 10, 10, 100.0, 100.0, now, now, closed, source,
         f"bkpos:a1:{symbol}:Long" if source == "broker" else None, estimated))
    c.commit()
    return pid


def _trade(c, uid="u1", symbol="NVDA", entry=AT_1030_ET, exit_=None, position_id=None, tday=TODAY):
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    c.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, pnl_dollar, pnl_percent, r_multiple, hold_days, result,"
        " context_at_entry, created_at, source, trading_day_et) VALUES"
        " (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'{}',?,?,?)",
        (tid, uid, position_id or f"manual-{uuid.uuid4()}", symbol, "Long", 10, 100.0, entry, 101.0,
         exit_ or "2026-10-02T19:00:00+00:00", 100.0, 10.0, 0.01, None, 0, "Win", now, "broker", tday))
    c.commit()
    return tid


def _dump(c, table):
    return [tuple(r) for r in c.execute(f"SELECT * FROM {table} ORDER BY id")]


# ── every field sourced ───────────────────────────────────────────────────────────────────

def test_every_field_equals_its_authority_with_source_and_as_of(conn, src):
    out = ectx.freeze("u1", "nvda", TODAY, capture_kind="at_entry", trigger="manual_add",
                      conn=conn, capture_day=TODAY)
    assert out["frozen"] is True
    f = out["context"]["fields"]
    assert list(f) == list(ectx.FIELDS)
    assert f["regime"] == {"value": "amber", "source": ectx.SRC_REGIME, "asOf": "2026-10-02",
                           "missing": None, "detail": None}
    assert f["exposure"]["value"] == 72.5 and f["exposure"]["source"] == ectx.SRC_EXPOSURE
    assert f["breadth_pct_above_50"]["value"] == 55.1
    assert f["breadth_pct_above_50"]["source"] == ectx.SRC_BREADTH_LIVE
    assert f["breadth_pct_above_50"]["asOf"] == "2026-10-02T10:15:00-04:00"
    assert f["rs_rank"]["value"] == 91 and f["rs_rank"]["detail"] == {"rsScore": 1.4}
    assert f["days_to_earnings"]["value"] == 18
    assert f["days_to_earnings"]["detail"] == {"reportDate": "2026-10-20", "countedFrom": TODAY}
    assert f["uct_scans"]["value"] == ["pullback_ma"] and f["uct_scans"]["asOf"] == "2026-10-02"
    assert f["member_screens"]["value"] == [{"defId": "d1", "name": "My breakouts", "asOf": "20261001"}]
    assert f["member_screens"]["detail"] == {"swept": 1}                # d2 never swept: not counted
    assert f["fingerprint"]["value"]["symbol"] == "NVDA"
    assert f["fingerprint"]["asOf"] == TODAY and src.fp_calls == [("NVDA", TODAY)]
    assert all(v["missing"] is None for v in f.values())
    # every authority was CALLED -- a constant in a source's place would not be
    assert {"regime", "wire", "live", "rs", "earnings", "candidates", "definitions"} <= set(src.calls)
    ctx = out["context"]
    assert (ctx["captureKind"], ctx["capturedLate"], ctx["captureDay"], ctx["trigger"]) == \
        ("at_entry", False, TODAY, "manual_add")


def test_every_missing_value_is_labelled_with_its_reason_never_invented(conn, src):
    src.regime = {"regime": None, "score": None, "source": None, "asOf": None}
    src.live = {"ok": False, "reason": "no warm live cache (cached_only)"}
    src.wire = {"wire_date": None, "pct_above_50ma": None}
    src.rs = {}                                                          # cold cache
    src.report_date = None
    src.candidates = {"generated_at": None, "market_date": None,
                      "candidates": {"pullback_ma": [], "gapper_news": [], "remount": []}}
    src.definitions = []
    src.fp_error = tfp.FingerprintRequestError("bad")
    f = ectx.freeze("u1", "NVDA", TODAY, capture_kind="at_entry", trigger="sweep", conn=conn,
                    capture_day=TODAY)["context"]["fields"]
    assert {k: v["missing"] for k, v in f.items()} == {
        "regime": "wire_unavailable", "exposure": "wire_unavailable",
        "breadth_pct_above_50": "breadth_unavailable", "rs_rank": "rs_cache_cold",
        "days_to_earnings": "no_report_date", "uct_scans": "no_scan_published",
        "member_screens": "no_screens_swept", "fingerprint": "bad_symbol"}
    assert all(v["value"] is None for v in f.values())
    assert all(v["missing"] in ectx.MISSING_REASONS for v in f.values())


def test_a_warm_cache_without_the_symbol_reads_not_ranked_and_cold_live_breadth_falls_back_labelled(conn, src):
    src.rs = {"AMD": {"rs_rank": 77}}
    src.live = {"ok": False, "reason": "no warm live cache (cached_only)"}
    f = ectx.freeze("u1", "NVDA", TODAY, capture_kind="at_entry", trigger="sweep", conn=conn,
                    capture_day=TODAY)["context"]["fields"]
    assert f["rs_rank"]["missing"] == "rs_not_ranked"
    b = f["breadth_pct_above_50"]
    assert (b["value"], b["source"], b["asOf"]) == (48.2, ectx.SRC_BREADTH_WIRE, "2026-10-02")
    assert b["detail"]["universe"] == "wire"                            # never passed off as live


def test_a_source_that_raises_is_a_labelled_gap_and_the_others_still_freeze(conn, src):
    src.report_date = RuntimeError("vendor down")
    src.fp_error = sqlite3.OperationalError("database is locked")
    f = ectx.freeze("u1", "NVDA", TODAY, capture_kind="at_entry", trigger="sweep", conn=conn,
                    capture_day=TODAY)["context"]["fields"]
    assert f["days_to_earnings"]["missing"] == "source_error"
    assert f["fingerprint"]["missing"] == "source_error"
    assert f["regime"]["value"] == "amber" and f["rs_rank"]["value"] == 91


# ── freeze once ───────────────────────────────────────────────────────────────────────────

def test_a_second_freeze_open_or_resync_changes_nothing_and_recomputes_nothing(conn, src, on):
    pid = _position(conn, source="broker")
    first = ectx.capture_at_entry("u1", "NVDA", AT_1030_ET, trigger="broker_sync", conn=conn, today=TODAY)
    assert first["status"] == "frozen"
    before = _dump_ctx(conn)
    n_calls = len(src.calls)

    # the world moves
    src.regime = {"regime": "red", "score": 3.0, "source": "wire_data", "asOf": None}
    src.rs["NVDA"] = {"rs_rank": 12, "rs_score": -1.0}
    src.report_date = "2026-10-03"

    again = ectx.freeze("u1", "NVDA", TODAY, capture_kind="at_entry", trigger="sweep", conn=conn,
                        capture_day=TODAY)
    assert again["frozen"] is False
    assert ectx.capture_at_entry("u1", "NVDA", AT_1030_ET, trigger="manual_add", conn=conn,
                                 today=TODAY)["status"] == "already_frozen"
    _position(conn, source=None)                                          # a second open, same day
    assert ectx.capture_todays_entries(conn=conn, today=TODAY)["frozen"] == 0
    assert ectx.after_broker_sync(conn=conn, today=TODAY)["ok"] is True   # a re-sync
    assert ectx.read_for("u1", "position", pid, conn=conn, today=TODAY)["status"] == "captured"

    assert _dump_ctx(conn) == before
    assert len(src.fp_calls) == 1 and len(src.calls) == n_calls          # nothing re-read
    assert again["context"]["fields"]["regime"]["value"] == "amber"


def test_two_writers_racing_the_first_row_wins_and_the_second_writes_nothing(conn, src, monkeypatch):
    """The early return covers a row that already exists; a SECOND writer landing between that
    check and the insert (the sweep and the add's background task, say) is covered only by the
    INSERT OR IGNORE itself."""
    real = ectx.build_context

    def racing(user_id, symbol, entry_day, **kw):
        fields = real(user_id, symbol, entry_day, **kw)
        conn.execute("INSERT INTO j2_entry_context (user_id, symbol, entry_day_et, capture_kind,"
                     " capture_day_et, captured_at, trigger_source, version, context)"
                     " VALUES ('u1','NVDA',?, 'at_entry', ?, 'first', 'sweep', 1, '{\"racer\":1}')",
                     (TODAY, TODAY))
        return fields
    monkeypatch.setattr(ectx, "build_context", racing)
    out = ectx.freeze("u1", "NVDA", TODAY, capture_kind="at_entry", trigger="manual_add", conn=conn,
                      capture_day=TODAY)
    assert out["frozen"] is False and out["context"]["trigger"] == "sweep"
    assert [tuple(r) for r in conn.execute("SELECT captured_at, context FROM j2_entry_context")] == \
        [("first", '{"racer":1}')]


def _dump_ctx(c):
    return [tuple(r) for r in c.execute("SELECT * FROM j2_entry_context ORDER BY user_id, symbol")]


def test_a_past_day_reads_not_captured_and_is_never_reconstructed(conn, src, on):
    pid = _position(conn, entry=YESTERDAY_1030_ET)
    assert ectx.capture_at_entry("u1", "NVDA", YESTERDAY_1030_ET, trigger="manual_add", conn=conn,
                                 today=TODAY)["status"] == "not_entry_day"
    out = ectx.read_for("u1", "position", pid, conn=conn, today=TODAY)
    assert out["status"] == "not_captured" and out["context"] is None
    assert out["key"] == {"symbol": "NVDA", "entryDay": "2026-10-01"}
    assert ectx.capture_todays_entries(conn=conn, today=TODAY)["candidates"] == 0
    assert _dump_ctx(conn) == [] and src.fp_calls == []


def test_a_carried_in_broker_holding_has_no_entry_day_and_is_never_keyed(conn, src, on):
    pid = _position(conn, source="broker", estimated=1)                  # placeholder entry_date = now
    assert ectx.read_for("u1", "position", pid, conn=conn, today=TODAY)["status"] == "entry_day_unknown"
    assert ectx.capture_todays_entries(conn=conn, today=TODAY)["candidates"] == 0
    assert ectx.backfill_open_positions("u1", conn=conn, today=TODAY)["noEntryDay"] == 1
    assert _dump_ctx(conn) == []


# ── the broker-sync hook ──────────────────────────────────────────────────────────────────

def test_the_after_sync_hook_freezes_todays_entries_and_leaves_the_synced_rows_byte_identical(conn, src, on):
    _position(conn, symbol="NVDA", source="broker")
    _position(conn, symbol="AMD", uid="u2", source="broker")
    _position(conn, symbol="TSLA", entry=YESTERDAY_1030_ET, source="broker")
    _trade(conn, symbol="MSFT")                                          # a same-day round trip
    synced = {t: _dump(conn, t) for t in ("j2_positions", "j2_trades")}

    out = ectx.after_broker_sync(conn=conn, today=TODAY)

    assert out["ok"] is True and out["frozen"] == 3 and out["failed"] == 0
    assert {t: _dump(conn, t) for t in ("j2_positions", "j2_trades")} == synced
    assert {(r["user_id"], r["symbol"]) for r in conn.execute("SELECT * FROM j2_entry_context")} == \
        {("u1", "NVDA"), ("u2", "AMD"), ("u1", "MSFT")}


def test_the_hook_is_inert_while_the_flag_is_off(conn, src, monkeypatch):
    monkeypatch.delenv(ectx.FLAG, raising=False)
    _position(conn, source="broker")
    assert ectx.after_broker_sync(conn=conn, today=TODAY) == {"ok": True, "skipped": "flag off"}
    assert ectx.on_position_added("u1", {"symbol": "NVDA", "entryDate": AT_1030_ET}) == {"status": "skipped"}
    assert _dump_ctx(conn) == [] and src.calls == []


def test_a_hook_exception_never_fails_the_sync_WITH_A_CONTROL(conn, src, on, monkeypatch):
    def boom(*a, **k):
        raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(ectx, "_todays_entries", boom)
    # CONTROL: the failure is real -- the unguarded capture raises it ...
    with pytest.raises(sqlite3.OperationalError):
        ectx.capture_todays_entries(conn=conn, today=TODAY)
    # ... and the hook a sync runs swallows it, so the sync it follows cannot fail.
    assert ectx.after_broker_sync(conn=conn, today=TODAY) == {"ok": False, "error": "OperationalError"}
    assert ectx.on_position_added("u1", {"symbol": "NVDA", "entryDate": AT_1030_ET}) is not None


def test_one_entry_failing_never_stops_the_rest(conn, src, on, monkeypatch):
    _position(conn, symbol="NVDA")
    _position(conn, symbol="AMD")
    real = ectx.freeze

    def flaky(user_id, symbol, *a, **k):
        if symbol == "AMD":
            raise RuntimeError("one bad entry")
        return real(user_id, symbol, *a, **k)
    monkeypatch.setattr(ectx, "freeze", flaky)
    out = ectx.capture_todays_entries(conn=conn, today=TODAY)
    assert (out["frozen"], out["failed"]) == (1, 1)


class FakeScheduler:
    def __init__(self, fail=False):
        self.jobs, self.listeners, self.fail = [], [], fail

    def add_job(self, fn, **kw):
        if self.fail:
            raise RuntimeError("scheduler down")
        self.jobs.append((fn, kw))

    def add_listener(self, fn, mask):
        self.listeners.append((fn, mask))


def test_the_listener_queues_one_capture_after_a_broker_sync_job_and_never_raises(on):
    from apscheduler.events import EVENT_JOB_EXECUTED, JobExecutionEvent
    sched = FakeScheduler()
    listener = ectx.make_after_sync_listener(sched)
    listener(JobExecutionEvent(EVENT_JOB_EXECUTED, "breadth_forward_seal_tick", "default", None))
    assert sched.jobs == []                                              # not a broker job
    listener(JobExecutionEvent(EVENT_JOB_EXECUTED, "broker_sync_due", "default", None))
    assert [(fn, kw["id"]) for fn, kw in sched.jobs] == \
        [(ectx.run_after_broker_sync_blocking, ectx.AFTER_SYNC_JOB_ID)]
    assert sched.jobs[0][1]["replace_existing"] is True                 # a burst coalesces
    # a scheduler that cannot take the job never turns into a raise inside APScheduler
    ectx.make_after_sync_listener(FakeScheduler(fail=True))(
        JobExecutionEvent(EVENT_JOB_EXECUTED, "broker_sync_due", "default", None))


def test_install_registers_the_market_hours_sweep_and_the_listener():
    from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED
    from apscheduler.triggers.cron import CronTrigger
    sched = FakeScheduler()
    assert ectx.install_scheduler_hooks(sched, CronTrigger, "America/New_York") is True
    assert [kw["id"] for _, kw in sched.jobs] == [ectx.SWEEP_JOB_ID]
    assert sched.listeners[0][1] == EVENT_JOB_EXECUTED | EVENT_JOB_ERROR
    assert ectx.install_scheduler_hooks(FakeScheduler(fail=True), CronTrigger, "America/New_York") is False


def _add_job_ids(tree):
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "add_job":
            out += [kw.value.value for kw in n.keywords
                    if kw.arg == "id" and isinstance(kw.value, ast.Constant)]
    return out


def test_main_installs_the_hooks_and_the_listener_names_jobs_main_really_registers():
    tree = ast.parse((REPO / "api" / "main.py").read_text(encoding="utf-8"))
    ids = set(_add_job_ids(tree))
    assert "note_sync_due" in ids                                        # non-vacuity: the probe sees
    assert ectx.BROKER_SYNC_JOB_IDS <= ids, ectx.BROKER_SYNC_JOB_IDS - ids  # a renamed job reds here
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "install_scheduler_hooks"]
    assert len(calls) == 1


def test_the_manual_add_route_schedules_the_hook_after_the_write():
    src_text = (REPO / "api" / "routers" / "journal_two.py").read_text(encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(src_text))
              if isinstance(n, ast.FunctionDef) and n.name == "create_position")
    body = ast.get_source_segment(src_text, fn)
    assert body.index("positions_service.create_position(") < \
        body.index("entry_context_service.schedule_position_capture(")
    # fin-security I-1: never on the request's own pool (a Starlette background task runs
    # there), and never called directly from the route.
    assert "add_task(entry_context_service" not in body
    assert "entry_context_service.on_position_added(" not in body


# ── the key: a sentinel position id reaches its context ───────────────────────────────────

def test_a_broker_trade_with_a_sentinel_position_id_reaches_its_context_by_the_key(conn, src, on):
    pid = _position(conn, source="broker")
    ectx.after_broker_sync(conn=conn, today=TODAY)
    frozen = ectx.read_for("u1", "position", pid, conn=conn, today=TODAY)["context"]
    # the position closes; reconstruction writes the trade with a SENTINEL position id
    conn.execute("DELETE FROM j2_positions WHERE id = ?", (pid,))
    conn.commit()
    tid = _trade(conn, entry="2026-10-02T15:05:00+00:00")
    assert conn.execute("SELECT position_id FROM j2_trades WHERE id = ?", (tid,)).fetchone()[0] != pid
    assert ectx.read_for("u1", "trade", tid, conn=conn, today=TODAY)["context"] == frozen
    # the bulk join 13F uses, keyed the same way; a trade on another day has none
    other = _trade(conn, entry=YESTERDAY_1030_ET, position_id=pid)       # even with the REAL id
    got = ectx.contexts_for_trades("u1", [
        {"id": tid, "symbol": "NVDA", "entryDate": "2026-10-02T15:05:00+00:00", "positionId": "manual-x"},
        {"id": other, "symbol": "NVDA", "entryDate": YESTERDAY_1030_ET, "positionId": pid},
    ], conn=conn)
    assert got == {tid: frozen, other: None}
    assert ectx.contexts_for_trades("u2", [{"id": tid, "symbol": "NVDA",
                                            "entryDate": "2026-10-02T15:05:00+00:00"}], conn=conn) == {tid: None}


# ── the why note and the backfill ─────────────────────────────────────────────────────────

def test_the_why_note_writes_only_its_own_columns(conn, src):
    ectx.freeze("u1", "NVDA", TODAY, capture_kind="at_entry", trigger="manual_add", conn=conn,
                capture_day=TODAY)
    ctx_json = conn.execute("SELECT context FROM j2_entry_context").fetchone()[0]
    out = ectx.set_why("u1", "NVDA", TODAY, "  Tight flag at the 21EMA, RS new high  ", conn=conn)
    assert out["why"]["text"] == "Tight flag at the 21EMA, RS new high"
    assert conn.execute("SELECT context FROM j2_entry_context").fetchone()[0] == ctx_json
    with pytest.raises(ectx.EntryContextRequestError):
        ectx.set_why("u1", "NVDA", TODAY, "x" * (ectx.WHY_MAX_CHARS + 1), conn=conn)
    assert ectx.set_why("u1", "NVDA", TODAY, "", conn=conn)["why"] is None
    assert ectx.set_why("u1", "AMD", TODAY, "no context here", conn=conn) is None
    assert ectx.set_why("u2", "NVDA", TODAY, "another member", conn=conn) is None


def test_backfill_labels_an_older_position_captured_late_with_the_capture_day(conn, src):
    _position(conn, symbol="TSLA", entry="2026-09-29T14:30:00+00:00")
    _position(conn, symbol="NVDA")
    _position(conn, symbol="AMD", closed="2026-10-01T20:00:00+00:00", entry="2026-09-29T14:30:00+00:00")
    out = ectx.backfill_open_positions("u1", conn=conn, today=TODAY)
    assert (out["frozen"], out["capturedLate"]) == (2, 1)
    late = ectx.get_context("u1", "TSLA", "2026-09-29", conn=conn)
    assert (late["captureKind"], late["capturedLate"], late["captureDay"], late["trigger"]) == \
        ("captured_late", True, TODAY, "backfill")
    assert late["fields"]["fingerprint"]["asOf"] == "2026-09-29"           # bars as of the entry day
    assert ectx.get_context("u1", "NVDA", TODAY, conn=conn)["captureKind"] == "at_entry"
    assert ectx.get_context("u1", "AMD", "2026-09-29", conn=conn) is None  # closed: not backfilled
    assert ectx.backfill_open_positions("u1", conn=conn, today=TODAY)["already"] == 2


def test_list_contexts_is_member_scoped_and_ranged(conn, src):
    for sym, day in (("NVDA", TODAY), ("AMD", "2026-10-01")):
        ectx.freeze("u1", sym, day, capture_kind="at_entry", trigger="sweep", conn=conn, capture_day=day)
    ectx.freeze("u2", "TSLA", TODAY, capture_kind="at_entry", trigger="sweep", conn=conn, capture_day=TODAY)
    assert [c["symbol"] for c in ectx.list_contexts("u1", conn=conn)] == ["NVDA", "AMD"]
    assert [c["symbol"] for c in ectx.list_contexts("u1", since=TODAY, conn=conn)] == ["NVDA"]


# ── purge ─────────────────────────────────────────────────────────────────────────────────

def test_account_purge_takes_the_table_and_only_that_member(conn, src):
    from api.services.journal_two import account_purge
    ectx.freeze("u1", "NVDA", TODAY, capture_kind="at_entry", trigger="sweep", conn=conn, capture_day=TODAY)
    ectx.freeze("u2", "NVDA", TODAY, capture_kind="at_entry", trigger="sweep", conn=conn, capture_day=TODAY)
    report = account_purge.purge_user_rows("u1", conn)
    assert report["rows_deleted"]["j2_entry_context"] == 1
    assert [r["user_id"] for r in conn.execute("SELECT user_id FROM j2_entry_context")] == ["u2"]


# ── the routes ────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI                                 # noqa: E402
from fastapi.testclient import TestClient                   # noqa: E402

from api.middleware import auth_middleware as authmw        # noqa: E402

PAID = {"plan": "pro"}
FREE = {"plan": "free"}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = auth_db.get_connection()
    ensure_schema(c)
    for uid in ("m1", "m2"):
        c.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                  (uid, f"{uid}@example.com", "x", uid, "member"))
    c.commit()
    c.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


def _db():
    from api.services import auth_db
    c = auth_db.get_connection()
    c.row_factory = sqlite3.Row
    return c


@pytest.fixture
def client(db_path, src, monkeypatch):
    from api.routers import notebook_entry_context
    monkeypatch.setattr(ectx, "today_et", lambda: TODAY)
    app = FastAPI()
    app.include_router(notebook_entry_context.router)
    c = TestClient(app)
    c.app_ = app
    yield c
    app.dependency_overrides.clear()


def as_user(app, uid, plan=PAID):
    user = {"id": uid, "role": "member", **plan}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


ROUTES = (("get", "/meta"), ("get", "?symbol=NVDA&entryDay=2026-10-02"), ("get", "/list"),
          ("get", "/position/p1"), ("get", "/trade/t1"), ("put", "/why"), ("post", "/backfill"))


def test_every_route_is_404_while_the_flag_is_off_even_signed_out(client, monkeypatch):
    monkeypatch.delenv(ectx.FLAG, raising=False)
    for method, path in ROUTES:
        r = getattr(client, method)("/api/j2/entry-context" + path)
        assert r.status_code == 404, (path, r.status_code)
    # CONTROL: the same routes exist and answer once the flag is on (401 signed out, not 404)
    monkeypatch.setenv(ectx.FLAG, "1")
    assert client.get("/api/j2/entry-context/meta").status_code == 401


def test_a_free_plan_is_refused_and_a_paid_one_is_served(client, on):
    as_user(client.app_, "m1", FREE)
    assert client.get("/api/j2/entry-context/meta").status_code == 402
    as_user(client.app_, "m1")
    r = client.get("/api/j2/entry-context/meta")
    assert r.status_code == 200 and r.json()["fields"] == list(ectx.FIELDS)


def test_a_position_page_captures_on_demand_and_another_member_gets_the_one_404(client, on):
    c = _db()
    pid = _position(c, uid="m1")
    yday = _position(c, uid="m1", symbol="AMD", entry=YESTERDAY_1030_ET)
    c.close()
    as_user(client.app_, "m1")
    r = client.get(f"/api/j2/entry-context/position/{pid}").json()
    assert r["status"] == "captured" and r["context"]["trigger"] == "on_demand"
    assert client.get(f"/api/j2/entry-context/position/{yday}").json()["status"] == "not_captured"
    k = client.get("/api/j2/entry-context?symbol=NVDA&entryDay=2026-10-02").json()
    assert k["context"] == r["context"]
    w = client.put("/api/j2/entry-context/why", json={"symbol": "NVDA", "entryDay": TODAY, "text": "VCP"})
    assert w.status_code == 200 and w.json()["context"]["why"]["text"] == "VCP"
    assert client.put("/api/j2/entry-context/why",
                      json={"symbol": "AMD", "entryDay": "2026-10-01", "text": "x"}).status_code == 409
    assert client.get("/api/j2/entry-context/list").json()["count"] == 1

    as_user(client.app_, "m2")
    assert client.get(f"/api/j2/entry-context/position/{pid}").status_code == 404
    assert client.get("/api/j2/entry-context?symbol=NVDA&entryDay=2026-10-02").json()["status"] == "not_captured"
    assert client.get("/api/j2/entry-context/list").json()["count"] == 0


def _drain_captures(timeout=10.0):
    import time as _time
    deadline = _time.monotonic() + timeout
    while ectx._capture_pending_total() and _time.monotonic() < deadline:
        _time.sleep(0.02)
    assert ectx._capture_pending_total() == 0, "a queued capture never finished"


def test_the_manual_add_freezes_after_the_write_and_a_hook_failure_never_fails_the_add(db_path, src, on, monkeypatch):
    from api.routers import journal_two
    app = FastAPI()
    app.include_router(journal_two.router)
    as_user(app, "m1")
    client = TestClient(app)
    now = datetime.now(timezone.utc)
    today = ectx.today_et()
    body = {"symbol": "nvda", "side": "Long", "entryDate": now.isoformat(), "shares": 10,
            "entryPrice": 100.0, "stopPrice": 95.0}
    ectx._reset_capture_queue()
    r = client.post("/api/j2/positions", json=body)
    assert r.status_code == 200
    _drain_captures()                 # the capture runs on its own thread, after the answer
    c = _db()
    rows = [dict(x) for x in c.execute("SELECT user_id, symbol, entry_day_et, trigger_source FROM j2_entry_context")]
    assert rows == [{"user_id": "m1", "symbol": "NVDA", "entry_day_et": today, "trigger_source": "manual_add"}]
    c.close()

    def boom(*a, **k):
        raise RuntimeError("context store down")
    monkeypatch.setattr(ectx, "freeze", boom)
    r2 = client.post("/api/j2/positions", json={**body, "symbol": "AMD"})
    assert r2.status_code == 200 and r2.json()["symbol"] == "AMD"
    _drain_captures()
    c = _db()
    assert c.execute("SELECT COUNT(*) FROM j2_positions WHERE user_id = 'm1'").fetchone()[0] == 2
    c.close()


# ── fin-data I5: the why note is compare-and-set, and it leaves with the member's export ────
#
# Two tabs (or a phone and a desktop) editing the same "why" overwrote each other silently:
# the write was a plain UPDATE. The base is the `updatedAt` the editor read; a write whose
# base is no longer the stored one is refused and the stored words are left alone.

def _frozen(conn):
    ectx.freeze("u1", "NVDA", TODAY, capture_kind="at_entry", trigger="manual_add", conn=conn,
                capture_day=TODAY)


def _stored_why(conn):
    r = conn.execute("SELECT why_text, why_updated_at FROM j2_entry_context WHERE user_id = 'u1'"
                     " AND symbol = 'NVDA'").fetchone()
    return r["why_text"], r["why_updated_at"]


def test_a_why_save_on_the_base_it_read_lands(conn, src):
    _frozen(conn)
    first = ectx.set_why("u1", "NVDA", TODAY, "first words", conn=conn, base_updated_at=None)
    assert first["why"]["text"] == "first words"
    second = ectx.set_why("u1", "NVDA", TODAY, "second words", conn=conn,
                          base_updated_at=first["why"]["updatedAt"])
    assert second["why"]["text"] == "second words"


def test_two_editors_on_one_why_the_second_is_refused_and_the_first_words_stay(conn, src):
    _frozen(conn)
    seen = ectx.set_why("u1", "NVDA", TODAY, "what both tabs loaded", conn=conn)["why"]

    tab_a = ectx.set_why("u1", "NVDA", TODAY, "tab A's words", conn=conn, base_updated_at=seen["updatedAt"])
    with pytest.raises(ectx.WhyConflict) as e:
        ectx.set_why("u1", "NVDA", TODAY, "tab B's words", conn=conn, base_updated_at=seen["updatedAt"])

    assert _stored_why(conn) == ("tab A's words", tab_a["why"]["updatedAt"])
    # The refusal carries what is stored now, so the client can show it beside the typed words.
    assert e.value.current == {"text": "tab A's words", "updatedAt": tab_a["why"]["updatedAt"]}


def test_a_first_why_written_from_two_tabs_at_once_keeps_only_the_first(conn, src):
    """Both tabs loaded "no why yet" (base None)."""
    _frozen(conn)
    ectx.set_why("u1", "NVDA", TODAY, "tab A's first words", conn=conn, base_updated_at=None)
    with pytest.raises(ectx.WhyConflict):
        ectx.set_why("u1", "NVDA", TODAY, "tab B's first words", conn=conn, base_updated_at=None)
    assert _stored_why(conn)[0] == "tab A's first words"


def test_a_cleared_why_refuses_an_edit_based_on_the_old_text(conn, src):
    _frozen(conn)
    seen = ectx.set_why("u1", "NVDA", TODAY, "old words", conn=conn)["why"]
    ectx.set_why("u1", "NVDA", TODAY, "", conn=conn, base_updated_at=seen["updatedAt"])
    with pytest.raises(ectx.WhyConflict) as e:
        ectx.set_why("u1", "NVDA", TODAY, "old words, edited", conn=conn, base_updated_at=seen["updatedAt"])
    assert e.value.current is None and _stored_why(conn) == (None, None)


def test_a_stale_base_never_reads_as_no_context(conn, src):
    """Two different refusals: nothing to attach a note to (None), and a stale base (raises)."""
    _frozen(conn)
    assert ectx.set_why("u1", "AMD", TODAY, "x", conn=conn, base_updated_at=None) is None
    ectx.set_why("u1", "NVDA", TODAY, "words", conn=conn)
    with pytest.raises(ectx.WhyConflict):
        ectx.set_why("u1", "NVDA", TODAY, "y", conn=conn, base_updated_at="2020-01-01T00:00:00+00:00")


def test_a_bundle_that_sends_no_base_still_saves_as_it_did(conn, src):
    """The sibling note door's rule (`PUT /notes/{id}`): an absent base is the bundle from
    before this check. It is not refused, so a deploy never strands an open tab."""
    _frozen(conn)
    ectx.set_why("u1", "NVDA", TODAY, "one", conn=conn)
    assert ectx.set_why("u1", "NVDA", TODAY, "two", conn=conn)["why"]["text"] == "two"


def test_the_why_route_answers_409_with_the_stored_words_on_a_stale_base(client, on):
    as_user(client.app_, "m1")
    url = "/api/j2/entry-context/why"
    key = {"symbol": "NVDA", "entryDay": TODAY}
    ectx.freeze("m1", "NVDA", TODAY, capture_kind="at_entry", trigger="manual_add", capture_day=TODAY)

    a = client.put(url, json={**key, "text": "tab A", "baseUpdatedAt": None})
    assert a.status_code == 200
    stamp = a.json()["context"]["why"]["updatedAt"]

    b = client.put(url, json={**key, "text": "tab B", "baseUpdatedAt": None})
    assert b.status_code == 409
    detail = b.json()["detail"]
    assert detail["code"] == "why_changed"
    assert detail["current"] == {"text": "tab A", "updatedAt": stamp}
    assert "your" in detail["message"].lower()

    # Saving again on the base the refusal handed back is the member's deliberate choice.
    again = client.put(url, json={**key, "text": "tab B", "baseUpdatedAt": stamp})
    assert again.status_code == 200 and again.json()["context"]["why"]["text"] == "tab B"
    # The "no context" 409 keeps its own, different shape.
    none = client.put(url, json={"symbol": "AMD", "entryDay": "2026-10-01", "text": "x", "baseUpdatedAt": None})
    assert none.status_code == 409 and isinstance(none.json()["detail"], str)
    # A base that is not text is a bad request, never a silent last-write-wins.
    assert client.put(url, json={**key, "text": "z", "baseUpdatedAt": 7}).status_code == 422


def test_why_for_trades_reads_by_the_same_key_and_creates_nothing(conn, src):
    _frozen(conn)
    ectx.set_why("u1", "NVDA", TODAY, "Tight flag at the 21EMA", conn=conn)
    nvda = _trade(conn, symbol="NVDA")
    amd = _trade(conn, symbol="AMD")
    other = _trade(conn, uid="u2", symbol="NVDA")
    rows = [dict(r) for r in conn.execute("SELECT id, symbol, entry_date AS entryDate, user_id FROM j2_trades")]
    mine = [r for r in rows if r["user_id"] == "u1"]
    got = ectx.why_for_trades("u1", mine, conn=conn)
    assert set(got) == {nvda} and got[nvda]["text"] == "Tight flag at the 21EMA"
    assert amd not in got
    assert ectx.why_for_trades("u2", [r for r in rows if r["id"] == other], conn=conn) == {}

    bare = sqlite3.connect(":memory:")
    bare.row_factory = sqlite3.Row
    try:
        assert ectx.why_for_trades("u1", mine, conn=bare) == {}
        assert bare.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()[0] == 0, \
            "an export created the entry-context table for a member who never used it"
    finally:
        bare.close()


import threading  # noqa: E402
import time  # noqa: E402


# ── fin-security I-1: the capture is paid-only, bounded, cached and off the request pool ────
#
# `POST /positions` is session-only. Its hook checked the flag and never the plan, then made a
# vendor read (FMP with a 10 s timeout, then Finnhub) as a Starlette background task, which
# runs on the same 64-thread pool every sync route uses. An unpaid member adding positions
# could pin that pool, spend vendor quota and store a paid surface's row for themselves.

def test_an_unpaid_members_position_captures_nothing_and_calls_no_source(conn, src, on, monkeypatch):
    monkeypatch.setattr(ectx, "member_is_paid", lambda uid: False)
    out = ectx.on_position_added("u1", {"symbol": "NVDA", "entryDate": AT_1030_ET})
    assert out == {"status": "skipped", "reason": "not_paid"}
    assert _dump_ctx(conn) == [] and src.calls == [] and src.fp_calls == []


def test_control_a_paid_members_position_is_captured(db_path, src, on, monkeypatch):
    monkeypatch.setattr(ectx, "today_et", lambda: TODAY)
    out = ectx.on_position_added("m1", {"symbol": "NVDA", "entryDate": AT_1030_ET})
    assert out["status"] == "frozen" and "earnings" in src.calls


def test_the_paid_test_is_the_routes_own_and_reads_the_member_by_id(db_path, monkeypatch):
    """Not the fixture's stand-in: the real predicate, over real rows."""
    from api.services import auth_service, trial
    monkeypatch.setattr(trial, "is_account_in_trial", lambda user, now=None: False)
    seen = []
    real = auth_service.get_user_plan
    monkeypatch.setattr(auth_service, "get_user_plan", lambda uid: seen.append(uid) or "free")
    assert ectx.member_is_paid("m1") is False and seen == ["m1"]
    monkeypatch.setattr(auth_service, "get_user_plan", lambda uid: "pro")
    assert ectx.member_is_paid("m1") is True
    assert ectx.member_is_paid("no-such-member") is False
    monkeypatch.setattr(auth_service, "get_user_plan", lambda uid: (_ for _ in ()).throw(RuntimeError("db")))
    assert ectx.member_is_paid("m1") is False          # unknown is never paid
    assert real is not None


def test_the_sweep_skips_members_who_are_not_paid(conn, src, on, monkeypatch):
    _position(conn, uid="paid", symbol="NVDA")
    _position(conn, uid="free", symbol="AMD")
    monkeypatch.setattr(ectx, "member_is_paid", lambda uid: uid == "paid")
    out = ectx.capture_todays_entries(conn=conn, today=TODAY)
    assert out["frozen"] == 1 and out["notPaid"] == 1
    assert [r["user_id"] for r in conn.execute("SELECT user_id FROM j2_entry_context")] == ["paid"]


def test_one_symbols_report_date_is_read_from_the_vendor_once_a_day_hit_or_miss(conn, src, on):
    ectx.freeze("u1", "NVDA", TODAY, capture_kind="at_entry", trigger="manual_add", conn=conn, capture_day=TODAY)
    ectx.freeze("u2", "NVDA", TODAY, capture_kind="at_entry", trigger="manual_add", conn=conn, capture_day=TODAY)
    assert src.calls.count("earnings") == 1
    rows = [json.loads(r[0])["days_to_earnings"] for r in conn.execute("SELECT context FROM j2_entry_context")]
    assert rows[0]["value"] == rows[1]["value"] == 18 and rows[0]["detail"] == rows[1]["detail"]

    src.report_date = None                                    # a symbol with no report date: a MISS
    ectx.freeze("u1", "ZZZZ", TODAY, capture_kind="at_entry", trigger="manual_add", conn=conn, capture_day=TODAY)
    ectx.freeze("u2", "ZZZZ", TODAY, capture_kind="at_entry", trigger="manual_add", conn=conn, capture_day=TODAY)
    assert src.calls.count("earnings") == 2, "a miss was not remembered: every add re-asks the vendor"


def test_a_vendor_error_is_remembered_briefly_then_asked_again(conn, src, on, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(ectx, "_monotonic", lambda: clock[0])
    src.report_date = RuntimeError("fmp down")
    a = ectx._earnings_field("NVDA", TODAY, "now")
    b = ectx._earnings_field("NVDA", TODAY, "now")
    assert a["missing"] == "source_error" and b == a and src.calls.count("earnings") == 1
    clock[0] += ectx.VENDOR_ERROR_TTL_S + 1
    src.report_date = "2026-10-20"
    assert ectx._earnings_field("NVDA", TODAY, "now")["value"] == 18


def test_with_every_vendor_slot_taken_the_field_says_busy_and_does_not_wait(conn, src, on):
    taken = [ectx._VENDOR_SLOTS.acquire(blocking=False) for _ in range(ectx.VENDOR_CONCURRENCY)]
    try:
        assert all(taken)
        started = time.monotonic()
        field = ectx._earnings_field("NVDA", TODAY, "now")
        assert time.monotonic() - started < 1.0, "a request thread waited for a vendor slot"
        assert field["missing"] == "source_busy" and "earnings" not in src.calls
    finally:
        for _ in taken:
            ectx._VENDOR_SLOTS.release()
    assert ectx._earnings_field("NVDA", TODAY, "now")["value"] == 18   # busy is never remembered


def test_the_scheduled_capture_never_runs_on_the_callers_thread(src, on, monkeypatch):
    ran = []
    done = threading.Event()

    def hook(uid, position):
        ran.append((threading.get_ident(), threading.current_thread().name, uid))
        done.set()
        return {"status": "frozen"}

    monkeypatch.setattr(ectx, "on_position_added", hook)
    ectx._reset_capture_queue()
    assert ectx.schedule_position_capture("u1", {"symbol": "NVDA", "entryDate": AT_1030_ET}) == "queued"
    assert done.wait(5), "the capture never ran"
    ident, name, uid = ran[0]
    assert ident != threading.get_ident() and name.startswith("entry-context") and uid == "u1"


def test_the_schedule_is_inert_while_the_flag_is_off(src, monkeypatch):
    monkeypatch.delenv(ectx.FLAG, raising=False)
    called = []
    monkeypatch.setattr(ectx, "on_position_added", lambda *a: called.append(a))
    assert ectx.schedule_position_capture("u1", {"symbol": "NVDA", "entryDate": AT_1030_ET}) == "skipped"
    time.sleep(0.05)
    assert called == []


def test_one_member_cannot_queue_more_than_their_share_and_the_queue_is_bounded(src, on, monkeypatch):
    gate = threading.Event()
    started = threading.Event()

    def slow(uid, position):
        started.set()
        gate.wait(10)

    monkeypatch.setattr(ectx, "on_position_added", slow)
    ectx._reset_capture_queue()
    pos = {"symbol": "NVDA", "entryDate": AT_1030_ET}
    try:
        answers = [ectx.schedule_position_capture("flooder", pos) for _ in range(ectx.CAPTURE_PER_MEMBER_MAX + 5)]
        assert answers.count("queued") == ectx.CAPTURE_PER_MEMBER_MAX
        assert set(answers[ectx.CAPTURE_PER_MEMBER_MAX:]) == {"member_busy"}
        # Another member is not starved by the first one's flood ...
        assert ectx.schedule_position_capture("someone-else", pos) == "queued"
        # ... and the whole queue has a ceiling.
        others = [ectx.schedule_position_capture(f"m{i}", pos) for i in range(ectx.CAPTURE_QUEUE_MAX + 5)]
        assert "queue_full" in others and others.count("queued") < ectx.CAPTURE_QUEUE_MAX
        assert started.wait(5)
    finally:
        gate.set()
    deadline = time.monotonic() + 10
    while ectx._capture_pending_total() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert ectx._capture_pending_total() == 0
    assert ectx.schedule_position_capture("flooder", pos) == "queued"     # the share is given back


def test_scheduling_never_raises_whatever_it_is_handed(src, on, monkeypatch):
    monkeypatch.setattr(ectx, "_capture_pool", lambda: (_ for _ in ()).throw(RuntimeError("no threads")))
    ectx._reset_capture_queue()
    assert ectx.schedule_position_capture("u1", {"symbol": "NVDA"}) == "error"
    assert ectx.schedule_position_capture("u1", None) in ("skipped", "error")
    assert ectx._capture_pending_total() == 0
