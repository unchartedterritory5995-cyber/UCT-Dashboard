"""Rails for the screener boot self-warm — reachability FIRST, then behaviour.

WHY THIS FILE EXISTS
--------------------
The warm was authored on 2026-06-19 at 16:20 (`72a56314`), refined at 16:33
(`1ae2272d`) — and killed at 17:33 the same day by `bd62ff97`, a *pattern-vision*
commit that inserted two new top-level functions into the MIDDLE of
`register_screener_jobs`. The warm block, its `except`, and its `return True`
were left behind as the tail of the new `register_pattern_vision_jobs`, sitting
after that function's own `return True`.

Nothing failed. The orphan is syntactically valid and correctly indented, so it
imported clean, passed every test, and read as live code in review for ~7 weeks.
The screener therefore served whatever `screener.db` the last 03:00 ET build
wrote, with no boot top-up, for the whole of that time.

⛔ It was not merely dead — it was dead in a way that DEFEATS the obvious fix.
The block references `snapshot_builder`, which is bound only inside
`register_screener_jobs`. Moving it above the `return` in the function where it
had come to rest would raise `NameError` straight into its own bare
`except Exception` and print "skipped" forever: a fix that looks applied, passes
review, and changes nothing.

So the durable protection is not "keep this line above that return". It is a
structural check that a statement is not dominated by a `return` in its own
function — asserted from the AST, never from a grep, with a control proving the
check can actually see an unreachable block.
"""
import ast
import pathlib
import time

import pytest

import api.main as m

MAIN_PY = pathlib.Path(m.__file__).resolve()


# ── the reachability check (the thing under test in the controls below) ──────

_TERMINATORS = (ast.Return, ast.Raise, ast.Continue, ast.Break)


def _always_exits(stmt) -> bool:
    """Does executing `stmt` ALWAYS transfer control away from the current body?

    Deliberately conservative: when in doubt, say False. Under-reporting makes
    the rail miss a defect only in exotic shapes; over-reporting would fail the
    build on correct code, and a rail that cries wolf gets deleted.
    """
    if isinstance(stmt, _TERMINATORS):
        return True
    if isinstance(stmt, ast.If):
        # Only when BOTH arms exit — a bare `if: return` falls through.
        return bool(stmt.orelse) and _body_exits(stmt.body) and _body_exits(stmt.orelse)
    if isinstance(stmt, (ast.With, ast.AsyncWith)):
        return _body_exits(stmt.body)
    if isinstance(stmt, ast.Try):
        # A `try` body that returns can still be resumed by a handler, so the
        # only unconditional exit is a `finally` that itself always exits.
        return bool(stmt.finalbody) and _body_exits(stmt.finalbody)
    return False


def _body_exits(body) -> bool:
    return any(_always_exits(s) for s in body)


def unreachable_statements(body, out=None):
    """Every statement in `body` (recursively) that no execution can reach.

    A statement is unreachable when an earlier statement in the SAME statement
    list always exits. Nested scopes are walked independently, so a `return`
    inside a nested `def` never marks its enclosing function's statements dead.
    """
    if out is None:
        out = []
    dead = False
    for stmt in body:
        if dead:
            out.append(stmt)
            continue
        for field in ("body", "orelse", "finalbody"):
            sub = getattr(stmt, field, None)
            if isinstance(sub, list) and sub and isinstance(sub[0], ast.stmt):
                unreachable_statements(sub, out)
        for handler in getattr(stmt, "handlers", []) or []:
            unreachable_statements(handler.body, out)
        if _always_exits(stmt):
            dead = True
    return out


# ── controls: prove the check can tell the two cases apart ───────────────────
#
# ⚠️ Without these, a checker that returns [] unconditionally passes every rail
# below and reports green forever (`lesson_gate_that_cannot_fail`). The positive
# control reproduces the EXACT historical shape — a statement stranded after a
# bare `return True` at function-body level.

_DEFECT_SHAPE = '''
def register_pattern_vision_jobs(scheduler):
    scheduler.add_job(_run, id="pattern_vision_judge")
    return True

    try:
        snapshot_db.init_db()
        if snapshot_db.count_rows() < warm_min:
            threading.Thread(target=snapshot_builder.run_build,
                             daemon=True, name="screener-warm").start()
    except Exception as e:
        print(f"skipped: {e}")
    return True
'''

_HEALTHY_SHAPE = '''
def register_screener_jobs(scheduler):
    scheduler.add_job(_run, id="screener_snapshot_nightly")

    try:
        snapshot_db.init_db()
        if snapshot_db.count_rows() < warm_min:
            threading.Thread(target=snapshot_builder.run_build,
                             daemon=True, name="screener-warm").start()
    except Exception as e:
        print(f"skipped: {e}")
    return True
'''


def _warm_is_flagged_unreachable(source: str) -> bool:
    tree = ast.parse(source)
    dead = unreachable_statements(tree.body)
    dead_lines = set()
    for stmt in dead:
        for node in ast.walk(stmt):
            if hasattr(node, "lineno"):
                dead_lines.add(node.lineno)
    return any(
        node.lineno in dead_lines
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and node.value == "screener-warm"
    )


def test_positive_control_the_check_detects_the_historical_defect():
    """The mutation the rail exists to catch, verbatim, MUST be flagged."""
    assert _warm_is_flagged_unreachable(_DEFECT_SHAPE), (
        "the reachability check did not flag a block stranded after `return True` "
        "— every other assertion in this file is therefore vacuous"
    )


def test_negative_control_the_check_passes_the_same_block_when_reachable():
    """The SAME block, before the return, must NOT be flagged (no false alarm)."""
    assert not _warm_is_flagged_unreachable(_HEALTHY_SHAPE)


# ── the rails on the real file ───────────────────────────────────────────────


def _main_tree():
    return ast.parse(MAIN_PY.read_text(encoding="utf-8"))


def _warm_thread_sites(tree):
    """Every `threading.Thread(..., name="screener-warm")` construction.

    DERIVED, not typed against a line number or a function name: the anchor is
    the runtime thread name the warm actually gets — the one artifact that
    survives the block being moved between functions, which is exactly what
    happened. `lesson_probe_names_must_be_derived_not_typed`.
    """
    sites = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        for kw in node.keywords:
            if (kw.arg == "name" and isinstance(kw.value, ast.Constant)
                    and kw.value.value == "screener-warm"):
                sites.append(node)
    return sites


def _enclosing_function(tree, node):
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if any(child is node for child in ast.walk(fn)):
                return fn
    return None


def test_the_boot_warm_exists_exactly_once():
    """Anti-vacuity: if the anchor vanishes, the rails below must FAIL, not skip.

    A renamed thread would otherwise silently empty every reachability
    assertion in this file.
    """
    sites = _warm_thread_sites(_main_tree())
    assert len(sites) == 1, (
        f"expected exactly one screener-warm thread in {MAIN_PY.name}, found "
        f"{len(sites)}. If the warm was intentionally REMOVED, delete this file "
        f"and test_the_boot_warm_is_wired_into_screener_registration too — but "
        f"the screener then has no boot top-up and goes stale until 03:00 ET."
    )


def test_the_boot_warm_is_not_dominated_by_a_return():
    """🔴 THE RAIL. The warm must be reachable in its own function.

    This is the assertion that goes red if `bd62ff97` ever happens again — an
    unrelated commit inserting a function boundary that strands this block after
    a `return`.
    """
    tree = _main_tree()
    site = _warm_thread_sites(tree)[0]
    fn = _enclosing_function(tree, site)
    assert fn is not None, "the warm is not inside a function at all"

    dead_nodes = unreachable_statements(fn.body)
    stranded = [s for s in dead_nodes if any(child is site for child in ast.walk(s))]
    assert not stranded, (
        f"the screener boot warm at {MAIN_PY.name}:{site.lineno} is UNREACHABLE — "
        f"dominated by a `return`/`raise` inside {fn.name}() (which begins at "
        f"line {fn.lineno}). It will never run, and nothing else will fail."
    )


def test_api_main_has_no_unreachable_statements_anywhere():
    """Whole-file generalisation of the rail.

    Measured at the time of the fix: these two orphaned statements were the ONLY
    unreachable code in all 6,787 lines of `api/main.py`. So "zero" is the real
    baseline of this file, not an arbitrary bar — and any future stranded block,
    screener-related or not, trips this.
    """
    dead = unreachable_statements(_main_tree().body)
    assert not dead, (
        "unreachable statements in api/main.py at lines "
        + ", ".join(str(s.lineno) for s in dead)
    )


def test_the_boot_warm_is_wired_into_screener_registration():
    """It must live with the nightly build it tops up — not merely be reachable.

    Reachability alone would be satisfied by a helper nobody calls, which is the
    same outcome for users.
    """
    tree = _main_tree()
    site = _warm_thread_sites(tree)[0]
    warm_fn = _enclosing_function(tree, site)

    register = next(
        (n for n in ast.walk(tree)
         if isinstance(n, ast.FunctionDef) and n.name == "register_screener_jobs"),
        None,
    )
    assert register is not None

    called = {
        n.func.id for n in ast.walk(register)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
    }
    assert warm_fn.name in called, (
        f"{warm_fn.name}() holds the boot warm but register_screener_jobs() never "
        f"calls it — the warm is reachable and still never runs"
    )
    # ...and that call site must itself be reachable.
    dead = unreachable_statements(register.body)
    assert not any(
        isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
        and n.func.id == warm_fn.name
        for s in dead for n in ast.walk(s)
    ), "register_screener_jobs() calls the warm from unreachable code"


# ── behaviour: it actually warms, and it is bounded ──────────────────────────


class _Recorder:
    """Stands in for snapshot_builder; records the cap it was handed."""

    def __init__(self, rows=0):
        self.calls = []
        self.rows = rows

    def run_build(self, max_tickers=None):
        self.calls.append(max_tickers)
        return {"built": 3, "skipped": 1, "errors": 0}


@pytest.fixture
def warm_env(monkeypatch):
    """Run the warm synchronously with no sleep, against fake screener modules."""
    rec = _Recorder()
    state = {"rows": 0, "init": 0}

    import sys
    import types

    db = types.ModuleType("api.services.screener.snapshot_db")
    db.init_db = lambda: state.__setitem__("init", state["init"] + 1)
    db.count_rows = lambda: state["rows"]
    monkeypatch.setitem(sys.modules, "api.services.screener.snapshot_db", db)
    monkeypatch.setitem(sys.modules, "api.services.screener.snapshot_builder", rec)

    pkg = sys.modules["api.services.screener"]
    monkeypatch.setattr(pkg, "snapshot_db", db, raising=False)
    monkeypatch.setattr(pkg, "snapshot_builder", rec, raising=False)

    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_DELAY_SECS", "0")
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_ENABLED", "1")
    return rec, state


def test_the_warm_builds_when_the_snapshot_is_under_filled(warm_env, monkeypatch):
    rec, state = warm_env
    state["rows"] = 12
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_MIN", "3000")

    t = m.start_screener_snapshot_warm()
    assert t is not None
    t.join(timeout=10)
    assert not t.is_alive()

    assert len(rec.calls) == 1, "the boot warm did not run a build"


def test_the_warm_is_bounded_well_under_the_nightly_universe(warm_env, monkeypatch):
    """⛔ An UNCAPPED boot build is the `bars_prewarm` cold-start herd (68392f4).

    `run_build`'s `_read_fundamentals` -> `massive.get_market_cap` ->
    `get_ticker_details` is uncached: one Massive REST call per ticker. The
    nightly's 4,000 is acceptable at 03:00 ET; on every pod restart it is not.
    """
    rec, state = warm_env
    state["rows"] = 0
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_MIN", "3000")

    t = m.start_screener_snapshot_warm()
    t.join(timeout=10)

    cap = rec.calls[0]
    assert cap is not None, "boot warm ran run_build() with NO cap — unbounded"
    nightly = int(__import__("os").environ.get("SCREENER_SNAPSHOT_MAX_PER_RUN", "4000"))
    assert 0 < cap < nightly, f"boot warm cap {cap} is not bounded under {nightly}"


def test_the_warm_is_off_the_boot_path(warm_env, monkeypatch):
    """Registration must not block on the warm, nor on its delayed build.

    The warm thread now DOES run an early, un-delayed schema migration right
    at thread start (see `test_the_warm_migrates_the_schema_before_the_delay_sleep`)
    — that is deliberate and intentionally fast (idempotent, sub-second), so a
    scheduling-dependent check of `state["init"]` immediately after `.start()`
    is no longer a reliable proxy (a fast daemon thread can legitimately win
    the race against the calling thread's very next line). What must still
    NEVER happen: the *registration call itself* blocking on any of it, or the
    delayed, row-count-gated build running before the sleep elapses.
    """
    rec, state = warm_env
    state["rows"] = 0
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_DELAY_SECS", "30")

    started = time.perf_counter()
    t = m.start_screener_snapshot_warm()
    elapsed = time.perf_counter() - started
    try:
        assert t.daemon, "the warm thread must be a daemon (never holds shutdown)"
        assert elapsed < 5, (
            f"start_screener_snapshot_warm() blocked the caller for "
            f"{elapsed:.2f}s instead of returning immediately (a 30s delay "
            f"is configured for the background thread, not the caller)"
        )
        assert rec.calls == [], "registration ran the build inline"
    finally:
        monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_DELAY_SECS", "0")


def test_the_warm_skips_a_snapshot_that_is_already_full(warm_env, monkeypatch):
    rec, state = warm_env
    state["rows"] = 9000
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_MIN", "3000")

    t = m.start_screener_snapshot_warm()
    t.join(timeout=10)
    assert rec.calls == [], "warmed a snapshot that was already above warm_min"


def test_the_warm_can_be_disabled(monkeypatch):
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_ENABLED", "0")
    assert m.start_screener_snapshot_warm() is None


def test_a_failing_warm_is_named_and_never_escapes(warm_env, monkeypatch, capsys):
    """⛔ never `except: pass` — a failure must be counted and NAMED."""
    rec, state = warm_env

    def _boom(max_tickers=None):
        raise RuntimeError("massive is down")

    rec.run_build = _boom
    state["rows"] = 0

    t = m.start_screener_snapshot_warm()
    t.join(timeout=10)
    assert not t.is_alive()

    out = capsys.readouterr().out
    assert "screener self-warm FAILED" in out
    assert "RuntimeError" in out and "massive is down" in out


def test_a_malformed_env_value_falls_back_instead_of_escaping(warm_env, monkeypatch):
    """The caller registers the wire watchdog in the SAME `try` as the screener
    jobs, so a ValueError escaping the warm would silently unregister an
    unrelated job. A junk env value must degrade to the default, not raise."""
    rec, state = warm_env
    state["rows"] = 0
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_MAX_PER_RUN", "not-a-number")
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_MIN", "")

    t = m.start_screener_snapshot_warm()          # must not raise
    t.join(timeout=10)
    assert rec.calls == [500], "malformed env did not fall back to the default cap"


def test_the_warm_migrates_the_schema_before_the_delay_sleep(warm_env, monkeypatch):
    """🔴 THE FIX. `init_db()` must run BEFORE `time.sleep(delay)`, not after.

    Regression for the up-to-`SCREENER_SNAPSHOT_WARM_DELAY_SECS` (default 120s)
    window where a freshly-deployed pod already advertises Wave-1 filter
    columns to the browser, but the legacy prod table isn't widened until the
    delayed warm/build path first runs `init_db()`. A member filtering or
    sorting on one of those columns during that window gets a 500
    (`no such column`). Migrating first — before the sleep — closes the window
    to effectively zero without disturbing the delay itself (still bounded,
    still off the boot path: `test_the_warm_is_off_the_boot_path` covers that).
    """
    rec, state = warm_env
    state["rows"] = 9000  # already full -> the build path itself no-ops
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_MIN", "3000")
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_DELAY_SECS", "5")

    import sys

    db = sys.modules["api.services.screener.snapshot_db"]
    events = []
    _orig_init = db.init_db

    def _tracking_init():
        events.append("init")
        _orig_init()

    db.init_db = _tracking_init
    monkeypatch.setattr(m.time, "sleep", lambda secs: events.append(("sleep", secs)))

    t = m.start_screener_snapshot_warm()
    t.join(timeout=10)

    assert events, "neither init_db() nor time.sleep() ran"
    assert events[0] == "init", (
        f"the schema migration must run BEFORE the warm delay sleep, "
        f"not after — got event order {events!r}"
    )
    assert ("sleep", 5.0) in events, "the warm delay sleep never ran"


def test_registration_still_returns_true_and_registers_the_nightly(monkeypatch):
    """The warm must not disturb the job registration it now shares a function with."""
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_ENABLED", "0")

    class _Sched:
        def __init__(self):
            self.ids = []

        def add_job(self, *a, **k):
            self.ids.append(k.get("id"))

    sched = _Sched()
    assert m.register_screener_jobs(sched) is True
    assert "screener_snapshot_nightly" in sched.ids
