"""`POST /api/screener/backtest` with a `def_id` — the member's OWN definition
replayed through the same door an `ast` goes through, with its hash echoed.

⛔ THE STORE IS PATCHED ON ITS OWN MODULE (`user_definitions.get`), never on the
router — the router resolves it off the module at call time and a `from … import`
would have severed it (`lesson_from_import_severs_a_module_from_its_guards`).
Bars are stubbed exactly as `tests/test_screener_backtest_route.py` stubs them:
store tuples with a YYYYMMDD ts, so `_fmt_sqlite_bars` still runs.
"""
from __future__ import annotations

import datetime
import inspect
import json
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import screener_backtest as bt
from api.services import bars_fetch, bars_sqlite
from api.services import user_definitions as defs
from api.services.screener import query as scr_query
from api.services.screener import saved_screens as scr_saved
from api.services.screener import snapshot_builder

PAID = {"id": "paid1", "role": "member", "plan": "pro"}
DEF_ID = "u_0123456789ab"
WINDOW = {"from": "2024-01-02", "to": "2024-06-28"}


def NUM(v):
    return {"type": "num", "value": v}


def SER(n):
    return {"type": "series", "name": n}


def OP(n, *a):
    return {"type": "op", "name": n, "args": list(a)}


def CALL(n, *a):
    return {"type": "call", "name": n, "args": list(a)}


BAR_TREE = OP(">", SER("close"), CALL("sma", SER("close"), NUM(3)))
SCALAR_TREE = OP(">", SER("rs_rank"), NUM(80))


def row_for(tree, *, rev=2, version=3):
    return {"def_id": DEF_ID, "version": version, "rev": rev,
            "ast_hash": defs.ast_hash(tree) if tree is not SCALAR_TREE else "sha256:" + "0" * 64,
            "definition": {"compute": {"kind": "ast", "ast": tree, "rev": rev}}}


def _date(key: int) -> datetime.date:
    return datetime.date(key // 10_000, (key // 100) % 100, key % 100)


def _minus_a_day(key: int) -> int:
    return _back(key, 1)


def _back(key: int, days: int) -> int:
    d = _date(key) - datetime.timedelta(days=days)
    return d.year * 10_000 + d.month * 100 + d.day


def _store_rows(n=200):
    d0 = datetime.date(2024, 1, 2)
    out = []
    for i in range(n):
        d = d0 + datetime.timedelta(days=i)
        px = 10.0 + i
        out.append((d.year * 10_000 + d.month * 100 + d.day,
                    px, px + 1.0, px - 1.0, px, 1000.0))
    return out


def _client(monkeypatch, *, row=None, owner="paid1", universe=("AAA", "BBB")):
    stored = row if row is not None else row_for(BAR_TREE)

    def get(user_id, def_id, version=None):
        return dict(stored) if (def_id == stored["def_id"] and str(user_id) == owner) else None

    monkeypatch.setattr(defs, "get", get)
    monkeypatch.setattr(snapshot_builder, "_load_universe", lambda: list(universe))
    rows = _store_rows()
    monkeypatch.setattr(bars_sqlite, "get_bars_before",
                        lambda sym, tf, want, to_key: list(rows)[:want])
    app = FastAPI()
    app.include_router(bt.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_receipts():
    from api.services.cache import cache
    cache.delete_prefix("screen_backtest::")
    with bt._INFLIGHT_GUARD:
        bt._INFLIGHT.clear()
    yield
    cache.delete_prefix("screen_backtest::")
    with bt._INFLIGHT_GUARD:
        bt._INFLIGHT.clear()


def test_a_def_id_body_replays_the_MEMBERS_definition_and_echoes_its_hash(monkeypatch):
    client = _client(monkeypatch)
    r = client.post("/api/screener/backtest", json={"def_id": DEF_ID, **WINDOW})
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["backtestable"] is True, body
    assert body["def_hash"] == defs.ast_hash(BAR_TREE)
    assert body["definition"] == {"def_id": DEF_ID, "version": 3, "rev": 2}
    c = body["coverage"]
    assert (c["symbols_tested"] + c["symbols_missing_bars"]
            + c["symbols_no_bars_in_window"] + c["symbols_no_answer_in_window"]
            == c["symbols_requested"] == 2)


def test_a_def_id_of_ANOTHER_member_is_a_404_and_the_control_ast_body_still_answers(monkeypatch):
    client = _client(monkeypatch, owner="someone-else")
    r = client.post("/api/screener/backtest", json={"def_id": DEF_ID, **WINDOW})
    assert r.status_code == 404, r.text[:300]
    assert DEF_ID in r.json()["detail"]
    # CONTROL: the same client, the same door, an `ast` body -> 200 with the hash
    ok = client.post("/api/screener/backtest", json={"ast": BAR_TREE, **WINDOW})
    assert ok.status_code == 200, ok.text[:300]
    assert ok.json()["def_hash"] == defs.ast_hash(BAR_TREE)
    assert "definition" not in ok.json()


def test_a_def_id_whose_tree_reads_a_scalar_REFUSES_BY_NAME_with_a_200(monkeypatch):
    client = _client(monkeypatch, row=row_for(SCALAR_TREE))
    r = client.post("/api/screener/backtest", json={"def_id": DEF_ID, **WINDOW})
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["backtestable"] is False
    assert body["refused"] == "scalar_no_history"
    assert "rs_rank" in body["names"] and "rs_rank" in body["detail"]
    # ⭐ AND THE HASH RIDES ON A REFUSAL TOO — a refusal is an ANSWER, so the
    # consumer still has to be able to tell which definition it is about.
    # ⛔ IT IS THE TREE'S HASH, NOT THE ROW'S COLUMN: this row's stored
    # `ast_hash` is a planted zero string, so a route that echoed the column
    # instead of hashing what it ran would publish a hash for maths nobody did.
    assert body["def_hash"] == defs.ast_hash(SCALAR_TREE)
    assert body["def_hash"] != row_for(SCALAR_TREE)["ast_hash"]


def test_def_id_AND_ast_together_are_refused_as_two_authorities(monkeypatch):
    client = _client(monkeypatch)
    r = client.post("/api/screener/backtest",
                    json={"def_id": DEF_ID, "ast": BAR_TREE, **WINDOW})
    assert r.status_code == 400
    assert "not both" in r.json()["detail"]


def test_a_def_id_with_no_window_gets_the_WIDEST_window_under_the_ceiling_and_says_so(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20240628)
    monkeypatch.setenv("SCREEN_BACKTEST_MAX_CELLS", "800")
    client = _client(monkeypatch)
    r = client.post("/api/screener/backtest", json={"def_id": DEF_ID})
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["window"]["to"] == "2024-06-28"
    wr = body["window_request"]
    assert wr["derived"] is True
    assert wr["cap"] == 800
    assert wr["max_days"] == bt.MAX_DERIVED_WINDOW_DAYS
    assert wr["bound"] == "cap", wr        # here the CAP is the binding bound
    frm = int(body["window"]["from"].replace("-", ""))
    warmup = 3    # sma(close, 3)
    assert 2 * bt.bars_wanted(frm, 20240628, warmup, 20) <= 800
    # ⭐ WIDEST, NOT MERELY FITTING — the assertion the name of this test claims.
    # One calendar day earlier is over the ceiling, so nothing was left on the
    # table (a `fit_window_start` that always returned the floor would pass the
    # line above and fail this one).
    wider = _minus_a_day(frm)
    assert 2 * bt.bars_wanted(wider, 20240628, warmup, 20) > 800
    # ⚠️ THE CLOCK IS READ BEFORE THE DIGEST, NOT INSIDE IT: the same body asked
    # twice in one session is the same job, so a derived window still dedupes.
    assert client.post("/api/screener/backtest",
                       json={"def_id": DEF_ID}).json()["job"] == body["job"]
    # CONTROL: an explicit window is NOT derived and is not annotated
    explicit = client.post("/api/screener/backtest", json={"def_id": DEF_ID, **WINDOW}).json()
    assert "window_request" not in explicit
    assert explicit["window"] == {"from": "2024-01-02", "to": "2024-06-28"}


def test_a_malformed_def_id_is_refused_by_the_STORES_OWN_guard_and_not_a_500(monkeypatch):
    """⛔ THE NAMESPACE RULE HAS ONE OWNER (`user_definitions._check_def_id`) and
    this door does not restate it — it lets the store refuse and turns that into
    a 400. So `defs.get` is deliberately NOT stubbed here: a second regex on this
    side would be the second authority, and it would drift the day the id shape
    moves. Nothing is read — the store checks the id before it opens a
    connection — so this asks no database anything."""
    monkeypatch.setattr(snapshot_builder, "_load_universe", lambda: ["AAA"])
    app = FastAPI()
    app.include_router(bt.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    client = TestClient(app)
    r = client.post("/api/screener/backtest", json={"def_id": "not-an-id", **WINDOW})
    assert r.status_code == 400, r.text[:300]
    assert "not-an-id" in r.json()["detail"] and "u_" in r.json()["detail"]


def test_a_hand_posted_ast_that_is_NOT_CANONICAL_gets_a_NULL_def_hash(monkeypatch):
    """⭐ `def_hash` IS THE MATHS THAT RAN, and a tree the hasher cannot canonicalise
    has no astHash to state — so the key says `null` rather than a guess, an empty
    string, or a 500. The store never hands one of these back; a hand-posted `ast`
    can be one.

    CONTROL: the same tree WITHOUT the stray key hashes, so the null above is the
    canonicaliser refusing and not this door failing to hash anything."""
    client = _client(monkeypatch)
    odd = OP(">", SER("close"), {"type": "num", "value": 0, "note": "not canonical"})
    r = client.post("/api/screener/backtest", json={"ast": odd, **WINDOW})
    assert r.status_code == 200, r.text[:300]
    assert r.json()["def_hash"] is None, r.json()["def_hash"]
    ok = client.post("/api/screener/backtest",
                     json={"ast": OP(">", SER("close"), NUM(0)), **WINDOW})
    assert ok.status_code == 200, ok.text[:300]
    assert ok.json()["def_hash"] == defs.ast_hash(OP(">", SER("close"), NUM(0)))


def test_fit_window_start_is_the_widest_span_under_the_cap_and_None_below_the_floor():
    end = 20240628
    start = bt.fit_window_start(end, symbols=100, warmup=50, max_horizon=20, cap=30_000)
    assert start is not None
    assert 100 * bt.bars_wanted(start, end, 50, 20) <= 30_000
    assert 100 * bt.bars_wanted(_minus_a_day(start), end, 50, 20) > 30_000
    # CONTROL: a ceiling even the floor window cannot fit is None, not a guess
    assert bt.fit_window_start(end, symbols=100, warmup=50, max_horizon=20, cap=10) is None


def test_the_DAY_CEILING_is_an_independent_bound_and_the_payload_names_it(monkeypatch):
    """🔴 THE SENTENCE A MEMBER READS HAS TO BE TRUE OF ITS OWN CASE. For a narrow
    saved screen — the case the Evidence tab exists to serve — the cap is nowhere
    near binding and the window is decided by `MAX_DERIVED_WINDOW_DAYS`. A
    `window_request` that named only the cap told that member the wrong reason,
    printed a ceiling 20× the bars actually used, and would not have moved a day
    if that ceiling were raised.

    ⛔ AND THE OTHER CONSTANT'S OLD DEFENCE ("past which MAX_BARS_PER_SYMBOL caps
    the read anyway") IS MEASURED FALSE HERE: at the day ceiling a symbol reads
    well under that clamp, and the crossover is more than twice the ceiling away —
    so the day ceiling is an independent, disclosed bound, not a redundant one."""
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd",
                        lambda now=None: 20240628)
    client = _client(monkeypatch)                     # 2 symbols, the DEFAULT cap
    body = client.post("/api/screener/backtest", json={"def_id": DEF_ID}).json()
    wr = body["window_request"]
    assert wr["derived"] is True
    assert wr["cap"] == bt.DEFAULT_MAX_CELLS
    assert wr["max_days"] == bt.MAX_DERIVED_WINDOW_DAYS
    assert wr["bound"] == "max_days", wr
    for name in ("SCREEN_BACKTEST_MAX_CELLS", "MAX_DERIVED_WINDOW_DAYS"):
        assert name in wr["rule"], (name, wr["rule"])

    frm = int(body["window"]["from"].replace("-", ""))
    assert (_date(20240628) - _date(frm)).days == bt.MAX_DERIVED_WINDOW_DAYS
    want = bt.bars_wanted(frm, 20240628, 3, 20)       # sma(close, 3), h=20
    # the cap did not decide this window, and it is not close to deciding it
    assert 2 * want < wr["cap"] // 10, (2 * want, wr["cap"])
    # ...and neither did MAX_BARS_PER_SYMBOL: it does not bind at the ceiling,
    # and the span where it WOULD is more than twice as far out. Derived from
    # `bars_wanted` itself rather than typed beside it.
    assert want < bt.MAX_BARS_PER_SYMBOL
    crossover = next(d for d in range(bt.MAX_DERIVED_WINDOW_DAYS, 20_001)
                     if bt.bars_wanted(_back(20240628, d), 20240628, 3, 20)
                     >= bt.MAX_BARS_PER_SYMBOL)
    assert crossover - bt.MAX_DERIVED_WINDOW_DAYS > 3_000, crossover
    # ⛔ AND THE COMMENT QUOTES THE MEASURED FIGURE, NOT A REMEMBERED ONE. The
    # constant's docstring states this number; it is derived here and looked up
    # there, so the day it stops being true it stops being green.
    assert f"{crossover:,} days" in inspect.getsource(bt), crossover


def test_a_BACKGROUND_post_carries_the_request_facts_the_POLL_cannot_recover(monkeypatch):
    """⭐ BACKGROUND IS THE EVIDENCE TAB'S OWN PATH, so the FIRST answer it ever
    sees must say which definition it is about. The tree is in hand on the POST,
    so the request-facts ride on the queued acknowledgement.

    ⚠️ THE POLL CANNOT, AND THAT IS WHY THE CLAIM IS SCOPED. A job id is a digest
    of the request and holds no tree, so a `running` / `unknown` poll has nothing
    to derive a hash from — the CONTROL below states that rather than leaving a
    consumer to discover it."""
    client = _client(monkeypatch)
    q = client.post("/api/screener/backtest?background=1",
                    json={"def_id": DEF_ID, **WINDOW})
    assert q.status_code == 200, q.text[:300]
    qb = q.json()
    assert qb["status"] in ("running", "ready"), qb
    assert qb["def_hash"] == defs.ast_hash(BAR_TREE)
    assert qb["definition"] == {"def_id": DEF_ID, "version": 3, "rev": 2}

    # drain the pool INSIDE the fixture's stubs, so no worker outlives them
    for _ in range(500):
        polled = client.get(f"/api/screener/backtest/{qb['job']}").json()
        if polled.get("status") != "running":
            break
        threading.Event().wait(0.02)
    assert polled["status"] == "ready", polled
    assert polled["def_hash"] == defs.ast_hash(BAR_TREE)      # the READY receipt has it

    # CONTROL: a job still on the pool answers `running` and carries no hash.
    with bt._INFLIGHT_GUARD:
        bt._INFLIGHT.add("still-going")
    try:
        assert bt.status_for("still-going") == {"job": "still-going", "status": "running"}
    finally:
        with bt._INFLIGHT_GUARD:
            bt._INFLIGHT.discard("still-going")


@pytest.mark.parametrize("extra", [
    {"universe": "not-an-id"},          # would have answered "saved screen id"
    {"horizons": [0]},                  # would have answered "outside 1..250"
    {"universe": 7},                    # would have answered 404 — a STATUS change
    {},                                 # CONTROL: the defect alone
])
def test_a_body_with_TWO_defects_still_answers_the_WINDOW_it_always_answered(monkeypatch, extra):
    """⛔ A ONE-DEFECT FIXTURE CANNOT SEE PRECEDENCE. Every row of the shipped
    refusal parametrisation carries exactly ONE bad field, so it stays green under
    any reordering of the validators — and this task reordered them. These bodies
    carry TWO, so the answer names which validator ran first.

    Measured on the reordered door before this fix: the same three bodies answered
    `saved screen id`, `outside 1..250` and a **404**. The window a member typed is
    parsed before a universe that has to be BUILT, which is where it was."""
    monkeypatch.setattr(scr_saved, "get", lambda sid, user_id: None)
    client = _client(monkeypatch)
    r = client.post("/api/screener/backtest",
                    json={"ast": BAR_TREE, "from": "not-a-date",
                          "to": "2024-06-28", **extra})
    assert r.status_code == 400, (extra, r.status_code, r.text[:200])
    assert "`from`" in r.json()["detail"], (extra, r.json()["detail"])


def test_the_CONTROL_each_of_those_defects_ALONE_still_names_ITSELF(monkeypatch):
    """...so the rows above are the window winning a race it should win, and not
    this door answering `from` to everything it is handed."""
    monkeypatch.setattr(scr_saved, "get", lambda sid, user_id: None)
    client = _client(monkeypatch)
    for extra, needle, code in (({"universe": "not-an-id"}, "saved screen id", 400),
                                ({"horizons": [0]}, "outside 1..", 400),
                                ({"universe": 7}, "no saved screen", 404)):
        r = client.post("/api/screener/backtest",
                        json={"ast": BAR_TREE, **WINDOW, **extra})
        assert r.status_code == code, (extra, r.status_code, r.text[:200])
        assert needle in r.json()["detail"], (extra, r.json()["detail"])


def test_an_EMPTY_universe_does_not_outrank_a_window_the_member_typed_wrong(monkeypatch):
    """The same precedence, one box over: on a pod whose snapshot is empty the
    reordered door answered **503** to a body whose date was simply mistyped."""
    client = _client(monkeypatch, universe=())
    bad = client.post("/api/screener/backtest",
                      json={"ast": BAR_TREE, "from": "not-a-date", "to": "2024-06-28"})
    assert bad.status_code == 400, bad.text[:200]
    assert "`from`" in bad.json()["detail"]
    # CONTROL: with a window it can parse, the empty universe IS the answer
    ok = client.post("/api/screener/backtest", json={"ast": BAR_TREE, **WINDOW})
    assert ok.status_code == 503, ok.text[:200]


# ─── the SHARED cache entry, and who it may name ─────────────────────────────
#
# ⛔⛔ `job_id` IS CONTENT-KEYED AND DOES NOT INCLUDE THE CALLER — deliberately, so
# two members whose maths is identical cost the pod ONE sweep. That is the whole
# point of the digest, and widening the key to "fix" what follows would silently
# make identical work cost twice. The consequence is that everything stored under
# a job id is served to WHOEVER polls it, so a per-caller fact in there is a
# cross-member disclosure: `definition{def_id, version, rev}` describes a saved
# row belonging to the member who happened to run it first.
#
# The controller's ruling (2026-08-26): strip the per-caller fields from the
# SHARED entry and keep `def_hash`, which is derived from the maths and therefore
# identical by construction. A surface that wants to say WHICH of the member's
# definitions produced a result echoes the `def_id` it asked with — it already
# holds it, and this route hands it back on that member's OWN answer.

OTHER = {"id": "paid2", "role": "member", "plan": "pro"}
OTHER_DEF_ID = "u_fedcba987654"


def _two_members(monkeypatch, universe=("AAA", "BBB")):
    """Two clients, two members, ONE tree — so the content key COLLIDES.

    ⛔ THE COLLISION IS THE TEST. Each member's own definition carries the SAME
    `compute.ast` under a DIFFERENT `def_id`/`version`/`rev`, which is exactly the
    "two members ran the same starter screen" case, and the assertion below that
    the two jobs are the same id is what stops this file passing vacuously.
    """
    rows = {
        ("paid1", DEF_ID): row_for(BAR_TREE, rev=2, version=3),
        ("paid2", OTHER_DEF_ID): {
            **row_for(BAR_TREE, rev=7, version=9), "def_id": OTHER_DEF_ID},
    }

    def get(user_id, def_id, version=None):
        row = rows.get((str(user_id), def_id))
        return dict(row) if row else None

    monkeypatch.setattr(defs, "get", get)
    monkeypatch.setattr(snapshot_builder, "_load_universe", lambda: list(universe))
    bars = _store_rows()
    monkeypatch.setattr(bars_sqlite, "get_bars_before",
                        lambda sym, tf, want, to_key: list(bars)[:want])

    def client(user):
        app = FastAPI()
        app.include_router(bt.router)
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        return TestClient(app)

    return client(PAID), client(OTHER)


#: Two members' OWN saved screens, each private to its owner, that resolve to the
#: SAME symbol list — so a backtest over either collides on one content key.
#: ⛔ `screen_name` IS FREE TEXT A MEMBER TYPED, which is why it is worse than a
#: `def_id`: there is no shape it has to have and no way to un-read it.
A_SCREEN, B_SCREEN = 7, 12
A_SCREEN_NAME = "A's PRIVATE momentum list (secret)"
B_SCREEN_NAME = "B's own list"


def _two_members_with_saved_screens(monkeypatch, universe=("AAA", "BBB")):
    """The same collision, reached through the SAVED-SCREEN door instead."""
    screens = {(A_SCREEN, "paid1"): {"name": A_SCREEN_NAME, "spec": {}},
               (B_SCREEN, "paid2"): {"name": B_SCREEN_NAME, "spec": {}}}
    monkeypatch.setattr(scr_saved, "get",
                        lambda sid, user_id: screens.get((int(sid), str(user_id))))
    monkeypatch.setattr(
        scr_query, "run_scan",
        lambda spec: {"rows": [{"ticker": t} for t in universe],
                      "total": len(universe)})
    return _two_members(monkeypatch, universe=universe)


def test_a_SECOND_member_is_not_told_the_FIRSTS_saved_screen_nor_MISINFORMED_about_their_own(monkeypatch):
    """⛔⛔ THE OLDER SHAPE OF THE SAME DEFECT, CLOSED. `universe_request` rode in
    the SHARED entry carrying `screen_id` and `screen_name` — a private id and a
    string a member typed. Two failures in one, and the second is the one that is
    easy to miss: B is not merely SHOWN A's screen, B's own `screen_id` is
    REPLACED by A's, so B is misinformed about their own request.
    """
    a_client, b_client = _two_members_with_saved_screens(monkeypatch)

    a = a_client.post("/api/screener/backtest",
                      json={"def_id": DEF_ID, "universe": A_SCREEN, **WINDOW}).json()
    assert a["universe_request"]["screen_id"] == A_SCREEN, a["universe_request"]
    assert a["universe_request"]["screen_name"] == A_SCREEN_NAME

    b = b_client.post("/api/screener/backtest",
                      json={"def_id": OTHER_DEF_ID, "universe": B_SCREEN, **WINDOW}).json()

    # ⛔ THE NON-VACUITY CONTROL: one content key, two members, two screens.
    assert a["job"] == b["job"], (a["job"], b["job"])

    # B is named by B's own request, and A's private half is nowhere in it
    assert b["universe_request"]["screen_id"] == B_SCREEN, b["universe_request"]
    assert b["universe_request"]["screen_name"] == B_SCREEN_NAME
    assert A_SCREEN_NAME not in json.dumps(b), b
    # ...including the NUMERIC id, which is the half the first report understated
    assert f'"screen_id": {A_SCREEN}' not in json.dumps(b), b["universe_request"]

    # the shared half survives untouched — it is the honest-none disclosure
    assert b["universe_request"]["kind"] == "saved-screen"
    assert b["universe_request"]["truncated"] is False


def test_the_STORED_entry_carries_NEITHER_definition_NOR_screen_identity(monkeypatch):
    """The entry AT REST, read past the serve door — the raw cache, not `_stored`."""
    a_client, b_client = _two_members_with_saved_screens(monkeypatch)
    a = a_client.post("/api/screener/backtest",
                      json={"def_id": DEF_ID, "universe": A_SCREEN, **WINDOW}).json()

    raw = bt._cache().get(bt._receipt_key(a["job"]))
    assert isinstance(raw, dict), "nothing was cached — this test would pass vacuously"
    assert raw["def_hash"] == defs.ast_hash(BAR_TREE)     # CONTROL: it IS the receipt
    assert "definition" not in raw, raw
    assert set(raw["universe_request"]) == {"kind", "matched", "truncated"}, raw["universe_request"]
    assert A_SCREEN_NAME not in json.dumps(raw), raw

    # and the POLL, which is all a background caller ever reads back
    polled = b_client.get(f"/api/screener/backtest/{a['job']}").json()
    assert polled["status"] == "ready", polled
    assert A_SCREEN_NAME not in json.dumps(polled), polled
    assert "screen_id" not in json.dumps(polled), polled


def test_a_STALE_entry_written_before_the_split_cannot_leak_through_the_read_door(monkeypatch):
    """⛔ THE MERGE IS NOT THE GUARANTEE — THE READ DOOR IS.

    `{**cached, **mine}` can only OVERWRITE, so a caller whose own `mine` is empty
    (an `ast` body, no saved screen) merging over an entry written by an older pod
    would receive that entry's per-caller fields verbatim. The receipt cache is
    in-process and resets on redeploy, so this is unreachable today — which is
    exactly why it needs a rail rather than a sentence. The entry is planted
    directly, past `_record`, because `_record` is the half that is already clean.
    """
    a_client, _ = _two_members_with_saved_screens(monkeypatch)
    probe = a_client.post("/api/screener/backtest",
                          json={"def_id": DEF_ID, "universe": A_SCREEN, **WINDOW}).json()
    job = probe["job"]

    stale = {**bt._cache().get(bt._receipt_key(job)),
             "definition": {"def_id": DEF_ID, "version": 3, "rev": 2},
             "window_request": {"derived": True, "rule": "...", "bound": "cap",
                                "cap": 1, "max_days": 1},
             "universe_request": {"kind": "saved-screen", "screen_id": A_SCREEN,
                                  "screen_name": A_SCREEN_NAME, "matched": 2,
                                  "truncated": False}}
    bt._cache().set(bt._receipt_key(job), stale, bt.RECEIPT_TTL)
    assert "definition" in bt._cache().get(bt._receipt_key(job)), "the plant did not land"

    served = bt.status_for(job)
    assert served["status"] == "ready", served
    assert served["def_hash"] == defs.ast_hash(BAR_TREE)   # CONTROL: still the receipt
    assert "definition" not in served, served
    assert "window_request" not in served, served
    assert A_SCREEN_NAME not in json.dumps(served), served
    assert served["universe_request"]["kind"] == "saved-screen"   # the shared half stays


def test_a_window_a_member_TYPED_is_never_annotated_with_another_members_DERIVATION(monkeypatch):
    """⚠️ PROVENANCE, NOT IDENTITY, AND CLOSED BY THE SAME SPLIT. `window_request`
    describes how THIS request's window was arrived at. Member A omitting the
    window and member B typing exactly the dates A's derivation produced land on
    one content key, and B was being told `derived: true` about a window B typed
    out by hand."""
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd",
                        lambda now=None: 20240628)
    a_client, b_client = _two_members(monkeypatch)

    a = a_client.post("/api/screener/backtest", json={"def_id": DEF_ID}).json()
    assert a["window_request"]["derived"] is True, a          # CONTROL: A really derived
    typed = {"from": a["window"]["from"], "to": a["window"]["to"]}

    b = b_client.post("/api/screener/backtest",
                      json={"def_id": OTHER_DEF_ID, **typed}).json()
    assert b["job"] == a["job"], (b["job"], a["job"])         # the collision, again
    assert "window_request" not in b, b

    # ⛔ AND THE ENTRY AT REST CARRIES NONE OF THEM — the set is READ off the
    # module's own declaration, never retyped here. The read door subtracts on the
    # way out, so a payload assertion alone stays green while the WRITE side quietly
    # files a per-caller fact in the shared entry; this is the half that sees it.
    raw = bt._cache().get(bt._receipt_key(a["job"]))
    assert isinstance(raw, dict), "nothing was cached — this would pass vacuously"
    assert raw["def_hash"] == defs.ast_hash(BAR_TREE)          # CONTROL: it IS the receipt
    assert bt.PER_CALLER_KEYS, "the module declares no per-caller keys — this probe is vacuous"
    assert [k for k in bt.PER_CALLER_KEYS if k in raw] == [], raw.keys()


def test_a_SECOND_member_on_the_same_content_key_gets_NO_TRACE_of_the_firsts_definition(monkeypatch):
    """⛔ THE CROSS-MEMBER RAIL. One caller cannot fail for this reason.

    Member A runs their saved definition; member B runs THEIR OWN definition of
    the same maths and lands on A's cached receipt. B must be told `def_hash` (the
    maths, shared by construction) and B's OWN `def_id`/`version`/`rev` — never
    A's.
    """
    a_client, b_client = _two_members(monkeypatch)

    a = a_client.post("/api/screener/backtest", json={"def_id": DEF_ID, **WINDOW})
    assert a.status_code == 200, a.text[:300]
    a_body = a.json()
    assert a_body["definition"] == {"def_id": DEF_ID, "version": 3, "rev": 2}

    b = b_client.post("/api/screener/backtest", json={"def_id": OTHER_DEF_ID, **WINDOW})
    assert b.status_code == 200, b.text[:300]
    b_body = b.json()

    # ⛔ THE NON-VACUITY CONTROL: they really did collide on ONE cache entry. If
    # the ids differed, B would have run their own backtest and this file would
    # be asserting nothing about sharing at all.
    assert a_body["job"] == b_body["job"], (a_body["job"], b_body["job"])

    # the maths is shared, so the hash is — that is the field the ruling KEEPS
    assert b_body["def_hash"] == a_body["def_hash"] == defs.ast_hash(BAR_TREE)

    # ⛔ AND B IS NAMED BY B'S OWN ROW, with no residue of A's anywhere in the
    # payload — not in `definition`, not in any other key a later edit adds.
    assert b_body["definition"] == {"def_id": OTHER_DEF_ID, "version": 9, "rev": 7}
    assert DEF_ID not in json.dumps(b_body), b_body


def test_the_STORED_entry_itself_carries_no_per_caller_identity(monkeypatch):
    """⛔ THE PIN IS ON THE ENTRY, NOT ON ONE RESPONSE SHAPE.

    The route merges the caller's own `definition` onto its own answer, so a
    payload assertion alone would still pass if the cache held A's row and the
    merge simply overwrote it — and the POLL (`GET /api/screener/backtest/{job}`)
    has no caller facts to merge, so it would hand A's row straight to B. This
    reads the cache entry the poll serves.
    """
    a_client, b_client = _two_members(monkeypatch)
    a_body = a_client.post("/api/screener/backtest",
                           json={"def_id": DEF_ID, **WINDOW}).json()
    job = a_body["job"]

    stored = bt._stored(job)
    assert stored is not None, "nothing was cached — this test would pass vacuously"
    assert stored["def_hash"] == defs.ast_hash(BAR_TREE)   # CONTROL: the entry IS the receipt
    assert "definition" not in stored, stored
    assert DEF_ID not in json.dumps(stored), stored

    # and the poll, which is the only thing a background caller ever reads back
    polled = b_client.get(f"/api/screener/backtest/{job}").json()
    assert polled["status"] == "ready", polled
    assert DEF_ID not in json.dumps(polled), polled


def test_a_BACKGROUND_second_member_is_not_named_by_the_firsts_queued_receipt(monkeypatch):
    """The Evidence tab's own path: `?background=1`, then poll. A cached receipt
    handed back through `_submit` is the cache's own object, and B's ack must
    carry B's row and none of A's."""
    a_client, b_client = _two_members(monkeypatch)
    a_body = a_client.post("/api/screener/backtest",
                           json={"def_id": DEF_ID, **WINDOW}).json()

    b_ack = b_client.post("/api/screener/backtest?background=1",
                          json={"def_id": OTHER_DEF_ID, **WINDOW}).json()
    assert b_ack["job"] == a_body["job"], (b_ack, a_body["job"])
    assert b_ack["status"] == "ready"                     # A's receipt was already cached
    assert b_ack["definition"] == {"def_id": OTHER_DEF_ID, "version": 9, "rev": 7}
    assert b_ack["def_hash"] == defs.ast_hash(BAR_TREE)
    assert DEF_ID not in json.dumps(b_ack), b_ack
