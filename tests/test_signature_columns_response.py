"""The two column routes hand the framework a finished response: the same bytes, without the walk.

Measured 2026-11-14: returned as a dict, a column answer goes through FastAPI's
`jsonable_encoder` before it is serialised, a Python-level visit of every number in every
column: 20 ms for one chart's five RS definitions (344 KB) with nothing else running,
against 3 ms for the `json.dumps` after it. On the web pod production's own captures showed
the browser waiting a median 300 ms beyond the server's own time for an answer already in
memory.

What this file holds `signature._columns_response` to. Every test asks the SAME request
twice, once through the route as it is and once with the helper switched to "return the
dict" (the framework's own path, which is what the route did before), and compares:
  * the same bytes, status and content type, for every RS definition and for the batch,
    refusals included;
  * the framework's walk does not run for a column answer (and does run on the old path:
    the control);
  * a body `json.dumps` will not take is answered exactly as before;
  * what a dependency put on the temporal response (a header, a cookie, a status) and the
    route's own `Server-Timing` arrive on the real one.
"""
import json
from datetime import datetime

import fastapi.routing
import pytest
from fastapi import Depends, FastAPI, Response
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import signature as sig
from api.services import rs_benchmarks as rb
from api.services.cache import cache
from api.services.signature import registry_defs as rd
from api.services.signature import rs_provider as rsp
from tests.test_rs_columns_provider import (  # noqa: F401 - fixtures are used by name
    _fetcher, _hermetic_reads, _long_daily,
)

RS_IDS = ("rsLine", "rsRating", "rsPhases", "rsVsEma", "rsExit")


def _stamp(response: Response):
    """A dependency that writes on the temporal response, the way a session refresh would."""
    response.headers["X-From-Dependency"] = "kept"
    response.set_cookie("refreshed", "yes")


@pytest.fixture
def api(monkeypatch):
    """The real router behind a paid member, every RS definition installed, synthetic bars,
    the REAL cache (so a second identical ask returns the very same envelope)."""
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(True, True))
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    for row in rd.RS_SPLIT_DEFS:
        monkeypatch.setitem(rd._BY_ID, row["id"], row)
        monkeypatch.setitem(rd._PROVIDERS, row["id"], sig.RS_SPLIT_PROVIDERS[row["id"]])
    monkeypatch.setattr(rd, "SERVER_DEFS", tuple(rd.SERVER_DEFS) + tuple(rd.RS_SPLIT_DEFS))
    monkeypatch.setattr(rb, "_custom_warmed", {})
    monkeypatch.setattr(sig, "_rs_warm_bars", lambda *a, **k: None)
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})
    monkeypatch.setattr(rsp, "_rs_data_generation", lambda now=None: "r-|e-")
    monkeypatch.setattr(rsp, "_seconds_to_next_et_close", lambda *a, **k: 6 * 3600)     # not the wall clock
    monkeypatch.setattr(rsp, "_et_session_day", lambda: "2026-11-13")
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily(n=400)))
    monkeypatch.setattr(sig, "is_paid_user", lambda u: True)
    app = FastAPI()
    app.include_router(sig.router, dependencies=[Depends(_stamp)])
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": 1, "plan": "pro", "role": "user"}
    cache.clear()
    rsp.rs_core_reset()
    yield TestClient(app, raise_server_exceptions=False)
    cache.clear()
    rsp.rs_core_reset()


def _both(api, monkeypatch, path, params):
    """(the route as it is, the framework's own path) for the same request."""
    now = api.get(path, params=params)
    with monkeypatch.context() as m:
        m.setattr(sig, "_columns_response", lambda body, sub: body)
        before = api.get(path, params=params)
    return now, before


def _walks(monkeypatch):
    """Count the framework's serialise step (`jsonable_encoder` lives inside it)."""
    seen = []
    real = fastapi.routing.serialize_response

    async def counted(*a, **k):
        seen.append(1)
        return await real(*a, **k)
    monkeypatch.setattr(fastapi.routing, "serialize_response", counted)
    return seen


BATCH = {"sym": "NVDA", "tf": "D",
         "asks": json.dumps([{"defId": d} for d in RS_IDS] + [{"defId": "noSuchDefinition"}, {"inputs": {}},
                                                               {"defId": "rsPhases", "inputs": {"longEma": 12}}])}


@pytest.mark.parametrize("def_id", RS_IDS)
def test_one_definition_is_answered_with_the_same_bytes(api, monkeypatch, def_id):
    now, before = _both(api, monkeypatch, "/api/signature/columns", {"defId": def_id, "sym": "NVDA", "tf": "D"})
    assert now.status_code == before.status_code == 200
    assert len(now.content) > 2000 and now.json()["times"], "an empty answer would make the comparison vacuous"
    assert now.content == before.content
    assert now.headers["content-type"] == before.headers["content-type"] == "application/json"
    assert int(now.headers["content-length"]) == len(now.content)


def test_the_batch_is_answered_with_the_same_bytes_refusals_included(api, monkeypatch):
    now, before = _both(api, monkeypatch, "/api/signature/columns-batch", BATCH)
    assert now.status_code == before.status_code == 200
    statuses = [r["status"] for r in now.json()["results"]]
    assert statuses == [200, 200, 200, 200, 200, 404, 422, 200], statuses
    assert now.content == before.content
    assert now.headers["content-type"] == before.headers["content-type"]


def test_the_frameworks_walk_does_not_run_for_a_column_answer(api, monkeypatch):
    seen = _walks(monkeypatch)
    assert api.get("/api/signature/columns", params={"defId": "rsLine", "sym": "NVDA", "tf": "D"}).status_code == 200
    assert api.get("/api/signature/columns-batch", params=BATCH).status_code == 200
    assert seen == [], "a column answer is handed over finished"
    # the control: on the framework's own path it runs once per request
    monkeypatch.setattr(sig, "_columns_response", lambda body, sub: body)
    api.get("/api/signature/columns", params={"defId": "rsLine", "sym": "NVDA", "tf": "D"})
    api.get("/api/signature/columns-batch", params=BATCH)
    assert seen == [1, 1]


@pytest.mark.parametrize("odd", [
    {"when": datetime(2026, 11, 14, 9, 30)},        # json.dumps refuses it; the framework writes its ISO text
    {"tags": {"only"}},                             # a set
    {"value": float("nan")},                        # the wire forbids it: an error then, and an error now
])
def test_a_body_json_will_not_take_is_answered_exactly_as_before(api, monkeypatch, odd):
    body = {"defId": "rsLine", "sym": "NVDA", "tf": "D", "columns": {}, "times": [], **odd}
    monkeypatch.setattr(sig, "_serve_columns", lambda *a, **k: dict(body))
    seen = _walks(monkeypatch)
    now, before = _both(api, monkeypatch, "/api/signature/columns", {"defId": "rsLine", "sym": "NVDA", "tf": "D"})
    assert now.status_code == before.status_code
    assert now.content == before.content
    assert seen == [1, 1], "the framework's own path, both times"
    if "when" in odd:
        assert now.status_code == 200 and now.json()["when"] == "2026-11-14T09:30:00"


def test_what_a_dependency_and_the_route_put_on_the_temporal_response_arrives(api, monkeypatch):
    for path, params in (("/api/signature/columns", {"defId": "rsPhases", "sym": "NVDA", "tf": "D"}),
                         ("/api/signature/columns-batch", BATCH)):
        cache.clear()
        rsp.rs_core_reset()
        now, before = _both(api, monkeypatch, path, params)
        for r in (now, before):
            assert r.headers["x-from-dependency"] == "kept", path
            assert "refreshed=yes" in r.headers["set-cookie"], path
        assert now.headers["server-timing"].startswith('rs;desc="cold";dur='), now.headers.get("server-timing")
        assert before.headers["server-timing"].startswith('rs;desc="cache";dur='), "the second ask: from memory"
        assert sorted(k for k in now.headers if k != "content-length") == sorted(k for k in before.headers if k != "content-length")


def test_a_status_set_on_the_temporal_response_is_the_status_sent(monkeypatch, api):
    def partial(response: Response):
        response.status_code = 203
    app = FastAPI()
    app.include_router(sig.router, dependencies=[Depends(partial)])
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": 1, "plan": "pro", "role": "user"}
    client = TestClient(app)
    now, before = _both(client, monkeypatch, "/api/signature/columns", {"defId": "rsVsEma", "sym": "NVDA", "tf": "D"})
    assert now.status_code == before.status_code == 203
    assert now.content == before.content


def test_refusals_are_what_they_were(api, monkeypatch):
    for params, want in (({"defId": "noSuchDefinition", "sym": "NVDA", "tf": "D"}, 404),
                         ({"defId": "rsLine", "sym": "NVDA", "tf": "D", "inputs": "[1]"}, 422),
                         ({"defId": "rsLine", "sym": "..", "tf": "D"}, 422)):
        now, before = _both(api, monkeypatch, "/api/signature/columns", params)
        assert now.status_code == before.status_code == want, params
        assert now.content == before.content
    now, before = _both(api, monkeypatch, "/api/signature/columns-batch", {"sym": "NVDA", "tf": "D", "asks": "{}"})
    assert now.status_code == before.status_code == 422 and now.content == before.content


def test_our_own_defect_is_still_an_envelope_and_never_a_500(api, monkeypatch):
    def broken(*a, **k):
        raise rd.DefinitionHasNoProvider("no provider")
    monkeypatch.setattr(rd, "serve", broken)
    now, before = _both(api, monkeypatch, "/api/signature/columns", {"defId": "rsLine", "sym": "NVDA", "tf": "D"})
    assert now.status_code == before.status_code == 200
    a, b = now.json(), before.json()
    assert a["error"] == b["error"] == "server lane unavailable" and a["columns"] == {} and a["times"] == []
    assert {k: v for k, v in a.items() if k != "asOf"} == {k: v for k, v in b.items() if k != "asOf"}
