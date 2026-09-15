"""OI-36 — `/buzz` must ACK before it does any work.

⚰️ THE OBSERVATION. Smoke row 8, 2026-09-14 19:10 ET: the board **rendered correctly** —
`chart-renderer render path=/r/buzz status=200 ms=10738 bytes=346078` — and the member saw
`The application did not respond.` Discord's initial-ack deadline is 3 s.

⛔ THE DEFECT IS ORDERING, NOT SPEED. The handler built the reply text with
`await run_in_threadpool(...)` and only then returned `{"type": 5}`. That await is bounded
by the shared anyio thread limiter (64 tokens, `api/main.py`), which every sync
`background.add_task` render job on this router also draws from — Starlette runs sync
background tasks in that same pool. So the ack was bounded by POOL AVAILABILITY, not by
its own ~8.5 ms of SQLite. Measured: **1.05 ms with the pool free, 2,001 ms with it
exhausted.**

⛔⛔ AND THAT IS WHY THESE RAILS MEASURE *WHETHER WORK HAPPENED BEFORE THE ACK*, NOT HOW
LONG THE ACK TOOK. A timing assertion on a developer box measures an idle pool and passes
on the broken code — the pre-fix handler answered in 1.05 ms whenever nothing else was
running, which is every local test run. The property that distinguishes fixed from broken
is structural: at the moment the ack is produced, NO reply has been built.
"""
from __future__ import annotations

import pathlib

import pytest

from tests.test_buzz_command import (  # noqa: F401 — `route` is a fixture
    EPHEMERAL, _buzz, _post, route,
)

_ROUTER = (pathlib.Path(__file__).resolve().parents[1]
           / "api" / "routers" / "discord_interactions.py")


def _spy_builders(monkeypatch):
    """Both builders, recording that they ran. Returns the record list."""
    from api.services import buzz_reply
    built: list = []

    def _board(*_a, **_k):
        built.append("board")
        return "the board"

    def _ticker(*_a, **_k):
        built.append("ticker")
        return "one name"

    monkeypatch.setattr(buzz_reply, "build_board_text", _board)
    monkeypatch.setattr(buzz_reply, "build_ticker_text", _ticker)
    return built


# ── the property ─────────────────────────────────────────────────────────────

def test_the_background_job_delivers_what_moved(route, monkeypatch):
    """The work did not vanish — it moved. Both shapes still reach the member."""
    client, sk, rt, bi = route
    monkeypatch.setattr(bi, "image_enabled", lambda: False)
    _spy_builders(monkeypatch)
    edits: list = []
    rt.run_buzz_job("A", "T", "", "open", 0, edit_fn=lambda a, t, **kw: edits.append(kw))
    assert [e.get("content") for e in edits] == ["the board"]
    edits.clear()
    rt.run_buzz_job("A", "T", "NVDA", "open", 0, edit_fn=lambda a, t, **kw: edits.append(kw))
    assert [e.get("content") for e in edits] == ["one name"]


def test_a_build_failure_AFTER_the_defer_still_resolves_the_spinner(route, monkeypatch):
    """⛔ A NEW FAILURE MODE THE FIX CREATES, AND ITS GUARD. Before, a build error could
    `return _ephemeral("Could not read the counts right now.")` because nothing had been
    acked yet. After the defer, the member is already watching a "thinking…" that only we
    can resolve — so a swallowed exception leaves a spinner forever, which is a WORSE
    member experience than the bug being fixed."""
    client, sk, rt, bi = route
    monkeypatch.setattr(bi, "image_enabled", lambda: False)
    from api.services import buzz_reply

    def _boom(*_a, **_k):
        raise RuntimeError("store is unreadable")

    monkeypatch.setattr(buzz_reply, "build_board_text", _boom)
    edits: list = []
    rt.run_buzz_job("A", "T", "", "open", 0, edit_fn=lambda a, t, **kw: edits.append(kw))
    assert len(edits) == 1, "the member was left on a spinner nothing resolves"
    assert "Could not read the counts" in edits[0]["content"]


def test_the_job_never_raises_into_the_background(route, monkeypatch):
    """Even the failure edit can fail. A background task that raises is an unhandled
    exception in Starlette's task group, not a message to anyone."""
    client, sk, rt, bi = route
    monkeypatch.setattr(bi, "image_enabled", lambda: False)
    from api.services import buzz_reply
    monkeypatch.setattr(buzz_reply, "build_board_text",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))

    def _edit_boom(*_a, **_k):
        raise RuntimeError("discord is down")

    rt.run_buzz_job("A", "T", "", "open", 0, edit_fn=_edit_boom)   # must not raise


# ── the structural half ──────────────────────────────────────────────────────

def _buzz_branch_code() -> str:
    """The /buzz branch, comments stripped.

    ⛔ CODE, NEVER PROSE. This file and that branch both discuss `await run_in_threadpool`
    in words; a raw text search would match the explanation of the bug and report the bug.
    Full-line comments are dropped before matching, and the control below proves the
    stripping did not simply empty the slice."""
    src = _ROUTER.read_text(encoding="utf-8")
    start = src.index('if itype == 2 and name == di.BUZZ_COMMAND')
    end = src.find("\n    if itype ==", start + 10)
    branch = src[start:end if end > start else len(src)]
    return "\n".join(l for l in branch.splitlines() if not l.strip().startswith("#"))


def test_the_buzz_branch_awaits_nothing_before_it_defers():
    """⛔ THE STRUCTURAL GUARD. The behavioural test above proves the CURRENT builders are
    not called; this proves no NEW await can be added to the ack path at all — a future
    `await some_lookup()` would be invisible to a spy on two named functions."""
    code = _buzz_branch_code()
    assert "await " not in code, "an await is back on the /buzz ack path"
    assert 'return {"type": 5' in code, "the branch no longer defers at all"


def test_the_stripper_did_not_just_empty_the_slice():
    """⛔ NON-VACUITY for the source check. An empty string contains no `await` either."""
    code = _buzz_branch_code()
    assert "di.user_rate_check" in code, "the slice lost the branch's real code"
    assert len(code.splitlines()) > 8


def _router_code_only() -> str:
    """The router as CODE — every comment and every docstring blanked.

    ⚰️ THE FIRST VERSION OF THIS HELPER STRIPPED ONLY `#` LINES AND FAILED ON ITS OWN
    FIX. `run_buzz_job`'s docstring explains the defect using the words
    `await run_in_threadpool(...)`, so a line-level strip left the prose in and the check
    reported the bug it had just removed. That is the sixth instance of this class in this
    repo — an instrument reporting a property of ITSELF as a property of what it measures.
    `ast.unparse` keeps docstrings, so they are blanked explicitly."""
    import ast
    tree = ast.parse(_ROUTER.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    return ast.unparse(tree)


def test_the_threadpool_import_is_gone_from_the_router():
    """`run_in_threadpool` had exactly one call site — this one. Leaving the import would
    tell the next reader the ack path still uses it."""
    code = _router_code_only()
    assert "run_in_threadpool" not in code, "still imported or called in CODE"


def test_the_code_only_view_can_still_see_things_that_are_there():
    """⛔ NON-VACUITY. Blanking every string constant is a big hammer; if `ast.unparse`
    returned something unrecognisable the check above would pass on any file."""
    code = _router_code_only()
    assert "def run_buzz_job" in code
    assert "background.add_task(run_buzz_job" in code


# ── D-09 A1: the ordering rail, rebuilt ──────────────────────────────────────
#
# ⚰️⚰️ WHY THIS REPLACED THE FIRST VERSION. D-08 ran the mutation that matters —
# `background.add_task(run_buzz_job, ...)` changed to a bare inline
# `run_buzz_job(...)` — and the old rail stayed GREEN. It did this:
#
#     monkeypatch.setattr(rt, "run_buzz_job", lambda *a, **k: scheduled.append(a))
#
# It STUBBED the very function whose scheduling it was checking. An inline call and a
# backgrounded call both land on that inert lambda, so `built == []` holds either way and
# `len(scheduled) == 1` holds either way. **The rail could not distinguish the two states
# it exists to distinguish** — `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.
#
# ⛔ AND THE VARIANT IT MISSED IS THE WORSE ONE. A synchronous inline call carries no
# `await`, so the source scan below cannot see it either; and it runs the SQLite build on
# the one shared event loop of a single-process pod, which is the 2026-07-01 outage by
# name. The old pair of rails was blind to exactly the regression with the largest blast
# radius.
#
# ⭐ THE FIX IS TO SPY ON THE HANDOFF, NOT THE JOB. `background.add_task` is wrapped (the
# real job still runs), and the builders are spied, into ONE ordered log. Backgrounded
# work puts the handoff first; inline work puts a build first. That is a difference the
# assertion can see.


def _order_log(monkeypatch):
    """One ordered event log: the add_task handoff and every builder entry.

    Returns the list. `add_task` is WRAPPED, never replaced — the real `run_buzz_job`
    still runs, so the builders really are reached and the log is not a fiction."""
    import starlette.background as _bg
    from api.services import buzz_reply

    events: list = []
    original = _bg.BackgroundTasks.add_task

    def _spy_add_task(self, func, *a, **kw):
        events.append(f"add_task:{getattr(func, '__name__', str(func))}")
        return original(self, func, *a, **kw)

    monkeypatch.setattr(_bg.BackgroundTasks, "add_task", _spy_add_task)

    def _board(*_a, **_k):
        events.append("build:board")
        return "the board"

    def _ticker(*_a, **_k):
        events.append("build:ticker")
        return "one name"

    monkeypatch.setattr(buzz_reply, "build_board_text", _board)
    monkeypatch.setattr(buzz_reply, "build_ticker_text", _ticker)
    return events


@pytest.mark.parametrize("ticker", ["", "NVDA"], ids=["board", "ticker"])
def test_the_handoff_happens_before_any_reply_is_built(route, monkeypatch, ticker):
    """⛔ THE LOAD-BEARING ONE. Covers BOTH branches: the ticker path was the one that
    still answered `type: 4` inline, so it had to build before it could speak at all.

    The assertion is on ORDER, not on timing — a timing assertion on a developer box
    measures an idle pool and passes on the broken code (1.05 ms free / 2,001 ms
    exhausted)."""
    client, sk, rt, bi = route
    monkeypatch.setattr(bi, "image_enabled", lambda: False)
    events = _order_log(monkeypatch)

    r = _post(client, sk, _buzz(ticker=ticker)).json()

    assert r["type"] == 5, "the ack must be a defer, not a reply that needed content"
    assert r.get("data", {}).get("flags") == EPHEMERAL
    assert events, "nothing was recorded — the spies are not on the path"
    assert events[0] == "add_task:run_buzz_job", (
        f"the work did not reach the background FIRST (log={events}) — OI-36 is back. "
        "An inline call puts a build before the handoff.")
    assert "add_task:run_buzz_job" in events, "run_buzz_job was never scheduled at all"


def test_the_order_log_can_actually_see_a_build(route, monkeypatch):
    """⛔ NON-VACUITY, and it is the one the old rail needed. `events[0] == "add_task:…"`
    passes just as happily if the builder spies were never reached — which is precisely
    how the stubbed version stayed green. With the REAL job running, a build MUST appear
    in the log after the handoff, or the ordering assertion is measuring nothing."""
    client, sk, rt, bi = route
    monkeypatch.setattr(bi, "image_enabled", lambda: False)
    events = _order_log(monkeypatch)
    _post(client, sk, _buzz())
    assert "build:board" in events, (
        "the builder spies were never reached — the real run_buzz_job did not run, so "
        "the ordering rail above proves nothing")
    assert events.index("add_task:run_buzz_job") < events.index("build:board")


# ── D-09 A1: the structural rail — the handoff is the ONLY way in ────────────

def _run_buzz_job_references():
    """Every reference to `run_buzz_job` in the router, classified, from an AST.

    Returns (handed_to_add_task, other_references). A bare call, an await, or a wrap in
    `run_in_threadpool(run_buzz_job, ...)` all land in `other_references`."""
    import ast
    tree = ast.parse(_ROUTER.read_text(encoding="utf-8"))
    allowed_nodes, others = [], []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            is_add_task = isinstance(fn, ast.Attribute) and fn.attr == "add_task"
            if is_add_task:
                for arg in node.args:
                    if isinstance(arg, ast.Name) and arg.id == "run_buzz_job":
                        allowed_nodes.append(arg)
            if isinstance(fn, ast.Name) and fn.id == "run_buzz_job":
                others.append(("bare call", node.lineno))
    allowed_ids = {id(n) for n in allowed_nodes}
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id == "run_buzz_job" and id(node) not in allowed_ids:
            others.append(("reference", node.lineno))
    return allowed_nodes, others


def test_run_buzz_job_is_only_ever_handed_to_add_task():
    """⛔ THE STRUCTURAL HALF. The behavioural rail proves THIS handler defers today; this
    proves no future edit can reach the job any other way — inline, awaited, or wrapped in
    a threadpool — without going red, including shapes that carry no `await` for the
    source scan to find."""
    allowed, others = _run_buzz_job_references()
    assert not others, f"run_buzz_job is reached outside background.add_task: {others}"


def test_the_reference_scan_can_see_the_handoff_it_allows():
    """⛔ NON-VACUITY. `others == []` is satisfied by a scan that finds nothing at all."""
    allowed, _ = _run_buzz_job_references()
    assert allowed, "the scan found no add_task(run_buzz_job) — it is not looking at the router"
