"""W5-T15 rails: `POST /api/screener/backtest` replays a stored RUNTIME document through the
runtime service's client (profile `backtest`) instead of the 400 it answered before.

NO NETWORK: the client talks to `tests/fakes/pine_runtime_fake.PineRuntimeFake`. The store and
the bars are stubbed exactly as `tests/test_screener_backtest_def_id.py` stubs them (store tuples
with a YYYYMMDD ts, so `_fmt_sqlite_bars` still runs).

The refusal mapping is design 3.7's backtest column: 503 = the service cannot be reached or is
busy, 500 = an integrity bug, 409 = every other guard (stage, kill, verdict, engine mismatch, a
run-wide or per-output refusal). NONE of them is a 400, and none is a 200 receipt that reads as
"the screen never matched".
"""
from __future__ import annotations

import base64
import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import screener_backtest as bt
from api.services import bars_sqlite
from api.services import pine_runtime_client as prc
from api.services import pine_runtime_codec as codec
from api.services import runtime_definitions as rd
from api.services import user_definitions as defs
from api.services.screener import snapshot_builder
from tests.fakes.pine_runtime_fake import FIXTURE_IDENTITY, FIXTURE_SECRET, PineRuntimeFake

PAID = {"id": "paid1", "role": "member", "plan": "pro"}
DEF_ID = "u_0123456789ab"
WINDOW = {"from": "2024-01-02", "to": "2024-06-28"}
T0 = 1_762_200_000
SOURCE = "//@version=6\nindicator('x')\nplot(close > close[1] ? 1 : 0)"


def runtime_row(outputs=None, version=3):
    outputs = outputs if outputs is not None else {"sig": 0}
    return {"def_id": DEF_ID, "version": version, "user_id": "paid1",
            "definition": {"compute": {"kind": "runtime", "source": SOURCE, "outputs": outputs},
                           "plots": [{"key": k} for k in outputs]}}


def rising_script(cols):
    """sig: 1 on every bar after the first (a rising tape); na on the first. other: always 1."""
    c = cols["c"]
    return {"sig": [float("nan")] + [1.0] * (len(c) - 1), "other": [1.0] * len(c)}


def _store_rows(n=200):
    d0 = datetime.date(2024, 1, 2)
    out = []
    for i in range(n):
        d = d0 + datetime.timedelta(days=i)
        px = 10.0 + i
        out.append((d.year * 10_000 + d.month * 100 + d.day, px, px + 1.0, px - 1.0, px, 1000.0))
    return out


class World:
    """Everything the door asks, faked at its own module; each question records that it was asked."""

    def __init__(self):
        self.fake = PineRuntimeFake(script=rising_script)
        self.refusal = None
        self.verdict = None
        self.asked = []
        self.client_made = 0

    def server_lane_refusal(self, row, *, lane):
        self.asked.append(lane)
        return self.refusal

    def engine_withheld_reason(self, row, current=None):
        return self.verdict

    def make_client(self):
        self.client_made += 1
        return prc.PineRuntimeClient(url="http://pine-runtime.test", secret=FIXTURE_SECRET,
                                     identity=FIXTURE_IDENTITY, transport=self.fake, clock=lambda: T0)


@pytest.fixture(autouse=True)
def _fresh():
    prc._forget_signing_times()
    from api.services.cache import cache
    cache.delete_prefix("screen_backtest::")
    with bt._INFLIGHT_GUARD:
        bt._INFLIGHT.clear()
    yield
    cache.delete_prefix("screen_backtest::")
    with bt._INFLIGHT_GUARD:
        bt._INFLIGHT.clear()
    prc._forget_signing_times()


def _app(monkeypatch, w, *, row=None, universe=("AAA", "BBB"), fake_admission=True):
    stored = row if row is not None else runtime_row()

    def get(user_id, def_id, version=None):
        return dict(stored) if (def_id == stored["def_id"] and str(user_id) == "paid1") else None

    monkeypatch.setattr(defs, "get", get)
    monkeypatch.setattr(defs, "engine_withheld_reason", w.engine_withheld_reason)
    if fake_admission:
        monkeypatch.setattr(rd, "server_lane_refusal", w.server_lane_refusal)
    monkeypatch.setattr(bt, "_runtime_client", w.make_client)
    monkeypatch.setattr(bt, "RUNTIME_HISTORY_LEAD", 0)
    monkeypatch.setattr(snapshot_builder, "_load_universe", lambda: list(universe))
    rows = _store_rows()
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda sym, tf, want, to_key: list(rows)[:want])
    app = FastAPI()
    app.include_router(bt.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    return TestClient(app)


def _post(client, **extra):
    return client.post("/api/screener/backtest", json={"def_id": DEF_ID, **WINDOW, **extra})


@pytest.fixture
def w():
    return World()


# --- the replay ---------------------------------------------------------------------------------

def test_a_runtime_document_replays_through_the_client_and_is_not_a_400(monkeypatch, w):
    r = _post(_app(monkeypatch, w))
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["backtestable"] is True, body
    assert body["def_hash"] == rd.handle(runtime_row()["definition"])
    assert body["definition"]["def_id"] == DEF_ID
    assert [c["profile"] for c in w.fake.calls] == ["backtest"]
    assert {j["job"] for c in w.fake.calls for j in c["jobs"]} == {"AAA", "BBB"}
    # the service is asked for the one plot, and the admission was asked for lane `backtest`
    assert all(j["want"] == ["sig"] for c in w.fake.calls for j in c["jobs"])
    assert set(w.asked) == {"backtest"}
    # an na bar (the script's first) is a hole, never an answered "no"
    assert body["coverage"]["bars_not_computable"] >= 2
    assert body["coverage"]["symbols_tested"] == 2


def test_the_daily_bar_time_reaches_the_service_as_unix_seconds_not_a_date_key(monkeypatch, w):
    _post(_app(monkeypatch, w))
    job = w.fake.calls[0]["jobs"][0]
    t = codec.decode_column(base64.b64decode(job["bars"]["t"]))
    # 2024-01-02 09:30 EST = 14:30 UTC; NOT UTC midnight (1704153600), NOT the date key
    assert t[0] == 1704205800.0 and t[1] == 1704205800.0 + 86400.0, t[:3]
    assert t[0] != 20240102.0


def test_every_spelling_of_a_daily_session_is_the_0930_ET_open_across_dst_and_winter():
    # (date, unix seconds of 09:30 America/New_York): winter, the day before the 2024-03-10
    # spring-forward, the day after it, and the day after the 2024-11-03 fall-back
    cases = [("2024-01-02", 1704205800.0), ("2024-03-08", 1709908200.0),
             ("2024-03-11", 1710163800.0), ("2024-11-04", 1730730600.0)]
    for iso, want in cases:
        key = int(iso.replace("-", ""))
        assert bt._epoch_seconds(iso) == want, iso
        assert bt._epoch_seconds(key) == want, key
        assert bt._epoch_seconds(iso + "T00:00:00Z") == want, iso
    # the 09:30 open moves 1h in UTC across the change, so one fixed offset cannot pass both
    assert (1710163800.0 - 1709908200.0) == 3 * 86400 - 3600
    # not guessed: already epoch seconds, a float, a bool and rubbish pass through unchanged
    for raw in (1_704_153_600, 1_704_153_600.0, True, "soon", None, "2024-13-45"):
        assert bt._epoch_seconds(raw) is raw


def test_a_tape_with_a_non_date_time_is_refused_by_the_clients_integrity_guard_not_invented(monkeypatch, w):
    client = _app(monkeypatch, w)
    rows = [("junk", 1.0, 2.0, 1.0, 1.5, 10.0)] * 3
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda *a: list(rows))
    monkeypatch.setattr(bt.bars_fetch, "_fmt_sqlite_bars",
                        lambda rows, tf, sym=None: [{"t": "junk", "o": 1, "h": 2, "l": 1, "c": 1.5, "v": 1}] * 3)
    r = _post(client)
    assert r.status_code == 500 and prc.INTEGRITY in r.json()["detail"], r.text
    assert w.fake.calls == []


# --- the refusals: 409 / 503 / 500, never 400, never a 200 ---------------------------------------

def test_with_the_server_stage_unset_nothing_reaches_the_service(monkeypatch, w):
    """THE REAL admission chain, not the fake: past the kill list, the grading and the pane stage,
    an unset PINE_RUNTIME_SERVER_STAGE is `off` and the door answers 409 before any client exists."""
    monkeypatch.delenv(rd.SERVER_STAGE_ENV, raising=False)
    monkeypatch.setattr(rd, "killed", lambda *a: None)
    monkeypatch.setattr(rd, "not_graded", lambda *a, **k: None)
    monkeypatch.setattr(rd, "pane_permitted", lambda *a, **k: True)
    monkeypatch.setattr(rd, "_owner_role", lambda *a: "member")
    client = _app(monkeypatch, w, fake_admission=False)
    for qs in ("", "?background=1"):
        r = client.post("/api/screener/backtest" + qs, json={"def_id": DEF_ID, **WINDOW})
        assert r.status_code == 409, r.text
        assert "runtime:server-stage" in r.json()["detail"]
    assert w.client_made == 0 and w.fake.calls == []
    assert bt._INFLIGHT == set()


@pytest.mark.parametrize("guard,status", [
    ("runtime:killed", 409), ("runtime:not-yet-graded", 409), ("runtime:stage", 409),
    ("runtime:server-stage", 409), ("runtime:server-unavailable", 503)])
def test_an_admission_refusal_answers_its_own_guard_and_sentence_before_any_service_call(monkeypatch, w, guard, status):
    w.refusal = (guard, f"the sentence for {guard}")
    r = _post(_app(monkeypatch, w))
    assert r.status_code == status, r.text
    assert r.json()["detail"] == f"{guard}: the sentence for {guard}"
    assert w.client_made == 0 and w.fake.calls == []


def test_the_stored_verdict_binds_before_any_service_call(monkeypatch, w):
    w.verdict = "engine-refused: today's script engine refuses this script"
    r = _post(_app(monkeypatch, w))
    assert r.status_code == 409 and "engine-refused" in r.json()["detail"], r.text
    assert w.client_made == 0


def test_a_kill_between_chunks_stops_the_run_at_the_next_chunk(monkeypatch, w):
    """Admission is asked before EVERY service request, not once at the door."""
    monkeypatch.setattr(bt, "RUNTIME_BATCH", 1)
    answers = [None, None, ("runtime:killed", "this script is on the server's kill list")]
    monkeypatch.setattr(rd, "server_lane_refusal", lambda row, *, lane: answers.pop(0))
    client = _app(monkeypatch, w, fake_admission=False)
    monkeypatch.setattr(rd, "server_lane_refusal", lambda row, *, lane: answers.pop(0))
    r = _post(client)
    assert r.status_code == 409 and "runtime:killed" in r.json()["detail"], r.text
    assert len(w.fake.calls) == 1            # the first chunk ran; the second never left


@pytest.mark.parametrize("arrange,status,guard", [
    (lambda w: w.fake.script_next.append((429, b"{}")), 503, prc.BUSY),
    (lambda w: w.fake.script_next.append(ConnectionError("down")), 503, prc.UNAVAILABLE),
    (lambda w: setattr(w.fake, "secrets", ["another-secret-entirely-0123456789"]), 503, prc.AUTH),
    (lambda w: w.fake.withhold.update({"AAA": ("runtime:limit", "over the run's budget")}), 409, "runtime:limit"),
    (lambda w: w.fake.refuse_output.update({"sig": ("runtime:output", "this plot is withheld")}), 409, "runtime:output"),
    (lambda w: setattr(w.fake, "identity", {**FIXTURE_IDENTITY, "script_engine": 999}), 409, prc.ENGINE_MISMATCH),
    (lambda w: setattr(w.fake, "tamper", lambda reply: {**reply, "results": [
        {**r, "digest": "0" * 64} for r in reply["results"]]}), 500, prc.INTEGRITY),
])
def test_a_service_refusal_maps_to_503_409_or_500_with_its_sentence_and_never_a_200_or_a_400(
        monkeypatch, w, arrange, status, guard):
    arrange(w)
    r = _post(_app(monkeypatch, w))
    assert r.status_code == status, (r.status_code, r.text[:300])
    assert guard in r.json()["detail"], r.json()


def test_a_missing_service_is_503_through_the_real_admission_not_an_empty_receipt(monkeypatch, w):
    monkeypatch.delenv(rd.SERVICE_URL_ENV, raising=False)
    monkeypatch.setenv(rd.SERVER_STAGE_ENV, "all")
    monkeypatch.setenv(rd.STAGE_ENV, "all")
    monkeypatch.setattr(rd, "killed", lambda *a: None)
    monkeypatch.setattr(rd, "not_graded", lambda *a, **k: None)
    monkeypatch.setattr(rd, "_owner_role", lambda *a: "member")
    r = _post(_app(monkeypatch, w, fake_admission=False))
    assert r.status_code == 503 and "runtime:server-unavailable" in r.json()["detail"], r.text
    assert w.fake.calls == []


# --- which plot ------------------------------------------------------------------------------------

def test_several_plots_need_a_named_one_and_a_wrong_name_is_refused_as_409_never_400(monkeypatch, w):
    client = _app(monkeypatch, w, row=runtime_row({"sig": 0, "other": 1}))
    r = _post(client)
    assert r.status_code == 409 and "sig, other".replace("sig, other", "other, sig") in r.json()["detail"]
    assert _post(client, plot="nope").status_code == 409
    ok = _post(client, plot="other")
    assert ok.status_code == 200 and ok.json()["backtestable"] is True
    assert all(j["want"] == ["other"] for c in w.fake.calls for j in c["jobs"])


# --- the background path ---------------------------------------------------------------------------

def test_a_background_replay_is_queued_after_admission_and_polls_ready(monkeypatch, w):
    client = _app(monkeypatch, w)
    q = _post(client, **{}).json() if False else client.post(
        "/api/screener/backtest?background=1", json={"def_id": DEF_ID, **WINDOW})
    assert q.status_code == 200, q.text
    job = q.json()["job"]
    import time
    for _ in range(100):
        p = client.get(f"/api/screener/backtest/{job}").json()
        if p.get("status") != "running":
            break
        time.sleep(0.05)
    assert p["status"] == "ready" and p["backtestable"] is True, p


# --- the identity ----------------------------------------------------------------------------------

def test_two_plots_of_one_script_are_two_jobs_and_a_runtime_job_is_never_an_ast_job():
    a = bt.job_id({"runtime": "runtime:sha256:aa", "plot": "sig", "output": 0}, ["AAA"], "D", 1, 2, [5])
    b = bt.job_id({"runtime": "runtime:sha256:aa", "plot": "other", "output": 1}, ["AAA"], "D", 1, 2, [5])
    assert a != b


def test_the_warmup_charged_is_the_one_the_SERVICE_reports(monkeypatch, w):
    client = _app(monkeypatch, w)
    w.fake.withheld_bars = 5
    body = _post(client).json()
    assert body["coverage"]["bars_warmup"] == 10, body["coverage"]       # 5 per symbol x 2
    assert body["method"]["warmup_bars"] == 5
    # the warm-up bars are never tallied: answered + warm-up + holes == in-window
    c = body["coverage"]
    assert c["bars_answered"] + c["bars_warmup"] + c["bars_not_computable"] == c["bars_in_window"]
    assert c["bars_not_computable"] == 0, c      # the script's own first-bar na sits INSIDE the warm-up


def test_the_history_lead_only_sizes_the_read_and_charges_nothing(monkeypatch, w):
    client = _app(monkeypatch, w)
    monkeypatch.setattr(bt, "RUNTIME_HISTORY_LEAD", 500)      # more bars than the tape holds
    body = _post(client).json()
    assert body["backtestable"] is True, body
    assert body["coverage"]["bars_warmup"] == 0 and body["coverage"]["bars_answered"] > 0, body["coverage"]
    assert body["method"]["warmup_bars"] == 0
    # ...and it IS the read size: the store is asked for lead + window + horizon bars
    seen = []
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda sym, tf, want, to_key: seen.append(want) or _store_rows()[:want])
    monkeypatch.setattr(bt, "RUNTIME_HISTORY_LEAD", 0)
    _post(client, horizons=[5, 6])
    small = max(seen)
    seen.clear()
    from api.services.cache import cache
    cache.delete_prefix("screen_backtest::")
    monkeypatch.setattr(bt, "RUNTIME_HISTORY_LEAD", 30)
    _post(client, horizons=[5, 6])
    assert 30 <= max(seen) - small <= 31, (small, max(seen))


def test_a_finite_value_inside_the_services_own_warmup_fails_the_request_as_integrity(monkeypatch, w):
    from tests.fakes.pine_runtime_fake import b64_column, redigest

    def tamper(reply):
        for r, j in zip(reply["results"], w.fake.calls[-1]["jobs"]):
            n = j["bars"]["n"]
            r["columns"]["sig"] = b64_column([1.0] * n)
            r["digest"] = redigest(w.fake.identity, r, n)
        return reply
    w.fake.withheld_bars = 3
    w.fake.tamper = tamper
    r = _post(_app(monkeypatch, w))
    assert r.status_code == 500 and prc.INTEGRITY in r.json()["detail"], r.text
    assert "warm-up" in r.json()["detail"], r.json()


def test_a_warmup_that_is_the_whole_tape_leaves_nothing_to_tally_and_says_so(monkeypatch, w):
    client = _app(monkeypatch, w)
    w.fake.withheld_bars = 0
    _post(client)
    n = w.fake.calls[-1]["jobs"][0]["bars"]["n"]
    from api.services.cache import cache
    cache.delete_prefix("screen_backtest::")
    w.fake.withheld_bars = n
    r = _post(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["backtestable"] is False and body["coverage"]["bars_answered"] == 0, body


def test_admission_is_t11s_public_form_asked_with_the_chosen_plot(monkeypatch, w):
    asked = []
    real = bt.runtime_server_lane.admission
    monkeypatch.setattr(bt.runtime_server_lane, "admission",
                        lambda row, plot, lane: asked.append((plot, lane)) or real(row, plot, lane))
    client = _app(monkeypatch, w, row=runtime_row({"sig": 0, "other": 1}))
    assert _post(client, plot="other").status_code == 200
    assert asked and set(asked) == {("other", "backtest")}


def test_each_plot_of_one_script_is_its_own_receipt_through_the_route(monkeypatch, w):
    client = _app(monkeypatch, w, row=runtime_row({"sig": 0, "other": 1}))
    a = _post(client, plot="sig").json()
    b = _post(client, plot="other").json()
    assert a["job"] != b["job"]
    assert a["coverage"]["bars_not_computable"] > b["coverage"]["bars_not_computable"]


def test_a_verdict_that_lands_between_chunks_stops_the_run(monkeypatch, w):
    monkeypatch.setattr(bt, "RUNTIME_BATCH", 1)
    answers = [None, None, None, "engine-refused: refused after the first chunk"]
    client = _app(monkeypatch, w)
    monkeypatch.setattr(defs, "engine_withheld_reason", lambda row, current=None: answers.pop(0) if answers else answers_last)
    answers_last = "engine-refused: still refused"
    r = _post(client)
    assert r.status_code == 409 and "engine-refused" in r.json()["detail"], r.text
    assert len(w.fake.calls) == 1
