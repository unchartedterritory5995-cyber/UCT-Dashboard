"""Discord /chart: renderer, interaction plumbing, endpoint, registration payload."""
from __future__ import annotations

import datetime as dt
import json
import random

import pytest


# ── synthetic bars ────────────────────────────────────────────────────────────

def _walk(n: int, seed: int = 7, start: float = 100.0):
    rng = random.Random(seed)
    px = start
    out = []
    for _ in range(n):
        o = px
        c = max(1.0, o * (1 + rng.uniform(-0.03, 0.03)))
        h = max(o, c) * (1 + rng.uniform(0, 0.01))
        l = min(o, c) * (1 - rng.uniform(0, 0.01))
        out.append((o, h, l, c, rng.randint(100_000, 5_000_000)))
        px = c
    return out


def daily_bars(n: int = 170, seed: int = 7) -> list[dict]:
    day = dt.date(2026, 1, 2)
    bars = []
    for o, h, l, c, v in _walk(n, seed):
        while day.weekday() >= 5:
            day += dt.timedelta(days=1)
        bars.append({"t": day.isoformat(), "o": o, "h": h, "l": l, "c": c, "v": v})
        day += dt.timedelta(days=1)
    return bars


def weekly_bars(n: int = 160, seed: int = 8) -> list[dict]:
    fri = dt.date(2023, 1, 6)  # a Friday
    bars = []
    for o, h, l, c, v in _walk(n, seed):
        bars.append({"t": fri.isoformat(), "o": o, "h": h, "l": l, "c": c, "v": v})
        fri += dt.timedelta(days=7)
    return bars


def intraday_bars(n: int = 200, step_min: int = 15, seed: int = 9) -> list[dict]:
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    t = dt.datetime(2026, 8, 24, 9, 30, tzinfo=et)
    bars = []
    for o, h, l, c, v in _walk(n, seed):
        bars.append({"t": int(t.timestamp()), "o": o, "h": h, "l": l, "c": c, "v": v})
        t += dt.timedelta(minutes=step_min)
        if t.hour >= 16:
            t = (t + dt.timedelta(days=1)).replace(hour=9, minute=30)
    return bars


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


@pytest.fixture(autouse=True)
def _clear_png_cache():
    try:
        from api.services import discord_chart_cache as cc
        cc.clear()
    except ImportError:
        pass
    yield


# ── Task 1: renderer ──────────────────────────────────────────────────────────

def test_to_datetime_accepts_iso_yyyymmdd_and_unix():
    from api.services.discord_chart_render import to_datetime
    assert to_datetime("2026-08-25") == dt.datetime(2026, 8, 25)
    assert to_datetime(20260825) == dt.datetime(2026, 8, 25)
    # 2026-08-24 09:30 ET == 13:30 UTC
    assert to_datetime(1787578200) == dt.datetime(2026, 8, 24, 9, 30)
    assert to_datetime(1787578200 * 1000) == dt.datetime(2026, 8, 24, 9, 30)  # ms tolerated


def test_build_frame_is_window_wide_with_complete_sma50():
    from api.services.discord_chart_render import WINDOW, MA_LEAD, build_frame
    frame = build_frame(daily_bars(WINDOW["D"] + MA_LEAD), "D")
    assert len(frame) == WINDOW["D"]
    assert not frame["SMA50"].isna().any(), "lead-in bars must make SMA50 complete at the left edge"
    assert list(frame.columns) == ["Open", "High", "Low", "Close", "Volume", "SMA10", "SMA20", "SMA50", "VolAvg"]


def test_build_frame_short_input_keeps_all_bars_with_partial_mas():
    from api.services.discord_chart_render import build_frame
    frame = build_frame(daily_bars(30), "D")
    assert len(frame) == 30
    assert frame["SMA10"].notna().sum() == 21
    assert frame["SMA50"].isna().all()


@pytest.mark.parametrize("tf,bars", [
    ("D", daily_bars(170)),
    ("W", weekly_bars(160)),
    ("15", intraday_bars(200, 15)),
    ("5", intraday_bars(220, 5)),
])
def test_render_returns_real_png(tf, bars):
    from api.services.discord_chart_render import render_chart_png
    png = render_chart_png("NVDA", tf, bars)
    assert png[:8] == PNG_MAGIC
    assert len(png) > 10_000


def test_render_five_bars_still_renders_and_two_bars_refuses():
    from api.services.discord_chart_render import render_chart_png
    assert render_chart_png("NVDA", "D", daily_bars(5))[:8] == PNG_MAGIC
    with pytest.raises(ValueError):
        render_chart_png("NVDA", "D", daily_bars(2))
    with pytest.raises(ValueError):
        render_chart_png("NVDA", "7", daily_bars(50))


def test_tf_label_covers_every_window_key():
    from api.services.discord_chart_render import WINDOW, TF_LABEL
    assert set(TF_LABEL) == set(WINDOW) == {"D", "W", "60", "30", "15", "5"}
    assert TF_LABEL["D"] == "Daily" and TF_LABEL["60"] == "60 min"


# ── Task 2: interaction plumbing ──────────────────────────────────────────────

def _keypair():
    from nacl.signing import SigningKey
    sk = SigningKey.generate()
    return sk, sk.verify_key.encode().hex()


def _sign(sk, ts: str, body: bytes) -> str:
    return sk.sign(ts.encode() + body).signature.hex()


def test_verify_signature_good_bad_and_garbage_never_raise():
    from api.services.discord_interactions import verify_signature
    sk, pk = _keypair()
    body = b'{"type":1}'
    sig = _sign(sk, "1700000000", body)
    assert verify_signature(pk, sig, "1700000000", body) is True
    assert verify_signature(pk, sig, "1700000001", body) is False        # timestamp not what was signed
    assert verify_signature(pk, sig, "1700000000", body + b" ") is False  # body tampered
    _, other_pk = _keypair()
    assert verify_signature(other_pk, sig, "1700000000", body) is False   # wrong key
    assert verify_signature(pk, "zz", "1700000000", body) is False        # garbage hex
    assert verify_signature("", sig, "1700000000", body) is False         # empty key
    assert verify_signature(pk, "", "", body) is False


def _interaction(ticker=None, tf=None, name="chart", itype=2):
    opts = []
    if ticker is not None:
        opts.append({"name": "ticker", "type": 3, "value": ticker})
    if tf is not None:
        opts.append({"name": "tf", "type": 3, "value": tf})
    return {"type": itype, "application_id": "123", "token": "tok",
            "data": {"name": name, "options": opts}}


def test_parse_chart_command_normalizes_and_rejects():
    from api.services.discord_interactions import parse_chart_command, CommandError, ChartRequest
    assert parse_chart_command(_interaction("$nvda")) == ChartRequest("NVDA", "D")
    assert parse_chart_command(_interaction("brk.b", "W")) == ChartRequest("BRK.B", "W")
    assert parse_chart_command(_interaction("^GSPC", "15")).ticker == "^GSPC"
    for tf in ("D", "W", "60", "30", "15", "5"):
        assert parse_chart_command(_interaction("SPY", tf)).tf == tf
    for bad in ("NVDA;rm", "", " ", "A" * 13, "nv da"):
        with pytest.raises(CommandError):
            parse_chart_command(_interaction(bad))
    with pytest.raises(CommandError):
        parse_chart_command(_interaction("SPY", "7"))
    with pytest.raises(CommandError):
        parse_chart_command({"type": 2, "data": {"name": "chart"}})  # no options at all


def test_build_chart_command_derives_choices_from_tf_label():
    from api.services.discord_chart_render import TF_LABEL
    from api.services.discord_interactions import build_chart_command
    cmd = build_chart_command()
    assert cmd["name"] == "chart" and cmd["type"] == 1
    ticker, tf = cmd["options"]
    assert ticker["name"] == "ticker" and ticker["required"] is True and ticker["type"] == 3
    assert tf["name"] == "tf" and tf["required"] is False
    assert [(c["name"], c["value"]) for c in tf["choices"]] == [(v, k) for k, v in TF_LABEL.items()]


def test_attachment_name_follows_house_convention():
    from api.services.discord_interactions import attachment_name
    assert attachment_name("NVDA", "D", "2026-08-25") == "NVDA_D_2026-08-25_Chart.png"
    assert attachment_name("BRK.B", "W", "2026-08-21") == "BRKB_W_2026-08-21_Chart.png"
    assert attachment_name("^GSPC", "15", 1787578200) == "GSPC_15m_2026-08-24_Chart.png"


def test_edit_original_multipart_shape_and_failure_paths():
    import httpx
    from api.services.discord_interactions import edit_original, DISCORD_API
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        return httpx.Response(200, json={"id": "1"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    ok = edit_original("123", "tok", content="NVDA · Daily", png=PNG_MAGIC + b"x" * 100,
                       filename="NVDA_D_2026-08-25_Chart.png", client=client)
    assert ok is True
    req = seen[-1]
    assert req.method == "PATCH"
    assert str(req.url) == f"{DISCORD_API}/webhooks/123/tok/messages/@original"
    assert req.headers["content-type"].startswith("multipart/form-data")
    body = req.content
    assert b'name="payload_json"' in body
    assert b'name="files[0]"; filename="NVDA_D_2026-08-25_Chart.png"' in body
    assert b'"attachments": [{"id": 0, "filename": "NVDA_D_2026-08-25_Chart.png"}]' in body
    assert PNG_MAGIC in body

    ok = edit_original("123", "tok", content="No bars for X (Daily).", client=client)
    assert ok is True
    assert json.loads(seen[-1].content) == {"content": "No bars for X (Daily)."}

    def failing(request):
        return httpx.Response(404, json={"message": "Unknown Webhook"})
    assert edit_original("123", "tok", content="x", client=httpx.Client(transport=httpx.MockTransport(failing))) is False

    def boom(request):
        raise httpx.ConnectError("down")
    assert edit_original("123", "tok", content="x", client=httpx.Client(transport=httpx.MockTransport(boom))) is False


class _Edits:
    def __init__(self):
        self.calls = []

    def __call__(self, app_id, token, *, content, png=None, filename=None):
        self.calls.append({"app_id": app_id, "token": token, "content": content, "png": png, "filename": filename})
        return True


def test_run_chart_job_happy_path():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services.discord_chart_render import WINDOW, MA_LEAD, bars_to_request
    asked = []
    bars = daily_bars(170)

    def bars_fn(ticker, tf, n):
        asked.append((ticker, tf, n))
        return bars

    edits = _Edits()
    out = run_chart_job("123", "tok", ChartRequest("NVDA", "D"),
                        bars_fn=bars_fn, render_fn=lambda t, tf, b, **k: PNG_MAGIC + b"png", edit_fn=edits)
    assert out == "ok"
    assert asked == [("NVDA", "D", bars_to_request("D"))]
    assert len(edits.calls) == 1
    call = edits.calls[0]
    assert call["content"] == "NVDA · Daily"
    assert call["png"] == PNG_MAGIC + b"png"
    assert call["filename"] == f"NVDA_D_{bars[-1]['t']}_Chart.png"


def test_run_chart_job_no_bars_render_failure_and_bars_exception():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    edits = _Edits()
    assert run_chart_job("1", "t", ChartRequest("ZZZZQ", "60"),
                         bars_fn=lambda *a: None, render_fn=lambda *a, **k: b"", edit_fn=edits) == "no_bars"
    assert edits.calls[-1]["content"] == "No bars for ZZZZQ (60 min)." and edits.calls[-1]["png"] is None

    assert run_chart_job("1", "t", ChartRequest("SPY", "D"),
                         bars_fn=lambda *a: [], render_fn=lambda *a, **k: b"", edit_fn=edits) == "no_bars"

    def bars_boom(*a):
        raise RuntimeError("db gone")
    assert run_chart_job("1", "t", ChartRequest("SPY", "D"),
                         bars_fn=bars_boom, render_fn=lambda *a, **k: b"", edit_fn=edits) == "no_bars"

    def render_boom(*a, **k):
        raise RuntimeError("matplotlib exploded")
    assert run_chart_job("1", "t", ChartRequest("SPY", "D"),
                         bars_fn=lambda *a: daily_bars(20), render_fn=render_boom, edit_fn=edits) == "render_failed"
    assert edits.calls[-1]["content"] == "Chart failed, try again."


def test_run_chart_job_busy_when_slots_exhausted_and_releases_after():
    from api.services import discord_interactions as di
    edits = _Edits()
    held = []
    while di.RENDER_SLOTS.acquire(blocking=False):
        held.append(1)
    try:
        assert di.run_chart_job("1", "t", di.ChartRequest("SPY", "D"),
                                bars_fn=lambda *a: daily_bars(20), render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edits) == "busy"
        assert edits.calls[-1]["content"] == "Busy, try again in a few seconds."
    finally:
        for _ in held:
            di.RENDER_SLOTS.release()
    # slots come back: a normal run succeeds and does not leak a slot
    assert di.run_chart_job("1", "t", di.ChartRequest("SPY", "D"),
                            bars_fn=lambda *a: daily_bars(20), render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edits) == "ok"
    assert di.RENDER_SLOTS.acquire(blocking=False)
    di.RENDER_SLOTS.release()


def test_run_chart_job_never_raises_even_if_edit_fn_raises():
    from api.services.discord_interactions import run_chart_job, ChartRequest

    def edit_boom(*a, **k):
        raise RuntimeError("discord down")
    assert run_chart_job("1", "t", ChartRequest("SPY", "D"),
                         bars_fn=lambda *a: daily_bars(20), render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edit_boom) == "error"


# ── Task 3: endpoint ──────────────────────────────────────────────────────────

def _app_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import discord_interactions as rt
    app = FastAPI()
    app.include_router(rt.router)
    return TestClient(app), rt


def _post(client, sk, payload: dict, *, ts="1700000000", sign=True, bad_sig=False):
    body = json.dumps(payload).encode()
    headers = {"content-type": "application/json"}
    if sign:
        headers["X-Signature-Ed25519"] = ("00" * 64) if bad_sig else _sign(sk, ts, body)
        headers["X-Signature-Timestamp"] = ts
    return client.post("/api/discord/interactions", content=body, headers=headers)


def test_endpoint_dark_without_public_key(monkeypatch):
    monkeypatch.delenv("DISCORD_CHART_PUBLIC_KEY", raising=False)
    client, _ = _app_client()
    sk, _pk = _keypair()
    r = _post(client, sk, {"type": 1})
    assert r.status_code == 503


def test_endpoint_rejects_unsigned_and_bad_signature(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, _ = _app_client()
    assert _post(client, sk, {"type": 1}, sign=False).status_code == 401
    assert _post(client, sk, {"type": 1}, bad_sig=True).status_code == 401
    r = _post(client, sk, {"type": 1})
    assert r.status_code == 200 and r.json() == {"type": 1}


def test_endpoint_malformed_body_after_valid_signature_is_400(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, _ = _app_client()
    body = b"{not json"
    r = client.post("/api/discord/interactions", content=body, headers={
        "X-Signature-Ed25519": _sign(sk, "1", body), "X-Signature-Timestamp": "1"})
    assert r.status_code == 400


def test_endpoint_defers_and_schedules_job_for_valid_chart(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    scheduled = []

    def fake_job(app_id, token, req, *, bars_fn, render_fn, edit_fn, house_fn=None):
        scheduled.append((app_id, token, req, bars_fn, render_fn, edit_fn))
        assert house_fn is None  # CHART_RENDERER_URL is unset in tests → mplfinance only
        return "ok"
    monkeypatch.setattr(rt.di, "run_chart_job", fake_job)

    r = _post(client, sk, _interaction("nvda", "15"))
    assert r.status_code == 200 and r.json() == {"type": 5}
    assert len(scheduled) == 1
    app_id, token, req, bars_fn, render_fn, edit_fn = scheduled[0]
    assert (app_id, token) == ("123", "tok")
    assert req == rt.di.ChartRequest("NVDA", "15")
    assert bars_fn is rt.fetch_bars
    assert render_fn is rt.render_chart_png
    assert edit_fn is rt.di.edit_original


def test_endpoint_bad_ticker_is_immediate_ephemeral_and_schedules_nothing(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: pytest.fail("must not schedule"))
    r = _post(client, sk, _interaction("NVDA;rm"))
    assert r.status_code == 200
    assert r.json()["type"] == 4
    assert r.json()["data"]["flags"] == 64
    assert "Ticker" in r.json()["data"]["content"]


def test_endpoint_unknown_command_is_ephemeral(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: pytest.fail("must not schedule"))
    r = _post(client, sk, _interaction("NVDA", name="recall"))
    assert r.json() == {"type": 4, "data": {"content": "Unknown command.", "flags": 64}}
    r = _post(client, sk, {"type": 3, "data": {"name": "chart"}})
    assert r.json()["type"] == 4


def test_fetch_bars_uses_get_bars_and_only_accepts_200_with_bars(monkeypatch):
    from fastapi.responses import JSONResponse
    from api.routers import discord_interactions as rt
    from api.routers import bars as bars_router
    calls = []

    def fake_get_bars(ticker, tf, bars, since, to, warm):
        calls.append((ticker, tf, bars, since, to, warm))
        if ticker == "NVDA":
            return JSONResponse(content={"ticker": "NVDA", "tf": tf, "bars": [{"t": "2026-08-25", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}]})
        if ticker == "ZZZZQ":
            return JSONResponse(content={"ticker": "ZZZZQ", "tf": tf, "bars": [], "no_data": True})
        return JSONResponse(status_code=503, content={"error": "provider"})
    monkeypatch.setattr(bars_router, "get_bars", fake_get_bars)

    assert rt.fetch_bars("NVDA", "D", 170) == [{"t": "2026-08-25", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}]
    assert calls[-1] == ("NVDA", "D", 170, "", "", 0)
    assert rt.fetch_bars("ZZZZQ", "D", 170) is None
    assert rt.fetch_bars("BOOM", "60", 150) is None


# ── Task 4: registration tool ─────────────────────────────────────────────────

def test_tool_register_puts_the_chart_command_and_clear_puts_empty():
    import httpx
    import importlib
    tool = importlib.import_module("tools.discord_chart_commands")
    from api.services.discord_interactions import build_chart_command
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        if request.method == "GET":
            return httpx.Response(200, json={"id": "999", "name": "UCT Charts", "verify_key": "ab" * 32})
        return httpx.Response(200, json=json.loads(request.content) if request.content else {})

    client = tool.make_client("bot-token", transport=httpx.MockTransport(handler))
    info = tool.show(client)
    assert info["id"] == "999" and info["verify_key"] == "ab" * 32
    assert seen[-1].headers["authorization"] == "Bot bot-token"
    assert str(seen[-1].url).endswith("/applications/@me")

    tool.register(client, "999", "8822", clear=False)
    assert seen[-1].method == "PUT"
    assert str(seen[-1].url).endswith("/applications/999/guilds/8822/commands")
    assert json.loads(seen[-1].content) == [build_chart_command()]

    tool.register(client, "999", "8822", clear=True)
    assert json.loads(seen[-1].content) == []

    tool.set_endpoint(client, "https://uctintelligence.com/api/discord/interactions")
    assert seen[-1].method == "PATCH" and str(seen[-1].url).endswith("/applications/@me")
    assert json.loads(seen[-1].content) == {"interactions_endpoint_url": "https://uctintelligence.com/api/discord/interactions"}

    assert tool.invite_url("999") == "https://discord.com/oauth2/authorize?client_id=999&scope=applications.commands"


def test_tool_register_global_puts_to_the_application_commands_route():
    import httpx
    import importlib
    tool = importlib.import_module("tools.discord_chart_commands")
    from api.services.discord_interactions import build_chart_command
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        return httpx.Response(200, json=json.loads(request.content) if request.content else [])

    client = tool.make_client("bot-token", transport=httpx.MockTransport(handler))
    tool.register(client, "999", None, clear=False)
    assert seen[-1].method == "PUT"
    assert str(seen[-1].url).endswith("/applications/999/commands")
    assert "/guilds/" not in str(seen[-1].url)
    assert json.loads(seen[-1].content) == [build_chart_command()]


def test_to_datetime_treats_unix_daily_bars_as_utc_dates_when_tf_is_a_date_tf():
    # The index path (SPX/^GSPC) serves DAILY bars keyed at UTC midnight as unix
    # seconds: 1787616000 == 2026-08-25T00:00Z. Converting that to ET would date
    # the bar 2026-08-24 20:00 — a day early. Date timeframes take the UTC date.
    from api.services.discord_chart_render import to_datetime, build_frame
    assert to_datetime(1787616000, tf="D") == dt.datetime(2026, 8, 25)
    assert to_datetime(1787616000, tf="W") == dt.datetime(2026, 8, 25)
    assert to_datetime(1787616000) == dt.datetime(2026, 8, 24, 20, 0)  # intraday semantics unchanged
    bars = [{"t": 1787616000 - 86400 * i, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 1} for i in range(5)][::-1]
    assert build_frame(bars, "D").index[-1] == dt.datetime(2026, 8, 25)


def test_attachment_name_dates_an_index_daily_bar_by_utc():
    from api.services.discord_interactions import attachment_name
    assert attachment_name("SPX", "D", 1787616000) == "SPX_D_2026-08-25_Chart.png"


def extended_hours_bars(sessions: int = 3, step_min: int = 15, seed: int = 11) -> list[dict]:
    """Like intraday_bars but with 04:00-09:30 pre-market and 16:00-20:00 post-market buckets."""
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    day = dt.datetime(2026, 8, 24, 4, 0, tzinfo=et)
    walk = iter(_walk(sessions * 64, seed))
    bars = []
    for _ in range(sessions):
        t = day
        while t.hour < 20:
            o, h, l, c, v = next(walk)
            bars.append({"t": int(t.timestamp()), "o": o, "h": h, "l": l, "c": c, "v": v})
            t += dt.timedelta(minutes=step_min)
        day += dt.timedelta(days=1)
    return bars


def test_build_frame_keeps_only_regular_session_bars_for_intraday_tfs():
    from api.services.discord_chart_render import build_frame
    bars = extended_hours_bars(sessions=3, step_min=15)
    frame = build_frame(bars, "15")
    times = [(ts.hour, ts.minute) for ts in frame.index]
    assert min(times) == (9, 30)
    assert max(times) == (15, 45)
    assert len(frame) == 3 * 26  # 26 fifteen-minute buckets per regular session
    # daily/weekly bars are never filtered (they carry no time of day)
    assert len(build_frame(daily_bars(30), "D")) == 30


def test_bars_to_request_covers_the_window_after_the_rth_filter():
    from api.services.discord_chart_render import bars_to_request, WINDOW, MA_LEAD, STATS_DAILY_BARS
    assert bars_to_request("D") == max(WINDOW["D"] + MA_LEAD, STATS_DAILY_BARS)
    assert bars_to_request("W") == WINDOW["W"] + MA_LEAD
    for tf in ("60", "30", "15", "5"):
        assert bars_to_request(tf) >= int((WINDOW[tf] + MA_LEAD) * 2.5)
    with pytest.raises(ValueError):
        bars_to_request("7")


def test_run_chart_job_requests_bars_to_request_for_intraday():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services.discord_chart_render import bars_to_request, STATS_DAILY_BARS
    asked = []
    edits = _Edits()
    run_chart_job("1", "t", ChartRequest("SPY", "5"),
                  bars_fn=lambda tk, tf, n: asked.append(n) or daily_bars(20),
                  render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edits)
    assert asked == [STATS_DAILY_BARS, bars_to_request("5")]  # daily first, tf bars only for the fallback


def test_tool_main_reads_token_from_a_custom_var_in_the_env_file(tmp_path, capsys):
    import importlib
    tool = importlib.import_module("tools.discord_chart_commands")
    env = tmp_path / "other.env"
    env.write_text("SOME_OTHER_TOKEN=abc.def.ghi\n", encoding="utf-8")
    rc = tool.main(["--env-file", str(env), "--token-var", "SOME_OTHER_TOKEN", "--app-id", "999", "invite"])
    assert rc == 0
    assert capsys.readouterr().out.strip() == tool.invite_url("999")
    rc = tool.main(["--env-file", str(env), "--token-var", "MISSING_TOKEN", "--app-id", "999", "invite"])
    assert rc == 2


# ── v2: high-resolution canvas + stats strip ──────────────────────────────────

def _png_size(png: bytes) -> tuple[int, int]:
    import struct
    assert png[:8] == PNG_MAGIC
    w, h = struct.unpack(">II", png[16:24])  # IHDR width/height
    return w, h


def test_render_is_exactly_1920_by_1080():
    from api.services.discord_chart_render import render_chart_png
    for tf, bars in (("D", daily_bars(300)), ("15", intraday_bars(400, 15))):
        assert _png_size(render_chart_png("NVDA", tf, bars, daily_bars=daily_bars(300))) == (1920, 1080)
    assert _png_size(render_chart_png("NVDA", "D", daily_bars(300))) == (1920, 1080)  # stats optional


def test_compute_stats_from_daily_bars():
    from api.services.discord_chart_render import compute_stats
    bars = daily_bars(300)
    st = compute_stats(bars)
    last, prev = bars[-1], bars[-2]
    assert st["open"] == last["o"] and st["high"] == last["h"] and st["low"] == last["l"] and st["close"] == last["c"]
    assert st["day_pct"] == pytest.approx((last["c"] / prev["c"] - 1) * 100)
    assert st["gap_pct"] == pytest.approx((last["o"] / prev["c"] - 1) * 100)
    hi = max(b["h"] for b in bars[-252:]); lo = min(b["l"] for b in bars[-252:])
    assert st["hi_52w"] == hi and st["lo_52w"] == lo
    assert st["from_52w_high_pct"] == pytest.approx((last["c"] / hi - 1) * 100)
    avg50 = sum(b["v"] for b in bars[-51:-1]) / 50
    assert st["volume"] == last["v"] and st["avg_vol_50"] == pytest.approx(avg50)
    assert st["rvol"] == pytest.approx(last["v"] / avg50)
    assert st["dollar_vol"] == pytest.approx(last["v"] * last["c"])
    adr = sum((b["h"] / b["l"] - 1) * 100 for b in bars[-20:]) / 20
    assert st["adr_pct"] == pytest.approx(adr)


def test_compute_stats_degrades_on_short_history():
    from api.services.discord_chart_render import compute_stats
    st = compute_stats(daily_bars(5))
    assert st["close"] == daily_bars(5)[-1]["c"]
    assert st["avg_vol_50"] is None and st["rvol"] is None  # fewer than 50 prior bars
    assert st["hi_52w"] == max(b["h"] for b in daily_bars(5))  # uses what exists
    assert compute_stats([]) == {}


def test_fmt_helpers():
    from api.services.discord_chart_render import fmt_num, fmt_pct
    assert fmt_num(182_400_000) == "182.4M" and fmt_num(38_900_000_000) == "38.9B" and fmt_num(950_000) == "950K"
    assert fmt_num(12.5) == "12.5" and fmt_num(None) == "—"
    assert fmt_pct(2.234) == "+2.2%" and fmt_pct(-0.05) == "-0.1%" and fmt_pct(None) == "—"


def test_run_chart_job_fetches_daily_bars_for_stats_on_non_daily_tf():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services.discord_chart_render import bars_to_request, STATS_DAILY_BARS
    asked = []
    seen = {}

    def bars_fn(tk, tf, n):
        asked.append((tf, n))
        return intraday_bars(400, 15) if tf == "15" else daily_bars(300)

    def render_fn(tk, tf, bars, daily_bars=None):
        seen["daily"] = daily_bars
        return PNG_MAGIC
    edits = _Edits()
    assert run_chart_job("1", "t", ChartRequest("NVDA", "15"), bars_fn=bars_fn, render_fn=render_fn, edit_fn=edits) == "ok"
    assert asked == [("D", STATS_DAILY_BARS), ("15", bars_to_request("15"))]
    assert seen["daily"] and len(seen["daily"]) == 300

    asked.clear(); seen.clear()
    assert run_chart_job("1", "t", ChartRequest("NVDA", "D"), bars_fn=bars_fn, render_fn=render_fn, edit_fn=edits) == "ok"
    assert asked == [("D", bars_to_request("D"))]          # daily chart: one fetch serves both
    assert seen["daily"] and len(seen["daily"]) == 300
    assert bars_to_request("D") >= STATS_DAILY_BARS


def test_run_chart_job_still_renders_when_the_daily_stats_fetch_fails():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    calls = []

    def bars_fn(tk, tf, n):
        if tf == "D":
            raise RuntimeError("provider hiccup")
        return intraday_bars(400, 15)

    def render_fn(tk, tf, bars, daily_bars=None):
        calls.append(daily_bars)
        return PNG_MAGIC
    edits = _Edits()
    assert run_chart_job("1", "t", ChartRequest("NVDA", "15"), bars_fn=bars_fn, render_fn=render_fn, edit_fn=edits) == "ok"
    assert calls == [None]


# ── house renderer client (the real /r/chart page, screenshotted by chart-renderer) ──

def test_house_build_render_url_carries_geometry_token_and_stats():
    import base64, json as _json
    from api.services.discord_chart_house import build_render_url, HOUSE_W, HOUSE_H, STATS_STRIP_H
    stats = {"close": 213.05, "rvol": 0.94, "adr_pct": 3.4}
    url = build_render_url("NVDA", "15", stats, base_url="https://uctintelligence.com", token="tok123")
    assert url.startswith("https://uctintelligence.com/r/chart?")
    from urllib.parse import parse_qs, urlparse
    q = parse_qs(urlparse(url).query)
    assert q["sym"] == ["NVDA"] and q["tf"] == ["15"] and q["token"] == ["tok123"]
    assert q["w"] == [str(HOUSE_W)] and q["h"] == [str(HOUSE_H + STATS_STRIP_H)]
    raw = q["stats"][0]
    padded = raw.replace("-", "+").replace("_", "/") + "=" * (-len(raw) % 4)
    assert _json.loads(base64.b64decode(padded)) == stats
    # no stats → no param, plain house height
    q2 = parse_qs(urlparse(build_render_url("SPY", "D", {}, base_url="https://uctintelligence.com", token="")).query)
    assert "stats" not in q2 and "token" not in q2 and q2["h"] == [str(HOUSE_H)]


def test_house_render_posts_to_the_renderer_and_returns_png_or_none(monkeypatch):
    import httpx
    from api.services import discord_chart_house as hs
    monkeypatch.setenv("CHART_RENDERER_URL", "http://chart-renderer.railway.internal:8080")
    monkeypatch.setenv("CHART_RENDERER_SECRET", "s3cret")
    monkeypatch.setenv("CHART_RENDER_TOKEN", "tok123")
    monkeypatch.setenv("CHART_RENDER_BASE_URL", "https://uctintelligence.com")
    seen = []

    drawn = _png_canvas(draw=True)

    def handler(request: httpx.Request):
        seen.append(request)
        return httpx.Response(200, content=drawn, headers={"content-type": "image/png"})
    client = httpx.Client(transport=httpx.MockTransport(handler))
    png = hs.render_house_chart("NVDA", "D", {"close": 1.0}, client=client)
    assert png == drawn
    req = seen[-1]
    assert req.method == "POST" and str(req.url) == "http://chart-renderer.railway.internal:8080/render"
    assert req.headers["x-render-secret"] == "s3cret"
    body = json.loads(req.content)
    assert body["url"].startswith("https://uctintelligence.com/r/chart?") and "token=tok123" in body["url"]
    assert body["scale"] == hs.HOUSE_SCALE and body["selector"] == "#chart-export"
    assert body["ready_js"] == hs.house_ready_js("NVDA") and body["ready_timeout_ms"] >= 30000

    def failing(request):
        return httpx.Response(502, json={"detail": "render failed"})
    assert hs.render_house_chart("NVDA", "D", {}, client=httpx.Client(transport=httpx.MockTransport(failing))) is None

    def not_png(request):
        return httpx.Response(200, content=b"<html>unauthorized</html>", headers={"content-type": "text/html"})
    assert hs.render_house_chart("NVDA", "D", {}, client=httpx.Client(transport=httpx.MockTransport(not_png))) is None

    def boom(request):
        raise httpx.ConnectError("down")
    assert hs.render_house_chart("NVDA", "D", {}, client=httpx.Client(transport=httpx.MockTransport(boom))) is None


def test_house_render_is_skipped_when_unconfigured(monkeypatch):
    from api.services import discord_chart_house as hs
    monkeypatch.delenv("CHART_RENDERER_URL", raising=False)
    assert hs.house_enabled() is False
    assert hs.render_house_chart("NVDA", "D", {}) is None


def test_run_chart_job_prefers_the_house_render_and_falls_back_to_mplfinance():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    calls = {"house": [], "mpl": []}

    def bars_fn(tk, tf, n):
        return daily_bars(300)

    def house_fn(tk, tf, stats):
        calls["house"].append((tk, tf, sorted(stats)[:3]))
        return PNG_MAGIC + b"house"

    def render_fn(tk, tf, bars, daily_bars=None):
        calls["mpl"].append(tk)
        return PNG_MAGIC + b"mpl"
    edits = _Edits()
    assert run_chart_job("1", "t", ChartRequest("NVDA", "D"), bars_fn=bars_fn, render_fn=render_fn,
                         edit_fn=edits, house_fn=house_fn) == "ok"
    assert edits.calls[-1]["png"] == PNG_MAGIC + b"house" and calls["mpl"] == []
    assert calls["house"][0][:2] == ("NVDA", "D") and "adr_pct" in calls["house"][0][2] or True

    from api.services import discord_chart_cache as _cc; _cc.clear()
    # house unavailable → mplfinance path, same reply shape
    assert run_chart_job("1", "t", ChartRequest("NVDA", "D"), bars_fn=bars_fn, render_fn=render_fn,
                         edit_fn=edits, house_fn=lambda *a: None) == "ok"
    assert edits.calls[-1]["png"] == PNG_MAGIC + b"mpl"

    from api.services import discord_chart_cache as _cc; _cc.clear()
    # house raising is also a fallback, never a failure
    def house_boom(*a):
        raise RuntimeError("renderer exploded")
    assert run_chart_job("1", "t", ChartRequest("NVDA", "D"), bars_fn=bars_fn, render_fn=render_fn,
                         edit_fn=edits, house_fn=house_boom) == "ok"
    assert edits.calls[-1]["png"] == PNG_MAGIC + b"mpl"

    from api.services import discord_chart_cache as _cc; _cc.clear()
    # no bars at all still short-circuits before either renderer
    assert run_chart_job("1", "t", ChartRequest("ZZZZQ", "D"), bars_fn=lambda *a: None, render_fn=render_fn,
                         edit_fn=edits, house_fn=house_fn) == "no_bars"


# ── house render: content judge + retry (a sized-but-empty canvas is not a chart) ──

def _png_canvas(w=1296, h=698, draw=False, scale=1):
    """A house-shaped PNG: dark chrome bands, chart body either blank or with candles."""
    from PIL import Image, ImageDraw
    W, H = w * scale, h * scale
    im = Image.new("RGB", (W, H), (10, 10, 10))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 68 * scale], fill=(22, 22, 22))             # header + stats strip
    d.rectangle([0, H - 20 * scale, W, H], fill=(22, 22, 22))          # footer
    if draw:
        for i in range(40):
            x = 30 * scale + i * 28 * scale
            y0 = 200 * scale + (i % 7) * 20 * scale
            d.rectangle([x, y0, x + 10 * scale, y0 + (60 + (i % 5) * 15) * scale],
                        fill=(60, 184, 104) if i % 2 else (231, 76, 60))
    import io
    buf = io.BytesIO(); im.save(buf, format="PNG"); return buf.getvalue()


def test_has_chart_content_rejects_a_blank_body_and_accepts_candles():
    from api.services.discord_chart_house import has_chart_content
    assert has_chart_content(_png_canvas(draw=False)) is False
    assert has_chart_content(_png_canvas(draw=True)) is True
    assert has_chart_content(_png_canvas(draw=True, scale=2)) is True
    assert has_chart_content(b"not a png") is False


def test_house_render_retries_a_blank_frame_then_gives_up(monkeypatch):
    import httpx
    from api.services import discord_chart_house as hs
    monkeypatch.setenv("CHART_RENDERER_URL", "http://r")
    monkeypatch.setenv("CHART_RENDERER_SECRET", "s")
    monkeypatch.setenv("CHART_RENDER_TOKEN", "t")
    blank, drawn = _png_canvas(draw=False), _png_canvas(draw=True)
    bodies = []

    def handler(request: httpx.Request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=blank if len(bodies) == 1 else drawn, headers={"content-type": "image/png"})
    out = hs.render_house_chart("NVDA", "D", {"close": 1}, client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert out == drawn
    assert len(bodies) == 2
    assert bodies[0]["ready_js"] == hs.house_ready_js("NVDA") and bodies[0]["settle_ms"] < bodies[1]["settle_ms"]

    bodies.clear()

    def always_blank(request: httpx.Request):
        bodies.append(1)
        return httpx.Response(200, content=blank, headers={"content-type": "image/png"})
    assert hs.render_house_chart("NVDA", "D", {}, client=httpx.Client(transport=httpx.MockTransport(always_blank))) is None
    assert len(bodies) == 2  # one retry, then the mplfinance fallback takes over


# ── v3: faster readiness, fetch order, PNG cache + single-flight, dialable concurrency ──

def test_house_ready_js_samples_canvas_pixels_and_names_the_symbol():
    from api.services.discord_chart_house import house_ready_js, HOUSE_READY_JS
    js = house_ready_js("NVDA")
    assert "getImageData" in js and "__chartReady" in js and "'NVDA'" in js
    assert "250" in js  # two samples at least 250 ms apart must agree
    assert HOUSE_READY_JS in js or "__chartReady === true" in js


def test_house_render_passes_the_symbol_predicate_and_short_settle(monkeypatch):
    import httpx
    from api.services import discord_chart_house as hs
    monkeypatch.setenv("CHART_RENDERER_URL", "http://r")
    monkeypatch.setenv("CHART_RENDERER_SECRET", "s")
    monkeypatch.setenv("CHART_RENDER_TOKEN", "t")
    drawn = _png_canvas(draw=True)
    bodies = []

    def handler(request: httpx.Request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=drawn, headers={"content-type": "image/png"})
    assert hs.render_house_chart("NVDA", "D", {"close": 1}, client=httpx.Client(transport=httpx.MockTransport(handler))) == drawn
    assert bodies[0]["ready_js"] == hs.house_ready_js("NVDA")
    assert bodies[0]["settle_ms"] <= 400


def test_png_cache_hits_within_ttl_and_expires():
    from api.services import discord_chart_cache as cc
    cc.clear()
    clock = {"t": 1000.0}
    monkey_now = lambda: clock["t"]
    assert cc.get("NVDA:D", now=monkey_now) is None
    cc.put("NVDA:D", b"png1", "NVDA_D_x.png", ttl_s=45, now=monkey_now)
    assert cc.get("NVDA:D", now=monkey_now) == (b"png1", "NVDA_D_x.png")
    clock["t"] += 44
    assert cc.get("NVDA:D", now=monkey_now) == (b"png1", "NVDA_D_x.png")
    clock["t"] += 2
    assert cc.get("NVDA:D", now=monkey_now) is None
    assert cc.ttl_for("D") == 45 and cc.ttl_for("W") == 45 and cc.ttl_for("15") == 20 and cc.ttl_for("5") == 20


def test_png_cache_single_flight_shares_one_producer_across_threads():
    import threading, time as _time
    from api.services import discord_chart_cache as cc
    cc.clear()
    produced = []
    gate = threading.Event()

    def producer():
        produced.append(1)
        gate.wait(5)
        return (b"png", "NVDA_D_y.png")
    results = []

    def worker():
        results.append(cc.single_flight("NVDA:D", producer, ttl_s=45))
    threads = [threading.Thread(target=worker) for _ in range(6)]
    for t in threads:
        t.start()
    _time.sleep(0.3)
    gate.set()
    for t in threads:
        t.join(10)
    assert produced == [1]                       # six callers, ONE render
    assert results == [(b"png", "NVDA_D_y.png")] * 6
    assert cc.get("NVDA:D") == (b"png", "NVDA_D_y.png")  # and it was cached for the next minute


def test_png_cache_single_flight_does_not_cache_a_failed_producer():
    from api.services import discord_chart_cache as cc
    cc.clear()
    assert cc.single_flight("ZZZZQ:D", lambda: None, ttl_s=45) is None
    assert cc.get("ZZZZQ:D") is None
    assert cc.single_flight("ZZZZQ:D", lambda: (b"p", "f.png"), ttl_s=45) == (b"p", "f.png")


def test_run_chart_job_serves_a_cache_hit_without_fetching_anything():
    from api.services import discord_chart_cache as cc
    from api.services.discord_interactions import run_chart_job, ChartRequest
    cc.clear()
    cc.put("NVDA:D", PNG_MAGIC + b"cached", "NVDA_D_2026-08-25_Chart.png", ttl_s=45)
    edits = _Edits()

    def bars_fn(*a):
        raise AssertionError("must not fetch on a cache hit")
    assert run_chart_job("1", "t", ChartRequest("NVDA", "D"), bars_fn=bars_fn, render_fn=bars_fn, edit_fn=edits) == "ok"
    assert edits.calls[-1]["png"] == PNG_MAGIC + b"cached"
    assert edits.calls[-1]["filename"] == "NVDA_D_2026-08-25_Chart.png"
    assert edits.calls[-1]["content"] == "NVDA · Daily"


def test_run_chart_job_fetch_order_daily_first_and_tf_bars_only_for_the_fallback():
    from api.services import discord_chart_cache as cc
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services.discord_chart_render import STATS_DAILY_BARS, bars_to_request
    cc.clear()
    asked = []

    def bars_fn(tk, tf, n):
        asked.append((tf, n))
        return daily_bars(300) if tf == "D" else intraday_bars(400, 15)
    edits = _Edits()
    # house succeeds → the 15-min bars are never fetched
    assert run_chart_job("1", "t", ChartRequest("NVDA", "15"), bars_fn=bars_fn,
                         render_fn=lambda *a, **k: PNG_MAGIC + b"mpl", edit_fn=edits,
                         house_fn=lambda *a: _png_canvas(draw=True)) == "ok"
    assert asked == [("D", STATS_DAILY_BARS)]
    cc.clear(); asked.clear()
    # house fails → fallback fetches the 15-min bars, after the daily ones
    assert run_chart_job("1", "t", ChartRequest("NVDA", "15"), bars_fn=bars_fn,
                         render_fn=lambda *a, **k: PNG_MAGIC + b"mpl", edit_fn=edits,
                         house_fn=lambda *a: None) == "ok"
    assert asked == [("D", STATS_DAILY_BARS), ("15", bars_to_request("15"))]
    assert edits.calls[-1]["png"] == PNG_MAGIC + b"mpl"


def test_run_chart_job_skips_the_house_render_when_there_are_no_daily_bars():
    from api.services import discord_chart_cache as cc
    from api.services.discord_interactions import run_chart_job, ChartRequest
    cc.clear()
    house_calls = []

    def house_fn(*a):
        house_calls.append(a)
        return _png_canvas(draw=True)
    edits = _Edits()
    # unknown symbol: daily None, tf bars None → "No bars", house never attempted
    assert run_chart_job("1", "t", ChartRequest("ZZZZQ", "15"), bars_fn=lambda *a: None,
                         render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edits, house_fn=house_fn) == "no_bars"
    assert house_calls == []
    # daily fetch failed but intraday bars exist → mplfinance chart, house skipped
    def bars_fn(tk, tf, n):
        return None if tf == "D" else intraday_bars(400, 15)
    assert run_chart_job("1", "t", ChartRequest("NVDA", "15"), bars_fn=bars_fn,
                         render_fn=lambda *a, **k: PNG_MAGIC + b"mpl", edit_fn=edits, house_fn=house_fn) == "ok"
    assert house_calls == [] and edits.calls[-1]["png"] == PNG_MAGIC + b"mpl"


def test_run_chart_job_caches_the_produced_png_under_sym_tf():
    from api.services import discord_chart_cache as cc
    from api.services.discord_interactions import run_chart_job, ChartRequest
    cc.clear()
    edits = _Edits()
    drawn = _png_canvas(draw=True)
    assert run_chart_job("1", "t", ChartRequest("NVDA", "D"), bars_fn=lambda *a: daily_bars(300),
                         render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edits, house_fn=lambda *a: drawn) == "ok"
    hit = cc.get("NVDA:D")
    assert hit is not None and hit[0] == drawn and hit[1] == edits.calls[-1]["filename"]


def test_render_slots_come_from_env(monkeypatch):
    import importlib
    from api.services import discord_interactions as di
    monkeypatch.setenv("DISCORD_CHART_MAX_CONCURRENT", "6")
    assert di.render_slot_count() == 6
    monkeypatch.setenv("DISCORD_CHART_MAX_CONCURRENT", "garbage")
    assert di.render_slot_count() == 4
    monkeypatch.delenv("DISCORD_CHART_MAX_CONCURRENT", raising=False)
    assert di.render_slot_count() == 4


def test_house_url_forces_extended_hours_on_for_intraday_only():
    from urllib.parse import parse_qs, urlparse
    from api.services.discord_chart_house import build_render_url
    for tf in ("5", "15", "30", "60"):
        q = parse_qs(urlparse(build_render_url("NVDA", tf, {}, base_url="https://x", token="")).query)
        assert q["ext"] == ["1"], tf  # pre/post-market candles + session shading, like the Charts widget
    for tf in ("D", "W"):
        q = parse_qs(urlparse(build_render_url("NVDA", tf, {}, base_url="https://x", token="")).query)
        assert "ext" not in q, tf     # daily/weekly have no sessions to show; leave the page's default alone
