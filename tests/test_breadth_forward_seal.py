"""THE DAILY FORWARD SEAL — the job that stops a published PIT series freezing.

⭐⭐ THE CLAIM: after the historical grind, something must advance the RIGHT edge.
`universe_backfill_plan` only ever walks BACKWARD to the floor, so without this a
published `US:A50` would stop on whatever day the grind ended and nothing anywhere
would say so.

⛔ AND IT IS NOT A SECOND METRIC ENGINE. `forward_seal_tick` orchestrates;
`sweep_history` does the work — the same eligibility, the same `compute_metrics`, the
same applicability filter and the same writer as every historical row beside it. These
rails check the ORCHESTRATION (calendar, bound, refusal, idempotency, isolation) with
`sweep_history` stubbed, plus one end-to-end pass through the real pipeline on the
durable fixture cache.
"""
import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_history_recon as recon


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "seal.db"))
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)
    store._INIT_DONE = False
    recon._FORWARD_SEAL_STATE.clear()
    yield
    store._INIT_DONE = False


def seed(universe, date, metric="pct_above_50sma", value=50.0):
    store.write_bulk([(date, metric, value, value, value, value)],
                     source="close_recon", universe=universe)


# ── the calendar ─────────────────────────────────────────────────────────────

def test_the_calendar_comes_from_the_repos_ONE_closure_table():
    """⛔ No second holiday list. `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` carries an
    explicit 'refresh annually from nyse.com' contract and five services read it."""
    import inspect
    src = inspect.getsource(recon.is_trading_session)
    assert "_is_nyse_holiday" in src
    assert "20260101" not in src and "holidays = " not in src


@pytest.mark.parametrize("iso,trading,why", [
    ("2026-09-14", True, "ordinary Monday"),
    ("2026-09-11", True, "ordinary Friday"),
    ("2026-09-12", False, "Saturday"),
    ("2026-09-13", False, "Sunday"),
    ("2026-09-07", False, "Labor Day"),
    ("2026-11-26", False, "Thanksgiving"),
    ("2026-12-25", False, "Christmas"),
    ("2026-01-01", False, "New Year's Day"),
])
def test_is_trading_session(iso, trading, why):
    assert recon.is_trading_session(iso) is trading, why


def test_sessions_between_skips_weekends_and_holidays():
    # 2026-09-07 is Labor Day; 05/06 and 12/13 are weekends
    assert recon.sessions_between("2026-09-04", "2026-09-14") == [
        "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"]


def test_sessions_between_is_exclusive_of_the_last_sealed_day():
    got = recon.sessions_between("2026-09-08", "2026-09-10")
    assert got == ["2026-09-09", "2026-09-10"]


# ── the planner ──────────────────────────────────────────────────────────────

def test_uct_is_refused_it_is_sealed_by_the_collector():
    plan = recon.forward_seal_plan("uct")
    assert plan["ok"] is False and plan["blocked"] is True
    assert "collector" in plan["reason"]


def test_an_empty_store_is_BLOCKED_not_a_one_day_gap():
    """⛔ With no rows there is no 'latest sealed session' to walk forward from, and
    inventing one (the floor, say) would turn a daily job into the historical grind."""
    plan = recon.forward_seal_plan("us", through="2026-09-14")
    assert plan["blocked"] is True and plan["empty"] is True
    assert plan["last_sealed"] is None
    assert "backfill" in plan["reason"]


def test_already_current_is_blocked_with_no_sessions():
    seed("us", "2026-09-14")
    plan = recon.forward_seal_plan("us", through="2026-09-14")
    assert plan["blocked"] is True and plan["current"] is True
    assert plan["sessions"] == []


def test_a_weekend_only_remainder_is_current_not_pending():
    seed("us", "2026-09-11")                       # Friday
    plan = recon.forward_seal_plan("us", through="2026-09-13")   # Sunday
    assert plan["blocked"] is True and plan["current"] is True


def test_a_three_day_gap_plans_three_sessions_in_order():
    seed("us", "2026-09-08")
    plan = recon.forward_seal_plan("us", through="2026-09-11")
    assert plan["blocked"] is False
    assert plan["sessions"] == ["2026-09-09", "2026-09-10", "2026-09-11"]
    assert plan["from"] == "2026-09-09" and plan["to"] == "2026-09-11"


def test_the_catch_up_bound_reports_GAPPED_rather_than_grinding():
    """⛔⛔ A 200-session hole is an outage, not a late tick. Letting a daily job close
    it would be an accidental historical grind on the web pod."""
    seed("us", "2026-01-05")
    plan = recon.forward_seal_plan("us", through="2026-09-14")
    assert plan["blocked"] is True and plan["gapped"] is True
    assert plan["pending"] > recon.FORWARD_SEAL_MAX_SESSIONS
    assert plan["sessions"] == []
    assert "backfill" in plan["reason"]
    assert plan["first_missing"] and plan["last_missing"]


def test_the_bound_is_inclusive_at_its_edge():
    seed("us", "2026-08-31")
    n = len(recon.sessions_between("2026-08-31", "2026-09-14"))
    assert n == 9, "09-07 is Labor Day, so this window is 9 sessions, not 10"
    exactly = recon.forward_seal_plan("us", through="2026-09-14", max_sessions=n)
    assert len(exactly["sessions"]) == n and exactly["blocked"] is False
    assert recon.forward_seal_plan("us", through="2026-09-14",
                                   max_sessions=n - 1)["gapped"] is True


def test_through_defaults_to_yesterday_never_today(monkeypatch):
    """⛔ Today's grouped-daily frame is not settled while the session is open;
    sealing it would either fail or seal a partial session as final."""
    monkeypatch.setattr(recon, "_et_today", lambda: "2026-09-15")
    seed("us", "2026-09-01")
    assert recon.forward_seal_plan("us")["through"] == "2026-09-14"


# ── the runner ───────────────────────────────────────────────────────────────

def _stub_sweep(monkeypatch, **out):
    calls = []

    def _fake(frm, to, universe=None, **kw):
        calls.append((frm, to, universe))
        return {"ok": True, "sessions": len(recon.sessions_between(
            (__import__("datetime").date.fromisoformat(frm)
             - __import__("datetime").timedelta(days=1)).isoformat(), to)),
            **out}
    monkeypatch.setattr(recon, "sweep_history", _fake)
    return calls


def test_the_gap_is_ONE_sweep_call_not_one_per_date(monkeypatch):
    """⚠️ `sweep_history` builds a ~560-day frame. Per-date calls would rebuild it
    for every session in the gap."""
    seed("us", "2026-09-08")
    calls = _stub_sweep(monkeypatch)
    res = recon.forward_seal_tick("us", through="2026-09-11")
    assert calls == [("2026-09-09", "2026-09-11", "us")]
    assert res["sealed"] == 3 and res["expected"] == 3
    assert not res.get("failed") and not res.get("partial")


def test_a_refused_chunk_is_recorded_and_the_dates_are_LEFT(monkeypatch):
    """⛔ `build_frame` refuses a chunk whose sweep dates have no RAW frame rather
    than writing a silent gap. The seal must carry that refusal through verbatim —
    no partial write, no fabricated zero, no green log."""
    seed("us", "2026-09-08")
    monkeypatch.setattr(recon, "sweep_history", lambda *a, **k: {
        "ok": False, "reason": "2 of 3 sweep dates have no raw grouped-daily frame",
        "missing_raw": ["2026-09-10", "2026-09-11"]})
    res = recon.forward_seal_tick("us", through="2026-09-11")
    assert res["failed"] is True
    assert res["missing_raw"] == ["2026-09-10", "2026-09-11"]
    assert "raw grouped-daily frame" in res["reason"]
    assert (store.stats("us") or {}).get("last") == "2026-09-08"   # nothing advanced
    st = recon.forward_seal_state("us")
    assert st["failed"] is True and st["at"]


def test_fewer_sessions_than_planned_is_reported_as_PARTIAL(monkeypatch):
    """⚠️ The planner used the NYSE calendar; the frame used what the provider
    actually published. A difference means one of them is wrong."""
    seed("us", "2026-09-08")
    monkeypatch.setattr(recon, "sweep_history",
                        lambda *a, **k: {"ok": True, "sessions": 1})
    res = recon.forward_seal_tick("us", through="2026-09-11")
    assert res["partial"] is True and res["expected"] == 3 and res["sealed"] == 1
    assert "disagree" in res["reason"]


def test_a_second_tick_finds_nothing_pending(monkeypatch):
    """⭐ IDEMPOTENT BY CONSTRUCTION: the plan is read from the store's own `last`."""
    seed("us", "2026-09-08")

    def _fake(frm, to, universe=None, **kw):
        for d in recon.sessions_between(
                (__import__("datetime").date.fromisoformat(frm)
                 - __import__("datetime").timedelta(days=1)).isoformat(), to):
            seed(universe, d)
        return {"ok": True, "sessions": 3}
    monkeypatch.setattr(recon, "sweep_history", _fake)

    first = recon.forward_seal_tick("us", through="2026-09-11")
    assert first["sealed"] == 3
    second = recon.forward_seal_tick("us", through="2026-09-11")
    assert second["blocked"] is True and second["current"] is True
    assert store.stats("us")["last"] == "2026-09-11"


def test_restart_mid_gap_converges_to_the_same_rows(monkeypatch):
    """⭐ RESUME EQUIVALENCE: a tick that sealed one day then died leaves the next
    tick to seal the rest, and the result equals an uninterrupted run."""
    def _seal_each(frm, to, universe=None, **kw):
        ds = recon.sessions_between(
            (__import__("datetime").date.fromisoformat(frm)
             - __import__("datetime").timedelta(days=1)).isoformat(), to)
        for d in ds:
            seed(universe, d, value=len(d))
        return {"ok": True, "sessions": len(ds)}

    seed("us", "2026-09-08")
    monkeypatch.setattr(recon, "sweep_history",
                        lambda f, t, universe=None, **k: _seal_each(f, "2026-09-09",
                                                                   universe))
    recon.forward_seal_tick("us", through="2026-09-11")       # "dies" after one day
    assert store.stats("us")["last"] == "2026-09-09"
    monkeypatch.setattr(recon, "sweep_history", _seal_each)
    recon.forward_seal_tick("us", through="2026-09-11")       # resumes
    got = store.dates_since("us", "2026-09-08")
    assert got == ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]


# ── the pass over every published universe ───────────────────────────────────

def test_forward_seal_all_is_INERT_while_the_library_is_dark(monkeypatch):
    called = []
    monkeypatch.setattr(recon, "forward_seal_tick",
                        lambda *a, **k: called.append(a) or {})
    assert recon.forward_seal_all() == {}
    assert called == []


def test_forward_seal_all_touches_only_PUBLISHED_pit_universes(monkeypatch):
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "us")
    seen = []
    monkeypatch.setattr(recon, "forward_seal_tick",
                        lambda uni, **k: seen.append(uni) or {"ok": True})
    recon.forward_seal_all()
    assert seen == ["us"]          # never uct (not PIT), never dark nasdaq/nyse


def test_one_universe_failing_does_not_stop_the_others(monkeypatch):
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "*")

    def _tick(uni, **k):
        if uni == "nasdaq":
            raise RuntimeError("the frame is on fire")
        return {"ok": True, "universe": uni, "sealed": 1}
    monkeypatch.setattr(recon, "forward_seal_tick", _tick)
    out = recon.forward_seal_all()
    assert set(out) == {"us", "nasdaq", "nyse"}
    assert out["us"]["sealed"] == 1 and out["nyse"]["sealed"] == 1
    assert out["nasdaq"]["ok"] is False and "on fire" in out["nasdaq"]["reason"]
    assert recon.forward_seal_state("nasdaq")["sealed"] == 0


# ── it really is the canonical pipeline ──────────────────────────────────────

def test_the_seal_calls_sweep_history_and_owns_no_metric_code():
    """⛔ No second daily engine. The only thing that computes a value here is
    `sweep_history`, which is what the historical backfill calls too."""
    import inspect
    src = inspect.getsource(recon.forward_seal_tick)
    assert "sweep_history(" in src
    # ⚠️ CODE, NOT PROSE. The docstring legitimately NAMES `build_frame` to explain
    # whose refusal is being carried through; stripping the docstring is what makes
    # this rail test the implementation rather than the comment.
    body = src.replace(inspect.getdoc(recon.forward_seal_tick) or "", "")
    for forbidden in ("compute_metrics", "build_levels", "eligible_on",
                      "write_bulk", "build_frame("):
        assert forbidden not in body, forbidden
