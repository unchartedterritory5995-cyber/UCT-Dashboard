"""Wave 7 lane H, fix round 1 — review I-3 (and the M-2 / M-3 halves that live
at the same sites): WHEN a streamed Ask answer or writing-help draft is charged.

⚰️ THE DEFECT. Both streams refunded whenever they had not SETTLED:
`finally: ... if not settled or not text.strip(): refund(...)`. A client abort
(Stop, closing the panel, a dropped connection) lands in that `finally` with
`settled = False`, so a member who clicked Stop just before `final` kept a
readable draft the provider had billed for, and neither the 60/day count nor
the shared dollar cap ever saw it — unlimited drafts at zero budget.

THE RULE (`note_ask.refund_due`, ONE predicate both routes ask): a stream is
CHARGED FROM ITS FIRST DELTA. It refunds only on a SERVER-side failure or when
nothing was ever sent. A stream closes EXACTLY ONCE (`note_ask.StreamCharge`),
from its `finally` AND from the response's background task — the second door
covers a response Starlette cancels before the body generator ever starts,
which has no `finally` at all.

The streams are driven the way the server drives them: the route's own
StreamingResponse, its `body_iterator` pulled chunk by chunk, then `aclose()`
(what an abort does) or its `background` run with the body untouched. No model
is called: each route's provider seam is replaced.
"""
from __future__ import annotations

import ast
import asyncio
import pathlib
import sqlite3

import pytest
from fastapi import HTTPException

from api.services import note_ask

UID = "u1"
PAID = {"id": UID, "email": "paid@example.test", "role": "member", "plan": "pro"}
WH_BODY = {"action": "rewrite", "style": "shorter", "scope": "selection",
           "text": "I sold NVDA early because I was scared of the gap down."}
ASK_QUERY = {"query": "what did I say about margins"}


# ── fixtures ─────────────────────────────────────────────────────────────────

DAY = "2026-09-25"


@pytest.fixture(autouse=True)
def _fresh_ledger(monkeypatch):
    """The day is pinned and the slots are empty. The COUNTERS are durable since
    ruling D-H5b (auth.db, `daily_counters`): each route test gets a fresh
    database from the `db` fixture, so they start at zero with it."""
    monkeypatch.setattr(note_ask, "_et_day", lambda: DAY)
    with note_ask._synth_lock:
        note_ask._inflight.clear()
    yield
    with note_ask._synth_lock:
        note_ask._inflight.clear()


@pytest.fixture
def db(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.services.journal_two.db import ensure_schema
    path = str(tmp_path / "charge.db")
    conn = sqlite3.connect(path)
    conn.executescript(auth_db._SCHEMA)
    ensure_schema(conn)
    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name, role, created_at)"
        " VALUES (?,?,?,?,?,datetime('now'))",
        (UID, PAID["email"], "x", "U1", "member"))
    conn.commit()
    conn.close()
    monkeypatch.setattr(auth_db, "_DB_PATH", path)
    return path


def _note(text):
    from api.services.journal_two import notes
    return notes.create_note(UID, {"title": "NVDA thesis", "bodyJson": {
        "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}})


def _provider(deltas, fail_after=None):
    async def gen(_kwargs):
        for i, d in enumerate(deltas):
            if fail_after is not None and i >= fail_after:
                raise RuntimeError("provider went away")
            yield d
    return gen


class _Route:
    """One of the two streamed doors, behind the same three questions."""

    def __init__(self, name, monkeypatch):
        self.name = name
        self.mp = monkeypatch
        self.target = None

    def arrange(self, deltas=("A tighter ", "version."), fail_after=None):
        if self.name == "writing_help":
            from api.services.journal_two import writing_help as wh
            self.mp.setenv(wh.WRITING_HELP_GATE, "1")
            self.mp.setattr(wh, "stream_text", _provider(list(deltas), fail_after))
            self.target = _note("draft me")["id"]
        else:
            from api.services.journal_two import ask_service
            self.mp.setattr(ask_service, "synthesize", _provider(list(deltas), fail_after))
            self.target = _note("margins compressed in Q3")["id"]

    async def open(self):
        if self.name == "writing_help":
            from api.routers import notebook_writing_help as nwh
            return await nwh.writing_help_stream(self.target, dict(WH_BODY), user=dict(PAID))
        from api.routers import journal_two
        return await journal_two._ask_stream(dict(PAID), "note", self.target, dict(ASK_QUERY))

    def charged(self) -> int:
        if self.name == "writing_help":
            return note_ask.writing_help_used(UID)
        return note_ask.ask_used(UID)

    def expected_charge(self) -> float:
        """What one charged stream costs the shared dollar cap. Ask pays the
        flat `_APPROX_COST`; writing help pays ruling D-H5's per-action
        estimate for THIS request -- re-derived from the estimator, never
        restated (tests shard M-3: the flat figure this assertion used to pin
        is the one the ruling rejected for writing help)."""
        if self.name == "writing_help":
            from api.services.journal_two import writing_help as wh
            return wh.estimate_cost(wh.parse_request(dict(WH_BODY)), model=wh.model_name())
        return note_ask._APPROX_COST


@pytest.fixture(params=["writing_help", "ask"])
def route(request, db, monkeypatch):
    return _Route(request.param, monkeypatch)


def _pull(route, n=None, *, background_only=False):
    """Open the route's response; pull `n` chunks (None = all) then aclose()."""
    async def run():
        resp = await route.open()
        if background_only:
            assert resp.background is not None, (
                "no second door: a response cancelled before its body starts would "
                "leak the slot and the reservation until the process restarts")
            await resp.background()
            return resp, []
        it, got = resp.body_iterator, []
        try:
            while n is None or len(got) < n:
                got.append(await it.__anext__())
        except StopAsyncIteration:
            pass
        finally:
            await it.aclose()
        return resp, got
    return asyncio.run(run())


# ── the rule, as a table ─────────────────────────────────────────────────────

@pytest.mark.parametrize("sent,failed,refund", [
    (False, False, True),    # nothing reached the member
    (True, False, False),    # an abort after text arrived keeps the charge
    (True, True, True),      # a server failure is ours, not the member's spend
    (False, True, True),
])
def test_the_rule_is_one_predicate(sent, failed, refund):
    assert note_ask.refund_due(sent=sent, failed=failed) is refund


# ── the four ways a stream can end ───────────────────────────────────────────

def test_an_ABORT_after_the_first_delta_KEEPS_the_charge(route):
    route.arrange()
    _resp, got = _pull(route, n=2)                 # head + the first delta, then Stop
    assert '"delta"' in got[1]
    assert route.charged() == 1, "Stop after the member had text must not refund"
    assert note_ask.spend_today() == pytest.approx(route.expected_charge())
    if route.name == "writing_help":
        # non-vacuity: the per-action estimate is not the flat charge, so the
        # line above could not pass on the rejected flat figure
        assert route.expected_charge() != pytest.approx(note_ask._APPROX_COST)
    assert note_ask.inflight(UID) == 0             # the slot is released either way


def test_an_ABORT_before_any_delta_refunds_and_releases(route):
    route.arrange()
    _resp, got = _pull(route, n=1)                 # only the head, then Stop
    assert len(got) == 1
    assert route.charged() == 0, "nothing reached the member, so nothing is charged"
    assert note_ask.spend_today() == 0.0
    assert note_ask.inflight(UID) == 0, "a disconnect at the first chunk leaked the slot"


def test_an_ABORT_after_only_WHITESPACE_refunds(route):
    # "Charged from the first delta" means the first VISIBLE text: a delta of
    # blanks is not a draft in hand (the existing empty-draft rail agrees).
    route.arrange(deltas=("   ", "real words"))
    _resp, got = _pull(route, n=2)                 # head + the blank delta, then Stop
    assert route.charged() == 0
    assert note_ask.inflight(UID) == 0


def test_a_SERVER_FAILURE_after_the_first_delta_refunds(route):
    route.arrange(deltas=("half ", "an answer"), fail_after=1)
    _resp, got = _pull(route)
    assert any('"error"' in c for c in got)
    assert route.charged() == 0, "a server-side failure is not the member's spend"
    assert note_ask.inflight(UID) == 0


def test_a_COMPLETED_stream_is_charged_once(route):
    route.arrange()
    resp, _got = _pull(route)
    assert route.charged() == 1
    asyncio.run(resp.background())                 # the second door after a finished stream
    assert route.charged() == 1, "closing twice must not refund"
    assert note_ask.inflight(UID) == 0


def test_a_response_that_NEVER_STARTS_is_closed_by_its_background(route):
    route.arrange()
    _resp, _ = _pull(route, background_only=True)
    assert note_ask.inflight(UID) == 0, "the slot leaked: the body never ran, so nothing released it"
    assert route.charged() == 0, "nothing was sent, so nothing is charged"


def test_closing_twice_never_releases_ANOTHER_streams_slot(route):
    route.arrange()
    resp, _ = _pull(route)
    assert note_ask.begin_stream(UID) is True      # the member opens a second stream
    asyncio.run(resp.background())                 # the FIRST stream's late second door
    assert note_ask.inflight(UID) == 1, "a double close released the live stream's slot"


# ── M-2: the refusal names the limit that refused ────────────────────────────

def test_the_SHARED_cap_says_so_and_the_member_cap_says_the_member(db, monkeypatch):
    from api.routers import notebook_writing_help as nwh
    from api.services.journal_two import writing_help as wh
    monkeypatch.setenv(wh.WRITING_HELP_GATE, "1")
    n = _note("x")["id"]

    def refusal():
        with pytest.raises(HTTPException) as e:
            asyncio.run(nwh.writing_help_stream(n, dict(WH_BODY), user=dict(PAID)))
        assert e.value.status_code == 429
        return e.value.detail

    from api.services import daily_counters as dc
    # everyone's cap, not theirs
    dc.take(DAY, [dc.Charge(note_ask.SCOPE_SPEND, dc.GLOBAL, note_ask._SYNTH_GLOBAL_HARD)])
    assert refusal() == wh.SHARED_CAP_SENTENCE
    dc.clear()
    dc.take(DAY, [dc.Charge(note_ask.SCOPE_WRITING_HELP, UID, note_ask.writing_help_peruser_cap())])
    assert refusal() == wh.BUDGET_SENTENCE                        # control: their own 60


# ── D-H11: a durable-counter write never waits ON the event loop ─────────────
# Ruling D-H11 (backend re-review N3). The web pod is ONE uvicorn process with
# ONE event loop for every member. D-H5b made the day's counters an auth.db
# write, and the stream refund ran in the async generator's `finally` --
# synchronously, on that loop: ~1.2 s of stalled loop for every member while
# another writer held auth.db, and a provider outage refunds every Ask stream
# at once. These rails hold a REAL write lock from a second connection (as
# another writer on the pod does) and run an unrelated coroutine on the same
# loop beside the stream: it must keep its pace while the counter write waits,
# and the write must still land once the lock is released.

HOLD_S = 0.6       # how long the other writer holds auth.db
BOUND_S = 0.25     # the longest the loop may pause for anyone else meanwhile


class _Writer:
    """Another connection holding auth.db's write lock."""

    def __init__(self, path):
        self.conn = sqlite3.connect(path, timeout=0, isolation_level=None)
        self.conn.execute("BEGIN IMMEDIATE")
        self.held = True

    def release(self):
        if self.held:
            self.conn.execute("ROLLBACK")
            self.held = False

    def close(self):
        self.release()
        self.conn.close()


async def _unrelated_request(gaps, done):
    """Another member's work on the same loop: a 10 ms heartbeat that records
    how long each beat actually took."""
    loop = asyncio.get_running_loop()
    last = loop.time()
    while not done.is_set():
        await asyncio.sleep(0.01)
        now = loop.time()
        gaps.append(now - last)
        last = now


async def _drain_body(resp):
    it = resp.body_iterator
    try:
        while True:
            await it.__anext__()
    except StopAsyncIteration:
        pass
    finally:
        await it.aclose()


def _waiting_in_background() -> int:
    with note_ask._pending_lock:
        return sum(not f.done() for f in note_ask._pending)


@pytest.fixture
def locked_db(db, monkeypatch):
    from api.services import daily_counters as dc
    assert dc.value(DAY, "warm", UID) == 0.0      # the file exists, in WAL mode, first
    # Longer than HOLD_S: the write WAITS for the lock and then lands. (An
    # on-loop write would stall the loop for this long -- the release below
    # runs on the loop, so it cannot happen until the write gives up.)
    monkeypatch.setattr(dc, "BUSY_TIMEOUT_MS", 2_000)
    return db


def test_a_REFUND_while_auth_db_is_write_locked_never_stalls_the_loop(route, locked_db):
    route.arrange(fail_after=0)          # the provider fails at once: a refund is due

    async def run():
        loop = asyncio.get_running_loop()
        resp = await route.open()        # the reservation, while auth.db is free
        assert route.charged() == 1
        writer = _Writer(locked_db)
        gaps, done = [], asyncio.Event()
        beat = asyncio.create_task(_unrelated_request(gaps, done))
        await asyncio.sleep(0.05)        # the other request is already beating
        t0 = loop.time()
        try:
            await _drain_body(resp)      # the error, then the refund-due `finally`
            await asyncio.sleep(max(0.0, HOLD_S - (loop.time() - t0)))
            waiting = _waiting_in_background()
            writer.release()
            await asyncio.to_thread(note_ask.drain_background)
        finally:
            writer.close()
            done.set()
            await beat
        return gaps, waiting

    gaps, waiting = asyncio.run(run())
    assert max(gaps) < BOUND_S, (
        f"the loop stalled {max(gaps):.3f}s for every member while a refund waited on auth.db")
    # non-vacuity: the refund really was blocked by the held lock, so a write
    # made ON the loop would have stalled it for as long.
    assert waiting >= 1, "nothing waited on the lock: this rail could not see an on-loop write"
    assert route.charged() == 0, "the refund must still HAPPEN once the lock is released"
    assert note_ask.inflight(UID) == 0


def test_a_CHARGE_while_auth_db_is_write_locked_never_stalls_the_loop(route, locked_db):
    route.arrange()

    async def run():
        writer = _Writer(locked_db)
        gaps, done = [], asyncio.Event()
        beat = asyncio.create_task(_unrelated_request(gaps, done))
        await asyncio.sleep(0.05)
        try:
            opening = asyncio.create_task(route.open())     # the reservation waits
            await asyncio.sleep(HOLD_S)
            waited = not opening.done()
            writer.release()
            resp = await opening
            await _drain_body(resp)
            await asyncio.to_thread(note_ask.drain_background)
        finally:
            writer.close()
            done.set()
            await beat
        return gaps, waited

    gaps, waited = asyncio.run(run())
    assert max(gaps) < BOUND_S, (
        f"the loop stalled {max(gaps):.3f}s for every member while a charge waited on auth.db")
    assert waited, "non-vacuity: the reservation never waited on the lock"
    assert route.charged() == 1, "the charge must still land once the lock is released"
    assert note_ask.inflight(UID) == 0


# ── D-H11, statically: no durable-counter call is made ON the loop ────────────

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_MODULES = {
    "api.services.note_ask": "api/services/note_ask.py",
    "api.services.journal_two.note_semantic": "api/services/journal_two/note_semantic.py",
}
_COUNTER = "api.services.daily_counters"


def _counter_reaching(module_path) -> set:
    """The module's top-level functions that reach `daily_counters`, DERIVED
    from its own AST to a fixed point -- a counter-reaching helper added later
    is covered the day it lands, and nothing here is a typed list."""
    tree = ast.parse((_ROOT / module_path).read_text(encoding="utf-8"))
    funcs = {n.name: n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    uses = {}
    for name, fn in funcs.items():
        names = set()
        for node in ast.walk(fn):
            if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) \
                    and node.value.id == "daily_counters":
                names.add("<counter>")
            elif isinstance(node, ast.Name) and node.id in funcs:
                names.add(node.id)
        uses[name] = names
    reach = {n for n, u in uses.items() if "<counter>" in u}
    while True:
        more = {n for n, u in uses.items() if n not in reach and u & reach}
        if not more:
            return reach
        reach |= more


def _counter_api() -> dict:
    api = {mod: _counter_reaching(path) for mod, path in _MODULES.items()}
    tree = ast.parse((_ROOT / "api/services/daily_counters.py").read_text(encoding="utf-8"))
    api[_COUNTER] = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
    return api


def _aliases(tree):
    """(local module name -> module, local function name -> (module, name)),
    from every import in the file, function-level imports included."""
    mods, fns = {}, {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            for a in node.names:
                full = f"{node.module}.{a.name}"
                local = a.asname or a.name
                if full in _MODULES or full == _COUNTER:
                    mods[local] = full
                elif node.module in _MODULES or node.module == _COUNTER:
                    fns[local] = (node.module, a.name)
        elif isinstance(node, ast.Import):
            for a in node.names:
                if a.name in _MODULES or a.name == _COUNTER:
                    mods[a.asname or a.name] = a.name
    return mods, fns


def _scan_api():
    """Every reference to a counter-reaching function anywhere in api/, with
    the kind of the function it sits in and whether it is CALLED there."""
    api = _counter_api()
    found = []
    for path in sorted((_ROOT / "api").rglob("*.py")):
        rel = path.relative_to(_ROOT).as_posix()
        if rel in _MODULES.values() or rel == "api/services/daily_counters.py":
            continue
        src = path.read_text(encoding="utf-8", errors="replace")
        if "note_ask" not in src and "note_semantic" not in src and "daily_counters" not in src:
            continue
        tree = ast.parse(src)
        mods, fns = _aliases(tree)

        def target(node, mods=mods, fns=fns):
            if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) \
                    and node.value.id in mods and node.attr in api[mods[node.value.id]]:
                return node.attr
            if isinstance(node, ast.Name) and node.id in fns \
                    and fns[node.id][1] in api[fns[node.id][0]]:
                return fns[node.id][1]
            return None

        class V(ast.NodeVisitor):
            def __init__(self):
                self.stack = []

            def _fn(self, node, kind):
                self.stack.append((node.name, kind))
                self.generic_visit(node)
                self.stack.pop()

            def visit_FunctionDef(self, node):
                self._fn(node, "sync")

            def visit_AsyncFunctionDef(self, node):
                self._fn(node, "async")

            def visit_Call(self, node):
                called = target(node.func)
                if called and self.stack:
                    found.append((rel, *self.stack[-1], called, "call"))
                for arg in [*node.args, *(k.value for k in node.keywords)]:
                    ref = target(arg)
                    if ref and self.stack:
                        found.append((rel, *self.stack[-1], ref, "passed"))
                self.generic_visit(node)

        V().visit(tree)
    return api, found


def test_no_durable_counter_call_runs_inside_an_async_def():
    """Every counter-reaching call made from an `async def` in api/ is HANDED
    to a thread (`run_in_threadpool(fn, ...)`, `functools.partial(fn, ...)` into
    `StreamCharge`), never called there. The refund's own door (`close()` ->
    `run_in_background`) is railed behaviourally above; this rail covers every
    other site, the reservations included."""
    api, found = _scan_api()
    # the derivation is not vacuous: it reaches the functions the routes use
    assert {"reserve_ask", "refund_ask", "reserve_writing_help", "refund_writing_help",
            "shared_cap_reached"} <= api["api.services.note_ask"]
    assert "append_meaning_hits" in api["api.services.journal_two.note_semantic"]

    on_loop = [f for f in found if f[2] == "async" and f[4] == "call"]
    assert on_loop == [], f"a durable-counter call made ON the event loop: {on_loop}"

    # non-vacuity: the scan SEES the handed-off sites it exists to protect
    passed = {(f[0], f[1], f[3]) for f in found if f[2] == "async" and f[4] == "passed"}
    wh, j2 = "api/routers/notebook_writing_help.py", "api/routers/journal_two.py"
    assert {(wh, "writing_help_stream", "reserve_writing_help"),
            (wh, "writing_help_stream", "shared_cap_reached"),
            (wh, "writing_help_stream", "refund_writing_help"),
            (j2, "_ask_stream", "reserve_ask"),
            (j2, "_ask_stream", "refund_ask")} <= passed, passed
    # D-H6's embed charge: its only caller is a SYNC handler (a pool worker),
    # and the scan sees that call
    calls = {(f[0], f[1], f[2], f[3]) for f in found if f[4] == "call"}
    assert (j2, "list_notes_endpoint", "sync", "append_meaning_hits") in calls, calls
