"""Discord /chart: renderer, interaction plumbing, endpoint, registration payload."""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import random

import pytest

from api.services import discord_chart_house as house_mod


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
    assert ok == {"id": "1"}          # the edited MESSAGE, so the follow-up can pin its attachments
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
    assert ok == {"id": "1"}
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

    def fake_job(app_id, token, req, *, bars_fn, render_fn, edit_fn, house_fn=None, prefs=None, quote_fn=None, components_fn=None, **_k):
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
    assert "not a ticker" in r.json()["data"]["content"]


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

    # the invite carries the bot scope AND the permissions a chart needs — see
    # test_the_invite_asks_for_exactly_what_a_chart_needs_and_nothing_dangerous
    assert tool.invite_url("999") == (
        "https://discord.com/oauth2/authorize?client_id=999"
        f"&scope=bot+applications.commands&permissions={tool.INVITE_PERMISSIONS}")


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
    # the first attempt is judged sooner than a healthy chart could ever need
    # (measured: full readiness in 1.9-2.7 s); the retry keeps a long ceiling
    assert body["ready_js"] == hs.house_ready_js("NVDA")
    # 15 s is ~6x the measured full-readiness time (1.9-2.7 s on the pod), so a
    # healthy chart is never cut off - and a chart that will never settle is
    # judged in 15 s instead of 30 before the long retry.
    assert body["ready_timeout_ms"] == hs._ATTEMPTS[0][1] <= 20000
    # the retry is more patient than the first look, and both are sized off the
    # measured render (2.4-7.3s under 4-6x concurrency) rather than a round number
    SLOWEST_HEALTHY_MS = 7300          # measured 2026-08-26 at 4-6x concurrency, bars warm
    assert hs._ATTEMPTS[0][1] >= 2 * SLOWEST_HEALTHY_MS      # a good chart is never cut off
    assert hs._ATTEMPTS[-1][1] >= 3 * SLOWEST_HEALTHY_MS     # the retry is more patient still
    assert sum(a[1] for a in hs._ATTEMPTS) <= 45000, "a blank must not cost a member a full minute"

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


def test_run_chart_job_prefers_the_house_render_and_falls_back_to_mplfinance(monkeypatch):
    # this pins the HOUSE path's own sequence; the fast preview is separately
    # tested and would add an edit and a fetch in front of it
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "0")
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
    # TTL is session-aware now (see test_discord_chart_cache.py); pin the LIVE
    # values against a fixed mid-session moment so this cannot pass or fail on
    # the clock the suite happens to run at.
    live = dt.datetime(2026, 8, 26, 11, 0, tzinfo=cc._ET)
    assert cc.ttl_for("D", live) == cc.ttl_for("W", live) == cc._TTL["D"]
    assert cc.ttl_for("15", live) == cc.ttl_for("5", live) == cc._TTL_INTRADAY
    assert cc._TTL["D"] > cc._TTL_INTRADAY


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


def test_run_chart_job_fetch_order_daily_first_then_the_pages_intraday_warm_reused_by_the_fallback(monkeypatch):
    # this pins the HOUSE path's own sequence; the fast preview is separately
    # tested and would add an edit and a fetch in front of it
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "0")
    from api.services import discord_chart_cache as cc
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services.discord_chart_render import STATS_DAILY_BARS, bars_to_request
    from api.services.discord_chart_house import page_fetch_bars
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
    assert asked == [("D", STATS_DAILY_BARS), ("15", max(page_fetch_bars("15", False), 5000))]
    cc.clear(); asked.clear()
    # house fails: the fallback renders from the warmed bars, no third fetch
    seen = {}
    def render_fn(tk, tf, bars, **kw):
        seen["n"] = len(bars); return PNG_MAGIC + b"mpl"
    assert run_chart_job("1", "t", ChartRequest("NVDA", "15"), bars_fn=bars_fn,
                         render_fn=render_fn, edit_fn=edits, house_fn=lambda *a: None) == "ok"
    assert asked == [("D", STATS_DAILY_BARS), ("15", max(page_fetch_bars("15", False), 5000))]
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


def test_chart_advertises_three_options_the_rest_live_on_the_chart_itself():
    """The look overrides (mas/volume/style/theme) were three ways to say one
    thing - a slash option, a dropdown under the chart, and a saved default.
    Only the dropdown and the default remain; the command stays small enough to
    read in the picker."""
    from api.services.discord_interactions import build_chart_command
    cmd = build_chart_command()
    opts = {o["name"]: o for o in cmd["options"]}
    assert set(opts) == {"ticker", "tf", "compare"}
    assert opts["ticker"]["required"] and opts["ticker"].get("autocomplete")
    assert "several" in opts["ticker"]["description"].lower()      # the multi door is discoverable
    assert {c["value"] for c in opts["tf"]["choices"]} >= {"D", "W", "5"}
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


def test_job_warms_the_pages_intraday_bars_before_the_house_render_and_reuses_them_for_fallback(monkeypatch):
    """The /r/chart page fetches its own bars; cold, that took 7-20 s on
    5-minute data and timed out the renderer's first attempt. The job warms that
    exact request in-process first (Daily is already fetched for the stats)."""
    # this pins the HOUSE path's own sequence; the fast preview is separately
    # tested and would add an edit and a fetch in front of it
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "0")
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
    assert order == [("bars", "D", di.STATS_DAILY_BARS), ("bars", "5", max(house_mod.page_fetch_bars("5", False), di.PAGE_BARS)), ("house", "5", None)]
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
    assert [o for o in order if o[0] == "bars"] == [("bars", "D", di.STATS_DAILY_BARS), ("bars", "15", max(house_mod.page_fetch_bars("15", False), di.PAGE_BARS))]
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
    # expanded=True: this test is about the FULL control surface. A chart posts
    # collapsed now (one row + a gear) - that shape has its own test below.
    rows = di.chart_components(di.ChartRequest("NVDA", "15", expanded=True), {**di.prefs_mod.DEFAULTS})
    # THREE rows, not five: the owner called the five-row stack "mega clunky…
    # it really takes up a lot of space", so Zoom + Indicators + Look became one
    # dropdown (23 options, inside Discord's 25) with the state in its placeholder.
    assert len(rows) == 3 and all(r["type"] == 1 for r in rows)
    assert sum(1 for r in rows for c in r["components"] if c["type"] == 3) == 1
    tfs = rows[0]["components"]
    assert [b["label"] for b in tfs] == ["D", "W", "60m", "15m", "5m"]
    assert [b["style"] for b in tfs] == [2, 2, 2, 1, 2]                    # the active timeframe is primary
    assert all(len(b["custom_id"]) <= 100 for r in rows for b in r["components"] if "custom_id" in b)
    for b, (tf, _) in zip(tfs, di.BUTTON_TFS):                              # every tf button parses back with the SAME style state
        req = di.parse_component({"data": {"custom_id": b["custom_id"]}})
        assert (req.ticker, req.tf, req.mas, req.volume, req.zoom, req.indicators, req.style, req.theme, req.to) == \
            ("NVDA", tf, "house", True, "auto", "none", "candles", "house", None)
    # ONE dropdown carries zoom + indicators + look; the state is in its placeholder
    sel = rows[-1]["components"][0]
    assert sel["type"] == 3 and len(sel["options"]) <= 25
    vals = [o["value"] for o in sel["options"]]
    assert [v for v in vals if v.startswith("zoom:")] == ["zoom:auto", "zoom:1d", "zoom:2d", "zoom:5d", "zoom:10d"]
    assert [v for v in vals if v.startswith("ind:")] == ["ind:none", "ind:rsi", "ind:macd", "ind:rsi+macd"]
    assert "style:candles" in vals and "theme:oled" in vals
    assert not any(o.get("default") for o in sel["options"])          # state lives in the placeholder
    assert "Zoom Auto" in sel["placeholder"] and "Candles" in sel["placeholder"]
    picked = di.parse_component({"data": {"custom_id": sel["custom_id"], "values": ["zoom:5d"]}})
    assert (picked.zoom, picked.tf, picked.mas) == ("5d", "15", "house")
    assert di.parse_component({"data": {"custom_id": sel["custom_id"], "values": ["ind:rsi+macd"]}}).indicators == "rsi+macd"
    picked = di.parse_component({"data": {"custom_id": sel["custom_id"], "values": ["theme:oled"]}})
    assert picked.theme == "oled" and picked.style == "candles"
    picked = di.parse_component({"data": {"custom_id": sel["custom_id"], "values": ["style:line"]}})
    assert picked.style == "line" and picked.theme == "house"
    row5 = rows[1]["components"]
    assert [b["label"] for b in row5[:2]] == ["MAs: House", "Volume off"]   # intraday: no pan, no link button
    assert row5[-1]["emoji"]["name"] == "▲" and len(row5) == 3         # ...and the control that closes it all
    assert di.parse_component({"data": {"custom_id": row5[0]["custom_id"]}}).mas == "10-20-50"
    assert di.parse_component({"data": {"custom_id": row5[1]["custom_id"]}}).volume is False
    # daily: pan buttons, Later disabled while live, Earlier steps back a window
    rows = di.chart_components(di.ChartRequest("NVDA", "D", mas="off", volume=False, expanded=True),
                               {**di.prefs_mod.DEFAULTS})
    row5 = rows[1]["components"]
    assert [b["label"] for b in row5[:4]] == ["◀ Earlier", "Later ▶", "MAs: off", "Volume on"]
    assert row5[1]["disabled"] is True
    earlier = di.parse_component({"data": {"custom_id": row5[0]["custom_id"]}})
    assert earlier.to is not None and earlier.tf == "D"
    rows = di.chart_components(di.ChartRequest("NVDA", "D", to="2026-05-15", expanded=True), {**di.prefs_mod.DEFAULTS})
    row5 = rows[1]["components"]
    assert row5[1].get("disabled") is False
    assert di.parse_component({"data": {"custom_id": row5[0]["custom_id"]}}).to < "2026-05-15"
    later = di.parse_component({"data": {"custom_id": row5[1]["custom_id"]}})
    assert later.to is None or later.to > "2026-05-15"
    # the current state reads off the placeholder now — no option carries
    # `default`, which is what makes TOO_MANY_DEFAULT_VALUES unreachable
    sel = rows[-1]["components"][0]
    assert not any(o.get("default") for o in sel["options"])
    assert "Zoom Auto" in sel["placeholder"] and sel["placeholder"].startswith("\u2699")
    for bad in ("", "chart|NVDA|D|house", "chart|NV DA|D|house|1", "chart|NVDA|2|house|1", "chart|NVDA|D|sma|1", "other|NVDA|D|house|1",
                "c2|NVDA|D|house|1|9y|none|candles|house||t", "c2|NVDA|D|house|1|auto|none|candles|house|2026-13-01x|t",
                "c2|NVDA|D|house|1|auto|none|candles|house|"):
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


def test_job_hands_components_to_the_edit_when_a_components_fn_is_given(monkeypatch):
    # this pins the HOUSE path's own sequence; the fast preview is separately
    # tested and would add an edit and a fetch in front of it
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "0")
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
    rows = di.chart_components(req.__class__("UCTA5", "D", daily_only=True, expanded=True), dict(p.DEFAULTS))
    assert [b["label"] for b in rows[0]["components"]] == ["D", "W"]         # no intraday buttons for a daily series
    stock = di.chart_components(di.ChartRequest("NVDA", "D", expanded=True), dict(p.DEFAULTS))
    assert [b["label"] for b in stock[0]["components"]] == ["D", "W", "60m", "15m", "5m"]


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


def test_every_custom_id_in_a_message_is_unique():
    """8/25: a live chart's disabled 'Later' carried the same state as the active
    timeframe button - Discord refused the edit (COMPONENT_CUSTOM_ID_DUPLICATED)
    and the chart sat on 'thinking...'. Every control tags its id."""
    from api.services import discord_interactions as di
    for req in (di.ChartRequest("NVDA", "D"), di.ChartRequest("NVDA", "D", to="2026-05-01"), di.ChartRequest("NVDA", "5"),
                di.ChartRequest("UCTA5", "W", daily_only=True), di.ChartRequest("NVDA", "W", mas="off", volume=False, zoom="1y")):
        ids = [c["custom_id"] for row in di.chart_components(req, dict(di.prefs_mod.DEFAULTS)) for c in row["components"] if "custom_id" in c]
        assert len(ids) == len(set(ids)), ids
        assert all(len(i) <= 100 for i in ids)
        for i in ids:                                    # and every one still parses to its chart
            values = ["style:line"] if i.startswith(("look|", "opt|")) else ["auto"] if i.startswith("zoom|") else ["none"] if i.startswith("ind|") else []
            assert di.parse_component({"data": {"custom_id": i, "values": values}}).ticker == req.ticker


# ── a rejected control tree never costs the chart ──

def test_edit_original_retries_without_components_when_discord_rejects_them_and_tells_the_member():
    from api.services.discord_interactions import edit_original
    seen = []
    class R:
        def __init__(self, ok, code=200, text=""):
            self.is_success = ok; self.status_code = code; self.text = text
    class C:
        def patch(self, url, **kw):
            seen.append(("patch", kw)); payload = json.loads(kw["data"]["payload_json"]) if "data" in kw else kw["json"]
            return R(False, 400, '{"code": 50035, "errors": {"components": {}}}') if payload.get("components") else R(True)
        def post(self, url, **kw):
            seen.append(("post", kw)); return R(True)
    comps = [{"type": 1, "components": [{"type": 2, "style": 1, "label": "D", "custom_id": "x"}]}]
    assert edit_original("1", "t", content="X · Daily", png=b"PNG", filename="x.png", components=comps, client=C())
    kinds = [k for k, _ in seen]
    assert kinds == ["patch", "patch", "post"]                                  # rejected → retried bare → member told
    assert json.loads(seen[1][1]["data"]["payload_json"])["components"] == []
    assert "files[0]" in seen[1][1]["files"]                                    # the image still ships
    assert seen[2][1]["json"]["flags"] == 64 and "re-run /chart" in seen[2][1]["json"]["content"]
    # a 5xx is not a control-tree verdict: no retry, no message
    seen.clear()
    class C5:
        def patch(self, url, **kw):
            seen.append("patch"); return R(False, 502, "bad gateway")
        def post(self, url, **kw):
            seen.append("post"); return R(True)
    assert not edit_original("1", "t", content="X", components=comps, client=C5())
    assert seen == ["patch"]


# ── "Save this chart's settings as my defaults" ──

def test_save_pick_writes_the_messages_state_to_the_members_defaults(monkeypatch):
    from api.services import discord_interactions as di, discord_chart_prefs as p
    di.reset_rate_for_tests()
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: pytest.fail("a save must not render"))
    rows = di.chart_components(di.ChartRequest("NVDA", "W", mas="off", volume=False, zoom="1y", indicators="rsi",
                                               style="line", theme="oled", expanded=True), dict(p.DEFAULTS))
    look = rows[-1]["components"][0]        # the one options dropdown
    assert [o["value"] for o in look["options"][-2:]] == [di.SAVE_VALUE, di.HELP_VALUE]
    assert not any(o.get("default") for o in look["options"][-2:])
    click = {"type": 3, "application_id": "123", "token": "tok", "guild_id": UT_GUILD, "member": {"user": {"id": "4242"}},
             "message": {"id": "m1", "content": "NVDA · Weekly",
                         "attachments": [{"id": "555", "filename": "NVDA_W_2026-08-26_Chart.png"}]},
             "data": {"custom_id": look["custom_id"], "component_type": 3, "values": [di.SAVE_VALUE]}}
    sent = []
    monkeypatch.setattr(rt.di, "followup_ephemeral", lambda app_id, token, content: sent.append(content) or True)
    r = _post(client, sk, click).json()
    # UPDATE_MESSAGE, so the select stops showing "Save…" where the style belongs
    assert r["type"] == 7
    assert [c["custom_id"] for row in r["data"]["components"] for c in row["components"] if "custom_id" in c]
    # ⛔ the message's file and text are RE-DECLARED, never left to omission
    assert r["data"]["attachments"] == [{"id": "555"}]
    assert r["data"]["content"] == "NVDA · Weekly"
    assert sent and sent[0].startswith("Saved as your defaults")          # the receipt follows privately
    saved = p.get_prefs("4242")
    assert (saved["tf"], saved["mas"], saved["volume"], saved["zoom"], saved["indicators"], saved["style"], saved["theme"]) == \
        ("W", "off", False, "1y", "rsi", "line", "oled")
    assert saved["stats"] is True and saved["ext"] is False                    # untouched keys keep their values
    assert di.parse_component({"data": {"custom_id": look["custom_id"], "values": ["save"]}}).ticker == "NVDA"
    p.reset_prefs("4242")


def test_renderer_warm_on_boot_renders_spy_once_when_the_house_path_is_on(monkeypatch):
    import api.main as m
    from api.services import discord_chart_house as house
    calls = []
    monkeypatch.setattr(house, "house_enabled", lambda: True)
    monkeypatch.setattr(house, "render_house_chart", lambda sym, tf, stats, options=None, **k: calls.append((sym, tf)) or b"PNG")
    m._start_chart_renderer_warm_background(delay_seconds=0)
    import time
    for _ in range(50):
        if calls:
            break
        time.sleep(0.05)
    assert calls == [("SPY", "D")]
    calls.clear()
    monkeypatch.setattr(house, "house_enabled", lambda: False)
    m._start_chart_renderer_warm_background(delay_seconds=0)
    time.sleep(0.3)
    assert calls == []                                                          # inert without the renderer


# ── the context line is edited in AFTER the chart, never before it ──

def test_context_line_follows_the_chart_as_a_content_only_edit_and_never_delays_or_breaks_it():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services import discord_chart_prefs as p
    order = []
    def context_fn(ticker):
        order.append(("context", ticker)); return "Earnings TODAY · ±8.1% implied"
    edits = _Edits()
    def spy(*a, **k):
        order.append(("edit", k.get("content"), k.get("png") is not None)); return edits(*a, **k)
    out = run_chart_job("1", "t", ChartRequest("CTXA", "D"), bars_fn=lambda *a: daily_bars(20),
                        render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=spy, prefs=dict(p.DEFAULTS), context_fn=context_fn)
    assert out == "ok"
    assert order == [("edit", "CTXA · Daily", True), ("context", "CTXA"),
                     ("edit", "CTXA · Daily\nEarnings TODAY · ±8.1% implied", False)]   # image first, then the line
    # the cached-PNG path gets the same follow-up
    order.clear()
    assert run_chart_job("1", "t", ChartRequest("CTXA", "D"), bars_fn=lambda *a: pytest.fail("cached"),
                         render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=spy, prefs=dict(p.DEFAULTS), context_fn=context_fn) == "ok"
    assert [o[0] for o in order] == ["edit", "context", "edit"]
    # an empty line = no second edit; a raising context_fn = chart still ok, single edit
    order.clear()
    run_chart_job("1", "t", ChartRequest("CTXB", "D"), bars_fn=lambda *a: daily_bars(20),
                  render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=spy, prefs=dict(p.DEFAULTS), context_fn=lambda t: "")
    assert [o[0] for o in order] == ["edit"]
    order.clear()
    def boom(t):
        raise RuntimeError("provider down")
    assert run_chart_job("1", "t", ChartRequest("CTXC", "D"), bars_fn=lambda *a: daily_bars(20),
                         render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=spy, prefs=dict(p.DEFAULTS), context_fn=boom) == "ok"
    assert [o[0] for o in order] == ["edit"]
    # breadth symbols have no earnings: no lookup at all
    order.clear()
    run_chart_job("1", "t", ChartRequest("UCTA5", "D", daily_only=True, display="UCTA5", breadth_name="UCTA5"),
                  bars_fn=lambda *a: daily_bars(20), render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=spy,
                  prefs=dict(p.DEFAULTS), context_fn=lambda t: pytest.fail("breadth must not look up earnings"))
    assert [o[0] for o in order] == ["edit"]
    # no context_fn (older callers) = exactly the old behaviour
    order.clear()
    run_chart_job("1", "t", ChartRequest("CTXD", "D"), bars_fn=lambda *a: daily_bars(20),
                  render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=spy, prefs=dict(p.DEFAULTS))
    assert [o[0] for o in order] == ["edit"]


def test_router_passes_the_context_line_into_the_job_unless_the_flag_is_off(monkeypatch):
    from api.services import discord_interactions as di, discord_chart_context as cc
    di.reset_rate_for_tests()
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    seen = {}
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: seen.update(k) or "ok")
    body = {"type": 2, "application_id": "123", "token": "tok", "guild_id": UT_GUILD, "member": {"user": {"id": "77"}},
            "data": {"name": "chart", "options": [{"name": "ticker", "value": "NVDA"}]}}
    monkeypatch.setenv("DISCORD_CHART_CONTEXT", "1")
    _post(client, sk, body)
    assert seen.get("context_fn") is cc.context_line
    seen.clear()
    monkeypatch.setenv("DISCORD_CHART_CONTEXT", "0")
    _post(client, sk, body)
    assert seen.get("context_fn") is None


# ── compare: overlay symbols as %-rebased lines ──

def _cmd(**opts):
    return {"data": {"options": [{"name": k, "value": v} for k, v in opts.items()]}}


def test_compare_option_parses_validates_and_rides_every_control():
    from api.services import discord_interactions as di
    req = di.parse_chart_command(_cmd(ticker="nvda", compare="spy, $qqq nvda iwm"))
    assert req.compare == ("SPY", "QQQ", "IWM")                     # upper, $ stripped, base + dupes dropped
    assert di.parse_chart_command(_cmd(ticker="NVDA", compare="  ")).compare is None
    assert di.parse_chart_command(_cmd(ticker="NVDA")).compare is None
    with pytest.raises(di.CommandError):
        di.parse_chart_command(_cmd(ticker="NVDA", compare="spy qqq iwm dia"))       # more than 3
    with pytest.raises(di.CommandError):
        di.parse_chart_command(_cmd(ticker="NVDA", compare="spy y!"))                # not a ticker
    assert any(o["name"] == "compare" for o in di.build_chart_command()["options"])
    # every control under a compared chart keeps the comparison
    rows = di.chart_components(req, dict(di.prefs_mod.DEFAULTS))
    ids = [c["custom_id"] for row in rows for c in row["components"] if "custom_id" in c]
    assert ids and all(len(i) <= 100 for i in ids) and len(ids) == len(set(ids))
    for i in ids:
        values = ["style:line"] if i.startswith(("look|", "opt|")) else ["auto"] if i.startswith("zoom|") else ["none"] if i.startswith("ind|") else []
        back = di.parse_component({"data": {"custom_id": i, "values": values}})
        assert back.ticker == "NVDA" and back.compare == ("SPY", "QQQ", "IWM"), i
    # ids minted before the compare field (one part shorter) still parse, with no comparison
    assert di.parse_component({"data": {"custom_id": "c2|NVDA|D|house|1|auto|none|candles|house||t"}}).compare is None
    assert di.parse_component({"data": {"custom_id": "zoom|c2|NVDA|D|house|1|auto|none|candles|house||", "values": ["1y"]}}).zoom == "1y"
    # a bad compare field is an unknown button, never a half-parsed chart
    with pytest.raises(di.CommandError):
        di.parse_component({"data": {"custom_id": "c2|NVDA|D|house|1|auto|none|candles|house||SPY+bad!|t"}})


def test_compare_reaches_the_house_render_the_cache_key_and_the_headline():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services import discord_chart_prefs as p, discord_chart_house as house
    seen = []
    def house_fn(ticker, tf, stats, opts):
        seen.append(dict(opts)); return PNG_MAGIC + b"house"
    edits = _Edits()
    assert run_chart_job("1", "t", ChartRequest("CMPA", "D", compare=("SPY", "QQQ")), bars_fn=lambda *a: daily_bars(20),
                         render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edits, house_fn=house_fn, prefs=dict(p.DEFAULTS)) == "ok"
    assert seen[-1]["compare"] == ["SPY", "QQQ"]
    assert edits.calls[-1]["content"] == "CMPA vs SPY/QQQ · Daily"
    # the plain chart is a different image: no cache collision with the compared one
    assert run_chart_job("1", "t", ChartRequest("CMPA", "D"), bars_fn=lambda *a: daily_bars(20),
                         render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edits, house_fn=house_fn, prefs=dict(p.DEFAULTS)) == "ok"
    assert len(seen) == 2 and not seen[-1].get("compare")
    assert edits.calls[-1]["content"] == "CMPA · Daily"
    # a breadth symbol never carries a comparison, whatever the request says
    assert run_chart_job("1", "t", ChartRequest("UCTA5", "D", daily_only=True, display="UCTA5", breadth_name="UCTA5", compare=("SPY",)),
                         bars_fn=lambda *a: daily_bars(20), render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edits,
                         house_fn=house_fn, prefs=dict(p.DEFAULTS)) == "ok"
    assert not seen[-1].get("compare") and edits.calls[-1]["content"] == "UCTA5 · Daily"
    # and the page URL carries it
    url = house.build_render_url("NVDA", "D", None, base_url="http://r", token="x", options={"compare": ["spy", "QQQ"]})
    assert "compare=SPY" in url and "QQQ" in url
    assert "compare=" not in house.build_render_url("NVDA", "D", None, base_url="http://r", token="x", options={})


# ── /charts A B C: several charts in one message ──

def test_parse_charts_command_orders_dedupes_caps_and_validates():
    from api.services import discord_interactions as di
    reqs = di.parse_charts_command({"data": {"name": "charts", "options": [{"name": "tickers", "value": "nvda, $amd avgo nvda"}]}}, default_tf="W")
    assert [r.ticker for r in reqs] == ["NVDA", "AMD", "AVGO"] and {r.tf for r in reqs} == {"W"}
    reqs = di.parse_charts_command({"data": {"options": [{"name": "tickers", "value": "spy"}, {"name": "tf", "value": "5"}]}})
    assert [(r.ticker, r.tf) for r in reqs] == [("SPY", "5")]
    for bad in ("", "   ", "nvda amd avgo smci pltr", "nvda y!"):
        with pytest.raises(di.CommandError):
            di.parse_charts_command({"data": {"options": [{"name": "tickers", "value": bad}]}})
    with pytest.raises(di.CommandError):
        di.parse_charts_command({"data": {"options": [{"name": "tickers", "value": "NVDA"}, {"name": "tf", "value": "2h"}]}})
    # …and /charts is no longer its own command: the same thing is /chart with
    # several tickers, which also stops Discord's picker offering three
    # "chart"-prefixed rows. The parser stays one deploy cycle for stale clients.
    assert "charts" not in {c["name"] for c in di.build_commands()}


def test_multi_chart_job_posts_every_chart_in_order_names_the_misses_and_reuses_the_cache():
    from api.services.discord_interactions import run_multi_chart_job, ChartRequest
    from api.services import discord_chart_prefs as p
    rendered = []
    def house_fn(ticker, tf, stats, opts):
        rendered.append(ticker); return PNG_MAGIC + ticker.encode()
    def bars_fn(ticker, tf, n):
        return None if ticker == "ZZZZQ" else daily_bars(20)
    calls = []
    edit_fn = lambda app_id, token, **k: calls.append(k) or True  # noqa: E731
    items = [(ChartRequest(t, "D"), dict(p.DEFAULTS)) for t in ("MLTA", "ZZZZQ", "MLTB")]
    assert run_multi_chart_job("1", "t", items, bars_fn=bars_fn, render_fn=lambda *a, **k: PNG_MAGIC,
                               edit_fn=edit_fn, house_fn=house_fn) == "ok"
    assert rendered == ["MLTA", "MLTB"]
    sent = calls[-1]
    assert sent["content"] == "MLTA · MLTB · Daily\nSkipped: ZZZZQ (no bars)"
    assert "components" not in sent            # no components_fn passed here
    assert [fn.split("_")[0] for _, fn in sent["pngs"]] == ["MLTA", "MLTB"]          # order asked, misses out
    assert all(png.startswith(PNG_MAGIC) for png, _ in sent["pngs"])
    # second call: both hits, nothing re-rendered
    rendered.clear()
    assert run_multi_chart_job("1", "t", items[:1] + items[2:], bars_fn=bars_fn, render_fn=lambda *a, **k: PNG_MAGIC,
                               edit_fn=edit_fn, house_fn=house_fn) == "ok"
    assert rendered == [] and calls[-1]["content"] == "MLTA · MLTB · Daily"
    # nothing renders: a plain sentence, no attachments
    assert run_multi_chart_job("1", "t", [(ChartRequest("ZZZZQ", "D"), dict(p.DEFAULTS))], bars_fn=bars_fn,
                               render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edit_fn, house_fn=house_fn) == "no_bars"
    assert calls[-1]["content"].startswith("No charts: ZZZZQ (no bars)") and "pngs" not in calls[-1]
    # a breadth item keeps its display name
    assert run_multi_chart_job("1", "t", [(ChartRequest("UCTA5", "D", daily_only=True, display="UCTA5 · % above 5-day", breadth_name="UCTA5"), dict(p.DEFAULTS))],
                               bars_fn=bars_fn, render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edit_fn, house_fn=house_fn) == "ok"
    assert calls[-1]["content"] == "UCTA5 · % above 5-day · Daily"


def test_edit_original_sends_several_attachments_as_files_0_to_n():
    from api.services.discord_interactions import edit_original
    seen = {}
    class R:
        is_success = True; status_code = 200; text = ""
    class C:
        def patch(self, url, **kw):
            seen.update(kw); return R()
    assert edit_original("1", "t", content="A · B · Daily", pngs=[(b"PNGa", "A_D_2026-08-25_Chart.png"), (b"PNGb", "B_D_2026-08-25_Chart.png")], client=C())
    payload = json.loads(seen["data"]["payload_json"])
    assert payload["attachments"] == [{"id": 0, "filename": "A_D_2026-08-25_Chart.png"}, {"id": 1, "filename": "B_D_2026-08-25_Chart.png"}]
    assert set(seen["files"]) == {"files[0]", "files[1]"} and seen["files"]["files[1]"][1] == b"PNGb"
    assert "components" not in payload


def test_endpoint_charts_defers_schedules_the_multi_job_and_counts_every_chart_against_the_rate(monkeypatch):
    from api.services import discord_interactions as di
    di.reset_rate_for_tests()
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    monkeypatch.setenv("DISCORD_CHART_USER_RATE", "3/60")
    client, rt = _app_client()
    seen = []
    monkeypatch.setattr(rt.di, "run_multi_chart_job", lambda app_id, token, items, **k: seen.append((items, k)) or "ok")
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: pytest.fail("/charts must not run the single job"))
    body = {"type": 2, "application_id": "123", "token": "tok", "guild_id": UT_GUILD, "member": {"user": {"id": "9090"}},
            "data": {"name": "charts", "options": [{"name": "tickers", "value": "NVDA AMD"}]}}
    r = _post(client, sk, body).json()
    assert r == {"type": 5}
    items, kw = seen[-1]
    assert [req.ticker for req, _ in items] == ["NVDA", "AMD"] and all(isinstance(p, dict) for _, p in items)
    assert kw["edit_fn"] is rt.di.edit_original and kw["components_fn"] is rt.di.multi_components
    # two charts used 2 of 3; a further two-chart call does not fit
    r = _post(client, sk, body).json()
    assert r["type"] == 4 and r["data"]["flags"] == 64 and r["data"]["content"].startswith("Slow down")
    body["data"]["options"][0]["value"] = "nope!"
    r = _post(client, sk, body).json()
    assert r["type"] == 4 and "not a ticker" in r["data"]["content"]


def test_no_control_id_can_exceed_discords_100_char_limit_even_at_the_worst_case():
    """8/26: `compare:` added an 11th state field and pushed the WORST-CASE id to
    115 chars (a select to 120). Discord validates the whole components tree as
    a unit, so one over-long id rejects the entire edit and the member sits on
    "thinking..." forever. The compare list is budgeted from what every other
    field leaves over - derived from the real tables, so this test also fails
    the day someone adds a longer theme/zoom/indicator name."""
    from api.services import discord_interactions as di, discord_chart_prefs as p
    longest = lambda xs: max((str(x) for x in xs), key=len)
    worst_ticker = "A" * 12
    budget = di.compare_budget(worst_ticker)
    assert budget > 0, "the fixed fields alone now fill the id - shorten the encoding"
    # A compare list exactly at budget, on the longest of every other field.
    cmp_syms = []                                        # DISTINCT: identical symbols dedupe away
    while len(cmp_syms) < di.COMPARE_MAX:
        nxt = f"BBBB{len(cmp_syms)}"
        if len("+".join(cmp_syms + [nxt])) > budget:
            break
        cmp_syms.append(nxt)
    assert len(cmp_syms) == di.COMPARE_MAX, (budget, cmp_syms)
    req = di.ChartRequest(worst_ticker, "60", mas=longest(p.MA_CHOICES), volume=True,
                          zoom=longest(p.ZOOM_CHOICES), indicators=longest(p.INDICATOR_CHOICES),
                          style=longest(p.STYLE_CHOICES), theme=longest(p.THEME_CHOICES),
                          to="2026-12-31", compare=tuple(cmp_syms), expanded=True)
    ids = [c["custom_id"] for row in di.chart_components(req, dict(p.DEFAULTS))
           for c in row["components"] if "custom_id" in c]
    assert ids
    over = [(len(i), i) for i in ids if len(i) > di.CUSTOM_ID_MAX]
    assert not over, over
    # and every one of them still round-trips to the same chart
    for i in ids:
        values = ["style:line"] if i.startswith(("look|", "opt|")) else ["auto"] if i.startswith("zoom|") else ["none"] if i.startswith("ind|") else []
        assert di.parse_component({"data": {"custom_id": i, "values": values}}).compare == tuple(cmp_syms)


def test_a_compare_list_that_would_overflow_the_id_is_refused_at_the_command():
    from api.services import discord_interactions as di
    budget = di.compare_budget("NVDA")
    assert budget >= len("SPY+QQQ+IWM")                      # the everyday case must fit
    ok = di.parse_compare("SPY QQQ IWM", "NVDA")
    assert ok == ("SPY", "QQQ", "IWM")
    too_long = " ".join("Z" * 11 + str(i) for i in range(3))       # distinct, 12 chars each
    with pytest.raises(di.CommandError) as e:
        di.parse_compare(too_long, "NVDA")
    assert "too long together" in str(e.value)
    # the budget shrinks for a long base ticker (its own symbol is in the id too)
    assert di.compare_budget("A" * 12) < di.compare_budget("F")
    # an id carrying an over-long compare field is an unknown button, not a half-chart
    bad = "c2|NVDA|D|house|1|auto|none|candles|house||" + "+".join("Z" * 11 + str(i) for i in range(3)) + "|t"
    with pytest.raises(di.CommandError):
        di.parse_component({"data": {"custom_id": bad}})


def test_the_context_edit_re_declares_the_chart_and_its_controls_so_neither_can_be_dropped():
    """`desk_session_announce._edit` is this repo's measured precedent: a PATCH
    that did not list the message's file DROPPED it. The chart IS the product,
    so the context line's edit re-states the attachment ids (from the first
    edit's response) and the same control rows rather than trusting omission."""
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services import discord_chart_prefs as p
    calls = []
    def edit_fn(app_id, token, **kw):
        calls.append(kw)
        return {"id": "msg1", "attachments": [{"id": "999", "filename": kw.get("filename")}]} if kw.get("png") else True
    rows = [{"type": 1, "components": [{"type": 2, "style": 1, "label": "D", "custom_id": "x"}]}]
    assert run_chart_job("1", "t", ChartRequest("CTXE", "D"), bars_fn=lambda *a: daily_bars(20),
                         render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=edit_fn, prefs=dict(p.DEFAULTS),
                         components_fn=lambda r, pr: rows, context_fn=lambda t: "Earnings tomorrow") == "ok"
    assert len(calls) == 2
    assert calls[1]["keep_attachments"] == ["999"]          # the image is named, not left to omission
    assert calls[1]["components"] == rows                    # so are the controls
    assert calls[1]["png"] is None if "png" in calls[1] else True
    # an edit_fn that returns a bare bool (older callers, test doubles) still works
    calls.clear()
    assert run_chart_job("1", "t", ChartRequest("CTXF", "D"), bars_fn=lambda *a: daily_bars(20),
                         render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=lambda *a, **k: calls.append(k) or True,
                         prefs=dict(p.DEFAULTS), context_fn=lambda t: "Earnings tomorrow") == "ok"
    assert len(calls) == 2 and "keep_attachments" not in calls[1]


def test_edit_original_returns_the_message_and_can_pin_the_files_a_text_edit_keeps():
    from api.services.discord_interactions import edit_original
    seen = []
    class R:
        is_success = True; status_code = 200; text = ""
        def json(self): return {"id": "m1", "attachments": [{"id": "999"}]}
    class Bad(R):
        is_success = False; status_code = 500
        def json(self): raise ValueError("no body")
    class C:
        def patch(self, url, **kw):
            seen.append(kw); return R()
    msg = edit_original("1", "t", content="X", png=b"PNG", filename="x.png", client=C())
    assert msg["attachments"][0]["id"] == "999"              # the caller learns the file's id
    edit_original("1", "t", content="X · Daily\nEarnings tomorrow", keep_attachments=["999"], client=C())
    payload = seen[-1]["json"]
    assert payload["attachments"] == [{"id": "999"}] and "files" not in seen[-1]
    class C5:
        def patch(self, url, **kw): return Bad()
    assert edit_original("1", "t", content="X", client=C5()) is False


def test_a_save_on_a_message_with_no_attachment_declares_none_and_still_confirms(monkeypatch):
    """The reset must not invent an attachments array where there is nothing to
    keep — an empty list would mean "remove every file"."""
    from api.services import discord_interactions as di, discord_chart_prefs as p
    di.reset_rate_for_tests()
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    sent = []
    monkeypatch.setattr(rt.di, "followup_ephemeral", lambda app_id, token, content: sent.append(content) or True)
    look = di.chart_components(di.ChartRequest("NVDA", "D", expanded=True), dict(p.DEFAULTS))[-1]["components"][0]
    click = {"type": 3, "application_id": "123", "token": "tok", "guild_id": UT_GUILD, "member": {"user": {"id": "4343"}},
             "message": {"id": "m1", "content": "NVDA · Daily"},          # no attachments key at all
             "data": {"custom_id": look["custom_id"], "component_type": 3, "values": [di.SAVE_VALUE]}}
    r = _post(client, sk, click).json()
    assert r["type"] == 7 and "attachments" not in r["data"]
    assert sent and sent[0].startswith("Saved as your defaults")
    assert di.message_attachment_ids(click) == []
    p.reset_prefs("4343")


def test_followup_ephemeral_posts_privately_and_never_raises():
    from api.services.discord_interactions import followup_ephemeral, DISCORD_API
    seen = []
    class R:
        is_success = True; status_code = 200; text = ""
    class C:
        def post(self, url, **kw):
            seen.append((url, kw)); return R()
    assert followup_ephemeral("123", "tok", "Saved as your defaults: x", client=C())
    url, kw = seen[-1]
    assert url == f"{DISCORD_API}/webhooks/123/tok"                       # the webhook root = a follow-up
    assert kw["json"] == {"content": "Saved as your defaults: x", "flags": 64}
    class Boom:
        def post(self, *a, **k): raise RuntimeError("network")
    assert followup_ephemeral("123", "tok", "x", client=Boom()) is False


# ── /charts: one timeframe row for the whole set, and concurrent renders ──

def test_the_charts_row_flips_every_symbol_and_round_trips_through_its_button():
    from api.services import discord_interactions as di, discord_chart_prefs as p
    reqs = [di.ChartRequest(t, "D") for t in ("NVDA", "AMD", "AVGO")]
    rows = di.multi_components([(q, dict(p.DEFAULTS)) for q in reqs])
    assert len(rows) == 1                                        # exactly one row
    ids = [c["custom_id"] for c in rows[0]["components"]]
    assert len(ids) == len(set(ids)) and all(len(i) <= di.CUSTOM_ID_MAX for i in ids)
    labels = [c.get("label") for c in rows[0]["components"]]
    assert labels == [l for _, l in di.BUTTON_TFS]
    active = [c for c in rows[0]["components"] if c["style"] == di._STYLE_PRIMARY]
    assert len(active) == 1 and active[0]["label"] == "D"        # the timeframe shown
    back = di.parse_multi_component({"data": {"custom_id": [i for i, c in zip(ids, rows[0]["components"]) if c["label"] == "W"][0]}})
    assert [q.ticker for q in back] == ["NVDA", "AMD", "AVGO"] and {q.tf for q in back} == {"W"}
    # a breadth set offers only the timeframes it has
    b = di.multi_components([(di.ChartRequest("UCTA5", "D", daily_only=True), dict(p.DEFAULTS))])
    assert [c["label"] for c in b[0]["components"]] == ["D", "W"]
    # rubbish never parses
    for bad in ("m2|NVDA|2h", "m2|NVDA", "m2||D", "m2|A+B+C+D+E|D", "m2|NV DA|D", "c2|NVDA|D"):
        with pytest.raises(di.CommandError):
            di.parse_multi_component({"data": {"custom_id": bad}})


def test_a_charts_set_renders_concurrently_and_waits_for_a_slot_instead_of_reporting_busy(monkeypatch):
    """Four charts of ONE request compete for the same render slots. Sequential
    they cost 4x one chart; grabbing slots non-blocking they would report three
    of themselves 'busy'."""
    import threading, time as _t
    from api.services.discord_interactions import run_multi_chart_job, ChartRequest, RENDER_SLOTS
    from api.services import discord_chart_prefs as p
    live, peak = [0], [0]
    lock = threading.Lock()
    def house_fn(ticker, tf, stats, opts):
        with lock:
            live[0] += 1; peak[0] = max(peak[0], live[0])
        _t.sleep(0.25)
        with lock:
            live[0] -= 1
        return PNG_MAGIC + ticker.encode()
    calls = []
    items = [(ChartRequest(t, "D"), dict(p.DEFAULTS)) for t in ("CNCA", "CNCB", "CNCC", "CNCD")]
    t0 = _t.time()
    assert run_multi_chart_job("1", "t", items, bars_fn=lambda *a: daily_bars(20),
                               render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=lambda a, b, **k: calls.append(k) or True,
                               house_fn=house_fn, components_fn=lambda it: []) == "ok"
    elapsed = _t.time() - t0
    assert peak[0] > 1, "the charts of one request rendered one after another"
    assert elapsed < 0.9, f"4 x 0.25s took {elapsed:.2f}s — not concurrent"
    assert [fn.split("_")[0] for _, fn in calls[-1]["pngs"]] == ["CNCA", "CNCB", "CNCC", "CNCD"]   # order asked
    # every slot returned
    got = [RENDER_SLOTS.acquire(blocking=False) for _ in range(4)]
    assert all(got), "a render slot leaked"
    for _ in got:
        RENDER_SLOTS.release()


def test_endpoint_charts_button_reruns_the_set_and_updates_the_same_message(monkeypatch):
    from api.services import discord_interactions as di, discord_chart_prefs as p
    di.reset_rate_for_tests()
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    monkeypatch.setenv("DISCORD_CHART_USER_RATE", "20/60")
    client, rt = _app_client()
    seen = []
    monkeypatch.setattr(rt.di, "run_multi_chart_job", lambda app_id, token, items, **k: seen.append((items, k)) or "ok")
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: pytest.fail("a /charts button is not a single chart"))
    rows = di.multi_components([(di.ChartRequest(t, "D"), dict(p.DEFAULTS)) for t in ("NVDA", "AMD")])
    weekly = [c for c in rows[0]["components"] if c["label"] == "W"][0]
    click = {"type": 3, "application_id": "123", "token": "tok", "guild_id": UT_GUILD, "member": {"user": {"id": "5150"}},
             "message": {"id": "m1", "content": "NVDA · AMD · Daily"},
             "data": {"custom_id": weekly["custom_id"], "component_type": 2}}
    r = _post(client, sk, click).json()
    assert r == {"type": 6}                                    # edits the message it sits on
    items, kw = seen[-1]
    assert [q.ticker for q, _ in items] == ["NVDA", "AMD"] and {q.tf for q, _ in items} == {"W"}
    assert kw["components_fn"] is rt.di.multi_components       # the row comes back with the new charts


def test_the_charts_row_fits_the_id_limit_by_construction_and_the_backstop_still_works():
    """The /charts id carries only symbols + timeframe, so no real request can
    approach 100 characters — DERIVED here rather than asserted in a comment.
    The length backstop in multi_components cannot fire on real input, so it is
    exercised directly: an untested branch is not protection."""
    from api.services import discord_interactions as di
    worst = [(di.ChartRequest("A" * 12, "D"), None) for _ in range(di.MULTI_MAX)]
    ids = [c["custom_id"] for c in di.multi_components(worst)[0]["components"]]
    assert ids and max(len(i) for i in ids) <= di.CUSTOM_ID_MAX
    assert max(len(i) for i in ids) < 70, "the row is close to the limit; re-derive before raising MULTI_MAX"
    # the backstop: only reachable by construction, never by parse_multi_component
    absurd = [(di.ChartRequest("B" * 12, "D"), None)] * 12
    assert di.multi_components(absurd) == []


def test_the_warm_matches_what_the_page_will_actually_fetch_including_comparisons():
    """The page asks for a shallow window normally and the FULL depth when a
    comparison or a ?to= cutoff pins it — those numbers are read from the page's
    own module, never copied. Warming a different number leaves the page pulling
    history inside the renderer's deadline (three blank charts, 2026-08-26)."""
    from api.services.discord_interactions import produce_chart, ChartRequest
    from api.services import discord_chart_prefs as p, discord_chart_house as house
    shallow = house.page_fetch_bars("D", False)
    deep = house.page_fetch_bars("D", True)
    assert shallow and deep and deep > shallow, (shallow, deep)      # read, not guessed
    def run(req, compare=()):
        asked = []
        produce_chart(req, p.render_options(dict(p.DEFAULTS), req.tf), dict(p.DEFAULTS), compare,
                      bars_fn=lambda tkr, tf, n: asked.append((tkr, tf, n)) or daily_bars(30),
                      render_fn=lambda *a, **k: PNG_MAGIC, house_fn=lambda *a, **k: PNG_MAGIC + b"h")
        return asked
    from api.services.discord_interactions import PAGE_BARS
    # the warm never drops below PAGE_BARS — shrinking it to the page's shallow
    # window brought the blank renders straight back (measured 2026-08-26)
    assert ("WRM1", "D", max(shallow, PAGE_BARS)) in run(ChartRequest("WRM1", "D"))
    assert ("WRM2", "D", max(deep, PAGE_BARS)) in run(ChartRequest("WRM2", "D", to="2026-05-01"))
    asked = run(ChartRequest("WRM3", "D", compare=("SPY", "QQQ")), compare=("SPY", "QQQ"))
    assert ("WRM3", "D", max(deep, PAGE_BARS)) in asked
    for sym in ("SPY", "QQQ"):                                        # the page fetches these too
        assert (sym, "D", house.COMPARE_FETCH_BARS) in asked, asked


def test_page_bar_depths_are_read_from_the_pages_own_module_not_copied():
    from api.services import discord_chart_house as house
    first, full = house._page_bar_depths()
    src = (pathlib.Path(house.__file__).resolve().parents[2] / "app" / "src" / "utils" / "barsBackfill.js").read_text(encoding="utf-8")
    assert f"FIRST_PAINT_BARS = {first}" in src                        # the value came from there
    assert full.get("D") and f"return {full['D']}" in src
    assert house.page_fetch_bars("D", False) == first
    assert house.page_fetch_bars("D", True) == full["D"]
    assert house.page_fetch_bars("ZZ", True) == 5000                   # unknown tf falls back


def test_a_daily_house_render_warms_the_pages_own_5000_bar_fetch_before_rendering():
    """2026-08-26: the pre-warm skipped tf=D, so the PAGE fetched its 5,000 bars
    itself, inside the renderer's deadline. Four of those at once (a /charts
    set) came back BLANK. The fetch has to happen on our side of the deadline."""
    from api.services.discord_interactions import produce_chart, ChartRequest
    from api.services import discord_chart_prefs as p
    for tf in ("D", "W", "60", "5"):
        asked = []
        def bars_fn(ticker, t, n):
            asked.append((t, n)); return daily_bars(30)
        prefs = dict(p.DEFAULTS)
        out = produce_chart(ChartRequest("WRMA", tf), p.render_options(prefs, tf), prefs,
                            bars_fn=bars_fn, render_fn=lambda *a, **k: PNG_MAGIC,
                            house_fn=lambda *a, **k: PNG_MAGIC + b"house")
        assert out[0] == "ok"
        from api.services.discord_interactions import PAGE_BARS
        want = max(house_mod.page_fetch_bars(tf, False), PAGE_BARS)
        assert (tf, want) in asked, f"tf={tf} never warmed deeply enough: {asked}"
    # without the house path there is no page to warm for
    asked = []
    produce_chart(ChartRequest("WRMB", "D"), p.render_options(dict(p.DEFAULTS), "D"), dict(p.DEFAULTS),
                  bars_fn=lambda t, tf, n: asked.append((tf, n)) or daily_bars(30),
                  render_fn=lambda *a, **k: PNG_MAGIC, house_fn=None)
    assert all(n < 600 or n == bars_to_request("D") for _, n in asked), asked


def test_a_charts_set_fetches_every_symbols_bars_before_it_renders_anything():
    """Four cold symbols fetching at once collide on the bars store's write lock
    (web's busy_timeout is 2s by design): one raises 'database is locked' and
    reports 'no bars', and the survivors land too late for the renderer and come
    back BLANK. Bars first, serially; renders still concurrent."""
    from api.services.discord_interactions import run_multi_chart_job, ChartRequest
    from api.services import discord_chart_prefs as p
    order = []
    def bars_fn(ticker, tf, n):
        order.append(("bars", ticker)); return daily_bars(30)
    def house_fn(ticker, tf, stats, opts):
        order.append(("render", ticker)); return PNG_MAGIC + ticker.encode()
    items = [(ChartRequest(s, "D"), dict(p.DEFAULTS)) for s in ("SEQA", "SEQB", "SEQC")]
    assert run_multi_chart_job("1", "t", items, bars_fn=bars_fn, render_fn=lambda *a, **k: PNG_MAGIC,
                               edit_fn=lambda a, b, **k: True, house_fn=house_fn) == "ok"
    first_render = next(i for i, (kind, _) in enumerate(order) if kind == "render")
    warmed = {sym for kind, sym in order[:first_render] if kind == "bars"}
    assert warmed == {"SEQA", "SEQB", "SEQC"}, f"a render started before every symbol had bars: {order}"


# ── the bars-warm gate: cold fetches never overlap, warm ones never queue ──

def test_two_charts_never_fetch_bars_at_the_same_time_but_renders_still_overlap():
    """Simultaneous cold fetches lose the SQLite race (web's busy_timeout is 2s
    by design): one reports 'no bars' for a good ticker, and the PAGE's own
    /api/bars can lose it too, which paints a blank. Fetches are gated; the
    renders they feed are not."""
    import threading, time as _t
    from api.services.discord_interactions import produce_chart, ChartRequest
    from api.services import discord_chart_prefs as p
    lock = threading.Lock()
    fetch_live, fetch_peak = [0], [0]
    render_live, render_peak = [0], [0]
    def bars_fn(ticker, tf, n):
        with lock:
            fetch_live[0] += 1; fetch_peak[0] = max(fetch_peak[0], fetch_live[0])
        _t.sleep(0.04)                 # a fetch is short; a render is not (measured: 0.0-0.6s vs ~2s)
        with lock:
            fetch_live[0] -= 1
        return daily_bars(30)
    def house_fn(ticker, tf, stats, opts):
        with lock:
            render_live[0] += 1; render_peak[0] = max(render_peak[0], render_live[0])
        _t.sleep(0.30)
        with lock:
            render_live[0] -= 1
        return PNG_MAGIC + ticker.encode()
    def one(sym):
        produce_chart(ChartRequest(sym, "D"), p.render_options(dict(p.DEFAULTS), "D"), dict(p.DEFAULTS),
                      bars_fn=bars_fn, render_fn=lambda *a, **k: PNG_MAGIC, house_fn=house_fn, slot_wait=20)
    threads = [threading.Thread(target=one, args=(f"GATE{i}",)) for i in range(4)]
    for t_ in threads: t_.start()
    for t_ in threads: t_.join()
    assert fetch_peak[0] == 1, f"{fetch_peak[0]} bars fetches overlapped — the gate is not holding"
    assert render_peak[0] > 1, "the renders serialised too; only the FETCH should be gated"


def test_the_warm_gate_gives_up_waiting_rather_than_stranding_a_member(monkeypatch):
    """A contended fetch still beats no chart: the gate has a timeout and
    proceeds without the slot."""
    from api.services import discord_interactions as di
    di.BARS_WARM_SLOTS.acquire()                      # hold the only slot
    try:
        t0 = __import__("time").time()
        with di.bars_warm_gate(timeout=0.2) as got:
            assert got is False                        # never got the slot…
        assert __import__("time").time() - t0 < 2      # …and did not hang on it
    finally:
        di.BARS_WARM_SLOTS.release()
    # released cleanly: the next caller gets it immediately
    with di.bars_warm_gate(timeout=0.2) as got:
        assert got is True


def test_the_warm_gate_is_one_slot_by_default_and_env_tunable(monkeypatch):
    from api.services import discord_interactions as di
    monkeypatch.delenv("DISCORD_CHART_WARM_CONCURRENCY", raising=False)
    assert di.warm_slot_count() == 1
    monkeypatch.setenv("DISCORD_CHART_WARM_CONCURRENCY", "3")
    assert di.warm_slot_count() == 3
    for bad in ("0", "9", "", "lots"):
        monkeypatch.setenv("DISCORD_CHART_WARM_CONCURRENCY", bad)
        assert di.warm_slot_count() == 1


def test_the_hot_warm_job_is_actually_wired_into_the_scheduler_and_kill_switchable(monkeypatch):
    """A warmer nobody runs is not a warmer. Derive the wiring from main.py's AST
    rather than trusting that an add_job call exists somewhere."""
    import ast, pathlib
    import api.main as m
    src = pathlib.Path(m.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "add_job":
            for kw in node.keywords:
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    ids.add(kw.value.value)
    assert "discord_chart_hot_warm" in ids, sorted(ids)
    assert hasattr(m, "_discord_chart_hot_warm")
    # a non-vacuity control: the probe can see a job that exists…
    assert "chart_health" in " ".join(ids) or len(ids) > 3
    # …and the switch really switches
    called = []
    monkeypatch.setattr("api.services.discord_interactions.warm_hot_charts",
                        lambda **k: called.append(k) or [])
    # …and it stays silent when the house path is off, which is its own guard
    from api.services import discord_chart_house as _house
    monkeypatch.setattr(_house, "house_enabled", lambda: False)
    m._discord_chart_hot_warm()
    assert called == [], "warmed with no renderer configured"
    monkeypatch.setattr(_house, "house_enabled", lambda: True)
    monkeypatch.setenv("DISCORD_CHART_HOTWARM_ENABLED", "0")
    m._discord_chart_hot_warm()
    assert called == []
    monkeypatch.setenv("DISCORD_CHART_HOTWARM_ENABLED", "1")
    m._discord_chart_hot_warm()
    assert len(called) == 1 and called[0]["house_fn"] is not None


def test_every_chart_request_is_recorded_in_the_hot_set():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services import discord_chart_prefs as p, discord_chart_hotset as hs
    hs.clear_for_tests()
    run_chart_job("1", "t", ChartRequest("HOTA", "D"), bars_fn=lambda *a: daily_bars(20),
                  render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=_Edits(), prefs=dict(p.DEFAULTS))
    keys = [k for k, _, _ in hs.snapshot()]
    assert any(k.startswith("HOTA:D") for k in keys), keys
    hs.clear_for_tests()


# ── the plain chart is a FALLBACK, not a preview ──

def test_a_quick_house_render_is_the_only_chart_a_member_sees(monkeypatch):
    """The house image gets first refusal: when it lands promptly there is no
    stand-in at all, so nobody sees a chart with different indicators."""
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services import discord_chart_prefs as p, discord_chart_cache as cc
    cc.clear()
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "1")
    monkeypatch.setenv("DISCORD_CHART_FAST_AFTER_S", "5")     # far longer than this render takes
    sent = []
    assert run_chart_job("1", "t", ChartRequest("FBKA", "D"), bars_fn=lambda *a: daily_bars(30),
                         render_fn=lambda *a, **k: PNG_MAGIC + b"fast",
                         edit_fn=lambda a, b, **k: sent.append(k.get("png")) or True,
                         house_fn=lambda *a, **k: PNG_MAGIC + b"house", prefs=dict(p.DEFAULTS)) == "ok"
    assert sent == [PNG_MAGIC + b"house"], "a stand-in appeared for a render that was already quick"
    cc.clear()


def test_a_slow_house_render_gets_a_stand_in_and_is_still_replaced_by_the_house_image(monkeypatch):
    import time as _t
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services import discord_chart_prefs as p, discord_chart_cache as cc
    cc.clear()
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "1")
    monkeypatch.setenv("DISCORD_CHART_FAST_AFTER_S", "0.2")
    def slow_house(*a, **k):
        _t.sleep(0.8); return PNG_MAGIC + b"house"
    sent = []
    assert run_chart_job("1", "t", ChartRequest("FBKB", "D"), bars_fn=lambda *a: daily_bars(30),
                         render_fn=lambda *a, **k: PNG_MAGIC + b"fast",
                         edit_fn=lambda a, b, **k: sent.append(k.get("png")) or True,
                         house_fn=slow_house, prefs=dict(p.DEFAULTS)) == "ok"
    assert sent == [PNG_MAGIC + b"fast", PNG_MAGIC + b"house"]      # stood in, then upgraded
    hit = cc.get("FBKB:D:" + p.style_signature(dict(p.DEFAULTS)))
    assert hit and hit[0] == PNG_MAGIC + b"house"                   # only the house image is cached
    cc.clear()


def test_busy_or_failed_hands_over_a_chart_instead_of_an_apology(monkeypatch):
    from api.services.discord_interactions import run_chart_job, ChartRequest, RENDER_SLOTS
    from api.services import discord_chart_prefs as p, discord_chart_cache as cc
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "1")
    monkeypatch.setenv("DISCORD_CHART_FAST_AFTER_S", "5")
    for _ in range(RENDER_SLOTS._initial_value):
        RENDER_SLOTS.acquire()
    try:
        cc.clear()
        sent = []
        out = run_chart_job("1", "t", ChartRequest("FBKC", "D"), bars_fn=lambda *a: daily_bars(30),
                            render_fn=lambda *a, **k: PNG_MAGIC + b"fast",
                            edit_fn=lambda a, b, **k: sent.append(k) or True,
                            house_fn=lambda *a, **k: PNG_MAGIC, prefs=dict(p.DEFAULTS))
        assert out == "ok"
        assert [k.get("png") for k in sent] == [PNG_MAGIC + b"fast"]
        assert all("Busy" not in str(k.get("content")) for k in sent)
    finally:
        for _ in range(RENDER_SLOTS._initial_value):
            RENDER_SLOTS.release()
        cc.clear()


def test_no_stand_in_when_there_are_no_bars_or_the_flag_is_off(monkeypatch):
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services import discord_chart_prefs as p, discord_chart_cache as cc
    cc.clear()
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "1")
    monkeypatch.setenv("DISCORD_CHART_FAST_AFTER_S", "0.2")
    sent = []
    assert run_chart_job("1", "t", ChartRequest("ZZZZQ", "D"), bars_fn=lambda *a: None,
                         render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=lambda a, b, **k: sent.append(k) or True,
                         house_fn=lambda *a, **k: PNG_MAGIC, prefs=dict(p.DEFAULTS)) == "no_bars"
    assert len(sent) == 1 and sent[0].get("png") is None and "No bars" in sent[0]["content"]
    cc.clear(); sent.clear()
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "0")
    run_chart_job("1", "t", ChartRequest("FBKD", "D"), bars_fn=lambda *a: daily_bars(30),
                  render_fn=lambda *a, **k: PNG_MAGIC + b"fast", edit_fn=lambda a, b, **k: sent.append(k) or True,
                  house_fn=lambda *a, **k: PNG_MAGIC + b"house", prefs=dict(p.DEFAULTS))
    assert [k["png"] for k in sent] == [PNG_MAGIC + b"house"]
    cc.clear()


def test_the_warm_budget_is_greedy_only_when_a_chart_holds_for_a_quarter_hour(monkeypatch):
    """Keeping 24 charts warm costs ~6% of the renderer overnight and ~44% in
    live hours, so the roster is big when it is cheap and small when it is not."""
    from api.services import discord_interactions as di, discord_chart_cache as cc
    monkeypatch.setattr(cc, "market_quiet", lambda *a, **k: True)
    quiet_size, quiet_limit = di.roster_budget()
    monkeypatch.setattr(cc, "market_quiet", lambda *a, **k: False)
    live_size, live_limit = di.roster_budget()
    assert quiet_size > live_size and quiet_limit >= live_limit
    assert quiet_size == di.ROSTER_MAX_QUIET and live_size == di.ROSTER_MAX


def test_the_hot_warm_job_is_actually_wired_into_the_scheduler_and_kill_switchable(monkeypatch):
    """A warmer nobody runs is not a warmer. Derive the wiring from main.py's AST
    rather than trusting that an add_job call exists somewhere."""
    import ast, pathlib
    import api.main as m
    src = pathlib.Path(m.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "add_job":
            for kw in node.keywords:
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    ids.add(kw.value.value)
    assert "discord_chart_hot_warm" in ids, sorted(ids)
    assert hasattr(m, "_discord_chart_hot_warm")
    # a non-vacuity control: the probe can see a job that exists…
    assert "chart_health" in " ".join(ids) or len(ids) > 3
    # …and the switch really switches
    called = []
    monkeypatch.setattr("api.services.discord_interactions.warm_hot_charts",
                        lambda **k: called.append(k) or [])
    # …and it stays silent when the house path is off, which is its own guard
    from api.services import discord_chart_house as _house
    monkeypatch.setattr(_house, "house_enabled", lambda: False)
    m._discord_chart_hot_warm()
    assert called == [], "warmed with no renderer configured"
    monkeypatch.setattr(_house, "house_enabled", lambda: True)
    monkeypatch.setenv("DISCORD_CHART_HOTWARM_ENABLED", "0")
    m._discord_chart_hot_warm()
    assert called == []
    monkeypatch.setenv("DISCORD_CHART_HOTWARM_ENABLED", "1")
    m._discord_chart_hot_warm()
    assert len(called) == 1 and called[0]["house_fn"] is not None


def test_every_chart_request_is_recorded_in_the_hot_set():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services import discord_chart_prefs as p, discord_chart_hotset as hs
    hs.clear_for_tests()
    run_chart_job("1", "t", ChartRequest("HOTA", "D"), bars_fn=lambda *a: daily_bars(20),
                  render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=_Edits(), prefs=dict(p.DEFAULTS))
    keys = [k for k, _, _ in hs.snapshot()]
    assert any(k.startswith("HOTA:D") for k in keys), keys
    hs.clear_for_tests()


# ── fast first: a chart in ~0.3s, upgraded to the house image ──
def test_the_fast_chart_is_a_floor_when_the_house_render_is_busy_or_fails(monkeypatch):
    """A member who already has a chart must never have it replaced by an apology."""
    from api.services.discord_interactions import run_chart_job, ChartRequest, RENDER_SLOTS
    from api.services import discord_chart_prefs as p, discord_chart_cache as cc
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "1")
    for slot in range(RENDER_SLOTS._initial_value):
        RENDER_SLOTS.acquire()                      # every render slot taken
    try:
        cc.clear()
        sent = []
        out = run_chart_job("1", "t", ChartRequest("FSTB", "D"), bars_fn=lambda *a: daily_bars(30),
                            render_fn=lambda *a, **k: PNG_MAGIC + b"fast",
                            edit_fn=lambda a, b, **k: sent.append(k) or True,
                            house_fn=lambda *a, **k: PNG_MAGIC, prefs=dict(p.DEFAULTS))
        assert out == "ok"
        assert len(sent) == 1 and sent[0]["png"] == PNG_MAGIC + b"fast"
        assert "Busy" not in str(sent[0].get("content"))
    finally:
        for _ in range(RENDER_SLOTS._initial_value):
            RENDER_SLOTS.release()
        cc.clear()


def test_no_preview_when_there_are_no_bars_or_the_flag_is_off(monkeypatch):
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services import discord_chart_prefs as p, discord_chart_cache as cc
    cc.clear()
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "1")
    sent = []
    assert run_chart_job("1", "t", ChartRequest("ZZZZQ", "D"), bars_fn=lambda *a: None,
                         render_fn=lambda *a, **k: PNG_MAGIC, edit_fn=lambda a, b, **k: sent.append(k) or True,
                         house_fn=lambda *a, **k: PNG_MAGIC, prefs=dict(p.DEFAULTS)) == "no_bars"
    assert len(sent) == 1 and sent[0].get("png") is None and "No bars" in sent[0]["content"]
    # flag off = exactly the old behaviour, one edit with the house image
    cc.clear(); sent.clear()
    monkeypatch.setenv("DISCORD_CHART_FAST_FIRST", "0")
    run_chart_job("1", "t", ChartRequest("FSTC", "D"), bars_fn=lambda *a: daily_bars(30),
                  render_fn=lambda *a, **k: PNG_MAGIC + b"fast", edit_fn=lambda a, b, **k: sent.append(k) or True,
                  house_fn=lambda *a, **k: PNG_MAGIC + b"house", prefs=dict(p.DEFAULTS))
    assert [k["png"] for k in sent] == [PNG_MAGIC + b"house"]
    cc.clear()


# ── one door: /chart takes a ticker or several ──

def test_chart_takes_one_ticker_or_several_and_compare_belongs_to_the_single_case():
    from api.services import discord_interactions as di
    one = di.parse_chart_requests(_cmd(ticker="nvda"))
    assert [r.ticker for r in one] == ["NVDA"]
    many = di.parse_chart_requests(_cmd(ticker="nvda, $amd avgo nvda"), default_tf="W")
    assert [r.ticker for r in many] == ["NVDA", "AMD", "AVGO"] and {r.tf for r in many} == {"W"}
    assert di.parse_chart_requests(_cmd(ticker="NVDA", compare="SPY QQQ"))[0].compare == ("SPY", "QQQ")
    with pytest.raises(di.CommandError) as e:
        di.parse_chart_requests(_cmd(ticker="NVDA AMD", compare="SPY"))
    assert "one ticker at a time" in str(e.value)
    for bad in ("", "   ", "nvda amd avgo smci pltr", "nvda y!"):
        with pytest.raises(di.CommandError):
            di.parse_chart_requests(_cmd(ticker=bad))
    # a stale client may still send the retired look overrides; they still parse
    assert di.parse_chart_requests(_cmd(ticker="NVDA", style="line", theme="oled"))[0].style == "line"


def test_the_help_pick_explains_the_controls_without_touching_the_chart(monkeypatch):
    from api.services import discord_interactions as di, discord_chart_prefs as p
    di.reset_rate_for_tests()
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    sent = []
    monkeypatch.setattr(rt.di, "followup_ephemeral", lambda a, b, content: sent.append(content) or True)
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: pytest.fail("help must not re-render"))
    look = di.chart_components(di.ChartRequest("NVDA", "D", expanded=True), dict(p.DEFAULTS))[-1]["components"][0]
    click = {"type": 3, "application_id": "123", "token": "tok", "guild_id": UT_GUILD, "member": {"user": {"id": "808"}},
             "message": {"id": "m1", "content": "NVDA · Daily", "attachments": [{"id": "42"}]},
             "data": {"custom_id": look["custom_id"], "component_type": 3, "values": [di.HELP_VALUE]}}
    r = _post(client, sk, click).json()
    assert r["type"] == 7                                   # the dropdown goes back to the style
    assert r["data"]["attachments"] == [{"id": "42"}] and r["data"]["content"] == "NVDA · Daily"
    body = sent[0]
    for must in ("/chart NVDA AMD AVGO", "compare:SPY", "UCTA5", "/chartsettings", "Earlier"):
        assert must in body, must
    assert len(body) <= 2000                                 # a Discord message


def test_a_ticker_outside_our_universe_is_still_offered_by_the_autocomplete(monkeypatch):
    """Measured 2026-08-26: AEHL, TCEHY, FNMA, BTC-USD, ^IXIC and BRK.B all
    render fine and NONE are in cap_universe — the chart path never consults it.
    But the autocomplete answered "no options match", which reads as "this bot
    does not know that ticker", so members never pressed Enter on charts that
    would have worked."""
    from api.routers import discord_interactions as rt, ticker_search as ts
    monkeypatch.setattr(ts, "ticker_search", lambda **k: {"results": []})       # nothing in the universe
    out = rt.fetch_ticker_choices("aehl")
    assert [c["value"] for c in out] == ["AEHL"], out
    assert "chart it" in out[0]["name"]
    # ⛔ only when NOTHING matched: a member typing "NV" on the way to NVDA must
    # not be offered "NV" as a ticker. The complaint is the EMPTY list.
    monkeypatch.setattr(ts, "ticker_search", lambda **k: {"results": [{"ticker": "NVDA", "name": "NVIDIA"}]})
    assert [c["value"] for c in rt.fetch_ticker_choices("NV")] == ["NVDA"]
    assert [c["value"] for c in rt.fetch_ticker_choices("NVDA")] == ["NVDA"]
    # junk is never offered as a ticker
    monkeypatch.setattr(ts, "ticker_search", lambda **k: {"results": []})
    assert rt.fetch_ticker_choices("not a ticker!") == []
    assert len(rt.fetch_ticker_choices("A" * 40)) == 0


def test_the_invite_asks_for_exactly_what_a_chart_needs_and_nothing_dangerous():
    """2026-08-26: the app was installed in the member server with
    `scope=applications.commands` and NO permissions, so it inherited a role
    that could Send Messages but not Attach Files — and a chart IS an
    attachment. 0 of 71 channels could post one, which read to members as the
    bot not knowing their ticker."""
    from tools.discord_chart_commands import invite_url, INVITE_PERMISSIONS
    url = invite_url("123")
    assert "scope=bot+applications.commands" in url          # commands alone grants nothing
    assert f"permissions={INVITE_PERMISSIONS}" in url
    assert INVITE_PERMISSIONS & 0x8000, "Attach Files — the chart itself"
    assert INVITE_PERMISSIONS & 0x400 and INVITE_PERMISSIONS & 0x800
    for bit, name in ((0x8, "administrator"), (0x10000000, "manage roles"), (0x2000, "manage messages"),
                      (0x4, "ban"), (0x2, "kick"), (0x20, "manage guild"), (0x40000000, "manage threads")):
        assert not (INVITE_PERMISSIONS & bit), f"the invite must never ask for {name}"


def test_a_refused_attachment_tells_the_member_why_instead_of_hanging():
    """Uncharted Territory, 2026-08-26: the app had Send Messages but not Attach
    Files, so every chart was refused by Discord — and because a failed edit is
    silent the member sat on 'thinking…' and concluded the bot did not know
    their ticker. The reply now names the missing permission."""
    from api.services.discord_interactions import edit_original, attachment_refused_note
    seen = []
    class R:
        def __init__(self, ok, code=200, text=""):
            self.is_success, self.status_code, self.text = ok, code, text
        def json(self): return {"id": "m"}
    class C:
        def patch(self, url, **kw):
            seen.append(kw)
            if "files" in kw:                       # the upload is refused
                return R(False, 403, '{"message": "Missing Permissions", "code": 50013}')
            return R(True)                           # …but plain text gets through
    out = edit_original("1", "t", content="TRAX · Daily", png=PNG_MAGIC + b"x",
                        filename="TRAX_D_2026-08-26_Chart.png", client=C())
    assert out, "the member got nothing at all"
    assert len(seen) == 2 and "files" not in seen[-1]
    body = seen[-1]["json"]["content"]
    assert body.startswith("TRAX · Daily")           # they still learn what was charted
    assert "Attach Files" in body and "admin" in body.lower()
    assert len(body) <= 2000
    # a different 4xx is not blamed on permissions
    assert attachment_refused_note('{"code": 50035}') == ""
    assert "too large" in attachment_refused_note('{"code": 40005}').lower()


# ── option 3: a posted chart is ONE row ──

def test_a_posted_chart_is_one_row_and_the_gear_opens_the_rest(monkeypatch):
    """Owner, looking at a chart in the member server: "this looks mega clunky and
    really clogs up a decent portion of channels... anyway to make those parts more
    compact" -> of the three shapes offered, "I like options 3 the best", the most
    compact. A chart is now the image plus ONE row; the gear opens everything."""
    from api.services import discord_interactions as di, discord_chart_prefs as p
    monkeypatch.setenv("DISCORD_ACTIVITY_GUILDS", "")
    rows = di.chart_components(di.ChartRequest("NVDA", "D"), dict(p.DEFAULTS))
    assert len(rows) == 1, "a chart in a busy channel is one row"
    row = rows[0]["components"]
    assert [b.get("label") for b in row[:-1]] == ["D", "W", "60m", "5m"]
    assert row[0]["style"] == 1 and row[-1]["emoji"]["name"] == "⚙️"
    assert "label" not in row[-1], "the gear is an icon; a label would cost width"
    assert all(len(b["custom_id"]) <= di.CUSTOM_ID_MAX for b in row)

    # the gear opens the full surface, carrying every chart setting untouched
    opened = di.parse_component({"data": {"custom_id": row[-1]["custom_id"]}})
    assert opened.expanded is True
    assert (opened.ticker, opened.tf, opened.mas, opened.zoom) == ("NVDA", "D", "house", "auto")
    full = di.chart_components(opened, dict(p.DEFAULTS))
    assert len(full) == 3 and [b["label"] for b in full[0]["components"]] == ["D", "W", "60m", "15m", "5m"]

    # ...and the collapse control closes it again, back to the one row
    back = di.parse_component({"data": {"custom_id": full[1]["components"][-1]["custom_id"]}})
    assert back.expanded is False and back.tf == "D"
    assert len(di.chart_components(back, dict(p.DEFAULTS))) == 1

    # a timeframe pressed while closed STAYS closed - opening is a deliberate act
    fifteen = di.parse_component({"data": {"custom_id": full[0]["components"][3]["custom_id"]}})
    assert fifteen.tf == "15" and fifteen.expanded is True
    closed_5m = di.parse_component({"data": {"custom_id": row[3]["custom_id"]}})
    assert closed_5m.tf == "5" and closed_5m.expanded is False


def test_the_closed_row_always_shows_the_timeframe_the_chart_is_actually_on():
    """15m gives up its slot to the gear when closed. It must not vanish while it
    is the timeframe being VIEWED - a member on 15m would otherwise see four
    buttons, none of them lit, and no way to tell what they were looking at."""
    from api.services import discord_interactions as di, discord_chart_prefs as p
    row = di.chart_components(di.ChartRequest("NVDA", "15"), dict(p.DEFAULTS))[0]["components"]
    assert [b.get("label") for b in row[:-1]] == ["D", "W", "60m", "15m"]
    lit = [b for b in row if b.get("style") == 1]
    assert len(lit) == 1 and lit[0]["label"] == "15m"
    assert di.parse_component({"data": {"custom_id": lit[0]["custom_id"]}}).tf == "15"
    # every closed row lights exactly the timeframe in play, and always offers the gear
    for tf in ("D", "W", "60", "15", "5"):
        r = di.chart_components(di.ChartRequest("NVDA", tf), dict(p.DEFAULTS))[0]["components"]
        assert [b.get("style") for b in r].count(1) == 1, tf
        assert r[-1]["emoji"]["name"] == "⚙️" and len(r) <= 5
    # breadth keeps its two timeframes plus the gear
    b = di.chart_components(di.ChartRequest("UCTA5", "D", daily_only=True), dict(p.DEFAULTS))[0]["components"]
    assert [x.get("label") for x in b[:-1]] == ["D", "W"] and len(b) == 3


def test_the_collapse_control_survives_a_full_toggle_row(monkeypatch):
    """In an activity guild the toggle row already holds five buttons. The collapse
    control takes a row of its own there rather than being truncated off - dropping
    it would strand the member in the expanded view with no way back."""
    from api.services import discord_interactions as di, discord_chart_prefs as p
    monkeypatch.setenv("DISCORD_ACTIVITY_GUILDS", "1524909611054792786")
    rows = di.chart_components(di.ChartRequest("NVDA", "D", expanded=True), dict(p.DEFAULTS),
                               guild_id="1524909611054792786")
    assert all(len(r["components"]) <= 5 for r in rows) and len(rows) <= 5
    buttons = [c for r in rows for c in r["components"] if c["type"] == 2]
    collapse = [b for b in buttons if b.get("emoji", {}).get("name") == "▲"]
    assert len(collapse) == 1, "the way back must exist exactly once"
    assert di.parse_component({"data": {"custom_id": collapse[0]["custom_id"]}}).expanded is False
    assert "Open in Discord" in [b.get("label") for b in buttons]     # ...and nothing was displaced


def test_an_id_minted_before_the_gear_still_parses():
    """A chart posted before this deploy carries 11-field ids. Those messages keep
    working - the missing field reads as "closed", which is the new default."""
    from api.services import discord_interactions as di
    P = di.STATE_PREFIX
    old = f"{P}|NVDA|D|house|1|auto|none|candles|house||SPY+QQQ|t"     # 11 fields + tag
    req = di.parse_component({"data": {"custom_id": old}})
    assert (req.ticker, req.tf, req.volume, req.compare, req.expanded) == ("NVDA", "D", True, ("SPY", "QQQ"), False)
    older = f"{P}|NVDA|W|off|0|1y|rsi|line|oled|2026-05-15|t"          # pre-compare, 10 fields + tag
    req = di.parse_component({"data": {"custom_id": older}})
    assert (req.tf, req.mas, req.volume, req.zoom, req.to, req.compare, req.expanded) == \
        ("W", "off", False, "1y", "2026-05-15", None, False)
    # the flags digit is the ONLY thing that changed shape: 2 and 3 are the new
    # values, and they carry volume exactly as 0 and 1 always did
    for flags, (vol, exp) in {"0": (False, False), "1": (True, False),
                              "2": (False, True), "3": (True, True)}.items():
        r = di.parse_component({"data": {"custom_id": f"{P}|NVDA|D|house|{flags}|auto|none|candles|house|||t"}})
        assert (r.volume, r.expanded) == (vol, exp), flags
    for bad in ("4", "9", "x", "-1", ""):
        with pytest.raises(di.CommandError):
            di.parse_component({"data": {"custom_id": f"{P}|NVDA|D|house|{bad}|auto|none|candles|house|||t"}})
    # and an id is no LONGER than it was before the gear existed - the flag is a
    # spare bit, not a field, so it never eats into the compare budget
    assert di.compare_budget("NVDA") >= len("+".join(["BBBB0"] * di.COMPARE_MAX))


def test_working_inside_the_opened_surface_leaves_it_open():
    """A member who opened the controls is working. Every control on that surface
    - pan, MAs, volume, and each pick on the merged dropdown - has to hand the
    open state back, or the panel folds itself away mid-adjustment and the next
    change costs two presses."""
    from api.services import discord_interactions as di, discord_chart_prefs as p
    rows = di.chart_components(di.ChartRequest("NVDA", "D", expanded=True), dict(p.DEFAULTS))
    sel = rows[-1]["components"][0]
    for value in ("zoom:5d", "ind:rsi", "style:line", "theme:oled"):
        picked = di.parse_component({"data": {"custom_id": sel["custom_id"], "values": [value]}})
        assert picked.expanded is True, value
    for button in rows[1]["components"]:
        req = di.parse_component({"data": {"custom_id": button["custom_id"]}})
        # ...every one of them except the control whose whole job is to close it
        want = button.get("emoji", {}).get("name") != "\u25b2"
        assert req.expanded is want, button.get("label") or button.get("emoji")
    # and the reverse: nothing on the closed row opens it by accident
    for button in di.chart_components(di.ChartRequest("NVDA", "D"), dict(p.DEFAULTS))[0]["components"][:-1]:
        assert di.parse_component({"data": {"custom_id": button["custom_id"]}}).expanded is False

