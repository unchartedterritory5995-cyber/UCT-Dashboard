"""Task 4: `GET /api/j2/notebook-widgets/{kind}`.

`require_paid` is NEVER overridden here -- only what it reads -- so the real gate decides.
`notebook_widgets.build` is monkeypatched: no real data is read.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.notebook_widgets as nwr
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services.journal_two import notebook_widgets as nw

PAID = {"id": "u-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": "u-free", "email": "free@example.test", "role": "member", "plan": "free"}
URL = "/api/j2/notebook-widgets/"


@pytest.fixture(autouse=True)
def _fresh_limiter():
    """The route's per-member limit (60/minute) is in-process limiter state: start each test clean."""
    from api.limiter import limiter
    limiter.reset()
    yield
    limiter.reset()


def _client(user=PAID):
    app = FastAPI()
    app.include_router(nwr.router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for w in range(1, 7):
        monkeypatch.delenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", raising=False)


@pytest.fixture
def seen(monkeypatch):
    calls = []

    def fake_build(kind, user_id, params, *, now=None):
        calls.append((kind, user_id, dict(params)))
        return {"asOf": "2026-10-20T00:00:00Z", "source": "market", "rows": []}

    monkeypatch.setattr(nw, "build", fake_build)
    return calls


def test_gate_off_404(seen):
    a = _client().get(URL + "tickerCard?symbol=AAPL")
    b = _client().get(URL + "noSuchKind")
    assert a.status_code == 404 and b.status_code == 404
    assert a.json() == b.json()
    assert seen == []


def test_gate_on_200_no_store(monkeypatch, seen):
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    r = _client().get(URL + "tickerCard?symbol=AAPL&list=flagged&from=2026-10-01&to=2026-10-19"
                      "&month=2026-10&definitionId=d1&tradeId=t1&junk=x")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    assert r.json()["source"] == "market"
    assert seen == [("tickerCard", "u-paid", {
        "symbol": "AAPL", "list": "flagged", "from": "2026-10-01", "to": "2026-10-19",
        "month": "2026-10", "definitionId": "d1", "tradeId": "t1"})]


def test_only_present_params_are_passed(monkeypatch, seen):
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    _client().get(URL + "myPnlStats")
    assert seen == [("myPnlStats", "u-paid", {})]


def test_wave2_kind_404_when_only_w1_on(monkeypatch, seen):
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    assert _client().get(URL + "myRulesCheck").status_code == 404
    assert _client().get(URL + "tickerCard?symbol=AAPL").status_code == 200


def test_unpaid_402_sentence(monkeypatch, seen):
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    r = _client(FREE).get(URL + "tickerCard?symbol=AAPL")
    assert r.status_code == 402
    assert r.json()["detail"] == "Notebook widgets require a paid plan"
    assert seen == []


def test_unauthenticated_is_rejected():
    assert _client(None).get(URL + "tickerCard").status_code in (401, 403)


def test_bad_symbol_400(monkeypatch):
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    r = _client().get(URL + "tickerCard?symbol=not%20a%20ticker")
    assert r.status_code == 400
    assert r.json()["detail"] == "symbol is required and must be an uppercase ticker"


def test_flag_read_per_request(monkeypatch, seen):
    c = _client()
    assert c.get(URL + "tickerCard?symbol=AAPL").status_code == 404
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    assert c.get(URL + "tickerCard?symbol=AAPL").status_code == 200
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "0")
    assert c.get(URL + "tickerCard?symbol=AAPL").status_code == 404


def test_wave6_trade_recap_not_yours_is_a_400_with_one_sentence(monkeypatch):
    import api.services.journal_two.trades as tr
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W6_ENABLED", "1")
    monkeypatch.setattr(tr, "get_trade_detail", lambda user_id, trade_id, conn=None: None)
    c = _client()
    a = c.get(URL + "tradeRecap?tradeId=someone-elses-trade")
    b = c.get(URL + "tradeRecap?tradeId=bad%20id")
    assert a.status_code == b.status_code == 400
    assert a.json() == b.json() == {"detail": "Trade not found"}


def test_wave6_kinds_404_when_w6_off(seen):
    for kind in ("tradeRecap", "myPnlCalendar", "mySetupEdge", "myScreenToday",
                 "roomBuzzOnMyNames", "myEarningsReactions"):
        assert _client().get(URL + kind).status_code == 404, kind
    assert seen == []


def test_sixty_a_minute_per_member_then_a_429_sentence(monkeypatch, seen):
    """Final review I-4: the 61st read inside a minute is refused with one sentence and builds nothing;
    another member's budget is their own; a dark kind is still the one 404 (the gate runs first)."""
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    c = _client()
    for i in range(60):
        assert c.get(URL + "tickerCard?symbol=AAPL").status_code == 200, i
    r = c.get(URL + "tickerCard?symbol=AAPL")
    assert r.status_code == 429 and r.json()["detail"] == nwr.WIDGET_RATE_SENTENCE
    assert len(seen) == 60                                      # the refused read built nothing
    assert c.get(URL + "myRulesCheck").status_code == 404       # W2 dark: the 404, never a 429
    other = {**PAID, "id": "u-paid-2"}
    assert _client(other).get(URL + "tickerCard?symbol=AAPL").status_code == 200
    assert (nwr.WIDGET_RATE, nwr.SCOPE_WIDGETS) == ("60/minute", "notebook-widgets")



def test_get_route_404_for_builtWidget(monkeypatch, seen):
    """`builtWidget` is a note kind with no phase 1 builder: the GET route answers it exactly like an
    unknown kind, with wave 8 on (and before the kind rows land in KIND_WAVE in Task 8.13)."""
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W8_ENABLED", "1")
    monkeypatch.setitem(nw.KIND_WAVE, nw.BUILT_KIND, 8)    # even once the kind has a wave row
    a = _client().get(URL + "builtWidget")
    b = _client().get(URL + "noSuchKind")
    assert a.status_code == 404 and b.status_code == 404
    assert a.json() == b.json()
    assert seen == []
