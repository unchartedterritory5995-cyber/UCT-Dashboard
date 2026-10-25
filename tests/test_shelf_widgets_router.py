"""Task 10.12: `POST /api/j2/notebook-shelf-widgets/{kind}` -- the ONE door of the seven ready-made dedicated
widgets (ruling W10-R4) -- and `shelf_kinds`, the registry it reads.

`require_paid` is NEVER overridden here, only what it reads, so the real gate decides. The builders are the real
Task 10.10 / 10.11 functions unless a test swaps `notebook_widgets.build` for a recorder (no data is read then).

⛔ Until Task 10.14 the seven kinds have no `KIND_WAVE` or `_BUILDERS` rows. The `_kind_rows` fixture installs them
with `monkeypatch.setitem`; Task 10.14 deletes those two lines.
"""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.notebook_shelf_widgets as sw
import api.routers.notebook_widgets as nwr
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import shelf_compose, shelf_discipline, shelf_kinds, tool_errors

ROOT = Path(__file__).resolve().parents[1]
PAID = {"id": "u-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": "u-free", "email": "free@example.test", "role": "member", "plan": "free"}
URL = "/api/j2/notebook-shelf-widgets/"
P1 = "/api/j2/notebook-widgets/"
SEVEN = ("myTiltCheck", "myRevengeClean", "myPlanVsActual", "myRiskLeftToday", "myPropFirm", "myGamePlan",
         "myAlertsFired")


@pytest.fixture(autouse=True)
def _fresh_limiter():
    from api.limiter import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for w in range(1, 11):
        monkeypatch.delenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", raising=False)


@pytest.fixture(autouse=True)
def _kind_rows(monkeypatch):
    """⛔ Task 10.14 deletes these two lines (the rows land in notebook_widgets then)."""
    for k in shelf_kinds.KINDS:
        monkeypatch.setitem(nw.KIND_WAVE, k, 10)
        monkeypatch.setitem(nw._BUILDERS, k, shelf_kinds.BUILDERS[k])


def _app():
    app = FastAPI()
    app.include_router(sw.router)
    app.include_router(nwr.router)
    return app


def _client(user=PAID):
    app = _app()
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def _on(monkeypatch):
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "1")


@pytest.fixture
def seen(monkeypatch):
    calls = []

    def fake_build(kind, user_id, params, *, now=None):
        calls.append((kind, user_id, dict(params)))
        return {"asOf": "2026-10-24T14:00:00Z", "source": "manual", "lines": ["ok"]}

    monkeypatch.setattr(nw, "build", fake_build)
    return calls


def _post(c, kind, body=None, **kw):
    return c.post(URL + kind, json={"params": {}} if body is None else body, **kw)


# -- the registry ------------------------------------------------------------------------------------

def test_registry_shape():
    assert shelf_kinds.KINDS == SEVEN
    assert set(shelf_kinds.BUILDERS) == set(SEVEN) == set(shelf_kinds.PARAMS) == set(shelf_kinds.TITLES)
    assert set(shelf_kinds.SOURCE_DETAIL) == set(SEVEN)
    for k in SEVEN:
        owner = shelf_discipline if k in shelf_discipline.BUILDERS else shelf_compose
        assert shelf_kinds.BUILDERS[k] is owner.BUILDERS[k], k
        assert shelf_kinds.PARAMS[k] == owner.PARAMS[k], k
        assert shelf_kinds.TITLES[k] == owner.TITLES[k], k
    assert shelf_kinds.TITLES == {
        "myTiltCheck": "Tilt check", "myRevengeClean": "Revenge trades", "myPlanVsActual": "Plan vs actual",
        "myRiskLeftToday": "Risk left today", "myPropFirm": "Prop-firm rules",
        "myGamePlan": "Pre-market game plan", "myAlertsFired": "Alerts that fired"}
    trades = "Your closed trades in the Journal."
    money = "Your accounts, trades and open positions in the Journal."
    assert shelf_kinds.SOURCE_DETAIL == {
        "myTiltCheck": trades, "myRevengeClean": trades, "myPlanVsActual": trades,
        "myRiskLeftToday": money, "myPropFirm": money,
        "myGamePlan": "The morning wire, the earnings calendar and your open positions.",
        "myAlertsFired": "Your alert history."}
    assert shelf_kinds.WAVE == 10


def test_one_param_error_class():
    """Carry-over: ONE ParamError, in the constants-only leaf (fix round 1, M5), re-exported by shelf_kinds;
    both builder modules use that very class (W9-R14)."""
    from api.services.journal_two import shelf_kind_names
    assert shelf_discipline.ParamError is shelf_kinds.ParamError is shelf_kind_names.ParamError
    assert shelf_compose.ParamError is shelf_kinds.ParamError
    assert issubclass(shelf_kinds.ParamError, tool_errors.ToolError)
    assert (shelf_kinds.ParamError.status, shelf_kinds.ParamError.code) == (400, "invalid")
    defs = []
    for mod in _THREE:
        tree = ast.parse((ROOT / "api" / "services" / "journal_two" / f"{mod}.py").read_text(encoding="utf-8"))
        defs += [mod for n in ast.walk(tree) if isinstance(n, ast.ClassDef) and n.name == "ParamError"]
    assert defs == ["shelf_kind_names"], defs


def test_the_constants_leaf_imports_nothing_heavy():
    """M5: the leaf imports only `tool_errors` (itself import-free), so public_note_payload can read KINDS."""
    from api.services.journal_two import shelf_kind_names
    assert shelf_kinds.KINDS is shelf_kind_names.KINDS and shelf_kinds.WAVE == shelf_kind_names.WAVE
    tree = ast.parse((ROOT / "api" / "services" / "journal_two" / "shelf_kind_names.py").read_text(encoding="utf-8"))
    imported = sorted({f"{n.module}.{a.name}" if isinstance(n, ast.ImportFrom) else a.name
                       for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names})
    assert imported == ["__future__.annotations", "api.services.journal_two.tool_errors"], imported


_THREE = ("shelf_kind_names", "shelf_kinds", "shelf_discipline", "shelf_compose")


def _private_reaches(source: str) -> list[str]:
    """Every leading-underscore name this module takes from ANOTHER module: `from m import _x`, and
    `m._x` where `m` is a name bound by an import. Dunders are not private."""
    tree = ast.parse(source)
    found, modules = [], set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            for a in n.names:
                modules.add(a.asname or a.name)
                if a.name.startswith("_") and not a.name.startswith("__"):
                    found.append(f"{n.module}.{a.name}")
        elif isinstance(n, ast.Import):
            for a in n.names:
                modules.add(a.asname or a.name.split(".")[0])
    for n in ast.walk(tree):
        if (isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id in modules
                and n.attr.startswith("_") and not n.attr.startswith("__")):
            found.append(f"{n.value.id}.{n.attr}")
    return found


#: ⚠️ A COUNTDOWN, NOT A PARKING SPACE. `run._cover_plan` lives in `widget_engine/run.py`, which Task 10.12 was
#: told to stay out of (10.4 owns it). The engine's own batch path and `routine_insights` read it the same way.
#: The assertion below goes red the moment the reach is gone, so the entry must then be deleted.
ALLOWED_PRIVATE = {"shelf_discipline": ["wrun._cover_plan"]}


def test_no_private_names_across_modules():
    for mod in _THREE:
        got = _private_reaches((ROOT / "api" / "services" / "journal_two" / f"{mod}.py").read_text(encoding="utf-8"))
        assert sorted(got) == sorted(ALLOWED_PRIVATE.get(mod, [])), (mod, got)


def test_private_reach_rail_can_fire():
    """Control: the scanner sees both shapes, so an empty answer above is a measurement."""
    src = ("from api.services.journal_two.notebook_widgets import _num\n"
           "from api.services.journal_two import filters\n"
           "x = filters._DAY\nfrom m import __version__\n")
    assert _private_reaches(src) == ["api.services.journal_two.notebook_widgets._num", "filters._DAY"]


def test_public_aliases_are_the_same_objects():
    from api.services import alert_user_series
    from api.services.journal_two import filters, widget_definitions
    assert nw.num is nw._num and nw.iso_utc is nw._iso_utc and nw.origin is nw._origin
    assert filters.DAY_SQL is filters._DAY
    assert widget_definitions.read_conn is widget_definitions._read
    assert alert_user_series.definition_label is alert_user_series._definition_label


def test_merge_refuses_a_duplicate_kind():
    with pytest.raises(shelf_kinds.DuplicateKind) as e:
        shelf_kinds.merge("PARAMS", {"a": 1, "b": 2}, {"b": 3})
    assert "'b'" in str(e.value) and "PARAMS" in str(e.value)
    assert shelf_kinds.merge("PARAMS", {"a": 1}, {"b": 2}) == {"a": 1, "b": 2}


def _run_py(code: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-c", code], cwd=str(ROOT), env=dict(os.environ),
                          capture_output=True, text=True, timeout=180)


def test_a_duplicate_kind_raises_at_import_time():
    """A kind both builder modules declare stops `shelf_kinds` from importing at all (never a silent overwrite)."""
    code = ("from api.services.journal_two import shelf_compose as sc\n"
            "sc.PARAMS['myTiltCheck'] = ()\n"
            "try:\n    import api.services.journal_two.shelf_kinds\n"
            "except RuntimeError as e:\n    print('REFUSED', type(e).__name__, e)\n"
            "else:\n    print('LOADED')\n")
    r = _run_py(code)
    assert "REFUSED DuplicateKind" in r.stdout and "myTiltCheck" in r.stdout, (r.stdout, r.stderr)
    assert "LOADED" in _run_py(code.replace("sc.PARAMS['myTiltCheck'] = ()", "pass")).stdout     # control
    # and a kind that no module builds is refused the same way (the merged set must be exactly KINDS)
    r = _run_py(code.replace("sc.PARAMS['myTiltCheck'] = ()", "del sc.BUILDERS['myGamePlan']"))
    assert "REFUSED" in r.stdout and "BUILDERS" in r.stdout, (r.stdout, r.stderr)


@pytest.mark.parametrize("first", ["shelf_kinds", "shelf_discipline", "shelf_compose", "shelf_kind_names",
                                   "public_note_payload"])
def test_every_import_order_loads(first):
    """The three modules import each other; every entry point must load them all, with one ParamError."""
    code = (f"import api.services.journal_two.{first}\n"
            "from api.services.journal_two import shelf_kinds as k, shelf_discipline as d, shelf_compose as c\n"
            "assert d.ParamError is k.ParamError is c.ParamError\n"
            "assert set(k.BUILDERS) == set(k.KINDS)\nprint('OK')\n")
    r = _run_py(code)
    assert r.stdout.strip().endswith("OK"), (r.stdout, r.stderr)


def test_clean_params_dispatches_per_kind():
    assert shelf_kinds.clean_params("myPropFirm", {"dailyLoss": 500, "junk": 1}) == {"dailyLoss": 500.0}
    assert shelf_kinds.clean_params("myPlanVsActual", {"tradeId": "t1"}) == {"tradeId": "t1"}
    assert shelf_kinds.clean_params("myGamePlan", None) == {}
    with pytest.raises(shelf_kinds.ParamError):
        shelf_kinds.clean_params("myPnlStats", {})


# -- the route -------------------------------------------------------------------------------------------

def test_dark_and_unknown_kind_are_one_404(monkeypatch, seen):
    c = _client()
    dark = _post(c, "myTiltCheck")
    unknown = _post(c, "noSuchKind")
    _on(monkeypatch)
    phase1 = _post(c, "myPnlStats")                      # a real kind, but not a dedicated one
    unknown_on = _post(c, "noSuchKind")
    for r in (dark, unknown, phase1, unknown_on):
        assert r.status_code == 404, r.text
    assert dark.json() == unknown.json() == phase1.json() == unknown_on.json()
    assert seen == []
    # dark is the one 404 for a free member and for nobody at all, too: the gate runs first
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W10_ENABLED")
    assert _post(_client(FREE), "myTiltCheck").status_code == 404
    assert _post(_client(None), "myTiltCheck").status_code == 404


def test_the_gate_reads_the_wave_reader_with_wave_10(monkeypatch, seen):
    """Carry-over: the wave 10 gate is `notebook_widgets_wave_on(10)`, the reader 10.4's `_gate_w10` uses, read
    per request."""
    asked = []
    real = nw.notebook_widgets_wave_on

    def spy(wave):
        asked.append(wave)
        return real(wave)

    monkeypatch.setattr(nw, "notebook_widgets_wave_on", spy)
    c = _client()
    assert _post(c, "myGamePlan").status_code == 404
    _on(monkeypatch)
    assert _post(c, "myGamePlan").status_code == 200
    assert asked == [10, 10]


def test_paid_sentence_own(monkeypatch, seen):
    _on(monkeypatch)
    r = _post(_client(FREE), "myTiltCheck")
    assert r.status_code == 402 and r.json()["detail"] == "Ready-made widgets require a paid plan"
    assert "no-store" in r.headers["cache-control"]
    assert seen == []
    tree = ast.parse((ROOT / "api" / "routers" / "notebook_shelf_widgets.py").read_text(encoding="utf-8"))
    defs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "require_paid"]
    assert len(defs) == 1
    details = [kw.value.value for n in ast.walk(defs[0]) if isinstance(n, ast.Call)
               and isinstance(n.func, ast.Name) and n.func.id == "HTTPException"
               for kw in n.keywords if kw.arg == "detail" and isinstance(kw.value, ast.Constant)]
    assert details == ["Ready-made widgets require a paid plan"]


def test_rate_shares_the_widgets_budget(monkeypatch, seen):
    """The 61st widget read in a minute, across the phase 1 GET and this POST, answers 429 with the phase 1
    sentence; another member's budget is their own; the constants are phase 1's own objects."""
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    _on(monkeypatch)
    c = _client()
    for i in range(30):
        assert c.get(P1 + "tickerCard?symbol=AAPL").status_code == 200, i
    for i in range(30):
        assert _post(c, "myGamePlan").status_code == 200, i
    r = _post(c, "myAlertsFired")
    assert r.status_code == 429
    assert r.json()["detail"] == {"code": "rate", "message": nwr.WIDGET_RATE_SENTENCE}
    assert "no-store" in r.headers["cache-control"]
    assert c.get(P1 + "tickerCard?symbol=AAPL").status_code == 429          # the same bucket, both doors
    assert len(seen) == 60
    assert _post(_client({**PAID, "id": "u-paid-2"}), "myGamePlan").status_code == 200
    src = (ROOT / "api" / "routers" / "notebook_shelf_widgets.py").read_text(encoding="utf-8")
    assert "60/minute" not in src and nwr.WIDGET_RATE_SENTENCE not in src
    calls = [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "enforce_rate"]
    assert len(calls) == 1
    named = [a.attr for a in calls[0].args if isinstance(a, ast.Attribute)
             and isinstance(a.value, ast.Name) and a.value.id == "phase1"]
    assert named == ["WIDGET_RATE", "SCOPE_WIDGETS", "WIDGET_RATE_SENTENCE"]          # phase 1's own constants


def test_params_cleaned_per_kind_and_refusals_400(monkeypatch, seen):
    _on(monkeypatch)
    c = _client()
    assert _post(c, "myPropFirm", {"params": {"dailyLoss": 500, "maxDrawdown": 2000, "since": "2026-10-01",
                                              "accountId": "a1", "junk": "x"}}).status_code == 200
    assert _post(c, "myPlanVsActual", {"params": {"tradeId": "t-9", "from": "2026-01-01"}}).status_code == 200
    assert _post(c, "myGamePlan", {"params": {"anything": 1}}).status_code == 200
    assert _post(c, "myRevengeClean", {}).status_code == 200                # no params at all
    assert seen == [
        ("myPropFirm", "u-paid", {"dailyLoss": 500.0, "maxDrawdown": 2000.0, "since": "2026-10-01",
                                  "accountId": "a1"}),
        ("myPlanVsActual", "u-paid", {"tradeId": "t-9"}),
        ("myGamePlan", "u-paid", {}),
        ("myRevengeClean", "u-paid", {})]
    for kind, params, sentence in (
            ("myPropFirm", {"dailyLoss": -5}, "Enter an amount above $0."),
            ("myPropFirm", {"maxDrawdown": 1e9}, "An amount can be at most $10,000,000."),
            ("myTiltCheck", {"from": "10/24/2026"}, "Dates need to look like 2026-10-24."),
            ("myTiltCheck", {"from": "2026-10-24", "to": "2026-10-01"}, "The start date is after the end date.")):
        r = _post(c, kind, {"params": params})
        assert r.status_code == 400, r.text
        assert r.json()["detail"] == {"code": "invalid", "message": sentence}
        assert "no-store" in r.headers["cache-control"]
    assert len(seen) == 4                                                    # a refusal builds nothing
    r = _post(c, "myGamePlan", {"params": ["not", "an", "object"]})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid"


def test_param_error_status_comes_from_the_class(monkeypatch, seen):
    """W9-R14: the router answers `e.status` / `e.code`, never a sentence match. A subclass with another status
    is answered with that status."""
    _on(monkeypatch)

    class Teapot(shelf_kinds.ParamError):
        status = 418
        code = "teapot"

    def refuse(kind, raw):
        raise Teapot("Short and stout.")

    monkeypatch.setattr(shelf_kinds, "clean_params", refuse)
    r = _post(_client(), "myTiltCheck")
    assert r.status_code == 418 and r.json()["detail"] == {"code": "teapot", "message": "Short and stout."}


def test_widget_request_error_is_400(monkeypatch):
    _on(monkeypatch)

    def bad(kind, user_id, params, *, now=None):
        raise nw.WidgetRequestError("params must be an object")

    monkeypatch.setattr(nw, "build", bad)
    r = _post(_client(), "myTiltCheck")
    assert r.status_code == 400 and r.json()["detail"] == {"code": "invalid", "message": "params must be an object"}


def test_engine_refusals_are_503(monkeypatch):
    from api.services.journal_two.widget_engine import run as wrun
    _on(monkeypatch)

    def slow(kind, user_id, params, *, now=None):
        raise wrun.EngineTooLong()

    monkeypatch.setattr(nw, "build", slow)
    r = _post(_client(), "myRevengeClean")
    assert r.status_code == 503 and r.json()["detail"] == {"code": "too_long", "message": wrun.TOO_LONG}


def test_builds_inline_through_the_shared_admission(monkeypatch):
    """No second pool: the build runs on the request thread, holding one `run.admit` permit; full, it is the
    busy sentence at once."""
    import threading
    from api.services.journal_two.widget_engine import run as wrun
    _on(monkeypatch)
    where = []

    def rec(kind, user_id, params, *, now=None):
        where.append(threading.current_thread().name)
        return {"asOf": "x", "source": "manual", "lines": ["ok"]}

    monkeypatch.setattr(nw, "build", rec)
    lanes = []
    real = wrun.admit

    def spy(user_id, lane):
        lanes.append((user_id, lane))
        return real(user_id, lane)

    monkeypatch.setattr(wrun, "admit", spy)
    assert _post(_client(), "myGamePlan").status_code == 200
    assert lanes == [("u-paid", "run")] and len(where) == 1

    def busy(user_id, lane):
        raise wrun.EngineBusy()

    monkeypatch.setattr(wrun, "admit", busy)
    r = _post(_client(), "myGamePlan")
    assert r.status_code == 503 and r.json()["detail"] == {"code": "busy", "message": wrun.BUSY}


def test_the_real_builder_answers(monkeypatch):
    """End to end on the real builder: a brand-new member's alerts widget is a 200 payload with its lines and the
    source sentence slot, built by `notebook_widgets.build`."""
    _on(monkeypatch)
    r = _post(_client({**PAID, "id": "u-nobody-1012"}), "myAlertsFired")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["lines"] and "sourceDetail" in body
    assert r.headers["cache-control"] == "no-store"


def test_body_over_8kb_refused(monkeypatch, seen):
    _on(monkeypatch)
    c = _client()
    big = json.dumps({"params": {"pad": "x" * (8 * 1024)}})
    r = c.post(URL + "myGamePlan", content=big, headers={"content-type": "application/json"})
    assert r.status_code == 413 and r.json()["detail"]["code"] == "invalid"
    assert "no-store" in r.headers["cache-control"]

    def chunks():
        yield big[:4000].encode()
        yield big[4000:].encode()

    r = c.post(URL + "myGamePlan", content=chunks(), headers={"content-type": "application/json"})
    assert r.status_code == 413
    exact = json.dumps({"params": {"pad": ""}})
    exact = json.dumps({"params": {"pad": "x" * (8 * 1024 - len(exact))}})
    assert len(exact) == 8 * 1024
    assert c.post(URL + "myGamePlan", content=exact, headers={"content-type": "application/json"}).status_code == 200
    r = c.post(URL + "myGamePlan", content=b"{nope", headers={"content-type": "application/json"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid"
    assert sw.MAX_BODY == 8 * 1024
    assert len(seen) == 1


def test_phase1_get_refuses_dedicated_kinds(monkeypatch, seen):
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    _on(monkeypatch)
    c = _client()
    unknown = c.get(P1 + "noSuchKind")
    for k in SEVEN:
        r = c.get(P1 + k)
        assert r.status_code == 404 and r.json() == unknown.json(), k
    assert c.get(P1 + "myPnlStats").status_code == 200                  # phase 1 still serves
    assert [s[0] for s in seen] == ["myPnlStats"]


def test_prop_firm_limits_never_in_query_string(monkeypatch, seen):
    """The client contract (W10-R4): the limits travel in the body. The POST ignores a query string entirely;
    the old GET door with them in the query is the 404 and builds nothing; this route has no GET."""
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    _on(monkeypatch)
    c = _client()
    r = c.post(URL + "myPropFirm?dailyLoss=999&maxDrawdown=5000", json={"params": {"dailyLoss": 500}})
    assert r.status_code == 200
    assert seen == [("myPropFirm", "u-paid", {"dailyLoss": 500.0})]
    assert c.get(P1 + "myPropFirm?dailyLoss=500&maxDrawdown=2000").status_code == 404
    assert c.get(URL + "myPropFirm?dailyLoss=500").status_code in (404, 405)
    assert len(seen) == 1
    assert [r.methods for r in sw.router.routes] == [{"POST"}]


def test_no_store_on_every_response(monkeypatch, seen):
    c = _client()
    responses = [_post(c, "myTiltCheck"), _post(c, "nope")]                 # dark, unknown
    _on(monkeypatch)
    responses += [
        _post(c, "myTiltCheck"),                                             # 200
        _post(c, "myTiltCheck", {"params": {"from": "bad"}}),                # 400
        c.post(URL + "myTiltCheck", content=b"[", headers={"content-type": "application/json"}),     # 400 body
        c.post(URL + "myTiltCheck", content=b"x" * (9 * 1024), headers={"content-type": "application/json"}),
        _post(_client(FREE), "myTiltCheck"),                                 # 402
        _post(_client(None), "myTiltCheck"),                                 # 401, the session gate
    ]
    statuses = [r.status_code for r in responses]
    assert statuses == [404, 404, 200, 400, 400, 413, 402, 401], statuses
    for r in responses:
        assert "no-store" in r.headers.get("cache-control", ""), (r.status_code, r.headers)


def test_no_store_on_the_405_and_an_unexpected_500(monkeypatch):
    """M3: the route class is the one authority, and it covers the two answers produced outside the handler
    body: the method-mismatch 405 and a failure nobody caught (answered as a 500 `error`, never a bare one)."""
    _on(monkeypatch)
    c = TestClient(_client().app, raise_server_exceptions=False)
    c.app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    c.app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    for method in ("get", "put", "delete"):
        r = getattr(c, method)(URL + "myGamePlan")
        assert r.status_code == 405, (method, r.status_code)
        assert r.headers.get("cache-control") == "no-store", (method, r.headers)

    def boom(kind, user_id, params, *, now=None):
        raise RuntimeError("builder exploded")

    monkeypatch.setattr(nw, "build", boom)
    r = _post(c, "myGamePlan")
    assert r.status_code == 500 and r.headers.get("cache-control") == "no-store"
    assert r.json()["detail"]["code"] == "error" and "exploded" not in r.text


def test_the_route_class_is_the_only_place_no_store_is_set():
    """M3: no `headers=` on any call in the router, and the one `no-store` literal is the route class's."""
    tree = ast.parse((ROOT / "api" / "routers" / "notebook_shelf_widgets.py").read_text(encoding="utf-8"))
    with_headers = [ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)
                    and any(k.arg == "headers" for k in n.keywords)]
    assert with_headers == [], with_headers
    literals = [n for n in ast.walk(tree) if isinstance(n, ast.Constant) and n.value == "no-store"]
    assert len(literals) == 1


def test_the_session_uid_wins_over_the_body(monkeypatch, seen):
    """M4: an owner named in the body (in `params` or beside it) is ignored; the build is the session's."""
    _on(monkeypatch)
    c = _client()
    r = _post(c, "myPropFirm", {"userId": "u-other", "user_id": "u-other",
                                "params": {"userId": "u-other", "user_id": "u-other", "dailyLoss": 100}})
    assert r.status_code == 200
    assert seen == [("myPropFirm", "u-paid", {"dailyLoss": 100.0})]


def test_another_members_account_gets_the_builders_refusal(monkeypatch, tmp_path):
    """M4, through the door: member A naming member B's account reads all of A's accounts, with the one notice,
    and none of B's numbers."""
    import importlib
    from datetime import datetime as _dt, timezone as _tz
    from tests.test_shelf_discipline import A, account, trade
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    try:
        auth_db.init_db()
        with auth_db.get_connection() as conn:
            account(conn, A, "acc-a", pct=5.0, size=10000.0, name="Main A")
            trade(conn, A, day="2026-10-19", pnl=300, entry="11:00", exit_="11:30", account="acc-a")
            account(conn, "u-member-b", "acc-b", pct=5.0, size=10000.0, name="Main B")
            trade(conn, "u-member-b", day="2026-10-19", pnl=-900, entry="11:00", exit_="11:30", account="acc-b")
            conn.commit()
        real = nw.build
        monkeypatch.setattr(nw, "build", lambda kind, uid, params, *, now=None: real(
            kind, uid, params, now=_dt(2026, 10, 20, 20, 30, tzinfo=_tz.utc)))
        _on(monkeypatch)
        c = _client({**PAID, "id": A})
        base = {"since": "2026-10-01", "maxDrawdown": 2000}
        mine = _post(c, "myPropFirm", {"params": base}).json()
        got = _post(c, "myPropFirm", {"params": {**base, "accountId": "acc-b"}})
        assert got.status_code == 200, got.text
        body = got.json()
        assert body["notices"] == ["That account is no longer in your Journal; showing all accounts."]
        assert body["accountId"] is None and body["lines"] == mine["lines"]
        assert "900" not in json.dumps(body)
    finally:
        monkeypatch.undo()
        importlib.reload(auth_db)


def test_a_body_nested_past_the_depth_limit_is_refused(monkeypatch, seen):
    """M2: the shared reader's depth check applies here too."""
    import api.routers.notebook_widget_definitions as wdr
    _on(monkeypatch)
    deep = {"params": {}}
    node = deep["params"]
    for _ in range(wdr.MAX_BODY_DEPTH + 2):
        node["x"] = {}
        node = node["x"]
    r = _post(_client(), "myGamePlan", deep)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid"
    ok = {"params": {}}
    assert _post(_client(), "myGamePlan", ok).status_code == 200
    assert len(seen) == 1


def test_one_body_reader_for_the_widget_routers():
    """M2: neither router reads the body itself; both hand a capped read to `widget_request_body`."""
    for rel in ("api/routers/notebook_shelf_widgets.py", "api/routers/notebook_widget_definitions.py"):
        tree = ast.parse((ROOT / rel).read_text(encoding="utf-8"))
        raw = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, ast.Call)
               and isinstance(n.func, ast.Attribute) and n.func.attr in ("body", "stream", "json")
               and isinstance(n.func.value, ast.Name) and n.func.value.id == "request"]
        assert raw == [], (rel, raw)
        shared = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                  and n.func.attr == "read_json_object"]
        assert len(shared) == 1, rel


def test_main_mounts_the_router_once():
    tree = ast.parse((ROOT / "api" / "main.py").read_text(encoding="utf-8"))
    mounted = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and n.func.attr == "include_router" and n.args and isinstance(n.args[0], ast.Attribute)
               and isinstance(n.args[0].value, ast.Name) and n.args[0].value.id == "notebook_shelf_widgets_router"]
    assert len(mounted) == 1
