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
    assert list(frame.columns) == ["Open", "High", "Low", "Close", "Volume", "SMA10", "SMA20", "SMA50"]


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
    from api.services.discord_chart_render import WINDOW, MA_LEAD
    asked = []
    bars = daily_bars(170)

    def bars_fn(ticker, tf, n):
        asked.append((ticker, tf, n))
        return bars

    edits = _Edits()
    out = run_chart_job("123", "tok", ChartRequest("NVDA", "D"),
                        bars_fn=bars_fn, render_fn=lambda t, tf, b: PNG_MAGIC + b"png", edit_fn=edits)
    assert out == "ok"
    assert asked == [("NVDA", "D", WINDOW["D"] + MA_LEAD)]
    assert len(edits.calls) == 1
    call = edits.calls[0]
    assert call["content"] == "NVDA · Daily"
    assert call["png"] == PNG_MAGIC + b"png"
    assert call["filename"] == f"NVDA_D_{bars[-1]['t']}_Chart.png"


def test_run_chart_job_no_bars_render_failure_and_bars_exception():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    edits = _Edits()
    assert run_chart_job("1", "t", ChartRequest("ZZZZQ", "60"),
                         bars_fn=lambda *a: None, render_fn=lambda *a: b"", edit_fn=edits) == "no_bars"
    assert edits.calls[-1]["content"] == "No bars for ZZZZQ (60 min)." and edits.calls[-1]["png"] is None

    assert run_chart_job("1", "t", ChartRequest("SPY", "D"),
                         bars_fn=lambda *a: [], render_fn=lambda *a: b"", edit_fn=edits) == "no_bars"

    def bars_boom(*a):
        raise RuntimeError("db gone")
    assert run_chart_job("1", "t", ChartRequest("SPY", "D"),
                         bars_fn=bars_boom, render_fn=lambda *a: b"", edit_fn=edits) == "no_bars"

    def render_boom(*a):
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
                                bars_fn=lambda *a: daily_bars(20), render_fn=lambda *a: PNG_MAGIC, edit_fn=edits) == "busy"
        assert edits.calls[-1]["content"] == "Busy, try again in a few seconds."
    finally:
        for _ in held:
            di.RENDER_SLOTS.release()
    # slots come back: a normal run succeeds and does not leak a slot
    assert di.run_chart_job("1", "t", di.ChartRequest("SPY", "D"),
                            bars_fn=lambda *a: daily_bars(20), render_fn=lambda *a: PNG_MAGIC, edit_fn=edits) == "ok"
    assert di.RENDER_SLOTS.acquire(blocking=False)
    di.RENDER_SLOTS.release()


def test_run_chart_job_never_raises_even_if_edit_fn_raises():
    from api.services.discord_interactions import run_chart_job, ChartRequest

    def edit_boom(*a, **k):
        raise RuntimeError("discord down")
    assert run_chart_job("1", "t", ChartRequest("SPY", "D"),
                         bars_fn=lambda *a: daily_bars(20), render_fn=lambda *a: PNG_MAGIC, edit_fn=edit_boom) == "error"
