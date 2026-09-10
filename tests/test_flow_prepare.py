"""The first-paint preparer: build the view the page opens on BEFORE a member asks.

A cold parts build is ~3.5-7.4 s of intrinsic work and the client gives up at
3 s, so the first member after every version roll falls back to the raw tape and
pays ~3.7 MB for a page everyone else gets in ~200 ms. The preparer removes that
member from the equation by running the SAME build, from a background thread,
the moment the data version changes.

⛔ WHAT THESE TESTS ARE REALLY GUARDING. Two failure modes, both of which this
repo has shipped before in other subsystems:

  1. A preparer that is written, documented, and wired into no scheduler at all
     (the desk insights pass lived that way for weeks).
  2. A preparer that stops making progress but keeps reporting success, because
     a declined tick recorded the version as handled. Its own counters would say
     "prepared" while every member paid the cold build.

Both are pinned below, each with a control proving the probe can see the thing
it is looking for.
"""
import ast
import threading
import pathlib
import time

import pytest

from api import flow_router as fr
from api.services import flow_aggregate as fa

REPO = pathlib.Path(__file__).resolve().parents[1]


# ── The view has ONE authority ────────────────────────────────────────────────

def test_health_and_the_preparer_grade_the_same_view():
    """⛔ If these were named separately they would drift, and the preparer could
    report success for a view nobody opens while health honestly said cold --
    each looking correct on its own."""
    import inspect
    sig = inspect.signature(fa.health)
    assert sig.parameters["view"].default is fa.DEFAULT_VIEW
    # And it is the view the page actually opens on.
    assert fa.DEFAULT_VIEW == ("stocks", 1, "Last1")


# ── Progress is only recorded when a build actually happened ──────────────────

class _Recorder:
    """Stands in for flow_aggregate.get_cached_or_build_part."""

    def __init__(self, result):
        self.result = result
        self.calls = []

    def __call__(self, key, version, provider, date_filter, part, only=None):
        self.calls.append((key, version, date_filter, part, only))
        return self.result(version) if callable(self.result) else self.result


@pytest.fixture(autouse=True)
def _reset_state():
    fr._PREPARE_STATE.update({"prepared": 0, "declined": 0, "failed": 0,
                              "last_version": None, "last_ms": None,
                              "last_error": None})
    yield


def _patch(monkeypatch, *, version, builder):
    monkeypatch.setattr(fr, "_current_version", lambda: version)
    monkeypatch.setattr(fa, "get_cached_or_build_part", builder)
    monkeypatch.setattr(fr, "_get_cached_or_build",
                        lambda source, days: (version, __import__("gzip").compress(b"csv")))


def test_a_successful_build_records_the_version_as_prepared(monkeypatch):
    rec = _Recorder(lambda v: (v, b"gz"))
    _patch(monkeypatch, version=1001, builder=rec)

    out = fr._prepare_once(None)

    assert out == 1001
    assert fr._PREPARE_STATE["prepared"] == 1
    assert fr._PREPARE_STATE["last_version"] == 1001
    # CONTROL: it asked for the default view, not something of its own devising.
    assert rec.calls[0][0] == ("stocks", 1, "Last1")
    assert rec.calls[0][3] == "bootstrap"
    # ⛔ TWO PASSES, AND PASS 1 IS THE CRITICAL PATH. A full build pipes 23.8 MB
    # of parts back and took 23-34 s on every RTH roll while the version rolls
    # every 60 s. Pass 1 emits ONLY what first paint fetches so the page becomes
    # fast as early as possible; pass 2 warms the rest so nothing stops being
    # prepared. If pass 1 ever asked for everything again, the race returns.
    assert rec.calls[0][4] == fa.FIRST_PAINT_PARTS, (
        "the first pass is no longer scoped to the first-paint parts")
    assert len(rec.calls) == 2, "the remainder pass is gone"
    rest = rec.calls[1][4]
    assert rest and not (set(rest) & set(fa.FIRST_PAINT_PARTS)), (
        "the remainder pass overlaps the first-paint pass -- work done twice")


def test_a_DECLINED_tick_does_not_record_progress_and_so_retries(monkeypatch):
    """⛔ THE ONE THAT MATTERS. `get_cached_or_build_part` hands back a STALE
    entry when the build lock is held by a member, so bytes came back but they
    are the WRONG version. Recording that as done would retire the roll and this
    thread would go silently idle -- prepared:1, members cold, forever."""
    stale = _Recorder((999, b"old-gz"))          # older version than current
    _patch(monkeypatch, version=1001, builder=stale)

    out = fr._prepare_once(None)

    assert out is None, "a declined tick must not claim the version"
    assert fr._PREPARE_STATE["prepared"] == 0
    assert fr._PREPARE_STATE["declined"] == 1

    # And the retry actually happens: the very next tick tries again.
    fresh = _Recorder(lambda v: (v, b"gz"))
    _patch(monkeypatch, version=1001, builder=fresh)
    assert fr._prepare_once(out) == 1001
    assert len(fresh.calls) == 2   # first-paint pass + remainder pass


def test_a_build_returning_nothing_also_does_not_record_progress(monkeypatch):
    _patch(monkeypatch, version=1001, builder=_Recorder(None))
    assert fr._prepare_once(None) is None
    assert fr._PREPARE_STATE["prepared"] == 0


def test_a_raising_build_is_caught_and_does_not_record_progress(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("node died")
    _patch(monkeypatch, version=1001, builder=boom)

    assert fr._prepare_once(None) is None
    assert fr._PREPARE_STATE["failed"] == 1
    assert "node died" in (fr._PREPARE_STATE["last_error"] or "")


# ── It is version-triggered, which is what keeps it off a quiet tape ──────────

def test_an_unchanged_version_does_no_work_at_all(monkeypatch):
    """This is the whole market-hours gate. The version only moves when rows
    actually change, so a closed tape costs nothing and needs no clock (one
    version was observed holding for 5h07m on 2026-09-08)."""
    rec = _Recorder(lambda v: (v, b"gz"))
    _patch(monkeypatch, version=1001, builder=rec)

    assert fr._prepare_once(1001) == 1001
    assert rec.calls == [], "rebuilt a version that was already prepared"

    # CONTROL: the same recorder DOES build when the version moves, so the
    # assertion above is about the version check and not a dead builder.
    _patch(monkeypatch, version=1002, builder=rec)
    assert fr._prepare_once(1001) == 1002
    assert len(rec.calls) == 2   # first-paint pass + remainder pass


# ── It yields to members rather than competing with them ─────────────────────

def test_it_goes_through_the_members_own_single_flight_path():
    """⛔ Not a private builder. Using `get_cached_or_build_part` is what makes
    the preparer decline (non-blocking lock) whenever a real request is
    building, and is what guarantees the product is byte-identical to what a
    member would have received."""
    src = pathlib.Path(fr.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "_prepare_once")
    called = {ast.unparse(n.func) for n in ast.walk(fn) if isinstance(n, ast.Call)}
    assert "flow_aggregate.get_cached_or_build_part" in called, (
        "the preparer stopped using the member's single-flight path -- it can "
        "now compete with real requests and may not produce the same bytes")


# ── It is actually wired, and it is gated ────────────────────────────────────

def test_the_preparer_is_wired_into_the_flow_worker_startup():
    """⛔ A background job that is written, documented and started by nothing
    reads as coverage. That is not hypothetical here: the desk insights pass
    was defined with zero callers for weeks."""
    src = (REPO / "api" / "flow_worker_main.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    calls = {ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
    assert any(c.endswith("start_background_prepare") for c in calls), (
        "nothing starts the preparer")
    # CONTROL: the probe can see a sibling starter, so a green result here is
    # not "ast.walk found nothing at all".
    assert any(c.endswith("start_background_warm") for c in calls), (
        "the probe cannot see known startup calls -- this test is vacuous")


def test_it_refuses_to_start_when_the_flag_is_off(monkeypatch):
    monkeypatch.delenv("FLOW_PREPARE_ENABLED", raising=False)
    monkeypatch.setattr(fa, "parts_enabled", lambda: True)
    assert fr.start_background_prepare() is False


def test_it_refuses_to_start_when_the_transport_it_warms_is_off(monkeypatch):
    """Warming a transport nothing serves would burn CPU and report healthy."""
    monkeypatch.setenv("FLOW_PREPARE_ENABLED", "1")
    monkeypatch.setattr(fa, "parts_enabled", lambda: False)
    assert fr.start_background_prepare() is False


def test_prepare_state_is_a_copy_so_a_caller_cannot_corrupt_the_counters():
    fr.prepare_state()["prepared"] = 9999
    assert fr._PREPARE_STATE["prepared"] != 9999


# ── health must grade the transport members actually take ────────────────────
#
# ⛔ THE PROD DEFECT THIS PINS, observed 2026-09-08 on uctintelligence.com:
#     {"warm": true, "parts": {"enabled": true, "entries": []}}
# `warm` graded ONLY the whole-D cache, but production serves first paint over
# the PARTS transport. So the health check said the fast path was ready while
# the path every member takes was completely cold -- a health check reading a
# proxy instead of the artifact, which is the exact failure its own docstring
# warns about. It is also what would have made the preparer unverifiable: my
# first draft named `warm` as the way to confirm the preparer worked.

@pytest.fixture
def _clean_caches():
    fa._CACHE.clear()
    fa._PARTS_CACHE.clear()
    yield
    fa._CACHE.clear()
    fa._PARTS_CACHE.clear()


def test_warm_is_FALSE_when_the_parts_transport_is_on_but_cold(monkeypatch, _clean_caches):
    monkeypatch.setattr(fa, "parts_enabled", lambda: True)
    monkeypatch.setattr(fa, "available", lambda: True)
    fa._CACHE[fa.DEFAULT_VIEW] = (7, b"whole")      # whole-D warm...
    # ...and no parts at all, which is precisely the prod reading.

    h = fa.health(current_version=7)

    assert h["warm"] is False, (
        "health reported the fast path warm while the transport members take "
        "was empty -- the proxy-not-artifact defect")
    assert h["warm_whole"] is True, "the whole-D path really was warm"
    assert "cold" in (h["reason"] or "")


def test_CONTROL_with_parts_off_the_whole_D_verdict_is_unchanged(monkeypatch, _clean_caches):
    """Without this the test above would pass on a health() that always says
    cold, and the long-standing behaviour would be silently broken."""
    monkeypatch.setattr(fa, "parts_enabled", lambda: False)
    monkeypatch.setattr(fa, "available", lambda: True)
    fa._CACHE[fa.DEFAULT_VIEW] = (7, b"whole")

    h = fa.health(current_version=7)
    assert h["warm"] is True and h["reason"] is None


def test_warm_is_TRUE_once_the_parts_for_the_default_view_are_built(monkeypatch, _clean_caches):
    monkeypatch.setattr(fa, "parts_enabled", lambda: True)
    monkeypatch.setattr(fa, "available", lambda: True)
    fa._CACHE[fa.DEFAULT_VIEW] = (7, b"whole")
    fa._PARTS_CACHE[fa.DEFAULT_VIEW + ("bootstrap",)] = (7, b"gz")

    h = fa.health(current_version=7)
    assert h["warm"] is True and h["warm_parts"] is True


def test_parts_built_for_a_SUPERSEDED_version_are_not_warm(monkeypatch, _clean_caches):
    """The next caller rebuilds, so reporting warm is how a stalled preparer
    would hide -- the same rule the whole-D path already had."""
    monkeypatch.setattr(fa, "parts_enabled", lambda: True)
    monkeypatch.setattr(fa, "available", lambda: True)
    fa._PARTS_CACHE[fa.DEFAULT_VIEW + ("bootstrap",)] = (6, b"gz")

    h = fa.health(current_version=7)
    assert h["warm"] is False
    assert "stale" in (h["reason"] or "")


# ── Detection must not wait behind preparation ───────────────────────────────
#
# ⛔⛔ THE MEASUREMENT THAT FORCED THIS, 12 real production rolls:
# preparation is stable at 6.1-9.1 s, but version-change -> prepared ranged
# 9-51 s (mean 23.4 s). Detection lag alone averaged 15.9 s and peaked at
# 44.9 s -- ~68% of the cold window -- because the two passes (~15-19 s) ran
# INLINE in the poll loop, so the loop's own work, not FLOW_PREPARE_POLL_S, set
# the cadence. A 60 s roll cannot be tracked by a loop that is busy for 20 s.

def test_the_detection_loop_KEEPS_POLLING_while_a_build_runs(monkeypatch):
    """⛔ BEHAVIOURAL, because the defect is about BLOCKING and a structural
    check cannot prove absence of it — my first version asserted `Thread(`
    appears in the loop, which a mutation that ALSO calls inline satisfies
    trivially. So run the real loop against a slow build and watch whether
    detection keeps ticking.

    This is the 44.9 s lag reproduced in miniature: preparation takes far longer
    than the poll interval, and detection must not wait for it."""
    import threading as _t
    polls = []
    building = _t.Event()
    release = _t.Event()

    def slow_once(last):
        building.set()
        release.wait(5)
        return 1001

    def version():
        polls.append(1)
        return 1001 if len(polls) < 3 else 1002

    monkeypatch.setattr(fr, "_PREPARE_POLL_S", 0.02)
    monkeypatch.setattr(fr, "_prepare_once", slow_once)
    monkeypatch.setattr(fr, "_current_version", version)
    monkeypatch.setattr(fr, "_PREPARE_LAST", None)

    fr._PREPARE_STOP.clear()
    t = _t.Thread(target=fr._prepare_loop, daemon=True)
    t.start()
    try:
        assert building.wait(3), "preparation never started"
        before = len(polls)
        time.sleep(0.4)                 # build still held open
        after = len(polls)
    finally:
        # ⛔ Stop the loop and free the lane, or this test leaks a thread that
        # polls the REAL version for the rest of the session and breaks its
        # neighbours — which is exactly what it did on the first run.
        release.set()
        fr._PREPARE_STOP.set()
        t.join(timeout=3)
        if fr._PREPARE_INFLIGHT.locked():
            try: fr._PREPARE_INFLIGHT.release()
            except RuntimeError: pass

    assert after > before + 2, (
        f"detection stalled while a build ran ({before} -> {after} polls). The "
        "loop is blocking on preparation again, which is exactly what made "
        "version-change -> prepared reach 44.9 s in production.")


def test_only_one_preparation_runs_at_a_time():
    """The lock is what stops a fast detection loop starting a build per tick."""
    assert fr._PREPARE_INFLIGHT.acquire(blocking=False)
    try:
        assert fr._PREPARE_INFLIGHT.acquire(blocking=False) is False
    finally:
        fr._PREPARE_INFLIGHT.release()


def test_pass_2_is_SKIPPED_when_the_version_moved_during_pass_1(monkeypatch):
    """⛔ FIRST PAINT BEATS THE REMAINDER. Spending another ~7-11 s warming the
    OLD version's deferred parts delays the NEW version's first paint, which is
    the only thing a member is waiting on."""
    seen = []

    def versions():
        # first call = the version being prepared; second = after pass 1
        seen.append(1)
        return 1001 if len(seen) == 1 else 1002

    rec = _Recorder(lambda v: (v, b"gz"))
    monkeypatch.setattr(fr, "_current_version", versions)
    monkeypatch.setattr(fa, "get_cached_or_build_part", rec)
    monkeypatch.setattr(fr, "_get_cached_or_build",
                        lambda source, days: (1001, __import__("gzip").compress(b"csv")))

    out = fr._prepare_once(None)

    assert out == 1001, "the prepared version should still be recorded"
    assert len(rec.calls) == 1, (
        "the remainder pass ran even though the version had already moved — the "
        "newer version's first paint is delayed behind stale work")
    assert rec.calls[0][4] == fa.FIRST_PAINT_PARTS


def test_CONTROL_pass_2_DOES_run_when_the_version_is_stable(monkeypatch):
    """Without this, the test above would pass on a preparer that had simply
    lost its remainder pass — and the deferred/fallback parts would go cold."""
    rec = _Recorder(lambda v: (v, b"gz"))
    _patch(monkeypatch, version=1001, builder=rec)

    fr._prepare_once(None)

    assert len(rec.calls) == 2, "the remainder pass is gone"


# ── The roll ledger: startup must never pollute steady state ─────────────────
#
# ⛔⛔ TWO SEPARATE MEASUREMENT DEFECTS THIS PINS.
# (1) A generation that predates the process is a CATCH-UP, not a roll. Counting
#     one produced a nonsense 130 s "detection latency" in a real report.
# (2) `version * 60` is NOT the birth instant. `_SIG_VERSION` is assigned
#     `int(time.time() // 60)` AT PROBE TIME, so the number encodes the MINUTE
#     the change was noticed and the true instant lies anywhere inside it. Any
#     latency derived from the bucket is an UPPER BOUND inflated by 0-60 s — and
#     an earlier report of mine quoted those bounds as point estimates.

@pytest.fixture(autouse=True)
def _clean_ledger():
    def _reset():
        fr._PREPARE_ROLLS.clear()
        for dq in fr._PREPARE_ROLLS_BY_KIND.values():
            dq.clear()
        fr._VERSION_FIRST_SEEN.clear()
    _reset()
    yield
    _reset()


def test_a_generation_predating_this_process_is_startup_catchup(monkeypatch):
    old_version = int((fr._PROCESS_START_WALL - 600) // fr._VERSION_BUCKET_SEC)
    fr._record_roll(old_version, prepare_ms=8000, pass2_skipped=False)

    assert fr.prepare_rolls("steady_state_roll") == [], (
        "a generation older than the process leaked into the steady-state "
        "distribution — this is exactly the 130 s confusion")
    assert len(fr.prepare_rolls("startup_catchup")) == 1


def test_a_generation_born_after_startup_is_a_steady_state_roll():
    new_version = int((fr._PROCESS_START_WALL + 120) // fr._VERSION_BUCKET_SEC)
    fr._record_roll(new_version, prepare_ms=7000, pass2_skipped=False)

    rows = fr.prepare_rolls("steady_state_roll")
    assert len(rows) == 1 and rows[0]["version"] == new_version
    assert fr.prepare_rolls("startup_catchup") == []


def test_observed_s_uses_the_DETECTOR_sighting_not_the_bucket():
    """⛔ The exact number. `observed_s` is detector-sighting -> published, which
    carries none of the bucket's 0-60 s ambiguity."""
    v = int((fr._PROCESS_START_WALL + 120) // fr._VERSION_BUCKET_SEC)
    fr._note_version_seen(v)
    time.sleep(0.05)
    fr._record_roll(v, prepare_ms=40, pass2_skipped=False)

    row = fr.prepare_rolls("steady_state_roll")[0]
    assert row["observed_s"] is not None and row["observed_s"] >= 0.04
    # And it must be far smaller than the bucket figure, which starts counting
    # from the beginning of the minute.
    assert row["bucket_bound_s"] is None or row["bucket_bound_s"] >= row["observed_s"]


def test_the_bucket_figure_is_reported_but_never_as_detection():
    """It is kept for continuity with earlier reports and MUST stay labelled a
    bound — the field name is the label."""
    v = int((fr._PROCESS_START_WALL + 120) // fr._VERSION_BUCKET_SEC)
    fr._record_roll(v, prepare_ms=7000, pass2_skipped=False)
    row = fr.prepare_rolls()[0]
    assert "bucket_bound_s" in row
    assert "detection_s" not in row, (
        "a field called detection_s would invite quoting the bucket bound as a "
        "measured detection latency, which is the error this exists to prevent")


def test_pass2_skipped_is_recorded(monkeypatch):
    """So the gate can count how often a newer version overtook the remainder."""
    v = int((fr._PROCESS_START_WALL + 120) // fr._VERSION_BUCKET_SEC)
    fr._record_roll(v, prepare_ms=7000, pass2_skipped=True)
    assert fr.prepare_rolls()[0]["pass2_skipped"] is True


def test_CONTROL_the_two_classes_are_actually_distinguishable():
    """Without this the split could pass by putting everything in one bucket."""
    old_v = int((fr._PROCESS_START_WALL - 600) // fr._VERSION_BUCKET_SEC)
    new_v = int((fr._PROCESS_START_WALL + 120) // fr._VERSION_BUCKET_SEC)
    fr._record_roll(old_v, 8000, False)
    fr._record_roll(new_v, 7000, False)
    assert len(fr.prepare_rolls("startup_catchup")) == 1
    assert len(fr.prepare_rolls("steady_state_roll")) == 1


def test_observed_s_stops_at_FIRST_PAINT_not_after_the_remainder():
    """⛔ THE HEADLINE NUMBER MUST BE THE MEMBER-RELEVANT ONE. The roll used to
    be recorded AFTER pass 2, so `observed_s` carried the remainder pass (7-11 s)
    while `prepare_ms` covered pass 1 only — the difference surfaced as a
    nonsense 8.7 s "handoff" in the first production row. `published_at` stamps
    the instant first paint became servable."""
    v = int((fr._PROCESS_START_WALL + 120) // fr._VERSION_BUCKET_SEC)
    fr._note_version_seen(v)
    published = time.time()
    time.sleep(0.15)                       # stand-in for pass 2 running on
    fr._record_roll(v, prepare_ms=50, pass2_skipped=False, published_at=published)

    row = fr.prepare_rolls("steady_state_roll")[0]
    assert row["observed_s"] < 0.12, (
        f"observed_s={row['observed_s']} includes work done after first paint "
        "was already servable")


def test_the_PREPARER_stamps_publication_so_pass_2_is_excluded(monkeypatch):
    """⛔ THE ONE THAT GUARDS THE CALL SITE. Testing `_record_roll` in isolation
    proves nothing about whether `_prepare_once` passes the stamp — a mutation
    that drops the argument falls back to `time.time()` and the isolated test
    stays green. So drive the REAL preparer with a slow pass 2 and require the
    recorded window to exclude it."""
    v = int((fr._PROCESS_START_WALL + 120) // fr._VERSION_BUCKET_SEC)
    calls = []

    def builder(key, version, provider, date_filter, part, only=None):
        calls.append(only)
        if len(calls) == 2:          # pass 2 — the remainder
            time.sleep(0.3)
        return (version, b"gz")

    monkeypatch.setattr(fr, "_current_version", lambda: v)
    monkeypatch.setattr(fa, "get_cached_or_build_part", builder)
    monkeypatch.setattr(fr, "_get_cached_or_build",
                        lambda source, days: (v, __import__("gzip").compress(b"csv")))
    fr._note_version_seen(v)

    fr._prepare_once(None)

    assert len(calls) == 2, "the remainder pass did not run, so this proves nothing"
    row = fr.prepare_rolls("steady_state_roll")[0]
    assert row["observed_s"] < 0.25, (
        f"observed_s={row['observed_s']} includes the 0.3s remainder pass — the "
        "preparer is not stamping first-paint publication")


def test_CONTROL_a_later_stamp_DOES_show_up(monkeypatch):
    """Proves the assertion above is measuring the stamp and not a constant."""
    v = int((fr._PROCESS_START_WALL + 180) // fr._VERSION_BUCKET_SEC)
    fr._note_version_seen(v)
    time.sleep(0.15)
    fr._record_roll(v, prepare_ms=50, pass2_skipped=False, published_at=time.time())
    assert fr.prepare_rolls("steady_state_roll")[0]["observed_s"] >= 0.14


# ── The forced-bump blind spot ────────────────────────────────────────────────
# ⛔⛔ THE DEFECT THESE PIN COST A WHOLE RTH SESSION (2026-09-09).
# `_record_roll` classified a roll by BUCKET arithmetic, and a forced version
# bump makes that arithmetic meaningless — so the branch fell straight to
# "startup_catchup". From the first bump onward every roll in the process was
# filed as a catch-up, `rolls_steady` stayed permanently empty, and
# `rolls_startup` is served [-5:], so an entire session compressed to five rows.
#
# It is not an edge case. `flow_gap_autofill` re-bumps AT BOOT after a recent
# fill and runs with FLOW_GAP_AUTOFILL_ENABLED=1 in production, so the offset is
# already non-zero before the preparer records its first roll. Production read
# `current_version: 39816459` (offset 1) with `rolls_steady: []`.
#
# ⛔ EVERY PRE-EXISTING TEST IN THIS FILE RAN AT _FORCE_BUMP_OFFSET == 0, which
# is why nine green classification tests could not see it. The fixture, not the
# assertion, was the blind spot.

def _bumped_version(offset=1, plus=0):
    """A version as `_current_version()` mints it while a bump is in effect."""
    return int(time.time() // fr._VERSION_BUCKET_SEC) + offset * 10_000_000 + plus


def test_a_forced_bump_does_not_blind_the_steady_state_gate(monkeypatch):
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 1)
    boot = _bumped_version()
    for v, prev in ((boot, None), (boot + 1, boot), (boot + 2, boot + 1)):
        fr._note_version_seen(v)
        fr._record_roll(v, prepare_ms=7000, pass2_skipped=False, prev_version=prev)

    steady = fr.prepare_rolls("steady_state_roll")
    assert [r["version"] for r in steady] == [boot + 1, boot + 2], (
        "a bumped generation cannot predate the process that minted it — "
        "filing these as catch-ups is what left rolls_steady empty in prod")


def test_CONTROL_the_boot_generation_is_STILL_a_catchup_under_a_bump(monkeypatch):
    """Without this, 'always steady_state_roll' would satisfy the test above."""
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 1)
    boot = _bumped_version()
    fr._note_version_seen(boot)
    fr._record_roll(boot, prepare_ms=8000, pass2_skipped=False, prev_version=None)

    assert fr.prepare_rolls("steady_state_roll") == []
    assert len(fr.prepare_rolls("startup_catchup")) == 1


def test_CONTROL_the_bucket_bound_stays_unavailable_under_a_bump(monkeypatch):
    """The bump really does invalidate the bucket — the fix must recover the
    CLASSIFICATION without inventing a bound out of nonsense arithmetic
    (version * 60 under a bump lands in the year 2045)."""
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 1)
    v = _bumped_version()
    fr._note_version_seen(v)
    fr._record_roll(v, prepare_ms=7000, pass2_skipped=False, prev_version=v - 1)

    row = fr.prepare_rolls("steady_state_roll")[0]
    assert row["bucket_bound_s"] is None
    assert row["observed_s"] is not None, "the EXACT number must survive a bump"


def _stub_build(monkeypatch, version, current):
    """Wire a preparer whose build always succeeds for `version`."""
    monkeypatch.setattr(fr, "_current_version", current)
    monkeypatch.setattr(fa, "get_cached_or_build_part",
                        lambda key, ver, provider, date_filter, part, only=None: (ver, b"gz"))
    monkeypatch.setattr(fr, "_get_cached_or_build",
                        lambda source, days: (version,
                                              __import__("gzip").compress(b"csv")))


def test_the_PREPARER_passes_the_prior_version_so_a_bumped_roll_is_STEADY(monkeypatch):
    """⛔ THE ONE THAT GUARDS THE CALL SITE. `prev_version` defaults to None, so
    a mutation that drops it at the call site re-files every roll as a catch-up
    and the isolated tests above stay green. Drive the REAL preparer."""
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 1)
    v = _bumped_version()
    _stub_build(monkeypatch, v, lambda: v)
    fr._note_version_seen(v)

    fr._prepare_once(v - 1)          # a prior version WAS prepared by this process

    assert fr.prepare_rolls("startup_catchup") == [], (
        "the preparer knew a prior version — this roll is a detected "
        "transition, not a boot catch-up")
    assert len(fr.prepare_rolls("steady_state_roll")) == 1


def test_the_pass2_SKIPPED_call_site_also_carries_the_prior_version(monkeypatch):
    """There are TWO `_record_roll` call sites and the overtake path is the one
    that fires under load — the exact condition the gate most wants to count."""
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 1)
    v = _bumped_version()
    seq = iter([v])                  # 1st read = v, every later read = v+1
    _stub_build(monkeypatch, v, lambda: next(seq, v + 1))
    fr._note_version_seen(v)

    fr._prepare_once(v - 1)

    rows = fr.prepare_rolls("steady_state_roll")
    assert len(rows) == 1 and rows[0]["pass2_skipped"] is True, (
        "the version moved during pass 1, so the remainder must be skipped AND "
        "the roll still recorded as steady-state")


def test_CONTROL_the_preparer_on_its_FIRST_pass_records_a_catchup(monkeypatch):
    """Proves the two call-site tests measure `prev_version` and not a constant."""
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 1)
    v = _bumped_version()
    _stub_build(monkeypatch, v, lambda: v)
    fr._note_version_seen(v)

    fr._prepare_once(None)           # boot: nothing was prepared before

    assert fr.prepare_rolls("steady_state_roll") == []
    assert len(fr.prepare_rolls("startup_catchup")) == 1


# ── Multi-roll bursts under a forced bump ─────────────────────────────────────
# ⛔ THE ADJACENT BLIND SPOT. The bump fix classifies the boot generation by
# `prev_version is None`, which is true for exactly ONE roll. The obvious worry
# is a BURST: if a boot burst produced N rolls, rolls 2..N would carry a
# non-null prev_version and land in the steady distribution as startup noise —
# the same defect with its sign flipped, and a gate reporting green on garbage.
#
# It does not, and the reason is structural rather than lucky: `_record_roll` is
# reachable only from `_prepare_once`, which is reachable only from the POLLING
# `_prepare_loop`. The loop reads `_current_version()`, which returns only the
# LATEST value — intermediate versions are never observed. N bumps therefore
# collapse into ONE roll. These pin that, so the property cannot be refactored
# away silently.

def test_a_BURST_of_bumps_collapses_to_ONE_roll(monkeypatch):
    """N rapid bumps must not become N rolls. If this ever fails, the burst
    concern becomes real and `prev_version is None` stops being sufficient."""
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 1)
    monkeypatch.setattr(fr, "_PREPARE_LAST", None)
    monkeypatch.setattr(fr, "_PREPARE_POLL_S", 0.05)
    base = _bumped_version()
    state = {"v": base}
    _stub_build(monkeypatch, base, lambda: state["v"])
    monkeypatch.setattr(fr, "_get_cached_or_build",
                        lambda source, days: (state["v"],
                                              __import__("gzip").compress(b"csv")))

    fr._PREPARE_STOP.clear()
    t = threading.Thread(target=fr._prepare_loop, daemon=True)
    t.start()
    try:
        for i in range(1, 6):        # five bumps, back to back
            state["v"] = base + i
        time.sleep(1.2)
    finally:
        fr._PREPARE_STOP.set()       # ⛔ never leak the thread into a neighbour
        t.join(timeout=5)
        fr._PREPARE_STOP.clear()

    rolls = list(fr._PREPARE_ROLLS)
    assert len(rolls) == 1, (
        f"{len(rolls)} rolls from 5 bumps — the loop is observing intermediate "
        "versions, so a burst CAN reach the ledger and rolls 2..N would be "
        "misfiled as steady-state")
    assert rolls[0]["version"] == base + 5, "the loop must prepare the LATEST"


def test_a_boot_then_REAL_transitions_gives_one_catchup_and_the_rest_steady(monkeypatch):
    """The counterpart: versions the detector genuinely watched ARRIVE are
    steady-state rolls no matter how soon after boot they happen — each was
    minted after _PROCESS_START_WALL, so `observed_s` is a real measurement."""
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 1)
    base = _bumped_version()
    seq = [base, base + 3, base + 4, base + 5, base + 6]   # prod's real shape
    state = {"v": None}
    _stub_build(monkeypatch, base, lambda: state["v"])
    monkeypatch.setattr(fr, "_get_cached_or_build",
                        lambda source, days: (state["v"],
                                              __import__("gzip").compress(b"csv")))

    last = None
    for v in seq:
        state["v"] = v
        fr._note_version_seen(v)
        last = fr._prepare_once(last)     # exactly what the loop assigns

    assert [r["version"] for r in fr.prepare_rolls("startup_catchup")] == [base]
    assert ([r["version"] for r in fr.prepare_rolls("steady_state_roll")]
            == seq[1:]), "a detected transition is a roll, not a catch-up"


# ── The offset-0 BUCKET path must not regress ────────────────────────────────
# ⛔ THE PATH THAT WAS ARGUABLY WORKING IS THE ONE THAT CAN REGRESS SILENTLY.
# The bump fix restructured the classifier into two branches. The mutants that
# guard it (M1/M4) both target the FALLBACK branch, and every pre-existing
# bucket-path test relies on the module default rather than PINNING the offset —
# so a bucket branch broken by a later edit would only be caught indirectly, and
# a test that leaked a non-zero offset would silently stop testing this path at
# all. These pin offset 0 explicitly, both directions, with a control.

def test_at_offset_0_a_generation_predating_the_process_is_STILL_a_catchup(monkeypatch):
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 0)
    old_v = int((fr._PROCESS_START_WALL - 600) // fr._VERSION_BUCKET_SEC)
    # prev_version is deliberately NON-null: at offset 0 the bucket decides, and
    # the fallback must not get a vote.
    fr._record_roll(old_v, 8000, False, prev_version=old_v - 1)

    assert fr.prepare_rolls("steady_state_roll") == [], (
        "the bucket branch stopped deciding at offset 0 — the fallback is "
        "answering for it, which is exactly the regression this pins")
    assert len(fr.prepare_rolls("startup_catchup")) == 1


def test_at_offset_0_a_generation_born_after_startup_is_STILL_steady(monkeypatch):
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 0)
    new_v = int((fr._PROCESS_START_WALL + 120) // fr._VERSION_BUCKET_SEC)
    # prev_version None would mean "catch-up" under the fallback; the bucket
    # says otherwise and the bucket must win.
    fr._record_roll(new_v, 7000, False, prev_version=None)

    rows = fr.prepare_rolls("steady_state_roll")
    assert len(rows) == 1 and rows[0]["version"] == new_v
    assert fr.prepare_rolls("startup_catchup") == []
    # ⛔ NOT asserting bucket_bound_s here: this version's bucket STARTS 120 s in
    # the future, and a future-dated bucket correctly reports None rather than a
    # negative "latency". The classification is the claim; `steady` despite
    # prev_version=None is already proof that the BUCKET branch decided, because
    # the fallback would have said catch-up.


# ── Per-kind ledger retention ────────────────────────────────────────────────
# THE SECOND FAILURE OF 2026-09-09, and it is independent of classification.
# One shared deque(maxlen=80) let a late-session run of one kind push the other
# kind's rows out entirely. Fixing the classifier alone would have left it live.

def test_catchup_volume_cannot_EVICT_steady_history(monkeypatch):
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 0)
    steady_v = int((fr._PROCESS_START_WALL + 120) // fr._VERSION_BUCKET_SEC)
    fr._record_roll(steady_v, 7000, False, prev_version=steady_v - 1)
    assert len(fr.prepare_rolls("steady_state_roll")) == 1

    old_v = int((fr._PROCESS_START_WALL - 600) // fr._VERSION_BUCKET_SEC)
    for i in range(300):               # far more than any single-deque maxlen
        fr._record_roll(old_v - i, 8000, False, prev_version=None)

    assert len(fr.prepare_rolls("steady_state_roll")) == 1, (
        "steady history was evicted by catch-up volume -- the shared-deque defect")
    assert len(fr.prepare_rolls("startup_catchup")) > 0


def test_CONTROL_a_kinds_own_deque_still_bounds_itself(monkeypatch):
    """Retention must stay BOUNDED -- an unbounded ledger is a memory leak on a
    long-lived worker, which is why the fix is per-kind deques and not no deque.
    Without this control, 'delete the maxlen' would satisfy the test above."""
    monkeypatch.setattr(fr, "_FORCE_BUMP_OFFSET", 0)
    cap = fr._PREPARE_ROLLS_BY_KIND["steady_state_roll"].maxlen
    assert cap is not None and cap > 0
    base = int((fr._PROCESS_START_WALL + 120) // fr._VERSION_BUCKET_SEC)
    for i in range(cap + 50):
        fr._record_roll(base + i, 7000, False, prev_version=base + i - 1)
    assert len(fr.prepare_rolls("steady_state_roll")) == cap


# ── Stage split: CSV materialization vs the parts build ──────────────────────
# ⛔ `prepare_ms` alone said "97.66 s, somewhere". The 2026-09-09 cold boot could
# not be attributed to a stage, and "which stage" is the entire question for the
# next optimisation (CSV materialization was measured at ~19.9 s of a ~28.8 s
# warm; a cold boot is a different animal). These pin that the split is real and
# that it is taken through the REAL preparer, not a helper.

def test_the_preparer_splits_CSV_time_out_of_prepare_ms(monkeypatch):
    v = int((fr._PROCESS_START_WALL + 120) // fr._VERSION_BUCKET_SEC)

    def slow_csv(source, days):
        time.sleep(0.25)                      # stand-in for materialization
        return (v, __import__("gzip").compress(b"csv"))

    monkeypatch.setattr(fr, "_current_version", lambda: v)
    monkeypatch.setattr(fa, "get_cached_or_build_part",
                        lambda key, ver, provider, df, part, only=None: (provider(), (ver, b"gz"))[1])
    monkeypatch.setattr(fr, "_get_cached_or_build", slow_csv)
    fr._note_version_seen(v)

    fr._prepare_once(None)

    row = fr.prepare_rolls()[0]
    assert row["csv_ms"] is not None and row["csv_ms"] >= 240, (
        f"csv_ms={row['csv_ms']} did not capture the materialization stage")
    assert row["parts_ms"] is not None and row["parts_ms"] >= 0
    assert row["csv_ms"] + row["parts_ms"] == row["prepare_ms"], (
        "the split must ACCOUNT for prepare_ms exactly, or it is decoration")


def test_CONTROL_a_fast_CSV_leaves_the_time_in_parts_not_csv(monkeypatch):
    """Proves csv_ms measures the provider and is not a constant."""
    v = int((fr._PROCESS_START_WALL + 180) // fr._VERSION_BUCKET_SEC)

    def slow_parts(key, ver, provider, df, part, only=None):
        provider()                            # cheap CSV
        time.sleep(0.25)                      # the node subprocess is the cost
        return (ver, b"gz")

    monkeypatch.setattr(fr, "_current_version", lambda: v)
    monkeypatch.setattr(fa, "get_cached_or_build_part", slow_parts)
    monkeypatch.setattr(fr, "_get_cached_or_build",
                        lambda s, d: (v, __import__("gzip").compress(b"csv")))
    fr._note_version_seen(v)

    fr._prepare_once(None)

    row = fr.prepare_rolls()[0]
    assert row["csv_ms"] < 200, f"csv_ms={row['csv_ms']} on a fast provider"
    assert row["parts_ms"] >= 240, f"parts_ms={row['parts_ms']} lost the parts cost"
