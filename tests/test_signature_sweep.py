"""The nightly closed-bar sweep — what makes the ledger accrue from launch day.

The request path (`/api/signature/flow-breakout`) only ever records a signal for
a symbol somebody happened to LOOK at, and only for bars that are already
closed-and-superseded. That is a receipt book with holes in it: on launch day
the ledger is empty, and it stays empty for every name nobody charted.

This sweep runs POST-close, so `include_last=True` is honest — the session's
final daily bar is confirmed — and it walks a fixed symbol list whether or not a
user ever opened a chart.

Three properties this file exists to hold:

* **The final bar is evaluated.** That is the entire difference from the request
  path. Pinned against the same bars evaluated with `include_last=False`
  (which find nothing), so the flag cannot be flipped back silently.
* **Nothing in one symbol — or one signal — can end the pass.** A dead provider
  and a ledger refusal are both routine; they cost their own row and nothing
  else. `errors` is the receipt that they happened.
* **Re-running is free.** Which is what makes the market-holiday case a no-op
  needing no calendar: the sweep re-sees the last session's bar, the ledger's
  UNIQUE key refuses it, `recorded` is 0. Nobody should ever "fix" this with a
  holiday guard.
"""
import ast
import inspect
import json
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api.services.signature import ledger
from api.services.signature import sweep as sweep_mod
from api.services.signature.flow_breakout import _bar_date_iso, fcb_signals
from api.services.signature.sweep import run_sweep

_ET = ZoneInfo("America/New_York")


@pytest.fixture
def tmp_ledger(tmp_path, monkeypatch):
    """Point the ledger at a throwaway file.

    BOTH the env var and the module constant, mirroring
    `test_signature_ledger.tmp_ledger`: `_DB_PATH` is read at import, so the env
    alone would not move an already-imported module, and the constant alone
    would leave a re-import reading `/data`. Nothing in this suite may touch the
    live ledger.
    """
    p = tmp_path / "l.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_INITED", False)
    return p


# ── fixtures ────────────────────────────────────────────────────────────────

def _bars_with_final_breakout():
    """25 quiet bars, then a volume-backed breakout that IS the last bar."""
    base = 100.0
    bars = [{"t": 86400 * i, "o": base, "h": base + 1, "l": base - 1, "c": base, "v": 1_000_000}
            for i in range(25)]
    bars.append({"t": 86400 * 25, "o": base, "h": base + 5, "l": base,
                 "c": base + 4, "v": 2_000_000})   # breakout IS the last bar
    return bars


def _bars_with_two_breakouts():
    """…and then a second breakout above the first — two signals, one symbol.

    Needed to prove the ledger guard is PER SIGNAL: with one signal per symbol a
    per-symbol guard is indistinguishable from a per-signal one.
    """
    bars = _bars_with_final_breakout()
    bars.append({"t": 86400 * 26, "o": 104.0, "h": 110.0, "l": 104.0,
                 "c": 109.0, "v": 2_000_000})
    return bars


_D1 = "1970-01-26"   # the session of bar t=86400*25
_D2 = "1970-01-27"   # the session of bar t=86400*26
_CALL = [{"CallPut": "CALL", "Premium": "900000"}]


def _flow_one_day():
    return {_D1: list(_CALL)}


def _flow_two_days():
    return {_D1: list(_CALL), _D2: list(_CALL)}


def _kwargs(bars=None, flow=None, now_iso="2026-08-03"):
    bars = _bars_with_final_breakout() if bars is None else bars
    flow = _flow_one_day() if flow is None else flow
    return dict(fetch_bars=lambda s: bars, fetch_flow=lambda s: flow, now_iso=now_iso)


# ── the brief's contract ────────────────────────────────────────────────────

def test_sweep_records_final_bar_signal(tmp_ledger):
    flow = {"1970-01-26": [{"CallPut": "CALL", "Premium": "900000"}]}
    res = run_sweep(["NVDA"], fetch_bars=lambda s: _bars_with_final_breakout(),
                    fetch_flow=lambda s: flow, now_iso="2026-08-03")
    assert res == {"scanned": 1, "recorded": 1, "errors": 0}
    assert len(ledger.get_signals("NVDA")) == 1


def test_sweep_is_idempotent(tmp_ledger):
    flow = {"1970-01-26": [{"CallPut": "CALL", "Premium": "900000"}]}
    kwargs = dict(fetch_bars=lambda s: _bars_with_final_breakout(),
                  fetch_flow=lambda s: flow, now_iso="2026-08-03")
    run_sweep(["NVDA"], **kwargs)
    res2 = run_sweep(["NVDA"], **kwargs)
    assert res2["recorded"] == 0 and len(ledger.get_signals("NVDA")) == 1


def test_sweep_survives_a_bad_symbol(tmp_ledger):
    def bars(s):
        if s == "BAD":
            raise RuntimeError("boom")
        return _bars_with_final_breakout()
    res = run_sweep(["BAD", "NVDA"], fetch_bars=bars,
                    fetch_flow=lambda s: {"1970-01-26": [{"CallPut": "C", "Premium": "900000"}]},
                    now_iso="2026-08-03")
    assert res["errors"] == 1 and res["recorded"] == 1


# ── the final bar is the whole point ────────────────────────────────────────

def test_the_sweep_sees_a_bar_the_request_path_cannot(tmp_ledger):
    """`include_last=True` is the entire reason this job exists.

    The same bars through the request path's `include_last=False` find NOTHING —
    so if the sweep ever flips that flag it stops adding anything the router did
    not already record, silently.
    """
    bars, flow = _bars_with_final_breakout(), _flow_one_day()
    assert fcb_signals(bars, flow, include_last=False) == []

    res = run_sweep(["NVDA"], **_kwargs(bars, flow))
    assert res["recorded"] == 1


# ── ledger seam (carry 2) ───────────────────────────────────────────────────

def test_the_row_carries_the_product_facing_timeframe_and_the_raw_bar_time(tmp_ledger):
    """`tf` is "1D" — the product label — never the bars-store key "D".

    And `barTime` goes in RAW: normalizing at the caller is how one session ends
    up keyed two ways across two writers, which breaks fire-once silently. The
    store owns that (`ledger._normalize_bar_time`).
    """
    run_sweep(["nvda"], **_kwargs())
    row = ledger.get_signals("NVDA")[0]
    assert row["tf"] == "1D"
    assert row["bar_time"] == 86400 * 25       # epoch passthrough, untouched
    assert row["indicator"] == "fcb" and row["version"] == "fcb-v1"
    assert row["direction"] == "bull"
    assert row["sym"] == "NVDA"


def test_the_meta_carries_both_premiums_and_the_sweep_date(tmp_ledger):
    run_sweep(["NVDA"], **_kwargs(now_iso="2026-08-03"))
    meta = json.loads(ledger.get_signals("NVDA")[0]["meta_json"])
    assert meta["callPrem"] == 900_000.0
    assert meta["putPrem"] == 0.0
    assert meta["sweep"] == "2026-08-03"


def test_one_refused_signal_does_not_cost_the_others(tmp_ledger, monkeypatch):
    """`record_signal` RAISES on anything it cannot key — by design.

    Guarding per SYMBOL is not enough: the first refusal would abandon every
    later signal for that symbol. This drives two signals through one symbol and
    refuses the first.
    """
    real = ledger.record_signal
    calls = {"n": 0}

    def flaky(*a, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise ValueError("refused")
        return real(*a, **kw)

    monkeypatch.setattr(ledger, "record_signal", flaky)
    res = run_sweep(["NVDA"], **_kwargs(_bars_with_two_breakouts(), _flow_two_days()))

    assert calls["n"] == 2, "the second signal must still be attempted"
    assert res == {"scanned": 1, "recorded": 1, "errors": 1}
    assert len(ledger.get_signals("NVDA")) == 1


def test_a_refusal_is_logged_loudly(tmp_ledger, monkeypatch, caplog):
    """A silently dropped receipt is worse than a missing one — it looks fine."""
    monkeypatch.setattr(ledger, "record_signal",
                        lambda *a, **kw: (_ for _ in ()).throw(ValueError("refused")))
    with caplog.at_level("ERROR", logger="signature.sweep"):
        res = run_sweep(["NVDA"], **_kwargs())
    assert res["errors"] == 1
    assert any(r.levelname == "ERROR" and "NVDA" in r.getMessage() for r in caplog.records)


def test_a_dead_symbol_is_logged_and_the_pass_continues(tmp_ledger, caplog):
    def bars(s):
        if s == "BAD":
            raise RuntimeError("boom")
        return _bars_with_final_breakout()

    with caplog.at_level("ERROR", logger="signature.sweep"):
        res = run_sweep(["BAD", "NVDA", "AMD"], fetch_bars=bars,
                        fetch_flow=lambda s: _flow_one_day(), now_iso="2026-08-03")
    assert res == {"scanned": 2, "recorded": 2, "errors": 1}
    assert any("BAD" in r.getMessage() for r in caplog.records)


def test_a_symbol_with_no_signal_is_still_a_clean_scan(tmp_ledger):
    """Quiet tape is an ANSWER. It must not read as an error."""
    quiet = [{"t": 86400 * i, "o": 100.0, "h": 101.0, "l": 99.0, "c": 100.0, "v": 1_000_000}
             for i in range(26)]
    res = run_sweep(["SPY"], **_kwargs(quiet, {}))
    assert res == {"scanned": 1, "recorded": 0, "errors": 0}


# ── holiday idempotency (carry 5) ───────────────────────────────────────────

def test_a_market_holiday_is_a_clean_no_op_and_needs_no_guard(tmp_ledger):
    """On a holiday the bars store still ends at the last SESSION's bar.

    The sweep re-evaluates it, the ledger's UNIQUE key refuses it, and the pass
    records 0 — no calendar, no holiday list, no skip logic. This test exists so
    that nobody later "fixes" a non-problem by adding one (and so that a change
    which broke dedup would surface as a double-recorded holiday rather than as
    a quiet duplicate months later).
    """
    kwargs = _kwargs()
    first = run_sweep(["NVDA"], **kwargs)
    holiday = run_sweep(["NVDA"], **kwargs)      # identical bars — nothing new closed

    assert first["recorded"] == 1
    assert holiday == {"scanned": 1, "recorded": 0, "errors": 0}
    assert len(ledger.get_signals("NVDA")) == 1


# ── the flow date join (carry 3) ────────────────────────────────────────────

def test_flow_dates_are_keyed_the_same_way_bar_dates_are():
    """The join is only as good as the agreement between these two functions.

    `_flow_by_date` normalizes the flow table's M/D/YYYY; `_bar_date_iso`
    normalizes the bar timestamp. If either drifts, the join matches nothing and
    the indicator ships silently dead — there is no error anywhere.
    """
    rows = [{"CreatedDate": "1/26/1970", "CallPut": "CALL", "Premium": "900000"}]
    by_date = sweep_mod._flow_by_date(rows)
    assert list(by_date) == [_bar_date_iso(86400 * 25)]


def test_flow_dates_are_zero_padded_and_garbage_is_skipped():
    rows = [{"CreatedDate": "7/3/2026"}, {"CreatedDate": "12/25/2026"},
            {"CreatedDate": ""}, {"CreatedDate": "not-a-date"},
            {"CreatedDate": None}, {}]
    by_date = sweep_mod._flow_by_date(rows)
    assert sorted(by_date) == ["2026-07-03", "2026-12-25"]
    assert all(len(v) == 1 for v in by_date.values())


def test_rows_on_the_same_day_are_grouped_not_replaced():
    rows = [{"CreatedDate": "7/3/2026", "Premium": "1"},
            {"CreatedDate": "7/3/2026", "Premium": "2"}]
    assert len(sweep_mod._flow_by_date(rows)["2026-07-03"]) == 2


# ── sweep_job: the scheduled entry ──────────────────────────────────────────

def _capture_run_sweep(monkeypatch):
    seen = {}

    def fake(symbols, **kw):
        seen["symbols"] = list(symbols)
        seen["kw"] = kw
        return {"scanned": 0, "recorded": 0, "errors": 0}

    monkeypatch.setattr(sweep_mod, "run_sweep", fake)
    return seen


def test_sweep_job_defaults_to_the_ten_launch_symbols(monkeypatch):
    monkeypatch.delenv("SIGNATURE_SWEEP_SYMBOLS", raising=False)
    seen = _capture_run_sweep(monkeypatch)
    sweep_mod.sweep_job()
    assert seen["symbols"] == ["SPY", "QQQ", "NVDA", "TSLA", "AAPL",
                               "MSFT", "AMD", "META", "AMZN", "GOOGL"]


def test_sweep_job_reads_the_symbol_list_from_the_environment(monkeypatch):
    monkeypatch.setenv("SIGNATURE_SWEEP_SYMBOLS", " nvda , ,amd,  ")
    seen = _capture_run_sweep(monkeypatch)
    sweep_mod.sweep_job()
    assert seen["symbols"] == ["NVDA", "AMD"]


def test_sweep_job_wires_the_real_router_fetchers(monkeypatch):
    from api.routers import signature as sig
    seen = _capture_run_sweep(monkeypatch)
    sweep_mod.sweep_job()
    assert seen["kw"]["fetch_bars"] is sig._fetch_bars


def test_the_flow_fetcher_calls_the_router_with_the_symbol_alone(monkeypatch):
    """Carry 1: `_fetch_flow_rows` takes NO cookie — auth was dropped in review.

    Pinned two ways: the live signature of the function this job depends on, and
    the actual outbound call.
    """
    from api.routers import signature as sig
    assert list(inspect.signature(sig._fetch_flow_rows).parameters) == ["sym"]

    calls = []
    monkeypatch.setattr(sig, "_fetch_flow_rows",
                        lambda *a, **kw: calls.append((a, kw)) or
                        [{"CreatedDate": "1/26/1970", "CallPut": "CALL", "Premium": "900000"}])
    seen = _capture_run_sweep(monkeypatch)
    sweep_mod.sweep_job()

    by_date = seen["kw"]["fetch_flow"]("NVDA")
    assert calls == [(("NVDA",), {})]
    assert by_date == {"1970-01-26": [{"CreatedDate": "1/26/1970",
                                       "CallPut": "CALL", "Premium": "900000"}]}


def test_a_failed_flow_read_is_an_error_not_an_empty_tape(monkeypatch, tmp_ledger):
    """`_fetch_flow_rows` returns None when the READ failed.

    Treating that as `{}` would score an outage as a clean scan with no signals
    — a failed fetch remembered as a value (`lesson_market_cap_cache_poison`).
    It has to land in `errors`.
    """
    from api.routers import signature as sig
    monkeypatch.setattr(sig, "_fetch_flow_rows", lambda sym: None)
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars_with_final_breakout())
    monkeypatch.setenv("SIGNATURE_SWEEP_SYMBOLS", "NVDA")

    seen = {}
    real = sweep_mod.run_sweep
    monkeypatch.setattr(sweep_mod, "run_sweep",
                        lambda symbols, **kw: seen.setdefault("res", real(symbols, **kw)))
    sweep_mod.sweep_job()
    assert seen["res"] == {"scanned": 0, "recorded": 0, "errors": 1}


def test_sweep_job_never_raises_into_the_scheduler(monkeypatch, caplog):
    """APScheduler survives a raising job, but the next one in the block does
    not run any earlier for it. A scheduled entry swallows and logs."""
    def boom(*a, **kw):
        raise RuntimeError("catastrophe")

    monkeypatch.setattr(sweep_mod, "run_sweep", boom)
    with caplog.at_level("ERROR", logger="signature.sweep"):
        sweep_mod.sweep_job()          # must not raise
    assert any(r.levelname == "ERROR" for r in caplog.records)


def test_the_sweep_date_is_the_ET_session_date_not_the_UTC_one():
    """The pod runs UTC. At 16:45 ET the two agree — but a retry, a backfill or
    a DST edge can put the job past 20:00 ET, where `date.today()` on a UTC box
    stamps TOMORROW onto tonight's receipts. The clock is injected so this is
    provable rather than a test that only fails after 8 PM."""
    late_et = datetime(2026, 8, 4, 1, 30, tzinfo=timezone.utc)   # = 2026-08-03 21:30 ET
    assert sweep_mod._sweep_date_iso(late_et) == "2026-08-03"
    assert sweep_mod._sweep_date_iso() == datetime.now(_ET).date().isoformat()


# ── scheduler registration (carry 4 + 6) ────────────────────────────────────

class _FakeSched:
    def __init__(self):
        self.jobs = []

    def add_job(self, func, *a, **kw):
        self.jobs.append((func, a, kw))


def _registered():
    import api.main as main
    sched = _FakeSched()
    assert main.register_signature_sweep_job(sched) is True
    assert len(sched.jobs) == 1
    return sched.jobs[0]


def test_the_sweep_job_is_registered_under_a_stable_id():
    func, _a, kw = _registered()
    assert kw["id"] == "signature_sweep"
    assert kw["replace_existing"] is True
    assert kw["max_instances"] == 1
    assert func is sweep_mod.sweep_job


def test_the_cron_fires_at_1645_ET_on_weekdays_in_both_halves_of_the_year():
    """Not `timezone=_ET` as a string in the source — the WALL CLOCK.

    A naive/UTC cron is the house trap (`lesson_apscheduler_cron_utc_trap`): it
    passes every structural check and then runs an hour off for half the year,
    which for a post-close job means sweeping while the tape is still open.
    """
    _f, _a, kw = _registered()
    trig = kw["trigger"]

    summer = trig.get_next_fire_time(None, datetime(2026, 8, 3, 12, 0, tzinfo=_ET))
    assert (summer.year, summer.month, summer.day) == (2026, 8, 3)
    assert (summer.hour, summer.minute) == (16, 45)
    assert summer.tzinfo.key == "America/New_York"

    winter = trig.get_next_fire_time(None, datetime(2026, 1, 5, 12, 0, tzinfo=_ET))
    assert (winter.hour, winter.minute) == (16, 45)

    # …and never on a weekend.
    sat = trig.get_next_fire_time(None, datetime(2026, 8, 8, 12, 0, tzinfo=_ET))
    assert sat.weekday() == 0            # Monday, not Saturday or Sunday


def test_the_cron_lands_after_the_close_not_before_it():
    _f, _a, kw = _registered()
    fire = kw["trigger"].get_next_fire_time(None, datetime(2026, 8, 3, 12, 0, tzinfo=_ET))
    close = fire.replace(hour=16, minute=0)
    assert fire > close


def test_the_lifespan_actually_calls_the_registration():
    """The registration function is unit-testable; the CALL SITE is not.

    So it is proven by parsing `api/main.py` and finding a real Call node inside
    `lifespan` — a comment, a docstring mention or a deleted line all fail it,
    which a substring search cannot claim.
    """
    import api.main as main
    tree = ast.parse(Path(main.__file__).read_text(encoding="utf-8"))
    lifespans = [n for n in ast.walk(tree)
                 if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef)) and n.name == "lifespan"]
    assert lifespans, "api.main.lifespan not found — this test needs rewiring"
    called = {n.func.id for n in ast.walk(lifespans[0])
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "register_signature_sweep_job" in called
