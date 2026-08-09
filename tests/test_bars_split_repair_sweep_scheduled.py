"""🔴 THE SPLIT BACK-ADJUSTMENT SWEEP HAS A SCHEDULE.

THE DEFECT THIS FILE EXISTS FOR
-------------------------------
`bars_split_repair` shipped in `61f3b33b` with a serve-path hand-off (a charted
ticker heals itself) and `tools/bars_split_repair_sweep.py` (a human runs it) —
and **no scheduler entry at all**, because `api/main.py` was held by another
lane. Its own report says so: *"⏳ NOT wired: a scheduled sweep."* So the
un-charted tail of the universe — which on this branch is most of it — healed
nowhere, while `snapshot_builder`, `scan_evaluator` and the alert lane all read
those rows.

⛔ THIS REPO HAS ALREADY PAID FOR EXACTLY THAT. The Desk session-insights pass
was written, documented as scheduled, wired into no scheduler, and its deferred
Zoom deletes had no collector for weeks (`CLAUDE.md`, 2026-07-02).

WHAT "PROVABLY REGISTERED" MEANS HERE
-------------------------------------
Two different things, and both are needed:

  1. `register_bars_split_repair_sweep` puts the job in a **real APScheduler's
     own job list** — not a fake recorder, not the source text. A `CronTrigger`
     that would not build is a registration that does not exist.
  2. The lifespan **calls** that function. Without (2), (1) proves a correct
     component wired to nothing — which is the shape of every finding in the
     2026-08-08 reachability audit.

⛔ AND THE HOUR IS PROVED DERIVED, NOT ASSERTED TO BE 02:30. The control moves
the session open and requires the cron to move with it. A hardcoded `hour=2`
passes an equality check against today and fails that control.
"""
import ast
import datetime
import os
import pathlib
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.main as m  # noqa: E402
from api.services import bars_sanitize as _san  # noqa: E402
from api.services import bars_split_repair  # noqa: E402
from api.services import bars_sqlite  # noqa: E402
from api.services.cache import cache  # noqa: E402
from api.services.screener import scan_evaluator  # noqa: E402

JOB_ID = "bars_split_repair_sweep"
REPO = pathlib.Path(__file__).resolve().parent.parent
MAIN = REPO / "api/main.py"


def _scheduler():
    """A REAL scheduler, never started. `add_job` on a stopped scheduler still
    builds the trigger and stores the job, and `get_jobs()` returns it — so this
    reads APScheduler's own registry rather than a recording double."""
    from apscheduler.schedulers.background import BackgroundScheduler
    return BackgroundScheduler(timezone=m._ET)


def _ids(sched):
    return [j.id for j in sched.get_jobs()]


# ── 1. the registration, in the scheduler's own job list ────────────────────

def test_the_sweep_appears_in_the_schedulers_job_list(monkeypatch):
    monkeypatch.delenv("BARS_SPLIT_REPAIR_ENABLED", raising=False)
    sched = _scheduler()
    assert m.register_bars_split_repair_sweep(sched) is True
    assert JOB_ID in _ids(sched), (
        f"`bars_split_repair` has a serve-path hand-off and a manual tool and "
        f"NO schedule; the un-charted tail of the store heals nowhere. "
        f"Registered: {_ids(sched)}")


def test_the_registered_job_is_the_sweep_and_not_a_stub(monkeypatch):
    """A job id proves a registration, not that it does the thing."""
    monkeypatch.delenv("BARS_SPLIT_REPAIR_ENABLED", raising=False)
    sched = _scheduler()
    m.register_bars_split_repair_sweep(sched)
    job = sched.get_job(JOB_ID)
    assert job.func is m._run_bars_split_repair_sweep
    assert job.max_instances == 1


def test_the_kill_switch_unregisters_it(monkeypatch):
    """⛔ NO NEW FLAG — the module's own switch, so one feature has one door."""
    monkeypatch.setenv("BARS_SPLIT_REPAIR_ENABLED", "0")
    sched = _scheduler()
    assert m.register_bars_split_repair_sweep(sched) is False
    assert _ids(sched) == []


# ── 2. the lifespan actually calls it ───────────────────────────────────────

def test_the_lifespan_calls_the_registration():
    """⛔ AN AST, NEVER A GREP (`lesson_probe_names_must_be_derived_not_typed`):
    a grep matches the comment block above the call and the `def` line itself.
    This counts CALL nodes and excludes the definition."""
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
             and n.func.id == "register_bars_split_repair_sweep"]
    assert calls, (
        "`register_bars_split_repair_sweep` is defined in api/main.py and called "
        "nowhere. The job list test above is then measuring a function no running "
        "process ever invokes — built, tested, green and connected to nothing.")

    defs = [n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name == "register_bars_split_repair_sweep"]
    assert defs, "the registration function itself is gone"
    # ⛔ NON-VACUITY: the probe must be able to see a call it is NOT looking for.
    sibling = [n for n in ast.walk(tree)
               if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
               and n.func.id == "register_signature_sweep_job"]
    assert sibling, "the AST call-scan found no sibling registration; it is broken"


# ── 3. the hour is DERIVED from the session anchor ──────────────────────────

def _cron_fields(job):
    return {f.name: str(f) for f in job.trigger.fields}


def test_the_fire_time_is_todays_session_open_minus_the_declared_lead(monkeypatch):
    monkeypatch.delenv("BARS_SPLIT_REPAIR_ENABLED", raising=False)
    sched = _scheduler()
    m.register_bars_split_repair_sweep(sched)
    fields = _cron_fields(sched.get_job(JOB_ID))
    want = (scan_evaluator.market_open_et(datetime.datetime.now(m._ET).date())
            - m._SPLIT_SWEEP_LEAD_BEFORE_OPEN)
    assert fields["hour"] == str(want.hour)
    assert fields["minute"] == str(want.minute)


def test_moving_the_session_open_moves_the_schedule(monkeypatch):
    """⭐ THE CONTROL WITHOUT WHICH THE TEST ABOVE IS AN EQUALITY AGAINST TODAY.

    A hardcoded `hour=2, minute=30` satisfies the previous assertion forever and
    fails here. This is the property `scan_evaluator.market_open_et` exists for:
    the open is stated once, in `bars_fetch.bucket_60_et_unix_seconds`, and every
    budget hangs off it rather than re-typing 09:30.
    """
    monkeypatch.delenv("BARS_SPLIT_REPAIR_ENABLED", raising=False)
    monkeypatch.setattr(
        scan_evaluator, "market_open_et",
        lambda day: datetime.datetime(day.year, day.month, day.day, 11, 45,
                                      tzinfo=m._ET))
    sched = _scheduler()
    m.register_bars_split_repair_sweep(sched)
    fields = _cron_fields(sched.get_job(JOB_ID))
    want = datetime.datetime(2000, 1, 1, 11, 45) - m._SPLIT_SWEEP_LEAD_BEFORE_OPEN
    assert (fields["hour"], fields["minute"]) == (str(want.hour), str(want.minute)), (
        f"the session open moved to 11:45 and the cron did not follow "
        f"({fields['hour']}:{fields['minute']}). The hour is typed, not derived.")


def test_the_registration_writes_no_literal_clock_time():
    """The same fact one level down: the `CronTrigger` in the registration must
    take EXPRESSIONS for hour/minute, never `ast.Constant`s."""
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef)
              and n.name == "register_bars_split_repair_sweep")
    crons = [n for n in ast.walk(fn)
             if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "CronTrigger"]
    assert len(crons) == 1, f"expected one CronTrigger, found {len(crons)}"
    for kw in crons[0].keywords:
        if kw.arg in ("hour", "minute"):
            assert not isinstance(kw.value, ast.Constant), (
                f"CronTrigger({kw.arg}=<literal>) — a fifth hand-typed copy of "
                f"the session clock beside the function that derives it")


def test_the_sweep_lands_before_the_two_nightly_readers_of_the_same_store():
    """⭐ THE REASON FOR SEVEN HOURS, MADE EXECUTABLE. `screener_snapshot_nightly`
    (03:00 ET) and `screener_scan_sweep` (`scan_evaluator.SWEEP_HOUR_ET`) both
    read `bars_sqlite` directly. A split healed after them is a split their rows
    spend the whole day not having. Both bounds are READ, never retyped."""
    fire = (scan_evaluator.market_open_et(datetime.datetime.now(m._ET).date())
            - m._SPLIT_SWEEP_LEAD_BEFORE_OPEN)
    assert fire.hour < 3, f"the sweep fires at {fire:%H:%M}, at or after the 03:00 build"
    assert fire.hour < scan_evaluator.SWEEP_HOUR_ET, (
        f"the sweep fires at {fire:%H:%M}, not before the scan sweep at "
        f"{scan_evaluator.SWEEP_HOUR_ET:02d}:{scan_evaluator.SWEEP_MINUTE_ET:02d}")


# ── 4. what the job does when it runs ───────────────────────────────────────

@pytest.fixture
def sweep_env(monkeypatch):
    """A run with no network, no store and no clock pressure."""
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    monkeypatch.delenv("BARS_SPLIT_REPAIR_ENABLED", raising=False)
    monkeypatch.setattr(m, "_split_sweep_cursor", 0)
    monkeypatch.setattr(scan_evaluator, "sweep_deadline",
                        lambda *a, **k: datetime.datetime.now(m._ET)
                        + datetime.timedelta(hours=1))
    calls = []
    monkeypatch.setattr(bars_split_repair, "repair_all_tfs",
                        lambda t, **k: calls.append((t, k)) or [
                            {"ticker": t, "tf": "D", "boundaries": [("2026-06-18", 0.333)],
                             "written": 7}])
    return calls


def _universe(monkeypatch, syms):
    monkeypatch.setattr(bars_sqlite, "get_all_tickers",
                        lambda: [(s, "D") for s in syms])


def _meta(monkeypatch, mapping):
    """Serve corporate actions from the module's own key, never a retyped one."""
    for sym in mapping:
        cache.invalidate(_san._META_KEY.format(sym))
    monkeypatch.setattr(_san, "_fetch_meta",
                        lambda t: {"ipo": None, "splits": mapping.get(t, [])})


def test_a_ticker_with_a_declared_split_is_repaired(monkeypatch, sweep_env):
    _universe(monkeypatch, ["ZZSPLIT"])
    _meta(monkeypatch, {"ZZSPLIT": [("2026-06-24", 0.3333)]})
    res = m._run_bars_split_repair_sweep()
    assert [t for t, _k in sweep_env] == ["ZZSPLIT"]
    assert res["repaired"] == 1 and res["rows"] == 7
    assert res["boundaries"], "a repair wrote rows and reported no boundary"


def test_a_ticker_with_no_declared_split_never_touches_the_store(monkeypatch, sweep_env):
    """⭐ THE COST DECISION. `plan_repair` reads the ENTIRE stored series before
    it looks at the split list, so asking it about a split-less ticker costs a
    full-history read per timeframe. Pre-filtering on the declared actions is
    what keeps a universe pass affordable — and it is a scheduling decision, not
    a second copy of the split judgement."""
    _universe(monkeypatch, ["ZZCLEAN"])
    _meta(monkeypatch, {"ZZCLEAN": []})
    res = m._run_bars_split_repair_sweep()
    assert sweep_env == [], "the store was read for a ticker with no declared split"
    assert res["no_splits"] == 1 and res["repaired"] == 0


def test_no_fmp_key_REFUSES_instead_of_reporting_a_clean_sweep(monkeypatch, sweep_env):
    """🔴 THE VACUITY THE TOOL COULD NOT DETECT. `_fmp_get` returns None with no
    key, `_fetch_meta` answers `{"splits": []}` WITHOUT raising, and every ticker
    in the universe reads as 'nothing to adjust'. A sweep that logged a clean
    night in that state would be a permanently-green monitor over a lane that
    heals nothing (`lesson_health_check_reads_a_proxy_not_the_artifact`)."""
    monkeypatch.setenv("FMP_API_KEY", "")
    _universe(monkeypatch, ["ZZSPLIT"])
    _meta(monkeypatch, {"ZZSPLIT": [("2026-06-24", 0.3333)]})
    res = m._run_bars_split_repair_sweep()
    assert sweep_env == []
    assert res["meta_failed"] == -1, (
        "the sweep ran without corporate-action metadata and reported a clean run")
    assert res["no_splits"] == 0, "a refusal must not be reported as 'nothing to do'"


def test_a_provider_failure_is_counted_not_swallowed_as_clean(monkeypatch, sweep_env):
    _universe(monkeypatch, ["ZZBOOM"])
    cache.invalidate(_san._META_KEY.format("ZZBOOM"))

    def _boom(_t):
        raise RuntimeError("FMP is down")
    monkeypatch.setattr(_san, "_fetch_meta", _boom)
    res = m._run_bars_split_repair_sweep()
    assert res["meta_failed"] == 1 and res["no_splits"] == 0, (
        "a provider outage was counted as 'this ticker has no splits' — the "
        "difference between 'we could not ask' and 'there is nothing there' is "
        "the whole point of reporting four counts")


def test_one_tickers_exception_does_not_end_the_night(monkeypatch, sweep_env):
    _universe(monkeypatch, ["ZZA", "ZZB"])
    _meta(monkeypatch, {"ZZA": [("2026-01-02", 0.5)], "ZZB": [("2026-01-02", 0.5)]})

    def _repair(t, **k):
        if t == "ZZA":
            raise RuntimeError("bars.db is locked")
        return [{"ticker": t, "tf": "D", "boundaries": [], "written": 3}]
    monkeypatch.setattr(bars_split_repair, "repair_all_tfs", _repair)
    with pytest.raises(RuntimeError):
        _repair("ZZA")                       # the double really does raise
    res = m._run_bars_split_repair_sweep()   # and the job must not
    assert res["repaired"] == 1, "the run died on the first bad ticker"


def test_the_job_never_raises_into_the_scheduler(monkeypatch, sweep_env):
    """A scheduler job that throws takes its own next run down with it."""
    monkeypatch.setattr(bars_sqlite, "get_all_tickers",
                        lambda: (_ for _ in ()).throw(RuntimeError("no store")))
    m._run_bars_split_repair_sweep()         # must not raise


def test_the_deadline_stops_the_run_before_members_trade(monkeypatch, sweep_env):
    """⛔ DERIVED FROM THE SAME ANCHOR AS THE SCAN SWEEP'S. A repair pass still
    grinding the store at the open is the failure this bound exists for."""
    _universe(monkeypatch, ["ZZA", "ZZB", "ZZC"])
    _meta(monkeypatch, {s: [("2026-01-02", 0.5)] for s in ("ZZA", "ZZB", "ZZC")})
    monkeypatch.setattr(scan_evaluator, "sweep_deadline",
                        lambda *a, **k: datetime.datetime.now(m._ET)
                        - datetime.timedelta(minutes=1))
    res = m._run_bars_split_repair_sweep()
    assert res["stopped_early"] is True and res["considered"] == 0
    assert sweep_env == []


def test_consecutive_nights_walk_different_tickers(monkeypatch, sweep_env):
    """Without a cursor the sweep re-reads the head of the alphabet every night
    and the tail is never reached."""
    monkeypatch.setattr(m, "_SPLIT_SWEEP_MAX_TICKERS", 2)
    syms = ["ZZA", "ZZB", "ZZC", "ZZD"]
    _universe(monkeypatch, syms)
    _meta(monkeypatch, {s: [("2026-01-02", 0.5)] for s in syms})
    m._run_bars_split_repair_sweep()
    first = [t for t, _k in sweep_env]
    sweep_env.clear()
    m._run_bars_split_repair_sweep()
    second = [t for t, _k in sweep_env]
    assert first == ["ZZA", "ZZB"] and second == ["ZZC", "ZZD"], (
        f"the cursor did not advance: {first} then {second}")
