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

import asyncio
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
