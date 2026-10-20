"""Discord /cot: the site's COT Data page (charts + positioning panel) as an image.

Owner request 2026-10-19: the COT command should be "a render image of our COT DATA
charts we created in the breadth section". These rails pin the command, the market
resolver, the channel/defer contract, the four token doors the logged-out render page
reads through, and the image valve.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.discord_harness import UT_GUILD, _app_client, _keypair, _post

EPHEMERAL = 64


# ── the command ──────────────────────────────────────────────────────────────

def test_cot_is_registered_once_guild_only_with_a_required_autocompleted_market():
    from api.services import discord_interactions as di
    cmds = [c for c in di.build_commands() if c["name"] == "cot"]
    assert len(cmds) == 1
    cmd = cmds[0]
    assert cmd["integration_types"] == [0] and cmd["contexts"] == [0]
    market, lookback = cmd["options"]
    assert market["name"] == "market" and market["required"] is True and market["autocomplete"] is True
    assert lookback["name"] == "lookback" and lookback["required"] is False
    assert [c["value"] for c in lookback["choices"]] == ["1Y", "2Y", "3Y", "5Y"]


@pytest.mark.parametrize("typed,sym", [
    ("ES", "ES"), ("es", "ES"), ("$gc", "GC"), ("gold", "GC"), ("Crude Oil (WTI)", "CL"),
    ("bitcoin", "BTC"), ("10-year", "ZN"),
])
def test_a_typed_market_resolves_to_its_symbol(typed, sym):
    from api.services import discord_interactions as di
    assert di.resolve_cot_market(typed) == sym


@pytest.mark.parametrize("typed", ["", "   ", "NVDA", "wheat", "zzz"])
def test_an_unknown_or_ambiguous_market_resolves_to_nothing(typed):
    """"wheat" names three markets (SRW, HRW, Spring); guessing one would chart the wrong one."""
    from api.services import discord_interactions as di
    assert di.resolve_cot_market(typed) is None


def test_autocomplete_lists_symbols_first_then_names_and_is_never_blank():
    from api.services import discord_interactions as di
    assert len(di.cot_market_choices("")) > 0
    gc = di.cot_market_choices("GC")
    assert gc[0]["value"] == "GC" and gc[0]["name"].startswith("GC ")
    assert "GC" in [c["value"] for c in di.cot_market_choices("gold")]
    assert all(len(c["name"]) <= 100 for c in di.cot_market_choices("", 25))


def test_the_chart_help_points_cot_at_its_own_command():
    from api.services import discord_interactions as di
    t = di.chart_help_text()
    assert "/cot ES" in t and "UCTESCOMM" not in t and len(t) < 2000


# ── the interaction ──────────────────────────────────────────────────────────

def _cot(market="ES", lookback=None, uid="900", token="tok", channel="555"):
    opts = [{"name": "market", "type": 3, "value": market}]
    if lookback:
        opts.append({"name": "lookback", "type": 3, "value": lookback})
    return {"type": 2, "application_id": "123", "token": token, "guild_id": UT_GUILD, "channel_id": channel,
            "member": {"user": {"id": uid}}, "data": {"name": "cot", "options": opts}}


@pytest.fixture()
def route(monkeypatch):
    from api.services import discord_interactions as di
    di.reset_rate_for_tests()
    monkeypatch.delenv("CHART_FLOW_CHANNEL_ID", raising=False)
    monkeypatch.delenv("FLOW_CMD_CHANNEL_ID", raising=False)
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    return client, sk, rt


def test_a_cot_request_defers_PUBLICLY_and_schedules_the_render(route, monkeypatch):
    client, sk, rt = route
    jobs = []
    monkeypatch.setattr(rt, "run_cot_job", lambda *a, **k: jobs.append(a))
    r = _post(client, sk, _cot("gold", "5y")).json()
    assert r["type"] == 5 and "flags" not in (r.get("data") or {}), "a /cot chart is posted for the channel"
    assert jobs == [("123", "tok", "GC", "5Y")]


def test_an_unknown_market_is_answered_privately_with_examples(route, monkeypatch):
    client, sk, rt = route
    monkeypatch.setattr(rt, "run_cot_job", lambda *a, **k: pytest.fail("no render for an unknown market"))
    r = _post(client, sk, _cot("NVDA")).json()
    assert r["type"] == 4 and r["data"]["flags"] == EPHEMERAL and "/cot ES" in r["data"]["content"]


def test_cot_is_held_to_the_chart_channel(route, monkeypatch):
    client, sk, rt = route
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", "777")
    monkeypatch.setattr(rt, "run_cot_job", lambda *a, **k: pytest.fail("refused outside the channel"))
    r = _post(client, sk, _cot(channel="555")).json()
    assert r["type"] == 4 and r["data"]["flags"] == EPHEMERAL and "777" in r["data"]["content"]


def test_cot_spends_the_shared_render_budget(route, monkeypatch):
    client, sk, rt = route
    monkeypatch.setenv("DISCORD_CHART_USER_RATE", "1/60")
    monkeypatch.setattr(rt, "run_cot_job", lambda *a, **k: None)
    assert _post(client, sk, _cot()).json()["type"] == 5
    r = _post(client, sk, _cot()).json()
    assert r["type"] == 4 and "COT charts" in r["data"]["content"]


def test_cot_autocomplete_answers_with_markets(route):
    client, sk, rt = route
    body = {"type": 4, "application_id": "123", "guild_id": UT_GUILD,
            "data": {"name": "cot", "options": [{"name": "market", "type": 3, "value": "gol", "focused": True}]}}
    r = _post(client, sk, body).json()
    assert r["type"] == 8 and "GC" in [c["value"] for c in r["data"]["choices"]]


def test_the_job_posts_the_image_and_words_when_it_cannot(route):
    client, sk, rt = route
    edits = []
    rt.run_cot_job("APP", "TOK", "ES", "1Y", render_fn=lambda s, lb, cls: b"\x89PNG-es",
                   edit_fn=lambda a, t, **kw: edits.append(kw))
    assert edits[0]["png"] == b"\x89PNG-es" and edits[0]["filename"] == "cot-es.png"
    assert "**ES**" in edits[0]["content"] and "1Y" in edits[0]["content"]

    calls = []

    def boom(*a, **k):
        calls.append(1)
        raise RuntimeError("renderer down")
    rt.run_cot_job("APP", "TOK", "ES", "1Y", render_fn=boom, edit_fn=lambda a, t, **kw: edits.append(kw))
    assert "png" not in edits[1] and "could not be drawn" in edits[1]["content"]
    assert len(calls) == 2, "one retry, then words"


def test_a_cold_first_render_is_retried_once(route):
    """Measured live 2026-10-19: the first /cot ES after a deploy came back undrawn; the
    same request a minute later drew. The member should not have to send it twice."""
    client, sk, rt = route
    edits, tries = [], []

    def cold_then_warm(*a, **k):
        tries.append(1)
        return None if len(tries) == 1 else b"\x89PNG-warm"
    rt.run_cot_job("APP", "TOK", "ES", "1Y", render_fn=cold_then_warm,
                   edit_fn=lambda a, t, **kw: edits.append(kw))
    assert len(tries) == 2 and edits == [edits[0]] and edits[0]["png"] == b"\x89PNG-warm"


def test_the_renderer_is_given_time_for_a_cold_market(img):
    """GC 5Y measured 26.8 s cold; 25 s lost the first /cot after a deploy. The renderer caps at 60 s."""
    from api.services.render_gate import MEMBER
    c = _Client()
    img.render_cot_png("GC", "5Y", cls=MEMBER, client=c)
    assert 40000 <= c.calls[0]["ready_timeout_ms"] <= 60000
    assert img.RENDER_TIMEOUT_S * 1000 > c.calls[0]["ready_timeout_ms"]


def test_the_job_never_raises_even_when_discord_is_down(route):
    client, sk, rt = route

    def cannot_send(*a, **k):
        raise RuntimeError("discord down")
    rt.run_cot_job("APP", "TOK", "ES", "1Y", render_fn=lambda *a, **k: None, edit_fn=cannot_send)


# ── the render doors ─────────────────────────────────────────────────────────

@pytest.fixture()
def doors(monkeypatch):
    from api.routers import render_panels as rp
    monkeypatch.setenv("CHART_RENDER_TOKEN", "rail-token")
    monkeypatch.delenv("CHART_RENDER_TOKEN_PREVIOUS", raising=False)
    rp._RL_BUCKETS.pop("cot", None)
    app = FastAPI()
    app.include_router(rp.router)
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("path", ["/api/r/cot-symbols", "/api/r/cot/ES", "/api/r/cot/ES/price",
                                  "/api/r/cot/ES/narrative?report_date=2026-10-13"])
def test_every_cot_door_needs_the_render_token(doors, path):
    assert doors.get(path).status_code == 403


@pytest.mark.parametrize("path", ["/api/r/cot/NVDA?token=rail-token", "/api/r/cot/SPY/price?token=rail-token",
                                  "/api/r/cot/AAPL/narrative?token=rail-token&report_date=2026-10-13"])
def test_the_doors_answer_only_cot_markets(doors, path):
    assert doors.get(path).status_code == 404


def test_the_rows_door_reads_cot_service_within_the_sites_bound(doors, monkeypatch):
    from api.services import cot_service
    seen = []
    monkeypatch.setattr(cot_service, "get_cot_data", lambda s, w: (seen.append((s, w)), [{"date": "2026-10-13"}])[1])
    assert doors.get("/api/r/cot/es?token=rail-token&weeks=9999").json() == [{"date": "2026-10-13"}]
    doors.get("/api/r/cot/GC?token=rail-token&weeks=52")
    assert seen == [("ES", 520), ("GC", 52)]


def test_the_symbols_door_mirrors_the_paid_list(doors):
    from api.services import cot_service
    g = doors.get("/api/r/cot-symbols?token=rail-token").json()["groups"]
    assert set(g) == set(cot_service.SYMBOL_GROUPS)
    flat = {e["symbol"]: e["name"] for es in g.values() for e in es}
    assert flat["GC"] == cot_service.SYMBOL_NAMES["GC"]


def test_the_price_door_resolves_the_proxy_itself(doors, monkeypatch):
    from api.services import cot_prewarm
    fetched = []
    monkeypatch.setattr(cot_prewarm, "proxies", lambda: {"CL": {"ticker": "USO", "note": "via USO"}, "ZR": None})
    monkeypatch.setattr(cot_prewarm, "fetch_proxy_bars", lambda t: (fetched.append(t), [{"c": 70.1}])[1])
    assert doors.get("/api/r/cot/CL/price?token=rail-token").json() == {"ticker": "USO", "bars": [{"c": 70.1}]}
    assert doors.get("/api/r/cot/ZR/price?token=rail-token").json() == {"ticker": None, "bars": []}
    assert fetched == ["USO"]


def test_the_narrative_door_reads_the_stored_read_and_NEVER_generates(doors, monkeypatch):
    from api.services import cot_narrative
    monkeypatch.setattr(cot_narrative, "get_or_create",
                        lambda *a, **k: pytest.fail("the token door must never call the model"))
    store = {("ES", "2026-10-13"): {"text": "Commercials are heavily short."}}
    monkeypatch.setattr(cot_narrative, "get_for", lambda s, d: store.get((s, d)))
    ok = doors.get("/api/r/cot/ES/narrative?token=rail-token&report_date=2026-10-13").json()
    assert ok == {"status": "ok", "text": "Commercials are heavily short."}
    none = doors.get("/api/r/cot/ES/narrative?token=rail-token&report_date=2026-10-06").json()
    assert none["status"] == "unavailable" and none["text"] is None
    assert doors.get("/api/r/cot/ES/narrative?token=rail-token&report_date=last-week").status_code == 400


# ── the image valve ──────────────────────────────────────────────────────────

class _Resp:
    def __init__(self, probe=5, content=b"\x89PNG-cot", status=200):
        self.content = content
        self.status_code = status
        self.is_success = 200 <= status < 300
        self.text = ""
        self.headers = {} if probe is None else {"X-Chart-Probe": str(probe)}


class _Client:
    def __init__(self, resp=None):
        self.calls = []
        self.resp = resp or _Resp()

    def post(self, url, **kw):
        self.calls.append(kw["json"])
        return self.resp

    def close(self):
        pass


@pytest.fixture()
def img(monkeypatch):
    from api.services import cot_image
    monkeypatch.setenv("CHART_RENDERER_URL", "http://renderer.local")
    monkeypatch.setenv("CHART_RENDER_BASE_URL", "http://app.local")
    monkeypatch.setenv("CHART_RENDER_TOKEN", "tkn")
    cot_image._reset_for_tests()
    yield cot_image
    cot_image._reset_for_tests()


def test_the_render_asks_for_the_cot_page_and_caches_per_market_and_lookback(img):
    from api.services.render_gate import MEMBER
    c = _Client()
    assert img.render_cot_png("es", "2y", cls=MEMBER, client=c) == b"\x89PNG-cot"
    assert img.render_cot_png("ES", "2Y", cls=MEMBER, client=c) == b"\x89PNG-cot"
    assert len(c.calls) == 1, "the second request inside the TTL must not re-render"
    job = c.calls[0]
    assert job["selector"] == "#cot-export"
    assert job["url"].startswith("http://app.local/r/cot?") and "symbol=ES" in job["url"] and "lookback=2Y" in job["url"]
    img.render_cot_png("ES", "1Y", cls=MEMBER, client=c)
    assert len(c.calls) == 2


@pytest.mark.parametrize("probe", [0, 3, -1900])
def test_a_page_that_did_not_draw_or_drew_at_the_wrong_width_is_discarded(img, probe):
    from api.services.render_gate import MEMBER
    c = _Client(_Resp(probe=probe))
    assert img.render_cot_png("ES", "1Y", cls=MEMBER, client=c) is None
    assert img.render_cot_png("ES", "1Y", cls=MEMBER, client=c) is None
    assert len(c.calls) == 2, "a discarded render must not be cached"


def test_a_lookback_outside_the_four_is_the_default(img):
    assert img.normalize_lookback("10y") == "1Y" and img.normalize_lookback("3y") == "3Y"


def test_the_probe_reads_the_width_from_the_page_not_a_restated_number(img):
    from pathlib import Path
    page = Path("app/src/pages/CotRender.jsx").read_text(encoding="utf-8")
    assert "window.__cotBoardW = COT_EXPORT_W" in page and 'id="cot-export"' in page
    assert "__cotBoardW" in img.PROBE_JS and "1560" not in img.PROBE_JS
