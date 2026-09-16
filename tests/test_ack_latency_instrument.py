"""OI-42 — the ack budget, split into the half we owned and the half we did not.

⚰️ THE OBSERVATION THIS EXISTS FOR. 2026-09-15, `#render-smoke`, ONE admin user, NO
synthetic load: `/flow ticker:SPY` returned **"The application did not respond."** Its
handler is already defer-first and does no I/O before the ack —
`background.add_task(run_flow_card_job, ...)` then `return {"type": 5}` — so NOTHING IN
THE HANDLER COULD EXPLAIN IT. Three minutes earlier a `/chart NVDA` had taken ~40 s to
render on a pod that had booted at 12:55.

⛔ The starvation was BEFORE handler entry, and that half was never measured. `received =
time.perf_counter()` at the top of `_dispatch_interaction` is the S1 start — it can only
ever say the handler was fast, which it always was.
"""
from __future__ import annotations

import types

import pytest

from api.routers import discord_interactions as r


def _req(ts, entry_wall, entry_perf, *, cmd="flow"):
    """A stand-in carrying exactly what the real handler stashes."""
    st = types.SimpleNamespace()
    st.drender_ack_t = (ts, entry_wall, entry_perf)
    st.drender_interaction = {"data": {"name": cmd}}
    return types.SimpleNamespace(state=st)


# ── the arithmetic, which is the whole instrument ────────────────────────────

def test_a_late_arrival_is_measured_as_a_gap_before_entry():
    """⛔ THE LOAD-BEARING ONE. Discord sent at T; we entered the handler 4 s later. The
    instrument must attribute those 4 s to the half BEFORE entry, which is the half the
    /flow miss lived in."""
    import time
    out = r._emit_ack_timing(_req(ts="1000", entry_wall=1004.0, entry_perf=time.perf_counter()))
    assert out is not None, "the emitter did not run"
    assert out["send_to_entry_ms"] == pytest.approx(4000.0, abs=1.0), (
        "the pre-entry gap was not measured from Discord's send timestamp — if this reads "
        "~0 the gap is being computed entry-to-entry, which can only ever say zero")
    assert out["entry_to_ack_ms"] < 1000.0, "the handler half should be small here"


def test_a_prompt_arrival_reads_about_zero():
    """⛔ NON-VACUITY, the other direction. A gap that is large for every input is not a
    measurement, it is a constant. Same code path, no delay, must read ~0."""
    import time
    out = r._emit_ack_timing(_req(ts="1000", entry_wall=1000.0, entry_perf=time.perf_counter()))
    assert out["send_to_entry_ms"] == pytest.approx(0.0, abs=1.0)


def test_skew_is_reported_not_clamped():
    """⛔ A NEGATIVE READING IS CLOCK SKEW AND MUST SURVIVE. Clamping it to zero renders an
    unsynchronised clock as a healthy pod, which is the failure this whole programme keeps
    paying for — an instrument that answers a question next to the one that matters."""
    import time
    out = r._emit_ack_timing(_req(ts="1000", entry_wall=999.2, entry_perf=time.perf_counter()))
    assert out["send_to_entry_ms"] < 0, "skew was clamped away"


def test_an_unparsable_timestamp_is_ABSENT_not_zero():
    """A header we could not read is not a latency of zero. Absent and zero are different
    facts, and only one of them is honest."""
    import time
    out = r._emit_ack_timing(_req(ts="not-a-number", entry_wall=1004.0, entry_perf=time.perf_counter()))
    assert "send_to_entry_ms" not in out
    assert "entry_to_ack_ms" in out, "the half we CAN measure must still be reported"


def test_the_emitter_never_raises_into_the_request():
    """Observability that can break the request it observes is worse than none."""
    broken = types.SimpleNamespace(state=types.SimpleNamespace())
    assert r._emit_ack_timing(broken) is None
    assert r._emit_ack_timing(types.SimpleNamespace()) is None


# ── the events actually reach the log stream ─────────────────────────────────

def test_both_hops_are_emitted_as_drender_events(monkeypatch):
    """⛔ NON-VACUITY FOR THE WIRING. The dict above could be correct while nothing is ever
    written anywhere a reader can find it. Both hops must go through `observe.event`, which
    is what `tools/railway_env_logs.py --filter drender` reads."""
    import time
    from api.services.discord_render import observe
    seen: list = []
    monkeypatch.setattr(observe, "event", lambda evt, **kw: seen.append((evt, kw.get("hop"), kw.get("ms"))))
    r._emit_ack_timing(_req(ts="1000", entry_wall=1004.0, entry_perf=time.perf_counter()))
    hops = [h for _e, h, _m in seen]
    assert "send_to_entry" in hops and "entry_to_ack" in hops, f"hops emitted: {hops}"
    assert all(e == "ack" for e, _h, _m in seen)


# ── the wiring fix: the loop reading must survive the early return ───────────

def test_the_health_route_reports_the_loop_reading_with_no_jobs_database():
    """⛔⛔ THE BUG THIS BRANCH FIXES, AS A RAIL. `loopwatch` is wired at boot and enabled
    by default, and its reading is carried by `observe.health_payload` — which the health
    route NEVER REACHES when there is no jobs database. That is every production pod today
    (V2 off, `note: no jobs database yet`). Measured live 2026-09-15: the payload came back
    with `loop` absent, so the one instrument that could have explained the /flow ack miss
    reported nothing. Built, wired, live, and unreachable."""
    import ast
    import pathlib
    src = pathlib.Path(r.__file__.replace(".pyc", ".py")).read_text(encoding="utf-8")
    start = src.index("def render_health(")
    end = src.index("\n@router.", start)
    branch = src[start:end]
    no_store = branch[branch.index("if store is None:"):]
    no_store_code = "\n".join(l for l in no_store.splitlines() if not l.strip().startswith("#"))
    assert '"loop"' in no_store_code, (
        "the no-jobs-database branch does not report the loop reading — the loop-stall "
        "instrument is unreadable in exactly the configuration production runs in")


def test_that_health_slice_is_really_the_no_store_branch():
    """⛔ NON-VACUITY for the source slice above: an empty slice contains no `loop` either,
    and would have failed for the wrong reason — but a slice that lost the branch would
    also pass a `not in` check, so assert the slice still holds its own real code."""
    import pathlib
    src = pathlib.Path(r.__file__.replace(".pyc", ".py")).read_text(encoding="utf-8")
    start = src.index("def render_health(")
    end = src.index("\n@router.", start)
    branch = src[start:end]
    assert "no jobs database yet" in branch
    assert "PUSH_SECRET" in branch, "the slice lost the route's real code"
