"""The fail_fn hooks the V2 runtime uses, and the proof that the pre-V2 path is unchanged.

Two directions, both railed:
  * with `fail_fn`, a failure goes through the contract with its REAL class — never a
    per-site sentence, never silence;
  * without it, every member-facing sentence is byte-identical to what ships today.
"""
from __future__ import annotations

import datetime as dt
import threading

import httpx
import pytest

from api.services import discord_chart_cache as png_cache
from api.services import discord_interactions as di


def _daily(n=170):
    out, day, px = [], dt.date(2026, 1, 2), 100.0
    for i in range(n):
        while day.weekday() >= 5:
            day += dt.timedelta(days=1)
        o = px
        c = px * (1.01 if i % 3 else 0.99)
        out.append({"t": day.isoformat(), "o": o, "h": max(o, c) * 1.01, "l": min(o, c) * 0.99, "c": c, "v": 1_000_000})
        px = c
        day += dt.timedelta(days=1)
    return out


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setenv("DISCORD_CHART_SELF_HEAL", "0")
    monkeypatch.setattr(di, "BARS_RETRY_DELAY_S", 0)
    png_cache.clear()
    yield
    png_cache.clear()


class Edits:
    def __init__(self, result=True, raise_on=None):
        self.calls = []
        self.result = result
        self.raise_on = raise_on

    def __call__(self, app_id, token, **kw):
        self.calls.append(kw)
        if self.raise_on and self.raise_on(kw):
            raise RuntimeError("edit blew up")
        return {"id": "m", "attachments": []} if self.result else False


def _fails():
    got = []
    return got, (lambda cls, detail="": got.append((cls, detail)))


# ── run_chart_job ───────────────────────────────────────────────────────────

def test_no_bars_goes_to_the_contract_with_its_class():
    edits = Edits()
    got, fail = _fails()
    out = di.run_chart_job("A", "T", di.ChartRequest("ZZZZ", "D"), bars_fn=lambda *a: None,
                           render_fn=lambda *a, **k: b"PNG", edit_fn=edits, fail_fn=fail)
    assert out == "no_bars" and got and got[0][0] == "no_bars"
    assert not any("No bars for" in str(c.get("content")) for c in edits.calls)


def test_no_bars_without_the_hook_is_byte_identical_to_today():
    edits = Edits()
    di.run_chart_job("A", "T", di.ChartRequest("ZZZZ", "D"), bars_fn=lambda *a: None,
                     render_fn=lambda *a, **k: b"PNG", edit_fn=edits)
    assert edits.calls[-1]["content"] == ("No bars for ZZZZ (Daily). Unknown ticker, or the feed is "
                                          "still catching up on it - try again in a minute.")


def test_busy_is_queue_full_through_the_hook_and_unchanged_without(monkeypatch):
    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(di, "RENDER_SLOTS", slots)
    slots.acquire()
    try:
        got, fail = _fails()
        di.run_chart_job("A", "T", di.ChartRequest("NVDA", "D"), bars_fn=lambda *a: _daily(),
                         render_fn=lambda *a, **k: b"PNG", edit_fn=Edits(), fail_fn=fail)
        assert got[0][0] == "queue_full"
        plain = Edits()
        di.run_chart_job("A", "T", di.ChartRequest("NVDA", "D"), bars_fn=lambda *a: _daily(),
                         render_fn=lambda *a, **k: b"PNG", edit_fn=plain)
        assert plain.calls[-1]["content"] == "Busy, try again in a few seconds."
    finally:
        slots.release()


def test_C11_a_crash_is_reported_through_the_hook_where_the_old_path_said_nothing():
    req = di.ChartRequest("NVDA", "D")
    key = f"NVDA:D:{di.prefs_mod.style_signature({})}"
    png_cache.put(key, b"PNG", "NVDA_D.png", ttl_s=60)
    got, fail = _fails()
    boom = Edits(raise_on=lambda kw: True)
    assert di.run_chart_job("A", "T", req, bars_fn=lambda *a: None, render_fn=lambda *a, **k: b"PNG",
                            edit_fn=boom, fail_fn=fail) == "error"
    assert got == [("internal", "job crashed")]
    # …and the pre-V2 path, for the record: it returns "error" and tells the member nothing.
    png_cache.put(key, b"PNG", "NVDA_D.png", ttl_s=60)
    silent = Edits(raise_on=lambda kw: True)
    assert di.run_chart_job("A", "T", req, bars_fn=lambda *a: None, render_fn=lambda *a, **k: b"PNG",
                            edit_fn=silent) == "error"
    assert len(silent.calls) == 1                      # the one edit that raised; no apology after it


# ── run_multi_chart_job ─────────────────────────────────────────────────────

def test_multi_with_nothing_delivered_goes_to_the_contract():
    items = [(di.ChartRequest("ZZZA", "D"), {}), (di.ChartRequest("ZZZB", "D"), {})]
    got, fail = _fails()
    edits = Edits()
    assert di.run_multi_chart_job("A", "T", items, bars_fn=lambda *a: None, render_fn=lambda *a, **k: b"PNG",
                                  edit_fn=edits, fail_fn=fail) == "no_bars"
    assert got and got[0][0] == "no_bars" and "ZZZA" in got[0][1]
    assert not any(str(c.get("content", "")).startswith("No charts:") for c in edits.calls)


def test_multi_without_the_hook_keeps_its_sentence():
    items = [(di.ChartRequest("ZZZA", "D"), {})]
    edits = Edits()
    di.run_multi_chart_job("A", "T", items, bars_fn=lambda *a: None, render_fn=lambda *a, **k: b"PNG", edit_fn=edits)
    assert edits.calls[-1]["content"].startswith("No charts: ZZZA (no bars).")


# ── run_flow_card_job ───────────────────────────────────────────────────────

OLD_FLOW_SENTENCE = "⚠️ The flow feed is reconnecting — couldn't read **DPRO** right now. Try again in a moment."


@pytest.fixture
def worker_url(monkeypatch):
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test:8080")


def _flow(monkeypatch, behaviour, **kw):
    from api.routers import discord_interactions as rt
    seen = {}

    def fake_get(url, params=None, timeout=None):
        seen.update(url=url, params=dict(params or {}), timeout=timeout)
        return behaviour()
    monkeypatch.setattr(httpx, "get", fake_get)
    edits = Edits()
    got, fail = _fails()
    rt.run_flow_card_job("A", "T", "DPRO", "30", edit_fn=edits, fail_fn=fail if kw.pop("with_hook", True) else None, **kw)
    return got, edits, seen


def _raise(exc):
    def f():
        raise exc
    return f


@pytest.mark.parametrize("exc,cls", [
    (httpx.ReadTimeout("slow"), "flow_timeout"),
    (httpx.ConnectError("refused"), "flow_unavailable"),
])
def test_C08_a_flow_transport_failure_names_its_real_cause(monkeypatch, worker_url, exc, cls):
    got, edits, _ = _flow(monkeypatch, _raise(exc), timeout_s=10.0)
    assert got and got[0][0] == cls
    assert edits.calls == []


def test_C08_a_flow_worker_500_is_an_error_not_a_reconnect(monkeypatch, worker_url):
    got, _, _ = _flow(monkeypatch, lambda: httpx.Response(500, json={"detail": "boom"}))
    assert got == [("flow_error", "HTTP 500")]


def test_C08_ok_false_is_a_flow_error(monkeypatch, worker_url):
    got, _, _ = _flow(monkeypatch, lambda: httpx.Response(200, json={"ok": False}))
    assert got and got[0][0] == "flow_error"


def test_flow_without_the_hook_keeps_todays_sentence_for_every_cause(monkeypatch, worker_url):
    for behaviour in (_raise(httpx.ReadTimeout("x")), lambda: httpx.Response(500, json={}),
                      lambda: httpx.Response(200, json={"ok": False})):
        _, edits, _ = _flow(monkeypatch, behaviour, with_hook=False)
        assert edits.calls[-1]["content"] == OLD_FLOW_SENTENCE


def test_the_correlation_id_rides_to_flow_worker_as_a_query_param(monkeypatch, worker_url):
    _, _, seen = _flow(monkeypatch, lambda: httpx.Response(200, json={"ok": False}), cid="7f3a9c21", timeout_s=10.0)
    assert seen["params"]["cid"] == "7f3a9c21" and seen["timeout"] == 10.0
    _, _, seen2 = _flow(monkeypatch, lambda: httpx.Response(200, json={"ok": False}))
    assert "cid" not in seen2["params"] and seen2["timeout"] == 30.0     # old path: no param, old timeout


# ── last_edit_failure ───────────────────────────────────────────────────────

def test_a_dead_token_is_recorded_so_the_runtime_can_tell_it_from_a_bad_payload():
    def dead(request):
        return httpx.Response(404, json={"message": "Unknown Webhook", "code": 10015})
    assert di.edit_original("A", "T", content="x", client=httpx.Client(transport=httpx.MockTransport(dead))) is False
    f = di.last_edit_failure()
    assert f["status"] == 404 and f["code"] == 10015


def test_a_transport_failure_is_recorded_with_no_status():
    def boom(request):
        raise httpx.ConnectError("down")
    assert di.edit_original("A", "T", content="x", client=httpx.Client(transport=httpx.MockTransport(boom))) is False
    f = di.last_edit_failure()
    assert f["status"] is None and f["detail"] == "ConnectError"
