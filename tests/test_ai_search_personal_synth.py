import asyncio
from api.services import ai_search_personal as p
from api.routers import ai_search as router


def test_synth_system_carries_safety_blocks():
    sysmsg = p.SYNTH_SYSTEM("YOUR POSITIONS: NVDA", "regime bull")
    assert router._SAFETY_BLOCKS in sysmsg                 # illegal/scope/data-limits present
    assert "may be dated" in sysmsg.lower()                # freshness firewall
    assert "do not" in sysmsg.lower() and "go/hold/skip" in sysmsg.lower()  # no authored verdict
    assert "risk undefined" in sysmsg.lower()              # placeholder-stop rule


def test_reserve_synth_per_user_atomic(monkeypatch):
    monkeypatch.setattr(p, "_SYNTH_PERUSER_CAP", 2)
    monkeypatch.setattr(p, "_SYNTH_GLOBAL_HARD", 999.0)
    p._reset_synth_counters()
    assert p.reserve_synth("u1") is True
    assert p.reserve_synth("u1") is True
    assert p.reserve_synth("u1") is False                  # 3rd exceeds per-user cap
    assert p.reserve_synth("u2") is True                   # other user unaffected


def test_reserve_synth_global_hard_cap(monkeypatch):
    monkeypatch.setattr(p, "_SYNTH_PERUSER_CAP", 999)
    monkeypatch.setattr(p, "_SYNTH_GLOBAL_HARD", 0.03)
    monkeypatch.setattr(p, "_APPROX_COST", 0.02)
    p._reset_synth_counters()
    assert p.reserve_synth("u1") is True    # spend 0.02, under 0.03
    assert p.reserve_synth("u2") is False   # 0.02+0.02=0.04 > 0.03 hard cap


def test_reserve_synth_day_roll_resets_counters(monkeypatch):
    monkeypatch.setattr(p, "_SYNTH_PERUSER_CAP", 1)
    monkeypatch.setattr(p, "_SYNTH_GLOBAL_HARD", 999.0)
    p._reset_synth_counters()
    monkeypatch.setattr(p, "_et_day", lambda: "2026-07-21")
    assert p.reserve_synth("u1") is True
    assert p.reserve_synth("u1") is False   # over per-user cap on day 1
    monkeypatch.setattr(p, "_et_day", lambda: "2026-07-22")   # day rolls
    assert p.reserve_synth("u1") is True    # counters reset for the new day


def test_synth_streams_via_async_anthropic(monkeypatch):
    # Fake AsyncAnthropic streaming context manager yielding two deltas.
    class _Stream:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        @property
        async def text_stream(self):
            for t in ("Your ", "NVDA…"):
                yield t
    class _Msgs:
        def stream(self, **kw): return _Stream()
    class _Client:
        messages = _Msgs()
    monkeypatch.setattr(p, "_async_client", lambda: _Client())
    async def go():
        return [t async for t in p.synthesize("q", "draft", "YOUR POSITIONS", "regime", None)]
    out = asyncio.run(go())
    assert "".join(out) == "Your NVDA…"


def test_synth_no_temperature_and_thinking_disabled(monkeypatch):
    """LOCKED config: no `temperature` kwarg (Sonnet tier 400s on it), thinking
    disabled, explicit timeout, max_tokens from env-derived constant."""
    captured = {}

    class _Stream:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        @property
        async def text_stream(self):
            return
            yield  # pragma: no cover - empty async generator

    class _Msgs:
        def stream(self, **kw):
            captured.update(kw)
            return _Stream()

    class _Client:
        messages = _Msgs()

    monkeypatch.setattr(p, "_async_client", lambda: _Client())

    async def go():
        return [t async for t in p.synthesize("q", "", "personal", "live", None)]

    asyncio.run(go())
    assert "temperature" not in captured
    assert captured["thinking"] == {"type": "disabled"}
    assert "timeout" in captured
    assert captured["max_tokens"] == p._SYNTH_MAX_TOKENS
    assert captured["model"] == p._SYNTH_MODEL
