"""The provider adapters and the spine they share (step 2.4b P2.1, 03 §3.8).

What must be true of every adapter, whatever it wraps:
  * it RETURNS a named failure, never raises and never a bare None;
  * its call is bounded by `min(dependency timeout, the JOB's remaining time)` — never the
    dependency's constant alone;
  * an open breaker means the upstream is not touched at all;
  * a retry is jittered and counts as ONE failure against the breaker;
  * a payload comes back with a vintage the caller can read, or with `stale=None` — never with a
    cheerful `False` nobody measured.
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import time

import pytest

from api.services.discord_render import breakers, freshness as fr
from api.services.discord_render.adapters import _call, bars, entity, flow, quote, renderer
from api.services.discord_render.adapters import result as R


@pytest.fixture(autouse=True)
def _clean():
    _call.reset_for_tests()
    yield
    _call.reset_for_tests()


# ── the budget: a dependency timeout is not a deadline ──────────────────────

def test_the_effective_timeout_is_the_smaller_of_the_two():
    assert _call.budget(8.0, 12.0) == 8.0, "plenty of job budget: the dependency's own limit stands"
    assert _call.budget(60.0, 11.5) == 11.5, "the JOB is the ceiling — the live renderer case"
    assert _call.budget(8.0, None) == 8.0, "no deadline (a warm, a probe) leaves the dependency's"
    assert _call.budget(8.0, -3.0) == 0.0, "an overrun deadline is zero, never negative"


def test_a_call_with_no_useful_time_left_is_refused_without_touching_the_upstream():
    """⛔ The member is better served by the honest class now than by a call that cannot connect."""
    touched = []
    r = _call.guarded("bars", lambda t: touched.append(t), dep_timeout_s=8.0, remaining_s=0.1)
    assert _call.is_result(r) and r.reason() == R.DEADLINE
    assert touched == [], "the upstream was called with no time to answer"
    assert r.meta["budget_s"] == 0.1


def test_the_function_is_handed_the_effective_timeout_not_the_constant():
    """⛔ An adapter that ignores this argument and passes its own constant to the client has
    re-created the 60-seconds-behind-a-15-second-deadline defect."""
    seen = []
    out = _call.guarded("bars", lambda t: seen.append(t) or "data", dep_timeout_s=8.0, remaining_s=2.5)
    assert not _call.is_result(out) and out[0] == "data"
    assert seen == [2.5]


# ── the breaker ─────────────────────────────────────────────────────────────

def test_an_open_breaker_refuses_without_calling_the_dependency():
    b = breakers.breaker("renderer")
    for _ in range(20):
        if b.allow():
            b.record_failure()
    assert b.state == breakers.OPEN
    touched = []
    r = _call.guarded("renderer", lambda t: touched.append(1), dep_timeout_s=20.0, remaining_s=14.0)
    assert _call.is_result(r) and r.reason() == R.BREAKER_OPEN
    assert touched == [], "an open breaker must not reach the dependency"
    assert r.meta["breaker"]["state"] in (breakers.OPEN, breakers.HALF_OPEN)


def test_a_timeout_is_named_and_counted_against_the_breaker():
    def slow(_timeout_s):
        time.sleep(0.6)
        return "late"
    r = _call.guarded("quote", slow, dep_timeout_s=0.3, remaining_s=5.0)
    assert _call.is_result(r) and r.reason() == R.TIMEOUT
    assert breakers.breaker("quote").snapshot()["consecutive_failures"] == 1


def test_an_abandoned_call_is_reported_separately_from_a_failure():
    """⛔ A Python thread cannot be cancelled: a timeout means WE stopped waiting. A rising abandoned
    count means threads are being consumed by something that is not answering, which no
    success/failure ratio can show."""
    started = cf.Future()

    def wedged(_timeout_s):
        if not started.done():
            started.set_result(True)
        time.sleep(0.8)
    assert _call.abandoned_calls() == {}
    # ⚠️ 0.3, not 0.2: below MIN_USEFUL_S the call is refused as DEADLINE and never reaches the pool,
    # so a shorter budget here would test the floor and silently never exercise abandonment at all.
    assert 0.3 >= _call.MIN_USEFUL_S
    _call.guarded("flow", wedged, dep_timeout_s=0.3, remaining_s=5.0)
    assert started.done(), "the control: the call really did start before we stopped waiting"
    assert _call.abandoned_calls().get("flow") == 1


def test_an_upstream_error_is_named_rather_than_swallowed():
    def boom(_timeout_s):
        raise ConnectionResetError("peer")
    r = _call.guarded("bars", boom, dep_timeout_s=8.0, remaining_s=5.0)
    assert _call.is_result(r) and r.reason() == R.UPSTREAM_ERROR
    assert r.meta["error"] == "ConnectionResetError"


def test_a_retried_call_is_one_failure_against_the_breaker_not_three():
    """⛔ Otherwise a single slow moment trips a breaker sized for a real outage."""
    calls, slept = [], []
    def flaky(_timeout_s):
        calls.append(1)
        raise TimeoutError("provider")
    r = _call.guarded("bars", flaky, dep_timeout_s=8.0, remaining_s=5.0, attempts=3,
                      sleep=slept.append)
    assert _call.is_result(r) and len(calls) == 3 and len(slept) == 2
    assert breakers.breaker("bars").snapshot()["consecutive_failures"] == 1
    assert len(set(slept)) == 2 or slept[0] != slept[1], "the waits must be jittered, not fixed"


def test_each_dependency_gets_its_own_bounded_pool():
    """⛔ A wedged upstream may consume ITS pool and nothing else. Sharing one pool is C-02, where
    member jobs and the dashboard drained the same 64 threads."""
    p1, p2 = _call.pool("renderer"), _call.pool("flow")
    assert p1 is not p2 and _call.pool("renderer") is p1
    assert p1._max_workers == _call.POOL_SIZE["renderer"]
    assert _call.pool("something-new")._max_workers == _call.DEFAULT_POOL_SIZE


# ── the bars adapter ────────────────────────────────────────────────────────

NOW = dt.datetime(2026, 9, 13, 11, 0, tzinfo=fr.ET)          # Saturday, market shut
FRIDAY = "2026-09-11"


def _bars(n=3, last=FRIDAY):
    return [{"t": FRIDAY, "o": 1, "h": 2, "l": 0, "c": 1, "v": 10} for _ in range(n - 1)] + \
           [{"t": last, "o": 1, "h": 2, "l": 0, "c": 1, "v": 10}]


def test_bars_come_back_with_a_vintage_derived_from_the_newest_bar():
    """⛔ The payload carries no as_of, so it is derived HERE, once — not by every caller."""
    r = bars.fetch(bars.BarsRequest("NVDA", "D", 200, corr_id="abcd1234", remaining_s=12.0),
                   fetch_fn=lambda t, tf, n: _bars())
    assert r.ok and len(r.data) == 3
    assert r.as_of is not None and r.as_of.startswith("2026-09-11")
    assert r.session in fr.CLOSED_STATES or r.session == fr.WEEKEND
    assert r.corr_id == "abcd1234" and r.elapsed_ms is not None
    assert r.meta["bar_count"] == 3


def test_a_stale_vintage_labels_itself_without_anybody_asking():
    old = bars.fetch(bars.BarsRequest("NVDA", "D", 200), fetch_fn=lambda t, tf, n: _bars(last="2026-08-01"))
    assert old.ok is True, "stale data is still DELIVERED — labelled, not withheld (S8)"
    assert old.stale is True and R.STALE in old.degraded_reasons and old.badge


def test_an_empty_answer_is_EMPTY_and_not_an_error():
    """`/api/bars` answers 200 with [] for a symbol it does not carry. The member needs 'we have no
    data for that', not 'it broke' — they are different sentences and different actions."""
    for payload in ([], None):
        r = bars.fetch(bars.BarsRequest("ZZZZ"), fetch_fn=lambda t, tf, n: payload)
        assert r.ok is False and r.reason() == R.EMPTY
        assert r.reason() != R.UPSTREAM_ERROR


def test_a_payload_we_cannot_read_is_BAD_SHAPE_rather_than_a_traceback():
    for payload in ("not bars", [1, 2, 3], [{"close": 1}]):
        r = bars.fetch(bars.BarsRequest("NVDA"), fetch_fn=lambda t, tf, n: payload)
        assert r.ok is False and r.reason() == R.BAD_SHAPE


@pytest.mark.parametrize("exc", [RuntimeError("x"), ValueError("y"), OSError("z"), MemoryError()])
def test_the_bars_adapter_returns_a_named_failure_for_any_ordinary_exception(exc):
    def blow_up(t, tf, n):
        raise exc
    r = bars.fetch(bars.BarsRequest("NVDA", remaining_s=3.0), fetch_fn=blow_up)
    assert isinstance(r, R.Result) and r.ok is False and r.reason() in R.ALL_REASONS


@pytest.mark.parametrize("exc", [KeyboardInterrupt, SystemExit])
def test_a_BASE_exception_still_propagates_and_that_is_deliberate(exc):
    """⛔ THE ONE THING AN ADAPTER MUST NOT CONTAIN. `Exception`, never `BaseException`: swallowing
    KeyboardInterrupt or SystemExit makes a worker thread unkillable and a shutdown a hang, on a pod
    that restarts every eight minutes (C-01).

    ⚰️ Written after the first version of this file asserted the opposite. It threw a
    KeyboardInterrupt at the adapter, the adapter correctly let it through, and pytest treated it as
    an interrupt and STOPPED — reporting `13 passed` for a 40-test file. Twenty-seven tests were
    skipped and the summary line looked like a pass (`a run with no totals line is not a run`, and
    this is its sibling: a totals line that counts a fraction of the file)."""
    def blow_up(t, tf, n):
        raise exc()
    with pytest.raises(exc):
        bars.fetch(bars.BarsRequest("NVDA", remaining_s=3.0), fetch_fn=blow_up)


def test_the_bars_adapter_is_bounded_by_the_job_and_not_by_its_own_constant():
    """The live defect this closes, in one assertion: 8 s of dependency budget behind 1 s of job."""
    seen = []
    orig = _call.guarded
    try:
        def spy(name, fn, **kw):
            seen.append((kw["dep_timeout_s"], kw["remaining_s"]))
            return orig(name, fn, **kw)
        _call.guarded = spy
        bars.fetch(bars.BarsRequest("NVDA", remaining_s=1.0), fetch_fn=lambda t, tf, n: _bars())
    finally:
        _call.guarded = orig
    assert seen == [(bars.TIMEOUT_S, 1.0)]
    assert _call.budget(*seen[0]) == 1.0, "the job's remaining time is the ceiling"


def test_the_bars_adapter_retries_a_transient_failure_once():
    """⛔ FOUND BY A MUTATION THAT STAYED GREEN. `bars.ATTEMPTS` could be dropped from 2 to 1 — every
    transient bars failure becoming final — and the whole suite passed, because the only retry test
    passed `attempts=3` to the spine by hand and never touched the adapter's own constant. A
    constant nothing reads is a setting, not a behaviour (`lesson_a_measured_knob_is_inert...`)."""
    calls = []
    def flaky(t, tf, n):
        calls.append(1)
        if len(calls) == 1:
            raise ConnectionError("transient")
        return _bars()
    r = bars.fetch(bars.BarsRequest("NVDA", remaining_s=12.0), fetch_fn=flaky)
    assert r.ok and len(calls) == 2, f"{len(calls)} attempt(s); ATTEMPTS={bars.ATTEMPTS}"
    assert breakers.breaker("bars").snapshot()["consecutive_failures"] == 0


def test_a_bars_failure_that_survives_every_attempt_is_one_breaker_failure():
    calls = []
    def down(t, tf, n):
        calls.append(1)
        raise ConnectionError("down")
    r = bars.fetch(bars.BarsRequest("NVDA", remaining_s=12.0), fetch_fn=down)
    assert r.ok is False and len(calls) == bars.ATTEMPTS
    assert breakers.breaker("bars").snapshot()["consecutive_failures"] == 1, (
        "a retried call is ONE failure against the breaker, or a single slow moment trips it")


# ── the quote adapter ───────────────────────────────────────────────────────

def test_a_quote_comes_back_as_a_session_and_a_price_with_no_invented_vintage():
    """⛔ The upstream returns no timestamp, so `stale` stays None. A chip stamped with the wall
    clock because we asked for it just now is a lie with a number on it."""
    r = quote.fetch(quote.QuoteRequest("NVDA", remaining_s=2.0), quote_fn=lambda t: ("post", 178.42))
    assert r.ok and r.data == ("post", 178.42)
    assert r.stale is None and r.as_of is None
    assert r.provider == "massive"


def test_a_missing_quote_is_EMPTY_and_says_why_it_cannot_tell_the_two_apart():
    r = quote.fetch(quote.QuoteRequest("NVDA"), quote_fn=lambda t: None)
    assert r.ok is False and r.reason() == R.EMPTY
    assert "OI-22" in r.meta["note"], "the known limitation is recorded on the result, not hidden"


@pytest.mark.parametrize("payload", ["178.42", ("post",), ("post", "not a number")])
def test_a_quote_of_the_wrong_shape_is_BAD_SHAPE(payload):
    assert quote.fetch(quote.QuoteRequest("NVDA"), quote_fn=lambda t: payload).reason() == R.BAD_SHAPE


def test_the_quote_adapter_is_bounded_where_it_had_no_timeout_at_all():
    assert quote.TIMEOUT_S == 1.5, "the number in 03 §3.8"
    assert _call.budget(quote.TIMEOUT_S, 0.8) == 0.8


# ── the renderer adapter ────────────────────────────────────────────────────

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def test_the_renderer_ceiling_is_the_spec_not_the_modules_sixty_seconds():
    """⛔ THE DEFECT THIS ADAPTER EXISTS FOR: 60 s over two attempts behind a 15 s deadline."""
    assert renderer.TIMEOUT_S == 20.0
    from api.services import discord_chart_house as house
    assert house.RENDER_TIMEOUT_S > renderer.TIMEOUT_S, (
        "if the house module's own timeout ever drops below the spec's, this adapter is no longer "
        "the thing bounding the call and the docstring above is stale")
    assert _call.budget(renderer.TIMEOUT_S, 11.5) == 11.5, "the JOB is the ceiling"


def test_a_render_carries_the_DATA_vintage_through_rather_than_claiming_to_be_new():
    env = fr.envelope("2026-08-01", tf="D", provider="bars_store", now=NOW)
    assert env.stale is True, "the fixture: a month-old chart"
    r = renderer.fetch(renderer.RenderRequest("NVDA", "D", envelope=env, remaining_s=12.0),
                       house_fn=lambda *a: PNG)
    assert r.ok and r.data == PNG
    assert r.stale is True and r.as_of.startswith("2026-08-01"), (
        "the picture is exactly as old as the data drawn in it (§3.10)")


def test_a_render_with_no_known_vintage_reports_unknown_not_fresh():
    r = renderer.fetch(renderer.RenderRequest("NVDA"), house_fn=lambda *a: PNG)
    assert r.ok and r.stale is None


def test_a_none_from_the_house_path_is_EMPTY_and_names_what_it_could_not_recover():
    r = renderer.fetch(renderer.RenderRequest("NVDA"), house_fn=lambda *a: None)
    assert r.ok is False and r.reason() == R.EMPTY and "5xx" in r.meta["note"]


@pytest.mark.parametrize("payload", [b"<html>504</html>", "not bytes", b""])
def test_a_body_that_is_not_a_png_is_BAD_SHAPE(payload):
    assert renderer.fetch(renderer.RenderRequest("NVDA"), house_fn=lambda *a: payload).reason() == R.BAD_SHAPE


def test_the_renderer_breaker_finally_has_a_caller():
    """⛔ Measured 2026-09-13: `breakers.DEFAULTS['renderer']` was tuned and had ZERO production
    callers — built, tested, green and unwired (`lesson_built_tested_green_and_unreachable`)."""
    def down(*a):
        raise RuntimeError("renderer down")
    for _ in range(breakers.DEFAULTS["renderer"].fail_threshold):
        renderer.fetch(renderer.RenderRequest("NVDA", remaining_s=5.0), house_fn=down)
    assert breakers.breaker("renderer").state == breakers.OPEN
    touched = []
    r = renderer.fetch(renderer.RenderRequest("NVDA", remaining_s=5.0),
                       house_fn=lambda *a: touched.append(1))
    assert r.reason() == R.BREAKER_OPEN and touched == [], "the next member did not wait for it again"


# ── the flow adapter ────────────────────────────────────────────────────────

def _flow_payload(end="2026-09-11", contracts=1, ok_=True):
    return {"ok": ok_, "symbol": "NVDA", "source": "stocks",
            "window": {"start": "2026-09-11", "end": end, "active_days": 1, "days_requested": "1"},
            "query_date": "9/13/2026", "contracts": [{"strike": 100}] * contracts}


def _raises(exc):
    def _f(*a, **k):
        raise exc
    return _f


def test_flow_is_stamped_with_the_window_end_not_the_query_date():
    """⛔ `query_date` is the WALL CLOCK of the request. A card built from Friday's tape at Sunday
    noon would stamp itself Sunday and read as live — the whole of §3.10 in one key."""
    r = flow.fetch(flow.FlowRequest("NVDA", remaining_s=12.0),
                   remote=lambda *a: _flow_payload(), local=_raises(AssertionError("not reached")))
    assert r.ok and r.as_of.startswith("2026-09-11"), "the newest date a contract printed on"
    assert "2026-09-13" not in (r.as_of or ""), "query_date must never become the vintage"
    assert r.provider == "flow_worker"


def test_the_four_flow_causes_do_not_collapse_into_one_sentence():
    """⛔ C-08. "The flow feed is reconnecting" was the reply to a timeout, a transport error, a 5xx
    AND an `ok:false` body — four causes, wrong for three of them, for two weeks.

    ⭐ They map to THREE classes and one non-failure, and that is the correct shape rather than a
    tidy four: a 5xx and an `ok:false` are both "it answered with an error", which is one sentence
    and one next action. What must never merge is `unreachable` with either of them — see below."""
    import httpx
    from api.services.discord_render.adapters import classes
    cases = {
        "timeout": (_raises(httpx.TimeoutException("slow")), R.TIMEOUT, "flow_timeout"),
        "unreachable": (_raises(httpx.ConnectError("no route")), R.UNREACHABLE, "flow_unavailable"),
        "http 5xx": (_raises(httpx.HTTPStatusError("500", request=None, response=None)),
                     R.UPSTREAM_ERROR, "flow_error"),
        "ok:false": (lambda *a: _flow_payload(ok_=False), R.UPSTREAM_ERROR, "flow_error"),
    }
    seen = {}
    for label, (remote, reason, member_class) in cases.items():
        breakers.reset_all_for_tests()
        r = flow.fetch(flow.FlowRequest("NVDA", remaining_s=12.0), remote=remote,
                       local=_raises(RuntimeError("web too")))
        assert r.reason() == reason, f"{label}: {r.reason()}"
        assert classes.for_result("flow", r) == member_class, label
        seen[label] = member_class
    assert len(set(seen.values())) == 3, seen
    assert seen["unreachable"] != seen["ok:false"], (
        "⛔ 'we could not reach it' and 'it answered with an error' must never share a class — it is "
        "a different sentence, a different next action, and it decides whether the fallback runs")


def test_an_empty_tape_is_a_successful_answer_and_not_a_failure():
    """⛔ A quiet session with no significant options flow is TRUE, and the router has the sentence
    for it. Classing it as a failure would put a correct answer in the failure counters and lose the
    window phrase the sentence needs — the C-08 mistake pointed the other way."""
    r = flow.fetch(flow.FlowRequest("NVDA", remaining_s=12.0),
                   remote=lambda *a: _flow_payload(contracts=0), local=_raises(AssertionError("no")))
    assert r.ok is True and r.reason() is None
    assert r.meta["contract_count"] == 0, "how the caller tells, without a failure class"
    assert r.data["window"]["end"] == "2026-09-11", "the window the router's sentence needs"


def test_a_payload_we_cannot_read_is_still_a_failure():
    r = flow.fetch(flow.FlowRequest("NVDA", remaining_s=12.0),
                   remote=lambda *a: "not a dict", local=_raises(AssertionError("no")))
    assert r.reason() == R.BAD_SHAPE


def test_a_transport_failure_falls_back_in_process_and_says_that_it_did():
    import httpx
    r = flow.fetch(flow.FlowRequest("NVDA", remaining_s=12.0),
                   remote=_raises(httpx.ConnectError("no route")), local=lambda *a: _flow_payload())
    assert r.ok and r.provider == "in_process"
    assert R.UNREACHABLE in r.degraded_reasons, "a served fallback is a DEGRADED delivery"
    assert r.degraded is True


def test_a_timeout_does_not_start_the_slower_leg():
    """⛔ The budget is already gone, and the in-process leg is the slower of the two."""
    import httpx
    touched = []
    r = flow.fetch(flow.FlowRequest("NVDA", remaining_s=12.0),
                   remote=_raises(httpx.TimeoutException("slow")), local=lambda *a: touched.append(1))
    assert r.reason() == R.TIMEOUT and touched == []


def test_an_answered_refusal_does_not_ask_a_second_source_for_a_different_answer():
    """An `ok:false` body is the upstream ANSWERING. Asking web's in-process copy for a different
    answer to the same question is how two callers end up with two truths.

    ⚠️ This case never reaches the fallback branch at all — the HTTP call SUCCEEDED, so the body is
    classified after the fact. The fallback guard is exercised by the 5xx case below, and it took a
    mutation staying green to notice the two are different code paths."""
    touched = []
    r = flow.fetch(flow.FlowRequest("NVDA", remaining_s=12.0),
                   remote=lambda *a: _flow_payload(ok_=False), local=lambda *a: touched.append(1))
    assert r.reason() == R.UPSTREAM_ERROR and touched == []


def test_a_5xx_does_not_restart_the_slower_leg_either():
    """⛔ FOUND BY A MUTATION THAT STAYED GREEN. Widening the fallback guard to accept
    `upstream_error` changed nothing under test, because the only `upstream_error` case in the file
    was an `ok:false` BODY — which the HTTP layer delivers successfully and which therefore never
    reaches the guard. A 5xx is the case that does: flow-worker ANSWERED, with an error, and web's
    in-process copy computes from the same tape and would very likely answer the same. Spending the
    rest of a member's budget to be told that twice is the cost with none of the benefit."""
    import httpx
    touched = []
    r = flow.fetch(flow.FlowRequest("NVDA", remaining_s=12.0),
                   remote=_raises(httpx.HTTPStatusError("500", request=None, response=None)),
                   local=lambda *a: touched.append(1))
    assert r.reason() == R.UPSTREAM_ERROR, "a 5xx is 'it answered with an error'"
    assert touched == [], "the in-process leg must not run for a service that answered"
    assert r.provider == "flow_worker"


def test_the_fallback_needs_enough_budget_left_to_finish():
    touched = []
    import httpx
    r = flow.fetch(flow.FlowRequest("NVDA", remaining_s=flow.LOCAL_MIN_S - 0.5),
                   remote=_raises(httpx.ConnectError("no route")), local=lambda *a: touched.append(1))
    assert r.ok is False and touched == [], "a computation abandoned halfway still costs web the thread"


def test_when_both_legs_fail_the_remote_class_is_the_one_reported():
    import httpx
    r = flow.fetch(flow.FlowRequest("NVDA", remaining_s=12.0),
                   remote=_raises(httpx.ConnectError("no route")), local=_raises(RuntimeError("web too")))
    assert r.reason() == R.UNREACHABLE and r.provider == "flow_worker", (
        "reporting the LOCAL failure would point the next person at web when flow-worker is down")


# ── the entity adapter ──────────────────────────────────────────────────────

def test_a_known_symbol_reports_which_authority_answered():
    from api.services.discord_render import symbols
    res = symbols.Resolution("NVDA", symbols.KNOWN, authority="universe")
    r = entity.fetch(entity.EntityRequest("NVDA", remaining_s=2.0), resolve_fn=lambda s, **k: res)
    assert r.ok and r.provider == "universe" and r.data.status == symbols.KNOWN


def test_an_unknown_symbol_is_NOT_CARRIED_and_carries_its_suggestions():
    from api.services.discord_render import symbols
    res = symbols.Resolution("NDVA", symbols.UNKNOWN, suggestions=("NVDA", "NVDL"))
    r = entity.fetch(entity.EntityRequest("NDVA"), resolve_fn=lambda s, **k: res)
    assert r.ok is False and r.reason() == R.NOT_CARRIED
    assert r.meta["suggestions"] == "NVDA,NVDL"


def test_an_unanswerable_verdict_fails_OPEN_and_stays_a_success():
    """⛔ Refusing a member's real ticker because our index was cold is worse than rendering it. An
    adapter that turned this into ok=False would invert the policy silently, on the one path where
    an over-refusal is invisible."""
    from api.services.discord_render import symbols
    res = symbols.Resolution("AEHL", symbols.UNANSWERABLE)
    r = entity.fetch(entity.EntityRequest("AEHL"), resolve_fn=lambda s, **k: res)
    assert r.ok is True and r.data.status == symbols.UNANSWERABLE


# ── the job budget ──────────────────────────────────────────────────────────

def test_the_remaining_budget_counts_down_from_the_ack():
    """⛔ FROM `created_at`, NOT FROM `started`. The difference is the queue wait, which the member
    has ALREADY spent — a deadline measured from the worker picking the job up would silently grant
    a queued job the whole budget twice over."""
    from api.services.discord_render.runtime import Job
    job = Job(corr_id="c", command="chart", app_id="a", token="t", args={}, label="x",
              created_at=1000.0, deadline_s=15.0)
    assert job.remaining_s(now=1000.0) == 15.0
    assert job.remaining_s(now=1004.0) == 11.0, "four seconds of queue wait are four seconds gone"
    assert job.remaining_s(now=1015.0) == 0.0
    assert job.remaining_s(now=1099.0) == 0.0, "past the deadline is zero, never negative"


def test_the_context_exposes_the_same_budget_as_its_job():
    from api.services.discord_render.runtime import Job, JobContext
    job = Job(corr_id="c", command="chart", app_id="a", token="t", args={}, label="x",
              created_at=2000.0, deadline_s=15.0)
    ctx = JobContext.__new__(JobContext)
    ctx.job = job
    assert ctx.remaining_s(now=2003.0) == job.remaining_s(now=2003.0) == 12.0


# ── the hot path is actually wired to the adapters ──────────────────────────

class _Ctx:
    """The slice of JobContext the bindings touch."""
    def __init__(self, remaining=12.0, corr="abcd1234"):
        from api.services.discord_render.runtime import Job
        self.job = Job(corr_id=corr, command="chart", app_id="a", token="t", args={}, label="x")
        self._remaining = remaining

    def remaining_s(self, now=None):
        return self._remaining

    def edit(self, *a, **k):
        return True

    def fail(self, cls, detail=""):
        return True


def test_a_binding_returns_the_shape_produce_chart_expects_and_keeps_the_reason():
    """⛔ The interface is unchanged on purpose — `None` still means 'did not work'. What is new is
    that the REASON survives instead of being discarded at three separate layers."""
    from api.services.discord_render.adapters import bindings
    import api.services.discord_render.adapters.bars as bars_mod
    real = bars_mod.fetch
    ctx, ctx2 = _Ctx(), _Ctx()
    try:
        bars_mod.fetch = lambda req, **k: R.ok(_bars(), provider="bars_store", corr_id=req.corr_id)
        assert bindings.bars_fn(ctx)("NVDA", "D", 200) == _bars(), (
            "a success comes back as the plain list `produce_chart` already expects")
        bars_mod.fetch = lambda req, **k: R.fail(R.TIMEOUT, provider="bars", corr_id=req.corr_id)
        assert bindings.bars_fn(ctx2)("NVDA", "D", 200) is None, "a failure is still a bare None"
    finally:
        bars_mod.fetch = real
    assert bindings.last_result(ctx, "bars").ok is True
    assert bindings.last_result(ctx2, "bars").reason() == R.TIMEOUT, (
        "the old path threw this away; keeping it is the whole point of the layer")


def test_a_failed_result_that_still_carries_data_is_not_handed_on_as_if_it_worked():
    """⛔ FOUND BY A MUTATION THAT STAYED GREEN. Dropping the `if r.ok` guard changed nothing under
    test, because `fail()` always nulls `data` — so the only case the guard defends was one no test
    could produce. `Result` is a public dataclass and `fail()` is a convenience: an adapter that
    returns a PARTIAL payload beside a failure (half a flow card, a truncated bar series) is exactly
    the shape this guard exists for, and handing that to `produce_chart` would render it as a
    complete answer. The guard is not dead code; the test was."""
    from api.services.discord_render.adapters import bindings
    import api.services.discord_render.adapters.bars as bars_mod
    partial = [{"t": FRIDAY, "o": 1, "h": 2, "l": 0, "c": 1, "v": 10}]
    real, ctx = bars_mod.fetch, _Ctx()
    try:
        bars_mod.fetch = lambda req, **k: R.Result(
            ok=False, data=partial, provider="bars_store", degraded_reasons=(R.BAD_SHAPE,))
        assert bindings.bars_fn(ctx)("NVDA", "D", 200) is None, (
            "a failed Result must not reach the renderer just because it happens to carry rows")
    finally:
        bars_mod.fetch = real
    assert bindings.last_result(ctx, "bars").data == partial, "and the partial is still on the record"


def test_a_binding_passes_the_jobs_remaining_time_down_to_the_adapter():
    from api.services.discord_render.adapters import bindings
    import api.services.discord_render.adapters.bars as bars_mod
    seen = []
    real = bars_mod.fetch
    try:
        bars_mod.fetch = lambda req, **k: seen.append(req) or R.ok([{"t": FRIDAY}], provider="x")
        bindings.bars_fn(_Ctx(remaining=4.25))("NVDA", "D", 200)
    finally:
        bars_mod.fetch = real
    assert seen[0].remaining_s == 4.25 and seen[0].corr_id == "abcd1234"


def test_a_context_that_cannot_say_how_long_is_left_reports_None_rather_than_plenty():
    """⛔ A default of 'plenty' here would silently restore the unbounded call this layer removes."""
    from api.services.discord_render.adapters import bindings

    class Mute(_Ctx):
        remaining_s = None
    assert bindings._remaining(Mute()) is None


def test_the_render_is_stamped_with_the_vintage_of_the_bars_it_drew():
    from api.services.discord_render.adapters import bindings
    ctx = _Ctx()
    bindings.record(ctx, "bars", R.ok([{"t": "2026-08-01"}], provider="bars_store",
                                      envelope=fr.envelope("2026-08-01", tf="D", now=NOW)))
    png = bindings.house_fn(ctx, inner=lambda *a: PNG)("NVDA", "D", {}, {})
    assert png == PNG
    stamped = bindings.last_result(ctx, "renderer")
    assert stamped.as_of.startswith("2026-08-01") and stamped.stale is True


def test_only_the_latest_result_per_upstream_is_kept():
    """⚠️ A multi-chart job calls bars once per timeframe; an unbounded list on a long-lived context
    is a slow leak on a pod that restarts every eight minutes."""
    from api.services.discord_render.adapters import bindings
    ctx = _Ctx()
    for i in range(50):
        bindings.record(ctx, "bars", R.ok([{"t": FRIDAY}], provider=f"p{i}"))
    assert bindings.last_result(ctx, "bars").provider == "p49"
    assert set(bindings.all_results(ctx)) == {"bars"}


@pytest.mark.parametrize("builder", ["_chart_kwargs", "_multi_kwargs"])
def test_the_v2_handlers_bind_adapters_and_not_the_raw_clients(builder):
    """⛔ BUILT, TESTED, GREEN AND UNWIRED is this programme's most expensive recurring shape — it is
    how `breakers.py` sat with zero production callers while its own suite passed. This asserts the
    binding is live, by calling it and looking for the Result it must leave behind."""
    from api.services.discord_render import commands
    ctx = _Ctx()
    kwargs = getattr(commands, builder)(ctx, "guild") if builder == "_chart_kwargs" else \
        getattr(commands, builder)(ctx)
    from api.services.discord_render.adapters import bindings
    assert kwargs["bars_fn"].__qualname__.startswith("bars_fn"), kwargs["bars_fn"]
    assert kwargs["bars_fn"].__module__ == bindings.__name__
    assert kwargs["quote_fn"].__module__ == bindings.__name__
    kwargs["bars_fn"]("NVDA", "D", 5)
    assert bindings.last_result(ctx, "bars") is not None, "the binding is not actually in the path"


def test_the_flow_binding_hands_the_router_the_dict_it_expects():
    from api.services.discord_render.adapters import bindings
    import api.services.discord_render.adapters.flow as flow_mod
    ctx, real = _Ctx(), flow_mod.fetch
    try:
        flow_mod.fetch = lambda req, **k: R.ok(_flow_payload(), provider="flow_worker",
                                               contract_count=1, corr_id=req.corr_id)
        got = bindings.flow_fetch_fn(ctx, source="etfs")("SPY", "1")
    finally:
        flow_mod.fetch = real
    assert got["symbol"] == "NVDA" and bindings.last_result(ctx, "flow").ok


def test_the_flow_binding_corrects_the_routers_generic_class_to_what_was_observed():
    """⛔ THE WHOLE POINT OF THE WRAPPER. `run_flow_card_job` keeps `fail_cls` in a local a `fetch_fn`
    cannot set, so a bare `fetch_fn` would make EVERY flow failure read `flow_error` — strictly worse
    than today. The wrapper lets the router's generic call be a trigger and supplies the truth."""
    from api.services.discord_render.adapters import bindings
    ctx = _Ctx()
    sent = []
    ctx.fail = lambda cls, detail="": sent.append((cls, detail)) or True
    bindings.record(ctx, "flow", R.fail(R.UNREACHABLE, provider="flow_worker"))
    bindings.flow_fail_fn(ctx)("flow_error", "")
    assert sent[0][0] == "flow_unavailable", "the member is told what actually happened"
    assert "unreachable" in sent[0][1], "and the detail names the observation, for the log"


def test_the_flow_binding_leaves_a_class_alone_when_it_already_agrees():
    from api.services.discord_render.adapters import bindings
    ctx, sent = _Ctx(), []
    ctx.fail = lambda cls, detail="": sent.append((cls, detail)) or True
    bindings.record(ctx, "flow", R.fail(R.TIMEOUT, provider="flow_worker"))
    bindings.flow_fail_fn(ctx)("flow_timeout", "no answer in 10s")
    assert sent == [("flow_timeout", "no answer in 10s")], "no rewriting when it is already right"


def test_the_flow_binding_passes_a_failure_it_did_not_observe_straight_through():
    """A render failure inside the router (`internal`, 'card render failed') has nothing to do with
    the fetch; the wrapper must not overwrite it with the fetch's class."""
    from api.services.discord_render.adapters import bindings
    ctx, sent = _Ctx(), []
    ctx.fail = lambda cls, detail="": sent.append((cls, detail)) or True
    bindings.record(ctx, "flow", R.ok(_flow_payload(), provider="flow_worker"))
    bindings.flow_fail_fn(ctx)("internal", "card render failed")
    assert sent == [("internal", "card render failed")]


@pytest.mark.parametrize("binding,raw", [
    ("bars_fn", "fetch_bars"), ("quote_fn", "fetch_ext_quote"), ("house_fn", "render_house_chart")])
def test_the_kill_switch_hands_back_the_raw_function(monkeypatch, binding, raw):
    """⛔ A SWITCH, NEVER A DELETE. Setting it to 0 must give back the pre-adapter behaviour with no
    deploy — which is only true if the binding returns the RAW function, not a wrapper that merely
    skips some of the work."""
    from api.services.discord_render.adapters import bindings, switch
    monkeypatch.setenv(switch.ENV, "0")
    fn = getattr(bindings, binding)(_Ctx())
    assert fn.__name__ == raw, f"{binding} returned {fn.__name__}, not the raw {raw}"
    monkeypatch.delenv(switch.ENV, raising=False)
    assert getattr(bindings, binding)(_Ctx()).__module__ == bindings.__name__


def test_the_kill_switch_also_takes_the_flow_handler_back_to_the_routers_own_fetch(monkeypatch):
    from api.services.discord_render import commands
    from api.services.discord_render.adapters import switch
    seen = {}
    monkeypatch.setattr("api.routers.discord_interactions.run_flow_card_job",
                        lambda *a, **k: seen.update(k))
    monkeypatch.setattr(commands.di, "parse_flow_command", lambda inter: ("NVDA", "1"))
    monkeypatch.setattr(commands.symbols, "flow_source", lambda s: "stocks")

    monkeypatch.setenv(switch.ENV, "0")
    commands._handle_flow(_Ctx())
    assert "fetch_fn" not in seen, "with the switch off the router does its own fetching"

    seen.clear()
    monkeypatch.delenv(switch.ENV, raising=False)
    commands._handle_flow(_Ctx())
    assert callable(seen.get("fetch_fn")) and callable(seen.get("fail_fn")), (
        "with the switch on the handler must hand over BOTH halves — a fetch_fn without the "
        "fail_fn wrapper makes every flow failure read `flow_error`")


# ── the stamp: what the member actually sees (P2.6/P2.7) ────────────────────

def _stale_ctx(**kw):
    from api.services.discord_render.adapters import bindings
    ctx = _Ctx(**kw)
    bindings.record(ctx, "bars", R.ok([{"t": "2026-08-01"}], provider="bars_store",
                                      envelope=fr.envelope("2026-08-01", tf="D", now=NOW)))
    return ctx


def test_a_healthy_delivery_carries_no_stamp_at_all():
    """⛔ RARE, OR IT IS FURNITURE. On a healthy path this is every delivery, and a badge that shows
    when nothing is wrong is not there on the day it matters."""
    from api.services.discord_render.adapters import bindings
    ctx = _Ctx()
    bindings.record(ctx, "bars", R.ok([{"t": FRIDAY}], provider="bars_store",
                                      envelope=fr.envelope(FRIDAY, tf="D", now=NOW)))
    bindings.record(ctx, "renderer", R.ok(PNG, provider="renderer"))
    assert bindings.stamp_suffix(ctx) == ""
    assert bindings.stamp(ctx, "**NVDA** · Daily") == "**NVDA** · Daily"


def test_a_stale_delivery_is_labelled_with_the_envelopes_own_sentence():
    """⛔ ONE OWNER FOR THE SENTENCE. The badge is `Envelope.badge`; a second copy here would be the
    second-authority defect on the one string a member actually reads."""
    from api.services.discord_render.adapters import bindings
    ctx = _stale_ctx()
    out = bindings.stamp(ctx, "**NVDA** · Daily")
    assert bindings.last_result(ctx, "bars").badge in out
    assert out.startswith("**NVDA** · Daily"), "the original content is not replaced"
    assert f"id {ctx.job.corr_id}" in out, "a degraded delivery always carries the id to quote"


def test_a_fallback_delivery_says_so_in_words_a_member_can_act_on():
    from api.services.discord_render.adapters import bindings
    ctx = _Ctx()
    bindings.record(ctx, "flow", R.ok({"ok": True}, provider="in_process").with_reason(R.UNREACHABLE))
    out = bindings.stamp(ctx, "**NVDA** flow")
    assert "backup source" in out and "degraded" not in out, (
        "'degraded' means nothing to a member; name what happened")


def test_the_stamp_is_idempotent_across_the_second_edit():
    """⛔ `produce_chart` edits the same message more than once — a stand-in, then the real chart.
    Appending on each pass gives the member the same warning twice, and a test that calls it once
    cannot see that."""
    from api.services.discord_render.adapters import bindings
    ctx = _stale_ctx()
    once = bindings.stamp(ctx, "**NVDA** · Daily")
    assert bindings.stamp(ctx, once) == once
    assert bindings.stamp(ctx, bindings.stamp(ctx, once)) == once


def test_when_it_does_not_fit_the_CONTENT_is_trimmed_and_the_STAMP_is_kept():
    """⛔ THE OTHER WAY ROUND IS THE S8 VIOLATION WITH EXTRA STEPS. A 2,000-character reply whose
    last clause fell off is exactly the unlabelled stand-in C-06 describes — and it would happen
    only on the longest replies, which are usually the most degraded."""
    from api.services.discord_render.adapters import bindings
    ctx = _stale_ctx()
    out = bindings.stamp(ctx, "x" * (bindings.CONTENT_MAX - 5))
    assert len(out) <= bindings.CONTENT_MAX
    assert bindings.stamp_suffix(ctx) in out, "the stamp survived; the content gave way"
    assert out.count("x") < bindings.CONTENT_MAX - 5


def test_the_edit_wrapper_stamps_every_path_the_render_function_can_take():
    """⛔ STAMPING IN THE WRAPPER, NOT AT FOUR CALL SITES. 'Remember to label it' is how C-06
    produced three unlabelled stand-ins."""
    from api.services.discord_render.adapters import bindings
    ctx, sent = _stale_ctx(), []
    ctx.edit = lambda app_id, token, **kw: sent.append(kw) or True
    wrapped = bindings.edit_fn(ctx)
    wrapped("a", "t", content="first")                      # the stand-in
    wrapped("a", "t", content="second", png=b"\x89PNG")     # the real chart
    wrapped("a", "t", components=[])                        # a components-only edit: nothing to stamp
    assert all(bindings.stamp_suffix(ctx) in k["content"] for k in sent[:2])
    assert "content" not in sent[2], "an edit with no content must not grow one"


@pytest.mark.parametrize("builder", ["_chart_kwargs", "_multi_kwargs"])
def test_every_v2_handler_stamps_its_edits(builder):
    """⛔ THE WIRING RAIL FOR THE STAMP. `bindings.edit_fn` can be perfect and unused — which is
    exactly the state C-06 describes, where the label existed and three stand-ins went out without
    it. This asserts the handler hands over the WRAPPER, by sending through it and looking for the
    suffix, not by comparing function identities."""
    from api.services.discord_render import commands
    from api.services.discord_render.adapters import bindings
    ctx = _stale_ctx()
    sent = []
    ctx.edit = lambda app_id, token, **kw: sent.append(kw) or True
    kwargs = commands._chart_kwargs(ctx, "g") if builder == "_chart_kwargs" else commands._multi_kwargs(ctx)
    kwargs["edit_fn"]("a", "t", content="**NVDA** · Daily")
    assert sent and bindings.stamp_suffix(ctx) in sent[0]["content"], (
        f"{builder} passed an edit that does not stamp — a degraded delivery would go out unlabelled")


def test_the_flow_handler_stamps_its_edits_too(monkeypatch):
    from api.services.discord_render import commands
    from api.services.discord_render.adapters import bindings
    seen = {}
    monkeypatch.setattr("api.routers.discord_interactions.run_flow_card_job",
                        lambda *a, **k: seen.update(k))
    monkeypatch.setattr(commands.di, "parse_flow_command", lambda inter: ("NVDA", "1"))
    monkeypatch.setattr(commands.symbols, "flow_source", lambda s: "stocks")
    ctx = _stale_ctx()
    sent = []
    ctx.edit = lambda app_id, token, **kw: sent.append(kw) or True
    commands._handle_flow(ctx)
    seen["edit_fn"]("a", "t", content="**NVDA** flow")
    assert bindings.stamp_suffix(ctx) in sent[0]["content"]


def test_the_kill_switch_takes_the_edit_back_to_the_raw_one(monkeypatch):
    from api.services.discord_render.adapters import bindings, switch
    ctx = _stale_ctx()
    monkeypatch.setenv(switch.ENV, "0")
    # ⚠️ `==`, not `is`: attribute access on a bound method builds a NEW method object every time,
    # so `ctx.edit is ctx.edit` is already False and an identity check here would fail on a correct
    # implementation. Equality compares __self__ and __func__, which is the property meant.
    assert bindings.edit_fn(ctx) == ctx.edit
    monkeypatch.delenv(switch.ENV, raising=False)
    assert bindings.edit_fn(ctx) != ctx.edit, "with the switch on it must be the stamping wrapper"


def test_commands_no_longer_names_a_raw_upstream_function():
    """⛔ AN AST, NEVER A GREP — this file's own docstrings name those functions on purpose."""
    import ast
    import pathlib
    banned = {"fetch_bars", "fetch_ext_quote", "render_house_chart"}

    def _raw_upstreams(source: str) -> set[str]:
        tree = ast.parse(source)
        return ({n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute) and n.attr in banned}
                | {a.name.split(".")[-1] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
                   for a in n.names if a.name in banned})

    src = (pathlib.Path(__file__).parents[1] / "api" / "services" / "discord_render" /
           "commands.py").read_text(encoding="utf-8")
    hits = sorted(_raw_upstreams(src))
    assert not hits, (
        f"commands.py still reaches a raw upstream: {hits}. Handlers call adapters (P2.1); the raw "
        "functions stay bound only on the pre-V2 path in discord_interactions.py.")

    # ⛔ THE CONTROL, AND IT MUST BE A PLANT. The first version asserted the literal still appeared
    # somewhere in commands.py — it no longer does anywhere, not even in prose, which is exactly the
    # outcome we want and would have made the control fail forever. An absence is only evidence if
    # the instrument could have seen a presence, so the instrument is shown a presence.
    assert _raw_upstreams("from api.routers.discord_interactions import fetch_bars\n"
                          "x = router.fetch_ext_quote\n") == {"fetch_bars", "fetch_ext_quote"}
    assert _raw_upstreams('"""A docstring naming fetch_bars and render_house_chart."""\n'
                          "# render_house_chart in a comment\n") == set(), "prose is not a call"


def test_a_timed_out_symbol_check_also_fails_open():
    from api.services.discord_render import symbols
    def slow(s, **k):
        time.sleep(0.9)
        return symbols.Resolution(s, symbols.UNKNOWN)
    r = entity.fetch(entity.EntityRequest("nvda", remaining_s=5.0), resolve_fn=slow)
    assert r.ok is True, "a timed-out check must never refuse the member"
    assert r.data.status == symbols.UNANSWERABLE and r.data.symbol == "NVDA"
    assert r.meta["why"] == R.TIMEOUT, "why it could not tell is recorded, not lost"
