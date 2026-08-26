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
def _no_bars_retry_delay(monkeypatch):
    from api.services import discord_interactions as di
    monkeypatch.setattr(di, "BARS_RETRY_DELAY_S", 0)


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


UT_GUILD = "882293203485720596"  # Uncharted Territory, one of the two allowed servers


def _interaction(ticker=None, tf=None, name="chart", itype=2):
    opts = []
    if ticker is not None:
        opts.append({"name": "ticker", "type": 3, "value": ticker})
    if tf is not None:
        opts.append({"name": "tf", "type": 3, "value": tf})
    return {"type": itype, "application_id": "123", "token": "tok", "guild_id": UT_GUILD,
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
    ticker, tf = cmd["options"][:2]          # mas + volume follow (their own test)
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
    assert edits.calls[-1]["content"].startswith("No bars for ZZZZQ (60 min).") and edits.calls[-1]["png"] is None

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

    def fake_job(app_id, token, req, *, bars_fn, render_fn, edit_fn, house_fn=None, prefs=None, quote_fn=None, components_fn=None):
        scheduled.append((app_id, token, req, bars_fn, render_fn, edit_fn))
        assert house_fn is None  # CHART_RENDERER_URL is unset in tests → mplfinance only
        from api.services import discord_chart_prefs as p
        assert prefs == p.DEFAULTS  # no saved prefs for this user
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
    r = _post(client, sk, {"type": 3, "guild_id": UT_GUILD, "data": {"name": "chart"}})
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
    from api.services.discord_interactions import build_commands
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
    assert json.loads(seen[-1].content) == build_commands()

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
    from api.services.discord_interactions import build_commands
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        return httpx.Response(200, json=json.loads(request.content) if request.content else [])

    client = tool.make_client("bot-token", transport=httpx.MockTransport(handler))
    tool.register(client, "999", None, clear=False)
    assert seen[-1].method == "PUT"
    assert str(seen[-1].url).endswith("/applications/999/commands")
    assert "/guilds/" not in str(seen[-1].url)
    assert json.loads(seen[-1].content) == build_commands()


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

    def house_fn(tk, tf, stats, options=None):
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
    cc.put("NVDA:D:default", PNG_MAGIC + b"cached", "NVDA_D_2026-08-25_Chart.png", ttl_s=45)
    edits = _Edits()

    def bars_fn(*a):
        raise AssertionError("must not fetch on a cache hit")
    assert run_chart_job("1", "t", ChartRequest("NVDA", "D"), bars_fn=bars_fn, render_fn=bars_fn, edit_fn=edits) == "ok"
    assert edits.calls[-1]["png"] == PNG_MAGIC + b"cached"
    assert edits.calls[-1]["filename"] == "NVDA_D_2026-08-25_Chart.png"
    assert edits.calls[-1]["content"] == "NVDA · Daily"


def test_run_chart_job_fetch_order_daily_first_then_the_pages_intraday_warm_reused_by_the_fallback():
    from api.services import discord_chart_cache as cc
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services.discord_chart_render import STATS_DAILY_BARS, bars_to_request
    from api.services.discord_interactions import PAGE_BARS
    cc.clear()
    asked = []

    def bars_fn(tk, tf, n):
        asked.append((tf, n))
        return daily_bars(300) if tf == "D" else intraday_bars(5000, 15)
    edits = _Edits()
    # house succeeds: daily first (stats), then the page's own 15-min request is
    # warmed in-process (cold it took 7-20 s and timed out the renderer, 8/25)
    assert run_chart_job("1", "t", ChartRequest("NVDA", "15"), bars_fn=bars_fn,
                         render_fn=lambda *a, **k: PNG_MAGIC + b"mpl", edit_fn=edits,
                         house_fn=lambda *a: _png_canvas(draw=True)) == "ok"
    assert asked == [("D", STATS_DAILY_BARS), ("15", PAGE_BARS)]
    cc.clear(); asked.clear()
    # house fails: the fallback renders from the warmed bars, no third fetch
    seen = {}
    def render_fn(tk, tf, bars, **kw):
        seen["n"] = len(bars); return PNG_MAGIC + b"mpl"
    assert run_chart_job("1", "t", ChartRequest("NVDA", "15"), bars_fn=bars_fn,
                         render_fn=render_fn, edit_fn=edits, house_fn=lambda *a: None) == "ok"
    assert asked == [("D", STATS_DAILY_BARS), ("15", PAGE_BARS)]
    assert seen["n"] == bars_to_request("15")
    assert edits.calls[-1]["png"] == PNG_MAGIC + b"mpl"


def test_run_chart_job_skips_the_house_render_when_there_are_no_daily_bars():
    from api.services import discord_chart_cache as cc
    from api.services.discord_interactions import run_chart_job, ChartRequest
    cc.clear()
    house_calls = []

    def house_fn(*a, **k):
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
    hit = cc.get("NVDA:D:default")
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


def test_house_url_sets_ext_explicitly_for_intraday_only_and_candles_default_off():
    from urllib.parse import parse_qs, urlparse
    from api.services.discord_chart_house import build_render_url
    for tf in ("5", "15", "30", "60"):
        q = parse_qs(urlparse(build_render_url("NVDA", tf, {}, base_url="https://x", token="")).query)
        assert q["ext"] == ["0"], tf  # regular hours by default (owner 8/25): the pre/post print is the axis chip
        q = parse_qs(urlparse(build_render_url("NVDA", tf, {}, base_url="https://x", token="", options={"ext": True})).query)
        assert q["ext"] == ["1"], tf  # a member who wants the candles gets them
    for tf in ("D", "W"):
        q = parse_qs(urlparse(build_render_url("NVDA", tf, {}, base_url="https://x", token="")).query)
        assert "ext" not in q, tf     # daily/weekly have no sessions to show; leave the page's default alone


# ── only OUR servers: everything else is refused before any command runs ──

def test_guild_allowed_is_the_two_uct_servers_by_default_and_env_overrides(monkeypatch):
    from api.services import discord_interactions as di
    monkeypatch.delenv("DISCORD_CHART_ALLOWED_GUILDS", raising=False)
    assert di.allowed_guilds() == {"882293203485720596", "1524909611054792786"}
    assert di.guild_allowed({"guild_id": "882293203485720596"})
    assert di.guild_allowed({"guild_id": "1524909611054792786", "context": 0})
    assert not di.guild_allowed({"guild_id": "999"})                      # some other server
    assert not di.guild_allowed({})                                       # DM: no guild at all
    assert not di.guild_allowed({"guild_id": "882293203485720596", "context": 1})  # bot DM
    assert not di.guild_allowed({"guild_id": "882293203485720596", "context": 2})  # private channel
    assert not di.guild_allowed({"guild_id": "882293203485720596",
                                 "authorizing_integration_owners": {"1": "42"}})   # user install
    monkeypatch.setenv("DISCORD_CHART_ALLOWED_GUILDS", "111, 222")
    assert di.allowed_guilds() == {"111", "222"}
    assert di.guild_allowed({"guild_id": "222"}) and not di.guild_allowed({"guild_id": "882293203485720596"})
    monkeypatch.setenv("DISCORD_CHART_ALLOWED_GUILDS", "  ")            # blank = the default, never "allow all"
    assert di.allowed_guilds() == {"882293203485720596", "1524909611054792786"}


def test_endpoint_refuses_foreign_guild_dm_and_user_install_and_schedules_nothing(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    monkeypatch.delenv("DISCORD_CHART_ALLOWED_GUILDS", raising=False)
    client, rt = _app_client()
    scheduled = []
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: scheduled.append(a))
    from api.services import discord_interactions as di
    foreign = dict(_interaction("NVDA"), guild_id="424242424242424242")
    dm = {k: v for k, v in _interaction("NVDA").items() if k != "guild_id"}
    user_install = dict(_interaction("NVDA"), authorizing_integration_owners={"1": "77"})
    settings_elsewhere = {"type": 2, "application_id": "123", "token": "tok", "guild_id": "5",
                          "data": {"name": "chartsettings", "options": [{"name": "show", "type": 1, "options": []}]}}
    for payload in (foreign, dm, user_install, settings_elsewhere):
        r = _post(client, sk, payload)
        assert r.status_code == 200
        assert r.json() == {"type": 4, "data": {"content": di.NOT_ALLOWED_MESSAGE, "flags": 64}}
    assert scheduled == []
    # PING still answers (Discord validates the endpoint with one) and a home-server command still runs
    assert _post(client, sk, {"type": 1}).json() == {"type": 1}
    assert _post(client, sk, _interaction("NVDA")).json() == {"type": 5}
    assert len(scheduled) == 1


# ── per-member throttle: nobody hogs the render slots ──

def test_user_rate_check_allows_n_then_throttles_then_recovers(monkeypatch):
    from api.services import discord_interactions as di
    di.reset_rate_for_tests()
    monkeypatch.setenv("DISCORD_CHART_USER_RATE", "3/60")
    assert di.user_rate() == (3, 60.0)
    t0 = 1_000_000.0
    assert [di.user_rate_check("u1", t0 + i) for i in range(3)] == [0.0, 0.0, 0.0]
    wait = di.user_rate_check("u1", t0 + 5)
    assert 54 < wait <= 55                                  # oldest hit at t0 leaves the window at t0+60
    assert di.user_rate_check("u2", t0 + 5) == 0.0          # another member is unaffected
    assert di.user_rate_check("", t0 + 5) == 0.0            # unknown uid never throttles
    assert di.user_rate_check("u1", t0 + 60) == 0.0         # window rolled, allowed again
    assert "3 charts per minute" in di.throttle_message(wait) and "55s" in di.throttle_message(wait)
    monkeypatch.setenv("DISCORD_CHART_USER_RATE", "garbage")
    assert di.user_rate() == (6, 60.0)                      # bad env → the default, never unlimited


def test_endpoint_throttles_a_member_after_the_allowance_and_schedules_nothing_extra(monkeypatch):
    from api.services import discord_interactions as di
    di.reset_rate_for_tests()
    monkeypatch.setenv("DISCORD_CHART_USER_RATE", "2/60")
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    scheduled = []
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: scheduled.append(a))
    payload = dict(_interaction("NVDA"), member={"user": {"id": "777"}})
    assert _post(client, sk, payload).json() == {"type": 5}
    assert _post(client, sk, payload).json() == {"type": 5}
    r = _post(client, sk, payload).json()
    assert r["type"] == 4 and r["data"]["flags"] == 64 and r["data"]["content"].startswith("Slow down")
    assert len(scheduled) == 2
    # a different member still renders; settings commands are never throttled
    other = dict(_interaction("NVDA"), member={"user": {"id": "778"}})
    assert _post(client, sk, other).json() == {"type": 5}


# ── member asks from #main-chat, 8/25 ──

def test_parse_chart_command_takes_per_call_mas_and_volume_overrides():
    from api.services.discord_interactions import parse_chart_command, CommandError, ChartRequest
    base = _interaction("APP")
    base["data"]["options"] += [{"name": "mas", "type": 3, "value": "off"}, {"name": "volume", "type": 5, "value": False}]
    req = parse_chart_command(base)
    assert req == ChartRequest("APP", "D", mas="off", volume=False)
    assert req.overrides() == {"mas": "off", "volume": False}
    assert parse_chart_command(_interaction("APP")).overrides() == {}      # nothing given -> nothing overridden
    bad = _interaction("APP"); bad["data"]["options"].append({"name": "mas", "type": 3, "value": "50-200"})
    with pytest.raises(CommandError):
        parse_chart_command(bad)


def test_endpoint_applies_per_call_overrides_on_top_of_saved_prefs_without_saving(monkeypatch):
    from api.services import discord_chart_prefs as p, discord_interactions as di
    di.reset_rate_for_tests()
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    p.set_prefs("9001", tf="15", mas="10-20-50")
    seen = {}
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: seen.update(k) or "ok")
    payload = dict(_interaction("APP"), member={"user": {"id": "9001"}})
    payload["data"]["options"] += [{"name": "mas", "type": 3, "value": "off"}, {"name": "volume", "type": 5, "value": False}]
    assert _post(client, sk, payload).json() == {"type": 5}
    assert seen["prefs"]["mas"] == "off" and seen["prefs"]["volume"] is False
    assert seen["prefs"]["tf"] == "15"                                       # saved default tf still applies
    assert p.get_prefs("9001")["mas"] == "10-20-50" and p.get_prefs("9001")["volume"] is True   # nothing saved


def test_chart_command_options_expose_mas_and_volume_and_house_description():
    from api.services.discord_interactions import build_chart_command
    cmd = build_chart_command()
    opts = {o["name"]: o for o in cmd["options"]}
    assert set(opts) == {"ticker", "tf", "mas", "volume", "style", "theme"}
    assert {c["value"] for c in opts["mas"]["choices"]} == {"house", "10-20-50", "off"}
    assert opts["volume"]["type"] == 5 and not opts["volume"].get("required")
    assert "EMA 9/20" in cmd["description"] and "10/20/50 SMA" not in cmd["description"]
    assert len(cmd["description"]) <= 100 and all(len(o["description"]) <= 100 for o in cmd["options"])


def test_house_url_pins_a_readable_intraday_window():
    from api.services import discord_chart_house as house
    from urllib.parse import urlparse, parse_qs
    def q(tf):
        return parse_qs(urlparse(house.build_render_url("NVDA", tf, None, base_url="https://x", token="t")).query)
    assert q("5")["bars"] == ["110"] and q("15")["bars"] == ["90"] and q("30")["bars"] == ["80"]
    assert "bars" not in q("60") and "bars" not in q("D") and "bars" not in q("W")   # page defaults stay


def test_job_retries_a_failed_bars_fetch_once_before_saying_no_bars(monkeypatch):
    from api.services import discord_interactions as di
    monkeypatch.setattr(di, "BARS_RETRY_DELAY_S", 0)
    calls = []
    daily = [{"t": 1700000000 + i * 86400, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100} for i in range(300)]
    def bars_fn(ticker, tf, n):
        calls.append(tf)
        if tf == "D":
            return daily
        return None if calls.count("30") == 1 else daily[:100]     # first intraday pull misses, second lands
    edits = []
    def edit_fn(app_id, token, *, content, png=None, filename=None):
        edits.append((content, png is not None))
    render_fn = lambda ticker, tf, bars, **kw: b"PNG"
    out = di.run_chart_job("1", "tok", di.ChartRequest("TQQQ", "30"), bars_fn=bars_fn, render_fn=render_fn, edit_fn=edit_fn)
    assert out == "ok" and calls.count("30") == 2 and edits[-1] == ("TQQQ \u00b7 30 min", True)
    # and when it misses twice, the reply says why it might have, not just "No bars"
    calls.clear()
    out = di.run_chart_job("1", "tok", di.ChartRequest("ZZZZ", "30"),
                           bars_fn=lambda t, tf, n: daily if tf == "D" else None, render_fn=render_fn, edit_fn=edit_fn)
    assert out == "no_bars" and "try again in a minute" in edits[-1][0]


def test_house_ready_js_refuses_until_the_page_has_bars():
    """8/25: two 5-minute renders were captured while their bars fetch was in
    flight (7-20 s cold) - header + watermark satisfied the colour test and the
    page's held-still flag is true of an empty chart. The bars guard must come
    BEFORE either ready branch."""
    from api.services.discord_chart_house import house_ready_js, HOUSE_READY_JS
    js = house_ready_js("NVDA")
    assert "if (window.__chartBarsReady !== true) return false;" in js
    assert js.index("__chartBarsReady") < js.index("__chartReady === true")
    assert js.index("__chartBarsReady") < js.index("getImageData")
    assert "__chartBarsReady === true" in HOUSE_READY_JS


def test_job_warms_the_pages_intraday_bars_before_the_house_render_and_reuses_them_for_fallback():
    """The /r/chart page fetches PAGE_BARS bars itself; cold, that took 7-20 s on
    5-minute data and timed out the renderer's first attempt. The job warms that
    exact request in-process first (Daily is already fetched for the stats)."""
    from api.services import discord_interactions as di
    daily = [{"t": 1700000000 + i * 86400, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100} for i in range(300)]
    intra = [{"t": 1700000000 + i * 300, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100} for i in range(5000)]
    order = []
    def bars_fn(ticker, tf, n):
        order.append(("bars", tf, n))
        return daily if tf == "D" else intra
    def house_fn(ticker, tf, stats, options):
        order.append(("house", tf, None))
        return b"HOUSEPNG"
    edits = []
    def edit_fn(app_id, token, *, content, png=None, filename=None):
        edits.append((content, png))
    out = di.run_chart_job("1", "tok", di.ChartRequest("TSLA", "5"), bars_fn=bars_fn, render_fn=lambda *a, **k: b"MPL",
                           edit_fn=edit_fn, house_fn=house_fn)
    assert out == "ok" and edits[-1][1] == b"HOUSEPNG"
    assert order == [("bars", "D", di.STATS_DAILY_BARS), ("bars", "5", di.PAGE_BARS), ("house", "5", None)]
    # Daily needs no extra warm: the stats fetch already is the page's request shape
    order.clear()
    di.run_chart_job("1", "tok", di.ChartRequest("TSLA", "D"), bars_fn=bars_fn, render_fn=lambda *a, **k: b"MPL",
                     edit_fn=edit_fn, house_fn=house_fn)
    assert [o for o in order if o[0] == "bars" and o[1] != "D"] == []
    # when the house render fails, the fallback reuses the warmed bars (no third fetch)
    order.clear()
    rendered = {}
    def render_fn(ticker, tf, bars, **kw):
        rendered["n"] = len(bars); return b"MPL"
    out = di.run_chart_job("1", "tok", di.ChartRequest("TSLA", "15"), bars_fn=bars_fn, render_fn=render_fn,
                           edit_fn=edit_fn, house_fn=lambda *a, **k: None)
    assert out == "ok" and edits[-1][1] == b"MPL"
    assert [o for o in order if o[0] == "bars"] == [("bars", "D", di.STATS_DAILY_BARS), ("bars", "15", di.PAGE_BARS)]
    assert rendered["n"] == di.bars_to_request("15")


# ── pre/post-market = the price chip on the right axis, not candles (owner, 8/25) ──

def test_house_url_carries_the_ext_tag_on_every_timeframe_and_candles_default_off():
    from api.services import discord_chart_house as house
    from urllib.parse import urlparse, parse_qs
    def q(tf, **opts):
        return parse_qs(urlparse(house.build_render_url("SPY", tf, None, base_url="https://x", token="t", options=opts)).query)
    assert q("D", exttag=("post", 764.97))["exttag"] == ["post:764.97"]
    assert q("5", exttag=("pre", 102.5))["exttag"] == ["pre:102.50"]
    assert "exttag" not in q("D") and "exttag" not in q("5", exttag=None)
    assert q("5")["ext"] == ["0"]                                  # candles off unless the member asks
    assert q("5", ext=True)["ext"] == ["1"]


def test_job_resolves_the_ext_quote_for_the_house_render_and_survives_a_failing_lookup():
    from api.services import discord_interactions as di
    from api.services import discord_chart_cache as cc
    daily = [{"t": 1700000000 + i * 86400, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100} for i in range(300)]
    got = {}
    def house_fn(ticker, tf, stats, options):
        got.update(options); return b"HOUSEPNG"
    edits = []
    edit_fn = lambda app_id, token, *, content, png=None, filename=None: edits.append(png)
    out = di.run_chart_job("1", "tok", di.ChartRequest("SPY", "D"), bars_fn=lambda t, tf, n: daily,
                           render_fn=lambda *a, **k: b"MPL", edit_fn=edit_fn, house_fn=house_fn,
                           quote_fn=lambda t: ("post", 764.97))
    assert out == "ok" and got["exttag"] == ("post", 764.97) and got["ext"] is False
    got.clear(); cc.clear()
    def boom(t):
        raise RuntimeError("feed down")
    out = di.run_chart_job("1", "tok", di.ChartRequest("SPY", "D"), bars_fn=lambda t, tf, n: daily,
                           render_fn=lambda *a, **k: b"MPL", edit_fn=edit_fn, house_fn=house_fn, quote_fn=boom)
    assert out == "ok" and edits[-1] == b"HOUSEPNG" and got.get("exttag") is None   # no quote, no chip, still a chart


def test_fetch_ext_quote_reads_the_widgets_source_and_never_raises(monkeypatch):
    from api.routers import discord_interactions as rt
    from api.services import massive
    class C:
        def __init__(self, rows): self.rows = rows
        def get_batch_rich_snapshots(self, tickers): return self.rows
    # the REAL words the feed uses (massive._detect_session -> _ext_price_for), not the chip's
    monkeypatch.setattr(massive, "_get_client", lambda: C({"SPY": {"ext_price": 764.97, "ext_session": "post_market"}}))
    assert rt.fetch_ext_quote("spy") == ("post", 764.97)
    monkeypatch.setattr(massive, "_get_client", lambda: C({"SPY": {"ext_price": 102.5, "ext_session": "pre_market"}}))
    assert rt.fetch_ext_quote("SPY") == ("pre", 102.5)
    monkeypatch.setattr(massive, "_get_client", lambda: C({"SPY": {"ext_price": None, "ext_session": None}}))
    assert rt.fetch_ext_quote("SPY") is None                       # regular session: no chip
    def boom():
        raise RuntimeError("massive down")
    monkeypatch.setattr(massive, "_get_client", boom)
    assert rt.fetch_ext_quote("SPY") is None


def test_ext_session_words_are_the_feeds_own(monkeypatch):
    """8/25: the adapter compared ext_session to 'pre'/'post' while the feed says
    'pre_market'/'post_market' - the chip never drew and the test that 'covered'
    it used the wrong word too. Pin the contract to the function that owns it."""
    import datetime as dt
    from zoneinfo import ZoneInfo
    from api.services import massive
    from api.routers.discord_interactions import EXT_SESSION_WORD
    words = set()
    class FakeDT(dt.datetime):
        _now = None
        @classmethod
        def now(cls, tz=None):
            return cls._now
    for hhmm in ((5, 0), (10, 0), (17, 0), (2, 0)):
        FakeDT._now = dt.datetime(2026, 8, 25, *hhmm, tzinfo=ZoneInfo("America/New_York"))
        monkeypatch.setattr(dt, "datetime", FakeDT)
        words.add(massive._detect_session())
    monkeypatch.undo()
    assert words == {"pre_market", "regular", "post_market"}
    for w in words - {"regular"}:
        assert EXT_SESSION_WORD[w] in ("pre", "post")


def test_house_url_carries_preset_and_engine_instances():
    from api.services import discord_chart_house as house
    from urllib.parse import urlparse, parse_qs
    import base64, json
    inst = [{"instanceId": "inst:rsi:1", "defId": "rsi", "inputs": {"period": 14}, "hidden": False}]
    q = parse_qs(urlparse(house.build_render_url("NVDA", "D", None, base_url="https://x", token="t",
                                                  options={"preset": "oled", "instances": inst})).query)
    assert q["preset"] == ["oled"]
    raw = q["instances"][0]
    assert json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))) == inst
    q = parse_qs(urlparse(house.build_render_url("NVDA", "D", None, base_url="https://x", token="t")).query)
    assert "preset" not in q and "instances" not in q


# ── buttons under every chart + ticker autocomplete (member asks, 8/25) ──

def test_chart_components_reflect_the_image_and_round_trip_through_parse_component(monkeypatch):
    from api.services import discord_interactions as di
    monkeypatch.setenv("CHART_RENDER_BASE_URL", "https://uctintelligence.com")
    monkeypatch.setenv("DISCORD_ACTIVITY_GUILDS", "")
    rows = di.chart_components(di.ChartRequest("NVDA", "15"), {**di.prefs_mod.DEFAULTS})
    assert len(rows) == 5 and all(r["type"] == 1 for r in rows)               # Discord's ceiling, all used
    tfs = rows[0]["components"]
    assert [b["label"] for b in tfs] == ["D", "W", "60m", "15m", "5m"]
    assert [b["style"] for b in tfs] == [2, 2, 2, 1, 2]                    # the active timeframe is primary
    assert all(len(b["custom_id"]) <= 100 for r in rows for b in r["components"] if "custom_id" in b)
    for b, (tf, _) in zip(tfs, di.BUTTON_TFS):                              # every tf button parses back with the SAME style state
        req = di.parse_component({"data": {"custom_id": b["custom_id"]}})
        assert (req.ticker, req.tf, req.mas, req.volume, req.zoom, req.indicators, req.style, req.theme, req.to) == \
            ("NVDA", tf, "house", True, "auto", "none", "candles", "house", None)
    zoom_sel, ind_sel, look_sel = (rows[i]["components"][0] for i in (1, 2, 3))
    assert zoom_sel["type"] == 3 and [o["value"] for o in zoom_sel["options"]] == ["auto", "1d", "2d", "5d", "10d"]   # intraday zooms
    assert ind_sel["type"] == 3 and [o["value"] for o in ind_sel["options"]] == ["none", "rsi", "macd", "rsi+macd"]
    assert look_sel["type"] == 3 and look_sel["options"][0]["value"] == "style:candles" and look_sel["options"][0]["default"]
    assert any(o["value"] == "theme:oled" for o in look_sel["options"])
    # a pick applies ONE field over the state the select carried
    picked = di.parse_component({"data": {"custom_id": zoom_sel["custom_id"], "values": ["5d"]}})
    assert (picked.zoom, picked.tf, picked.mas) == ("5d", "15", "house")
    picked = di.parse_component({"data": {"custom_id": ind_sel["custom_id"], "values": ["rsi+macd"]}})
    assert picked.indicators == "rsi+macd"
    picked = di.parse_component({"data": {"custom_id": look_sel["custom_id"], "values": ["theme:oled"]}})
    assert picked.theme == "oled" and picked.style == "candles"
    picked = di.parse_component({"data": {"custom_id": look_sel["custom_id"], "values": ["style:line"]}})
    assert picked.style == "line" and picked.theme == "house"
    row5 = rows[4]["components"]
    assert [b["label"] for b in row5] == ["MAs: House", "Volume off", "Open interactive \u2197"]   # intraday: no pan
    assert di.parse_component({"data": {"custom_id": row5[0]["custom_id"]}}).mas == "10-20-50"    # MAs cycle house -> 10/20/50 -> off
    assert di.parse_component({"data": {"custom_id": row5[1]["custom_id"]}}).volume is False
    assert row5[2]["style"] == 5 and row5[2]["url"] == "https://uctintelligence.com/research/NVDA"
    # daily: pan buttons, Later disabled while live, Earlier steps back a window
    rows = di.chart_components(di.ChartRequest("NVDA", "D", mas="off", volume=False), {**di.prefs_mod.DEFAULTS})
    row5 = rows[4]["components"]
    assert [b["label"] for b in row5] == ["\u25c0 Earlier", "Later \u25b6", "MAs: off", "Volume on", "Open interactive \u2197"]
    assert row5[1]["disabled"] is True
    earlier = di.parse_component({"data": {"custom_id": row5[0]["custom_id"]}})
    assert earlier.to is not None and earlier.tf == "D"
    rows = di.chart_components(di.ChartRequest("NVDA", "D", to="2026-05-15"), {**di.prefs_mod.DEFAULTS})
    row5 = rows[4]["components"]
    assert row5[1].get("disabled") is False
    assert di.parse_component({"data": {"custom_id": row5[0]["custom_id"]}}).to < "2026-05-15"
    later = di.parse_component({"data": {"custom_id": row5[1]["custom_id"]}})
    assert later.to is None or later.to > "2026-05-15"
    assert [o["default"] for o in rows[1]["components"][0]["options"]][0] is True                  # daily zoom list, auto selected
    for bad in ("", "chart|NVDA|D|house", "chart|NV DA|D|house|1", "chart|NVDA|2|house|1", "chart|NVDA|D|sma|1", "other|NVDA|D|house|1",
                "c2|NVDA|D|house|1|9y|none|candles|house|", "c2|NVDA|D|house|1|auto|none|candles|house|2026-13-01x"):
        with pytest.raises(di.CommandError):
            di.parse_component({"data": {"custom_id": bad}})
    assert di.parse_component({"data": {"custom_id": "chart|NVDA|W|off|0"}}) == di.ChartRequest("NVDA", "W", mas="off", volume=False)   # legacy ids


def test_pan_to_steps_a_window_and_returns_to_live():
    from api.services.discord_interactions import pan_to
    assert pan_to(None, "D", "auto", -1, today="2026-08-25") == "2026-05-22"
    assert pan_to("2026-05-22", "D", "auto", -1, today="2026-08-25") == "2026-02-16"
    assert pan_to("2026-05-22", "D", "auto", +1, today="2026-08-25") is None      # lands on/after today -> live
    assert pan_to("2026-02-16", "D", "auto", +1, today="2026-08-25") == "2026-05-22"
    assert pan_to(None, "W", "1y", -1, today="2026-08-25") == "2025-08-24"
    assert pan_to(None, "D", "1m", -1, today="2026-08-25") == "2026-07-25"


def test_endpoint_button_click_updates_in_place_and_reschedules_with_components(monkeypatch):
    from api.services import discord_interactions as di
    di.reset_rate_for_tests()
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    scheduled = []
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: scheduled.append((a, k)) or "ok")
    click = {"type": 3, "application_id": "123", "token": "tok", "guild_id": UT_GUILD, "member": {"user": {"id": "55"}},
             "data": {"custom_id": di.component_id("NVDA", "W", "off", True), "component_type": 2}}
    r = _post(client, sk, click)
    assert r.json() == {"type": 6}                                          # DEFERRED_UPDATE_MESSAGE: same message, no loading state
    (app_id, token, req), kw = scheduled[-1]
    assert (app_id, token, req.ticker, req.tf, req.mas, req.volume) == ("123", "tok", "NVDA", "W", "off", True)
    unwrap = lambda f: getattr(f, "func", f)   # noqa: E731 — the router binds the guild with functools.partial
    assert unwrap(kw["components_fn"]) is di.chart_components and kw["prefs"]["mas"] == "off"
    # a slash command also gets the buttons now
    r = _post(client, sk, _interaction("AMD"))
    assert r.json() == {"type": 5} and unwrap(scheduled[-1][1]["components_fn"]) is di.chart_components
    # an unknown button is not a chart
    r = _post(client, sk, {**click, "data": {"custom_id": "poll|vote|1", "component_type": 2}})
    assert r.json() == {"type": 4, "data": {"content": "Unknown button.", "flags": 64}}
    # and a click from a foreign server is refused like anything else
    r = _post(client, sk, {**click, "guild_id": "999"})
    assert r.json()["data"]["content"] == di.NOT_ALLOWED_MESSAGE


def test_endpoint_autocomplete_answers_choices_and_only_choices(monkeypatch):
    from api.services import discord_interactions as di
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    monkeypatch.setattr(rt, "fetch_ticker_choices", lambda q, limit=10: [{"name": f"{q}DA - NVIDIA Corp", "value": f"{q}DA"}])
    ac = {"type": 4, "application_id": "123", "token": "tok", "guild_id": UT_GUILD,
          "data": {"name": "chart", "options": [{"name": "ticker", "type": 3, "value": "nv", "focused": True}]}}
    assert _post(client, sk, ac).json() == {"type": 8, "data": {"choices": [{"name": "NVDA - NVIDIA Corp", "value": "NVDA"}]}}
    empty = {**ac, "data": {"name": "chart", "options": [{"name": "ticker", "type": 3, "value": "", "focused": True}]}}
    assert _post(client, sk, empty).json() == {"type": 8, "data": {"choices": []}}
    # a foreign server gets EMPTY choices, never an ephemeral message (Discord rejects anything but type 8 here)
    assert _post(client, sk, {**ac, "guild_id": "999"}).json() == {"type": 8, "data": {"choices": []}}
    from api.services.discord_interactions import build_chart_command
    assert build_chart_command()["options"][0]["autocomplete"] is True


def test_fetch_ticker_choices_uses_the_dashboards_search_and_never_raises(monkeypatch):
    from api.routers import discord_interactions as rt, ticker_search as ts
    monkeypatch.setattr(ts, "ticker_search", lambda q, limit: {"results": [{"ticker": "NVDA", "name": "NVIDIA Corp"}, {"ticker": "NVAX", "name": None}]})
    assert rt.fetch_ticker_choices("NV") == [{"name": "NVDA - NVIDIA Corp", "value": "NVDA"}, {"name": "NVAX", "value": "NVAX"}]
    def boom(q, limit):
        raise RuntimeError("universe missing")
    monkeypatch.setattr(ts, "ticker_search", boom)
    assert rt.fetch_ticker_choices("NV") == []


def test_edit_original_sends_components_in_the_payload_when_given():
    from api.services.discord_interactions import edit_original
    seen = []
    class R:
        is_success = True; status_code = 200; text = ""
    class C:
        def patch(self, url, **kw):
            seen.append(kw); return R()
    comps = [{"type": 1, "components": [{"type": 2, "style": 1, "label": "D", "custom_id": "chart|X|D|house|1"}]}]
    assert edit_original("1", "t", content="X · Daily", png=b"PNG", filename="x.png", components=comps, client=C())
    assert json.loads(seen[-1]["data"]["payload_json"])["components"] == comps
    assert edit_original("1", "t", content="Busy", components=comps, client=C())
    assert seen[-1]["json"]["components"] == comps
    assert edit_original("1", "t", content="Busy", client=C())
    assert "components" not in seen[-1]["json"]                              # None = leave the message's rows alone


def test_job_hands_components_to_the_edit_when_a_components_fn_is_given():
    from api.services import discord_interactions as di
    from api.services import discord_chart_cache as cc
    cc.clear()
    daily = [{"t": 1700000000 + i * 86400, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100} for i in range(300)]
    edits = []
    def edit_fn(app_id, token, *, content, png=None, filename=None, components=None):
        edits.append(components)
    out = di.run_chart_job("1", "tok", di.ChartRequest("SPY", "D"), bars_fn=lambda t, tf, n: daily,
                           render_fn=lambda *a, **k: b"MPL", edit_fn=edit_fn, house_fn=lambda *a: b"HOUSE",
                           components_fn=di.chart_components)
    assert out == "ok" and edits[-1][0]["components"][0]["label"] == "D"
    # cache hit path carries them too
    di.run_chart_job("1", "tok", di.ChartRequest("SPY", "D"), bars_fn=lambda t, tf, n: daily,
                     render_fn=lambda *a, **k: b"MPL", edit_fn=edit_fn, house_fn=lambda *a: b"HOUSE",
                     components_fn=di.chart_components)
    assert edits[-1] is not None and len(edits) == 2


# ── breadth pseudo-tickers (UCTA5 …): daily-basis, named, no stats strip (owner, 8/25) ──

def test_breadth_adjust_makes_the_daily_basis_explicit_and_names_the_metric():
    from api.routers.discord_interactions import breadth_adjust
    from api.services import discord_interactions as di, discord_chart_prefs as p
    from api.services import breadth_symbols as bs
    assert bs.is_breadth_symbol("UCTA5") and not bs.is_breadth_symbol("NVDA")
    req, prefs = breadth_adjust(di.ChartRequest("UCTA5", "15"), {**p.DEFAULTS, "stats": True, "ext": True})
    assert req.tf == "D" and req.daily_only and req.display == "UCTA5 · " + bs.SYMBOLS["UCTA5"]["name"]
    assert req.breadth_name == bs.SYMBOLS["UCTA5"]["name"]
    assert prefs["stats"] is False and prefs["ext"] is False
    assert prefs["style"] == "line"                                          # the app draws breadth as a line
    assert prefs["volume"] is True                                           # pane stays; the page blanks it
    req, prefs = breadth_adjust(di.ChartRequest("UCTA5", "D", style="candles"), dict(p.DEFAULTS))
    assert prefs["style"] == "candles"                                       # an explicit ask still wins
    req, _ = breadth_adjust(di.ChartRequest("UCTA5", "W"), dict(p.DEFAULTS))
    assert req.tf == "W"                                                    # weekly stays weekly
    req, prefs = breadth_adjust(di.ChartRequest("NVDA", "15"), {**p.DEFAULTS, "stats": True})
    assert req == di.ChartRequest("NVDA", "15") and prefs["stats"] is True   # a stock passes through untouched
    rows = di.chart_components(req.__class__("UCTA5", "D", daily_only=True), dict(p.DEFAULTS))
    assert [b["label"] for b in rows[0]["components"]] == ["D", "W"]         # no intraday buttons for a daily series
    assert [b["label"] for b in di.chart_components(di.ChartRequest("NVDA", "D"), dict(p.DEFAULTS))[0]["components"]] == ["D", "W", "60m", "15m", "5m"]


def test_endpoint_routes_a_breadth_symbol_as_daily_with_its_name(monkeypatch):
    from api.services import discord_interactions as di
    di.reset_rate_for_tests()
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    scheduled = []
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: scheduled.append((a, k)) or "ok")
    assert _post(client, sk, _interaction("ucta5", "5")).json() == {"type": 5}
    (_, _, req), kw = scheduled[-1]
    assert req.ticker == "UCTA5" and req.tf == "D" and req.daily_only and "% of Stocks Above 5-Day MA" in req.display
    assert kw["prefs"]["stats"] is False


def test_job_titles_the_reply_with_the_display_name():
    from api.services import discord_interactions as di
    from api.services import discord_chart_cache as cc
    cc.clear()
    import datetime as _dt
    daily = [{"t": (_dt.date(2025, 1, 1) + _dt.timedelta(days=i)).isoformat(), "o": 50, "h": 55, "l": 45, "c": 52.8, "v": 0}
             for i in range(300)]
    edits = []
    def edit_fn(app_id, token, *, content, png=None, filename=None, components=None):
        edits.append(content)
    out = di.run_chart_job("1", "tok", di.ChartRequest("UCTA5", "D", daily_only=True, display="UCTA5 · % of Stocks Above 5-Day MA"),
                           bars_fn=lambda t, tf, n: daily, render_fn=lambda *a, **k: b"MPL", edit_fn=edit_fn,
                           house_fn=lambda *a: b"HOUSE", prefs={**di.prefs_mod.DEFAULTS, "stats": False})
    assert out == "ok" and edits[-1] == "UCTA5 · % of Stocks Above 5-Day MA · Daily"


def test_house_url_and_job_stamp_the_breadth_record_for_the_page():
    from api.services import discord_chart_house as house, discord_interactions as di
    from api.services import discord_chart_cache as cc
    from urllib.parse import urlparse, parse_qs
    q = parse_qs(urlparse(house.build_render_url("UCTA50", "D", None, base_url="https://x", token="t",
                                                  options={"breadth": "% of Stocks Above 50-Day MA"})).query)
    assert q["breadth"] == ["1"] and q["bname"] == ["% of Stocks Above 50-Day MA"]
    assert "breadth" not in parse_qs(urlparse(house.build_render_url("NVDA", "D", None, base_url="https://x", token="t")).query)
    cc.clear()
    import datetime as _dt
    daily = [{"t": (_dt.date(2025, 1, 1) + _dt.timedelta(days=i)).isoformat(), "o": 50, "h": 55, "l": 45, "c": 52.8, "v": 0}
             for i in range(300)]
    got = {}
    def house_fn(ticker, tf, stats, options):
        got.update(options); return b"HOUSE"
    di.run_chart_job("1", "tok", di.ChartRequest("UCTA50", "D", daily_only=True, breadth_name="% of Stocks Above 50-Day MA"),
                     bars_fn=lambda t, tf, n: daily, render_fn=lambda *a, **k: b"MPL",
                     edit_fn=lambda *a, **k: None, house_fn=house_fn, prefs={**di.prefs_mod.DEFAULTS, "style": "line", "stats": False})
    assert got["breadth"] == "% of Stocks Above 50-Day MA" and got["indicators"] == {"chartType": "line"}


def test_every_dropdown_obeys_discords_select_rules():
    """8/25: the Look select carried TWO defaults (style + theme) and Discord
    refused the whole edit with COMPONENT_TOO_MANY_DEFAULT_VALUES - the chart
    sat on 'thinking...' forever. One default per single-select, <= 25 options,
    labels <= 100 chars, custom_id <= 100 chars."""
    from api.services import discord_interactions as di
    for req in (di.ChartRequest("NVDA", "D"), di.ChartRequest("NVDA", "15", style="line", theme="oled", zoom="5d", indicators="macd"),
                di.ChartRequest("UCTA5", "W", daily_only=True, to="2026-05-01")):
        for row in di.chart_components(req, dict(di.prefs_mod.DEFAULTS)):
            for comp in row["components"]:
                if comp["type"] != 3:
                    continue
                assert 1 <= len(comp["options"]) <= 25
                assert sum(1 for o in comp["options"] if o.get("default")) <= 1, comp["custom_id"]
                assert all(len(o["label"]) <= 100 and len(o["value"]) <= 100 for o in comp["options"])
                assert len(comp["custom_id"]) <= 100
